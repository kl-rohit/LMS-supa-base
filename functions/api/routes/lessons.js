// /api/lessons — Admin CRUD for Lessons. Each Lesson belongs to a Course.

const router = require('express').Router();
const { insert, getById, update, remove, zcql, unwrap, normalize, safeId } = require('../db/catalystDb');

// GET /api/lessons?course_id=X
router.get('/', async (req, res) => {
  try {
    const cid = safeId(req.query.course_id);
    if (!cid) return res.status(400).json({ error: 'course_id is required' });
    const rows = await zcql(req, `SELECT * FROM Lessons WHERE Lessons.course_id = ${cid} ORDER BY Lessons.order_index ASC`);
    res.json({ lessons: unwrap(rows, 'Lessons').map(normalize) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch lessons', detail: e.message });
  }
});

// GET /api/lessons/activity  (admin) — aggregated per-student × per-course progress
// Optional query: ?student_id=X, ?course_id=X
// Returns: rows = [{ student_id, student_name, course_id, course_name,
//                    lessons_total, lessons_completed, percent_complete,
//                    total_watched_minutes, last_activity_at }]
router.get('/activity', async (req, res) => {
  try {
    const sidFilter = safeId(req.query.student_id);
    const cidFilter = safeId(req.query.course_id);

    // Pull everything in parallel. LessonProgress may exceed 300 rows at scale;
    // we'd paginate then. For now this is fine for a small academy.
    const [enrollRows, lessonRows, progressRows, courseRows, studentRows] = await Promise.all([
      zcql(req, `SELECT * FROM CourseEnrollments`),
      zcql(req, `SELECT * FROM Lessons`),
      zcql(req, `SELECT * FROM LessonProgress`),
      zcql(req, `SELECT * FROM Courses`),
      zcql(req, `SELECT * FROM Students`),
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

    // Index progress by (student_id, lesson_id)
    const progressKey = (sid, lid) => `${sid}::${lid}`;
    const progressMap = new Map();
    for (const p of progress) {
      progressMap.set(progressKey(String(p.student_id), String(p.lesson_id)), p);
    }

    // One row per enrollment.
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

    // Sort: most recent activity first; null activity last.
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
    const { course_id, title, description, video_url, duration_seconds, order_index } = req.body;
    if (!course_id || !title || !video_url) {
      return res.status(400).json({ error: 'course_id, title, video_url are required' });
    }
    // Default order_index = (max for this course) + 1
    let nextOrder = Number(order_index);
    if (!Number.isFinite(nextOrder)) {
      try {
        const rows = await zcql(req, `SELECT * FROM Lessons WHERE Lessons.course_id = ${safeId(course_id)}`);
        const existing = unwrap(rows, 'Lessons');
        nextOrder = existing.reduce((m, l) => Math.max(m, Number(l.order_index) || 0), 0) + 1;
      } catch { nextOrder = 1; }
    }
    const row = await insert(req, 'Lessons', {
      course_id: String(course_id),
      title,
      description: description || '',
      video_url,
      duration_seconds: Number(duration_seconds) || 0,
      order_index: nextOrder,
    });
    res.status(201).json({ lesson: normalize(row) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create lesson', detail: e.message });
  }
});

// PUT /api/lessons/:id
router.put('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Lessons', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Lesson not found' });
    const { title, description, video_url, duration_seconds, order_index } = req.body;
    const patch = {};
    if (title !== undefined)            patch.title = title;
    if (description !== undefined)      patch.description = description;
    if (video_url !== undefined)        patch.video_url = video_url;
    if (duration_seconds !== undefined) patch.duration_seconds = Number(duration_seconds) || 0;
    if (order_index !== undefined)      patch.order_index = Number(order_index) || 0;
    const updated = await update(req, 'Lessons', req.params.id, patch);
    res.json({ lesson: normalize(updated) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update lesson', detail: e.message });
  }
});

// DELETE /api/lessons/:id — hard delete. Also clears all progress rows for it.
router.delete('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Lessons', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Lesson not found' });
    try {
      const progress = await zcql(req, `SELECT ROWID FROM LessonProgress WHERE LessonProgress.lesson_id = ${req.params.id}`);
      for (const p of unwrap(progress, 'LessonProgress')) {
        try { await remove(req, 'LessonProgress', p.ROWID); } catch {}
      }
    } catch {}
    await remove(req, 'Lessons', req.params.id);
    res.json({ message: 'Lesson deleted' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete lesson', detail: e.message });
  }
});

module.exports = router;
