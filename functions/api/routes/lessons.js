// /api/lessons — Admin CRUD for Lessons. Org-scoped via resolveOrg.

const router = require('express').Router();
const { insert, getById, update, remove, zcql, zcqlAll, unwrap, normalize, safeId } = require('../db/catalystDb');
const { createNotifications } = require('../lib/notify');
const { requireFeature } = require('../middleware/entitlement');

// Students enrolled in a course (for new-lesson / new-quiz notifications).
async function enrolledStudentIds(req, courseId) {
  const cid = safeId(courseId);
  if (!cid) return [];
  try {
    const rows = await zcqlAll(
      req,
      `SELECT student_id FROM CourseEnrollments WHERE CourseEnrollments.course_id = ${cid} AND CourseEnrollments.org_id = ${Number(req.orgId)}`,
      'CourseEnrollments'
    );
    return unwrap(rows, 'CourseEnrollments').map((r) => String(r.student_id)).filter(Boolean);
  } catch { return []; }
}

// Helper: verify the parent course belongs to req.orgId before we let the
// caller mutate the lesson (which inherits the course's org).
async function courseInOrg(req, courseId) {
  try {
    const c = await getById(req, 'Courses', courseId);
    return c && Number(c.org_id) === Number(req.orgId);
  } catch {
    return false;
  }
}

// GET /api/lessons?course_id=X
router.get('/', async (req, res) => {
  try {
    const cid = safeId(req.query.course_id);
    if (!cid) return res.status(400).json({ error: 'course_id is required' });
    if (!(await courseInOrg(req, cid))) return res.json({ lessons: [] });
    const rows = await zcql(req, `SELECT * FROM Lessons WHERE Lessons.course_id = ${cid} AND Lessons.org_id = ${Number(req.orgId)} ORDER BY Lessons.order_index ASC`);
    const lessons = unwrap(rows, 'Lessons').map(normalize);

    // Attach quiz_count per lesson in one batched query. Degrades to 0 if the
    // LessonQuizzes table doesn't exist yet.
    const counts = new Map();
    const ids = lessons.map((l) => safeId(l.id)).filter(Boolean);
    if (ids.length > 0) {
      try {
        const qrows = await zcql(req, `SELECT lesson_id FROM LessonQuizzes WHERE LessonQuizzes.org_id = ${Number(req.orgId)} AND LessonQuizzes.lesson_id IN (${ids.join(',')})`);
        for (const r of unwrap(qrows, 'LessonQuizzes').map(normalize)) {
          const k = String(r.lesson_id);
          counts.set(k, (counts.get(k) || 0) + 1);
        }
      } catch { /* table missing — leave counts at 0 */ }
    }

    res.json({ lessons: lessons.map((l) => ({
      ...l,
      quiz_count: counts.get(String(l.id)) || 0,
    })) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch lessons', detail: e.message });
  }
});

// GET /api/lessons/quiz-list — every quiz lesson (content_type='quiz') in the
// org, with its course title + question count. Used by the Assignments admin
// page to let a teacher attach an existing quiz to a quiz assignment.
router.get('/quiz-list', async (req, res) => {
  try {
    const rows = await zcqlAll(
      req,
      `SELECT * FROM Lessons WHERE Lessons.org_id = ${Number(req.orgId)} AND Lessons.content_type = 'quiz'`,
      'Lessons'
    );
    const quizzes = unwrap(rows, 'Lessons').map(normalize);
    if (quizzes.length === 0) return res.json({ quizzes: [] });

    // Course titles (batched).
    const courseTitle = new Map();
    const cids = [...new Set(quizzes.map((l) => safeId(l.course_id)).filter(Boolean))];
    if (cids.length > 0) {
      try {
        const crows = await zcql(req, `SELECT ROWID, title FROM Courses WHERE Courses.org_id = ${Number(req.orgId)} AND Courses.ROWID IN (${cids.join(',')})`);
        for (const c of unwrap(crows, 'Courses').map(normalize)) courseTitle.set(String(c.id), c.title || '');
      } catch { /* ignore */ }
    }

    // Question counts (batched).
    const counts = new Map();
    const ids = quizzes.map((l) => safeId(l.id)).filter(Boolean);
    if (ids.length > 0) {
      try {
        const qrows = await zcql(req, `SELECT lesson_id FROM LessonQuizzes WHERE LessonQuizzes.org_id = ${Number(req.orgId)} AND LessonQuizzes.lesson_id IN (${ids.join(',')})`);
        for (const r of unwrap(qrows, 'LessonQuizzes').map(normalize)) {
          const k = String(r.lesson_id);
          counts.set(k, (counts.get(k) || 0) + 1);
        }
      } catch { /* ignore */ }
    }

    res.json({ quizzes: quizzes.map((l) => ({
      id: l.id,
      title: l.title || 'Untitled quiz',
      course_id: l.course_id ? String(l.course_id) : '',
      course_title: courseTitle.get(String(l.course_id)) || '',
      question_count: counts.get(String(l.id)) || 0,
    })) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch quiz list', detail: e.message });
  }
});

// GET /api/lessons/activity
router.get('/activity', requireFeature('reports.lessons'), async (req, res) => {
  try {
    const sidFilter = safeId(req.query.student_id);
    const cidFilter = safeId(req.query.course_id);
    const orgFilter = `org_id = ${Number(req.orgId)}`;

    // Push the drill-down filters into the queries instead of pulling the whole
    // org and discarding rows in memory. A per-student or per-course view is the
    // common case, and scoping the three growable tables (enrollments, lessons,
    // progress) there turns a full-org scan into a handful of rows. The
    // unfiltered org-wide report still pulls everything (it has to).
    const enrollWhere  = [`CourseEnrollments.${orgFilter}`];
    if (sidFilter) enrollWhere.push(`CourseEnrollments.student_id = ${sidFilter}`);
    if (cidFilter) enrollWhere.push(`CourseEnrollments.course_id = ${cidFilter}`);
    const lessonWhere  = [`Lessons.${orgFilter}`];
    if (cidFilter) lessonWhere.push(`Lessons.course_id = ${cidFilter}`);
    const progressWhere = [`LessonProgress.${orgFilter}`];
    if (sidFilter) progressWhere.push(`LessonProgress.student_id = ${sidFilter}`);

    const [enrollRows, lessonRows, progressRows, courseRows, studentRows] = await Promise.all([
      zcqlAll(req, `SELECT * FROM CourseEnrollments WHERE ${enrollWhere.join(' AND ')}`, 'CourseEnrollments'),
      zcqlAll(req, `SELECT * FROM Lessons WHERE ${lessonWhere.join(' AND ')}`, 'Lessons'),
      zcqlAll(req, `SELECT * FROM LessonProgress WHERE ${progressWhere.join(' AND ')}`, 'LessonProgress'),
      zcql(req, `SELECT * FROM Courses WHERE Courses.${orgFilter}`),
      zcql(req, `SELECT * FROM Students WHERE Students.${orgFilter}`),
    ]);

    const enrollments = unwrap(enrollRows, 'CourseEnrollments').map(normalize);
    const lessons     = unwrap(lessonRows, 'Lessons').map(normalize);
    const progress    = unwrap(progressRows, 'LessonProgress').map(normalize);
    const courses     = unwrap(courseRows, 'Courses').map(normalize);
    const students    = unwrap(studentRows, 'Students').map(normalize);

    const courseById  = new Map(courses.map((c) => [String(c.id), c]));
    const studentById = new Map(students.map((s) => [String(s.id), s]));
    const lessonsByCourse = new Map();
    for (const l of lessons) {
      const k = String(l.course_id);
      if (!lessonsByCourse.has(k)) lessonsByCourse.set(k, []);
      lessonsByCourse.get(k).push(l);
    }

    const progressKey = (sid, lid) => `${sid}::${lid}`;
    const progressMap = new Map();
    for (const p of progress) {
      progressMap.set(progressKey(String(p.student_id), String(p.lesson_id)), p);
    }

    const rows = enrollments
      .filter((en) => !sidFilter || String(en.student_id) === sidFilter)
      .filter((en) => !cidFilter || String(en.course_id) === cidFilter)
      .map((en) => {
        const course = courseById.get(String(en.course_id));
        const student = studentById.get(String(en.student_id));
        const courseLessons = lessonsByCourse.get(String(en.course_id)) || [];
        let completed = 0;
        let totalSeconds = 0;
        let lastTouched = null;
        for (const l of courseLessons) {
          const p = progressMap.get(progressKey(String(en.student_id), String(l.id)));
          if (!p) continue;
          if (p.completed) completed++;
          totalSeconds += Number(p.watched_seconds) || 0;
          const t = p.MODIFIEDTIME || p.updated_at;
          if (t && (!lastTouched || String(t) > String(lastTouched))) lastTouched = t;
        }
        return {
          student_id: en.student_id,
          student_name: student?.name || null,
          course_id: en.course_id,
          course_name: course?.name || null,
          lessons_total: courseLessons.length,
          lessons_completed: completed,
          percent_complete: courseLessons.length > 0 ? Math.round((completed / courseLessons.length) * 100) : 0,
          total_watched_minutes: Math.round(totalSeconds / 60),
          last_activity_at: lastTouched,
        };
      });

    rows.sort((a, b) => {
      if (!a.last_activity_at && !b.last_activity_at) return 0;
      if (!a.last_activity_at) return 1;
      if (!b.last_activity_at) return -1;
      return String(b.last_activity_at).localeCompare(String(a.last_activity_at));
    });

    res.json({ activity: rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch lesson activity', detail: e.message });
  }
});

// POST /api/lessons
router.post('/', async (req, res) => {
  try {
    const { course_id, title, description, video_url, duration_seconds, order_index,
            section_name, start_seconds, end_seconds,
            content_type, content_url, quiz_required, quiz_shuffle,
            quiz_shuffle_options, quiz_pass_mark } = req.body;
    const type = content_type || 'video';
    const isQuiz = type === 'quiz';
    const url = type === 'document' ? content_url : video_url;
    // Quiz lessons carry no URL — their content is the question bank
    // (LessonQuizzes), authored separately. Video/document lessons need a URL.
    if (!course_id || !title || (!isQuiz && !url)) {
      return res.status(400).json({ error: isQuiz ? 'course_id and title are required' : 'course_id, title, and URL are required' });
    }
    if (!(await courseInOrg(req, course_id))) {
      return res.status(404).json({ error: 'Course not found' });
    }
    let nextOrder = Number(order_index);
    if (!Number.isFinite(nextOrder)) {
      try {
        const rows = await zcql(req, `SELECT * FROM Lessons WHERE Lessons.course_id = ${safeId(course_id)} AND Lessons.org_id = ${Number(req.orgId)}`);
        const existing = unwrap(rows, 'Lessons');
        nextOrder = existing.reduce((m, l) => Math.max(m, Number(l.order_index) || 0), 0) + 1;
      } catch { nextOrder = 1; }
    }
    const payload = {
      course_id: String(course_id),
      title,
      description: description || '',
      video_url: type === 'video' ? url : '',
      content_url: type === 'document' ? url : '',
      content_type: type,
      duration_seconds: Number(duration_seconds) || 0,
      order_index: nextOrder,
      section_name: section_name || '',
      start_seconds: Number(start_seconds) || 0,
      end_seconds: Number(end_seconds) || 0,
      org_id: Number(req.orgId),
    };
    // Only quiz lessons touch the quiz_required column — so creating a
    // video/document lesson never references it (safe even before the column
    // is added to the Lessons table in the console).
    if (isQuiz) {
      payload.quiz_required = (quiz_required === true || quiz_required === 'true');
      payload.quiz_shuffle = (quiz_shuffle === true || quiz_shuffle === 'true');
      payload.quiz_shuffle_options = (quiz_shuffle_options === true || quiz_shuffle_options === 'true');
      const pm = Number(quiz_pass_mark);
      if (Number.isFinite(pm) && pm >= 1 && pm <= 100) payload.quiz_pass_mark = Math.round(pm);
    }
    const row = await insert(req, 'Lessons', payload);

    // Notify enrolled students about the new lesson / quiz (best-effort).
    try {
      const studentIds = await enrolledStudentIds(req, course_id);
      if (studentIds.length) {
        const course = await getById(req, 'Courses', course_id).catch(() => null);
        const courseName = course ? (course.title || course.name || 'your course') : 'your course';
        await createNotifications(req, {
          orgId: Number(req.orgId),
          studentIds,
          type: isQuiz ? 'quiz' : 'lesson',
          title: isQuiz ? 'New quiz available' : 'New lesson available',
          body: `“${title}” was added to ${courseName}.`,
          link: '/portal/courses',
        });
      }
    } catch (notifyErr) {
      console.error('[lessons] new-lesson notify failed:', notifyErr.message);
    }

    res.status(201).json({ lesson: normalize(row) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create lesson', detail: e.message });
  }
});

// POST /api/lessons/bulk
router.post('/bulk', async (req, res) => {
  try {
    const { course_id, lessons } = req.body;
    if (!course_id || !Array.isArray(lessons) || lessons.length === 0) {
      return res.status(400).json({ error: 'course_id and lessons[] are required' });
    }
    if (!(await courseInOrg(req, course_id))) {
      return res.status(404).json({ error: 'Course not found' });
    }
    let startOrder = 1;
    try {
      const rows = await zcql(req, `SELECT * FROM Lessons WHERE Lessons.course_id = ${safeId(course_id)} AND Lessons.org_id = ${Number(req.orgId)}`);
      const existing = unwrap(rows, 'Lessons');
      startOrder = existing.reduce((m, l) => Math.max(m, Number(l.order_index) || 0), 0) + 1;
    } catch {}
    const created = [];
    for (let i = 0; i < lessons.length; i++) {
      const l = lessons[i];
      if (!l.title || !l.video_url) continue;
      try {
        const row = await insert(req, 'Lessons', {
          course_id: String(course_id),
          title: l.title,
          description: l.description || '',
          video_url: l.video_url,
          duration_seconds: Number(l.duration_seconds) || 0,
          order_index: startOrder + i,
          section_name: l.section_name || '',
          start_seconds: Number(l.start_seconds) || 0,
          end_seconds: Number(l.end_seconds) || 0,
          org_id: Number(req.orgId),
        });
        created.push(normalize(row));
      } catch (err) { console.error('bulk lesson insert failed', err.message); }
    }
    res.status(201).json({ lessons: created, count: created.length });
  } catch (e) {
    res.status(500).json({ error: 'Failed to bulk-create lessons', detail: e.message });
  }
});

// POST /api/lessons/reorder
router.post('/reorder', async (req, res) => {
  try {
    const { updates } = req.body;
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: 'updates[] required' });
    }
    let updated = 0;
    for (const u of updates) {
      if (!u?.id) continue;
      // Verify lesson is in caller's org before touching.
      const lesson = await getById(req, 'Lessons', u.id);
      if (!lesson || Number(lesson.org_id) !== Number(req.orgId)) continue;
      const patch = {};
      if (u.order_index !== undefined) patch.order_index = Number(u.order_index) || 0;
      if (u.section_name !== undefined) patch.section_name = u.section_name || '';
      try {
        await update(req, 'Lessons', u.id, patch);
        updated++;
      } catch (err) { console.error('reorder failed for', u.id, err.message); }
    }
    res.json({ updated });
  } catch (e) {
    res.status(500).json({ error: 'Failed to reorder', detail: e.message });
  }
});

// PUT /api/lessons/:id
router.put('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Lessons', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Lesson not found' });
    }
    const { title, description, video_url, duration_seconds, order_index,
            section_name, start_seconds, end_seconds,
            content_type, content_url, quiz_required, quiz_shuffle,
            quiz_shuffle_options, quiz_pass_mark } = req.body;
    const patch = {};
    if (title !== undefined)            patch.title = title;
    if (description !== undefined)      patch.description = description;
    if (video_url !== undefined)        patch.video_url = video_url;
    if (duration_seconds !== undefined) patch.duration_seconds = Number(duration_seconds) || 0;
    if (order_index !== undefined)      patch.order_index = Number(order_index) || 0;
    if (section_name !== undefined)     patch.section_name = section_name;
    if (start_seconds !== undefined)    patch.start_seconds = Number(start_seconds) || 0;
    if (end_seconds !== undefined)      patch.end_seconds = Number(end_seconds) || 0;
    if (content_type !== undefined)     patch.content_type = content_type;
    if (content_url !== undefined)      patch.content_url = content_url;
    // quiz_required / quiz_shuffle are only sent by the client for quiz lessons.
    if (quiz_required !== undefined)    patch.quiz_required = (quiz_required === true || quiz_required === 'true');
    if (quiz_shuffle !== undefined)     patch.quiz_shuffle = (quiz_shuffle === true || quiz_shuffle === 'true');
    if (quiz_shuffle_options !== undefined) patch.quiz_shuffle_options = (quiz_shuffle_options === true || quiz_shuffle_options === 'true');
    if (quiz_pass_mark !== undefined) {
      const n = Number(quiz_pass_mark);
      patch.quiz_pass_mark = (Number.isFinite(n) && n >= 1 && n <= 100) ? Math.round(n) : null;
    }
    const updated = await update(req, 'Lessons', req.params.id, patch);
    res.json({ lesson: normalize(updated) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update lesson', detail: e.message });
  }
});

// DELETE /api/lessons/:id
router.delete('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Lessons', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Lesson not found' });
    }
    try {
      const progress = await zcql(req, `SELECT ROWID FROM LessonProgress WHERE LessonProgress.lesson_id = ${req.params.id} AND LessonProgress.org_id = ${Number(req.orgId)}`);
      for (const p of unwrap(progress, 'LessonProgress')) {
        try { await remove(req, 'LessonProgress', p.ROWID); } catch {}
      }
    } catch {}
    // Remove the quiz questions attached to this lesson so they are not orphaned.
    try {
      const qq = await zcql(req, `SELECT ROWID FROM LessonQuizzes WHERE LessonQuizzes.lesson_id = ${req.params.id} AND LessonQuizzes.org_id = ${Number(req.orgId)}`);
      for (const q of unwrap(qq, 'LessonQuizzes')) {
        try { await remove(req, 'LessonQuizzes', q.ROWID); } catch {}
      }
    } catch {}
    await remove(req, 'Lessons', req.params.id);
    res.json({ message: 'Lesson deleted' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete lesson', detail: e.message });
  }
});

module.exports = router;
