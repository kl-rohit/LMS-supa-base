// Parent context middleware — for /api/portal/* routes only.
//
// Reads the logged-in Catalyst user (req.user, set by requireAuth) and looks
// up the Students row whose login_user_id matches. Attaches req.studentId so
// portal route handlers can scope queries.

const { zcql, unwrap, normalize, q } = require('../db/catalystDb');

async function requireParent(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const userId = String(req.user.user_id);
    const rows = await zcql(
      req,
      `SELECT * FROM Students WHERE Students.login_user_id = ${q(userId)}`
    );
    const students = unwrap(rows, 'Students');
    // A parent can be linked to students in more than one academy. The active
    // academy arrives as ?org=<id> (the client persists the user's pick); narrow
    // to the links in that academy when present, else consider every link.
    const requested = req.query?.org ? String(req.query.org).trim() : '';
    const requestedId = /^\d+$/.test(requested) ? Number(requested) : null;
    const inOrg = requestedId ? students.filter((s) => Number(s.org_id) === requestedId) : [];
    const pool = inOrg.length ? inOrg : students;
    // Within the active academy, a family with more than one child picks which
    // child they're viewing via ?student=<id>. The id must be one of THIS
    // parent's own links (it's drawn from `pool`), so a parent can never view a
    // child that isn't theirs. Falls back to the first link when absent/stale.
    const requestedStudent = req.query?.student ? String(req.query.student).trim() : '';
    const requestedStudentId = /^\d+$/.test(requestedStudent) ? Number(requestedStudent) : null;
    const student =
      (requestedStudentId && pool.find((s) => Number(s.ROWID) === requestedStudentId)) ||
      pool[0];
    if (!student) {
      return res.status(403).json({ error: 'No student linked to this account' });
    }
    if (student.login_status && student.login_status !== 'active') {
      return res.status(403).json({ error: 'This login has been disabled' });
    }
    req.studentId = student.ROWID;
    // The student's org_id implicitly scopes every portal route. Set req.orgId
    // here so portal route handlers can apply the same `WHERE org_id = X`
    // pattern as admin routes — defence in depth in case a portal endpoint
    // ever wanders outside its student_id filter.
    req.orgId = Number(student.org_id) || null;
    req.studentLogin = {
      email: student.login_email,
      user_id: student.login_user_id,
      status: student.login_status,
    };
    // Per-student parent-portal visibility overrides (set by an admin on the
    // student's login row). A map of { show_fees: 'on'|'off', ... } that wins
    // over the academy-wide portal.* settings — see portalVisible() in portal.js.
    let overrides = {};
    try {
      const raw = student.portal_overrides;
      const parsed = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) overrides = parsed;
    } catch { /* malformed → no overrides, inherit academy settings */ }
    req.studentPortalOverrides = overrides;
    next();
  } catch (e) {
    res.status(500).json({ error: 'Parent lookup failed', detail: e.message });
  }
}

// Admin "view as parent" preview. Mounted at /api/portal-preview/:studentId with
// requireAuth + resolveOrg + requireOrgId already applied, so req.orgId is the
// admin's active academy. We verify the chosen student belongs to that academy,
// then set the SAME req.* fields requireParent would, so every portal GET handler
// runs unchanged — but strictly READ-ONLY (any non-GET is rejected).
async function previewAsStudent(req, res, next) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Preview is read-only' });
  try {
    const sid = /^\d+$/.test(String(req.params.studentId || '')) ? String(req.params.studentId) : null;
    if (!sid) return res.status(400).json({ error: 'Invalid student id' });
    const rows = await zcql(req, `SELECT * FROM Students WHERE Students.ROWID = ${sid} AND Students.org_id = ${Number(req.orgId)}`);
    const student = unwrap(rows, 'Students')[0];
    if (!student) return res.status(404).json({ error: 'Student not found in this academy' });
    req.studentId = student.ROWID;
    req.studentLogin = {
      email: student.login_email,
      user_id: student.login_user_id,
      status: student.login_status,
    };
    let overrides = {};
    try {
      const raw = student.portal_overrides;
      const parsed = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) overrides = parsed;
    } catch { /* malformed → inherit academy settings */ }
    req.studentPortalOverrides = overrides;
    next();
  } catch (e) {
    res.status(500).json({ error: 'Preview lookup failed', detail: e.message });
  }
}

module.exports = { requireParent, previewAsStudent };
