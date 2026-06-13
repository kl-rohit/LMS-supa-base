// /api/camps — Camps + CampDays. Org-scoped via resolveOrg.

const router = require('express').Router();
const { insert, getById, update, remove, zcql, unwrap, normalize, q } = require('../db/catalystDb');

function calcDuration(start, end) {
  if (!start || !end) return 1;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const diff = (eh * 60 + em) - (sh * 60 + sm);
  return diff > 0 ? diff / 60 : 1;
}

function addDays(yyyymmdd, n) {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function decorate(req, camp) {
  const out = normalize(camp);
  if (camp.group_id) {
    try {
      const g = await getById(req, 'Groups', camp.group_id);
      if (g && Number(g.org_id) === Number(req.orgId)) {
        out.group_name = g.name;
        const links = await zcql(req, `SELECT GroupStudents.student_id FROM GroupStudents WHERE GroupStudents.group_id = ${camp.group_id} AND GroupStudents.org_id = ${Number(req.orgId)}`);
        const sids = unwrap(links, 'GroupStudents').map((l) => l.student_id).filter(Boolean);
        if (sids.length) {
          const sRows = await zcql(req, `SELECT * FROM Students WHERE ROWID IN (${sids.join(',')}) AND Students.org_id = ${Number(req.orgId)}`);
          out.members = unwrap(sRows, 'Students').map(normalize);
        } else {
          out.members = [];
        }
      }
    } catch {}
  }
  try {
    const dRows = await zcql(req, `SELECT * FROM CampDays WHERE CampDays.camp_id = ${camp.ROWID} AND CampDays.org_id = ${Number(req.orgId)} ORDER BY CampDays.day_date ASC`);
    out.days = unwrap(dRows, 'CampDays').map(normalize);
  } catch {
    out.days = [];
  }
  return out;
}

// GET /api/camps/by-date/:date
router.get('/by-date/:date', async (req, res) => {
  try {
    const date = req.params.date;
    const rows = await zcql(
      req,
      `SELECT * FROM Camps WHERE Camps.start_date <= ${q(date)} AND Camps.end_date >= ${q(date)} AND Camps.status = 'active' AND Camps.org_id = ${Number(req.orgId)}`
    );
    const camps = await Promise.all(unwrap(rows, 'Camps').map((c) => decorate(req, c)));
    res.json({ camps });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch camps by date', detail: e.message });
  }
});

// GET /api/camps/days/by-date/:date
router.get('/days/by-date/:date', async (req, res) => {
  try {
    const date = req.params.date;
    const dayRows = await zcql(
      req,
      `SELECT * FROM CampDays WHERE CampDays.day_date = ${q(date)} AND CampDays.org_id = ${Number(req.orgId)}`
    );
    const days = unwrap(dayRows, 'CampDays').map(normalize);
    const out = await Promise.all(days.map(async (d) => {
      try {
        const camp = await getById(req, 'Camps', d.camp_id);
        if (camp && camp.status === 'active' && Number(camp.org_id) === Number(req.orgId)) {
          d.camp_name = camp.name;
          d.camp_status = camp.status;
          d.group_id = camp.group_id;
          d.daily_fee = camp.daily_fee || 0;
          const links = await zcql(req, `SELECT GroupStudents.student_id FROM GroupStudents WHERE GroupStudents.group_id = ${camp.group_id} AND GroupStudents.org_id = ${Number(req.orgId)}`);
          const sids = unwrap(links, 'GroupStudents').map((l) => l.student_id).filter(Boolean);
          if (sids.length) {
            const sRows = await zcql(req, `SELECT * FROM Students WHERE ROWID IN (${sids.join(',')}) AND Students.org_id = ${Number(req.orgId)}`);
            d.members = unwrap(sRows, 'Students').map(normalize);
          } else {
            d.members = [];
          }
          return d;
        }
        return null;
      } catch {
        return null;
      }
    }));
    res.json({ days: out.filter(Boolean) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch camp days by date', detail: e.message });
  }
});

// POST /api/camps/days/:dayId/attendance
router.post('/days/:dayId/attendance', async (req, res) => {
  try {
    const day = await getById(req, 'CampDays', req.params.dayId);
    if (!day || Number(day.org_id) !== Number(req.orgId)) return res.status(404).json({ error: 'Camp day not found' });
    const camp = await getById(req, 'Camps', day.camp_id);
    if (!camp || Number(camp.org_id) !== Number(req.orgId)) return res.status(404).json({ error: 'Parent camp not found' });

    const { records } = req.body;
    if (!Array.isArray(records) || !records.length) {
      return res.status(400).json({ error: 'records[] required' });
    }
    const dailyFee = Number(camp.daily_fee) || 0;
    const dur = Number(day.duration_hours) || 1;

    const results = [];
    for (const r of records) {
      try {
        // Verify student belongs to org.
        const s = await getById(req, 'Students', r.student_id);
        if (!s || Number(s.org_id) !== Number(req.orgId)) {
          results.push({ ok: false, student_id: r.student_id, error: 'Student not in this org' });
          continue;
        }
        let existingId = null;
        try {
          const existing = await zcql(
            req,
            `SELECT ROWID FROM Attendance WHERE Attendance.student_id = ${r.student_id} AND Attendance.camp_id = ${day.camp_id} AND Attendance.class_date = ${q(day.day_date)} AND Attendance.org_id = ${Number(req.orgId)}`
          );
          const found = unwrap(existing, 'Attendance');
          if (found.length) existingId = found[0].ROWID;
        } catch {}

        let fee = r.fee_charged;
        if (fee === undefined) {
          if (dailyFee) {
            fee = dailyFee;
          } else if (r.status === 'present' || r.status === 'late') {
            const rate = s.fee_offline_group || 0;
            fee = rate * dur;
          }
        }
        if (r.status === 'absent') fee = 0;

        const payload = {
          student_id: String(r.student_id),
          class_id: null,
          camp_id: String(day.camp_id),
          class_date: day.day_date,
          status: r.status || 'present',
          class_type: day.class_type || 'offline_group',
          duration_hours: dur,
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
    res.status(201).json({ results, count: results.filter((r) => r.ok).length });
  } catch (e) {
    res.status(500).json({ error: 'Camp day attendance failed', detail: e.message });
  }
});

// GET /api/camps
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const where = [`Camps.org_id = ${Number(req.orgId)}`];
    if (status) where.push(`Camps.status = ${q(status)}`);
    const rows = await zcql(req, `SELECT * FROM Camps WHERE ${where.join(' AND ')} ORDER BY Camps.start_date DESC`);
    const camps = await Promise.all(unwrap(rows, 'Camps').map((c) => decorate(req, c)));
    res.json({ camps });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch camps', detail: e.message });
  }
});

// GET /api/camps/:id
router.get('/:id', async (req, res) => {
  try {
    const camp = await getById(req, 'Camps', req.params.id);
    if (!camp || Number(camp.org_id) !== Number(req.orgId)) return res.status(404).json({ error: 'Camp not found' });
    const decorated = await decorate(req, camp);

    try {
      const aRows = await zcql(req, `SELECT * FROM Attendance WHERE Attendance.camp_id = ${req.params.id} AND Attendance.org_id = ${Number(req.orgId)}`);
      const attendance = unwrap(aRows, 'Attendance').map(normalize);
      const byDay = {};
      for (const a of attendance) {
        const d = a.date || a.class_date;
        if (!byDay[d]) byDay[d] = { present: 0, absent: 0, late: 0 };
        if (a.status === 'present') byDay[d].present++;
        else if (a.status === 'absent') byDay[d].absent++;
        else if (a.status === 'late') byDay[d].late++;
      }
      decorated.days = (decorated.days || []).map((d) => ({
        ...d,
        attendance_summary: byDay[d.day_date] || { present: 0, absent: 0, late: 0 },
      }));
      decorated.attendance = attendance;
    } catch {}

    res.json({ camp: decorated });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch camp', detail: e.message });
  }
});

// POST /api/camps
router.post('/', async (req, res) => {
  try {
    const { name, group_id, start_date, total_days, daily_fee, notes, schedule } = req.body;
    const missing = [];
    if (!name) missing.push('name');
    if (!group_id) missing.push('group_id');
    if (!start_date) missing.push('start_date');
    if (!total_days) missing.push('total_days');
    if (!Array.isArray(schedule) || !schedule.length) missing.push('schedule[]');
    if (missing.length) {
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }
    // Verify group is in caller's org.
    const g = await getById(req, 'Groups', group_id);
    if (!g || Number(g.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Group not found' });
    }
    const days = parseInt(total_days);
    const end_date = addDays(start_date, days - 1);

    const camp = await insert(req, 'Camps', {
      name,
      group_id: String(group_id),
      start_date,
      end_date,
      total_days: days,
      daily_fee: Number(daily_fee) || 0,
      status: 'active',
      notes: notes || '',
      org_id: Number(req.orgId),
    });

    const insertedDays = [];
    const errors = [];
    for (const s of schedule) {
      try {
        const inserted = await insert(req, 'CampDays', {
          camp_id: String(camp.ROWID),
          day_date: s.day_date,
          start_time: s.start_time,
          end_time: s.end_time,
          class_type: s.class_type || 'offline_group',
          duration_hours: Number(s.duration_hours) || calcDuration(s.start_time, s.end_time),
          org_id: Number(req.orgId),
        });
        insertedDays.push(normalize(inserted));
      } catch (err) {
        errors.push({ day: s, error: err.message });
      }
    }

    res.status(201).json({
      camp: { ...normalize(camp), days: insertedDays, errors: errors.length ? errors : undefined },
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create camp', detail: e.message });
  }
});

// PUT /api/camps/:id
router.put('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Camps', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) return res.status(404).json({ error: 'Camp not found' });
    const patch = {};
    const allow = ['name', 'group_id', 'start_date', 'end_date', 'total_days', 'daily_fee', 'status', 'notes'];
    for (const k of allow) {
      if (req.body[k] !== undefined) {
        if (k === 'group_id') patch[k] = String(req.body[k]);
        else if (k === 'total_days' || k === 'daily_fee') patch[k] = Number(req.body[k]);
        else patch[k] = req.body[k];
      }
    }
    const updated = await update(req, 'Camps', req.params.id, patch);
    res.json({ camp: await decorate(req, updated) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update camp', detail: e.message });
  }
});

// DELETE /api/camps/:id
router.delete('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Camps', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) return res.status(404).json({ error: 'Camp not found' });
    try {
      const dayRows = await zcql(req, `SELECT ROWID FROM CampDays WHERE CampDays.camp_id = ${req.params.id} AND CampDays.org_id = ${Number(req.orgId)}`);
      for (const d of unwrap(dayRows, 'CampDays')) {
        try { await remove(req, 'CampDays', d.ROWID); } catch {}
      }
    } catch {}
    await remove(req, 'Camps', req.params.id);
    res.json({ message: 'Camp deleted' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete camp', detail: e.message });
  }
});

module.exports = router;
