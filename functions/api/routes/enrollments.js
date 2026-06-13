// /api/enrollments — Admin CRUD for CourseEnrollments. Org-scoped.

const router = require('express').Router();
const { insert, getById, remove, zcql, unwrap, normalize, safeId } = require('../db/catalystDb');

// GET /api/enrollments?course_id=X
router.get('/', async (req, res) => {
  try {
    const cid = safeId(req.query.course_id);
    if (!cid) return res.status(400).json({ error: 'course_id is required' });
    // Verify course belongs to caller's org.
    const course = await getById(req, 'Courses', cid);
    if (!course || Number(course.org_id) !== Number(req.orgId)) {
      return res.json({ enrollments: [] });
    }
    const rows = await zcql(req, `SELECT * FROM CourseEnrollments WHERE CourseEnrollments.course_id = ${cid} AND CourseEnrollments.org_id = ${Number(req.orgId)}`);
    const list = unwrap(rows, 'CourseEnrollments').map(normalize);

    let courseLessonIds = new Set();
    try {
      const lessonRows = await zcql(req, `SELECT ROWID FROM Lessons WHERE Lessons.course_id = ${cid} AND Lessons.org_id = ${Number(req.orgId)}`);
      courseLessonIds = new Set(unwrap(lessonRows, 'Lessons').map((l) => String(l.ROWID)));
    } catch {}
    const lessonCount = courseLessonIds.size;

    const decorated = await Promise.all(list.map(async (en) => {
      let student_name = null;
      try {
        const s = await getById(req, 'Students', en.student_id);
        if (s && Number(s.org_id) === Number(req.orgId)) student_name = s.name;
      } catch {}
      let completed = 0;
      try {
        const progressRows = await zcql(req,
          `SELECT * FROM LessonProgress WHERE LessonProgress.student_id = ${safeId(en.student_id)} AND LessonProgress.completed = true AND LessonProgress.org_id = ${Number(req.orgId)}`
        );
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

// POST /api/enrollments
router.post('/', async (req, res) => {
  try {
    const { course_id, student_id, student_ids } = req.body;
    if (!course_id) return res.status(400).json({ error: 'course_id is required' });
    // Verify course is in caller's org.
    const course = await getById(req, 'Courses', course_id);
    if (!course || Number(course.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Course not found' });
    }
    const ids = Array.isArray(student_ids) && student_ids.length ? student_ids : student_id ? [student_id] : [];
    if (!ids.length) return res.status(400).json({ error: 'student_id or student_ids[] required' });

    let existingIds = new Set();
    try {
      const existingRows = await zcql(req, `SELECT * FROM CourseEnrollments WHERE CourseEnrollments.course_id = ${safeId(course_id)} AND CourseEnrollments.org_id = ${Number(req.orgId)}`);
      existingIds = new Set(unwrap(existingRows, 'CourseEnrollments').map((e) => String(e.student_id)));
    } catch {}

    const created = [];
    for (const sid of ids) {
      if (existingIds.has(String(sid))) continue;
      try {
        // Verify student is in caller's org.
        const s = await getById(req, 'Students', String(sid));
        if (!s || Number(s.org_id) !== Number(req.orgId)) continue;
        const row = await insert(req, 'CourseEnrollments', {
          course_id: String(course_id),
          student_id: String(sid),
          status: 'active',
          org_id: Number(req.orgId),
        });
        created.push(normalize(row));
      } catch (err) { console.error('enrollment failed', sid, err.message); }
    }
    res.status(201).json({ enrollments: created, count: created.length });
  } catch (e) {
    res.status(500).json({ error: 'Failed to enroll', detail: e.message });
  }
});

// DELETE /api/enrollments/:id
router.delete('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'CourseEnrollments', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }
    await remove(req, 'CourseEnrollments', req.params.id);
    res.json({ message: 'Unenrolled' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to unenroll', detail: e.message });
  }
});

module.exports = router;
