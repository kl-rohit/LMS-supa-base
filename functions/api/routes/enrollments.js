// /api/enrollments — Admin CRUD for CourseEnrollments. Org-scoped.

const router = require('express').Router();
const { insert, getById, remove, zcql, zcqlAll, unwrap, normalize, safeId } = require('../db/catalystDb');
const { createNotifications } = require('../lib/notify');

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

    // Resolve student names and completed-lesson counts in bulk instead of two
    // reads per enrollment. One Students pull (name map) plus one completed
    // LessonProgress pull replace the old 2N getById + per-student fan-out.
    //
    // The progress pull is scoped to THIS course's lessons (lesson_id IN ...),
    // not the whole org. LessonProgress grows as students x lessons-watched —
    // it is the fastest-growing table in the app — so an org-wide pull would
    // silently balloon into many 300-row pages as the academy matures. Bounding
    // it to the course's lessons keeps the read proportional to this course.
    const lessonIdList = [...courseLessonIds];
    const progressQuery = lessonIdList.length
      ? zcqlAll(
          req,
          `SELECT student_id, lesson_id FROM LessonProgress WHERE LessonProgress.completed = true AND LessonProgress.lesson_id IN (${lessonIdList.join(',')}) AND LessonProgress.org_id = ${Number(req.orgId)}`,
          'LessonProgress'
        ).catch(() => [])
      : Promise.resolve([]);
    const [studentRows, progressRows] = await Promise.all([
      zcqlAll(req, `SELECT ROWID, name FROM Students WHERE Students.org_id = ${Number(req.orgId)}`, 'Students').catch(() => []),
      progressQuery,
    ]);
    const studentName = new Map(unwrap(studentRows, 'Students').map((s) => [String(s.ROWID), s.name]));
    const completedByStudent = new Map();
    for (const p of unwrap(progressRows, 'LessonProgress')) {
      if (!courseLessonIds.has(String(p.lesson_id))) continue; // defensive
      const k = String(p.student_id);
      completedByStudent.set(k, (completedByStudent.get(k) || 0) + 1);
    }

    const decorated = list.map((en) => {
      const student_name = studentName.has(String(en.student_id)) ? studentName.get(String(en.student_id)) : null;
      const completed = completedByStudent.get(String(en.student_id)) || 0;
      return {
        ...en,
        student_name,
        lessons_completed: completed,
        lessons_total: lessonCount,
        progress_percent: lessonCount > 0 ? Math.round((completed / lessonCount) * 100) : 0,
      };
    });
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
    // Notify the newly-enrolled students (best-effort).
    if (created.length) {
      try {
        const courseName = course.title || course.name || 'a course';
        await createNotifications(req, {
          orgId: Number(req.orgId),
          studentIds: created.map((c) => String(c.student_id)),
          type: 'enrollment',
          title: 'You’ve been enrolled',
          body: `You now have access to “${courseName}”.`,
          link: '/portal/courses',
        });
      } catch (notifyErr) {
        console.error('[enrollments] notify failed:', notifyErr.message);
      }
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
