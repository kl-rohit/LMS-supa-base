// /api/students — CRUD against Catalyst Data Store table "Students".

const router = require('express').Router();
const { insert, getById, getAll, update, remove, zcql, zcqlAll, unwrap, normalize, q, appFor, safeId } = require('../db/catalystDb');
const { uploadStudentPhoto, signStoredPhoto } = require('../lib/photoUpload');
const { planMaxStudents, normalizePlan } = require('../lib/plans');
const { studentCapBlock } = require('../lib/studentLimit');

// IMPORTANT: declare specific paths (debug/tables, inactive) BEFORE the /:id
// catch-all so Express routes them correctly.

// GET /api/students/debug/tables — diagnostic: which tables exist + do they
// have the org_id column. Used to verify Phase A schema before running the
// /api/platform/bootstrap migration.
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

  // Tables that should have org_id for multi-tenancy
  const TENANT_TABLES = [
    'Students', 'Groups', 'GroupStudents', 'Classes', 'ClassStudents',
    'Attendance', 'AdditionalFees', 'Payments',
    'Messages', 'MessageTemplates', 'AppSettings',
    'Courses', 'Lessons', 'LessonProgress', 'CourseEnrollments',
    'Camps', 'CampDays',
  ];
  // Multi-tenancy infra tables
  const META_TABLES = ['Organizations', 'OrgMemberships'];

  for (const t of [...META_TABLES, ...TENANT_TABLES]) {
    try {
      const rows = await ds.table(t).getAllRows();
      const info = { exists: true, count: rows.length };
      // Sniff one row for org_id presence (skip META tables — they don't have it)
      if (TENANT_TABLES.includes(t) && rows.length > 0) {
        info.has_org_id = Object.prototype.hasOwnProperty.call(rows[0], 'org_id');
      }
      result.probe[t] = info;
    } catch (e) {
      result.probe[t] = { exists: false, error: e.message };
    }
  }
  res.json(result);
});

// DELETE /api/students/inactive — bulk hard-delete (scoped to caller's org)
router.delete('/inactive', async (req, res) => {
  try {
    const rows = await zcql(req, `SELECT ROWID FROM Students WHERE Students.status = 'inactive' AND Students.org_id = ${Number(req.orgId)}`);
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
    const orgFilter = `Students.org_id = ${Number(req.orgId)}`;
    if (!search && !status && !limit) {
      // Avoid getAll() (table-wide) — it'd return other orgs' rows.
      // zcqlAll drains page-by-page so academies with >300 students aren't
      // silently truncated by ZCQL's 300-row cap (the student pickers across
      // Classes, Enrollments, Attendance, etc. all consume this list).
      const rows = await zcqlAll(req, `SELECT * FROM Students WHERE ${orgFilter} ORDER BY Students.name ASC`, 'Students');
      return res.json({ students: unwrap(rows, 'Students').map(normalize) });
    }
    const where = [orgFilter];
    if (status) where.push(`Students.status = ${q(status)}`);
    if (search) {
      const s = q(`%${search}%`);
      where.push(`(Students.name LIKE ${s} OR Students.parent_name LIKE ${s} OR Students.mobile_number LIKE ${s})`);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
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
    const rows = await zcqlAll(req, `SELECT * FROM Students ${whereSql} ORDER BY Students.name ASC`, 'Students');
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
    // Cross-org protection: row exists, but does it belong to the caller's org?
    if (Number(student.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Student not found' });
    }
    let groups = []; let groupIds = [];
    try {
      const links = await zcql(req, `SELECT GroupStudents.group_id FROM GroupStudents WHERE GroupStudents.student_id = ${req.params.id} AND GroupStudents.org_id = ${Number(req.orgId)}`);
      groupIds = unwrap(links, 'GroupStudents').map((l) => l.group_id).filter(Boolean);
      if (groupIds.length) {
        const gRows = await zcql(req, `SELECT * FROM Groups WHERE ROWID IN (${groupIds.join(',')}) AND Groups.org_id = ${Number(req.orgId)}`);
        groups = unwrap(gRows, 'Groups').map(normalize);
      }
    } catch {}
    let classes = [];
    try {
      const orParts = [`Classes.student_id = ${req.params.id}`];
      if (groupIds.length) orParts.push(`Classes.group_id IN (${groupIds.join(',')})`);
      const cRows = await zcql(req, `SELECT * FROM Classes WHERE (${orParts.join(' OR ')}) AND Classes.org_id = ${Number(req.orgId)}`);
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
    const {
      name, parent_name, mobile_number,
      fee_online, fee_offline, fee_offline_group, min_classes_per_month,
      monthly_fee,
      status, notes, date_of_birth,
      // Self-service / Grade exam fields. Admin can set these too — they're
      // mirrored from what the parent edits in the portal.
      email, address, father_name, mother_name, photo_url,
    } = req.body;
    if (!name || !parent_name || !mobile_number) {
      return res.status(400).json({ error: 'name, parent_name, and mobile_number are required' });
    }
    // Plan cap: only ACTIVE students count toward the limit. Creating an
    // inactive student is always allowed (e.g. archiving an old roster).
    if ((status || 'active') === 'active') {
      const block = await studentCapBlock(req, 1);
      if (block) return res.status(402).json(block);
    }
    const payload = {
      name, parent_name, mobile_number,
      fee_online: fee_online || 0,
      fee_offline: fee_offline || 0,
      fee_offline_group: fee_offline_group || 0,
      min_classes_per_month: min_classes_per_month || 0,
      // Flat per-month fee — used when the academy's billing.fee_mode is
      // 'per_month'. Harmless when the academy bills per class.
      monthly_fee: monthly_fee || 0,
      status: status || 'active',
      notes: notes || '',
      email: email || '',
      address: address || '',
      father_name: father_name || '',
      mother_name: mother_name || '',
      photo_url: photo_url || '',
      org_id: Number(req.orgId),
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
    // Cross-org protection — never let one org modify another's row.
    if (Number(existing.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const {
      name, parent_name, mobile_number,
      fee_online, fee_offline, fee_offline_group, min_classes_per_month,
      monthly_fee,
      status, notes, date_of_birth,
      email, address, father_name, mother_name, photo_url,
    } = req.body;
    // Reactivating an inactive student counts against the plan cap. (A no-op
    // re-save of an already-active student doesn't add to the count.)
    if (status === 'active' && (existing.status || 'active') !== 'active') {
      const block = await studentCapBlock(req, 1);
      if (block) return res.status(402).json(block);
    }
    const patch = {};
    if (name !== undefined)                  patch.name                  = name;
    if (parent_name !== undefined)           patch.parent_name           = parent_name;
    if (mobile_number !== undefined)         patch.mobile_number         = mobile_number;
    if (fee_online !== undefined)            patch.fee_online            = fee_online;
    if (fee_offline !== undefined)           patch.fee_offline           = fee_offline;
    if (fee_offline_group !== undefined)     patch.fee_offline_group     = fee_offline_group;
    if (min_classes_per_month !== undefined) patch.min_classes_per_month = min_classes_per_month;
    if (monthly_fee !== undefined)           patch.monthly_fee           = monthly_fee;
    if (status !== undefined)                patch.status                = status;
    if (notes !== undefined)                 patch.notes                 = notes;
    if (date_of_birth !== undefined)         patch.date_of_birth         = date_of_birth || null;
    if (email !== undefined)                 patch.email                 = email || '';
    if (address !== undefined)               patch.address               = address || '';
    if (father_name !== undefined)           patch.father_name           = father_name || '';
    if (mother_name !== undefined)           patch.mother_name           = mother_name || '';
    if (photo_url !== undefined)             patch.photo_url             = photo_url || '';
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
    if (Number(existing.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Student not found' });
    }
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

// POST /api/students/photo-urls — batch-sign photo URLs for the Students list.
// Body: { ids: [...] }  →  { urls: { '<id>': 'https://...' } }
// Org-scoped — only signs URLs for students that belong to the caller's org.
router.post('/photo-urls', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    if (ids.length === 0) return res.json({ urls: {} });

    const sids = ids.map((id) => safeId(id)).filter(Boolean);
    if (sids.length === 0) return res.json({ urls: {} });
    const rows = await zcql(req, `SELECT ROWID, photo_url FROM Students WHERE ROWID IN (${sids.join(',')}) AND Students.org_id = ${Number(req.orgId)}`);
    const students = unwrap(rows, 'Students');

    const urls = {};
    await Promise.all(students.map(async (s) => {
      const signed = await signStoredPhoto(req, s.photo_url);
      if (signed) urls[String(s.ROWID)] = signed;
    }));

    res.json({ urls });
  } catch (e) {
    res.status(500).json({ error: 'Failed to sign photo URLs', detail: e.message });
  }
});

// POST /api/students/:id/photo — admin uploads a photo on behalf of a student.
router.post('/:id/photo', async (req, res) => {
  try {
    const existing = await getById(req, 'Students', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Student not found' });
    if (Number(existing.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const result = await uploadStudentPhoto(req, req.params.id, req.body);
    res.status(result.status).json(result.json);
  } catch (e) {
    res.status(500).json({ error: 'Failed to upload photo', detail: e.message });
  }
});

// GET /api/students/:id/photo-url — single-student signed URL.
router.get('/:id/photo-url', async (req, res) => {
  try {
    const s = await getById(req, 'Students', req.params.id);
    if (!s) return res.status(404).json({ error: 'Student not found' });
    if (Number(s.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const photo_url = await signStoredPhoto(req, s.photo_url);
    res.json({ photo_url });
  } catch (e) {
    res.status(500).json({ error: 'Failed to sign photo URL', detail: e.message });
  }
});

module.exports = router;
