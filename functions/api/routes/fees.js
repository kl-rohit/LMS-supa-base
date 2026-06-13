// /api/fees — monthly aggregation + AdditionalFees CRUD + Payments.
// Org-scoped via middleware/org.resolveOrg.

const router = require('express').Router();
const { insert, getById, update, remove, zcql, zcqlAll, unwrap, normalize, q, safeId } = require('../db/catalystDb');

// GET /api/fees/monthly/:year/:month
router.get('/monthly/:year/:month', async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    const monthStr = String(month).padStart(2, '0');
    const dateFrom = `${year}-${monthStr}-01`;
    const dateTo = `${year}-${monthStr}-31`;
    const studentRows = await zcql(req, `SELECT * FROM Students WHERE Students.org_id = ${Number(req.orgId)}`);
    const students = unwrap(studentRows, 'Students');

    // Payments for this month/year, scoped to org.
    let paymentsByStudent = {};
    try {
      const pRows = await zcql(req, `SELECT * FROM Payments WHERE Payments.fee_month = ${month} AND Payments.fee_year = ${year} AND Payments.org_id = ${Number(req.orgId)}`);
      for (const p of unwrap(pRows, 'Payments')) {
        paymentsByStudent[String(p.student_id)] = normalize(p);
      }
    } catch {}

    const results = [];
    for (const s of students) {
      try {
        const aRows = await zcql(req, `SELECT * FROM Attendance WHERE Attendance.student_id = ${s.ROWID} AND Attendance.class_date >= ${q(dateFrom)} AND Attendance.class_date <= ${q(dateTo)} AND Attendance.org_id = ${Number(req.orgId)}`);
        const attendance = unwrap(aRows, 'Attendance');
        const presentCount = attendance.filter((a) => a.status === 'present').length;
        const lateCount    = attendance.filter((a) => a.status === 'late').length;
        const absentCount  = attendance.filter((a) => a.status === 'absent').length;
        const attended = attendance.filter((a) => a.status === 'present' || a.status === 'late');
        const classFees = attended.reduce((sum, a) => sum + (Number(a.fee_charged) || 0), 0);
        const afRows = await zcql(req, `SELECT * FROM AdditionalFees WHERE AdditionalFees.student_id = ${s.ROWID} AND AdditionalFees.fee_month = ${month} AND AdditionalFees.fee_year = ${year} AND AdditionalFees.org_id = ${Number(req.orgId)}`);
        const additional = unwrap(afRows, 'AdditionalFees');
        const additionalTotal = additional.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
        const grandTotal = classFees + additionalTotal;
        const payment = paymentsByStudent[String(s.ROWID)];

        const minClasses = Number(s.min_classes_per_month) || 0;
        const attendedCount = presentCount + lateCount;
        let shortfallAmount = 0;
        let shortfallClasses = 0;
        if (minClasses > 0 && attendedCount < minClasses) {
          shortfallClasses = minClasses - attendedCount;
          const avgFee = attendedCount > 0
            ? classFees / attendedCount
            : Number(s.fee_offline_group) || Number(s.fee_offline) || Number(s.fee_online) || 0;
          shortfallAmount = Math.round(avgFee * shortfallClasses);
        }

        results.push({
          student_id: s.ROWID,
          student_name: s.name,
          min_classes: minClasses,
          shortfall_classes: shortfallClasses,
          shortfall_amount: shortfallAmount,
          class_fees: {
            total_classes: attended.length,
            present: presentCount,
            late: lateCount,
            absent: absentCount,
            total_marked: presentCount + lateCount + absentCount,
            total: classFees,
          },
          additional_fees: { count: additional.length, total: additionalTotal },
          grand_total: grandTotal,
          paid: !!payment,
          payment: payment || null,
        });
      } catch {}
    }
    results.sort((a, b) => String(a.student_name || '').localeCompare(String(b.student_name || '')));
    res.json({ students: results });
  } catch (e) {
    res.status(500).json({ error: 'Failed to compute monthly fees', detail: e.message });
  }
});

// GET /api/fees/payments
router.get('/payments', async (req, res) => {
  try {
    const { month, year, student_id } = req.query;
    const where = [`Payments.org_id = ${Number(req.orgId)}`];
    if (month) where.push(`Payments.fee_month = ${parseInt(month)}`);
    if (year) where.push(`Payments.fee_year = ${parseInt(year)}`);
    const psid = safeId(student_id);
    if (psid) where.push(`Payments.student_id = ${psid}`);
    const sql = `SELECT * FROM Payments WHERE ${where.join(' AND ')} ORDER BY Payments.payment_date DESC`;
    const rows = unwrap(await zcql(req, sql), 'Payments').map(normalize);
    const decorated = await Promise.all(rows.map(async (r) => {
      try { const s = await getById(req, 'Students', r.student_id); if (s && Number(s.org_id) === Number(req.orgId)) r.student_name = s.name; } catch {}
      return r;
    }));
    res.json({ payments: decorated });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch payments', detail: e.message });
  }
});

// POST /api/fees/payments
router.post('/payments', async (req, res) => {
  try {
    const student_id = req.body.student_id;
    const fee_month = parseInt(req.body.fee_month || req.body.month);
    const fee_year = parseInt(req.body.fee_year || req.body.year);
    const paid_amount = Number(req.body.paid_amount || req.body.amount);
    const payment_date = req.body.payment_date || new Date().toISOString().slice(0, 10);
    if (!student_id || !fee_month || !fee_year || !Number.isFinite(paid_amount)) {
      return res.status(400).json({ error: 'student_id, fee_month, fee_year, paid_amount required' });
    }
    // Verify student is in caller's org.
    const stu = await getById(req, 'Students', student_id);
    if (!stu || Number(stu.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Student not found' });
    }
    // Dup check, org-scoped.
    const existing = await zcql(
      req,
      `SELECT ROWID FROM Payments WHERE Payments.student_id = ${student_id} AND Payments.fee_month = ${fee_month} AND Payments.fee_year = ${fee_year} AND Payments.org_id = ${Number(req.orgId)}`
    );
    const dup = unwrap(existing, 'Payments');
    if (dup.length) {
      return res.status(409).json({ error: 'Already marked paid for this student/month', payment_id: dup[0].ROWID });
    }
    const row = await insert(req, 'Payments', {
      student_id: String(student_id),
      fee_month,
      fee_year,
      paid_amount,
      payment_date,
      notes: req.body.notes || '',
      org_id: Number(req.orgId),
    });
    res.status(201).json({ payment: normalize(row) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to record payment', detail: e.message });
  }
});

// DELETE /api/fees/payments/:id
router.delete('/payments/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Payments', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    await remove(req, 'Payments', req.params.id);
    res.json({ message: 'Payment deleted' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete payment', detail: e.message });
  }
});

// GET /api/fees/student/:id
router.get('/student/:id', async (req, res) => {
  try {
    const { from, to } = req.query;
    const where = [`Attendance.student_id = ${req.params.id}`, `Attendance.org_id = ${Number(req.orgId)}`];
    if (from) where.push(`Attendance.class_date >= ${q(from)}`);
    if (to) where.push(`Attendance.class_date <= ${q(to)}`);
    const aRows = await zcqlAll(req, `SELECT * FROM Attendance WHERE ${where.join(' AND ')} ORDER BY Attendance.class_date DESC`, 'Attendance');
    const attendance = unwrap(aRows, 'Attendance').map(normalize);
    const total = attendance.reduce((sum, a) => sum + (Number(a.fee_charged) || 0), 0);
    res.json({ attendance, total });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch student fees', detail: e.message });
  }
});

// GET /api/fees/overall — org-scoped totals
router.get('/overall', async (req, res) => {
  try {
    const aRows = await zcqlAll(req, `SELECT * FROM Attendance WHERE Attendance.org_id = ${Number(req.orgId)}`, 'Attendance');
    const afRows = await zcqlAll(req, `SELECT * FROM AdditionalFees WHERE AdditionalFees.org_id = ${Number(req.orgId)}`, 'AdditionalFees');
    const att = unwrap(aRows, 'Attendance');
    const adf = unwrap(afRows, 'AdditionalFees');
    const classTotal = att.reduce((s, a) => s + (Number(a.fee_charged) || 0), 0);
    const addTotal = adf.reduce((s, a) => s + (Number(a.amount) || 0), 0);
    res.json({ class_fees_total: classTotal, additional_fees_total: addTotal, grand_total: classTotal + addTotal });
  } catch (e) {
    res.status(500).json({ error: 'Failed to compute overall fees', detail: e.message });
  }
});

// GET /api/fees/additional
router.get('/additional', async (req, res) => {
  try {
    const { month, year, student_id } = req.query;
    const where = [`AdditionalFees.org_id = ${Number(req.orgId)}`];
    if (month) where.push(`AdditionalFees.fee_month = ${parseInt(month)}`);
    if (year) where.push(`AdditionalFees.fee_year = ${parseInt(year)}`);
    const asid = safeId(student_id);
    if (asid) where.push(`AdditionalFees.student_id = ${asid}`);
    const sql = `SELECT * FROM AdditionalFees WHERE ${where.join(' AND ')} ORDER BY AdditionalFees.fee_date DESC`;
    const rows = unwrap(await zcql(req, sql), 'AdditionalFees');
    const decorated = await Promise.all(rows.map(async (r) => {
      const out = normalize(r);
      try { const s = await getById(req, 'Students', r.student_id); if (s && Number(s.org_id) === Number(req.orgId)) out.student_name = s.name; } catch {}
      return out;
    }));
    res.json({ additional_fees: decorated });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch additional fees', detail: e.message });
  }
});

// POST /api/fees/additional
router.post('/additional', async (req, res) => {
  try {
    const { student_id, student_ids, description, amount, fee_date, month, year } = req.body;
    const ids = Array.isArray(student_ids) && student_ids.length ? student_ids : student_id ? [student_id] : [];
    if (!ids.length || !description || amount === undefined || !fee_date || !month || !year) {
      return res.status(400).json({ error: 'student_ids[]/student_id, description, amount, fee_date, month, year required' });
    }
    const created = [];
    for (const sid of ids) {
      try {
        // Verify student belongs to caller's org.
        const s = await getById(req, 'Students', String(sid));
        if (!s || Number(s.org_id) !== Number(req.orgId)) continue;
        const row = await insert(req, 'AdditionalFees', {
          student_id: String(sid),
          description, amount: Number(amount),
          fee_date,
          fee_month: parseInt(month),
          fee_year: parseInt(year),
          org_id: Number(req.orgId),
        });
        created.push(normalize(row));
      } catch (err) {
        console.error('additional fee insert failed', err.message);
      }
    }
    if (created.length === 1) return res.status(201).json({ additional_fee: created[0] });
    res.status(201).json({ message: `Created ${created.length} additional fee(s)`, additional_fees: created });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create additional fee', detail: e.message });
  }
});

// PUT /api/fees/additional/:id
router.put('/additional/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'AdditionalFees', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Additional fee not found' });
    }
    const patch = {};
    if (req.body.description !== undefined) patch.description = req.body.description;
    if (req.body.amount !== undefined)      patch.amount = Number(req.body.amount);
    if (req.body.fee_date !== undefined)    patch.fee_date = req.body.fee_date;
    if (req.body.month !== undefined)       patch.fee_month = parseInt(req.body.month);
    if (req.body.year !== undefined)        patch.fee_year = parseInt(req.body.year);
    if (req.body.student_id !== undefined)  patch.student_id = String(req.body.student_id);
    const updated = await update(req, 'AdditionalFees', req.params.id, patch);
    res.json({ additional_fee: normalize(updated) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update additional fee', detail: e.message });
  }
});

// DELETE /api/fees/additional/:id
router.delete('/additional/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'AdditionalFees', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Additional fee not found' });
    }
    await remove(req, 'AdditionalFees', req.params.id);
    res.json({ message: 'Additional fee deleted' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete additional fee', detail: e.message });
  }
});

module.exports = router;
