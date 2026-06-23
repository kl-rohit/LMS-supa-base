// /api/auth — session bookkeeping + public signup.
//
// /me + /logout are user-session helpers (existing behaviour).
// /signup is the NEW public entry point for SaaS multi-tenancy — creates
// a Catalyst user + Organization + OrgMembership(owner) in one go.

const router = require('express').Router();
const catalyst = require('zcatalyst-sdk-node');
const { loadUser, publicUser } = require('../middleware/auth');
const { insert, update, zcql, unwrap, normalize, q } = require('../db/catalystDb');
const { ADMIN_KEY, SETUP_KEY, setFlag } = require('../lib/onboarding');
const { writeAudit } = require('../lib/audit');

// GET /api/auth/me
// Used by AuthContext on app mount + activates 'invited' org memberships
// on first login (see comment on activateMemberships).
router.get('/me', async (req, res) => {
  const user = await loadUser(req);
  if (!user) return res.status(401).json({ user: null });
  // Side-effect: if this user has any 'invited' OrgMembership rows, mark
  // them active. They get here only by successfully logging in, which
  // implies they accepted the email invite.
  try { await activateMemberships(req, user.user_id); } catch {}
  const app_role = await resolveAppRole(req, user);
  res.json({ user: { ...publicUser(user), app_role } });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.json({ ok: true });
});

// POST /api/auth/signup
// Body: { academy_name, owner_email, first_name, last_name }
//
// INVITE-ONLY. Academy creation is restricted to the platform administrator —
// there is no public self-service signup. (Self-signup created un-linkable
// "App User" accounts that landed in the parent portal with no student.) The
// platform admin calls this from the Platform Admin page; Catalyst emails the
// new owner an invite to set their password. Creates:
//   1. A Catalyst user (userManagement.registerUser) → email invite sent
//   2. An Organizations row (status: active, plan: trial — 14-day full access)
//   3. An OrgMemberships row (role: owner, status: invited)
//
// The new owner clicks the email link, sets a password, signs in. On their
// first /api/auth/me call we flip the membership status → active and resolve
// app_role → 'admin' (they have an owner membership).
router.post('/signup', async (req, res) => {
  try {
    // Gate: only the platform administrator (Catalyst "App Administrator")
    // may create academies. Anyone else — including signed-out visitors — is
    // refused. The endpoint stays mounted publicly, so we auth inline.
    const caller = await loadUser(req);
    const callerRole = caller?.role_details?.role_name || caller?.role || '';
    if (callerRole !== 'App Administrator') {
      return res.status(403).json({
        error: 'Academy creation is invite-only',
        detail: 'New academies are created by the platform administrator. Please contact them to get set up.',
      });
    }

    const academy_name = String(req.body?.academy_name || '').trim();
    const owner_email = String(req.body?.owner_email || '').trim().toLowerCase();
    const first_name = String(req.body?.first_name || '').trim();
    const last_name = String(req.body?.last_name || '').trim();

    if (!academy_name) return res.status(400).json({ error: 'academy_name is required' });
    if (!owner_email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(owner_email)) {
      return res.status(400).json({ error: 'owner_email is required and must be a valid email' });
    }
    if (!first_name) return res.status(400).json({ error: 'first_name is required' });

    // Sanity check the schema exists before we start. Better to fail fast
    // than to create a Catalyst user we can't link.
    try {
      await zcql(req, 'SELECT ROWID FROM Organizations LIMIT 0, 1');
    } catch (e) {
      return res.status(503).json({
        error: 'Multi-tenancy not initialized',
        detail: 'Organizations table missing. Platform admin must complete Phase A bootstrap first.',
      });
    }

    // 1. Create the Catalyst user FIRST. If this fails, we don't end up
    //    with an orphan org row.
    const adminApp = catalyst.initialize(req, { scope: 'admin' });
    const userDetails = {
      email_id: owner_email,
      first_name,
      last_name,
    };
    let catalystUser;
    try {
      catalystUser = await adminApp.userManagement().registerUser(userDetails);
    } catch (e1) {
      // Fallback signature — same pattern student-logins uses
      try {
        catalystUser = await adminApp.userManagement().registerUser({ platform_type: 'web' }, userDetails);
      } catch (e2) {
        // Common failure: email already registered as a Catalyst user
        const detail = `${e1.message} / fallback: ${e2.message}`;
        if (/exists|already/i.test(detail)) {
          return res.status(409).json({
            error: 'Email already in use',
            detail: 'A Catalyst user with this email already exists. Sign in instead, or use a different email to start a fresh academy.',
          });
        }
        return res.status(500).json({ error: 'Failed to create Catalyst user', detail });
      }
    }
    const newUserId =
      catalystUser?.user_id ||
      catalystUser?.user_details?.user_id ||
      catalystUser?.userId;
    if (!newUserId) {
      return res.status(500).json({ error: 'Catalyst did not return a user_id', detail: JSON.stringify(catalystUser).slice(0, 500) });
    }

    // 2. Create the Organization.
    const slug = slugify(academy_name) || `org-${Date.now().toString(36)}`;
    const orgRow = await insert(req, 'Organizations', {
      name: academy_name,
      slug,
      owner_user_id: String(newUserId),
      status: 'active',
      // New academies start on a 14-day full-access trial (measured from
      // creation time — see lib/plans.js effectivePlan). After it lapses they
      // drop to the Free tier until they pick a paid plan.
      plan: 'trial',
    });
    const orgId = orgRow?.ROWID;

    // 3. Create the OrgMembership for the new owner (invited → flips on first login).
    await insert(req, 'OrgMemberships', {
      user_id: String(newUserId),
      org_id: Number(orgId),
      role: 'owner',
      status: 'invited',
    });

    // 4. Mark the welcome tour AND the first-run setup wizard as pending for
    //    this brand-new org so the owner sees them once on first login (each
    //    cleared the moment they dismiss / finish it).
    if (orgId) {
      await setFlag(req, Number(orgId), ADMIN_KEY, 'true');
      await setFlag(req, Number(orgId), SETUP_KEY, 'true');
    }

    await writeAudit(req, {
      action: 'org.create',
      orgId: orgId,
      orgName: academy_name,
      detail: { owner_email, owner_user_id: String(newUserId), plan: 'trial' },
    });

    res.status(201).json({
      message: 'Academy created. Check your email for the invite to set your password.',
      org: { id: orgId, name: academy_name, slug },
      owner_user_id: String(newUserId),
      next_step: 'check_email',
    });
  } catch (e) {
    res.status(500).json({ error: 'Signup failed', detail: e.message });
  }
});

// ----- helpers --------------------------------------------------------------

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

// Decide where a logged-in user belongs, based on APP DATA — not the Catalyst
// role. (Both academy owners and parents are created as Catalyst "App User";
// public signup never assigned "App Administrator", so the role string can't be
// trusted to tell admin from parent.) Resolution order:
//   1. Catalyst "App Administrator"        → 'admin'  (the platform owner)
//   2. Active OrgMembership owner/admin/teacher → 'admin'  (academy staff)
//   3. A Students row links this user_id   → 'parent'
//   4. Otherwise                           → 'unlinked' (signed in, nothing attached)
async function resolveAppRole(req, user) {
  const catalystRole = user?.role_details?.role_name || user?.role || '';
  if (catalystRole === 'App Administrator') return 'admin';

  const userId = String(user?.user_id || '');
  if (!userId) return 'unlinked';

  // Academy staff? Any active membership with a staff role makes them an admin.
  try {
    const rows = await zcql(
      req,
      `SELECT role, status FROM OrgMemberships WHERE OrgMemberships.user_id = ${q(userId)}`
    );
    const memberships = unwrap(rows, 'OrgMemberships').map(normalize);
    const staff = memberships.some(
      (m) => m.status === 'active' && ['owner', 'admin', 'teacher'].includes(String(m.role))
    );
    if (staff) return 'admin';
  } catch { /* table may not exist in un-bootstrapped envs — fall through */ }

  // Linked parent?
  try {
    const rows = await zcql(
      req,
      `SELECT ROWID FROM Students WHERE Students.login_user_id = ${q(userId)}`
    );
    if (unwrap(rows, 'Students').length > 0) return 'parent';
  } catch { /* ignore */ }

  return 'unlinked';
}

// Flip any 'invited' OrgMemberships for this user to 'active'.
// Called from GET /me — runs once per page-load but only writes when there's
// actually something to flip, so the cost is a single SELECT in the common case.
async function activateMemberships(req, userId) {
  if (!userId) return;
  const rows = await zcql(
    req,
    `SELECT * FROM OrgMemberships WHERE OrgMemberships.user_id = '${String(userId).replace(/'/g, "''")}' AND OrgMemberships.status = 'invited'`
  );
  const invited = unwrap(rows, 'OrgMemberships').map(normalize);
  for (const m of invited) {
    try {
      await update(req, 'OrgMemberships', m.id, { status: 'active' });
    } catch (err) {
      console.error('activateMemberships failed for', m.id, err.message);
    }
  }
}

module.exports = router;
