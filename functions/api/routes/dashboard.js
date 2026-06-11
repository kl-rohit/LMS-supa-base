// /api/dashboard — aggregated stats for the home screen.

const router = require('express').Router();
const { getById, getAll, zcql, unwrap, normalize, q } = require('../db/catalystDb');

router.get('/', async (req, res) => {
  try {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const dow = today.getDay();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;
    const monthStr = String(month).padStart(2, '0');
    const dateFrom = `${year}-${monthStr}-01`;
    const dateTo = `${year}-${monthStr}-31`;

    // Pull everything in parallel
    const [students, classes, attendanceAll] = await Promise.all([
      getAll(req, 'Students').catch(() => []),
      getAll(req, 'Classes').catch(() => []),
      getAll(req, 'Attendance').catch(() => []),
    ]);

    const activeStudents = students.filter((s) => s.status === 'active' || !s.status);

    // Today's classes (filter by day_of_week)
    const todayClasses = classes
      .filter((c) => Number(c.day_of_week) === dow && (c.is_active === undefined || Number(c.is_active) === 1))
      .map(normalize);

    // Attach student/group names to today's classes
    for (const c of todayClasses) {
      if (c.student_id) {
        try { const s = await getById(req, 'Students', c.student_id); if (s) c.student_name = s.name; } catch {}
      }
      if (c.group_id) {
        try { const g = await getById(req, 'Groups', c.group_id); if (g) c.group_name = g.name; } catch {}
      }
    }
    todayClasses.sort((a, b) => String(a.start_time || '').localeCompare(b.start_time || ''));

    // This month's attendance + fees
    const thisMonth = attendanceAll.filter((a) => {
      const d = a.class_date || a.date;
      return d && d >= dateFrom && d <= dateTo;
    });
    const presentCount = thisMonth.filter((a) => a.status === 'present').length;
    const absentCount = thisMonth.filter((a) => a.status === 'absent').length;
    const attended = presentCount + absentCount;
    const attendanceRate = attended ? Math.round((presentCount / attended) * 100) : 0;
    const feesCollected = thisMonth.reduce((s, a) => s + (Number(a.fee_charged) || 0), 0);

    // Absence alerts (≥3 consecutive)
    const alerts = [];
    for (const s of activeStudents) {
      try {
        const aRows = await zcql(req, `SELECT * FROM Attendance WHERE Attendance.student_id = ${s.ROWID} ORDER BY Attendance.class_date DESC`);
        const recs = unwrap(aRows, 'Attendance');
        let streak = 0;
        for (const r of recs) { if (r.status === 'absent') streak++; else break; }
        if (streak >= 2) alerts.push({ student_id: s.ROWID, student_name: s.name, consecutive_absences: streak });
      } catch {}
    }

    // Recent attendance (last 5)
    const recent = [...attendanceAll]
      .sort((a, b) => String(b.class_date || '').localeCompare(String(a.class_date || '')))
      .slice(0, 5)
      .map(normalize);
    for (const r of recent) {
      try { const s = await getById(req, 'Students', r.student_id); if (s) r.student_name = s.name; } catch {}
    }

    // Frontend (Dashboard.jsx) reads these specific keys:
    //   data.stats.total_active_students
    //   data.stats.attendance_rate_this_month
    //   data.stats.total_fee_this_month
    //   data.upcoming_classes_today
    //   data.recent_attendance
    //   data.absent_alerts
    res.json({
      stats: {
        total_active_students:        activeStudents.length,
        total_students:               students.length,
        attendance_rate_this_month:   attendanceRate,
        total_fee_this_month:         feesCollected,
        classes_today:                todayClasses.length,
      },
      upcoming_classes_today: todayClasses,
      today_classes:          todayClasses,   // backward compat
      recent_attendance:      recent,
      absent_alerts:          alerts,
      alerts,                                 // backward compat
      date:                   todayStr,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load dashboard', detail: e.message });
  }
});

// GET /api/dashboard/birthdays?days=30
// Returns students whose birthday (month + day, ignoring year) falls in the
// next N days from today. Sorted by days-until-birthday ascending.
router.get('/birthdays', async (req, res) => {
  try {
    const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30));
    const students = await getAll(req, 'Students').catch(() => []);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayY = today.getFullYear();

    const results = students
      .filter((s) => (s.status === 'active' || !s.status) && s.date_of_birth)
      .map((s) => {
        // Parse YYYY-MM-DD (Catalyst Date column is stored as ISO string)
        const dobRaw = String(s.date_of_birth).slice(0, 10);
        const m = dobRaw.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return null;
        const dobYear = parseInt(m[1], 10);
        const dobMonth = parseInt(m[2], 10);
        const dobDay = parseInt(m[3], 10);

        // Next birthday: this year if upcoming, else next year
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
