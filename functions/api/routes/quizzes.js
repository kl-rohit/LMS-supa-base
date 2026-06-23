// /api/quizzes — Admin CRUD for per-lesson MCQ quiz questions.
// Org-scoped via resolveOrg. Mounted in index.js alongside the other tenant
// routes. The STUDENT-facing side (fetch quiz without answers, submit attempt)
// lives in routes/portal.js so it stays under requireParent.
//
// Data model:
//   LessonQuizzes  — one row per question
//     lesson_id (Bigint), question (Text), options (Text, JSON array string),
//     correct_index (Int), explanation (Text), order_index (Int), org_id (Bigint)
//   QuizAttempts   — one row per student × lesson (upserted on each submit)
//     student_id (Bigint), lesson_id (Bigint), score (Int, 0-100),
//     total_questions (Int), correct_count (Int), attempts (Int),
//     passed (Boolean), org_id (Bigint)
//
// Both tables degrade gracefully: every read is wrapped so a not-yet-created
// table returns an empty result instead of 500-ing the whole Lessons page.

const router = require('express').Router();
const { insert, getById, update, remove, zcql, unwrap, normalize, safeId } = require('../db/catalystDb');
const config = require('../config');

const PASS_THRESHOLD = config.QUIZ_PASS_THRESHOLD; // percent — shared with portal submit scoring

// Verify the parent lesson belongs to req.orgId before mutating its quiz.
async function lessonInOrg(req, lessonId) {
  try {
    const l = await getById(req, 'Lessons', lessonId);
    return l && Number(l.org_id) === Number(req.orgId);
  } catch {
    return false;
  }
}

// Parse the stored options JSON string into an array. Defensive — bad/empty
// data yields [] rather than throwing.
function parseOptions(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map((o) => String(o)) : [];
  } catch {
    return [];
  }
}

// Shape a stored row for the ADMIN side (includes correct_index + explanation).
function shapeForAdmin(row) {
  const n = normalize(row);
  return {
    id: n.id,
    lesson_id: n.lesson_id,
    question: n.question || '',
    options: parseOptions(n.options),
    correct_index: Number(n.correct_index) || 0,
    explanation: n.explanation || '',
    order_index: Number(n.order_index) || 0,
  };
}

// Load every quiz question for a lesson, ordered. Returns [] if the table
// doesn't exist yet. Exported so portal.js can reuse the exact same loader.
async function loadLessonQuiz(req, lessonId) {
  const lid = safeId(lessonId);
  if (!lid) return [];
  try {
    const rows = await zcql(
      req,
      `SELECT * FROM LessonQuizzes WHERE LessonQuizzes.lesson_id = ${lid} AND LessonQuizzes.org_id = ${Number(req.orgId)} ORDER BY LessonQuizzes.order_index ASC`
    );
    return unwrap(rows, 'LessonQuizzes').map(normalize);
  } catch {
    return [];
  }
}

// GET /api/quizzes?lesson_id=X — admin authoring list (with answers).
router.get('/', async (req, res) => {
  try {
    const lid = safeId(req.query.lesson_id);
    if (!lid) return res.status(400).json({ error: 'lesson_id is required' });
    if (!(await lessonInOrg(req, lid))) return res.json({ questions: [] });
    const rows = await loadLessonQuiz(req, lid);
    res.json({ questions: rows.map(shapeForAdmin) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch quiz', detail: e.message });
  }
});

// POST /api/quizzes — create one question.
// Body: { lesson_id, question, options[], correct_index, explanation, order_index }
router.post('/', async (req, res) => {
  try {
    const { lesson_id, question, options, correct_index, explanation, order_index } = req.body;
    if (!lesson_id || !question || !Array.isArray(options) || options.length < 2) {
      return res.status(400).json({ error: 'lesson_id, question, and at least 2 options are required' });
    }
    if (!(await lessonInOrg(req, lesson_id))) {
      return res.status(404).json({ error: 'Lesson not found' });
    }
    const cleanOptions = options.map((o) => String(o ?? '').trim()).filter((o) => o.length > 0);
    if (cleanOptions.length < 2) {
      return res.status(400).json({ error: 'At least 2 non-empty options are required' });
    }
    let ci = Number(correct_index);
    if (!Number.isInteger(ci) || ci < 0 || ci >= cleanOptions.length) ci = 0;

    // Default order_index = append to end.
    let nextOrder = Number(order_index);
    if (!Number.isFinite(nextOrder)) {
      const existing = await loadLessonQuiz(req, lesson_id);
      nextOrder = existing.reduce((m, q) => Math.max(m, Number(q.order_index) || 0), 0) + 1;
    }

    const row = await insert(req, 'LessonQuizzes', {
      lesson_id: String(lesson_id),
      question: String(question).trim(),
      options: JSON.stringify(cleanOptions),
      correct_index: ci,
      explanation: explanation ? String(explanation).trim() : '',
      order_index: nextOrder,
      org_id: Number(req.orgId),
    });
    res.status(201).json({ question: shapeForAdmin(row) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create question', detail: e.message });
  }
});

// PUT /api/quizzes/:id — update a question.
router.put('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'LessonQuizzes', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Question not found' });
    }
    const { question, options, correct_index, explanation, order_index } = req.body;
    const patch = {};
    if (question !== undefined) patch.question = String(question).trim();
    let optionCount = parseOptions(existing.options).length;
    if (options !== undefined) {
      const cleanOptions = (Array.isArray(options) ? options : [])
        .map((o) => String(o ?? '').trim()).filter((o) => o.length > 0);
      if (cleanOptions.length < 2) {
        return res.status(400).json({ error: 'At least 2 non-empty options are required' });
      }
      patch.options = JSON.stringify(cleanOptions);
      optionCount = cleanOptions.length;
    }
    if (correct_index !== undefined) {
      let ci = Number(correct_index);
      if (!Number.isInteger(ci) || ci < 0 || ci >= optionCount) ci = 0;
      patch.correct_index = ci;
    }
    if (explanation !== undefined) patch.explanation = String(explanation).trim();
    if (order_index !== undefined) patch.order_index = Number(order_index) || 0;
    const updated = await update(req, 'LessonQuizzes', req.params.id, patch);
    res.json({ question: shapeForAdmin(updated) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update question', detail: e.message });
  }
});

// DELETE /api/quizzes/:id
router.delete('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'LessonQuizzes', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Question not found' });
    }
    await remove(req, 'LessonQuizzes', req.params.id);
    res.json({ message: 'Question deleted' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete question', detail: e.message });
  }
});

module.exports = router;
module.exports.loadLessonQuiz = loadLessonQuiz;
module.exports.parseOptions = parseOptions;
module.exports.PASS_THRESHOLD = PASS_THRESHOLD;
