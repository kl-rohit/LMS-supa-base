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
const { createSecretKey } = require('crypto');
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
const PLATFORM_ADMIN_EMAILS = (
  process.env.PLATFORM_ADMIN_EMAILS
    ? process.env.PLATFORM_ADMIN_EMAILS.split(',')
    : Array.isArray(C.platform_admin_emails)
      ? C.platform_admin_emails
      : []
).map((s) => String(s).trim().toLowerCase()).filter(Boolean);

function isPlatformAdmin(email) {
  return !!email && PLATFORM_ADMIN_EMAILS.includes(String(email).toLowerCase());
}

module.exports = { admin, verifyToken, isPlatformAdmin, SUPABASE_URL };
