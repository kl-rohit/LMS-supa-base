// /api/reports — read-only aggregations. Org-scoped via resolveOrg.

const router = require('express').Router();
const { getById, zcql, zcqlAll, unwrap, normalize, q } = require('../db/catalystDb');

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

module.exports = router;
