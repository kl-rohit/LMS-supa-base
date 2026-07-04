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
const IMAGE_MAX_DIMENSION   = Number(env.IMAGE_MAX_DIMENSION) || 512;
const IMAGE_JPEG_QUALITY    = Number(env.IMAGE_JPEG_QUALITY) || 72;

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

// ---- Plan entitlements (derived from the feature catalog) ------------------
// Module keys that are Complete-only. plans.js reads this so the pricing sheet
// and the server-side paywall always agree. Edit config.master.js features.
const PREMIUM_MODULES = ['assignments', 'lessons', 'question_papers'];

// Per-feature plan availability (key -> { core, complete }). requireFeature
// reads this so every catalog row is independently switchable from config.
const FEATURE_PLANS = {
    'students.profiles': { core: true, complete: true },
    'students.contacts': { core: true, complete: true },
    'students.photos': { core: true, complete: true },
    'groups.batches': { core: true, complete: true },
    'students.import': { core: true, complete: true },
    'attendance.daily': { core: true, complete: true },
    'attendance.rosters': { core: true, complete: true },
    'fees.tracking': { core: true, complete: true },
    'fees.perStudent': { core: true, complete: true },
    'fees.additional': { core: true, complete: true },
    'fees.reminders': { core: true, complete: true },
    'fees.statements': { core: true, complete: true },
    'fees.upi_qr': { core: true, complete: true },
    'classes.timetable': { core: true, complete: true },
    'classes.types': { core: true, complete: true },
    'classes.join_links': { core: true, complete: true },
    'classes.exceptions': { core: true, complete: true },
    'camps.run': { core: true, complete: true },
    'camps.roster': { core: true, complete: true },
    'messages.send': { core: true, complete: true },
    'messages.bulk': { core: true, complete: true },
    'messages.templates': { core: true, complete: true },
    'notify.auto': { core: true, complete: true },
    'notify.bell': { core: true, complete: true },
    'notify.push': { core: true, complete: true },
    'notify.digest': { core: true, complete: true },
    'portal.login': { core: true, complete: true },
    'portal.glance': { core: true, complete: true },
    'portal.profile': { core: true, complete: true },
    'portal.learning': { core: false, complete: true },
    'lessons.build': { core: false, complete: true },
    'lessons.player': { core: false, complete: true },
    'lessons.resources': { core: false, complete: true },
    'lessons.progress': { core: false, complete: true },
    'lessons.enrol': { core: false, complete: true },
    'quizzes.add': { core: false, complete: true },
    'quizzes.gate': { core: false, complete: true },
    'quizzes.certs': { core: false, complete: true },
    'assignments.assign': { core: false, complete: true },
    'assignments.due': { core: false, complete: true },
    'assignments.notify': { core: false, complete: true },
    'papers.share': { core: false, complete: true },
    'papers.prep': { core: false, complete: true },
    'reports.basic': { core: true, complete: true },
    'reports.detailed': { core: false, complete: true },
    'reports.lessons': { core: false, complete: true },
    'pwa.install': { core: true, complete: true },
    'pwa.a2hs': { core: true, complete: true },
    'pwa.theme': { core: true, complete: true },
    'multi.branches': { core: true, complete: true },
    'multi.isolated': { core: true, complete: true },
    'data.export': { core: true, complete: true },
    'support.setup': { core: true, complete: true },
    'support.human': { core: true, complete: true },
  };

module.exports = {
  PREMIUM_MODULES,
  FEATURE_PLANS,
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
