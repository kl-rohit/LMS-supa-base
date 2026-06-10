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
const catalyst = require('zcatalyst-sdk-node');
const { getById, getAll, update, normalize } = require('../db/catalystDb');

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

// GET /api/student-logins — every student that has a login configured
router.get('/', async (req, res) => {
  try {
    const rows = await getAll(req, 'Students');
    const logins = rows
      .filter((s) => s.login_user_id) // only those with a Catalyst user attached
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
    if (!student) return res.status(404).json({ error: 'Student not found' });
    if (student.login_user_id) {
      return res.status(409).json({ error: 'A login already exists for this student' });
    }

    // Create the Catalyst user via admin-scoped userManagement.
    const adminApp = catalyst.initialize(req, { scope: 'admin' });
    const userDetails = {
      email_id: email,
      first_name: first_name || student.parent_name || student.name || 'Parent',
      last_name: last_name || '',
    };
    let catalystUser;
    try {
      catalystUser = await adminApp.userManagement().registerUser(userDetails);
    } catch (e1) {
      try {
        catalystUser = await adminApp.userManagement().registerUser({ platform_type: 'web' }, userDetails);
      } catch (e2) {
        return res.status(500).json({
          error: 'Failed to create Catalyst user',
          detail: `${e1.message} / fallback: ${e2.message}`,
        });
      }
    }
    const userId =
      catalystUser?.user_id ||
      catalystUser?.user_details?.user_id ||
      catalystUser?.userId;
    if (!userId) {
      return res.status(500).json({ error: 'Catalyst did not return a user_id', detail: JSON.stringify(catalystUser) });
    }

    const updated = await update(req, 'Students', student_id, {
      login_email: email,
      login_user_id: String(userId),
      login_status: 'active',
    });

    res.status(201).json({
      login: toLogin(updated),
      message: 'Invitation email sent. Parent will set their password from the email link.',
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create login', detail: e.message });
  }
});

// PUT /api/student-logins/:id — body: { status?, email? }  (:id is student id)
router.put('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Students', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Student not found' });
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

// DELETE /api/student-logins/:id — clears login fields + disables the Catalyst user
router.delete('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Students', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Student not found' });
    if (!existing.login_user_id) return res.status(404).json({ error: 'No login for this student' });

    // Best-effort disable on Catalyst (don't fail the row update if this errors)
    try {
      const adminApp = catalyst.initialize(req, { scope: 'admin' });
      await adminApp.userManagement().updateUserStatus(existing.login_user_id, 'disable');
    } catch (e) {
      console.error('Failed to disable Catalyst user', existing.login_user_id, e.message);
    }

    await update(req, 'Students', req.params.id, {
      login_email: '',
      login_user_id: '',
      login_status: '',
    });
    res.json({ message: 'Login removed' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete login', detail: e.message });
  }
});

module.exports = router;
