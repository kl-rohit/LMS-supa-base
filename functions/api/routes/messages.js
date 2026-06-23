// /api/messages — Messages CRUD + auto-generate (absence/fee reminder).
// Org-scoped via middleware/org.resolveOrg.

const router = require('express').Router();
const { insert, getById, update, remove, zcql, zcqlAll, unwrap, normalize, safeId } = require('../db/catalystDb');
const { loadTemplates, DEFAULT_TEMPLATES, loadAppSettings } = require('./settings');
const { generateFeeReminders, substituteTemplate, pickTemplate } = require('../lib/feeReminder');
const { createNotifications } = require('../lib/notify');

// Friendly inbox titles per message_type.
const MSG_TITLES = {
  fee_reminder: 'Fee reminder',
  absence_alert: 'Attendance update',
  custom: 'Message from your academy',
};

// School identity for {school} / {signature} substitution.
async function loadSchoolCtx(req) {
  try {
    const s = await loadAppSettings(req);
    return {
      school:    s['school.name']      || 'Your Academy',
      signature: s['school.signature'] || s['school.name'] || 'Your Academy',
    };
  } catch {
    return { school: 'Your Academy', signature: 'Your Academy' };
  }
}

// GET /api/messages
router.get('/', async (req, res) => {
  try {
    const rows = await zcqlAll(req, `SELECT * FROM Messages WHERE Messages.org_id = ${Number(req.orgId)} ORDER BY Messages.CREATEDTIME DESC`, 'Messages');
    res.json({ messages: unwrap(rows, 'Messages').map(normalize) });
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
      if (!s || Number(s.org_id) !== Number(req.orgId)) {
        return res.status(404).json({ error: 'Student not found' });
      }
      pName = pName || s.parent_name; mNum = mNum || s.mobile_number;
    }
    const row = await insert(req, 'Messages', {
      student_id: student_id ? String(student_id) : null,
      parent_name: pName || '',
      mobile_number: mNum || '',
      message,
      message_type: message_type || 'custom',
      is_sent: 0,
      org_id: Number(req.orgId),
    });
    res.status(201).json({ message: normalize(row) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create message', detail: e.message });
  }
});

// POST /api/messages/generate-absence-alert
router.post('/generate-absence-alert', async (req, res) => {
  try {
    const [templates, schoolCtx, appSettings] = await Promise.all([
      loadTemplates(req).catch(() => DEFAULT_TEMPLATES),
      loadSchoolCtx(req),
      loadAppSettings(req).catch(() => ({})),
    ]);
    const tRaw = parseInt(appSettings['alerts.absence_threshold'], 10);
    const threshold = (Number.isFinite(tRaw) && tRaw >= 1 && tRaw <= 10) ? tRaw : 2;
    // Optional: limit generation to one student (the "Send alert" action on a
    // single banner chip). Without it, alerts are generated for every active
    // student whose streak meets the threshold.
    const onlyStudent = safeId(req.body?.student_id);
    const filter = onlyStudent ? ` AND Students.ROWID = ${onlyStudent}` : '';
    const studentRows = await zcql(req, `SELECT * FROM Students WHERE Students.status = 'active' AND Students.org_id = ${Number(req.orgId)}${filter}`);
    const students = unwrap(studentRows, 'Students');
    let created = 0;
    for (const s of students) {
      try {
        const aRows = await zcqlAll(req, `SELECT * FROM Attendance WHERE Attendance.student_id = ${s.ROWID} AND Attendance.org_id = ${Number(req.orgId)} ORDER BY Attendance.class_date DESC`, 'Attendance');
        const records = unwrap(aRows, 'Attendance');
        let streak = 0;
        for (const r of records) { if (r.status === 'absent') streak++; else break; }
        if (streak >= threshold) {
          const text = substituteTemplate(pickTemplate(templates, 'absence_alert'), {
            name: s.name,
            parent: s.parent_name,
            count: streak,
            ...schoolCtx,
          });
          await insert(req, 'Messages', {
            student_id: String(s.ROWID),
            parent_name: s.parent_name || '',
            mobile_number: s.mobile_number || '',
            message: text,
            message_type: 'absence_alert',
            is_sent: 0,
            org_id: Number(req.orgId),
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
router.post('/generate-fee-reminder', async (req, res) => {
  try {
    const now = new Date();
    const month = parseInt(req.body?.month) || (now.getMonth() + 1);
    const year = parseInt(req.body?.year) || now.getFullYear();
    // generateFeeReminders reads req.orgId internally — see lib/feeReminder.js.
    const result = await generateFeeReminders(req, { month, year, orgId: Number(req.orgId) });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate fee reminders', detail: e.message });
  }
});

// PUT /api/messages/:id
router.put('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Messages', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Message not found' });
    }
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

// POST /api/messages/:id/send-in-app — deliver this message to the parent's
// in-app notification inbox (+ web push). Mirrors the WhatsApp action but
// stays inside the app. Marks the message as sent.
router.post('/:id/send-in-app', async (req, res) => {
  try {
    const existing = await getById(req, 'Messages', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Message not found' });
    }
    if (!existing.student_id) {
      return res.status(400).json({ error: 'This message has no linked student to notify' });
    }
    const type = existing.message_type || 'custom';
    const result = await createNotifications(req, {
      orgId: Number(req.orgId),
      studentIds: [String(existing.student_id)],
      type: type === 'fee_reminder' ? 'fee' : type === 'absence_alert' ? 'attendance' : 'message',
      title: MSG_TITLES[type] || MSG_TITLES.custom,
      body: existing.message || '',
      link: type === 'fee_reminder' ? '/portal/fees' : '/portal',
    });
    // Mark as sent so it leaves the pending queue (same as WhatsApp send).
    try { await update(req, 'Messages', req.params.id, { is_sent: 1 }); } catch { /* ignore */ }
    res.json({ ok: true, delivered: result.created, pushed: result.pushed });
  } catch (e) {
    res.status(500).json({ error: 'Failed to send in-app', detail: e.message });
  }
});

// DELETE /api/messages/:id
router.delete('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Messages', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Message not found' });
    }
    await remove(req, 'Messages', req.params.id);
    res.json({ message: 'Message deleted' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete message', detail: e.message });
  }
});

module.exports = router;
