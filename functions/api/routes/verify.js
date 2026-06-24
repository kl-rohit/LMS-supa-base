// /api/verify/:certId?c=<code> — PUBLIC certificate verification.
//
// Mounted BEFORE requireAuth in index.js: anyone with a certificate (a parent,
// a prospective employer, another academy) can confirm it is genuine without
// logging in. We never accept the cert id alone — the HMAC code must match
// (see lib/certVerify.js) — so the endpoint can't be used to enumerate
// students by guessing sequential ids.
//
// Returns { valid, student_name, course_name, academy_name, completed_at }.
// On any mismatch / missing record we return { valid:false } with HTTP 200 so
// the verify page can render a clean "could not verify" state.

const router = require('express').Router();
const { zcql, unwrap, normalize, getById } = require('../db/catalystDb');
const { parseCertId, codeMatches } = require('../lib/certVerify');

router.get('/:certId', async (req, res) => {
  try {
    const ids = parseCertId(req.params.certId);
    const code = req.query.c;
    if (!ids || !code || !codeMatches(ids.orgId, ids.courseId, ids.studentId, code)) {
      return res.json({ valid: false });
    }
    const { orgId, courseId, studentId } = ids;

    // Enrollment is the proof the certificate was issuable. (The PDF is only
    // generated once every lesson is complete; here we confirm the link.)
    // We also read the locked completion date stamped on the enrollment.
    const enroll = await zcql(req,
      `SELECT ROWID, completed_at FROM CourseEnrollments WHERE CourseEnrollments.student_id = ${studentId} AND CourseEnrollments.course_id = ${courseId} AND CourseEnrollments.org_id = ${orgId}`
    );
    const enrollRow = unwrap(enroll, 'CourseEnrollments').map(normalize)[0];
    if (!enrollRow) {
      return res.json({ valid: false });
    }

    const student = await getById(req, 'Students', studentId);
    const course = await getById(req, 'Courses', courseId);
    if (!student || !course
      || Number(normalize(student).org_id) !== orgId
      || Number(normalize(course).org_id) !== orgId) {
      return res.json({ valid: false });
    }

    let academyName = '';
    try {
      const orgRows = await zcql(req, `SELECT name, ROWID FROM Organizations WHERE ROWID = ${orgId}`);
      academyName = unwrap(orgRows, 'Organizations').map(normalize)[0]?.name || '';
    } catch { /* table/row missing — leave blank */ }

    // Completion date: prefer the date LOCKED on the enrollment (Udemy-style),
    // falling back to the latest lesson-progress timestamp for certificates
    // that were earned before the stamp existed.
    let completedAt = enrollRow.completed_at || null;
    if (!completedAt) {
      try {
        const prog = await zcql(req,
          `SELECT MODIFIEDTIME FROM LessonProgress WHERE LessonProgress.student_id = ${studentId} AND LessonProgress.org_id = ${orgId}`
        );
        for (const p of unwrap(prog, 'LessonProgress')) {
          const t = p.MODIFIEDTIME || p.CREATEDTIME;
          if (t && (!completedAt || String(t) > String(completedAt))) completedAt = t;
        }
      } catch { /* ignore */ }
    }

    res.json({
      valid: true,
      certificate_id: req.params.certId,
      student_name: normalize(student).name || 'Student',
      course_name: normalize(course).name || 'Course',
      academy_name: academyName || 'Academy',
      completed_at: completedAt ? new Date(completedAt).toISOString() : null,
    });
  } catch (e) {
    res.status(500).json({ valid: false, error: 'Verification failed', detail: e.message });
  }
});

module.exports = router;
