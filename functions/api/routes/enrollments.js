// /api/enrollments — Admin CRUD for CourseEnrollments (student × course link table).
// Plus per-course summary (who's enrolled, who's not, progress %).

const router = require('express').Router();
const { insert, getById, getAll, remove, zcql, unwrap, normalize, safeId, q } = require('../db/catalystDb');

// GET /api/enrollments?course_id=X  — list enrollments for a course, decorated with student name + progress %
router.get('/', async (req, res) => {
  try {
    const cid = safeId(req.query.course_id);
    if (!cid) return res.status(400).json({ error: 'course_id is required' });
    const rows = await zcql(req, `SELECT * FROM CourseEnrollments WHERE CourseEnrollments.course_id = ${cid}`);
    const list = unwrap(rows, 'CourseEnrollments').map(normalize);

    // Pull THIS course's lesson IDs so we can scope progress counts to it.
    // Without this, a student's completed lessons from OTHER courses would
    // pollute the count here.
    let courseLessonIds = new Set();
    try {
      const lessonRows = await zcql(req, `SELECT ROWID FROM Lessons WHERE Lessons.course_id = ${cid}`);
      courseLessonIds = new Set(unwrap(lessonRows, 'Lessons').map((l) => String(l.ROWID)));
    } catch {}
    const lessonCount = courseLessonIds.size;

    // Decorate with student name + completion count (scoped to this course)
    const decorated = await Promise.all(list.map(async (en) => {
      let student_name = null;
      try {
        const s = await getById(req, 'Students', en.student_id);
        student_name = s?.name || null;
      } catch {}
      let completed = 0;
      try {
        const progressRows = await zcql(req,
          `SELECT * FROM LessonProgress WHERE LessonProgress.student_id = ${safeId(en.student_id)} AND LessonProgress.completed = true`
        );
        // Filter to only lessons that belong to THIS course.
        completed = unwrap(progressRows, 'LessonProgress')
          .filter((p) => courseLessonIds.has(String(p.lesson_id)))
          .length;
      } catch {}
      return {
        ...en,
        student_name,
        lessons_completed: completed,
        lessons_total: lessonCount,
        progress_percent: lessonCount > 0 ? Math.round((completed / lessonCount) * 100) : 0,
      };
    }));
    decorated.sort((a, b) => String(a.student_name || '').localeCompare(String(b.student_name || '')));
    res.json({ enrollments: decorated });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch enrollments', detail: e.message });
  }
});

// POST /api/enrollments  — body: { course_id, student_id }  OR  { course_id, student_ids: [...] }
router.post('/', async (req, res) => {
  try {
    const { course_id, student_id, student_ids } = req.body;
    if (!course_id) return res.status(400).json({ error: 'course_id is required' });
    const ids = Array.isArray(student_ids) && student_ids.length ? student_ids : student_id ? [student_id] : [];
    if (!ids.length) return res.status(400).json({ error: 'student_id or student_ids[] required' });

    // Skip duplicates: check existing enrollments for this course
    let existingIds = new Set();
    try {
      const existingRows = await zcql(req, `SELECT * FROM CourseEnrollments WHERE CourseEnrollments.course_id = ${safeId(course_id)}`);
      existingIds = new Set(unwrap(existingRows, 'CourseEnrollments').map((e) => String(e.student_id)));
    } catch {}

    const created = [];
    for (const sid of ids) {
      if (existingIds.has(String(sid))) continue;
      try {
        const row = await insert(req, 'CourseEnrollments', {
          course_id: String(course_id),
          student_id: String(sid),
          status: 'active',
        });
        created.push(normalize(row));
      } catch (err) { console.error('enrollment failed', sid, err.message); }
    }
    res.status(201).json({ enrollments: created, count: created.length });
  } catch (e) {
    res.status(500).json({ error: 'Failed to enroll', detail: e.message });
  }
});

// DELETE /api/enrollments/:id  — unenroll a student from a course
router.delete('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'CourseEnrollments', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Enrollment not found' });
    await remove(req, 'CourseEnrollments', req.params.id);
    res.json({ message: 'Unenrolled' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to unenroll', detail: e.message });
  }
});

module.exports = router;
