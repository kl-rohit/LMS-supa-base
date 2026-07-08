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

// Parse the stored per-quiz grade bands JSON into an array (or null).
function parseGradeBands(raw) {
  if (Array.isArray(raw)) return raw.length ? raw : null;
  if (!raw) return null;
  try { const a = JSON.parse(raw); return Array.isArray(a) && a.length ? a : null; } catch { return null; }
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
    const lesson = await getById(req, 'Lessons', lid);
    if (!lesson || Number(lesson.org_id) !== Number(req.orgId)) return res.json({ questions: [], settings: null });
    const rows = await loadLessonQuiz(req, lid);
    const n = normalize(lesson);
    res.json({
      questions: rows.map(shapeForAdmin),
      settings: {
        quiz_required: n.quiz_required === true || n.quiz_required === 1,
        quiz_shuffle: n.quiz_shuffle === true || n.quiz_shuffle === 1,
        quiz_shuffle_options: n.quiz_shuffle_options === true || n.quiz_shuffle_options === 1,
        quiz_pass_mark: Number(n.quiz_pass_mark) > 0 ? Number(n.quiz_pass_mark) : null,
        quiz_grade_bands: parseGradeBands(n.quiz_grade_bands),
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch quiz', detail: e.message });
  }
});

// GET /api/quizzes/:lessonId/detail — everything for the admin detail panel:
// the questions (with answer key), what the quiz is attached to (course /
// assignment / standalone), and every student who has attempted it.
router.get('/:lessonId/detail', async (req, res) => {
  try {
    const lid = safeId(req.params.lessonId);
    if (!lid) return res.status(400).json({ error: 'lesson_id is required' });
    const lesson = await getById(req, 'Lessons', lid);
    if (!lesson || Number(lesson.org_id) !== Number(req.orgId)) return res.status(404).json({ error: 'Quiz not found' });
    const n = normalize(lesson);

    const questions = (await loadLessonQuiz(req, lid)).map(shapeForAdmin);

    // Association: a quiz belongs to a course (course_id), else to whatever
    // assignment(s) reference it (quiz_lesson_id), else it is standalone.
    let association = { kind: 'standalone', name: '' };
    if (n.course_id) {
      let courseTitle = '';
      try {
        const c = await getById(req, 'Courses', n.course_id);
        if (c && Number(c.org_id) === Number(req.orgId)) courseTitle = normalize(c).title || '';
      } catch { /* deleted course */ }
      association = { kind: 'course', name: courseTitle || 'Course' };
    } else {
      try {
        const arows = await zcql(req, `SELECT ROWID, title FROM Assignments WHERE Assignments.quiz_lesson_id = ${lid} AND Assignments.org_id = ${Number(req.orgId)}`);
        const names = unwrap(arows, 'Assignments').map(normalize).map((a) => a.title).filter(Boolean);
        if (names.length) association = { kind: 'assignment', name: names.join(', ') };
      } catch { /* assignments table absent */ }
    }

    // Attempts — one row per student who has answered (QuizAttempts).
    let attempts = [];
    try {
      const rows = await zcql(req, `SELECT * FROM QuizAttempts WHERE QuizAttempts.lesson_id = ${lid} AND QuizAttempts.org_id = ${Number(req.orgId)} ORDER BY QuizAttempts.MODIFIEDTIME DESC`);
      const list = unwrap(rows, 'QuizAttempts').map(normalize);
      const sids = [...new Set(list.map((a) => safeId(a.student_id)).filter(Boolean))];
      const nameById = new Map();
      if (sids.length) {
        try {
          const srows = await zcql(req, `SELECT ROWID, name FROM Students WHERE Students.org_id = ${Number(req.orgId)} AND Students.ROWID IN (${sids.join(',')})`);
          for (const s of unwrap(srows, 'Students').map(normalize)) nameById.set(String(s.id), s.name || '');
        } catch { /* ignore */ }
      }
      attempts = list.map((a) => ({
        student_id: String(a.student_id),
        student_name: nameById.get(String(a.student_id)) || 'Student',
        score: Number(a.score) || 0,
        correct_count: Number(a.correct_count) || 0,
        total_questions: Number(a.total_questions) || 0,
        attempts: Number(a.attempts) || 0,
        passed: a.passed === true || a.passed === 1,
        submitted_at: a.updated_at || a.created_at || null,
      }));
    } catch { /* QuizAttempts absent */ }

    res.json({
      quiz: {
        id: n.id,
        title: n.title || 'Untitled quiz',
        course_id: n.course_id ? String(n.course_id) : '',
        association,
        question_count: questions.length,
        settings: {
          quiz_required: n.quiz_required === true || n.quiz_required === 1,
          quiz_shuffle: n.quiz_shuffle === true || n.quiz_shuffle === 1,
          quiz_shuffle_options: n.quiz_shuffle_options === true || n.quiz_shuffle_options === 1,
          quiz_pass_mark: Number(n.quiz_pass_mark) > 0 ? Number(n.quiz_pass_mark) : null,
        quiz_grade_bands: parseGradeBands(n.quiz_grade_bands),
        },
      },
      questions,
      attempts,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load quiz detail', detail: e.message });
  }
});

// GET /api/quizzes/:lessonId/attempt/:studentId — one student's per-question
// breakdown (what they answered vs. the correct answer). Rebuilt from the raw
// answers stored on their QuizAttempts row. Returns has_answers=false for older
// attempts saved before answer capture (only the score was kept then).
router.get('/:lessonId/attempt/:studentId', async (req, res) => {
  try {
    const lid = safeId(req.params.lessonId);
    const sid = safeId(req.params.studentId);
    if (!lid || !sid) return res.status(400).json({ error: 'lesson_id and student_id are required' });
    const lesson = await getById(req, 'Lessons', lid);
    if (!lesson || Number(lesson.org_id) !== Number(req.orgId)) return res.status(404).json({ error: 'Quiz not found' });

    let attempt = null;
    try {
      const rows = await zcql(req, `SELECT * FROM QuizAttempts WHERE QuizAttempts.lesson_id = ${lid} AND QuizAttempts.student_id = ${sid} AND QuizAttempts.org_id = ${Number(req.orgId)}`);
      attempt = unwrap(rows, 'QuizAttempts').map(normalize)[0] || null;
    } catch { /* table absent */ }
    if (!attempt) return res.status(404).json({ error: 'No attempt found' });

    let answersMap = {};
    try { const a = attempt.answers ? JSON.parse(attempt.answers) : {}; if (a && typeof a === 'object' && !Array.isArray(a)) answersMap = a; } catch { /* ignore */ }
    const hasAnswers = Object.keys(answersMap).length > 0;

    const questions = (await loadLessonQuiz(req, lid)).map(shapeForAdmin);
    const graded = gradeAttempt(questions, answersMap);
    const byId = new Map(questions.map((q) => [String(q.id), q]));
    const breakdown = graded.results.map((r) => {
      const q = byId.get(String(r.id)) || {};
      return {
        id: r.id,
        question: q.question || '',
        question_type: r.question_type,
        options: q.options || [],
        points: r.points,
        earned: r.earned,
        is_correct: r.is_correct,
        correct_index: r.correct_index,
        correct_answers: r.correct_answers,
        selected: r.selected,
        explanation: r.explanation,
      };
    });

    res.json({
      student_id: String(sid),
      score: Number(attempt.score) || graded.score,
      passed: attempt.passed === true || attempt.passed === 1,
      has_answers: hasAnswers,
      breakdown,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load attempt', detail: e.message });
  }
});

// POST /api/quizzes/import — bulk-create questions from a JSON array.
// Body: { lesson_id, questions:[...], mode:'append'|'replace' }
// Each item: { type|question_type, question, options[], correct_index,
//   correct_answers[], points, explanation }. Validated with the same rules as
// manual entry; invalid rows are reported (not silently dropped).
router.post('/import', async (req, res) => {
  try {
    const { lesson_id, mode } = req.body;
    const questions = Array.isArray(req.body.questions) ? req.body.questions : null;
    if (!lesson_id || !questions) return res.status(400).json({ error: 'lesson_id and a questions array are required' });
    if (!(await lessonInOrg(req, lesson_id))) return res.status(404).json({ error: 'Lesson not found' });
    if (questions.length === 0) return res.status(400).json({ error: 'The questions array is empty' });
    if (questions.length > 200) return res.status(400).json({ error: 'Import is limited to 200 questions at a time' });

    // Replace mode wipes existing questions first.
    if (mode === 'replace') {
      const existing = await loadLessonQuiz(req, lesson_id);
      for (const q of existing) { try { await remove(req, 'LessonQuizzes', q.id); } catch { /* ignore */ } }
    }
    // Append after the current highest order_index (0 for a freshly cleared quiz).
    let order = 0;
    if (mode !== 'replace') {
      const existing = await loadLessonQuiz(req, lesson_id);
      order = existing.reduce((m, q) => Math.max(m, Number(q.order_index) || 0), 0) + 1;
    }

    const errors = [];
    let created = 0;
    for (let i = 0; i < questions.length; i++) {
      const raw = questions[i] || {};
      const q = String(raw.question ?? '').trim();
      if (!q) { errors.push({ index: i, error: 'missing question text' }); continue; }
      const built = buildQuestionFields({
        question_type: raw.question_type || raw.type,
        options: raw.options,
        correct_index: raw.correct_index,
        correct_answers: raw.correct_answers,
        points: raw.points,
      });
      if (built.error) { errors.push({ index: i, error: built.error }); continue; }
      try {
        await insert(req, 'LessonQuizzes', {
          lesson_id: String(lesson_id),
          question: q,
          explanation: raw.explanation ? String(raw.explanation).trim() : '',
          order_index: order++,
          ...built.fields,
          org_id: Number(req.orgId),
        });
        created++;
      } catch (e) { errors.push({ index: i, error: 'could not save' }); }
    }
    res.json({ created, errors, total: questions.length });
  } catch (e) {
    res.status(500).json({ error: 'Failed to import questions', detail: e.message });
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

// POST /api/quizzes/standalone — create a course-less quiz (a quiz Lesson with
// no course_id). It shows up in the assignment quiz picker (quiz-list is
// org-wide) but never in a course/CoursePlayer (those filter by course_id).
// Lets admins create a quiz straight from the Assignment modal.
router.post('/standalone', async (req, res) => {
  try {
    const title = String(req.body.title ?? '').trim();
    if (!title) return res.status(400).json({ error: 'A quiz title is required' });
    const row = await insert(req, 'Lessons', {
      course_id: null,
      title,
      content_type: 'quiz',
      description: '',
      video_url: '',
      content_url: '',
      order_index: 0,
      quiz_required: false,
      quiz_shuffle: (req.body.quiz_shuffle === true || req.body.quiz_shuffle === 'true'),
      org_id: Number(req.orgId),
    });
    const n = normalize(row);
    res.status(201).json({ quiz: { id: n.id, title: n.title } });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create quiz', detail: e.message });
  }
});

module.exports = router;
module.exports.loadLessonQuiz = loadLessonQuiz;
module.exports.parseOptions = parseOptions;
module.exports.gradeAttempt = gradeAttempt;
module.exports.PASS_THRESHOLD = PASS_THRESHOLD;
