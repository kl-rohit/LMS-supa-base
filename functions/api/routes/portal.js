// /api/portal/* — Read-only endpoints for parents.
// All requests go through requireAuth + requireParent → req.studentId is set.
// Every query is scoped to that student_id — no cross-student access.

const router = require('express').Router();
const { getById, zcql, zcqlAll, unwrap, normalize, q, safeId, insert, update, remove: removeRow, appFor } = require('../db/catalystDb');
const { uploadStudentPhoto, signStoredPhoto } = require('../lib/photoUpload');
const { loadAssetDataUrl } = require('../lib/orgAsset');
const { codeFor } = require('../lib/certVerify');
const { loadLessonQuiz, PASS_THRESHOLD } = require('./quizzes');
const { loadAssignments } = require('./assignments');
const { loadPapers } = require('./questionpapers');
const { isFeatureEnabled, requireFeature } = require('../middleware/entitlement');
const { publicVapidKey } = require('../lib/notify');
const { parentKey, setFlag, isPending } = require('../lib/onboarding');
const { loadAppSettings } = require('./settings');

// Attendance counts by hours, not by sessions: a 2-hour class marked present
// counts as 2 toward classes_attended. `duration_hours` is frozen on each
// Attendance row at record time; legacy rows without it fall back to 1 hour.
const hrs = (a) => Number(a.duration_hours) || 1;
const sumHrs = (arr) => arr.reduce((s, a) => s + hrs(a), 0);

// --- Quiz helpers (shared by the quiz endpoints + course/lesson decoration) ---

// One QuizAttempts row per student × lesson. Returns the normalized row or null.
// Defensive: a not-yet-created table yields null (no attempt) rather than 500.
async function loadQuizAttempt(req, studentId, lessonId) {
  const sid = safeId(studentId);
  const lid = safeId(lessonId);
  if (!sid || !lid) return null;
  try {
    const rows = await zcql(
      req,
      `SELECT * FROM QuizAttempts WHERE QuizAttempts.student_id = ${sid} AND QuizAttempts.lesson_id = ${lid} AND QuizAttempts.org_id = ${Number(req.orgId)}`
    );
    const row = unwrap(rows, 'QuizAttempts')[0];
    return row ? normalize(row) : null;
  } catch {
    return null;
  }
}

// Whether a lesson counts as "done" for course progress + certificate gating.
// Quizzes are now first-class lessons (content_type === 'quiz'):
//   • a CONTENT lesson (video/document) is done when its progress is completed;
//   • a QUIZ lesson with no questions yet is treated as done (nothing to do);
//   • an OPTIONAL quiz lesson never blocks (done regardless of attempt) — the
//     student can skip it;
//   • a REQUIRED quiz lesson (quiz_required) is done only once it's passed —
//     this is what withholds the certificate until a final assessment passes.
function lessonFullyDone(lesson, progress, hasQuiz, quizPassed) {
  const isQuiz = (lesson?.content_type || 'video') === 'quiz';
  if (isQuiz) {
    if (!hasQuiz) return true;
    const required = lesson?.quiz_required === true || lesson?.quiz_required === 1;
    return required ? !!quizPassed : true;
  }
  return !!(progress && (progress.completed === true || progress.completed === 1));
}

// Batch quiz metadata for the org: which lessons have a quiz, and which the
// given student has passed. One query each, both degrade to empty on a
// missing table. Returns { hasQuiz: Set<lessonId>, passed: Set<lessonId> }.
async function loadQuizMeta(req, studentId) {
  const sid = safeId(studentId);
  const hasQuiz = new Set();
  const passed = new Set();
  try {
    const rows = await zcqlAll(req, `SELECT lesson_id FROM LessonQuizzes WHERE LessonQuizzes.org_id = ${Number(req.orgId)}`, 'LessonQuizzes');
    for (const r of unwrap(rows, 'LessonQuizzes')) hasQuiz.add(String(r.lesson_id));
  } catch { /* table not created yet */ }
  if (sid) {
    try {
      const rows = await zcqlAll(req, `SELECT lesson_id, passed FROM QuizAttempts WHERE QuizAttempts.student_id = ${sid} AND QuizAttempts.org_id = ${Number(req.orgId)}`, 'QuizAttempts');
      for (const r of unwrap(rows, 'QuizAttempts')) {
        if (r.passed === true || r.passed === 1) passed.add(String(r.lesson_id));
      }
    } catch { /* table not created yet */ }
  }
  return { hasQuiz, passed };
}

// Count how far a student is through a course. Returns { total, done, remaining }.
// Shared by the certificate endpoint and the completion-stamp helper so the
// "fully done?" rule lives in exactly one place (lessonFullyDone above).
async function courseCompletionStatus(req, sid, cid) {
  const lessonRows = await zcql(req, `SELECT * FROM Lessons WHERE Lessons.course_id = ${cid} AND Lessons.org_id = ${Number(req.orgId)}`);
  const lessons = unwrap(lessonRows, 'Lessons').map(normalize);
  if (lessons.length === 0) return { total: 0, done: 0, remaining: 0 };

  const progressRows = await zcql(req,
    `SELECT * FROM LessonProgress WHERE LessonProgress.student_id = ${sid} AND LessonProgress.org_id = ${Number(req.orgId)}`
  );
  const byLesson = {};
  unwrap(progressRows, 'LessonProgress').forEach((p) => { const n = normalize(p); byLesson[String(n.lesson_id)] = n; });

  const { hasQuiz, passed } = await loadQuizMeta(req, sid);
  let done = 0;
  for (const l of lessons) {
    const progress = byLesson[String(l.id)] || null;
    if (lessonFullyDone(l, progress, hasQuiz.has(String(l.id)), passed.has(String(l.id)))) done++;
  }
  return { total: lessons.length, done, remaining: lessons.length - done };
}

// Lock a one-time completion date onto the enrollment the FIRST time a course
// is fully done — Udemy-style. Once CourseEnrollments.completed_at is set it is
// NEVER overwritten, so the certificate always shows the real completion date
// rather than the day the certificate button happens to be pressed.
//
// Idempotent + best-effort: returns the stored ISO date, or '' when the course
// isn't complete yet. If the completed_at / completed columns don't exist in
// this environment we degrade gracefully (caller falls back to "now").
async function ensureCourseCompletionStamp(req, sid, cid) {
  const sidN = safeId(sid);
  const cidN = safeId(cid);
  if (!sidN || !cidN) return '';

  let enroll;
  try {
    const rows = await zcql(req,
      `SELECT * FROM CourseEnrollments WHERE CourseEnrollments.student_id = ${sidN} AND CourseEnrollments.course_id = ${cidN} AND CourseEnrollments.org_id = ${Number(req.orgId)}`
    );
    enroll = unwrap(rows, 'CourseEnrollments').map(normalize)[0];
  } catch { return ''; }
  if (!enroll) return '';

  // Already stamped → return it untouched (the date is permanent).
  if (enroll.completed_at) return String(enroll.completed_at);

  const { total, remaining } = await courseCompletionStatus(req, sidN, cidN);
  if (total === 0 || remaining > 0) return '';

  const nowIso = new Date().toISOString();
  try {
    await update(req, 'CourseEnrollments', enroll.id || enroll.ROWID, { completed: true, completed_at: nowIso });
  } catch (e) {
    // Columns not added yet — don't fail the request; just report the date.
    console.error('completion stamp failed (add CourseEnrollments.completed + completed_at?):', e.message);
  }
  return nowIso;
}

// GET /api/portal/me — info about the linked student
router.get('/me', async (req, res) => {
  try {
    const student = await getById(req, 'Students', req.studentId);
    if (!student) return res.status(404).json({ error: 'Linked student not found' });
    // Whether to show the welcome tour — true only until this newly-activated
    // parent dismisses it (see POST /onboarding-seen). Existing parents have
    // no flag → false → tour never shows.
    const onboarding_pending = await isPending(req, req.orgId, parentKey(req.studentId));
    res.json({
      student: normalize(student),
      login: {
        email: req.studentLogin?.email,
        user_id: req.studentLogin?.user_id,
      },
      onboarding_pending,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch student', detail: e.message });
  }
});

// POST /api/portal/onboarding-seen — parent dismissed the welcome tour.
// Clears the pending flag so it never shows again for this login.
router.post('/onboarding-seen', async (req, res) => {
  try {
    await setFlag(req, req.orgId, parentKey(req.studentId), 'false');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update onboarding state', detail: e.message });
  }
});

// GET /api/portal/attendance?month=YYYY-MM
// Returns class history scoped to the linked student.
router.get('/attendance', async (req, res) => {
  try {
    const { month } = req.query;
    const sid = safeId(req.studentId);
    if (!sid) return res.status(400).json({ error: 'Invalid student id on session' });
    // Respect the academy's parent-portal visibility choice. When the academy
    // has hidden class history, return an empty list rather than the records.
    try {
      const appSettings = await loadAppSettings(req);
      if (appSettings['portal.show_attendance'] === 'false') {
        return res.json({ attendance: [], hidden: true });
      }
    } catch { /* settings unavailable → show by default */ }
    let where = `Attendance.student_id = ${sid}`;
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      where += ` AND Attendance.class_date >= ${q(`${month}-01`)} AND Attendance.class_date <= ${q(`${month}-31`)}`;
    }
    // Paginate — when no month filter, this returns the student's entire
    // attendance history which can exceed 300 rows over years.
    const rows = await zcqlAll(req, `SELECT * FROM Attendance WHERE ${where} ORDER BY Attendance.class_date DESC`, 'Attendance');
    const attList = unwrap(rows, 'Attendance');
    // Decorate with class_name. Pull the org's class names ONCE into a map
    // instead of a getById per attendance row (the old fan-out repeated reads
    // for the handful of distinct classes a student's history references).
    let className = new Map();
    if (attList.some((a) => a.class_id)) {
      try {
        const cRows = await zcqlAll(req, `SELECT ROWID, name FROM Classes WHERE Classes.org_id = ${Number(req.orgId)}`, 'Classes');
        className = new Map(unwrap(cRows, 'Classes').map((c) => [String(c.ROWID), c.name]));
      } catch {}
    }
    const records = attList.map((a) => {
      const out = normalize(a);
      if (a.class_id && className.has(String(a.class_id))) out.class_name = className.get(String(a.class_id));
      return out;
    });
    res.json({ attendance: records });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch attendance', detail: e.message });
  }
});

// GET /api/portal/fees?month=YYYY-MM
// Returns class fees + additional fees + discounts for the month (and YTD summary).
router.get('/fees', async (req, res) => {
  try {
    const sid = safeId(req.studentId);
    if (!sid) return res.status(400).json({ error: 'Invalid student id on session' });
    const { month } = req.query;
    let monthClause = '';
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      monthClause = ` AND Attendance.class_date >= ${q(`${month}-01`)} AND Attendance.class_date <= ${q(`${month}-31`)}`;
    }
    // Class fees (from attendance) for the requested month (or all-time —
    // which can exceed 300 rows for long-standing students; paginate).
    const attRows = await zcqlAll(req, `SELECT * FROM Attendance WHERE Attendance.student_id = ${sid}${monthClause}`, 'Attendance');
    const attendance = unwrap(attRows, 'Attendance');

    // Fee mode decides how the class fee is figured:
    //   per_class → sum of each attended class's fee_charged (default)
    //   per_month → a flat monthly_fee on the student record
    let appSettings = {};
    try { appSettings = await loadAppSettings(req); } catch { appSettings = {}; }
    const feeMode = appSettings['billing.fee_mode'] === 'per_month' ? 'per_month' : 'per_class';

    let classFees;
    if (feeMode === 'per_month') {
      let monthlyFee = 0;
      try {
        const student = await getById(req, 'Students', sid);
        monthlyFee = Number(student?.monthly_fee) || 0;
      } catch { /* fall back to 0 */ }
      classFees = monthlyFee;
    } else {
      classFees = attendance.reduce((s, a) => s + (Number(a.fee_charged) || 0), 0);
    }

    // Additional fees + discounts
    let addFilter = '';
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [y, m] = month.split('-');
      addFilter = ` AND AdditionalFees.fee_year = ${parseInt(y, 10)} AND AdditionalFees.fee_month = ${parseInt(m, 10)}`;
    }
    const afRows = await zcqlAll(req, `SELECT * FROM AdditionalFees WHERE AdditionalFees.student_id = ${sid}${addFilter}`, 'AdditionalFees');
    const additional = unwrap(afRows, 'AdditionalFees');
    const positiveAdditional = additional.reduce((s, a) => s + Math.max(0, Number(a.amount) || 0), 0);
    const discountTotal = additional.reduce((s, a) => s + Math.min(0, Number(a.amount) || 0), 0); // negative

    const total = classFees + positiveAdditional + discountTotal;

    // Payment QR for the parent: a UPI id (the portal builds a UPI deep-link QR
    // client-side) and/or an uploaded payment-QR image (streamed inline as a
    // data URL so it embeds without a cross-origin Stratus fetch). Both are
    // optional — the portal shows whichever the academy configured.
    // UPI/QR collection is a catalog feature (fees.upi_qr). When the org's plan
    // does not include it, the whole payment block is suppressed so the portal
    // shows no UPI id, QR or pay button.
    const upiEnabled = isFeatureEnabled(req.orgPlan, 'fees.upi_qr');
    const upiId = upiEnabled ? String(appSettings['fees.upi_id'] || '').trim() : '';
    const payeeName = upiEnabled ? String(appSettings['fees.payee_name'] || '').trim() : '';
    const feeNote = upiEnabled ? String(appSettings['fees.note'] || '').trim() : '';
    let qrImage = '';
    const qrKey = upiEnabled ? String(appSettings['fees.qr_key'] || '').trim() : '';
    if (qrKey) {
      try { qrImage = await loadAssetDataUrl(req, qrKey); } catch { qrImage = ''; }
    }

    res.json({
      month: month || null,
      class_fees: classFees,
      additional_fees: positiveAdditional,
      discount: Math.abs(discountTotal),
      total,
      classes_attended: sumHrs(attendance.filter((a) => a.status === 'present' || a.status === 'late')),
      payment: {
        upi_id: upiId,
        payee_name: payeeName,
        note: feeNote,
        qr_image: qrImage,
        enabled: !!(upiId || qrImage),
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch fees', detail: e.message });
  }
});

// ===== Lessons module — parent-facing =====
// All endpoints below verify that req.studentId is enrolled before returning
// any data. No cross-student access possible.

// GET /api/portal/continue-watching — the lesson the student last touched
// Returns { course, lesson } or { course: null } if nothing watched yet.
router.get('/continue-watching', async (req, res) => {
  try {
    const sid = safeId(req.studentId);
    if (!sid) return res.json({ course: null });

    // Find this student's most recently updated progress row that's NOT completed.
    // We sort by MODIFIEDTIME (auto-managed by Catalyst on every update).
    const progressRows = await zcql(req,
      `SELECT * FROM LessonProgress WHERE LessonProgress.student_id = ${sid} AND LessonProgress.org_id = ${Number(req.orgId)} ORDER BY LessonProgress.MODIFIEDTIME DESC`
    );
    const all = unwrap(progressRows, 'LessonProgress');
    const inProgress = all.find((p) => !p.completed) || all[0];
    if (!inProgress) return res.json({ course: null });

    let lesson = null, course = null;
    try { lesson = await getById(req, 'Lessons', inProgress.lesson_id); } catch {}
    if (!lesson || Number(lesson.org_id) !== Number(req.orgId)) return res.json({ course: null });
    try { course = await getById(req, 'Courses', lesson.course_id); } catch {}
    if (!course || Number(course.org_id) !== Number(req.orgId)) return res.json({ course: null });

    res.json({
      course: normalize(course),
      lesson: {
        ...normalize(lesson),
        progress: normalize(inProgress),
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch continue-watching', detail: e.message });
  }
});

// GET /api/portal/courses — courses the linked student is enrolled in
router.get('/courses', async (req, res) => {
  try {
    const sid = safeId(req.studentId);
    if (!sid) return res.status(400).json({ error: 'Invalid student id' });
    const enrollRows = await zcqlAll(req, `SELECT * FROM CourseEnrollments WHERE CourseEnrollments.student_id = ${sid} AND CourseEnrollments.org_id = ${Number(req.orgId)}`, 'CourseEnrollments');
    const enrollments = unwrap(enrollRows, 'CourseEnrollments').map(normalize)
      .filter((e) => (e.status || 'active') === 'active');

    if (enrollments.length === 0) return res.json({ courses: [] });

    // Quiz metadata once for the whole student (used to gate completion).
    const { hasQuiz, passed } = await loadQuizMeta(req, sid);

    // The student's completed-lesson set is filtered ONLY by student (not by
    // course), so fetch it ONCE here instead of re-running the same query
    // inside every enrollment iteration below.
    let completedIds = new Set();
    try {
      const progressRows = await zcqlAll(req,
        `SELECT * FROM LessonProgress WHERE LessonProgress.student_id = ${sid} AND LessonProgress.completed = true AND LessonProgress.org_id = ${Number(req.orgId)}`, 'LessonProgress'
      );
      completedIds = new Set(unwrap(progressRows, 'LessonProgress').map((p) => String(p.lesson_id)));
    } catch {}

    // Resolve the courses and their lessons in bulk: one Courses pull and one
    // Lessons pull (grouped by course) replace the old getById Courses + per
    // enrollment Lessons query, so the summary costs two SELECTs regardless of
    // how many courses the student is enrolled in.
    const [courseRows, lessonRows] = await Promise.all([
      zcqlAll(req, `SELECT * FROM Courses WHERE Courses.org_id = ${Number(req.orgId)}`, 'Courses').catch(() => []),
      zcqlAll(req, `SELECT * FROM Lessons WHERE Lessons.org_id = ${Number(req.orgId)}`, 'Lessons').catch(() => []),
    ]);
    const courseById = new Map(unwrap(courseRows, 'Courses').map((c) => [String(c.ROWID), c]));
    const lessonsByCourse = new Map();
    for (const l of unwrap(lessonRows, 'Lessons')) {
      const k = String(l.course_id);
      if (!lessonsByCourse.has(k)) lessonsByCourse.set(k, []);
      lessonsByCourse.get(k).push(l);
    }

    // Fetch courses + progress summary for each enrollment
    const results = enrollments.map((en) => {
      const course = courseById.get(String(en.course_id));
      if (!course || (course.status && course.status !== 'active') || Number(course.org_id) !== Number(req.orgId)) return null;

      const lessons = lessonsByCourse.get(String(en.course_id)) || [];

      // Quiz lessons are first-class: a required quiz only counts once passed;
      // optional/empty quizzes don't hold back the percentage.
      const completed = lessons.filter((l) => {
        const lid = String(l.ROWID);
        const progress = completedIds.has(lid) ? { completed: true } : null;
        return lessonFullyDone(l, progress, hasQuiz.has(lid), passed.has(lid));
      }).length;

      // Compute total course duration. For chapter-lessons (start/end set),
      // sum (end - start). For full-video lessons, use duration_seconds.
      let totalSeconds = 0;
      for (const l of lessons) {
        const sec = (Number(l.end_seconds) || 0) > 0
          ? (Number(l.end_seconds) - (Number(l.start_seconds) || 0))
          : (Number(l.duration_seconds) || 0);
        totalSeconds += Math.max(0, sec);
      }

      return {
        ...normalize(course),
        enrollment_id: en.id,
        lessons_total: lessons.length,
        lessons_completed: completed,
        progress_percent: lessons.length > 0 ? Math.round((completed / lessons.length) * 100) : 0,
        total_duration_seconds: totalSeconds,
      };
    });
    res.json({ courses: results.filter(Boolean) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch courses', detail: e.message });
  }
});

// GET /api/portal/courses/:id/lessons — list lessons + per-lesson progress
router.get('/courses/:id/lessons', async (req, res) => {
  try {
    const sid = safeId(req.studentId);
    const cid = safeId(req.params.id);
    if (!sid || !cid) return res.status(400).json({ error: 'Invalid ids' });

    // Verify enrollment (org-scoped).
    const enrollRows = await zcql(req,
      `SELECT ROWID FROM CourseEnrollments WHERE CourseEnrollments.student_id = ${sid} AND CourseEnrollments.course_id = ${cid} AND CourseEnrollments.org_id = ${Number(req.orgId)}`
    );
    if (unwrap(enrollRows, 'CourseEnrollments').length === 0) {
      return res.status(403).json({ error: 'Not enrolled in this course' });
    }

    const course = await getById(req, 'Courses', cid);
    if (!course || Number(course.org_id) !== Number(req.orgId)) return res.status(404).json({ error: 'Course not found' });

    const lessonRows = await zcql(req, `SELECT * FROM Lessons WHERE Lessons.course_id = ${cid} AND Lessons.org_id = ${Number(req.orgId)} ORDER BY Lessons.order_index ASC`);
    const lessons = unwrap(lessonRows, 'Lessons').map(normalize);

    const progressRows = await zcql(req,
      `SELECT * FROM LessonProgress WHERE LessonProgress.student_id = ${sid} AND LessonProgress.org_id = ${Number(req.orgId)}`
    );
    const progressByLesson = {};
    unwrap(progressRows, 'LessonProgress').forEach((p) => {
      progressByLesson[String(p.lesson_id)] = normalize(p);
    });

    const { hasQuiz, passed } = await loadQuizMeta(req, sid);

    const decorated = lessons.map((l) => {
      const progress = progressByLesson[String(l.id)] || null;
      const lessonHasQuiz = hasQuiz.has(String(l.id));
      const quizPassed = passed.has(String(l.id));
      return {
        ...l,
        content_type: l.content_type || 'video',
        quiz_required: l.quiz_required === true || l.quiz_required === 1,
        quiz_shuffle: l.quiz_shuffle === true || l.quiz_shuffle === 1,
        progress,
        has_quiz: lessonHasQuiz,
        quiz_passed: quizPassed,
        fully_done: lessonFullyDone(l, progress, lessonHasQuiz, quizPassed),
      };
    });

    res.json({ course: normalize(course), lessons: decorated });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch lessons', detail: e.message });
  }
});

// GET /api/portal/courses/:id/certificate — certificate data, but ONLY once
// every lesson in the course is FULLY done (content consumed AND any quiz
// passed). Returns 403 with how many lessons remain otherwise. The client
// renders the actual PDF from this data.
router.get('/courses/:id/certificate', async (req, res) => {
  try {
    const sid = safeId(req.studentId);
    const cid = safeId(req.params.id);
    if (!sid || !cid) return res.status(400).json({ error: 'Invalid ids' });

    const enrollRows = await zcql(req,
      `SELECT ROWID FROM CourseEnrollments WHERE CourseEnrollments.student_id = ${sid} AND CourseEnrollments.course_id = ${cid} AND CourseEnrollments.org_id = ${Number(req.orgId)}`
    );
    if (unwrap(enrollRows, 'CourseEnrollments').length === 0) {
      return res.status(403).json({ error: 'Not enrolled in this course' });
    }

    const course = await getById(req, 'Courses', cid);
    if (!course || Number(course.org_id) !== Number(req.orgId)) return res.status(404).json({ error: 'Course not found' });

    const lessonRows = await zcql(req, `SELECT * FROM Lessons WHERE Lessons.course_id = ${cid} AND Lessons.org_id = ${Number(req.orgId)}`);
    const lessons = unwrap(lessonRows, 'Lessons').map(normalize);
    if (lessons.length === 0) {
      return res.status(403).json({ error: 'This course has no lessons yet', remaining: 0, total: 0 });
    }

    const progressRows = await zcql(req,
      `SELECT * FROM LessonProgress WHERE LessonProgress.student_id = ${sid} AND LessonProgress.org_id = ${Number(req.orgId)}`
    );
    const progressByLesson = {};
    let lastTouched = null;
    unwrap(progressRows, 'LessonProgress').forEach((p) => {
      const n = normalize(p);
      progressByLesson[String(n.lesson_id)] = n;
      const t = n.MODIFIEDTIME || n.CREATEDTIME;
      if (t && (!lastTouched || String(t) > String(lastTouched))) lastTouched = t;
    });

    const { hasQuiz, passed } = await loadQuizMeta(req, sid);

    let doneCount = 0;
    for (const l of lessons) {
      const progress = progressByLesson[String(l.id)] || null;
      if (lessonFullyDone(l, progress, hasQuiz.has(String(l.id)), passed.has(String(l.id)))) doneCount++;
    }
    const remaining = lessons.length - doneCount;
    if (remaining > 0) {
      return res.status(403).json({
        error: 'Course not fully completed yet',
        remaining,
        total: lessons.length,
      });
    }

    // Eligible — assemble certificate fields.
    const student = await getById(req, 'Students', sid);
    const studentName = (student && normalize(student).name) || 'Student';

    // Academy display name: org name, falling back to the school.name setting.
    let academyName = '';
    try {
      const orgRows = await zcql(req, `SELECT name, ROWID FROM Organizations`);
      const orgs = unwrap(orgRows, 'Organizations').map(normalize);
      const match = orgs.find((o) => Number(o.ROWID ?? o.id) === Number(req.orgId));
      academyName = match?.name || '';
    } catch {}
    if (!academyName) academyName = 'Your Academy';

    // Completion date is the one LOCKED on the enrollment when the course was
    // first finished (Udemy-style), NOT recomputed here — so re-downloading the
    // certificate weeks later still shows the true completion date. Falls back
    // to the latest progress timestamp / now only if no stamp exists yet.
    let completedAt = await ensureCourseCompletionStamp(req, sid, cid);
    if (!completedAt) {
      completedAt = lastTouched ? new Date(lastTouched).toISOString() : new Date().toISOString();
    }

    // --- Customisation: per-academy look + content from AppSettings ---------
    // All toggles default ON-ish from APP_SETTINGS_DEFAULTS; loadAppSettings
    // always returns a complete map. We only stream/embed an image when both
    // the toggle is on AND a key exists, so the PDF stays light otherwise.
    let settings = {};
    try { settings = await loadAppSettings(req); } catch { settings = {}; }
    const on = (k, dflt) => {
      const v = settings[k];
      if (v === undefined || v === null || v === '') return dflt;
      return String(v) === 'true';
    };

    const showLogo = on('certificate.show_logo', true);
    const showPhoto = on('certificate.show_photo', false);
    const showSignature = on('certificate.show_signature', true);
    const useBrandColor = on('certificate.use_brand_color', true);
    const verifyEnabled = on('certificate.verify_enabled', true);

    // Embed images as base64 data URLs so the client PDF never makes a
    // cross-origin fetch to a signed Stratus URL (same trick as migration.js).
    let logoData = '';
    let signatureData = '';
    let studentPhotoData = '';
    if (showLogo && settings['certificate.logo_key']) {
      try { logoData = await loadAssetDataUrl(req, settings['certificate.logo_key']); } catch {}
    }
    if (showSignature && settings['certificate.signature_key']) {
      try { signatureData = await loadAssetDataUrl(req, settings['certificate.signature_key']); } catch {}
    }
    if (showPhoto && student && normalize(student).photo_url) {
      try { studentPhotoData = await loadAssetDataUrl(req, normalize(student).photo_url); } catch {}
    }

    const certId = `CERT-${req.orgId}-${cid}-${sid}`;

    res.json({
      certificate: {
        student_name: studentName,
        course_name: normalize(course).name || 'Course',
        academy_name: academyName,
        lessons_total: lessons.length,
        completed_at: completedAt,
        // Stable, human-shareable id for the printed certificate.
        certificate_id: certId,

        // Editable copy.
        title: String(settings['certificate.title'] || 'Certificate of Completion'),
        body: String(settings['certificate.body'] || 'has successfully completed the course'),
        signatory_name: String(settings['certificate.signatory_name'] || ''),

        // Layout toggles.
        show_logo: showLogo,
        show_photo: showPhoto,
        show_signature: showSignature,
        show_seal: on('certificate.show_seal', true),
        show_footer: on('certificate.show_footer', true),
        use_brand_color: useBrandColor,

        // Brand accent ('default' | preset id | '#rrggbb') — client maps to hex.
        accent: useBrandColor ? String(settings['appearance.accent'] || 'default') : 'default',

        // Embedded images (empty string when off / missing).
        logo_data: logoData,
        signature_data: signatureData,
        student_photo_data: studentPhotoData,

        // Academy contact footer.
        contact_phone: String(settings['school.contact_phone'] || ''),
        contact_email: String(settings['school.contact_email'] || ''),

        // Public verification: code + relative verify URL the client renders
        // into a QR. Empty when verification is turned off for this academy.
        verify_code: verifyEnabled ? codeFor(req.orgId, cid, sid) : '',
        verify_url: verifyEnabled ? `/app/verify/${certId}?c=${codeFor(req.orgId, cid, sid)}` : '',
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate certificate', detail: e.message });
  }
});

// POST /api/portal/lessons/:id/progress — upsert progress for this student × lesson
// Body: { watched_seconds, duration_seconds }
router.post('/lessons/:id/progress', async (req, res) => {
  try {
    const sid = safeId(req.studentId);
    const lid = safeId(req.params.id);
    if (!sid || !lid) return res.status(400).json({ error: 'Invalid ids' });

    const lesson = await getById(req, 'Lessons', lid);
    if (!lesson || Number(lesson.org_id) !== Number(req.orgId)) return res.status(404).json({ error: 'Lesson not found' });

    // Verify enrollment for this lesson's course, org-scoped.
    const enrollRows = await zcql(req,
      `SELECT ROWID FROM CourseEnrollments WHERE CourseEnrollments.student_id = ${sid} AND CourseEnrollments.course_id = ${safeId(lesson.course_id)} AND CourseEnrollments.org_id = ${Number(req.orgId)}`
    );
    if (unwrap(enrollRows, 'CourseEnrollments').length === 0) {
      return res.status(403).json({ error: 'Not enrolled in this course' });
    }

    const watched = Math.max(0, Number(req.body.watched_seconds) || 0);
    const duration = Math.max(0, Number(req.body.duration_seconds) || Number(lesson.duration_seconds) || 0);
    // For document-type lessons, the body sends { completed: true } when
    // the parent clicks "Mark as completed". Track via explicit flag.
    const explicitCompleted = req.body.completed === true || req.body.completed === 'true';
    const isDocument = (lesson.content_type || 'video') === 'document';

    // Upsert: find existing progress row
    const existingRows = await zcql(req,
      `SELECT * FROM LessonProgress WHERE LessonProgress.student_id = ${sid} AND LessonProgress.lesson_id = ${lid} AND LessonProgress.org_id = ${Number(req.orgId)}`
    );
    const existing = unwrap(existingRows, 'LessonProgress')[0];

    let payload;
    if (isDocument) {
      // Document lesson: progress is binary. Opened = 50%, Marked = 100%.
      // Never regress: max(existing percent, current).
      const wasCompleted = existing?.completed === true || existing?.completed === 1;
      const wasOpened    = (Number(existing?.percent_complete) || 0) > 0 || wasCompleted;
      const completed    = explicitCompleted || wasCompleted;
      const percent      = completed ? 100 : (wasOpened || explicitCompleted ? 50 : 50);
      payload = {
        student_id: String(sid),
        lesson_id: String(lid),
        watched_seconds: completed ? 100 : 50, // dummy values to satisfy not-null
        duration_seconds: 100,
        percent_complete: percent,
        completed,
        org_id: Number(req.orgId),
      };
    } else {
      // Video lesson: same as before — chapter-aware segment percent.
      const startSec = Number(lesson.start_seconds) || 0;
      const endSec   = Number(lesson.end_seconds) || 0;
      const effectiveEnd = endSec > 0 ? endSec : duration;
      const segmentLen   = Math.max(0, effectiveEnd - startSec);
      const maxWatched = Math.max(watched, Number(existing?.watched_seconds) || 0);
      const watchedInSegment = Math.max(0, Math.min(maxWatched, effectiveEnd) - startSec);
      const computedPercent = segmentLen > 0
        ? Math.min(100, Math.round((watchedInSegment / segmentLen) * 100))
        : 0;
      // Progress only moves forward. A later save can report a slightly larger
      // duration (e.g. YouTube refines getDuration once fully buffered) which
      // would otherwise recompute a smaller percent — so never let the stored
      // figure regress, and keep a lesson "completed" once it has been.
      const wasCompleted = existing?.completed === true || existing?.completed === 1;
      const completed = computedPercent >= 90 || wasCompleted;
      // A completed lesson reads a clean 100%; otherwise hold the high-water mark.
      const percent = completed
        ? 100
        : Math.max(computedPercent, Number(existing?.percent_complete) || 0);
      payload = {
        student_id: String(sid),
        lesson_id: String(lid),
        watched_seconds: maxWatched,
        duration_seconds: duration,
        percent_complete: percent,
        completed,
        org_id: Number(req.orgId),
      };
    }

    let row;
    if (existing) {
      row = await update(req, 'LessonProgress', existing.ROWID, payload);
    } else {
      row = await insert(req, 'LessonProgress', payload);
    }

    // Keep the enrollment's precomputed completed_count in step. Only a fresh
    // not-completed → completed transition bumps it (completion never regresses
    // here). Wrapped so it is a safe no-op until the completed_count column
    // exists on CourseEnrollments. Lets the admin enrollments list read a stored
    // count instead of scanning LessonProgress on every load.
    const wasCompletedBefore = existing?.completed === true || existing?.completed === 1;
    if (!wasCompletedBefore && payload.completed === true) {
      try {
        const enId = unwrap(enrollRows, 'CourseEnrollments')[0]?.ROWID;
        if (enId) {
          const cur = await getById(req, 'CourseEnrollments', enId);
          const n = Number(cur && cur.completed_count) || 0;
          await update(req, 'CourseEnrollments', enId, { completed_count: n + 1 });
        }
      } catch { /* column may not exist yet; safe no-op */ }
    }

    // If this save just finished the course, lock the completion date now so
    // the certificate reflects the day they actually completed it.
    let completedAt = '';
    if (payload.completed) {
      try { completedAt = await ensureCourseCompletionStamp(req, sid, safeId(lesson.course_id)); }
      catch (err) { console.error('completion stamp (progress) failed:', err.message); }
    }

    res.json({ progress: normalize(row), course_completed_at: completedAt || null });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update progress', detail: e.message });
  }
});

// GET /api/portal/lessons/:id/quiz — quiz questions WITHOUT the answers,
// plus this student's last attempt summary. Used to render the quiz in the
// CoursePlayer. Returns { questions: [], attempt: null } when there's no quiz.
router.get('/lessons/:id/quiz', async (req, res) => {
  try {
    const sid = safeId(req.studentId);
    const lid = safeId(req.params.id);
    if (!sid || !lid) return res.status(400).json({ error: 'Invalid ids' });

    const lesson = await getById(req, 'Lessons', lid);
    if (!lesson || Number(lesson.org_id) !== Number(req.orgId)) return res.status(404).json({ error: 'Lesson not found' });

    // Enrollment check (org-scoped).
    const enrollRows = await zcql(req,
      `SELECT ROWID FROM CourseEnrollments WHERE CourseEnrollments.student_id = ${sid} AND CourseEnrollments.course_id = ${safeId(lesson.course_id)} AND CourseEnrollments.org_id = ${Number(req.orgId)}`
    );
    if (unwrap(enrollRows, 'CourseEnrollments').length === 0) {
      return res.status(403).json({ error: 'Not enrolled in this course' });
    }

    const questions = await loadLessonQuiz(req, lid);
    const attempt = await loadQuizAttempt(req, sid, lid);
    // Strip correct_index + explanation — never sent before submitting.
    const safeQuestions = questions.map((qz) => ({
      id: qz.id,
      question: qz.question || '',
      options: (() => { try { return JSON.parse(qz.options); } catch { return []; } })(),
    }));
    res.json({
      questions: safeQuestions,
      pass_threshold: PASS_THRESHOLD,
      attempt: attempt ? {
        score: Number(attempt.score) || 0,
        attempts: Number(attempt.attempts) || 0,
        passed: attempt.passed === true || attempt.passed === 1,
      } : null,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch quiz', detail: e.message });
  }
});

// POST /api/portal/lessons/:id/quiz/submit — score server-side, upsert attempt.
// Body: { answers: { "<questionId>": <selectedIndex>, ... } }
// Returns score, pass/fail, and per-question results (with correct answers +
// explanations) so the student can review.
router.post('/lessons/:id/quiz/submit', async (req, res) => {
  try {
    const sid = safeId(req.studentId);
    const lid = safeId(req.params.id);
    if (!sid || !lid) return res.status(400).json({ error: 'Invalid ids' });

    const lesson = await getById(req, 'Lessons', lid);
    if (!lesson || Number(lesson.org_id) !== Number(req.orgId)) return res.status(404).json({ error: 'Lesson not found' });

    const enrollRows = await zcql(req,
      `SELECT ROWID FROM CourseEnrollments WHERE CourseEnrollments.student_id = ${sid} AND CourseEnrollments.course_id = ${safeId(lesson.course_id)} AND CourseEnrollments.org_id = ${Number(req.orgId)}`
    );
    if (unwrap(enrollRows, 'CourseEnrollments').length === 0) {
      return res.status(403).json({ error: 'Not enrolled in this course' });
    }

    const questions = await loadLessonQuiz(req, lid);
    if (questions.length === 0) return res.status(400).json({ error: 'This lesson has no quiz' });

    const answers = req.body?.answers || {};
    let correct = 0;
    const results = questions.map((qz) => {
      const correctIndex = Number(qz.correct_index) || 0;
      const selected = answers[String(qz.id)];
      const selectedIndex = (selected === undefined || selected === null) ? -1 : Number(selected);
      const isCorrect = selectedIndex === correctIndex;
      if (isCorrect) correct++;
      return {
        id: qz.id,
        correct_index: correctIndex,
        selected_index: selectedIndex,
        is_correct: isCorrect,
        explanation: qz.explanation || '',
      };
    });

    const total = questions.length;
    const score = total > 0 ? Math.round((correct / total) * 100) : 0;
    const passedNow = score >= PASS_THRESHOLD;

    // Upsert QuizAttempts. passed is sticky (stays true once earned). Best-effort:
    // if the table is missing we still return the score so the UI works.
    try {
      const prev = await loadQuizAttempt(req, sid, lid);
      const payload = {
        student_id: String(sid),
        lesson_id: String(lid),
        score,
        total_questions: total,
        correct_count: correct,
        attempts: (Number(prev?.attempts) || 0) + 1,
        passed: passedNow || prev?.passed === true || prev?.passed === 1,
        org_id: Number(req.orgId),
      };
      if (prev) await update(req, 'QuizAttempts', prev.id, payload);
      else await insert(req, 'QuizAttempts', payload);
    } catch (err) {
      console.error('QuizAttempts upsert failed (table missing?)', err.message);
    }

    // Passing a required final quiz can be the last thing gating a course — so
    // re-check completion and lock the date if this pass just finished it.
    if (passedNow && lesson.course_id) {
      try { await ensureCourseCompletionStamp(req, sid, safeId(lesson.course_id)); }
      catch (err) { console.error('completion stamp (quiz) failed:', err.message); }
    }

    res.json({ score, correct_count: correct, total, passed: passedNow, pass_threshold: PASS_THRESHOLD, results });
  } catch (e) {
    res.status(500).json({ error: 'Failed to submit quiz', detail: e.message });
  }
});

// ---------- Assignments (parent/student side) ----------
// Reuses the existing quiz engine for kind='quiz' (the assignment points at a
// quiz lesson); kind='task' is broadcast + mark-done via AssignmentCompletions.

// The Groups this student belongs to (used to resolve 'group'-targeted work).
async function studentGroupIds(req, sid) {
  try {
    const rows = await zcqlAll(
      req,
      `SELECT group_id FROM GroupStudents WHERE GroupStudents.student_id = ${sid} AND GroupStudents.org_id = ${Number(req.orgId)}`,
      'GroupStudents'
    );
    return new Set(unwrap(rows, 'GroupStudents').map((r) => String(r.group_id)));
  } catch {
    return new Set();
  }
}

// Whether an assignment is targeted at this student.
function assignmentAppliesTo(asg, sid, groupSet) {
  const t = asg.target_type || 'all';
  if (t === 'all') return true;
  if (t === 'student') return String(asg.target_id) === String(sid);
  if (t === 'group') return groupSet.has(String(asg.target_id));
  return false;
}

// Map of assignment_id -> true for task assignments this student has marked done.
async function studentCompletions(req, sid) {
  const done = new Set();
  try {
    const rows = await zcqlAll(
      req,
      `SELECT assignment_id FROM AssignmentCompletions WHERE AssignmentCompletions.student_id = ${sid} AND AssignmentCompletions.org_id = ${Number(req.orgId)}`,
      'AssignmentCompletions'
    );
    for (const r of unwrap(rows, 'AssignmentCompletions')) done.add(String(r.assignment_id));
  } catch { /* table not created yet */ }
  return done;
}

// GET /api/portal/assignments — assignments targeted at this student, with status.
router.get('/assignments', async (req, res) => {
  try {
    const sid = safeId(req.studentId);
    if (!sid) return res.json({ assignments: [] });
    const all = await loadAssignments(req);
    const groupSet = await studentGroupIds(req, sid);
    const mine = all.filter((a) => assignmentAppliesTo(a, sid, groupSet));
    const doneSet = await studentCompletions(req, sid);

    const out = [];
    for (const a of mine) {
      const n = normalize(a);
      const kind = n.kind === 'quiz' ? 'quiz' : 'task';
      const base = {
        id: n.id,
        title: n.title || '',
        instructions: n.instructions || '',
        link: n.link || '',
        due_date: n.due_date || '',
        kind,
        quiz_lesson_id: n.quiz_lesson_id ? String(n.quiz_lesson_id) : '',
        created_time: n.CREATEDTIME || '',
      };
      if (kind === 'quiz') {
        const attempt = n.quiz_lesson_id ? await loadQuizAttempt(req, sid, n.quiz_lesson_id) : null;
        base.attempt = attempt ? {
          score: Number(attempt.score) || 0,
          attempts: Number(attempt.attempts) || 0,
          passed: attempt.passed === true || attempt.passed === 1,
        } : null;
        base.status = base.attempt ? (base.attempt.passed ? 'passed' : 'attempted') : 'not_started';
        base.completed = !!base.attempt?.passed;
      } else {
        base.completed = doneSet.has(String(n.id));
        base.status = base.completed ? 'done' : 'pending';
      }
      out.push(base);
    }
    // Newest first.
    out.sort((a, b) => String(b.created_time).localeCompare(String(a.created_time)));
    res.json({ assignments: out });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch assignments', detail: e.message });
  }
});

// Load + authorize one assignment for the current student. Returns the row or
// sends an error response and returns null.
async function getAssignmentForStudent(req, res, sid) {
  const all = await loadAssignments(req);
  const asg = all.find((a) => String(normalize(a).id) === String(req.params.id));
  if (!asg) { res.status(404).json({ error: 'Assignment not found' }); return null; }
  const groupSet = await studentGroupIds(req, sid);
  if (!assignmentAppliesTo(normalize(asg), sid, groupSet)) {
    res.status(403).json({ error: 'This assignment is not assigned to you' });
    return null;
  }
  return normalize(asg);
}

// POST /api/portal/assignments/:id/complete — mark a TASK assignment done.
router.post('/assignments/:id/complete', async (req, res) => {
  try {
    const sid = safeId(req.studentId);
    if (!sid) return res.status(400).json({ error: 'Invalid student' });
    const asg = await getAssignmentForStudent(req, res, sid);
    if (!asg) return;
    if ((asg.kind || 'task') !== 'task') {
      return res.status(400).json({ error: 'This is a quiz assignment — take the quiz to complete it' });
    }
    // Upsert a completion row (idempotent).
    const existing = await zcql(
      req,
      `SELECT ROWID FROM AssignmentCompletions WHERE AssignmentCompletions.assignment_id = ${safeId(asg.id)} AND AssignmentCompletions.student_id = ${sid} AND AssignmentCompletions.org_id = ${Number(req.orgId)}`
    );
    if (unwrap(existing, 'AssignmentCompletions').length === 0) {
      await insert(req, 'AssignmentCompletions', {
        assignment_id: String(asg.id),
        student_id: String(sid),
        org_id: Number(req.orgId),
      });
    }
    res.json({ completed: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to mark assignment done', detail: e.message });
  }
});

// DELETE /api/portal/assignments/:id/complete — undo a task completion.
router.delete('/assignments/:id/complete', async (req, res) => {
  try {
    const sid = safeId(req.studentId);
    if (!sid) return res.status(400).json({ error: 'Invalid student' });
    const asg = await getAssignmentForStudent(req, res, sid);
    if (!asg) return;
    const existing = await zcql(
      req,
      `SELECT ROWID FROM AssignmentCompletions WHERE AssignmentCompletions.assignment_id = ${safeId(asg.id)} AND AssignmentCompletions.student_id = ${sid} AND AssignmentCompletions.org_id = ${Number(req.orgId)}`
    );
    for (const r of unwrap(existing, 'AssignmentCompletions')) {
      try { await removeRow(req, 'AssignmentCompletions', r.ROWID); } catch {}
    }
    res.json({ completed: false });
  } catch (e) {
    res.status(500).json({ error: 'Failed to undo completion', detail: e.message });
  }
});

// GET /api/portal/assignments/:id/quiz — quiz questions (no answers) for a quiz
// assignment. Gated on assignment targeting (NOT course enrollment), so a quiz
// can be assigned to a group even if those students aren't enrolled in its course.
router.get('/assignments/:id/quiz', async (req, res) => {
  try {
    const sid = safeId(req.studentId);
    if (!sid) return res.status(400).json({ error: 'Invalid student' });
    const asg = await getAssignmentForStudent(req, res, sid);
    if (!asg) return;
    if ((asg.kind || 'task') !== 'quiz' || !asg.quiz_lesson_id) {
      return res.status(400).json({ error: 'This assignment is not a quiz' });
    }
    const lid = safeId(asg.quiz_lesson_id);
    const lesson = await getById(req, 'Lessons', lid);
    if (!lesson || Number(lesson.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Quiz not found' });
    }
    const questions = await loadLessonQuiz(req, lid);
    const attempt = await loadQuizAttempt(req, sid, lid);
    const safeQuestions = questions.map((qz) => ({
      id: qz.id,
      question: qz.question || '',
      options: (() => { try { return JSON.parse(qz.options); } catch { return []; } })(),
    }));
    res.json({
      questions: safeQuestions,
      pass_threshold: PASS_THRESHOLD,
      // Player reads these off the synthesized lesson; a quiz assignment is never
      // certificate-gating, and shuffle follows the underlying quiz lesson.
      quiz_shuffle: lesson.quiz_shuffle === true || lesson.quiz_shuffle === 1,
      attempt: attempt ? {
        score: Number(attempt.score) || 0,
        attempts: Number(attempt.attempts) || 0,
        passed: attempt.passed === true || attempt.passed === 1,
      } : null,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch quiz', detail: e.message });
  }
});

// POST /api/portal/assignments/:id/quiz/submit — score server-side, upsert
// the QuizAttempts row keyed on the underlying quiz lesson (shared with the
// course-based quiz flow, so a pass counts everywhere).
router.post('/assignments/:id/quiz/submit', async (req, res) => {
  try {
    const sid = safeId(req.studentId);
    if (!sid) return res.status(400).json({ error: 'Invalid student' });
    const asg = await getAssignmentForStudent(req, res, sid);
    if (!asg) return;
    if ((asg.kind || 'task') !== 'quiz' || !asg.quiz_lesson_id) {
      return res.status(400).json({ error: 'This assignment is not a quiz' });
    }
    const lid = safeId(asg.quiz_lesson_id);
    const lesson = await getById(req, 'Lessons', lid);
    if (!lesson || Number(lesson.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Quiz not found' });
    }
    const questions = await loadLessonQuiz(req, lid);
    if (questions.length === 0) return res.status(400).json({ error: 'This quiz has no questions' });

    const answers = req.body?.answers || {};
    let correct = 0;
    const results = questions.map((qz) => {
      const correctIndex = Number(qz.correct_index) || 0;
      const selected = answers[String(qz.id)];
      const selectedIndex = (selected === undefined || selected === null) ? -1 : Number(selected);
      const isCorrect = selectedIndex === correctIndex;
      if (isCorrect) correct++;
      return {
        id: qz.id,
        correct_index: correctIndex,
        selected_index: selectedIndex,
        is_correct: isCorrect,
        explanation: qz.explanation || '',
      };
    });

    const total = questions.length;
    const score = total > 0 ? Math.round((correct / total) * 100) : 0;
    const passedNow = score >= PASS_THRESHOLD;

    try {
      const prev = await loadQuizAttempt(req, sid, lid);
      const payload = {
        student_id: String(sid),
        lesson_id: String(lid),
        score,
        total_questions: total,
        correct_count: correct,
        attempts: (Number(prev?.attempts) || 0) + 1,
        passed: passedNow || prev?.passed === true || prev?.passed === 1,
        org_id: Number(req.orgId),
      };
      if (prev) await update(req, 'QuizAttempts', prev.id, payload);
      else await insert(req, 'QuizAttempts', payload);
    } catch (err) {
      console.error('QuizAttempts upsert failed (table missing?)', err.message);
    }

    // Passing a required final quiz can be the last thing gating a course — so
    // re-check completion and lock the date if this pass just finished it.
    if (passedNow && lesson.course_id) {
      try { await ensureCourseCompletionStamp(req, sid, safeId(lesson.course_id)); }
      catch (err) { console.error('completion stamp (quiz) failed:', err.message); }
    }

    res.json({ score, correct_count: correct, total, passed: passedNow, pass_threshold: PASS_THRESHOLD, results });
  } catch (e) {
    res.status(500).json({ error: 'Failed to submit quiz', detail: e.message });
  }
});

// GET /api/portal/question-papers — list papers shared with the academy.
router.get('/question-papers', async (req, res) => {
  try {
    const rows = await loadPapers(req);
    rows.sort((a, b) => String(b.CREATEDTIME || '').localeCompare(String(a.CREATEDTIME || '')));
    res.json({
      papers: rows.map((r) => {
        const n = normalize(r);
        return {
          id: n.id,
          title: n.title || '',
          description: n.description || '',
          link: n.link || '',
          category: n.category || '',
        };
      }),
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch question papers', detail: e.message });
  }
});

// ---------- Notifications (in-app inbox) ----------
// Rows are written by lib/notify.createNotifications when academy events fire
// (new lesson/quiz, enrollment, assignment, fee/in-app message, class reminder).

// GET /api/portal/notifications — newest first + unread count.
router.get('/notifications', async (req, res) => {
  try {
    const sid = safeId(req.studentId);
    if (!sid) return res.status(401).json({ error: 'Not authenticated' });
    let rows = [];
    try {
      rows = await zcqlAll(
        req,
        `SELECT * FROM Notifications WHERE Notifications.student_id = ${sid} AND Notifications.org_id = ${Number(req.orgId)} ORDER BY Notifications.CREATEDTIME DESC`,
        'Notifications'
      );
    } catch { rows = []; } // table not created yet → empty inbox
    const items = unwrap(rows, 'Notifications').map((r) => {
      const n = normalize(r);
      return {
        id: n.id,
        type: n.type || 'general',
        title: n.title || '',
        body: n.body || '',
        link: n.link || '',
        read: Number(n.is_read) === 1,
        created_at: n.CREATEDTIME || n.created_at,
      };
    });
    const unread = items.filter((i) => !i.read).length;
    res.json({ notifications: items, unread });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch notifications', detail: e.message });
  }
});

// POST /api/portal/notifications/:id/read — mark one as read.
router.post('/notifications/:id/read', async (req, res) => {
  try {
    const sid = safeId(req.studentId);
    const id = safeId(req.params.id);
    if (!sid || !id) return res.status(400).json({ error: 'Invalid request' });
    const row = await getById(req, 'Notifications', id);
    if (!row || String(row.student_id) !== String(sid) || Number(row.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Not found' });
    }
    await update(req, 'Notifications', id, { is_read: true });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update', detail: e.message });
  }
});

// POST /api/portal/notifications/read-all — mark every unread as read.
router.post('/notifications/read-all', async (req, res) => {
  try {
    const sid = safeId(req.studentId);
    if (!sid) return res.status(401).json({ error: 'Not authenticated' });
    let rows = [];
    try {
      rows = await zcqlAll(
        req,
        `SELECT ROWID, is_read FROM Notifications WHERE Notifications.student_id = ${sid} AND Notifications.org_id = ${Number(req.orgId)}`,
        'Notifications'
      );
    } catch { rows = []; }
    const unread = unwrap(rows, 'Notifications').filter((r) => Number(r.is_read) !== 1);
    await Promise.all(unread.map((r) => update(req, 'Notifications', r.ROWID, { is_read: true }).catch(() => {})));
    res.json({ ok: true, updated: unread.length });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update', detail: e.message });
  }
});

// ---------- Web push subscriptions ----------

// GET /api/portal/push/vapid-key — public key for PushManager.subscribe.
router.get('/push/vapid-key', (req, res) => {
  res.json({ key: publicVapidKey() });
});

// POST /api/portal/push/subscribe — register (or refresh) this device.
router.post('/push/subscribe', requireFeature('notify.push'), async (req, res) => {
  try {
    const sid = safeId(req.studentId);
    if (!sid) return res.status(401).json({ error: 'Not authenticated' });
    const sub = req.body && req.body.subscription ? req.body.subscription : req.body;
    const endpoint = sub && sub.endpoint;
    const p256dh = sub && sub.keys && sub.keys.p256dh;
    const auth = sub && sub.keys && sub.keys.auth;
    if (!endpoint || !p256dh || !auth) return res.status(400).json({ error: 'Invalid subscription' });

    // De-dupe on endpoint within this org.
    let existing = [];
    try {
      existing = await zcqlAll(
        req,
        `SELECT ROWID, endpoint FROM PushSubscriptions WHERE PushSubscriptions.org_id = ${Number(req.orgId)}`,
        'PushSubscriptions'
      );
    } catch { existing = []; }
    const match = unwrap(existing, 'PushSubscriptions').find((r) => r.endpoint === endpoint);
    if (match) {
      await update(req, 'PushSubscriptions', match.ROWID, { student_id: sid, p256dh, auth }).catch(() => {});
      return res.json({ ok: true, id: match.ROWID });
    }
    const inserted = await insert(req, 'PushSubscriptions', {
      student_id: sid,
      org_id: Number(req.orgId),
      endpoint,
      p256dh,
      auth,
    });
    res.json({ ok: true, id: inserted?.ROWID });
  } catch (e) {
    res.status(500).json({ error: 'Failed to subscribe', detail: e.message });
  }
});

// POST /api/portal/push/unsubscribe — drop this device's subscription.
router.post('/push/unsubscribe', async (req, res) => {
  try {
    const sid = safeId(req.studentId);
    const endpoint = req.body && req.body.endpoint;
    if (!sid || !endpoint) return res.status(400).json({ error: 'Invalid request' });
    let existing = [];
    try {
      existing = await zcqlAll(
        req,
        `SELECT ROWID, endpoint FROM PushSubscriptions WHERE PushSubscriptions.org_id = ${Number(req.orgId)}`,
        'PushSubscriptions'
      );
    } catch { existing = []; }
    const matches = unwrap(existing, 'PushSubscriptions').filter((r) => r.endpoint === endpoint);
    await Promise.all(matches.map((m) => removeRow(req, 'PushSubscriptions', m.ROWID).catch(() => {})));
    res.json({ ok: true, removed: matches.length });
  } catch (e) {
    res.status(500).json({ error: 'Failed to unsubscribe', detail: e.message });
  }
});

// ---------- Upcoming class (live "next class" card) ----------
// Computes this student's next scheduled class occurrence from the weekly
// timetable (recurring Classes rows). Times are stored/compared in IST.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function istNow() {
  return new Date(Date.now() + IST_OFFSET_MS);
}
// "HH:MM" → minutes since midnight (null if unparseable).
function timeToMin(t) {
  if (!t || typeof t !== 'string') return null;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// All recurring classes that include this student (direct, group, or roster link).
async function studentClasses(req, sid) {
  const groupSet = await studentGroupIds(req, sid);
  let rows = [];
  try {
    rows = await zcqlAll(
      req,
      `SELECT * FROM Classes WHERE Classes.is_active = 1 AND Classes.org_id = ${Number(req.orgId)}`,
      'Classes'
    );
  } catch { return []; }
  const classes = unwrap(rows, 'Classes');

  // Roster links (multi-student classes).
  let linkSet = new Set();
  try {
    const links = await zcqlAll(
      req,
      `SELECT class_id FROM ClassStudents WHERE ClassStudents.student_id = ${sid} AND ClassStudents.org_id = ${Number(req.orgId)}`,
      'ClassStudents'
    );
    linkSet = new Set(unwrap(links, 'ClassStudents').map((l) => String(l.class_id)));
  } catch { /* no links */ }

  return classes.filter((c) => {
    if (c.student_id && String(c.student_id) === String(sid)) return true;
    if (c.group_id && groupSet.has(String(c.group_id))) return true;
    if (linkSet.has(String(c.ROWID))) return true;
    return false;
  });
}

// GET /api/portal/upcoming-class — the soonest future class occurrence.
router.get('/upcoming-class', async (req, res) => {
  try {
    const sid = safeId(req.studentId);
    if (!sid) return res.status(401).json({ error: 'Not authenticated' });
    const classes = await studentClasses(req, sid);
    if (!classes.length) return res.json({ upcoming: null });

    const now = istNow();
    const nowDow = now.getUTCDay(); // istNow is UTC-shifted, so use getUTC*
    const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();

    let best = null; // { class, daysAhead, startMin }
    for (const c of classes) {
      const dow = Number(c.day_of_week);
      const startMin = timeToMin(c.start_time);
      if (!Number.isFinite(dow) || startMin === null) continue;
      let daysAhead = (dow - nowDow + 7) % 7;
      // Same day but already started/past → next week.
      if (daysAhead === 0 && startMin <= nowMin) daysAhead = 7;
      const rank = daysAhead * 1440 + startMin;
      if (!best || rank < best.rank) best = { class: c, daysAhead, startMin, rank };
    }
    if (!best) return res.json({ upcoming: null });

    const c = best.class;
    let groupName = null;
    if (c.group_id) {
      try { const g = await getById(req, 'Groups', c.group_id); groupName = g ? g.name : null; } catch { /* ignore */ }
    }

    // Online classes get a join link: the class's own link wins, otherwise
    // the academy-wide default (online.default_link). Offline classes never
    // surface a link. We only expose the join button inside a sensible window
    // (15 min before start through the end of the class today) so the link
    // appears when it is actually useful.
    const isOnline = c.class_type === 'online' || c.class_type === 'online_group';
    let meetingLink = '';
    let provider = '';
    if (isOnline) {
      meetingLink = String(c.meeting_link || '').trim();
      try {
        const appSettings = await loadAppSettings(req);
        provider = String(appSettings['online.provider'] || 'gmeet');
        if (!meetingLink) meetingLink = String(appSettings['online.default_link'] || '').trim();
      } catch { /* settings unavailable → no default */ }
    }
    // Join window: today's occurrence, from 15 min before start to end_time.
    let joinOpen = false;
    if (isOnline && meetingLink && best.daysAhead === 0) {
      const endMin = timeToMin(c.end_time);
      const earliest = best.startMin - 15;
      if (nowMin >= earliest && (endMin === null || nowMin <= endMin)) joinOpen = true;
    }

    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    res.json({
      upcoming: {
        id: c.ROWID,
        name: c.name || 'Class',
        class_type: c.class_type || '',
        group_name: groupName,
        day_of_week: Number(c.day_of_week),
        day_label: best.daysAhead === 0 ? 'Today' : best.daysAhead === 1 ? 'Tomorrow' : DAYS[Number(c.day_of_week)],
        start_time: c.start_time || '',
        end_time: c.end_time || '',
        days_ahead: best.daysAhead,
        is_online: isOnline,
        meeting_link: meetingLink,
        meeting_provider: provider,
        join_open: joinOpen,
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch upcoming class', detail: e.message });
  }
});

// ---------- Self-service profile ----------
// Parents can edit a whitelisted set of their Students row fields and upload
// a passport-style photo (stored in Catalyst Stratus). Used to collect Grade
// exam paperwork data without the teacher having to re-enter it.

// Fields the portal allows the parent to edit. Anything not in this list
// (status, group_id, fee_offline, ROWID, etc.) is admin-only and ignored
// on PUT to prevent privilege escalation via crafted requests.
//
// NOTE: `email` is intentionally NOT in this list. The parent's email is
// their Catalyst login email and is auto-synced into Students.email on
// every profile save — see the PUT handler below. The frontend renders
// it as a disabled field.
const PORTAL_EDITABLE_FIELDS = [
  'name',
  'mobile_number',
  'date_of_birth',
  'address',
  'father_name',
  'mother_name',
];

// Stratus bucket name + upload pipeline live in lib/photoUpload — both this
// route and the admin /api/students/:id/photo route call the same helper.

// GET /api/portal/profile — returns just the fields shown on the parent form.
// Email is sourced from the Catalyst login (not the Students.email column)
// so it's always the address the parent uses to sign in.
router.get('/profile', async (req, res) => {
  try {
    const s = await getById(req, 'Students', req.studentId);
    if (!s) return res.status(404).json({ error: 'Linked student not found' });
    const n = normalize(s);
    const loginEmail = req.studentLogin?.email || n.email || '';
    res.json({
      profile: {
        id: n.id,
        name: n.name || '',
        mobile_number: n.mobile_number || '',
        date_of_birth: n.date_of_birth || '',
        email: loginEmail,
        email_readonly: true,
        address: n.address || '',
        father_name: n.father_name || '',
        mother_name: n.mother_name || '',
        photo_url: n.photo_url || '',
        // Read-only fields the parent might want to see but can't edit
        parent_name: n.parent_name || '',
        status: n.status || '',
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch profile', detail: e.message });
  }
});

// PUT /api/portal/profile — whitelist-update. Anything outside
// PORTAL_EDITABLE_FIELDS is silently ignored.
router.put('/profile', requireFeature('portal.profile'), async (req, res) => {
  try {
    const existing = await getById(req, 'Students', req.studentId);
    if (!existing) return res.status(404).json({ error: 'Linked student not found' });

    const patch = {};
    for (const f of PORTAL_EDITABLE_FIELDS) {
      if (req.body[f] === undefined) continue;
      const v = req.body[f];
      if (f === 'date_of_birth') {
        // Catalyst Date columns reject empty strings — pass null instead.
        patch[f] = v ? String(v) : null;
      } else {
        patch[f] = (v === null || v === undefined) ? '' : String(v).trim();
      }
    }

    // Always sync Students.email to the Catalyst login email so the admin
    // views (Students list, exam paperwork pull, etc.) reflect the address
    // the parent actually uses. The portal form renders email as disabled,
    // so this is the only path that writes the column for portal users.
    const loginEmail = req.studentLogin?.email || '';
    if (loginEmail && loginEmail !== existing.email) {
      patch.email = loginEmail;
    }

    // Keep parent_name in sync for backward compat with admin views that
    // still read it (Students list, fee reminder generator, etc.). Prefer
    // father, fall back to mother, fall back to whatever was there before.
    const father = patch.father_name !== undefined ? patch.father_name : existing.father_name;
    const mother = patch.mother_name !== undefined ? patch.mother_name : existing.mother_name;
    if (patch.father_name !== undefined || patch.mother_name !== undefined) {
      const combined = [father, mother].filter(Boolean).join(' / ');
      if (combined) patch.parent_name = combined;
    }

    // If nothing actually changed (parent hit Save with no edits), skip the
    // write — Catalyst's updateRow is fine with empty patches but no point.
    const updated = Object.keys(patch).length > 0
      ? await update(req, 'Students', req.studentId, patch)
      : existing;
    const n = normalize(updated);
    res.json({
      profile: {
        id: n.id,
        name: n.name || '',
        mobile_number: n.mobile_number || '',
        date_of_birth: n.date_of_birth || '',
        email: loginEmail || n.email || '',
        email_readonly: true,
        address: n.address || '',
        father_name: n.father_name || '',
        mother_name: n.mother_name || '',
        photo_url: n.photo_url || '',
        parent_name: n.parent_name || '',
        status: n.status || '',
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update profile', detail: e.message });
  }
});

// POST /api/portal/photo
// Body: { data: 'data:image/jpeg;base64,...' }
// Decodes, resizes to ≤ 800px JPEG, uploads to Stratus, returns a 1-hour
// signed URL for the immediate preview. See lib/photoUpload.js.
router.post('/photo', async (req, res) => {
  try {
    const result = await uploadStudentPhoto(req, req.studentId, req.body);
    res.status(result.status).json(result.json);
  } catch (e) {
    res.status(500).json({ error: 'Failed to upload photo', detail: e.message });
  }
});

// GET /api/portal/photo-url — returns a fresh signed URL for the linked
// student's photo. Frontend calls this on profile load.
router.get('/photo-url', async (req, res) => {
  try {
    const s = await getById(req, 'Students', req.studentId);
    if (!s) return res.status(404).json({ error: 'Linked student not found' });
    const photo_url = await signStoredPhoto(req, s.photo_url);
    res.json({ photo_url });
  } catch (e) {
    res.status(500).json({ error: 'Failed to sign photo URL', detail: e.message });
  }
});

module.exports = router;
