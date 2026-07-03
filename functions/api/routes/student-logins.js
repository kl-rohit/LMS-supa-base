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
const { inviteUser, setUserEnabled } = require('../lib/supabaseAuth');
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

    // Invite or reuse the Supabase user. A parent may already have an account
    // because they are linked in ANOTHER academy (one parent can belong to
    // several academies) or are also staff somewhere. inviteUser sends a
    // set-password email on create, and reuses the existing account (keeping
    // their current password) when the email is already registered — they
    // simply gain access to this academy too. (Same helper the teacher-invite
    // flow in organization.js uses.)
    let userId = null;
    let reusedExisting = false;
    try {
      const r = await inviteUser({
        email,
        first_name: first_name || student.parent_name || student.name || 'Parent',
        last_name: last_name || '',
      });
      userId = r.userId;
      reusedExisting = r.reusedExisting;
    } catch (e) {
      return res.status(500).json({
        error: 'Could not create or find a user for this email',
        detail: e.message,
      });
    }
    if (!userId) {
      return res.status(500).json({ error: 'No user id returned' });
    }

    // If we're reusing an existing account, make sure it is enabled — it may
    // have been disabled when the parent was removed from another academy.
    // Best-effort: a no-op if the account is already active.
    if (reusedExisting) {
      try {
        await setUserEnabled(userId, true);
      } catch { /* already enabled, or status change not permitted — ignore */ }
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
      message: reusedExisting
        ? 'Linked to the parent\'s existing account. They can sign in with their current password and switch to this academy from the academy menu.'
        : 'Invitation email sent. Parent will set their password from the email link.',
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
