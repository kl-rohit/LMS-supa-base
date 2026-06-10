// Auth middleware — gates API routes behind a logged-in Catalyst user.
//
// Flow: Catalyst sets session cookies on the *.catalystserverless.in domain
// when the user signs in via the embedded auth form on the frontend.
// Those cookies arrive with every /api/* request. `catalyst.initialize(req)`
// (default user scope) reads them and returns the authenticated user.
//
// Routes still use { scope: 'admin' } from catalystDb.js for actual DB ops —
// this middleware only verifies *who* is calling. Role checks gate access.

const catalyst = require('zcatalyst-sdk-node');

// Pull the logged-in user (if any). Does NOT 401 — sets req.user = null instead.
async function loadUser(req) {
  try {
    const app = catalyst.initialize(req); // user scope by default
    const user = await app.userManagement().getCurrentUser();
    return user || null;
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

// Require the logged-in user to be a Catalyst "App Administrator"
// (teacher role for Veena). Parents will be "App User" and fail this check.
function requireAdmin(req, res, next) {
  const role = req.user?.role_details?.role_name || req.user?.role || '';
  // Catalyst returns "App Administrator" for admin users, "App User" for parents.
  if (role !== 'App Administrator') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Convenience: extract just the bits we expose to the React app.
function publicUser(u) {
  if (!u) return null;
  return {
    user_id: u.user_id,
    email: u.email_id || u.email,
    first_name: u.first_name || '',
    last_name: u.last_name || '',
    role: u.role_details?.role_name || u.role || 'App User',
  };
}

module.exports = { loadUser, requireAuth, requireAdmin, publicUser };
