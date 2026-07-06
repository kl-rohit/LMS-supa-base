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

// Question types (Tier 2). Legacy rows have no question_type → 'single'.
const VALID_QTYPES = ['single', 'truefalse', 'multi', 'short'];
const normShort = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// correct_answers JSON: 'multi' → array of option indices; 'short' → array of
// accepted answer strings.
function parseCorrect(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return []; }
}

// Points earned for one answer (0..points). ans shape by type:
//   single/truefalse → option index (number); multi → array of indices;
//   short → typed string.
function gradeQuestion(q, ans) {
  const type = VALID_QTYPES.includes(q.question_type) ? q.question_type : 'single';
  const points = Number(q.points) > 0 ? Number(q.points) : 1;
  if (type === 'multi') {
    const correct = new Set(parseCorrect(q.correct_answers).map(Number));
    const given = new Set((Array.isArray(ans) ? ans : []).map(Number));
    const ok = correct.size > 0 && correct.size === given.size && [...correct].every((i) => given.has(i));
    return ok ? points : 0; // all-or-nothing
  }
  if (type === 'short') {
    const accepted = parseCorrect(q.correct_answers).map(normShort).filter(Boolean);
    const given = normShort(ans);
    return given && accepted.includes(given) ? points : 0;
  }
  const sel = (ans === undefined || ans === null) ? -1 : Number(ans);
  return sel === (Number(q.correct_index) || 0) ? points : 0;
}

// Grade a whole attempt. answers = { "<questionId>": <answer> }. Weighted by
// per-question points; returns score% + per-question results for review.
function gradeAttempt(questions, answers = {}) {
  let earned = 0; let total = 0; let correctCount = 0;
  const results = questions.map((q) => {
    const type = VALID_QTYPES.includes(q.question_type) ? q.question_type : 'single';
    const points = Number(q.points) > 0 ? Number(q.points) : 1;
    const ans = answers[String(q.id)];
    const got = gradeQuestion(q, ans);
    total += points; earned += got;
    const isCorrect = points > 0 && got >= points;
    if (isCorrect) correctCount += 1;
    return {
      id: q.id,
      question_type: type,
      points,
      earned: got,
      is_correct: isCorrect,
      correct_index: Number(q.correct_index) || 0,
      correct_answers: parseCorrect(q.correct_answers),
      // Legacy field kept for the current single-choice review UI.
      selected_index: (type === 'multi' || type === 'short') ? -1 : ((ans === undefined || ans === null) ? -1 : Number(ans)),
      selected: ans === undefined ? null : ans,
      explanation: q.explanation || '',
    };
  });
  const score = total > 0 ? Math.round((earned / total) * 100) : 0;
  return { score, earnedPoints: earned, totalPoints: total, correctCount, results };
}

// Shape a stored row for the ADMIN side (includes the answer key).
function shapeForAdmin(row) {
  const n = normalize(row);
  return {
    id: n.id,
    lesson_id: n.lesson_id,
    question: n.question || '',
    question_type: VALID_QTYPES.includes(n.question_type) ? n.question_type : 'single',
    options: parseOptions(n.options),
    correct_index: Number(n.correct_index) || 0,
    correct_answers: parseCorrect(n.correct_answers),
    points: Number(n.points) > 0 ? Number(n.points) : 1,
    explanation: n.explanation || '',
    order_index: Number(n.order_index) || 0,
  };
}

// Build the type-specific columns to persist from a request body. Returns
// { error } on invalid input, else { fields } to spread into insert/update.
function buildQuestionFields(body, existing = {}) {
  const type = VALID_QTYPES.includes(body.question_type) ? body.question_type : (existing.question_type || 'single');
  const points = Number(body.points) > 0 ? Math.floor(Number(body.points)) : (Number(existing.points) > 0 ? Number(existing.points) : 1);
  const fields = { question_type: type, points, correct_answers: null, correct_index: 0 };

  if (type === 'short') {
    const accepted = (Array.isArray(body.correct_answers) ? body.correct_answers : [])
      .map((s) => String(s ?? '').trim()).filter(Boolean);
    if (accepted.length === 0) return { error: 'Add at least one accepted answer' };
    fields.options = JSON.stringify([]);
    fields.correct_answers = JSON.stringify(accepted);
    return { fields };
  }

  // single / truefalse / multi all use options
  let opts = Array.isArray(body.options) ? body.options.map((o) => String(o ?? '').trim()) : [];
  if (type === 'truefalse') opts = ['True', 'False'];
  else opts = opts.filter((o) => o.length > 0);
  if (opts.length < 2) return { error: 'At least 2 options are required' };
  fields.options = JSON.stringify(opts);

  if (type === 'multi') {
    const idx = (Array.isArray(body.correct_answers) ? body.correct_answers : [])
      .map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < opts.length);
    if (idx.length === 0) return { error: 'Mark at least one correct option' };
    fields.correct_answers = JSON.stringify([...new Set(idx)]);
  } else {
    let ci = Number(body.correct_index);
    if (!Number.isInteger(ci) || ci < 0 || ci >= opts.length) ci = 0;
    fields.correct_index = ci;
  }
  return { fields };
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
// Body: { lesson_id, question, question_type, options[], correct_index,
//         correct_answers[], points, explanation, order_index }
router.post('/', async (req, res) => {
  try {
    const { lesson_id, question, explanation, order_index } = req.body;
    if (!lesson_id || !question) {
      return res.status(400).json({ error: 'lesson_id and question are required' });
    }
    if (!(await lessonInOrg(req, lesson_id))) {
      return res.status(404).json({ error: 'Lesson not found' });
    }
    const built = buildQuestionFields(req.body);
    if (built.error) return res.status(400).json({ error: built.error });

    // Default order_index = append to end.
    let nextOrder = Number(order_index);
    if (!Number.isFinite(nextOrder)) {
      const existing = await loadLessonQuiz(req, lesson_id);
      nextOrder = existing.reduce((m, q) => Math.max(m, Number(q.order_index) || 0), 0) + 1;
    }

    const row = await insert(req, 'LessonQuizzes', {
      lesson_id: String(lesson_id),
      question: String(question).trim(),
      explanation: explanation ? String(explanation).trim() : '',
      order_index: nextOrder,
      ...built.fields,
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
    const patch = {};
    if (req.body.question !== undefined) patch.question = String(req.body.question).trim();
    if (req.body.explanation !== undefined) patch.explanation = String(req.body.explanation).trim();
    if (req.body.order_index !== undefined) patch.order_index = Number(req.body.order_index) || 0;
    // Rebuild the type-specific columns whenever any answer-shaping field is sent.
    const shapingKeys = ['question_type', 'options', 'correct_index', 'correct_answers', 'points'];
    if (shapingKeys.some((k) => req.body[k] !== undefined)) {
      const built = buildQuestionFields(req.body, normalize(existing));
      if (built.error) return res.status(400).json({ error: built.error });
      Object.assign(patch, built.fields);
    }
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
module.exports.gradeAttempt = gradeAttempt;
module.exports.PASS_THRESHOLD = PASS_THRESHOLD;
