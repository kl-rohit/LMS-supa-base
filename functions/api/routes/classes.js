// /api/classes — CRUD against "Classes" + multi-student via "ClassStudents".

const router = require('express').Router();
const { insert, getById, getAll, update, remove, zcql, unwrap, normalize, safeId } = require('../db/catalystDb');

const VALID_TYPES = ['online', 'offline', 'offline_group', 'online_group'];
const isGroupType = (t) => t === 'offline_group' || t === 'online_group';

function calcDuration(start, end) {
  if (!start || !end) return 1;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const diff = (eh * 60 + em) - (sh * 60 + sm);
  return diff > 0 ? diff / 60 : 1;
}

// Fetch student names linked to a class via ClassStudents
async function fetchClassStudents(req, classId) {
  try {
    const links = await zcql(req, `SELECT ClassStudents.student_id FROM ClassStudents WHERE ClassStudents.class_id = ${classId}`);
    return unwrap(links, 'ClassStudents').map((l) => l.student_id).filter(Boolean);
  } catch {
    return [];
  }
}

// Attach denormalized fields (student_name / group_name / student_ids[]) to a class
async function decorate(req, cls) {
  const out = { ...normalize(cls) };
  if (cls.student_id) {
    try {
      const s = await getById(req, 'Students', cls.student_id);
      if (s) out.student_name = s.name;
    } catch {}
  }
  if (cls.group_id) {
    try {
      const g = await getById(req, 'Groups', cls.group_id);
      if (g) out.group_name = g.name;
    } catch {}
  }
  out.student_ids = await fetchClassStudents(req, cls.ROWID);
  return out;
}

// GET /api/classes/today
router.get('/today', async (req, res) => {
  try {
    const today = new Date().getDay();
    const rows = await zcql(req, `SELECT * FROM Classes WHERE Classes.day_of_week = ${today} AND Classes.is_active = 1 ORDER BY Classes.start_time ASC`);
    const decorated = await Promise.all(unwrap(rows, 'Classes').map((c) => decorate(req, c)));
    res.json({ classes: decorated, day_of_week: today });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch today\'s classes', detail: e.message });
  }
});

// GET /api/classes  (optional filters: day_of_week, group_id, student_id, is_active, class_type)
router.get('/', async (req, res) => {
  try {
    const { day_of_week, group_id, student_id, is_active, class_type } = req.query;
    const where = [];
    if (day_of_week !== undefined) where.push(`Classes.day_of_week = ${parseInt(day_of_week)}`);
    const gid = safeId(group_id);
    const sid = safeId(student_id);
    if (gid) where.push(`Classes.group_id = ${gid}`);
    if (sid) where.push(`Classes.student_id = ${sid}`);
    if (is_active !== undefined) where.push(`Classes.is_active = ${parseInt(is_active)}`);
    if (class_type) where.push(`Classes.class_type = '${class_type}'`);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = whereSql
      ? await zcql(req, `SELECT * FROM Classes ${whereSql} ORDER BY Classes.day_of_week, Classes.start_time ASC`)
      : null;
    let list;
    if (rows) {
      list = unwrap(rows, 'Classes');
    } else {
      list = await getAll(req, 'Classes');
      list.sort((a, b) => (a.day_of_week - b.day_of_week) || String(a.start_time || '').localeCompare(b.start_time || ''));
    }
    const decorated = await Promise.all(list.map((c) => decorate(req, c)));
    res.json({ classes: decorated });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch classes', detail: e.message });
  }
});

// GET /api/classes/:id
router.get('/:id', async (req, res) => {
  try {
    const cls = await getById(req, 'Classes', req.params.id);
    if (!cls) return res.status(404).json({ error: 'Class not found' });
    const decorated = await decorate(req, cls);
    res.json({ class: decorated });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch class', detail: e.message });
  }
});

// POST /api/classes — supports student_ids[] (multi-student individual) or single student_id, or group_id
router.post('/', async (req, res) => {
  try {
    const { name, group_id, student_id, student_ids, class_type, day_of_week, start_time, end_time, is_active } = req.body;
    if (!name || class_type === undefined || day_of_week === undefined || !start_time || !end_time) {
      return res.status(400).json({ error: 'name, class_type, day_of_week, start_time, end_time are required' });
    }
    if (!VALID_TYPES.includes(class_type)) {
      return res.status(400).json({ error: 'invalid class_type' });
    }
    if (isGroupType(class_type) && !group_id) {
      return res.status(400).json({ error: 'group_id required for group types' });
    }
    const individualIds = Array.isArray(student_ids) && student_ids.length ? student_ids : student_id ? [student_id] : [];
    if (!isGroupType(class_type) && !individualIds.length) {
      return res.status(400).json({ error: 'student_id or student_ids[] required for individual types' });
    }
    const duration_hours = calcDuration(start_time, end_time);
    const baseRow = {
      name,
      group_id: isGroupType(class_type) ? String(group_id) : null,
      student_id: !isGroupType(class_type) && individualIds.length === 1 ? String(individualIds[0]) : null,
      class_type,
      day_of_week: parseInt(day_of_week),
      start_time, end_time,
      duration_hours,
      is_active: is_active !== undefined ? parseInt(is_active) : 1,
    };
    const cls = await insert(req, 'Classes', baseRow);
    // For multi-student individual: create ClassStudents links
    if (!isGroupType(class_type) && individualIds.length > 1) {
      for (const sid of individualIds) {
        try { await insert(req, 'ClassStudents', { class_id: cls.ROWID, student_id: String(sid) }); } catch {}
      }
    }
    const decorated = await decorate(req, cls);
    res.status(201).json({ class: decorated });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create class', detail: e.message });
  }
});

// PUT /api/classes/:id
router.put('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Classes', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Class not found' });
    const { name, group_id, student_id, student_ids, class_type, day_of_week, start_time, end_time, is_active } = req.body;
    const newType = class_type ?? existing.class_type;
    if (!VALID_TYPES.includes(newType)) return res.status(400).json({ error: 'invalid class_type' });
    const finalStart = start_time ?? existing.start_time;
    const finalEnd = end_time ?? existing.end_time;
    const patch = {
      name: name ?? existing.name,
      class_type: newType,
      day_of_week: day_of_week !== undefined ? parseInt(day_of_week) : existing.day_of_week,
      start_time: finalStart,
      end_time: finalEnd,
      duration_hours: calcDuration(finalStart, finalEnd),
      is_active: is_active !== undefined ? parseInt(is_active) : existing.is_active,
      group_id: isGroupType(newType) ? String(group_id ?? existing.group_id) : null,
      student_id: !isGroupType(newType) && student_id !== undefined ? (student_id ? String(student_id) : null) : (isGroupType(newType) ? null : existing.student_id),
    };
    const updated = await update(req, 'Classes', req.params.id, patch);
    // If student_ids[] provided: replace ClassStudents
    if (Array.isArray(student_ids)) {
      try {
        const links = await zcql(req, `SELECT ROWID FROM ClassStudents WHERE ClassStudents.class_id = ${req.params.id}`);
        for (const l of unwrap(links, 'ClassStudents')) {
          try { await remove(req, 'ClassStudents', l.ROWID); } catch {}
        }
      } catch {}
      for (const sid of student_ids) {
        try { await insert(req, 'ClassStudents', { class_id: req.params.id, student_id: String(sid) }); } catch {}
      }
    }
    const decorated = await decorate(req, updated);
    res.json({ class: decorated });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update class', detail: e.message });
  }
});

// DELETE /api/classes/:id  (also removes ClassStudents links)
router.delete('/:id', async (req, res) => {
  try {
    try {
      const links = await zcql(req, `SELECT ROWID FROM ClassStudents WHERE ClassStudents.class_id = ${req.params.id}`);
      for (const l of unwrap(links, 'ClassStudents')) {
        try { await remove(req, 'ClassStudents', l.ROWID); } catch {}
      }
    } catch {}
    await remove(req, 'Classes', req.params.id);
    res.json({ message: 'Class deleted' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete class', detail: e.message });
  }
});

module.exports = router;
