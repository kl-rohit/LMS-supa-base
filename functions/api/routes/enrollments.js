// /api/enrollments — Admin CRUD for CourseEnrollments. Org-scoped.

const router = require('express').Router();
const { insert, getById, update, remove, zcql, zcqlAll, unwrap, normalize, safeId } = require('../db/catalystDb');
const { createNotifications } = require('../lib/notify');
const { resolveAudienceStudentIds } = require('../lib/audience');

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

    // Student names: one org Students pull → name map (replaces 2N getById).
    const studentRows = await zcqlAll(req, `SELECT ROWID, name FROM Students WHERE Students.org_id = ${Number(req.orgId)}`, 'Students').catch(() => []);
    const studentName = new Map(unwrap(studentRows, 'Students').map((s) => [String(s.ROWID), s.name]));

    // Completed-lesson counts. Prefer the precomputed `completed_count` stored
    // on each enrollment row (bumped at completion time in the portal, and
    // reconciled by POST /recompute). Only when that column is absent do we
    // fall back to the live LessonProgress scan, scoped to this course's
    // lessons. Reading the stored count turns this page's cost from "scan the
    // fastest-growing table in the app" into zero extra reads.
    const columnPresent = list.length > 0 && Object.prototype.hasOwnProperty.call(list[0], 'completed_count');
    const completedByStudent = new Map();
    if (!columnPresent) {
      const lessonIdList = [...courseLessonIds];
      const progressRows = lessonIdList.length
        ? await zcqlAll(
            req,
            `SELECT student_id, lesson_id FROM LessonProgress WHERE LessonProgress.completed = true AND LessonProgress.lesson_id IN (${lessonIdList.join(',')}) AND LessonProgress.org_id = ${Number(req.orgId)}`,
            'LessonProgress'
          ).catch(() => [])
        : [];
      for (const p of unwrap(progressRows, 'LessonProgress')) {
        if (!courseLessonIds.has(String(p.lesson_id))) continue; // defensive
        const k = String(p.student_id);
        completedByStudent.set(k, (completedByStudent.get(k) || 0) + 1);
      }
    }

    const decorated = list.map((en) => {
      const student_name = studentName.has(String(en.student_id)) ? studentName.get(String(en.student_id)) : null;
      const completed = columnPresent
        ? (Number(en.completed_count) || 0)
        : (completedByStudent.get(String(en.student_id)) || 0);
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
    const { course_id, student_id, student_ids, target_type } = req.body;
    if (!course_id) return res.status(400).json({ error: 'course_id is required' });
    // Verify course is in caller's org.
    const course = await getById(req, 'Courses', course_id);
    if (!course || Number(course.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Course not found' });
    }
    // Enrol either an explicit student / list, OR an audience (Everyone / a
    // Group / Specific students) resolved through the shared resolver. Audience
    // assign is ADDITIVE — it enrols the resolved students; it never unenrols
    // anyone (that would delete their progress), so removals stay explicit.
    let ids = Array.isArray(student_ids) && student_ids.length ? student_ids : student_id ? [student_id] : [];
    if (!ids.length && target_type) {
      ids = await resolveAudienceStudentIds(req, { target_type, target_id: req.body.target_id, target_ids: req.body.target_ids });
    }
    if (!ids.length) return res.status(400).json({ error: 'student_id, student_ids[], or a target is required' });

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

// POST /api/enrollments/recompute — backfill / reconcile completed_count for
// every enrollment in the caller's org. Run once after adding the
// completed_count column, and any time you want the precomputed counts
// reconciled with the live LessonProgress data. This does the heavy org-wide
// scan ONCE here, instead of on every enrollments page load.
router.post('/recompute', async (req, res) => {
  try {
    const enrollRows = await zcqlAll(req, `SELECT ROWID, student_id, course_id, completed_count FROM CourseEnrollments WHERE CourseEnrollments.org_id = ${Number(req.orgId)}`, 'CourseEnrollments').catch(() => []);
    const enrollments = unwrap(enrollRows, 'CourseEnrollments');
    if (!enrollments.length) return res.json({ updated: 0, failed: 0, total: 0, message: 'No enrollments' });

    const lessonRows = await zcqlAll(req, `SELECT ROWID, course_id FROM Lessons WHERE Lessons.org_id = ${Number(req.orgId)}`, 'Lessons').catch(() => []);
    const lessonsByCourse = new Map();
    for (const l of unwrap(lessonRows, 'Lessons')) {
      const c = String(l.course_id);
      if (!lessonsByCourse.has(c)) lessonsByCourse.set(c, new Set());
      lessonsByCourse.get(c).add(String(l.ROWID));
    }

    const progRows = await zcqlAll(req, `SELECT student_id, lesson_id FROM LessonProgress WHERE LessonProgress.completed = true AND LessonProgress.org_id = ${Number(req.orgId)}`, 'LessonProgress').catch(() => []);
    const byStudent = new Map(); // studentId → Set(lessonId)
    for (const p of unwrap(progRows, 'LessonProgress')) {
      const s = String(p.student_id);
      if (!byStudent.has(s)) byStudent.set(s, new Set());
      byStudent.get(s).add(String(p.lesson_id));
    }

    let updated = 0, failed = 0;
    for (const en of enrollments) {
      const lessons = lessonsByCourse.get(String(en.course_id)) || new Set();
      const done = byStudent.get(String(en.student_id)) || new Set();
      let count = 0;
      for (const lid of done) if (lessons.has(lid)) count++;
      if (Number(en.completed_count) === count) continue; // already correct
      try { await update(req, 'CourseEnrollments', en.ROWID, { completed_count: count }); updated++; }
      catch { failed++; }
    }
    res.json({ updated, failed, total: enrollments.length });
  } catch (e) {
    res.status(500).json({ error: 'Recompute failed', detail: e.message });
  }
});

module.exports = router;
