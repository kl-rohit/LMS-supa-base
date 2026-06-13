// resolveOrg middleware — Phase B of multi-tenancy.
//
// Sits in the admin auth chain after requireAuth + requireAdmin. Looks up
// the caller's OrgMemberships, picks the active membership to scope to,
// and attaches:
//
//   req.orgId         — number, the active org's ROWID
//   req.orgRole       — 'owner' | 'teacher' | 'parent'
//   req.isPlatformAdmin — true when the Catalyst user is App Administrator
//                          (platform owner — Rohit). Platform admins can
//                          target ANY org via the `?org=<id>` query param.
//
// Behavior:
//   - Multiple memberships → pick the first active one, OR honour
//     `?org=<id>` if the user is a member of that org.
//   - Platform admin + `?org=<id>` → bypass membership check entirely
//     (lets you impersonate any org for support).
//   - No active membership AND not platform admin → 403.
//
// Returns 503 with a clear hint if the OrgMemberships table doesn't exist
// (i.e. Phase A wasn't completed in this environment).

const { zcql, unwrap, normalize } = require('../db/catalystDb');

async function resolveOrg(req, res, next) {
  const userId = req.user?.user_id;
  const role = req.user?.role_details?.role_name || req.user?.role || '';
  const isPlatformAdmin = role === 'App Administrator';
  req.isPlatformAdmin = isPlatformAdmin;

  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  // Optional explicit override via ?org=<id>. Used by the platform admin
  // (e.g. when viewing /platform/orgs/:id) and respected for regular users
  // ONLY if they actually belong to that org.
  const requested = req.query?.org ? String(req.query.org).trim() : null;
  const requestedId = requested && /^\d+$/.test(requested) ? Number(requested) : null;

  // Platform admin shortcut — they can target any org by ID, no membership
  // check. If no ?org= passed and no other rule applies, we leave req.orgId
  // unset; routes that need it can 400 with a helpful message.
  if (isPlatformAdmin && requestedId) {
    req.orgId = requestedId;
    req.orgRole = 'platform_admin';
    return next();
  }

  // Look up memberships for this user.
  let memberships = [];
  try {
    const rows = await zcql(
      req,
      `SELECT * FROM OrgMemberships WHERE OrgMemberships.user_id = '${String(userId).replace(/'/g, "''")}'`
    );
    memberships = unwrap(rows, 'OrgMemberships').map(normalize);
  } catch (e) {
    return res.status(503).json({
      error: 'Multi-tenancy not initialized',
      detail: e.message,
      hint: 'Create the OrgMemberships table in Catalyst console and run POST /api/platform/bootstrap.',
    });
  }

  const active = memberships.filter((m) => m.status === 'active');

  // If the user explicitly requested an org, honor it only if they belong to it.
  if (requestedId) {
    const match = active.find((m) => Number(m.org_id) === requestedId);
    if (match) {
      req.orgId = Number(match.org_id);
      req.orgRole = match.role;
      return next();
    }
    if (!isPlatformAdmin) {
      return res.status(403).json({ error: `Not a member of org ${requestedId}` });
    }
    // Platform admin asked for an org they don't belong to — already handled above.
  }

  // No explicit ?org → pick the first active membership. Most users only
  // belong to one org so this is unambiguous. Multi-org users get the first
  // hit; the eventual org-switcher UI can pass ?org= to pin a choice.
  if (active.length > 0) {
    const m = active[0];
    req.orgId = Number(m.org_id);
    req.orgRole = m.role;
    return next();
  }

  // Platform admin with no memberships and no ?org= → let them through with
  // no req.orgId set. /platform/* endpoints don't need it; tenant-scoped
  // routes will need to handle missing orgId gracefully (they already do
  // — the SELECT just returns no rows when orgId is undefined).
  if (isPlatformAdmin) {
    req.orgRole = 'platform_admin';
    return next();
  }

  return res.status(403).json({
    error: 'No active organization membership',
    hint: 'Ask your academy owner to invite you, or sign up to create your own.',
  });
}

// Hard-require an orgId. Mount AFTER resolveOrg on tenant-scoped routes.
// Returns 400 when no org context is set — happens for platform admins
// who didn't pass ?org=<id> (they should use /api/platform/* for cross-org).
function requireOrgId(req, res, next) {
  if (!req.orgId) {
    return res.status(400).json({
      error: 'No active org context',
      hint: req.isPlatformAdmin
        ? 'Platform admin must include ?org=<id> in the query string to operate on tenant data.'
        : 'No active OrgMembership found for this user.',
    });
  }
  next();
}

module.exports = { resolveOrg, requireOrgId };
