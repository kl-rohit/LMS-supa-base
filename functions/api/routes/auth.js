// /api/auth — session bookkeeping. The actual signIn happens client-side via
// the Catalyst Web SDK (catalyst.auth.signIn). After login Catalyst sets
// session cookies; these endpoints just expose the current user to React.

const router = require('express').Router();
const { loadUser, publicUser } = require('../middleware/auth');

// GET /api/auth/me  — returns the logged-in user, or 401.
// Used by AuthContext on app mount to restore session state across reloads.
router.get('/me', async (req, res) => {
  const user = await loadUser(req);
  if (!user) return res.status(401).json({ user: null });
  res.json({ user: publicUser(user) });
});

// POST /api/auth/logout — best-effort hint to the client.
// Actual signOut is client-side (catalyst.auth.signOut() clears the cookies).
// We keep this endpoint so the React app can also call it from server-side flows.
router.post('/logout', (req, res) => {
  res.json({ ok: true });
});

module.exports = router;
