// /api/import — bulk insert from CSV/JSON uploads.

const router = require('express').Router();
const { insert, normalize } = require('../db/catalystDb');

// POST /api/import/students   body: { students: [{ name, parent_name, ... }] }
router.post('/students', async (req, res) => {
  try {
    const { students } = req.body;
    if (!Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ error: 'students[] is required' });
    }
    const inserted = [];
    const errors = [];
    for (const s of students) {
      if (!s.name || !s.name.trim()) {
        errors.push({ row: s, error: 'name is required' });
        continue;
      }
      try {
        const row = await insert(req, 'Students', {
          name:              s.name.trim(),
          parent_name:       s.parent_name || '',
          mobile_number:     s.mobile_number || '',
          fee_online:        Number(s.fee_online) || 0,
          fee_offline:       Number(s.fee_offline) || 0,
          fee_offline_group: Number(s.fee_offline_group) || 0,
          status:            s.status || 'active',
          notes:             s.notes || '',
        });
        inserted.push(normalize(row));
      } catch (err) {
        errors.push({ row: s, error: err.message });
      }
    }
    res.status(201).json({ imported: inserted.length, students: inserted, errors });
  } catch (e) {
    res.status(500).json({ error: 'Import failed', detail: e.message });
  }
});

// POST /api/import/attendance   body: { rows: [{ student_id, class_id, date, status, ... }] }
// (Useful later — not used yet by frontend.)
router.post('/attendance', async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'rows[] is required' });
    }
    const inserted = [];
    const errors = [];
    for (const r of rows) {
      try {
        const row = await insert(req, 'Attendance', {
          student_id:     String(r.student_id),
          class_id:       r.class_id ? String(r.class_id) : null,
          class_date:     r.date || r.class_date,
          status:         r.status,
          class_type:     r.class_type || 'offline',
          duration_hours: Number(r.duration_hours) || 1,
          fee_charged:    Number(r.fee_charged) || 0,
          topic:          r.topic || '',
          notes:          r.notes || '',
          recording_url:  r.recording_url || '',
        });
        inserted.push(normalize(row));
      } catch (err) {
        errors.push({ row: r, error: err.message });
      }
    }
    res.status(201).json({ imported: inserted.length, errors });
  } catch (e) {
    res.status(500).json({ error: 'Import failed', detail: e.message });
  }
});

module.exports = router;
