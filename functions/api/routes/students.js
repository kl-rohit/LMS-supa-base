// /api/students — CRUD against Catalyst Data Store table "Students".

const router = require('express').Router();
const { insert, getById, getAll, update, remove, zcql, zcqlAll, unwrap, normalize, q, appFor, safeId, readCount } = require('../db/catalystDb');
const { uploadStudentPhoto, signStoredPhoto } = require('../lib/photoUpload');
const { planMaxStudents, normalizePlan } = require('../lib/plans');
const { studentCapBlock } = require('../lib/studentLimit');

// IMPORTANT: declare specific paths (debug/tables, inactive) BEFORE the /:id
// catch-all so Express routes them correctly.

// GET /api/students/debug/tables — diagnostic: which tables exist + do they
// have the org_id column. Used to verify Phase A schema before running the
// /api/platform/bootstrap migration.
router.get('/debug/tables', async (req, res) => {
  const { query } = require('../db/pg');
  const result = { tables: null, probe: {} };
  try {
    const t = await query(
      `select table_name from information_schema.tables where table_schema='public' order by table_name`
    );
    result.tables = t.rows.map((r) => ({ name: r.table_name }));
  } catch (e) {
    result.tables_error = e.message;
  }

  // Tables that should have org_id for multi-tenancy (lowercased Postgres names).
  const TENANT_TABLES = [
    'students', 'groups', 'groupstudents', 'classes', 'classstudents',
    'attendance', 'additionalfees', 'payments',
    'messages', 'messagetemplates', 'appsettings',
    'courses', 'lessons', 'lessonprogress', 'courseenrollments',
    'camps', 'campdays',
  ];
  const META_TABLES = ['organizations', 'orgmemberships'];

  for (const t of [...META_TABLES, ...TENANT_TABLES]) {
    try {
      const c = await query(`select count(*)::int n from "${t}"`);
      const info = { exists: true, count: c.rows[0].n };
      if (TENANT_TABLES.includes(t)) {
        const col = await query(
          `select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name='org_id'`,
          [t]
        );
        info.has_org_id = col.rowCount > 0;
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
      const total = readCount(countRows, 'Students', 'total');
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

// --- date helpers for the activity bundle's upcoming-classes math ----------
// All date math is plain JS (no SQL date functions) so it stays portable.
const _pad2 = (n) => String(n).padStart(2, '0');
const _isoDate = (d) => `${d.getFullYear()}-${_pad2(d.getMonth() + 1)}-${_pad2(d.getDate())}`;
function _parseHM(t) {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? { h: parseInt(m[1], 10), mm: parseInt(m[2], 10) } : { h: 0, mm: 0 };
}
function _parseExceptions(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return []; }
}
// Next calendar occurrence of a weekly class from `now`, honouring cancelled /
// moved exceptions. Returns the resolved date + times, or null if it keeps
// rolling past our lookahead window.
function _nextOccurrence(cls, now) {
  const dow = Number(cls.day_of_week);
  if (!Number.isInteger(dow) || dow < 0 || dow > 6) return null;
  const { h, mm } = _parseHM(cls.start_time);
  const exceptions = _parseExceptions(cls.exceptions);
  let d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const delta = (dow - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + delta);
  // If the class day is today but its start time has already passed, roll to
  // next week so we never surface a class that has already begun.
  if (delta === 0) {
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, mm);
    if (now.getTime() > startToday.getTime()) d.setDate(d.getDate() + 7);
  }
  let start_time = cls.start_time;
  let end_time = cls.end_time;
  // Resolve exceptions: cancelled occurrences roll forward a week; a moved
  // occurrence relocates to its new date/time. Bounded loop so a run of
  // cancellations can never spin forever.
  for (let i = 0; i < 12; i++) {
    const ds = _isoDate(d);
    const ex = exceptions.find((e) => e && e.date === ds);
    if (!ex) break;
    if (ex.status === 'cancelled') { d.setDate(d.getDate() + 7); continue; }
    if (ex.status === 'moved') {
      if (ex.new_date) {
        const [Y, M, D] = String(ex.new_date).split('-').map(Number);
        if (Y && M && D) d = new Date(Y, M - 1, D);
      }
      if (ex.new_start_time) start_time = ex.new_start_time;
      if (ex.new_end_time) end_time = ex.new_end_time;
    }
    break;
  }
  const hm = _parseHM(start_time);
  const ts = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hm.h, hm.mm).getTime();
  return { next_date: _isoDate(d), start_time, end_time, ts };
}
function _nextLabel(iso, now) {
  const today = _isoDate(now);
  const tmrw = _isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  if (iso === today) return 'Today';
  if (iso === tmrw) return 'Tomorrow';
  const [Y, M, D] = iso.split('-').map(Number);
  return new Date(Y, M - 1, D).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

// GET /api/students/:id/activity — one bundle of the student's cross-module
// activity for the detail panel: groups, upcoming classes, attendance summary,
// and quizzes taken. Each sub-section is independently guarded so a missing
// table (or empty data) degrades to []/zeros rather than 500-ing the panel.
router.get('/:id/activity', async (req, res) => {
  try {
    const student = await getById(req, 'Students', req.params.id);
    if (!student || Number(student.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const sid = req.params.id;
    const orgId = Number(req.orgId);

    // Groups the student is in (+ ids, reused for the class lookup / via label).
    let groups = []; let groupIds = []; const groupNameById = new Map();
    try {
      const links = await zcql(req, `SELECT GroupStudents.group_id FROM GroupStudents WHERE GroupStudents.student_id = ${sid} AND GroupStudents.org_id = ${orgId}`);
      groupIds = unwrap(links, 'GroupStudents').map((l) => l.group_id).filter(Boolean);
      if (groupIds.length) {
        const gRows = await zcql(req, `SELECT * FROM Groups WHERE ROWID IN (${groupIds.join(',')}) AND Groups.org_id = ${orgId}`);
        groups = unwrap(gRows, 'Groups').map(normalize).map((g) => {
          groupNameById.set(String(g.id), g.name);
          return { id: g.id, name: g.name };
        });
      }
    } catch { groups = []; groupIds = []; }

    // Upcoming classes: the next occurrence of each ACTIVE class the student is
    // in (directly via student_id, or through one of their groups).
    let upcoming_classes = [];
    try {
      const orParts = [`Classes.student_id = ${sid}`];
      if (groupIds.length) orParts.push(`Classes.group_id IN (${groupIds.join(',')})`);
      const cRows = await zcql(req, `SELECT * FROM Classes WHERE (${orParts.join(' OR ')}) AND Classes.is_active = 1 AND Classes.org_id = ${orgId}`);
      const classes = unwrap(cRows, 'Classes').map(normalize);
      const now = new Date();
      upcoming_classes = classes.map((c) => {
        const occ = _nextOccurrence(c, now);
        if (!occ) return null;
        const via = String(c.student_id) === String(sid)
          ? 'direct'
          : (groupNameById.get(String(c.group_id)) || 'group');
        return {
          id: c.id,
          name: c.name,
          class_type: c.class_type,
          day_of_week: c.day_of_week,
          start_time: occ.start_time,
          end_time: occ.end_time,
          next_date: occ.next_date,
          next_label: _nextLabel(occ.next_date, now),
          via,
          _ts: occ.ts,
        };
      }).filter(Boolean)
        .sort((a, b) => a._ts - b._ts)
        .slice(0, 8)
        .map(({ _ts, ...rest }) => rest);
    } catch { upcoming_classes = []; }

    // Attendance summary + the 5 most recent marks.
    let attendance = { total: 0, present: 0, absent: 0, rate: 0, recent: [] };
    try {
      const aRows = await zcqlAll(req, `SELECT * FROM Attendance WHERE Attendance.student_id = ${sid} AND Attendance.org_id = ${orgId} ORDER BY Attendance.class_date DESC`, 'Attendance');
      const list = unwrap(aRows, 'Attendance').map(normalize);
      const total = list.length;
      const present = list.filter((a) => a.status === 'present').length;
      const absent = list.filter((a) => a.status === 'absent').length;
      attendance = {
        total,
        present,
        absent,
        rate: total > 0 ? Math.round((present / total) * 100) : 0,
        recent: list.slice(0, 5).map((a) => ({ date: a.class_date, status: a.status, topic: a.topic || '' })),
      };
    } catch { attendance = { total: 0, present: 0, absent: 0, rate: 0, recent: [] }; }

    // Quizzes taken (one row per lesson attempted), newest first, with the
    // lesson title resolved in a single batched Lessons read.
    let quizzes = [];
    try {
      const qRows = await zcql(req, `SELECT * FROM QuizAttempts WHERE QuizAttempts.student_id = ${sid} AND QuizAttempts.org_id = ${orgId} ORDER BY QuizAttempts.MODIFIEDTIME DESC`);
      const attempts = unwrap(qRows, 'QuizAttempts').map(normalize);
      const lessonName = new Map();
      const lids = [...new Set(attempts.map((a) => safeId(a.lesson_id)).filter(Boolean))];
      if (lids.length) {
        try {
          const lRows = await zcql(req, `SELECT ROWID, title FROM Lessons WHERE ROWID IN (${lids.join(',')}) AND Lessons.org_id = ${orgId}`);
          for (const l of unwrap(lRows, 'Lessons').map(normalize)) lessonName.set(String(l.id), l.title || '');
        } catch { /* Lessons table absent */ }
      }
      quizzes = attempts.map((a) => ({
        lesson_id: a.lesson_id ? String(a.lesson_id) : '',
        lesson_name: lessonName.get(String(a.lesson_id)) || 'Quiz',
        score: Number(a.score) || 0,
        correct_count: Number(a.correct_count) || 0,
        total_questions: Number(a.total_questions) || 0,
        attempts: Number(a.attempts) || 0,
        passed: a.passed === true || a.passed === 1,
        date: a.updated_at || a.created_at || null,
      }));
    } catch { quizzes = []; }

    res.json({ groups, upcoming_classes, attendance, quizzes });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch student activity', detail: e.message });
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
