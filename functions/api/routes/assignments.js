// /api/assignments — Admin CRUD for assignments. Org-scoped via resolveOrg.
// The STUDENT-facing side (list my assignments, mark a task done, take a quiz
// assignment) lives in routes/portal.js under requireParent.
//
// Two kinds of assignment:
//   • 'task'  — Broadcast + mark-done. Has instructions, an optional link
//               (Drive/PDF URL), and an optional due date. Each student taps
//               "Mark as done"; completion is one row in AssignmentCompletions.
//   • 'quiz'  — Auto-graded MCQ. Reuses the EXISTING quiz engine: it points at
//               an existing quiz lesson (content_type='quiz') via quiz_lesson_id.
//               The student takes it through the existing quiz flow and the
//               existing QuizAttempts row is the grade/completion. No new quiz
//               schema or authoring UI — teachers author MCQs in Lessons as today.
//
// Targeting (who gets it): target_type ∈ 'all' | 'group' | 'student'.
//   • all     — every student in the org.
//   • group   — target_id = Groups ROWID; recipients via GroupStudents.
//   • student — target_id = Students ROWID; a single recipient.
// (Classes are schedule entities with a union roster; cohorts are Groups, which
//  is the reliable, clean targeting unit — mirrors how Zoho assigns to a batch.)
//
// Data model:
//   Assignments
//     title (Text), instructions (Text), link (Text), due_date (Text 'YYYY-MM-DD'),
//     kind (Text 'task'|'quiz'), quiz_lesson_id (Bigint), target_type (Text),
//     target_id (Bigint), org_id (Bigint)
//   AssignmentCompletions      — one row per student × task assignment
//     assignment_id (Bigint), student_id (Bigint), org_id (Bigint)
//
// Every read degrades gracefully: a not-yet-created table returns empty instead
// of 500-ing the page.

const router = require('express').Router();
const { insert, getById, update, remove, zcql, zcqlAll, unwrap, normalize, safeId } = require('../db/catalystDb');
const { createNotifications } = require('../lib/notify');

const VALID_KINDS = ['task', 'quiz'];
// 'students' (plural) = a hand-picked multi-select list, stored as a JSON array
// of student ids in target_ids. 'student' (singular) is kept for legacy rows.
const VALID_TARGETS = ['all', 'group', 'student', 'students'];

// Parse the JSON student-id array in target_ids → array of id strings.
function parseTargetIds(v) {
  if (Array.isArray(v)) return v.map(String);
  if (!v) return [];
  try { const a = JSON.parse(v); return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
}

// Shape a stored row for the admin side.
function shape(row) {
  const n = normalize(row);
  return {
    id: n.id,
    title: n.title || '',
    instructions: n.instructions || '',
    link: n.link || '',
    due_date: n.due_date || '',
    kind: VALID_KINDS.includes(n.kind) ? n.kind : 'task',
    quiz_lesson_id: n.quiz_lesson_id ? String(n.quiz_lesson_id) : '',
    target_type: VALID_TARGETS.includes(n.target_type) ? n.target_type : 'all',
    target_id: n.target_id ? String(n.target_id) : '',
    target_ids: parseTargetIds(n.target_ids),
    created_time: n.CREATEDTIME || n.created_time || '',
  };
}

// Load all assignments for the org, newest first. [] if table missing.
async function loadAssignments(req) {
  try {
    const rows = await zcqlAll(
      req,
      `SELECT * FROM Assignments WHERE Assignments.org_id = ${Number(req.orgId)}`,
      'Assignments'
    );
    return unwrap(rows, 'Assignments').map(normalize);
  } catch {
    return [];
  }
}

// Resolve the recipient student ids for an assignment (used for counts). The
// returned list is best-effort and org-scoped.
async function recipientStudentIds(req, asg) {
  const orgId = Number(req.orgId);
  try {
    if (asg.target_type === 'students') {
      return parseTargetIds(asg.target_ids);
    }
    if (asg.target_type === 'student' && asg.target_id) {
      return [String(asg.target_id)];
    }
    if (asg.target_type === 'group' && asg.target_id) {
      const links = await zcqlAll(
        req,
        `SELECT GroupStudents.student_id FROM GroupStudents WHERE GroupStudents.group_id = ${safeId(asg.target_id)} AND GroupStudents.org_id = ${orgId}`,
        'GroupStudents'
      );
      return unwrap(links, 'GroupStudents').map((l) => String(l.student_id)).filter(Boolean);
    }
    // all
    const rows = await zcqlAll(
      req,
      `SELECT ROWID FROM Students WHERE Students.org_id = ${orgId} AND Students.status = 'active'`,
      'Students'
    );
    return unwrap(rows, 'Students').map((r) => String(r.ROWID)).filter(Boolean);
  } catch {
    return [];
  }
}

// Count completions for a task assignment (rows in AssignmentCompletions).
async function completionCount(req, assignmentId) {
  try {
    const rows = await zcqlAll(
      req,
      `SELECT ROWID FROM AssignmentCompletions WHERE AssignmentCompletions.assignment_id = ${safeId(assignmentId)} AND AssignmentCompletions.org_id = ${Number(req.orgId)}`,
      'AssignmentCompletions'
    );
    return unwrap(rows, 'AssignmentCompletions').length;
  } catch {
    return 0;
  }
}

// Count students who PASSED a quiz assignment's linked quiz lesson.
async function quizPassedCount(req, quizLessonId) {
  if (!quizLessonId) return 0;
  try {
    const rows = await zcqlAll(
      req,
      `SELECT passed FROM QuizAttempts WHERE QuizAttempts.lesson_id = ${safeId(quizLessonId)} AND QuizAttempts.org_id = ${Number(req.orgId)}`,
      'QuizAttempts'
    );
    return unwrap(rows, 'QuizAttempts').filter((r) => r.passed === true || r.passed === 1).length;
  } catch {
    return 0;
  }
}

// GET /api/assignments — list with recipient + completion counts.
router.get('/', async (req, res) => {
  try {
    const rows = await loadAssignments(req);
    // Sort newest first (CREATEDTIME desc).
    rows.sort((a, b) => String(b.CREATEDTIME || '').localeCompare(String(a.CREATEDTIME || '')));
    const out = [];
    for (const r of rows) {
      const s = shape(r);
      const recipients = await recipientStudentIds(req, r);
      s.recipient_count = recipients.length;
      s.completed_count = s.kind === 'quiz'
        ? await quizPassedCount(req, s.quiz_lesson_id)
        : await completionCount(req, s.id);
      out.push(s);
    }
    res.json({ assignments: out });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch assignments', detail: e.message });
  }
});

// Validate + normalize a create/update body. Returns { error } or { patch }.
async function buildPatch(req, body, { partial }) {
  const patch = {};
  const has = (k) => body[k] !== undefined;

  if (!partial || has('title')) {
    const title = String(body.title ?? '').trim();
    if (!title) return { error: 'Title is required' };
    patch.title = title;
  }
  if (!partial || has('kind')) {
    const kind = String(body.kind ?? 'task');
    if (!VALID_KINDS.includes(kind)) return { error: 'Invalid kind' };
    patch.kind = kind;
  }
  if (has('instructions')) patch.instructions = String(body.instructions ?? '').trim();
  if (has('link')) patch.link = String(body.link ?? '').trim();
  if (has('due_date')) patch.due_date = String(body.due_date ?? '').trim();

  if (has('target_type')) {
    const t = String(body.target_type);
    if (!VALID_TARGETS.includes(t)) return { error: 'Invalid target_type' };
    patch.target_type = t;
  }
  if (has('target_id')) {
    patch.target_id = body.target_id ? String(body.target_id) : null;
  }
  if (has('target_ids')) {
    const ids = Array.isArray(body.target_ids) ? body.target_ids.map(String).filter(Boolean) : [];
    patch.target_ids = ids.length ? JSON.stringify(ids) : null;
  }
  if (has('quiz_lesson_id')) {
    patch.quiz_lesson_id = body.quiz_lesson_id ? String(body.quiz_lesson_id) : null;
  }

  // Cross-field validation on the resolved values.
  const kind = patch.kind ?? body.kind;
  const targetType = patch.target_type ?? body.target_type;
  const targetId = patch.target_id !== undefined ? patch.target_id : body.target_id;
  const targetIds = patch.target_ids !== undefined
    ? parseTargetIds(patch.target_ids)
    : (Array.isArray(body.target_ids) ? body.target_ids.map(String).filter(Boolean) : []);
  const quizLessonId = patch.quiz_lesson_id !== undefined ? patch.quiz_lesson_id : body.quiz_lesson_id;

  if ((targetType === 'group' || targetType === 'student') && !targetId) {
    return { error: 'Select who this assignment is for' };
  }
  if (targetType === 'students' && targetIds.length === 0) {
    return { error: 'Pick at least one student' };
  }

  // Keep target fields consistent with the chosen type (clear stale values).
  if (patch.target_type !== undefined) {
    if (patch.target_type === 'students') patch.target_id = null;
    else if (patch.target_type === 'all') { patch.target_id = null; patch.target_ids = null; }
    else patch.target_ids = null; // group / student
  }
  if (kind === 'quiz') {
    if (!quizLessonId) return { error: 'Select a quiz for this assignment' };
    // Verify the quiz lesson belongs to the org and is actually a quiz lesson.
    try {
      const lesson = await getById(req, 'Lessons', quizLessonId);
      if (!lesson || Number(lesson.org_id) !== Number(req.orgId)) {
        return { error: 'Quiz lesson not found' };
      }
      if ((lesson.content_type || 'video') !== 'quiz') {
        return { error: 'Selected lesson is not a quiz' };
      }
    } catch {
      return { error: 'Quiz lesson not found' };
    }
  }
  return { patch };
}

// POST /api/assignments
router.post('/', async (req, res) => {
  try {
    const { error, patch } = await buildPatch(req, req.body, { partial: false });
    if (error) return res.status(400).json({ error });
    const row = await insert(req, 'Assignments', {
      title: patch.title,
      instructions: patch.instructions || '',
      link: patch.link || '',
      due_date: patch.due_date || '',
      kind: patch.kind || 'task',
      quiz_lesson_id: patch.kind === 'quiz' ? patch.quiz_lesson_id : null,
      target_type: patch.target_type || 'all',
      target_id: (patch.target_type === 'group' || patch.target_type === 'student') ? patch.target_id : null,
      target_ids: patch.target_type === 'students' ? (patch.target_ids || null) : null,
      org_id: Number(req.orgId),
    });

    // Notify targeted students that work was assigned (best-effort).
    try {
      const studentIds = await recipientStudentIds(req, row);
      if (studentIds.length) {
        const isQuiz = (patch.kind || 'task') === 'quiz';
        await createNotifications(req, {
          orgId: Number(req.orgId),
          studentIds,
          type: 'assignment',
          title: isQuiz ? 'New quiz assigned' : 'New assignment',
          body: `“${patch.title}”${patch.due_date ? ` — due ${patch.due_date}` : ''}`,
          link: '/portal/assignments',
        });
      }
    } catch (notifyErr) {
      console.error('[assignments] notify failed:', notifyErr.message);
    }

    res.status(201).json({ assignment: shape(row) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create assignment', detail: e.message });
  }
});

// PUT /api/assignments/:id
router.put('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Assignments', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Assignment not found' });
    }
    const { error, patch } = await buildPatch(req, req.body, { partial: true });
    if (error) return res.status(400).json({ error });
    // If switching to a non-quiz kind, clear the quiz link; to a quiz kind keep it.
    if (patch.kind && patch.kind !== 'quiz') patch.quiz_lesson_id = null;
    // If switching to 'all', clear target_id.
    if (patch.target_type === 'all') patch.target_id = null;
    const updated = await update(req, 'Assignments', req.params.id, patch);
    res.json({ assignment: shape(updated) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update assignment', detail: e.message });
  }
});

// DELETE /api/assignments/:id — also clean up its completion rows (best-effort).
router.delete('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Assignments', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Assignment not found' });
    }
    await remove(req, 'Assignments', req.params.id);
    try {
      const links = await zcqlAll(
        req,
        `SELECT ROWID FROM AssignmentCompletions WHERE AssignmentCompletions.assignment_id = ${safeId(req.params.id)} AND AssignmentCompletions.org_id = ${Number(req.orgId)}`,
        'AssignmentCompletions'
      );
      for (const l of unwrap(links, 'AssignmentCompletions')) {
        try { await remove(req, 'AssignmentCompletions', l.ROWID); } catch {}
      }
    } catch {}
    res.json({ message: 'Assignment deleted' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete assignment', detail: e.message });
  }
});

module.exports = router;
module.exports.loadAssignments = loadAssignments;
module.exports.recipientStudentIds = recipientStudentIds;
module.exports.shape = shape;
