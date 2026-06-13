// /api/auth — session bookkeeping + public signup.
//
// /me + /logout are user-session helpers (existing behaviour).
// /signup is the NEW public entry point for SaaS multi-tenancy — creates
// a Catalyst user + Organization + OrgMembership(owner) in one go.

const router = require('express').Router();
const catalyst = require('zcatalyst-sdk-node');
const { loadUser, publicUser } = require('../middleware/auth');
const { insert, update, zcql, unwrap, normalize } = require('../db/catalystDb');

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
  res.json({ user: publicUser(user) });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.json({ ok: true });
});

// POST /api/auth/signup
// Body: { academy_name, owner_email, first_name, last_name }
//
// Public endpoint (no auth required — mounted before requireAuth). Creates:
//   1. A Catalyst user (userManagement.registerUser) → email invite sent
//   2. An Organizations row (status: active, plan: free)
//   3. An OrgMemberships row (role: owner, status: invited)
//
// The user then clicks the email link, sets a password, signs in. On their
// first /api/auth/me call we flip status → active.
//
// Refuses if owner_email is already attached to an existing OrgMembership.
router.post('/signup', async (req, res) => {
  try {
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
      plan: 'free',
    });
    const orgId = orgRow?.ROWID;

    // 3. Create the OrgMembership for the new owner (invited → flips on first login).
    await insert(req, 'OrgMemberships', {
      user_id: String(newUserId),
      org_id: Number(orgId),
      role: 'owner',
      status: 'invited',
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
