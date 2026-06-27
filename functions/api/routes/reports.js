// /api/reports — read-only aggregations. Org-scoped via resolveOrg.

const router = require('express').Router();
const { getById, zcql, zcqlAll, unwrap, normalize, q } = require('../db/catalystDb');
const { normalizePlan } = require('../lib/plans');

// Detailed reports are a Complete-plan feature. The client hides the tabs for
// other plans, but the API must enforce it too (a Core org could call these
// endpoints directly otherwise). Platform admins bypass for support.
function requireComplete(req, res, next) {
  if (req.isPlatformAdmin) return next();
  if (normalizePlan(req.orgPlan) === 'complete') return next();
  return res.status(402).json({
    error: 'upgrade_required',
    feature: 'detailed_reports',
    plan: normalizePlan(req.orgPlan),
    message: 'Detailed reports are available on the Complete plan.',
  });
}

// Reports run full-table aggregations, so a short in-process cache keeps repeat
// opens (flipping tabs, months, or filters) cheap. Keyed by org + full URL so
// each filter combination is distinct. Warm-container only, like the dashboard
// cache; skipped for platform-admin impersonation and non-200 responses.
const REPORT_CACHE = new Map();
function cacheJson(ttlMs) {
  return (req, res, next) => {
    if (req.isPlatformAdmin) return next();
    const key = `${req.orgId}:${req.originalUrl}`;
    const hit = REPORT_CACHE.get(key);
    if (hit && Date.now() - hit.t < ttlMs) return res.json(hit.body);
    const orig = res.json.bind(res);
    res.json = (body) => {
      try { if (res.statusCode === 200) REPORT_CACHE.set(key, { t: Date.now(), body }); } catch {}
      return orig(body);
    };
    next();
  };
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Attendance is counted by hours, not by sessions: a 2-hour class marked
// present counts as 2 toward present/absent/late totals and the attendance
// rate. `duration_hours` is frozen on each Attendance row at record time;
// legacy rows without it fall back to 1 hour.
const hrs = (a) => Number(a.duration_hours) || 1;
const sumHrs = (arr) => arr.reduce((s, a) => s + hrs(a), 0);

// GET /api/reports/student/:id
router.get('/student/:id', async (req, res) => {
  try {
    const { from, to } = req.query;
    const student = await getById(req, 'Students', req.params.id);
    if (!student || Number(student.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const where = [`Attendance.student_id = ${req.params.id}`, `Attendance.org_id = ${Number(req.orgId)}`];
    if (from) where.push(`Attendance.class_date >= ${q(from)}`);
    if (to) where.push(`Attendance.class_date <= ${q(to)}`);
    const aRows = await zcqlAll(req, `SELECT * FROM Attendance WHERE ${where.join(' AND ')} ORDER BY Attendance.class_date DESC`, 'Attendance');
    const attendance = unwrap(aRows, 'Attendance').map(normalize);

    const present = sumHrs(attendance.filter((a) => a.status === 'present'));
    const absent = sumHrs(attendance.filter((a) => a.status === 'absent'));
    const late = sumHrs(attendance.filter((a) => a.status === 'late'));
    const total = sumHrs(attendance);
    const attendedSlots = present + absent + late;
    const attendance_rate = attendedSlots ? Math.round((present / attendedSlots) * 100) : 0;
    const class_fees_total = attendance.reduce((s, a) => s + (Number(a.fee_charged) || 0), 0);

    const afRows = await zcqlAll(req, `SELECT * FROM AdditionalFees WHERE AdditionalFees.student_id = ${req.params.id} AND AdditionalFees.org_id = ${Number(req.orgId)}`, 'AdditionalFees');
    const additional = unwrap(afRows, 'AdditionalFees').map(normalize);
    const additional_fees_total = additional.reduce((s, a) => s + (Number(a.amount) || 0), 0);

    const byMonth = new Map();
    for (const a of attendance) {
      const d = a.date || a.class_date;
      if (!d) continue;
      const [y, m] = d.split('-').map(Number);
      const key = `${y}-${m}`;
      if (!byMonth.has(key)) byMonth.set(key, { month: m, year: y, month_name: MONTH_NAMES[m - 1], total_classes: 0, present: 0, total_fees: 0 });
      const slot = byMonth.get(key);
      slot.total_classes += hrs(a);
      if (a.status === 'present') slot.present += hrs(a);
      slot.total_fees += Number(a.fee_charged) || 0;
    }
    const monthly_breakdown = Array.from(byMonth.values())
      .map((m) => ({
        ...m,
        attendance_rate: m.total_classes ? Math.round((m.present / m.total_classes) * 100) : 0,
      }))
      .sort((a, b) => a.year - b.year || a.month - b.month);

    res.json({
      student: normalize(student),
      attendance_summary: {
        total_classes: total,
        present_count: present,
        absent_count: absent,
        late_count: late,
        attendance_rate,
      },
      fee_summary: {
        class_fees_total,
        additional_fees_total,
        grand_total: class_fees_total + additional_fees_total,
      },
      monthly_breakdown,
      attendance,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch student report', detail: e.message });
  }
});

// GET /api/reports/monthly/:year/:month
router.get('/monthly/:year/:month', async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    const monthStr = String(month).padStart(2, '0');
    const dateFrom = `${year}-${monthStr}-01`;
    const dateTo = `${year}-${monthStr}-31`;
    const sRows = await zcql(req, `SELECT * FROM Students WHERE Students.org_id = ${Number(req.orgId)}`);
    const students = unwrap(sRows, 'Students');

    // Load attendance for the whole month window and the month's additional
    // fees ONCE for the org, then group in memory by student_id. Replaces an
    // N+1 (two queries per student) with two paginated org-scoped queries.
    const [aRowsAll, afRowsAll] = await Promise.all([
      zcqlAll(req, `SELECT * FROM Attendance WHERE Attendance.class_date >= ${q(dateFrom)} AND Attendance.class_date <= ${q(dateTo)} AND Attendance.org_id = ${Number(req.orgId)}`, 'Attendance').catch(() => []),
      zcqlAll(req, `SELECT * FROM AdditionalFees WHERE AdditionalFees.fee_month = ${month} AND AdditionalFees.fee_year = ${year} AND AdditionalFees.org_id = ${Number(req.orgId)}`, 'AdditionalFees').catch(() => []),
    ]);
    const attendanceByStudent = {};
    for (const a of unwrap(aRowsAll, 'Attendance')) {
      const k = String(a.student_id);
      (attendanceByStudent[k] = attendanceByStudent[k] || []).push(a);
    }
    const additionalTotalByStudent = {};
    for (const af of unwrap(afRowsAll, 'AdditionalFees')) {
      const k = String(af.student_id);
      additionalTotalByStudent[k] = (additionalTotalByStudent[k] || 0) + (Number(af.amount) || 0);
    }

    const rows = [];
    let totalPresent = 0, totalAbsent = 0, totalLate = 0, totalFees = 0, uniqueClassIds = new Set();
    for (const s of students) {
      const sid = String(s.ROWID);
      const attendance = attendanceByStudent[sid] || [];
      const present = sumHrs(attendance.filter((a) => a.status === 'present'));
      const absent = sumHrs(attendance.filter((a) => a.status === 'absent'));
      const late = sumHrs(attendance.filter((a) => a.status === 'late'));
      const tot = present + absent + late;
      const fees = attendance.reduce((sum, a) => sum + (Number(a.fee_charged) || 0), 0);
      const additional = additionalTotalByStudent[sid] || 0;
      totalPresent += present; totalAbsent += absent; totalLate += late; totalFees += fees + additional;
      attendance.forEach((a) => a.class_id && uniqueClassIds.add(a.class_id));
      rows.push({
        student_id: s.ROWID,
        student_name: s.name,
        total_classes: tot,
        present, absent, late,
        attendance_rate: tot ? Math.round((present / tot) * 100) : 0,
        total_fees: fees + additional,
      });
    }
    rows.sort((a, b) => String(a.student_name || '').localeCompare(String(b.student_name || '')));
    const overallSlots = totalPresent + totalAbsent + totalLate;
    res.json({
      year, month,
      overview: {
        unique_students: rows.filter((r) => r.total_classes > 0).length,
        unique_classes: uniqueClassIds.size,
        grand_total_fees: totalFees,
        attendance_rate: overallSlots ? Math.round((totalPresent / overallSlots) * 100) : 0,
      },
      students: rows,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch monthly report', detail: e.message });
  }
});

// GET /api/reports/overall — org-scoped
router.get('/overall', async (req, res) => {
  try {
    const [sRows, aRows, afRows, cRows] = await Promise.all([
      zcql(req, `SELECT * FROM Students WHERE Students.org_id = ${Number(req.orgId)}`).catch(() => []),
      zcqlAll(req, `SELECT * FROM Attendance WHERE Attendance.org_id = ${Number(req.orgId)}`, 'Attendance').catch(() => []),
      zcqlAll(req, `SELECT * FROM AdditionalFees WHERE AdditionalFees.org_id = ${Number(req.orgId)}`, 'AdditionalFees').catch(() => []),
      zcql(req, `SELECT * FROM Classes WHERE Classes.org_id = ${Number(req.orgId)}`).catch(() => []),
    ]);
    const students = unwrap(sRows, 'Students');
    const attendance = unwrap(aRows, 'Attendance');
    const additional = unwrap(afRows, 'AdditionalFees');
    const classes = unwrap(cRows, 'Classes');
    const active = students.filter((s) => s.status !== 'inactive').length;
    const present = attendance.filter((a) => a.status === 'present').length;
    const absent = attendance.filter((a) => a.status === 'absent').length;
    const late = attendance.filter((a) => a.status === 'late').length;
    const slots = present + absent + late;
    const classFees = attendance.reduce((s, a) => s + (Number(a.fee_charged) || 0), 0);
    const additionalTotal = additional.reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const byType = { online: 0, offline: 0, offline_group: 0, online_group: 0 };
    for (const a of attendance) {
      if (byType[a.class_type] !== undefined) byType[a.class_type]++;
    }
    res.json({
      students: { total: students.length, active, inactive: students.length - active },
      classes: { total: classes.length, online_group: byType.online_group, offline_group: byType.offline_group, online: byType.online, offline: byType.offline },
      attendance: {
        total_records: attendance.length,
        present, absent, late,
        overall_rate: slots ? Math.round((present / slots) * 100) : 0,
      },
      fees: { class_fees: classFees, additional: additionalTotal, grand_total: classFees + additionalTotal },
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch overall report', detail: e.message });
  }
});

// ---------------------------------------------------------------------------
// Admin analytics reports. All org-scoped. Optional from/to (YYYY-MM-DD) bound
// Attendance by class_date where it makes sense; sensible defaults otherwise.
// ---------------------------------------------------------------------------

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Attendance rows store the date under `class_date` (the `date` alias is only
// added by normalize()). Raw ZCQL rows expose class_date; we read either.
const attDate = (a) => a.class_date || a.date || '';
// YYYY-MM key from a date or CREATEDTIME string. CREATEDTIME is ISO-ish, so the
// first 10 chars are the YYYY-MM-DD calendar date (see internal.js usage).
const ymOf = (s) => String(s || '').slice(0, 7);
const ymLabel = (ym) => {
  const [y, m] = String(ym).split('-').map(Number);
  return m >= 1 && m <= 12 ? `${MONTH_NAMES[m - 1].slice(0, 3)} ${y}` : ym;
};
// Build the last N calendar months ending with the current month, oldest first.
function lastNMonths(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ ym, label: ymLabel(ym) });
  }
  return out;
}

// GET /api/reports/revenue?months=6&from=&to=
// Monthly revenue trend for the last N months (default 6). class_fees comes
// from Attendance.fee_charged bucketed by class_date month; additional comes
// from AdditionalFees matched on fee_year/fee_month.
router.get('/revenue', requireComplete, cacheJson(60000), async (req, res) => {
  try {
    const n = Math.max(1, Math.min(36, Number(req.query.months) || 6));
    const buckets = lastNMonths(n);
    const valid = new Set(buckets.map((b) => b.ym));
    const acc = new Map(buckets.map((b) => [b.ym, { ym: b.ym, label: b.label, class_fees: 0, additional: 0, total: 0 }]));

    // Bound Attendance to the window: from = first day of earliest bucket
    // unless an explicit from/to is given.
    const { from, to } = req.query;
    const lo = from || `${buckets[0].ym}-01`;
    const hi = to || `${buckets[buckets.length - 1].ym}-31`;
    const aRows = await zcqlAll(
      req,
      `SELECT * FROM Attendance WHERE Attendance.class_date >= ${q(lo)} AND Attendance.class_date <= ${q(hi)} AND Attendance.org_id = ${Number(req.orgId)}`,
      'Attendance',
    ).catch(() => []);
    for (const a of unwrap(aRows, 'Attendance')) {
      const ym = ymOf(attDate(a));
      const slot = acc.get(ym);
      if (slot) slot.class_fees += Number(a.fee_charged) || 0;
    }

    const afRows = await zcqlAll(
      req,
      `SELECT * FROM AdditionalFees WHERE AdditionalFees.org_id = ${Number(req.orgId)}`,
      'AdditionalFees',
    ).catch(() => []);
    for (const af of unwrap(afRows, 'AdditionalFees')) {
      const ym = `${Number(af.fee_year)}-${String(Number(af.fee_month)).padStart(2, '0')}`;
      const slot = acc.get(ym);
      if (slot) slot.additional += Number(af.amount) || 0;
    }

    const months = buckets.map((b) => {
      const s = acc.get(b.ym);
      s.total = s.class_fees + s.additional;
      return s;
    });
    const totals = months.reduce(
      (t, m) => ({ class_fees: t.class_fees + m.class_fees, additional: t.additional + m.additional, total: t.total + m.total }),
      { class_fees: 0, additional: 0, total: 0 },
    );
    res.json({ months, totals });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch revenue report', detail: e.message });
  }
});

// GET /api/reports/defaulters?month=YYYY-MM
// Veena has no payments-vs-due ledger here, so "defaulters" lists every active
// student with a positive computed fee for the month: the current best signal
// of who owes money. Expected fee = Students.monthly_fee when set, else the
// student's summed Attendance.fee_charged for the month, plus their
// AdditionalFees for that month.
router.get('/defaulters', requireComplete, cacheJson(60000), async (req, res) => {
  try {
    const now = new Date();
    const ym = /^\d{4}-\d{2}$/.test(String(req.query.month || ''))
      ? req.query.month
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [yStr, mStr] = ym.split('-');
    const year = Number(yStr);
    const month = Number(mStr);
    const dateFrom = `${ym}-01`;
    const dateTo = `${ym}-31`;

    const sRows = await zcql(req, `SELECT * FROM Students WHERE Students.org_id = ${Number(req.orgId)}`).catch(() => []);
    const students = unwrap(sRows, 'Students');

    const [aRows, afRows] = await Promise.all([
      zcqlAll(req, `SELECT * FROM Attendance WHERE Attendance.class_date >= ${q(dateFrom)} AND Attendance.class_date <= ${q(dateTo)} AND Attendance.org_id = ${Number(req.orgId)}`, 'Attendance').catch(() => []),
      zcqlAll(req, `SELECT * FROM AdditionalFees WHERE AdditionalFees.fee_month = ${month} AND AdditionalFees.fee_year = ${year} AND AdditionalFees.org_id = ${Number(req.orgId)}`, 'AdditionalFees').catch(() => []),
    ]);
    const classFeesByStudent = {};
    for (const a of unwrap(aRows, 'Attendance')) {
      const k = String(a.student_id);
      classFeesByStudent[k] = (classFeesByStudent[k] || 0) + (Number(a.fee_charged) || 0);
    }
    const additionalByStudent = {};
    for (const af of unwrap(afRows, 'AdditionalFees')) {
      const k = String(af.student_id);
      additionalByStudent[k] = (additionalByStudent[k] || 0) + (Number(af.amount) || 0);
    }

    const defaulters = [];
    let total_due = 0;
    for (const s of students) {
      if (String(s.status || '').toLowerCase() === 'inactive') continue;
      const sid = String(s.ROWID);
      const monthly = Number(s.monthly_fee) || 0;
      const base = monthly > 0 ? monthly : (classFeesByStudent[sid] || 0);
      const due = base + (additionalByStudent[sid] || 0);
      if (due > 0) {
        defaulters.push({ student_id: s.ROWID, name: s.name, due });
        total_due += due;
      }
    }
    defaulters.sort((a, b) => b.due - a.due);
    res.json({ month: ym, defaulters, total_due, count: defaulters.length });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch defaulters report', detail: e.message });
  }
});

// GET /api/reports/retention
// Active/inactive split plus joins-by-month (last 12 months from CREATEDTIME).
router.get('/retention', requireComplete, cacheJson(60000), async (req, res) => {
  try {
    const sRows = await zcqlAll(req, `SELECT * FROM Students WHERE Students.org_id = ${Number(req.orgId)}`, 'Students').catch(() => []);
    const students = unwrap(sRows, 'Students');
    const inactive = students.filter((s) => String(s.status || '').toLowerCase() === 'inactive').length;
    const active = students.length - inactive;

    const buckets = lastNMonths(12);
    const acc = new Map(buckets.map((b) => [b.ym, { ym: b.ym, label: b.label, count: 0 }]));
    for (const s of students) {
      const ym = ymOf(s.CREATEDTIME || s.created_at);
      const slot = acc.get(ym);
      if (slot) slot.count += 1;
    }
    const joins_by_month = buckets.map((b) => acc.get(b.ym));
    res.json({
      active,
      inactive,
      total: students.length,
      joins_by_month,
      churn: { inactive },
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch retention report', detail: e.message });
  }
});

// GET /api/reports/attendance-slots?from=&to=
// Attendance distribution by weekday and by class. Weekday is derived from
// class_date. Many Attendance rows carry a class_id; when one is missing we
// fall back to grouping that row under its class_type so nothing is dropped.
router.get('/attendance-slots', requireComplete, cacheJson(60000), async (req, res) => {
  try {
    const { from, to } = req.query;
    const where = [`Attendance.org_id = ${Number(req.orgId)}`];
    if (from) where.push(`Attendance.class_date >= ${q(from)}`);
    if (to) where.push(`Attendance.class_date <= ${q(to)}`);
    const aRows = await zcqlAll(req, `SELECT * FROM Attendance WHERE ${where.join(' AND ')}`, 'Attendance').catch(() => []);
    const attendance = unwrap(aRows, 'Attendance');

    // Map class_id -> class name (org-scoped) so by_class is human readable.
    const cRows = await zcql(req, `SELECT ROWID, name, class_type FROM Classes WHERE Classes.org_id = ${Number(req.orgId)}`).catch(() => []);
    const classMeta = new Map();
    for (const c of unwrap(cRows, 'Classes')) classMeta.set(String(c.ROWID), { name: c.name, class_type: c.class_type });

    const blank = () => ({ present: 0, absent: 0, late: 0 });
    const byDay = DAY_ABBR.map(() => blank());
    const byClass = new Map();

    for (const a of attendance) {
      const status = a.status === 'present' || a.status === 'absent' || a.status === 'late' ? a.status : null;
      if (!status) continue;
      const d = attDate(a);
      if (d) {
        const dow = new Date(`${d}T00:00:00`).getDay();
        if (dow >= 0 && dow <= 6) byDay[dow][status] += 1;
      }
      // Group by class_id when present, else by class_type so no row is lost.
      const cid = a.class_id ? String(a.class_id) : null;
      const key = cid || `type:${a.class_type || 'unknown'}`;
      if (!byClass.has(key)) {
        const meta = cid ? classMeta.get(cid) : null;
        byClass.set(key, {
          class_id: cid,
          name: meta ? meta.name : `Type: ${a.class_type || 'unknown'}`,
          ...blank(),
        });
      }
      byClass.get(key)[status] += 1;
    }

    const rate = (o) => {
      const denom = o.present + o.absent + o.late;
      return denom ? Math.round((o.present / denom) * 100) : 0;
    };
    const by_day = DAY_ABBR.map((day, i) => ({ day, ...byDay[i], rate: rate(byDay[i]) }));
    const by_class = Array.from(byClass.values())
      .map((c) => ({ ...c, rate: rate(c) }))
      .sort((a, b) => (b.present + b.absent + b.late) - (a.present + a.absent + a.late));
    res.json({ by_day, by_class });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch attendance slots report', detail: e.message });
  }
});

// GET /api/reports/course-completion
// Per course: lessons_total, enrolled count, average completed lessons, and a
// completion_rate (avg_completed / lessons_total).
router.get('/course-completion', requireComplete, cacheJson(60000), async (req, res) => {
  try {
    const [courseRows, lessonRows, enrollRows] = await Promise.all([
      zcqlAll(req, `SELECT ROWID, name FROM Courses WHERE Courses.org_id = ${Number(req.orgId)}`, 'Courses').catch(() => []),
      zcqlAll(req, `SELECT ROWID, course_id FROM Lessons WHERE Lessons.org_id = ${Number(req.orgId)}`, 'Lessons').catch(() => []),
      zcqlAll(req, `SELECT ROWID, course_id, completed_count FROM CourseEnrollments WHERE CourseEnrollments.org_id = ${Number(req.orgId)}`, 'CourseEnrollments').catch(() => []),
    ]);
    const courses = unwrap(courseRows, 'Courses');
    const lessons = unwrap(lessonRows, 'Lessons');
    const enrollments = unwrap(enrollRows, 'CourseEnrollments');

    const lessonsByCourse = new Map();
    for (const l of lessons) {
      const k = String(l.course_id);
      lessonsByCourse.set(k, (lessonsByCourse.get(k) || 0) + 1);
    }
    const enrollByCourse = new Map();
    for (const e of enrollments) {
      const k = String(e.course_id);
      if (!enrollByCourse.has(k)) enrollByCourse.set(k, { count: 0, completedSum: 0 });
      const slot = enrollByCourse.get(k);
      slot.count += 1;
      slot.completedSum += Number(e.completed_count) || 0;
    }

    const out = courses.map((c) => {
      const k = String(c.ROWID);
      const lessons_total = lessonsByCourse.get(k) || 0;
      const en = enrollByCourse.get(k) || { count: 0, completedSum: 0 };
      const enrolled = en.count;
      const avg_completed = enrolled ? Math.round((en.completedSum / enrolled) * 10) / 10 : 0;
      const completion_rate = lessons_total ? Math.round((avg_completed / lessons_total) * 100) : 0;
      return { course_id: c.ROWID, name: c.name, lessons_total, enrolled, avg_completed, completion_rate };
    });
    res.json({ courses: out });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch course completion report', detail: e.message });
  }
});

// GET /api/reports/capacity?from=&to=
// Per active class utilisation. roster = unique students in the class (direct
// student_id + group members via GroupStudents + ClassStudents links, mirroring
// the roster pattern in classes.js). attended_avg = average present count per
// distinct session date for that class. utilisation = attended_avg / roster.
router.get('/capacity', requireComplete, cacheJson(60000), async (req, res) => {
  try {
    const { from, to } = req.query;
    const cRows = await zcql(req, `SELECT * FROM Classes WHERE Classes.is_active = 1 AND Classes.org_id = ${Number(req.orgId)}`).catch(() => []);
    const classes = unwrap(cRows, 'Classes');

    // Load all roster links once (org-scoped) instead of per-class N+1.
    const [classLinkRows, groupLinkRows] = await Promise.all([
      zcqlAll(req, `SELECT class_id, student_id FROM ClassStudents WHERE ClassStudents.org_id = ${Number(req.orgId)}`, 'ClassStudents').catch(() => []),
      zcqlAll(req, `SELECT group_id, student_id FROM GroupStudents WHERE GroupStudents.org_id = ${Number(req.orgId)}`, 'GroupStudents').catch(() => []),
    ]);
    const classLinks = new Map();
    for (const l of unwrap(classLinkRows, 'ClassStudents')) {
      if (!l.student_id) continue;
      const k = String(l.class_id);
      if (!classLinks.has(k)) classLinks.set(k, new Set());
      classLinks.get(k).add(String(l.student_id));
    }
    const groupMembers = new Map();
    for (const g of unwrap(groupLinkRows, 'GroupStudents')) {
      if (!g.student_id) continue;
      const k = String(g.group_id);
      if (!groupMembers.has(k)) groupMembers.set(k, new Set());
      groupMembers.get(k).add(String(g.student_id));
    }

    // Attendance for the window, grouped by class_id.
    const aWhere = [`Attendance.org_id = ${Number(req.orgId)}`];
    if (from) aWhere.push(`Attendance.class_date >= ${q(from)}`);
    if (to) aWhere.push(`Attendance.class_date <= ${q(to)}`);
    const aRows = await zcqlAll(req, `SELECT * FROM Attendance WHERE ${aWhere.join(' AND ')}`, 'Attendance').catch(() => []);
    const attByClass = new Map();
    for (const a of unwrap(aRows, 'Attendance')) {
      if (!a.class_id) continue; // capacity is per class; rows without a class id cannot be attributed
      const k = String(a.class_id);
      if (!attByClass.has(k)) attByClass.set(k, []);
      attByClass.get(k).push(a);
    }

    const out = classes.map((c) => {
      const cid = String(c.ROWID);
      const ids = new Set();
      if (c.student_id) ids.add(String(c.student_id));
      if (c.group_id && groupMembers.has(String(c.group_id))) {
        for (const sid of groupMembers.get(String(c.group_id))) ids.add(sid);
      }
      if (classLinks.has(cid)) for (const sid of classLinks.get(cid)) ids.add(sid);
      const roster = ids.size;

      // attended_avg: average present rows per distinct session date.
      const rows = attByClass.get(cid) || [];
      const sessions = new Map();
      for (const a of rows) {
        const d = attDate(a);
        if (!d) continue;
        if (!sessions.has(d)) sessions.set(d, 0);
        if (a.status === 'present') sessions.set(d, sessions.get(d) + 1);
      }
      const sessionCount = sessions.size;
      const presentTotal = Array.from(sessions.values()).reduce((s, n) => s + n, 0);
      const attended_avg = sessionCount ? Math.round((presentTotal / sessionCount) * 10) / 10 : 0;
      const utilisation = roster ? Math.round((attended_avg / roster) * 100) : 0;

      return {
        class_id: c.ROWID,
        name: c.name,
        day: Number.isInteger(Number(c.day_of_week)) ? DAYS[Number(c.day_of_week)] : null,
        roster,
        attended_avg,
        utilisation,
      };
    });
    res.json({ classes: out });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch capacity report', detail: e.message });
  }
});

// GET /api/reports/student-statement/:id?month=YYYY-MM
// One student's combined monthly statement: attendance, fees, and lesson
// progress. fees.class_fees uses summed Attendance.fee_charged for the month
// (per-class billing); see fees.js for the per_month flat-fee alternative.
router.get('/student-statement/:id', requireComplete, cacheJson(60000), async (req, res) => {
  try {
    const student = await getById(req, 'Students', req.params.id);
    if (!student || Number(student.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const now = new Date();
    const ym = /^\d{4}-\d{2}$/.test(String(req.query.month || ''))
      ? req.query.month
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [yStr, mStr] = ym.split('-');
    const year = Number(yStr);
    const month = Number(mStr);
    const dateFrom = `${ym}-01`;
    const dateTo = `${ym}-31`;

    const [aRows, afRows, enRows] = await Promise.all([
      zcqlAll(req, `SELECT * FROM Attendance WHERE Attendance.student_id = ${req.params.id} AND Attendance.class_date >= ${q(dateFrom)} AND Attendance.class_date <= ${q(dateTo)} AND Attendance.org_id = ${Number(req.orgId)}`, 'Attendance').catch(() => []),
      zcqlAll(req, `SELECT * FROM AdditionalFees WHERE AdditionalFees.student_id = ${req.params.id} AND AdditionalFees.fee_month = ${month} AND AdditionalFees.fee_year = ${year} AND AdditionalFees.org_id = ${Number(req.orgId)}`, 'AdditionalFees').catch(() => []),
      zcqlAll(req, `SELECT * FROM CourseEnrollments WHERE CourseEnrollments.student_id = ${req.params.id} AND CourseEnrollments.org_id = ${Number(req.orgId)}`, 'CourseEnrollments').catch(() => []),
    ]);
    const attendance = unwrap(aRows, 'Attendance');
    const additionalRows = unwrap(afRows, 'AdditionalFees');
    const enrollments = unwrap(enRows, 'CourseEnrollments');

    const present = sumHrs(attendance.filter((a) => a.status === 'present'));
    const absent = sumHrs(attendance.filter((a) => a.status === 'absent'));
    const late = sumHrs(attendance.filter((a) => a.status === 'late'));
    const slots = present + absent + late;
    const rate = slots ? Math.round((present / slots) * 100) : 0;

    const class_fees = attendance.reduce((s, a) => s + (Number(a.fee_charged) || 0), 0);
    const additional = additionalRows.reduce((s, a) => s + (Number(a.amount) || 0), 0);

    const enrolled = enrollments.length;
    const completed = enrollments.reduce((s, e) => s + (Number(e.completed_count) || 0), 0);

    res.json({
      student: { id: student.ROWID, name: student.name },
      month: ym,
      attendance: { present, absent, late, rate },
      fees: { class_fees, additional, total: class_fees + additional },
      lessons: { enrolled, completed },
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch student statement', detail: e.message });
  }
});

module.exports = router;
