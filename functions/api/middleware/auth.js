// Auth middleware — gates API routes behind a logged-in Supabase user.
//
// PORTED FROM CATALYST. The frontend logs in via Supabase Auth and sends the
// access token as `Authorization: Bearer <jwt>` on every /api/* request. We
// verify that JWT (see lib/supabaseAuth.verifyToken) and build req.user.
//
// Exports are unchanged (loadUser / requireAuth / requireAdmin / publicUser),
// so routes/auth.js and middleware/org.js keep working. req.user keeps the
// Catalyst-compatible shape: user_id (now a Supabase UUID string), email, and
// a role string ('App Administrator' for the platform super-admin, else
// 'App User') so resolveAppRole()/resolveOrg()'s existing role checks still hold.

const { verifyToken, isPlatformAdmin } = require('../lib/supabaseAuth');

function bearer(req) {
  // Catalyst reserves the Authorization header for its OWN OAuth and rejects a
  // non-Catalyst Bearer token ("invalid oauth token") before the request even
  // reaches this app. So the client sends the Supabase access token in a custom
  // header (X-Auth-Token) that Catalyst passes through untouched. We still
  // accept a standard Authorization: Bearer as a fallback (Cloud Run / local).
  const x = req.headers && (req.headers['x-auth-token'] || req.headers['X-Auth-Token']);
  if (x) return String(x).trim();
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

// Pull the logged-in user (if any). Does NOT 401 — returns null instead.
async function loadUser(req) {
  if (req.user) return req.user;
  const token = bearer(req);
  if (!token) return null;
  try {
    const c = await verifyToken(token);
    const email = String(c.email || '').toLowerCase();
    return {
      user_id: c.sub, // Supabase user UUID
      email,
      email_id: c.email, // Catalyst-compat alias
      first_name: c.user_metadata?.first_name || '',
      last_name: c.user_metadata?.last_name || '',
      // Catalyst-compat role string used by resolveAppRole()/resolveOrg().
      role: isPlatformAdmin(email) ? 'App Administrator' : 'App User',
      claims: c,
    };
  } catch {
    return null;
  }
}

// Require any logged-in user.
async function requireAuth(req, res, next) {
  const user = await loadUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  next();
}

// Require the platform super-admin (the old Catalyst "App Administrator").
// Identified by configured platform_admin_emails (see lib/supabaseAuth).
function requireAdmin(req, res, next) {
  if (!isPlatformAdmin(req.user?.email)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Convenience: the bits we expose to the React app. Shape unchanged.
function publicUser(u) {
  if (!u) return null;
  return {
    user_id: u.user_id,
    email: u.email_id || u.email,
    first_name: u.first_name || '',
    last_name: u.last_name || '',
    role: u.role || (isPlatformAdmin(u.email) ? 'App Administrator' : 'App User'),
  };
}

module.exports = { loadUser, requireAuth, requireAdmin, publicUser };
