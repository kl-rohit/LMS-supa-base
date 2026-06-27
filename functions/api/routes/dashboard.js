// /api/dashboard — aggregated stats for the home screen. Org-scoped.

const router = require('express').Router();
const { zcql, zcqlAll, unwrap, normalize } = require('../db/catalystDb');

// Attendance counts by hours, not by sessions: a 2-hour class marked present
// counts as 2 toward the present/absent totals behind the attendance rate.
// `duration_hours` is frozen on each Attendance row at record time; legacy rows
// without it fall back to 1 hour.
const hrs = (a) => Number(a.duration_hours) || 1;
const sumHrs = (arr) => arr.reduce((s, a) => s + hrs(a), 0);

// Short per-org cache for the dashboard payload. The home screen loads on every
// login and refresh, and each load fans out to a full Students + Classes +
// Attendance pull (Attendance is paginated). A 30s window collapses the rapid
// repeat loads (open app, switch tab, refresh) into one scan, while staying
// fresh enough that a just-recorded attendance shows up within half a minute.
// Lives only in a warm container; cold starts clear it. Keyed by orgId.
const DASHBOARD_CACHE_TTL_MS = 30 * 1000;
const dashboardCache = new Map();

router.get('/', async (req, res) => {
  try {
    const cacheKey = String(req.orgId);
    const cached = dashboardCache.get(cacheKey);
    if (cached && cached.exp > Date.now()) return res.json(cached.value);
    if (cached) dashboardCache.delete(cacheKey);

    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const dow = today.getDay();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;
    const monthStr = String(month).padStart(2, '0');
    const dateFrom = `${year}-${monthStr}-01`;
    const dateTo = `${year}-${monthStr}-31`;
    const orgFilter = `org_id = ${Number(req.orgId)}`;

    // Org-scoped pulls.
    const [studentRows, classRows, attendanceRows] = await Promise.all([
      zcql(req, `SELECT * FROM Students WHERE Students.${orgFilter}`).catch(() => []),
      zcql(req, `SELECT * FROM Classes WHERE Classes.${orgFilter}`).catch(() => []),
      zcqlAll(req, `SELECT * FROM Attendance WHERE Attendance.${orgFilter}`, 'Attendance').catch(() => []),
    ]);
    const students = unwrap(studentRows, 'Students');
    const classes = unwrap(classRows, 'Classes');
    const attendanceAll = unwrap(attendanceRows, 'Attendance');

    const activeStudents = students.filter((s) => s.status === 'active' || !s.status);

    // In-memory lookup map so student-name decoration costs zero extra queries
    // (students were already pulled above, org-scoped).
    const studentById = new Map(students.map((s) => [String(s.ROWID), s]));

    // Today's classes, honouring timetable exceptions: a class MOVED to today
    // shows (with its moved time) even though its weekly day differs, and a
    // class CANCELLED or MOVED AWAY today drops from its normal weekday slot.
    const parseEx = (raw) => {
      if (!raw) return [];
      if (Array.isArray(raw)) return raw;
      try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return []; }
    };
    const activeClasses = classes.filter((c) => c.is_active === undefined || Number(c.is_active) === 1);
    const todayClasses = [];
    for (const c of activeClasses) {
      const exs = parseEx(c.exceptions);
      const movedIn = exs.find((e) => e.status === 'moved' && e.new_date === todayStr);
      if (movedIn) {
        const nc = normalize(c);
        nc.start_time = movedIn.new_start_time || nc.start_time;
        nc.end_time = movedIn.new_end_time || nc.end_time;
        todayClasses.push(nc);
        continue;
      }
      if (Number(c.day_of_week) === dow) {
        const ex = exs.find((e) => e.date === todayStr);
        if (ex && (ex.status === 'cancelled' || ex.status === 'moved')) continue;
        todayClasses.push(normalize(c));
      }
    }

    // Group names for today's classes: ONE org-scoped pull (only when a group
    // class is on today), not a getById per class.
    const needGroups = todayClasses.some((c) => c.group_id);
    let groupById = new Map();
    if (needGroups) {
      const gRows = await zcql(req, `SELECT * FROM Groups WHERE Groups.org_id = ${Number(req.orgId)}`).catch(() => []);
      groupById = new Map(unwrap(gRows, 'Groups').map((g) => [String(g.ROWID), g]));
    }
    for (const c of todayClasses) {
      if (c.student_id) {
        const s = studentById.get(String(c.student_id));
        if (s) c.student_name = s.name;
      }
      if (c.group_id) {
        const g = groupById.get(String(c.group_id));
        if (g) c.group_name = g.name;
      }
    }
    todayClasses.sort((a, b) => String(a.start_time || '').localeCompare(b.start_time || ''));

    const thisMonth = attendanceAll.filter((a) => {
      const d = a.class_date || a.date;
      return d && d >= dateFrom && d <= dateTo;
    });
    const presentCount = sumHrs(thisMonth.filter((a) => a.status === 'present'));
    const absentCount = sumHrs(thisMonth.filter((a) => a.status === 'absent'));
    const attended = presentCount + absentCount;
    const attendanceRate = attended ? Math.round((presentCount / attended) * 100) : 0;
    const feesCollected = thisMonth.reduce((s, a) => s + (Number(a.fee_charged) || 0), 0);

    // Absent-streak alerts computed from the attendance already in memory:
    // group by student, walk each student's records newest-first. Replaces an
    // N+1 (one Attendance query per active student) with zero extra queries.
    const attendanceByStudent = new Map();
    for (const a of attendanceAll) {
      const k = String(a.student_id);
      if (!attendanceByStudent.has(k)) attendanceByStudent.set(k, []);
      attendanceByStudent.get(k).push(a);
    }
    const alerts = [];
    for (const s of activeStudents) {
      const recs = (attendanceByStudent.get(String(s.ROWID)) || [])
        .slice()
        .sort((x, y) => String(y.class_date || y.date || '').localeCompare(String(x.class_date || x.date || '')));
      let streak = 0;
      for (const r of recs) { if (r.status === 'absent') streak++; else break; }
      if (streak >= 2) alerts.push({ student_id: s.ROWID, student_name: s.name, consecutive_absences: streak });
    }

    const recent = [...attendanceAll]
      .sort((a, b) => String(b.class_date || '').localeCompare(String(a.class_date || '')))
      .slice(0, 5)
      .map(normalize);
    for (const r of recent) {
      const s = studentById.get(String(r.student_id));
      if (s) r.student_name = s.name;
    }

    const payload = {
      stats: {
        total_active_students:        activeStudents.length,
        total_students:               students.length,
        attendance_rate_this_month:   attendanceRate,
        total_fee_this_month:         feesCollected,
        classes_today:                todayClasses.length,
      },
      upcoming_classes_today: todayClasses,
      today_classes:          todayClasses,
      recent_attendance:      recent,
      absent_alerts:          alerts,
      alerts,
      date:                   todayStr,
    };
    dashboardCache.set(cacheKey, { value: payload, exp: Date.now() + DASHBOARD_CACHE_TTL_MS });
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load dashboard', detail: e.message });
  }
});

// GET /api/dashboard/birthdays?days=30 — org-scoped
router.get('/birthdays', async (req, res) => {
  try {
    const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30));
    const sRows = await zcql(req, `SELECT * FROM Students WHERE Students.org_id = ${Number(req.orgId)}`).catch(() => []);
    const students = unwrap(sRows, 'Students');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayY = today.getFullYear();

    const results = students
      .filter((s) => (s.status === 'active' || !s.status) && s.date_of_birth)
      .map((s) => {
        const dobRaw = String(s.date_of_birth).slice(0, 10);
        const m = dobRaw.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return null;
        const dobYear = parseInt(m[1], 10);
        const dobMonth = parseInt(m[2], 10);
        const dobDay = parseInt(m[3], 10);

        let nextBday = new Date(todayY, dobMonth - 1, dobDay);
        nextBday.setHours(0, 0, 0, 0);
        if (nextBday < today) {
          nextBday = new Date(todayY + 1, dobMonth - 1, dobDay);
          nextBday.setHours(0, 0, 0, 0);
        }
        const daysUntil = Math.round((nextBday - today) / (1000 * 60 * 60 * 24));
        if (daysUntil > days) return null;

        const turningAge = nextBday.getFullYear() - dobYear;
        return {
          student_id: s.ROWID,
          name: s.name,
          parent_name: s.parent_name,
          mobile_number: s.mobile_number,
          date_of_birth: dobRaw,
          days_until: daysUntil,
          next_birthday: nextBday.toISOString().slice(0, 10),
          turning_age: turningAge,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.days_until - b.days_until);

    res.json({ birthdays: results });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch birthdays', detail: e.message });
  }
});

module.exports = router;
