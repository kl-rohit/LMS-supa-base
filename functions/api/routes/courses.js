// /api/courses — Admin CRUD for Course definitions.
// Courses group Lessons. Parents access Lessons via CourseEnrollments.

const router = require('express').Router();
const { insert, getById, getAll, update, remove, zcql, unwrap, normalize } = require('../db/catalystDb');

// GET /api/courses — list active by default; ?status=all|active|archived
router.get('/', async (req, res) => {
  try {
    const status = req.query.status || 'active';
    const rows = await getAll(req, 'Courses');
    let list = rows.map(normalize);
    if (status !== 'all') {
      list = list.filter((c) => (c.status || 'active') === status);
    }
    list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    res.json({ courses: list });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch courses', detail: e.message });
  }
});

// GET /api/courses/:id  — course + its lesson list
router.get('/:id', async (req, res) => {
  try {
    const course = await getById(req, 'Courses', req.params.id);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    let lessons = [];
    try {
      const rows = await zcql(req, `SELECT * FROM Lessons WHERE Lessons.course_id = ${req.params.id} ORDER BY Lessons.order_index ASC`);
      lessons = unwrap(rows, 'Lessons').map(normalize);
    } catch {}
    res.json({ course: normalize(course), lessons });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch course', detail: e.message });
  }
});

// POST /api/courses
router.post('/', async (req, res) => {
  try {
    const { name, description, thumbnail_url } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const row = await insert(req, 'Courses', {
      name,
      description: description || '',
      thumbnail_url: thumbnail_url || '',
      status: 'active',
    });
    res.status(201).json({ course: normalize(row) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create course', detail: e.message });
  }
});

// PUT /api/courses/:id
router.put('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Courses', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Course not found' });
    const { name, description, thumbnail_url, status } = req.body;
    const patch = {};
    if (name !== undefined)          patch.name = name;
    if (description !== undefined)   patch.description = description;
    if (thumbnail_url !== undefined) patch.thumbnail_url = thumbnail_url;
    if (status !== undefined)        patch.status = status;
    const updated = await update(req, 'Courses', req.params.id, patch);
    res.json({ course: normalize(updated) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update course', detail: e.message });
  }
});

// DELETE /api/courses/:id  — soft-delete by default; ?force=true to hard delete
router.delete('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Courses', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Course not found' });
    const force = req.query.force === 'true' || req.query.force === '1';
    if (!force) {
      await update(req, 'Courses', req.params.id, { status: 'archived' });
      return res.json({ message: 'Course archived' });
    }
    // Hard delete — also clear lessons + enrollments + progress for this course.
    try {
      const lessons = await zcql(req, `SELECT ROWID FROM Lessons WHERE Lessons.course_id = ${req.params.id}`);
      for (const l of unwrap(lessons, 'Lessons')) {
        try { await remove(req, 'Lessons', l.ROWID); } catch {}
        try {
          const progress = await zcql(req, `SELECT ROWID FROM LessonProgress WHERE LessonProgress.lesson_id = ${l.ROWID}`);
          for (const p of unwrap(progress, 'LessonProgress')) {
            try { await remove(req, 'LessonProgress', p.ROWID); } catch {}
          }
        } catch {}
      }
    } catch {}
    try {
      const enrollments = await zcql(req, `SELECT ROWID FROM CourseEnrollments WHERE CourseEnrollments.course_id = ${req.params.id}`);
      for (const e of unwrap(enrollments, 'CourseEnrollments')) {
        try { await remove(req, 'CourseEnrollments', e.ROWID); } catch {}
      }
    } catch {}
    await remove(req, 'Courses', req.params.id);
    res.json({ message: 'Course permanently deleted' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete course', detail: e.message });
  }
});

module.exports = router;
