// /api/messages — Messages CRUD + auto-generate (absence/fee reminder).

const router = require('express').Router();
const { insert, getById, getAll, update, remove, zcql, unwrap, normalize, q } = require('../db/catalystDb');
const { loadTemplates, DEFAULT_TEMPLATES } = require('./settings');

// Substitute {placeholder} tokens with values from ctx.
// Unknown placeholders are left literal so the teacher can fill them
// manually (e.g. when composing a one-off message without a known amount).
function substituteTemplate(text, ctx) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/\{(\w+)\}/g, (match, key) => {
    if (ctx && Object.prototype.hasOwnProperty.call(ctx, key) && ctx[key] !== undefined && ctx[key] !== null) {
      return String(ctx[key]);
    }
    return match;
  });
}

// Look up a template by type, falling back to the hard-coded default
// when the Settings row is missing or empty.
function pickTemplate(templates, type) {
  return (templates && templates[type]) || DEFAULT_TEMPLATES[type] || '';
}

// Build the conditional fee_reminder body. Mirrors the original logic:
// only show the breakdown bullet block when there are positive additional
// fees — otherwise the lone "₹{amount}" total is cleaner. We do this by
// stripping the breakdown lines from the template post-substitution when
// additional_fees === 0. Lines starting with "  • Class fees:" or
// "  • Additional:" are removed.
function applyFeeReminderConditionalBlock(text, additionalFees) {
  if (Number(additionalFees) > 0) return text;
  return text
    .split('\n')
    .filter((ln) => {
      const t = ln.trim();
      return !(t.startsWith('• Class fees:') || t.startsWith('• Additional:'));
    })
    .join('\n');
}

// GET /api/messages
router.get('/', async (req, res) => {
  try {
    const rows = (await getAll(req, 'Messages'))
      .sort((a, b) => String(b.CREATEDTIME || '').localeCompare(String(a.CREATEDTIME || '')));
    res.json({ messages: rows.map(normalize) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch messages', detail: e.message });
  }
});

// POST /api/messages
router.post('/', async (req, res) => {
  try {
    const { student_id, parent_name, mobile_number, message, message_type } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });
    let pName = parent_name, mNum = mobile_number;
    if (student_id) {
      const s = await getById(req, 'Students', student_id);
      if (s) { pName = pName || s.parent_name; mNum = mNum || s.mobile_number; }
    }
    const row = await insert(req, 'Messages', {
      student_id: student_id ? String(student_id) : null,
      parent_name: pName || '',
      mobile_number: mNum || '',
      message,
      message_type: message_type || 'custom',
      is_sent: 0,
    });
    res.status(201).json({ message: normalize(row) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create message', detail: e.message });
  }
});

// POST /api/messages/generate-absence-alert
router.post('/generate-absence-alert', async (req, res) => {
  try {
    // Fetch templates once per request (single ZCQL query — fine at our scale).
    const templates = await loadTemplates(req).catch(() => DEFAULT_TEMPLATES);
    // Reuse the same absent-streak logic
    const studentRows = await zcql(req, `SELECT * FROM Students WHERE Students.status = 'active'`);
    const students = unwrap(studentRows, 'Students');
    let created = 0;
    for (const s of students) {
      try {
        const aRows = await zcql(req, `SELECT * FROM Attendance WHERE Attendance.student_id = ${s.ROWID} ORDER BY Attendance.class_date DESC`);
        const records = unwrap(aRows, 'Attendance');
        let streak = 0;
        for (const r of records) { if (r.status === 'absent') streak++; else break; }
        if (streak >= 2) {
          const text = substituteTemplate(pickTemplate(templates, 'absence_alert'), {
            name: s.name,
            parent: s.parent_name,
            count: streak,
          });
          await insert(req, 'Messages', {
            student_id: String(s.ROWID),
            parent_name: s.parent_name || '',
            mobile_number: s.mobile_number || '',
            message: text,
            message_type: 'absence_alert',
            is_sent: 0,
          });
          created++;
        }
      } catch {}
    }
    res.json({ created });
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate absence alerts', detail: e.message });
  }
});

// POST /api/messages/generate-fee-reminder
// Body: { month?, year? }  — defaults to current month
// Generates one draft Messages row per student with a positive monthly total
// (class fees + additional fees for the month). Active students only.
router.post('/generate-fee-reminder', async (req, res) => {
  try {
    const now = new Date();
    const month = parseInt(req.body?.month) || (now.getMonth() + 1);
    const year = parseInt(req.body?.year) || now.getFullYear();
    const monthStr = String(month).padStart(2, '0');
    const dateFrom = `${year}-${monthStr}-01`;
    const dateTo = `${year}-${monthStr}-31`;
    const monthName = ['January','February','March','April','May','June','July','August','September','October','November','December'][month - 1];

    // Fetch templates once per request.
    const templates = await loadTemplates(req).catch(() => DEFAULT_TEMPLATES);

    const studentRows = await zcql(req, `SELECT * FROM Students WHERE Students.status = 'active'`);
    const students = unwrap(studentRows, 'Students');
    const reminders = [];

    for (const s of students) {
      try {
        // Sum class fees for the month
        const aRows = await zcql(
          req,
          `SELECT * FROM Attendance WHERE Attendance.student_id = ${s.ROWID} AND Attendance.class_date >= ${q(dateFrom)} AND Attendance.class_date <= ${q(dateTo)}`
        );
        const attendance = unwrap(aRows, 'Attendance');
        const classFees = attendance.reduce((sum, a) => sum + (Number(a.fee_charged) || 0), 0);
        const classesAttended = attendance.filter((a) => a.status === 'present' || a.status === 'late').length;

        // Sum additional fees for the month (using renamed columns)
        const afRows = await zcql(
          req,
          `SELECT * FROM AdditionalFees WHERE AdditionalFees.student_id = ${s.ROWID} AND AdditionalFees.fee_month = ${month} AND AdditionalFees.fee_year = ${year}`
        );
        const additional = unwrap(afRows, 'AdditionalFees');
        // Split into positive (shown to parent) and negative/discount
        // (applied silently to total but never mentioned).
        const positiveAdditional = additional.reduce(
          (sum, a) => sum + Math.max(0, Number(a.amount) || 0), 0);
        const discountTotal = additional.reduce(
          (sum, a) => sum + Math.min(0, Number(a.amount) || 0), 0); // negative
        const additionalTotal = positiveAdditional + discountTotal; // net (used for the reminder row only)
        const total = classFees + additionalTotal;

        if (total > 0) {
          const positiveAdditionalRounded = positiveAdditional.toFixed(0);
          let text = substituteTemplate(pickTemplate(templates, 'fee_reminder'), {
            name: s.name,
            parent: s.parent_name,
            amount: total.toFixed(0),
            class_fees: classFees.toFixed(0),
            // IMPORTANT: pass only positive additional fees to the template.
            // Discount is internal and stays out of the parent-facing message.
            additional_fees: positiveAdditionalRounded,
            month: monthName,
            year,
          });
          // Hide the breakdown bullets when there are no additional fees —
          // matches the pre-templates behaviour where the bullets only appeared
          // for nonzero additional charges.
          text = applyFeeReminderConditionalBlock(text, positiveAdditionalRounded);
          const inserted = await insert(req, 'Messages', {
            student_id: String(s.ROWID),
            parent_name: s.parent_name || '',
            mobile_number: s.mobile_number || '',
            message: text,
            message_type: 'fee_reminder',
            is_sent: 0,
          });
          reminders.push({
            student_id: s.ROWID,
            student_name: s.name,
            classes_attended: classesAttended,
            class_fees: classFees,
            additional_fees: additionalTotal,
            total,
            message_id: inserted?.ROWID,
          });
        }
      } catch (err) {
        console.error('fee reminder for student failed', s.ROWID, err.message);
      }
    }

    res.json({ created: reminders.length, reminders, month, year, month_name: monthName });
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate fee reminders', detail: e.message });
  }
});

// PUT /api/messages/:id
router.put('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Messages', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Message not found' });
    const patch = {};
    const allow = ['message', 'message_type', 'is_sent', 'parent_name', 'mobile_number'];
    for (const k of allow) if (req.body[k] !== undefined) {
      patch[k] = k === 'is_sent' ? parseInt(req.body[k]) : req.body[k];
    }
    const updated = await update(req, 'Messages', req.params.id, patch);
    res.json({ message: normalize(updated) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update message', detail: e.message });
  }
});

// DELETE /api/messages/:id
router.delete('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Messages', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Message not found' });
    await remove(req, 'Messages', req.params.id);
    res.json({ message: 'Message deleted' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete message', detail: e.message });
  }
});

module.exports = router;
