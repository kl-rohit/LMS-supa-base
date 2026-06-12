// /api/lessons — Admin CRUD for Lessons. Each Lesson belongs to a Course.

const router = require('express').Router();
const { insert, getById, update, remove, zcql, zcqlAll, unwrap, normalize, safeId } = require('../db/catalystDb');

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

    // Pull everything in parallel. LessonProgress + Attendance scale fastest,
    // so use zcqlAll (paginated) for the tables that grow with usage. The
    // smaller bounded tables (Courses, Students) still go through plain zcql
    // — they're capped well below 300 in practice.
    const [enrollRows, lessonRows, progressRows, courseRows, studentRows] = await Promise.all([
      zcqlAll(req, `SELECT * FROM CourseEnrollments`, 'CourseEnrollments'),
      zcqlAll(req, `SELECT * FROM Lessons`, 'Lessons'),
      zcqlAll(req, `SELECT * FROM LessonProgress`, 'LessonProgress'),
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
    const { course_id, title, description, video_url, duration_seconds, order_index,
            section_name, start_seconds, end_seconds,
            content_type, content_url } = req.body;
    // For video lessons, video_url is the primary URL; for document
    // lessons, content_url is. Require at least one based on type.
    const type = content_type || 'video';
    const url = type === 'document' ? content_url : video_url;
    if (!course_id || !title || !url) {
      return res.status(400).json({ error: 'course_id, title, and URL are required' });
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
      video_url: type === 'video' ? url : '',
      content_url: type === 'document' ? url : '',
      content_type: type,
      duration_seconds: Number(duration_seconds) || 0,
      order_index: nextOrder,
      section_name: section_name || '',
      start_seconds: Number(start_seconds) || 0,
      end_seconds: Number(end_seconds) || 0,
    });
    res.status(201).json({ lesson: normalize(row) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create lesson', detail: e.message });
  }
});

// POST /api/lessons/bulk — create multiple lessons in one call
// Body: { course_id, lessons: [{title, video_url, ...}] }
// Used by the "Split video into chapter-lessons" admin action.
router.post('/bulk', async (req, res) => {
  try {
    const { course_id, lessons } = req.body;
    if (!course_id || !Array.isArray(lessons) || lessons.length === 0) {
      return res.status(400).json({ error: 'course_id and lessons[] are required' });
    }
    // Determine starting order_index = current max + 1
    let startOrder = 1;
    try {
      const rows = await zcql(req, `SELECT * FROM Lessons WHERE Lessons.course_id = ${safeId(course_id)}`);
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
        });
        created.push(normalize(row));
      } catch (err) { console.error('bulk lesson insert failed', err.message); }
    }
    res.status(201).json({ lessons: created, count: created.length });
  } catch (e) {
    res.status(500).json({ error: 'Failed to bulk-create lessons', detail: e.message });
  }
});

// POST /api/lessons/reorder — bulk-update order_index + section_name on multiple lessons
// Body: { updates: [{ id, order_index, section_name? }] }
// Used by the admin's drag-reorder UI.
router.post('/reorder', async (req, res) => {
  try {
    const { updates } = req.body;
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: 'updates[] required' });
    }
    let updated = 0;
    for (const u of updates) {
      if (!u?.id) continue;
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
    if (!existing) return res.status(404).json({ error: 'Lesson not found' });
    const { title, description, video_url, duration_seconds, order_index,
            section_name, start_seconds, end_seconds,
            content_type, content_url } = req.body;
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
