// /api/messages — Messages CRUD + auto-generate (absence/fee reminder).

const router = require('express').Router();
const { insert, getById, getAll, update, remove, zcql, unwrap, normalize } = require('../db/catalystDb');
const { loadTemplates, DEFAULT_TEMPLATES } = require('./settings');
const { generateFeeReminders, substituteTemplate, pickTemplate } = require('../lib/feeReminder');

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
// The actual logic lives in lib/feeReminder.js so the monthly cron can
// reuse it without going through this auth-gated HTTP route.
router.post('/generate-fee-reminder', async (req, res) => {
  try {
    const now = new Date();
    const month = parseInt(req.body?.month) || (now.getMonth() + 1);
    const year = parseInt(req.body?.year) || now.getFullYear();
    const result = await generateFeeReminders(req, { month, year });
    res.json(result);
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
