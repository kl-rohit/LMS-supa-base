// /api/portal/* — Read-only endpoints for parents.
// All requests go through requireAuth + requireParent → req.studentId is set.
// Every query is scoped to that student_id — no cross-student access.

const router = require('express').Router();
const { getById, zcql, unwrap, normalize, q, safeId } = require('../db/catalystDb');

// GET /api/portal/me — info about the linked student
router.get('/me', async (req, res) => {
  try {
    const student = await getById(req, 'Students', req.studentId);
    if (!student) return res.status(404).json({ error: 'Linked student not found' });
    res.json({
      student: normalize(student),
      login: {
        email: req.studentLogin?.email,
        user_id: req.studentLogin?.user_id,
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch student', detail: e.message });
  }
});

// GET /api/portal/attendance?month=YYYY-MM
// Returns class history scoped to the linked student.
router.get('/attendance', async (req, res) => {
  try {
    const { month } = req.query;
    const sid = safeId(req.studentId);
    if (!sid) return res.status(400).json({ error: 'Invalid student id on session' });
    let where = `Attendance.student_id = ${sid}`;
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      where += ` AND Attendance.class_date >= ${q(`${month}-01`)} AND Attendance.class_date <= ${q(`${month}-31`)}`;
    }
    const rows = await zcql(req, `SELECT * FROM Attendance WHERE ${where} ORDER BY Attendance.class_date DESC`);
    // Decorate with class_name
    const records = await Promise.all(unwrap(rows, 'Attendance').map(async (a) => {
      const out = normalize(a);
      if (a.class_id) {
        try { const c = await getById(req, 'Classes', a.class_id); if (c) out.class_name = c.name; } catch {}
      }
      return out;
    }));
    res.json({ attendance: records });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch attendance', detail: e.message });
  }
});

// GET /api/portal/fees?month=YYYY-MM
// Returns class fees + additional fees + discounts for the month (and YTD summary).
router.get('/fees', async (req, res) => {
  try {
    const sid = safeId(req.studentId);
    if (!sid) return res.status(400).json({ error: 'Invalid student id on session' });
    const { month } = req.query;
    let monthClause = '';
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      monthClause = ` AND Attendance.class_date >= ${q(`${month}-01`)} AND Attendance.class_date <= ${q(`${month}-31`)}`;
    }
    // Class fees (from attendance) for the requested month (or all-time)
    const attRows = await zcql(req, `SELECT * FROM Attendance WHERE Attendance.student_id = ${sid}${monthClause}`);
    const attendance = unwrap(attRows, 'Attendance');
    const classFees = attendance.reduce((s, a) => s + (Number(a.fee_charged) || 0), 0);

    // Additional fees + discounts
    let addFilter = '';
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [y, m] = month.split('-');
      addFilter = ` AND AdditionalFees.fee_year = ${parseInt(y, 10)} AND AdditionalFees.fee_month = ${parseInt(m, 10)}`;
    }
    const afRows = await zcql(req, `SELECT * FROM AdditionalFees WHERE AdditionalFees.student_id = ${sid}${addFilter}`);
    const additional = unwrap(afRows, 'AdditionalFees');
    const positiveAdditional = additional.reduce((s, a) => s + Math.max(0, Number(a.amount) || 0), 0);
    const discountTotal = additional.reduce((s, a) => s + Math.min(0, Number(a.amount) || 0), 0); // negative

    const total = classFees + positiveAdditional + discountTotal;
    res.json({
      month: month || null,
      class_fees: classFees,
      additional_fees: positiveAdditional,
      discount: Math.abs(discountTotal),
      total,
      classes_attended: attendance.filter((a) => a.status === 'present' || a.status === 'late').length,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch fees', detail: e.message });
  }
});

// GET /api/portal/recordings — every attendance row that has a recording_url
router.get('/recordings', async (req, res) => {
  try {
    const sid = safeId(req.studentId);
    if (!sid) return res.status(400).json({ error: 'Invalid student id on session' });
    const rows = await zcql(
      req,
      `SELECT * FROM Attendance WHERE Attendance.student_id = ${sid} ORDER BY Attendance.class_date DESC`
    );
    const list = unwrap(rows, 'Attendance')
      .map(normalize)
      .filter((a) => a.recording_url && a.recording_url.trim() !== '');
    res.json({ recordings: list });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch recordings', detail: e.message });
  }
});

module.exports = router;
