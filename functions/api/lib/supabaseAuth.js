// Supabase Auth integration (replaces Catalyst User Management).
//
// Two responsibilities:
//   1. verifyToken() — validate the Supabase access-token JWT that the client
//      sends as `Authorization: Bearer <token>`. Verified against the project's
//      public JWKS (asymmetric ES256/RS256 keys, the modern Supabase setup);
//      falls back to the shared HS256 secret if one is configured (legacy).
//   2. admin — a service-role Supabase client for user management (create /
//      invite / list / get / ban-unban), replacing userManagement().* calls.
//
// Config comes from env first, then functions/api/supabase-config.json.

const { createRemoteJWKSet, jwtVerify } = require('jose');
const { createSecretKey, randomBytes } = require('crypto');
const { createClient } = require('@supabase/supabase-js');

function cfg() {
  try { return require('../supabase-config.json'); } catch { return {}; }
}
const C = cfg();

const SUPABASE_URL = process.env.SUPABASE_URL || C.supabase_url || '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || C.supabase_service_role_key || '';
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || C.supabase_jwt_secret || '';

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.warn('[supabaseAuth] SUPABASE_URL / service_role not configured — auth will fail until set.');
}

// Service-role admin client. autoRefresh/persist off — server-side, per-process.
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Asymmetric verification via the project JWKS endpoint.
const JWKS = SUPABASE_URL
  ? createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`))
  : null;

// Optional legacy HS256 shared-secret key (only if a real secret is set).
const hsKey =
  JWT_SECRET && !/PASTE|YOUR-|^\s*$/.test(JWT_SECRET) ? createSecretKey(Buffer.from(JWT_SECRET)) : null;

const ISSUER = SUPABASE_URL ? `${SUPABASE_URL}/auth/v1` : undefined;

// Verify a Supabase access token and return its claims (throws if invalid).
// Supabase user tokens carry sub (user uuid), email, and aud 'authenticated'.
async function verifyToken(token) {
  const opts = { issuer: ISSUER, audience: 'authenticated' };
  try {
    if (JWKS) {
      const { payload } = await jwtVerify(token, JWKS, opts);
      return payload;
    }
    throw new Error('JWKS not configured');
  } catch (e) {
    if (hsKey) {
      const { payload } = await jwtVerify(token, hsKey, opts);
      return payload;
    }
    throw e;
  }
}

// Platform super-admin(s) — the old Catalyst "App Administrator". Configured by
// email in supabase-config.json (platform_admin_emails: []) or the
// PLATFORM_ADMIN_EMAILS env (comma-separated). Case-insensitive.
// Accept either an array (["a@x.com","b@y.com"]) or a comma-separated string
// ("a@x.com, b@y.com") from config or env — whichever the operator wrote.
function toEmailList(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return v.split(',');
  return [];
}
const PLATFORM_ADMIN_EMAILS = (
  process.env.PLATFORM_ADMIN_EMAILS
    ? process.env.PLATFORM_ADMIN_EMAILS.split(',')
    : toEmailList(C.platform_admin_emails)
).map((s) => String(s).trim().toLowerCase()).filter(Boolean);

function isPlatformAdmin(email) {
  return !!email && PLATFORM_ADMIN_EMAILS.includes(String(email).toLowerCase());
}

// ---- user management (replaces Catalyst userManagement().*) ----------------
// All return/accept a Supabase user UUID string as the id.

// Find an auth user by email (case-insensitive). Pages through listUsers.
async function findUserByEmail(email) {
  const norm = String(email || '').trim().toLowerCase();
  if (!norm) return null;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const users = data?.users || [];
    const found = users.find((u) => String(u.email || '').toLowerCase() === norm);
    if (found) return found;
    if (users.length < 200) return null;
  }
  return null;
}

// Invite a user by email (Supabase emails them a set-password link), or reuse
// their existing account if the email is already registered. Mirrors the
// find-or-create semantics the Catalyst flow had.
// Returns { userId, reusedExisting }.
// NOTE: the invite EMAIL only sends once custom SMTP (Resend) is configured;
// until then Supabase's built-in mailer is rate-limited to team addresses.
async function inviteUser({ email, first_name = '', last_name = '' }) {
  const norm = String(email || '').trim().toLowerCase();
  const meta = { first_name, last_name };
  const { data, error } = await admin.auth.admin.inviteUserByEmail(norm, { data: meta });
  if (!error && data?.user) return { userId: data.user.id, reusedExisting: false };
  // Already registered (member of another academy, or already staff) → reuse.
  const existing = await findUserByEmail(norm);
  if (existing) return { userId: existing.id, reusedExisting: true };
  throw new Error(error ? error.message : 'Could not invite or find user');
}

// Create a user directly with a password, no email sent. Used where the app
// sets the credential itself rather than emailing an invite.
async function createUserWithPassword({ email, password, first_name = '', last_name = '' }) {
  const { data, error } = await admin.auth.admin.createUser({
    email: String(email).trim().toLowerCase(),
    password,
    email_confirm: true,
    // must_set_password flags an admin-issued temp password; the app forces a
    // password change on first sign-in and clears the flag afterwards.
    user_metadata: { first_name, last_name, must_set_password: true },
  });
  if (error) throw new Error(error.message);
  return data.user;
}

// Enable/disable a user (Catalyst updateUserStatus enable/disable). Disabling
// bans the account so they can't sign in; enabling lifts the ban.
async function setUserEnabled(userId, enabled) {
  const { error } = await admin.auth.admin.updateUserById(String(userId), {
    ban_duration: enabled ? 'none' : '876000h', // ~100 years = effectively disabled
  });
  if (error) throw new Error(error.message);
  return true;
}

async function getUserById(userId) {
  const { data, error } = await admin.auth.admin.getUserById(String(userId));
  if (error) return null;
  return data?.user || null;
}

// Send a password-recovery email (Catalyst resetPassword equivalent). Kept for
// installs that DO configure custom SMTP; the WhatsApp flow uses
// resetUserPassword() instead. Needs SMTP to deliver.
async function sendPasswordReset(email, redirectTo) {
  const opts = redirectTo ? { redirectTo } : undefined;
  const { error } = await admin.auth.resetPasswordForEmail(String(email).trim().toLowerCase(), opts);
  if (error) throw new Error(error.message);
  return true;
}

// ---- WhatsApp-delivery credential flow (no email) --------------------------
// Generate a short, readable temporary password (ambiguous chars removed) that
// an admin can copy into WhatsApp / read out. ~59 bits at length 10.
function generateTempPassword(len = 10) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// Create a login with a generated temp password and NO email. Reuses an
// existing account if the email is already registered (multi-academy parent /
// existing staff) — then no new password is issued (they keep their current
// one). Returns { userId, reusedExisting, tempPassword|null }. The caller
// returns tempPassword to the admin UI to share out-of-band (WhatsApp).
async function createLogin({ email, first_name = '', last_name = '' }) {
  const norm = String(email).trim().toLowerCase();
  const existing = await findUserByEmail(norm);
  if (existing) {
    // Make sure a reused account isn't left banned from a prior removal.
    try { await setUserEnabled(existing.id, true); } catch { /* ignore */ }
    return { userId: existing.id, reusedExisting: true, tempPassword: null };
  }
  const tempPassword = generateTempPassword();
  const user = await createUserWithPassword({ email: norm, password: tempPassword, first_name, last_name });
  return { userId: user.id, reusedExisting: false, tempPassword };
}

// Admin-initiated password reset (no email): set a new temp password and return
// it to share via WhatsApp.
async function resetUserPassword(userId) {
  const tempPassword = generateTempPassword();
  // Preserve existing metadata (name) and re-flag must_set_password so the user
  // is prompted to choose their own password again after an admin reset.
  const existing = await getUserById(userId);
  const meta = { ...(existing?.user_metadata || {}), must_set_password: true };
  const { error } = await admin.auth.admin.updateUserById(String(userId), {
    password: tempPassword,
    user_metadata: meta,
  });
  if (error) throw new Error(error.message);
  return tempPassword;
}

// List every auth user (paged). For the rare admin screens that enumerate.
async function listAllUsers() {
  const out = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) break;
    const users = data?.users || [];
    out.push(...users);
    if (users.length < 200) break;
  }
  return out;
}

module.exports = {
  admin,
  verifyToken,
  isPlatformAdmin,
  SUPABASE_URL,
  findUserByEmail,
  inviteUser,
  createUserWithPassword,
  createLogin,
  resetUserPassword,
  generateTempPassword,
  setUserEnabled,
  getUserById,
  sendPasswordReset,
  listAllUsers,
};
