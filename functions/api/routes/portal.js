// /api/portal/* — Read-only endpoints for parents.
// All requests go through requireAuth + requireParent → req.studentId is set.
// Every query is scoped to that student_id — no cross-student access.

const router = require('express').Router();
const { getById, zcql, unwrap, normalize, q, safeId, insert, update } = require('../db/catalystDb');

// GET /api/portal/me — info about the linked student
router.get('/me', async (req, res) => {
  try {
    const student = await getById(req, 'Students', req.studentId);
    if (!student) return res.status(404).json({ error: 'Linked student not found' });
    res.json({
      student: normalize(student),
      login: {
        email: req.studentLogin?.email,
        user_id: req.studentLogin?.user_id,
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch student', detail: e.message });
  }
});

// GET /api/portal/attendance?month=YYYY-MM
// Returns class history scoped to the linked student.
router.get('/attendance', async (req, res) => {
  try {
    const { month } = req.query;
    const sid = safeId(req.studentId);
    if (!sid) return res.status(400).json({ error: 'Invalid student id on session' });
    let where = `Attendance.student_id = ${sid}`;
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      where += ` AND Attendance.class_date >= ${q(`${month}-01`)} AND Attendance.class_date <= ${q(`${month}-31`)}`;
    }
    const rows = await zcql(req, `SELECT * FROM Attendance WHERE ${where} ORDER BY Attendance.class_date DESC`);
    // Decorate with class_name
    const records = await Promise.all(unwrap(rows, 'Attendance').map(async (a) => {
      const out = normalize(a);
      if (a.class_id) {
        try { const c = await getById(req, 'Classes', a.class_id); if (c) out.class_name = c.name; } catch {}
      }
      return out;
    }));
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
    // Class fees (from attendance) for the requested month (or all-time)
    const attRows = await zcql(req, `SELECT * FROM Attendance WHERE Attendance.student_id = ${sid}${monthClause}`);
    const attendance = unwrap(attRows, 'Attendance');
    const classFees = attendance.reduce((s, a) => s + (Number(a.fee_charged) || 0), 0);

    // Additional fees + discounts
    let addFilter = '';
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [y, m] = month.split('-');
      addFilter = ` AND AdditionalFees.fee_year = ${parseInt(y, 10)} AND AdditionalFees.fee_month = ${parseInt(m, 10)}`;
    }
    const afRows = await zcql(req, `SELECT * FROM AdditionalFees WHERE AdditionalFees.student_id = ${sid}${addFilter}`);
    const additional = unwrap(afRows, 'AdditionalFees');
    const positiveAdditional = additional.reduce((s, a) => s + Math.max(0, Number(a.amount) || 0), 0);
    const discountTotal = additional.reduce((s, a) => s + Math.min(0, Number(a.amount) || 0), 0); // negative

    const total = classFees + positiveAdditional + discountTotal;
    res.json({
      month: month || null,
      class_fees: classFees,
      additional_fees: positiveAdditional,
      discount: Math.abs(discountTotal),
      total,
      classes_attended: attendance.filter((a) => a.status === 'present' || a.status === 'late').length,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch fees', detail: e.message });
  }
});

// ===== Lessons module — parent-facing =====
// All endpoints below verify that req.studentId is enrolled before returning
// any data. No cross-student access possible.

// GET /api/portal/courses — courses the linked student is enrolled in
router.get('/courses', async (req, res) => {
  try {
    const sid = safeId(req.studentId);
    if (!sid) return res.status(400).json({ error: 'Invalid student id' });
    const enrollRows = await zcql(req, `SELECT * FROM CourseEnrollments WHERE CourseEnrollments.student_id = ${sid}`);
    const enrollments = unwrap(enrollRows, 'CourseEnrollments').map(normalize)
      .filter((e) => (e.status || 'active') === 'active');

    if (enrollments.length === 0) return res.json({ courses: [] });

    // Fetch courses + progress summary for each enrollment
    const results = await Promise.all(enrollments.map(async (en) => {
      let course = null;
      try { course = await getById(req, 'Courses', en.course_id); } catch {}
      if (!course || (course.status && course.status !== 'active')) return null;

      let lessons = [];
      try {
        const rows = await zcql(req, `SELECT * FROM Lessons WHERE Lessons.course_id = ${safeId(en.course_id)}`);
        lessons = unwrap(rows, 'Lessons');
      } catch {}

      // Completed count for this student
      let completed = 0;
      try {
        const lessonIds = lessons.map((l) => l.ROWID);
        if (lessonIds.length > 0) {
          const progressRows = await zcql(req,
            `SELECT * FROM LessonProgress WHERE LessonProgress.student_id = ${sid} AND LessonProgress.completed = true`
          );
          const completedIds = new Set(unwrap(progressRows, 'LessonProgress').map((p) => String(p.lesson_id)));
          completed = lessons.filter((l) => completedIds.has(String(l.ROWID))).length;
        }
      } catch {}

      return {
        ...normalize(course),
        enrollment_id: en.id,
        lessons_total: lessons.length,
        lessons_completed: completed,
        progress_percent: lessons.length > 0 ? Math.round((completed / lessons.length) * 100) : 0,
      };
    }));
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

    // Verify enrollment
    const enrollRows = await zcql(req,
      `SELECT ROWID FROM CourseEnrollments WHERE CourseEnrollments.student_id = ${sid} AND CourseEnrollments.course_id = ${cid}`
    );
    if (unwrap(enrollRows, 'CourseEnrollments').length === 0) {
      return res.status(403).json({ error: 'Not enrolled in this course' });
    }

    const course = await getById(req, 'Courses', cid);
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const lessonRows = await zcql(req, `SELECT * FROM Lessons WHERE Lessons.course_id = ${cid} ORDER BY Lessons.order_index ASC`);
    const lessons = unwrap(lessonRows, 'Lessons').map(normalize);

    // Per-lesson progress
    const progressRows = await zcql(req,
      `SELECT * FROM LessonProgress WHERE LessonProgress.student_id = ${sid}`
    );
    const progressByLesson = {};
    unwrap(progressRows, 'LessonProgress').forEach((p) => {
      progressByLesson[String(p.lesson_id)] = normalize(p);
    });

    const decorated = lessons.map((l) => ({
      ...l,
      progress: progressByLesson[String(l.id)] || null,
    }));

    res.json({ course: normalize(course), lessons: decorated });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch lessons', detail: e.message });
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
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

    // Verify enrollment for this lesson's course
    const enrollRows = await zcql(req,
      `SELECT ROWID FROM CourseEnrollments WHERE CourseEnrollments.student_id = ${sid} AND CourseEnrollments.course_id = ${safeId(lesson.course_id)}`
    );
    if (unwrap(enrollRows, 'CourseEnrollments').length === 0) {
      return res.status(403).json({ error: 'Not enrolled in this course' });
    }

    const watched = Math.max(0, Number(req.body.watched_seconds) || 0);
    const duration = Math.max(0, Number(req.body.duration_seconds) || Number(lesson.duration_seconds) || 0);

    // Upsert: find existing progress row
    const existingRows = await zcql(req,
      `SELECT * FROM LessonProgress WHERE LessonProgress.student_id = ${sid} AND LessonProgress.lesson_id = ${lid}`
    );
    const existing = unwrap(existingRows, 'LessonProgress')[0];

    // Progress only moves forward: keep the highest watched_seconds ever recorded.
    // percent_complete + completed are derived from that max, so re-watching
    // an earlier segment can't undo prior progress.
    const maxWatched = Math.max(watched, Number(existing?.watched_seconds) || 0);
    const percent = duration > 0 ? Math.min(100, Math.round((maxWatched / duration) * 100)) : 0;
    const completed = percent >= 90; // 90%+ counts as complete

    const payload = {
      student_id: String(sid),
      lesson_id: String(lid),
      watched_seconds: maxWatched,
      duration_seconds: duration,
      percent_complete: percent,
      completed,
    };

    let row;
    if (existing) {
      row = await update(req, 'LessonProgress', existing.ROWID, payload);
    } else {
      row = await insert(req, 'LessonProgress', payload);
    }
    res.json({ progress: normalize(row) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update progress', detail: e.message });
  }
});

module.exports = router;
