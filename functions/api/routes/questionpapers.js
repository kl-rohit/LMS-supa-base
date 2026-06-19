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

function shape(row) {
  const n = normalize(row);
  return {
    id: n.id,
    title: n.title || '',
    description: n.description || '',
    link: n.link || '',
    category: n.category || '',
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
