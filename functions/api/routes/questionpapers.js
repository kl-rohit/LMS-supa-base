// /api/question-papers — Admin CRUD for question papers (past papers, practice
// sets, sample exams). Org-scoped via resolveOrg. Parents read them through
// routes/portal.js (GET /api/portal/question-papers).
//
// External-link model (matches the lessons pattern): each paper is a title +
// optional description + a link to a PDF/Drive file the teacher hosts. No file
// storage to provision.
//
// Data model:
//   QuestionPapers
//     title (Text), description (Text), link (Text), category (Text),
//     org_id (Bigint)
//
// Reads degrade gracefully: a not-yet-created table returns [] rather than 500.

const router = require('express').Router();
const { insert, getById, update, remove, zcqlAll, unwrap, normalize } = require('../db/catalystDb');

// Targeting (who sees the paper) mirrors Assignments: all / group / student /
// students (multi). Stored as target_type + target_id (group/single) or
// target_ids (JSON array for the multi-select). Legacy rows have no target_type
// → treated as 'all' (visible to everyone), so nothing changes for old papers.
const VALID_TARGETS = ['all', 'group', 'student', 'students'];
function parseTargetIds(v) {
  if (Array.isArray(v)) return v.map(String);
  if (!v) return [];
  try { const a = JSON.parse(v); return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
}
// Resolve the targeting columns to persist from a request body.
function targetingFromBody(body) {
  const t = VALID_TARGETS.includes(body.target_type) ? body.target_type : 'all';
  const out = { target_type: t, target_id: null, target_ids: null };
  if (t === 'group' || t === 'student') out.target_id = body.target_id ? String(body.target_id) : null;
  if (t === 'students') {
    const ids = Array.isArray(body.target_ids) ? body.target_ids.map(String).filter(Boolean) : [];
    out.target_ids = ids.length ? JSON.stringify(ids) : null;
  }
  return out;
}

function shape(row) {
  const n = normalize(row);
  return {
    id: n.id,
    title: n.title || '',
    description: n.description || '',
    link: n.link || '',
    category: n.category || '',
    target_type: VALID_TARGETS.includes(n.target_type) ? n.target_type : 'all',
    target_id: n.target_id ? String(n.target_id) : '',
    target_ids: parseTargetIds(n.target_ids),
    created_time: n.CREATEDTIME || n.created_time || '',
  };
}

async function loadPapers(req) {
  try {
    const rows = await zcqlAll(
      req,
      `SELECT * FROM QuestionPapers WHERE QuestionPapers.org_id = ${Number(req.orgId)}`,
      'QuestionPapers'
    );
    return unwrap(rows, 'QuestionPapers').map(normalize);
  } catch {
    return [];
  }
}

// GET /api/question-papers
router.get('/', async (req, res) => {
  try {
    const rows = await loadPapers(req);
    rows.sort((a, b) => String(b.CREATEDTIME || '').localeCompare(String(a.CREATEDTIME || '')));
    res.json({ papers: rows.map(shape) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch question papers', detail: e.message });
  }
});

// POST /api/question-papers
router.post('/', async (req, res) => {
  try {
    const title = String(req.body.title ?? '').trim();
    const link = String(req.body.link ?? '').trim();
    if (!title) return res.status(400).json({ error: 'Title is required' });
    if (!link) return res.status(400).json({ error: 'A link to the paper is required' });
    const row = await insert(req, 'QuestionPapers', {
      title,
      description: String(req.body.description ?? '').trim(),
      link,
      category: String(req.body.category ?? '').trim(),
      ...targetingFromBody(req.body),
      org_id: Number(req.orgId),
    });
    res.status(201).json({ paper: shape(row) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create question paper', detail: e.message });
  }
});

// PUT /api/question-papers/:id
router.put('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'QuestionPapers', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Question paper not found' });
    }
    const patch = {};
    if (req.body.title !== undefined) {
      const title = String(req.body.title).trim();
      if (!title) return res.status(400).json({ error: 'Title is required' });
      patch.title = title;
    }
    if (req.body.link !== undefined) {
      const link = String(req.body.link).trim();
      if (!link) return res.status(400).json({ error: 'A link to the paper is required' });
      patch.link = link;
    }
    if (req.body.description !== undefined) patch.description = String(req.body.description).trim();
    if (req.body.category !== undefined) patch.category = String(req.body.category).trim();
    if (req.body.target_type !== undefined) Object.assign(patch, targetingFromBody(req.body));
    const updated = await update(req, 'QuestionPapers', req.params.id, patch);
    res.json({ paper: shape(updated) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update question paper', detail: e.message });
  }
});

// DELETE /api/question-papers/:id
router.delete('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'QuestionPapers', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Question paper not found' });
    }
    await remove(req, 'QuestionPapers', req.params.id);
    res.json({ message: 'Question paper deleted' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete question paper', detail: e.message });
  }
});

module.exports = router;
module.exports.loadPapers = loadPapers;
module.exports.shape = shape;
