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
    const student = unwrap(rows, 'Students')[0];
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
    next();
  } catch (e) {
    res.status(500).json({ error: 'Parent lookup failed', detail: e.message });
  }
}

module.exports = { requireParent };
