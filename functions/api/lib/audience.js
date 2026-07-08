// Shared audience resolver for content targeting. One place that answers
// "which students does this target reach?" for assignments, question papers,
// and course assignment. Targeting shape: { target_type, target_id, target_ids }
//   'all'      → every active student in the org
//   'group'    → students in the group (GroupStudents)
//   'student'  → [target_id]            (legacy single)
//   'students' → target_ids[]           (explicit multi)

const { zcqlAll, unwrap, safeId } = require('../db/catalystDb');

// Parse the JSON student-id array stored in target_ids → array of id strings.
function parseTargetIds(v) {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (!v) return [];
  try { const a = JSON.parse(v); return Array.isArray(a) ? a.map(String).filter(Boolean) : []; } catch { return []; }
}

// Resolve a target to the list of student id strings it reaches. Best-effort:
// returns [] on any failure rather than throwing.
async function resolveAudienceStudentIds(req, { target_type, target_id, target_ids } = {}) {
  const orgId = Number(req.orgId);
  try {
    if (target_type === 'students') return parseTargetIds(target_ids);
    if (target_type === 'student' && target_id) return [String(target_id)];
    if (target_type === 'group' && target_id) {
      const links = await zcqlAll(
        req,
        `SELECT GroupStudents.student_id FROM GroupStudents WHERE GroupStudents.group_id = ${safeId(target_id)} AND GroupStudents.org_id = ${orgId}`,
        'GroupStudents'
      );
      return unwrap(links, 'GroupStudents').map((l) => String(l.student_id)).filter(Boolean);
    }
    // 'all' (default) → every active student
    const rows = await zcqlAll(
      req,
      `SELECT ROWID FROM Students WHERE Students.org_id = ${orgId} AND Students.status = 'active'`,
      'Students'
    );
    return unwrap(rows, 'Students').map((r) => String(r.ROWID)).filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = { resolveAudienceStudentIds, parseTargetIds };
