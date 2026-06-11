// /api/students — CRUD against Catalyst Data Store table "Students".

const router = require('express').Router();
const { insert, getById, getAll, update, remove, zcql, unwrap, normalize, q, appFor } = require('../db/catalystDb');

// IMPORTANT: declare specific paths (debug/tables, inactive) BEFORE the /:id
// catch-all so Express routes them correctly.

// GET /api/students/debug/tables — diagnostic: which tables exist?
router.get('/debug/tables', async (req, res) => {
  const result = { tried: [], tables: null, probe: {} };
  const ds = appFor(req).datastore();
  for (const m of ['getAllTables', 'getAllTableDetails']) {
    if (typeof ds[m] === 'function') {
      try {
        const out = await ds[m]();
        result.tried.push({ method: m, ok: true, count: Array.isArray(out) ? out.length : null });
        if (Array.isArray(out)) {
          result.tables = out.map((t) => ({
            name: (typeof t.getTableName === 'function' && t.getTableName()) || t.table_name || t.name || null,
          }));
          break;
        }
      } catch (e) {
        result.tried.push({ method: m, ok: false, error: e.message });
      }
    }
  }
  for (const t of ['Students', 'Groups', 'GroupStudents', 'Classes', 'ClassStudents', 'Attendance', 'AdditionalFees', 'Messages']) {
    try {
      const rows = await ds.table(t).getAllRows();
      result.probe[t] = { exists: true, count: rows.length };
    } catch (e) {
      result.probe[t] = { exists: false, error: e.message };
    }
  }
  res.json(result);
});

// DELETE /api/students/inactive — bulk hard-delete
router.delete('/inactive', async (req, res) => {
  try {
    const rows = await zcql(req, `SELECT ROWID FROM Students WHERE Students.status = 'inactive'`);
    const ids = unwrap(rows, 'Students').map((r) => r.ROWID);
    let deleted = 0;
    for (const id of ids) {
      try { await remove(req, 'Students', id); deleted++; } catch {}
    }
    res.json({ message: `Deleted ${deleted} inactive student(s)`, count: deleted });
  } catch (e) {
    res.status(500).json({ error: 'Failed to bulk-delete inactive', detail: e.message });
  }
});

// GET /api/students
router.get('/', async (req, res) => {
  try {
    const { search, status, page, limit } = req.query;
    if (!search && !status && !limit) {
      const rows = await getAll(req, 'Students');
      rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
      return res.json({ students: rows.map(normalize) });
    }
    const where = [];
    if (status) where.push(`Students.status = ${q(status)}`);
    if (search) {
      const s = q(`%${search}%`);
      where.push(`(Students.name LIKE ${s} OR Students.parent_name LIKE ${s} OR Students.mobile_number LIKE ${s})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    if (limit) {
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit);
      const offset = (pageNum - 1) * limitNum;
      const countRows = await zcql(req, `SELECT COUNT(ROWID) AS total FROM Students ${whereSql}`);
      const total = countRows[0]?.Students?.total || 0;
      const rows = await zcql(req, `SELECT * FROM Students ${whereSql} ORDER BY Students.name ASC LIMIT ${limitNum} OFFSET ${offset}`);
      return res.json({
        students: unwrap(rows, 'Students').map(normalize),
        pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
      });
    }
    const rows = await zcql(req, `SELECT * FROM Students ${whereSql} ORDER BY Students.name ASC`);
    res.json({ students: unwrap(rows, 'Students').map(normalize) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch students', detail: e.message });
  }
});

// GET /api/students/:id
router.get('/:id', async (req, res) => {
  try {
    const student = await getById(req, 'Students', req.params.id);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    let groups = []; let groupIds = [];
    try {
      const links = await zcql(req, `SELECT GroupStudents.group_id FROM GroupStudents WHERE GroupStudents.student_id = ${req.params.id}`);
      groupIds = unwrap(links, 'GroupStudents').map((l) => l.group_id).filter(Boolean);
      if (groupIds.length) {
        const gRows = await zcql(req, `SELECT * FROM Groups WHERE ROWID IN (${groupIds.join(',')})`);
        groups = unwrap(gRows, 'Groups').map(normalize);
      }
    } catch {}
    let classes = [];
    try {
      const orParts = [`Classes.student_id = ${req.params.id}`];
      if (groupIds.length) orParts.push(`Classes.group_id IN (${groupIds.join(',')})`);
      const cRows = await zcql(req, `SELECT * FROM Classes WHERE ${orParts.join(' OR ')}`);
      classes = unwrap(cRows, 'Classes').map(normalize);
    } catch {}
    res.json({ student: normalize(student), groups, classes });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch student', detail: e.message });
  }
});

// POST /api/students
router.post('/', async (req, res) => {
  try {
    const { name, parent_name, mobile_number, fee_online, fee_offline, fee_offline_group, min_classes_per_month, status, notes, date_of_birth } = req.body;
    if (!name || !parent_name || !mobile_number) {
      return res.status(400).json({ error: 'name, parent_name, and mobile_number are required' });
    }
    const payload = {
      name, parent_name, mobile_number,
      fee_online: fee_online || 0,
      fee_offline: fee_offline || 0,
      fee_offline_group: fee_offline_group || 0,
      min_classes_per_month: min_classes_per_month || 0,
      status: status || 'active',
      notes: notes || '',
    };
    // Only set date_of_birth if provided — Catalyst rejects empty strings on Date columns
    if (date_of_birth) payload.date_of_birth = date_of_birth;
    const student = await insert(req, 'Students', payload);
    res.status(201).json({ student: normalize(student) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create student', detail: e.message });
  }
});

// PUT /api/students/:id
router.put('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Students', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Student not found' });
    const { name, parent_name, mobile_number, fee_online, fee_offline, fee_offline_group, min_classes_per_month, status, notes, date_of_birth } = req.body;
    const patch = {};
    if (name !== undefined)                  patch.name                  = name;
    if (parent_name !== undefined)           patch.parent_name           = parent_name;
    if (mobile_number !== undefined)         patch.mobile_number         = mobile_number;
    if (fee_online !== undefined)            patch.fee_online            = fee_online;
    if (fee_offline !== undefined)           patch.fee_offline           = fee_offline;
    if (fee_offline_group !== undefined)     patch.fee_offline_group     = fee_offline_group;
    if (min_classes_per_month !== undefined) patch.min_classes_per_month = min_classes_per_month;
    if (status !== undefined)                patch.status                = status;
    if (notes !== undefined)                 patch.notes                 = notes;
    if (date_of_birth !== undefined)         patch.date_of_birth         = date_of_birth || null;
    const updated = await update(req, 'Students', req.params.id, patch);
    res.json({ student: normalize(updated) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update student', detail: e.message });
  }
});

// DELETE /api/students/:id?force=true
router.delete('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Students', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Student not found' });
    const force = req.query.force === 'true' || req.query.force === '1';
    if (force) {
      await remove(req, 'Students', req.params.id);
      return res.json({ message: 'Student permanently deleted' });
    }
    await update(req, 'Students', req.params.id, { status: 'inactive' });
    res.json({ message: 'Student deactivated successfully' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete student', detail: e.message });
  }
});

module.exports = router;
