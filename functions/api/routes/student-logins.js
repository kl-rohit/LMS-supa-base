// /api/student-logins — Admin-only. Manages parent login accounts.
//
// Storage: login fields live as columns on the Students table itself:
//   - login_email, login_user_id, login_status
// One student ↔ one login. The endpoint URL says "student-logins" for
// clarity, but :id is always a Students.ROWID.
//
// Lifecycle:
//   1. Admin POSTs { student_id, email, first_name? }
//   2. We call Catalyst userManagement.registerUser → Catalyst sends invite email
//   3. We UPDATE Students.{login_email, login_user_id, login_status='active'}
//   4. Parent clicks invite link, sets their own password
//   5. Parent logs in → /portal/* routes use req.studentId to scope data

const router = require('express').Router();
const { getById, update, zcql, unwrap } = require('../db/catalystDb');
const { createLogin, setUserEnabled, resetUserPassword } = require('../lib/supabaseAuth');
const { parentKey, setFlag } = require('../lib/onboarding');

// Shape we return to the React app for each login row.
function toLogin(student) {
  return {
    id: student.ROWID, // student id doubles as login id (1:1)
    student_id: student.ROWID,
    email: student.login_email || '',
    user_id: student.login_user_id || '',
    status: student.login_status || '',
    student_name: student.name,
    parent_name: student.parent_name,
    mobile_number: student.mobile_number,
  };
}

// GET /api/student-logins — every student in caller's org that has a login configured
router.get('/', async (req, res) => {
  try {
    const rows = await zcql(req, `SELECT * FROM Students WHERE Students.org_id = ${Number(req.orgId)}`);
    const logins = unwrap(rows, 'Students')
      .filter((s) => s.login_user_id)
      .map(toLogin);
    logins.sort((a, b) => String(a.student_name || '').localeCompare(String(b.student_name || '')));
    res.json({ logins });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch logins', detail: e.message });
  }
});

// POST /api/student-logins
// Body: { student_id, email, first_name?, last_name? }
// Creates a Catalyst user (sends invite email) + writes login_* on the Students row.
router.post('/', async (req, res) => {
  try {
    const { student_id, email, first_name, last_name } = req.body;
    if (!student_id || !email) {
      return res.status(400).json({ error: 'student_id and email are required' });
    }
    const student = await getById(req, 'Students', student_id);
    if (!student || Number(student.org_id) !== Number(req.orgId)) return res.status(404).json({ error: 'Student not found' });
    if (student.login_user_id) {
      return res.status(409).json({ error: 'A login already exists for this student' });
    }

    // Create the Supabase login with a temp password (no email), or reuse an
    // existing account. A parent may already have an account because they are
    // linked in ANOTHER academy (one parent can belong to several academies) or
    // are also staff somewhere — then we reuse it (they keep their current
    // password) and just grant access to this academy too. createLogin also
    // re-enables a reused account that was disabled elsewhere.
    let userId = null;
    let reusedExisting = false;
    let tempPassword = null;
    try {
      const r = await createLogin({
        email,
        first_name: first_name || student.parent_name || student.name || 'Parent',
        last_name: last_name || '',
      });
      userId = r.userId;
      reusedExisting = r.reusedExisting;
      tempPassword = r.tempPassword;
    } catch (e) {
      return res.status(500).json({
        error: 'Could not create or find a user for this email',
        detail: e.message,
      });
    }
    if (!userId) {
      return res.status(500).json({ error: 'No user id returned' });
    }

    const updated = await update(req, 'Students', student_id, {
      login_email: email,
      login_user_id: String(userId),
      login_status: 'active',
    });

    // Mark the parent welcome tour as pending for this newly-activated login so
    // the parent sees it once on first sign-in (cleared when they dismiss it).
    await setFlag(req, req.orgId, parentKey(student_id), 'true');

    res.status(201).json({
      login: toLogin(updated),
      reused_existing: reusedExisting,
      email,
      temp_password: tempPassword, // null when reusing an existing account
      message: reusedExisting
        ? 'Linked to the parent\'s existing account. They sign in with their current password and switch to this academy from the academy menu.'
        : 'Login created. Share these sign-in details with the parent (e.g. on WhatsApp). They can change the password after signing in.',
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create login', detail: e.message });
  }
});

// PUT /api/student-logins/:id — body: { status?, email? }  (:id is student id)
router.put('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Students', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) return res.status(404).json({ error: 'Student not found' });
    if (!existing.login_user_id) return res.status(404).json({ error: 'No login for this student' });
    const patch = {};
    if (req.body.status !== undefined) patch.login_status = req.body.status;
    if (req.body.email !== undefined)  patch.login_email = req.body.email;
    const updated = await update(req, 'Students', req.params.id, patch);
    res.json({ login: toLogin(updated) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update login', detail: e.message });
  }
});

// POST /api/student-logins/:id/resend-tour — re-arm the parent welcome tour.
// Sets onboarding.parent_pending.<studentId> back to 'true' so the parent sees
// the first-login walkthrough again next time they open the portal. (:id is a
// student id; the parent must already have a login configured.)
router.post('/:id/resend-tour', async (req, res) => {
  try {
    const existing = await getById(req, 'Students', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) return res.status(404).json({ error: 'Student not found' });
    if (!existing.login_user_id) return res.status(404).json({ error: 'No login for this student' });
    await setFlag(req, req.orgId, parentKey(req.params.id), 'true');
    res.json({ message: 'The welcome tour will show again the next time this parent opens the portal.' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to resend tour', detail: e.message });
  }
});

// POST /api/student-logins/:id/reset-password — admin resets the parent's
// password to a fresh temp one and re-flags must_set_password, so the parent is
// forced to choose their own password on their next sign-in. Returns the temp
// password for the admin to share (e.g. on WhatsApp). (:id is a student id.)
router.post('/:id/reset-password', async (req, res) => {
  try {
    const existing = await getById(req, 'Students', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) return res.status(404).json({ error: 'Student not found' });
    if (!existing.login_user_id) return res.status(404).json({ error: 'No login for this student' });
    let tempPassword;
    try {
      tempPassword = await resetUserPassword(existing.login_user_id);
    } catch (e) {
      return res.status(500).json({ error: 'Could not reset the password', detail: e.message });
    }
    res.json({
      email: existing.login_email || '',
      temp_password: tempPassword,
      student_name: existing.name,
      parent_name: existing.parent_name,
      mobile_number: existing.mobile_number,
      message: 'Password reset. Share the new password with the parent; they will be asked to set their own on next sign-in.',
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to reset password', detail: e.message });
  }
});

// DELETE /api/student-logins/:id — clears login fields + disables the Catalyst user
router.delete('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Students', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) return res.status(404).json({ error: 'Student not found' });
    if (!existing.login_user_id) return res.status(404).json({ error: 'No login for this student' });

    // One parent can be linked across several academies (the SAME Catalyst
    // user_id appears on a Students row in each). Disabling the Catalyst account
    // here would lock them out of those other academies too. So only disable the
    // account when this is their LAST link anywhere; otherwise just unlink it
    // from this student and leave the account active for the others.
    let stillLinkedElsewhere = false;
    try {
      const others = await zcql(
        req,
        `SELECT ROWID FROM Students WHERE Students.login_user_id = '${String(existing.login_user_id).replace(/'/g, "''")}'`
      );
      stillLinkedElsewhere = unwrap(others, 'Students')
        .some((s) => Number(s.ROWID) !== Number(req.params.id));
    } catch { /* if the check fails, err on the safe side and skip the disable */ }

    if (!stillLinkedElsewhere) {
      // Best-effort disable (don't fail the row update if this errors).
      try {
        await setUserEnabled(existing.login_user_id, false);
      } catch (e) {
        console.error('Failed to disable user', existing.login_user_id, e.message);
      }
    }

    await update(req, 'Students', req.params.id, {
      login_email: '',
      login_user_id: '',
      login_status: '',
    });
    res.json({
      message: stillLinkedElsewhere
        ? 'Login removed from this academy. The parent keeps access to their other academies.'
        : 'Login removed.',
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete login', detail: e.message });
  }
});

module.exports = router;
