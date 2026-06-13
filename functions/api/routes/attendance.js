// /api/attendance — Catalyst Data Store "Attendance" + absent-streak logic.
// Org-scoped via middleware/org.resolveOrg.

const router = require('express').Router();
const { insert, getById, update, remove, zcql, zcqlAll, unwrap, normalize, q, safeId } = require('../db/catalystDb');

function calcFee(student, classType, durationHours) {
  let perHour = 0;
  switch (classType) {
    case 'online':         perHour = student.fee_online || 0; break;
    case 'offline':        perHour = student.fee_offline || 0; break;
    case 'offline_group':
    case 'online_group':   perHour = student.fee_offline_group || 0; break;
  }
  return perHour * (durationHours || 1);
}

async function decorate(req, att) {
  const out = { ...normalize(att) };
  if (att.student_id) {
    try {
      const s = await getById(req, 'Students', att.student_id);
      if (s && Number(s.org_id) === Number(req.orgId)) out.student_name = s.name;
    } catch {}
  }
  if (att.class_id) {
    try {
      const c = await getById(req, 'Classes', att.class_id);
      if (c && Number(c.org_id) === Number(req.orgId)) out.class_name = c.name;
    } catch {}
  }
  return out;
}

// GET /api/attendance
router.get('/', async (req, res) => {
  try {
    const { class_id, student_id, from, to, date } = req.query;
    const where = [`Attendance.org_id = ${Number(req.orgId)}`];
    const cid = safeId(class_id);
    const sid = safeId(student_id);
    if (cid) where.push(`Attendance.class_id = ${cid}`);
    if (sid) where.push(`Attendance.student_id = ${sid}`);
    if (date) where.push(`Attendance.class_date = ${q(date)}`);
    if (from) where.push(`Attendance.class_date >= ${q(from)}`);
    if (to) where.push(`Attendance.class_date <= ${q(to)}`);
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const rows = await zcqlAll(req, `SELECT * FROM Attendance ${whereSql} ORDER BY Attendance.class_date DESC`, 'Attendance');
    const list = unwrap(rows, 'Attendance');
    const decorated = await Promise.all(list.map((a) => decorate(req, a)));
    res.json({ attendance: decorated });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch attendance', detail: e.message });
  }
});

// GET /api/attendance/by-date/:date
router.get('/by-date/:date', async (req, res) => {
  try {
    const rows = await zcql(req, `SELECT * FROM Attendance WHERE Attendance.class_date = ${q(req.params.date)} AND Attendance.org_id = ${Number(req.orgId)} ORDER BY Attendance.class_date DESC`);
    const decorated = await Promise.all(unwrap(rows, 'Attendance').map((a) => decorate(req, a)));
    res.json({ attendance: decorated });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch attendance by date', detail: e.message });
  }
});

// GET /api/attendance/by-student/:studentId
router.get('/by-student/:studentId', async (req, res) => {
  try {
    const sid = safeId(req.params.studentId);
    if (!sid) return res.status(400).json({ error: 'Invalid student id' });
    const rows = await zcqlAll(req, `SELECT * FROM Attendance WHERE Attendance.student_id = ${sid} AND Attendance.org_id = ${Number(req.orgId)} ORDER BY Attendance.class_date DESC`, 'Attendance');
    const decorated = await Promise.all(unwrap(rows, 'Attendance').map((a) => decorate(req, a)));
    res.json({ attendance: decorated });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch attendance for student', detail: e.message });
  }
});

// GET /api/attendance/absent-streaks/all
router.get('/absent-streaks/all', async (req, res) => {
  try {
    const studentRows = await zcql(req, `SELECT * FROM Students WHERE Students.status = 'active' AND Students.org_id = ${Number(req.orgId)}`);
    const students = unwrap(studentRows, 'Students');
    const alerts = [];
    for (const s of students) {
      try {
        const aRows = await zcqlAll(req, `SELECT * FROM Attendance WHERE Attendance.student_id = ${s.ROWID} AND Attendance.org_id = ${Number(req.orgId)} ORDER BY Attendance.class_date DESC`, 'Attendance');
        const records = unwrap(aRows, 'Attendance');
        let streak = 0;
        for (const r of records) {
          if (r.status === 'absent') streak++;
          else break;
        }
        if (streak >= 2) alerts.push({ student_id: s.ROWID, student_name: s.name, consecutive_absences: streak });
      } catch {}
    }
    res.json({ alerts });
  } catch (e) {
    res.status(500).json({ error: 'Failed to compute absent streaks', detail: e.message });
  }
});

// POST /api/attendance — single record
router.post('/', async (req, res) => {
  try {
    const { student_id, class_id, date, status, topic, notes, class_type, duration_hours, fee_charged, recording_url } = req.body;
    if (!student_id || !date || !status) {
      return res.status(400).json({ error: 'student_id, date, status are required' });
    }
    if (!['present', 'absent', 'late'].includes(status)) {
      return res.status(400).json({ error: 'invalid status' });
    }
    // Verify student belongs to caller's org.
    const student = await getById(req, 'Students', student_id);
    if (!student || Number(student.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Student not found' });
    }
    let cls = null, finalType = class_type, finalDuration = duration_hours, computedFee = fee_charged;
    if (class_id) {
      cls = await getById(req, 'Classes', class_id);
      if (!cls || Number(cls.org_id) !== Number(req.orgId)) return res.status(404).json({ error: 'Class not found' });
      finalType = finalType || cls.class_type;
      finalDuration = finalDuration || cls.duration_hours;
    }
    if (computedFee === undefined) {
      computedFee = 0;
      if (status === 'present' || status === 'late') {
        if (finalType) computedFee = calcFee(student, finalType, finalDuration || 1);
      }
    }
    if (status === 'absent') computedFee = 0;
    const att = await insert(req, 'Attendance', {
      student_id: String(student_id),
      class_id: class_id ? String(class_id) : null,
      class_date: date,
      status,
      class_type: finalType || 'offline',
      duration_hours: finalDuration || 1,
      fee_charged: computedFee,
      topic: topic || '',
      notes: notes || '',
      recording_url: recording_url || '',
      org_id: Number(req.orgId),
    });
    res.status(201).json({ attendance: await decorate(req, att) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create attendance', detail: e.message });
  }
});

// POST /api/attendance/adhoc
router.post('/adhoc', async (req, res) => {
  try {
    const { date, class_type, duration_hours, records } = req.body;
    if (!date || !class_type || !Array.isArray(records) || !records.length) {
      return res.status(400).json({ error: 'date, class_type, records[] required' });
    }
    const dur = Number(duration_hours) || 1;
    const results = [];
    for (const r of records) {
      try {
        const student = await getById(req, 'Students', r.student_id);
        if (!student || Number(student.org_id) !== Number(req.orgId)) {
          results.push({ ok: false, student_id: r.student_id, error: 'Student not in this org' });
          continue;
        }
        let fee = r.fee_charged;
        if (fee === undefined && (r.status === 'present' || r.status === 'late')) {
          fee = calcFee(student, class_type, dur);
        }
        if (r.status === 'absent') fee = 0;
        const inserted = await insert(req, 'Attendance', {
          student_id: String(r.student_id),
          class_id: null,
          class_date: date,
          status: r.status || 'present',
          class_type,
          duration_hours: dur,
          fee_charged: fee || 0,
          topic: r.topic || '',
          notes: r.notes || '',
          recording_url: r.recording_url || '',
          org_id: Number(req.orgId),
        });
        results.push({ ok: true, row: normalize(inserted) });
      } catch (err) {
        results.push({ ok: false, student_id: r.student_id, error: err.message });
      }
    }
    res.status(201).json({ results, count: results.filter((r) => r.ok).length });
  } catch (e) {
    res.status(500).json({ error: 'Ad-hoc attendance failed', detail: e.message });
  }
});

// POST /api/attendance/bulk
router.post('/bulk', async (req, res) => {
  try {
    const { class_id, date, records } = req.body;
    if (!date || !Array.isArray(records) || !records.length) {
      return res.status(400).json({ error: 'date and records[] are required' });
    }
    let cls = null;
    if (class_id) {
      cls = await getById(req, 'Classes', class_id);
      if (cls && Number(cls.org_id) !== Number(req.orgId)) cls = null;
    }
    const results = [];
    for (const r of records) {
      try {
        const student = await getById(req, 'Students', r.student_id);
        if (!student || Number(student.org_id) !== Number(req.orgId)) {
          results.push({ ok: false, student_id: r.student_id, error: 'Student not in this org' });
          continue;
        }
        let existingId = null;
        if (class_id) {
          try {
            const existing = await zcql(req, `SELECT ROWID FROM Attendance WHERE Attendance.student_id = ${r.student_id} AND Attendance.class_id = ${class_id} AND Attendance.class_date = ${q(date)} AND Attendance.org_id = ${Number(req.orgId)}`);
            const found = unwrap(existing, 'Attendance');
            if (found.length) existingId = found[0].ROWID;
          } catch {}
        }
        const finalType = cls?.class_type || 'offline';
        const finalDuration = cls?.duration_hours || 1;
        let fee = r.fee_charged;
        if (fee === undefined && (r.status === 'present' || r.status === 'late')) {
          fee = calcFee(student, finalType, finalDuration);
        }
        if (r.status === 'absent') fee = 0;
        const payload = {
          student_id: String(r.student_id),
          class_id: class_id ? String(class_id) : null,
          class_date: date,
          status: r.status,
          class_type: finalType,
          duration_hours: finalDuration,
          fee_charged: fee || 0,
          topic: r.topic || '',
          notes: r.notes || '',
          recording_url: r.recording_url || '',
          org_id: Number(req.orgId),
        };
        if (existingId) {
          const updated = await update(req, 'Attendance', existingId, payload);
          results.push({ ok: true, action: 'updated', row: normalize(updated) });
        } else {
          const inserted = await insert(req, 'Attendance', payload);
          results.push({ ok: true, action: 'inserted', row: normalize(inserted) });
        }
      } catch (err) {
        results.push({ ok: false, student_id: r.student_id, error: err.message });
      }
    }
    res.status(201).json({ results });
  } catch (e) {
    res.status(500).json({ error: 'Bulk attendance failed', detail: e.message });
  }
});

// PUT /api/attendance/:id
router.put('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Attendance', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Attendance not found' });
    }
    const patch = {};
    const allow = ['status', 'topic', 'notes', 'fee_charged', 'duration_hours', 'recording_url'];
    for (const k of allow) if (req.body[k] !== undefined) patch[k] = req.body[k];
    if (patch.status === 'absent') patch.fee_charged = 0;
    const updated = await update(req, 'Attendance', req.params.id, patch);
    res.json({ attendance: await decorate(req, updated) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update attendance', detail: e.message });
  }
});

// DELETE /api/attendance/:id
router.delete('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Attendance', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Attendance not found' });
    }
    await remove(req, 'Attendance', req.params.id);
    res.json({ message: 'Attendance deleted' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete attendance', detail: e.message });
  }
});

module.exports = router;
