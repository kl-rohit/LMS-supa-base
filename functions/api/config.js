// GENERATED FILE — do not edit by hand.
// Edit values in config.master.js (repo root) then run `npm run config:gen`
// (build / deploy run it automatically). Hand edits here are overwritten.
// =============================================================================
// BACKEND CONFIG  (functions/api/config.js)  — GENERATED from config.master.js
// =============================================================================
// Server-side, deployment, and infra values. Catalyst only deploys the
// functions/ directory, so the backend's config must live inside it. Values
// may be overridden per-deploy via env vars (defaults come from the master).
// SECRETS stay in functions/api/catalyst-config.json (gitignored), not here.
// =============================================================================

const env = process.env;

// ---- Brand / support -------------------------------------------------------
const BRAND_NAME    = env.BRAND_NAME    || 'VidyaSetu';
const SUPPORT_EMAIL = env.SUPPORT_EMAIL || 'support@veena.app';
const SUPPORT_PHONE = env.SUPPORT_PHONE || '+91 93603 90883';

// ---- Stratus object storage ------------------------------------------------
const PHOTO_BUCKET = env.PHOTO_BUCKET || 'student-photos-profile';
const photoKeyForStudent = (id) => `student-${id}.jpg`;
const logoKeyForOrg      = (orgId) => `org-${orgId}-logo.jpg`;

// ---- Photo upload pipeline -------------------------------------------------
const PHOTO_MAX_RAW_BYTES   = Number(env.PHOTO_MAX_RAW_BYTES) || 8388608;
const PHOTO_SIGNED_URL_TTL  = String(env.PHOTO_SIGNED_URL_TTL || '3600');
const IMAGE_MAX_DIMENSION   = Number(env.IMAGE_MAX_DIMENSION) || 800;
const IMAGE_JPEG_QUALITY    = Number(env.IMAGE_JPEG_QUALITY) || 85;

// ---- Request / query limits ------------------------------------------------
const JSON_BODY_LIMIT = env.JSON_BODY_LIMIT || '10mb';
const ZCQL_PAGE_SIZE  = 300; // hard platform cap; do NOT raise

// ---- Business rules --------------------------------------------------------
const QUIZ_PASS_THRESHOLD = Number(env.QUIZ_PASS_THRESHOLD) || 70;

// ---- Locale / region -------------------------------------------------------
const DEFAULT_COUNTRY_CODE = env.DEFAULT_COUNTRY_CODE || '91';
const DEFAULT_LOCALE       = env.DEFAULT_LOCALE       || 'en-IN';
const DEFAULT_CURRENCY     = env.DEFAULT_CURRENCY     || 'INR';

// ---- Identity / roles ------------------------------------------------------
const PLATFORM_ADMIN_ROLE = 'App Administrator';

module.exports = {
  BRAND_NAME,
  SUPPORT_EMAIL,
  SUPPORT_PHONE,
  PHOTO_BUCKET,
  photoKeyForStudent,
  logoKeyForOrg,
  PHOTO_MAX_RAW_BYTES,
  PHOTO_SIGNED_URL_TTL,
  IMAGE_MAX_DIMENSION,
  IMAGE_JPEG_QUALITY,
  JSON_BODY_LIMIT,
  ZCQL_PAGE_SIZE,
  QUIZ_PASS_THRESHOLD,
  DEFAULT_COUNTRY_CODE,
  DEFAULT_LOCALE,
  DEFAULT_CURRENCY,
  PLATFORM_ADMIN_ROLE,
};
