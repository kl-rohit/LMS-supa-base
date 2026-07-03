// /api/auth — session bookkeeping + public signup.
//
// /me + /logout are user-session helpers (existing behaviour).
// /signup is the NEW public entry point for SaaS multi-tenancy — creates
// a Catalyst user + Organization + OrgMembership(owner) in one go.

const router = require('express').Router();
const { loadUser, publicUser } = require('../middleware/auth');
const { inviteUser, isPlatformAdmin } = require('../lib/supabaseAuth');
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

  // A user can belong to several academies — as staff in one and as a parent
  // in another (their relationship is per academy, not global). So we resolve
  // the role FOR THE ACTIVE ACADEMY. The active academy comes from ?org=<id>
  // (the client persists the user's pick and sends it on every call). When it
  // is missing or not one of theirs, we fall back to their first academy.
  let orgs = [];
  try { orgs = await listMyOrgs(req, user); } catch { orgs = []; }

  const requested = req.query?.org ? String(req.query.org).trim() : '';
  const requestedId = /^\d+$/.test(requested) ? Number(requested) : null;
  const match = requestedId && orgs.find((o) => Number(o.org_id) === requestedId);
  const active = match || orgs[0] || null;
  const active_org_id = active ? Number(active.org_id) : null;

  const app_role = await resolveAppRole(req, user, active);
  res.json({ user: { ...publicUser(user), app_role, active_org_id, orgs } });
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
    // Gate: only the platform administrator may create academies. Anyone else
    // — including signed-out visitors — is refused. The endpoint stays mounted
    // publicly, so we auth inline.
    const caller = await loadUser(req);
    if (!isPlatformAdmin(caller?.email)) {
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

    // 1. Create the Supabase auth user FIRST (email invite to set password).
    //    If this fails, we don't end up with an orphan org row. inviteUser
    //    reuses an existing account when the email is already registered.
    let newUserId;
    try {
      const r = await inviteUser({ email: owner_email, first_name, last_name });
      newUserId = r.userId;
    } catch (e) {
      return res.status(500).json({ error: 'Failed to create the owner account', detail: e.message });
    }
    if (!newUserId) {
      return res.status(500).json({ error: 'No user id returned for the new owner' });
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

// Decide where a logged-in user belongs FOR A GIVEN ACADEMY, based on APP DATA
// — not the Catalyst role. (Both academy owners and parents are created as
// Catalyst "App User"; the role string can't be trusted to tell admin from
// parent.) The same user can be staff in academy A and a parent in academy B,
// so the role is resolved against the ACTIVE academy (`active`, one entry from
// listMyOrgs). Resolution order:
//   1. Catalyst "App Administrator"     → 'admin'  (the platform owner)
//   2. active academy context 'staff'   → 'admin'  (owner/admin/teacher there)
//   3. active academy context 'parent'  → 'parent' (linked student there)
//   4. No active academy → fall back to a global scan (staff anywhere → admin,
//      parent link anywhere → parent), then 'unlinked'.
async function resolveAppRole(req, user, active) {
  if (isPlatformAdmin(user?.email)) return 'admin';

  const userId = String(user?.user_id || '');
  if (!userId) return 'unlinked';

  // Preferred path: decide from the active academy's context.
  if (active && active.context) {
    return active.context === 'staff' ? 'admin' : 'parent';
  }

  // Fallback (no active academy resolved). Academy staff anywhere?
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

  // Linked parent anywhere?
  try {
    const rows = await zcql(
      req,
      `SELECT ROWID FROM Students WHERE Students.login_user_id = ${q(userId)}`
    );
    if (unwrap(rows, 'Students').length > 0) return 'parent';
  } catch { /* ignore */ }

  return 'unlinked';
}

// List every academy this user can enter, unioning the two sources of
// belonging:
//   - OrgMemberships (active staff rows)          → context 'staff'
//   - Students.login_user_id links (per org)      → context 'parent'
// Each entry: { org_id, org_name, context, role }. A user could appear in
// both lists for the same org (rare); we keep both so the switcher can show
// each hat, keyed by org_id + context. Names come from one Organizations
// lookup. Best-effort: any source that errors just contributes nothing.
async function listMyOrgs(req, user) {
  const userId = String(user?.user_id || '');
  if (!userId) return [];
  const out = [];
  const orgIds = new Set();

  // Staff memberships.
  try {
    const rows = await zcql(
      req,
      `SELECT org_id, role, status FROM OrgMemberships WHERE OrgMemberships.user_id = ${q(userId)}`
    );
    for (const m of unwrap(rows, 'OrgMemberships').map(normalize)) {
      if (m.status !== 'active') continue;
      if (!['owner', 'admin', 'teacher'].includes(String(m.role))) continue;
      const id = Number(m.org_id);
      if (!id) continue;
      out.push({ org_id: id, org_name: '', context: 'staff', role: String(m.role) });
      orgIds.add(id);
    }
  } catch { /* no memberships table → skip */ }

  // Parent links (one row per linked student; collapse to one entry per org).
  try {
    const rows = await zcql(
      req,
      `SELECT org_id, login_status FROM Students WHERE Students.login_user_id = ${q(userId)}`
    );
    const seenParentOrgs = new Set();
    for (const s of unwrap(rows, 'Students').map(normalize)) {
      if (s.login_status && s.login_status !== 'active') continue;
      const id = Number(s.org_id);
      if (!id || seenParentOrgs.has(id)) continue;
      seenParentOrgs.add(id);
      out.push({ org_id: id, org_name: '', context: 'parent', role: 'parent' });
      orgIds.add(id);
    }
  } catch { /* ignore */ }

  // Attach academy names in one pass.
  if (orgIds.size) {
    try {
      const list = [...orgIds].join(',');
      const rows = await zcql(req, `SELECT ROWID, name FROM Organizations WHERE ROWID IN (${list})`);
      const nameById = {};
      for (const o of unwrap(rows, 'Organizations')) {
        nameById[Number(o.ROWID ?? o.id)] = o.name || '';
      }
      for (const e of out) e.org_name = nameById[e.org_id] || `Academy ${e.org_id}`;
    } catch {
      for (const e of out) e.org_name = e.org_name || `Academy ${e.org_id}`;
    }
  }

  return out;
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
