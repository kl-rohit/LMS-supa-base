// Shared active-student limit helpers. Centralizes the seat-cap logic so the
// students, groups, and attendance routes all enforce the same rule.
//
// The cap comes from the org's approved seat count (req.orgMaxStudents) when
// set, otherwise the plan default (planMaxStudents). A null cap means
// unlimited. Platform-admin support impersonation bypasses the cap.

const { zcql, readCount } = require('../db/catalystDb');
const { planMaxStudents, normalizePlan } = require('./plans');

// Effective seat cap for the caller's org. Returns null for unlimited.
function seatCap(req) {
  return req.orgMaxStudents != null ? req.orgMaxStudents : planMaxStudents(req.orgPlan);
}

// Count of currently active students in the caller's org.
async function activeStudentCount(req) {
  const rows = await zcql(
    req,
    `SELECT COUNT(ROWID) AS total FROM Students WHERE Students.org_id = ${Number(req.orgId)} AND Students.status = 'active'`
  );
  return readCount(rows, 'Students', 'total');
}

// Returns a 402-ready body when adding `delta` active students would exceed the
// cap, otherwise null. Used for create / reactivate flows.
async function studentCapBlock(req, delta = 1) {
  if (req.orgRole === 'platform_admin') return null;
  const cap = seatCap(req);
  if (cap == null) return null; // unlimited
  let count = 0;
  try {
    count = await activeStudentCount(req);
  } catch { return null; } // fail open — never block on a count hiccup
  if (count + delta > cap) {
    return {
      error: 'student_limit_reached',
      limit: cap,
      count,
      plan: normalizePlan(req.orgPlan),
      message: `Your plan allows up to ${cap} active student${cap === 1 ? '' : 's'}. Upgrade to add more.`,
    };
  }
  return null;
}

// Returns a 402-ready body when the org is ALREADY at or over its seat cap,
// otherwise null. Used to gate features (e.g. group creation) that should stay
// available only while the org is within its approved seat count.
async function overCapBlock(req) {
  if (req.orgRole === 'platform_admin') return null;
  const cap = seatCap(req);
  if (cap == null) return null; // unlimited
  let count = 0;
  try {
    count = await activeStudentCount(req);
  } catch { return null; } // fail open — never block on a count hiccup
  if (count > cap) {
    return {
      error: 'student_limit_reached',
      limit: cap,
      count,
      plan: normalizePlan(req.orgPlan),
      message: `Your active students (${count}) exceed your plan limit of ${cap}. Reduce active students or upgrade to continue.`,
    };
  }
  return null;
}

module.exports = { seatCap, activeStudentCount, studentCapBlock, overCapBlock };
