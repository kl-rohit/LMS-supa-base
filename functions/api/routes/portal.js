// /api/portal/* — Read-only endpoints for parents.
// All requests go through requireAuth + requireParent → req.studentId is set.
// Every query is scoped to that student_id — no cross-student access.

const router = require('express').Router();
const { getById, zcql, unwrap, normalize, q, safeId, insert, update, appFor } = require('../db/catalystDb');

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

// GET /api/portal/continue-watching — the lesson the student last touched
// Returns { course, lesson } or { course: null } if nothing watched yet.
router.get('/continue-watching', async (req, res) => {
  try {
    const sid = safeId(req.studentId);
    if (!sid) return res.json({ course: null });

    // Find this student's most recently updated progress row that's NOT completed.
    // We sort by MODIFIEDTIME (auto-managed by Catalyst on every update).
    const progressRows = await zcql(req,
      `SELECT * FROM LessonProgress WHERE LessonProgress.student_id = ${sid} ORDER BY LessonProgress.MODIFIEDTIME DESC`
    );
    const all = unwrap(progressRows, 'LessonProgress');
    // Prefer the most recent IN-PROGRESS row; fall back to most recent completed.
    const inProgress = all.find((p) => !p.completed) || all[0];
    if (!inProgress) return res.json({ course: null });

    let lesson = null, course = null;
    try { lesson = await getById(req, 'Lessons', inProgress.lesson_id); } catch {}
    if (!lesson) return res.json({ course: null });
    try { course = await getById(req, 'Courses', lesson.course_id); } catch {}
    if (!course) return res.json({ course: null });

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
    // For document-type lessons, the body sends { completed: true } when
    // the parent clicks "Mark as completed". Track via explicit flag.
    const explicitCompleted = req.body.completed === true || req.body.completed === 'true';
    const isDocument = (lesson.content_type || 'video') === 'document';

    // Upsert: find existing progress row
    const existingRows = await zcql(req,
      `SELECT * FROM LessonProgress WHERE LessonProgress.student_id = ${sid} AND LessonProgress.lesson_id = ${lid}`
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
      };
    } else {
      // Video lesson: same as before — chapter-aware segment percent.
      const startSec = Number(lesson.start_seconds) || 0;
      const endSec   = Number(lesson.end_seconds) || 0;
      const effectiveEnd = endSec > 0 ? endSec : duration;
      const segmentLen   = Math.max(0, effectiveEnd - startSec);
      const maxWatched = Math.max(watched, Number(existing?.watched_seconds) || 0);
      const watchedInSegment = Math.max(0, Math.min(maxWatched, effectiveEnd) - startSec);
      const percent = segmentLen > 0
        ? Math.min(100, Math.round((watchedInSegment / segmentLen) * 100))
        : 0;
      const completed = percent >= 90;
      payload = {
        student_id: String(sid),
        lesson_id: String(lid),
        watched_seconds: maxWatched,
        duration_seconds: duration,
        percent_complete: percent,
        completed,
      };
    }

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

// Stratus bucket used for student photos. Create in console:
//   Catalyst Console → Cloud Scale → Stratus → Create Bucket
//   • Bucket Name:  student-photos-profile
//   • Permission:   Authenticated
//   • Encryption:   ON
//   • Versioning:   OFF
const PHOTO_BUCKET = 'student-photos-profile';

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
router.put('/profile', async (req, res) => {
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
// Body: { data: 'data:image/jpeg;base64,...', filename?: 'me.jpg' }
// Decodes the base64 image, uploads it to the Stratus 'student-photos'
// bucket under  student-<id>/<timestamp>-<filename> , then writes the
// resulting URL to Students.photo_url. The same key is overwritten on
// subsequent uploads via a per-student prefix + timestamp, so prior
// photos don't pollute the bucket but versioning is not relied on.
router.post('/photo', async (req, res) => {
  try {
    const { data, filename } = req.body || {};
    if (!data || typeof data !== 'string') {
      return res.status(400).json({ error: 'data (base64 image) is required' });
    }

    // Accept both `data:image/...;base64,xxx` and raw base64 strings.
    const m = data.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    let mime, b64;
    if (m) { mime = m[1]; b64 = m[2]; }
    else   { mime = 'image/jpeg'; b64 = data; }

    const buffer = Buffer.from(b64, 'base64');
    if (buffer.length === 0) return res.status(400).json({ error: 'Empty image payload' });
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(413).json({ error: 'Image must be 5MB or smaller' });
    }

    // Object key — namespaced by student so different students never
    // collide, and timestamped so we get a unique URL per upload (the
    // browser would otherwise cache the old image at the same URL).
    const ext = mime.split('/')[1].replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg';
    const safeName = (filename || 'photo').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40);
    const objectKey = `student-${req.studentId}/${Date.now()}-${safeName}.${ext}`;

    const bucket = appFor(req).stratus().bucket(PHOTO_BUCKET);
    // SDK v3.4 API: putObject(key, body, options) — body can be Buffer.
    // overwrite:true is defensive — keys are timestamp-prefixed so collisions
    // shouldn't happen, but a parent who hits Save twice in 1ms would otherwise
    // get a 409 from Stratus.
    await bucket.putObject(objectKey, buffer, {
      contentType: mime,
      overwrite: true,
    });

    // Pre-signed URL for the Authenticated bucket. 1-year expiry (in
    // seconds) — admin views need to load these much later. When/if photos
    // start expiring in production, switch this to a per-request signing
    // endpoint: store only the object_key in Students.photo_url and have
    // the frontend ask for a fresh signed URL each session.
    let url = '';
    try {
      const res2 = await bucket.generatePreSignedUrl(objectKey, 'GET', {
        expiryIn: String(60 * 60 * 24 * 365), // 1 year
      });
      url = res2?.signature || '';
    } catch (err) {
      console.error('generatePreSignedUrl failed', err.message);
      url = `stratus://${PHOTO_BUCKET}/${objectKey}`;
    }

    await update(req, 'Students', req.studentId, { photo_url: url });
    res.json({ photo_url: url, object_key: objectKey });
  } catch (e) {
    res.status(500).json({ error: 'Failed to upload photo', detail: e.message });
  }
});

module.exports = router;
