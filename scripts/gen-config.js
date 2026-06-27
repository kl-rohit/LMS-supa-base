#!/usr/bin/env node
// =============================================================================
// CONFIG GENERATOR  (scripts/gen-config.js)
// =============================================================================
// Reads config.master.js (the single source of truth) and writes the three
// per-runtime config files that actually ship:
//
//   • functions/api/config.js     — backend (CommonJS, env-overridable)
//   • client/src/config.js        — React app (ES modules)
//   • client/public/landing.html  — static page (replaces the CONFIG block
//                                    between the GEN:CONFIG markers)
//
// Runs automatically before every client build (client prebuild) and at the
// top of deploy.sh, so the shipped configs always match the master. You can
// also run it directly:  npm run config:gen
//
// Paths are resolved from THIS file's location, so it works no matter which
// directory invokes it.
// =============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const master = require(path.join(ROOT, 'config.master.js'));
const { shared, prices, backend } = master;

const DO_NOT_EDIT =
  'GENERATED FILE — do not edit by hand.\n' +
  '// Edit values in config.master.js (repo root) then run `npm run config:gen`\n' +
  '// (build / deploy run it automatically). Hand edits here are overwritten.';

// JS string literal with single quotes, escaped safely.
function s(v) {
  return "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

// ---------------------------------------------------------------------------
// 1) Backend — functions/api/config.js  (CommonJS, env overrides preserved)
// ---------------------------------------------------------------------------
function backendFile() {
  return `// ${DO_NOT_EDIT}
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
const BRAND_NAME    = env.BRAND_NAME    || ${s(shared.brandName)};
const SUPPORT_EMAIL = env.SUPPORT_EMAIL || ${s(shared.supportEmail)};
const SUPPORT_PHONE = env.SUPPORT_PHONE || ${s(shared.supportPhoneDisplay)};

// ---- Stratus object storage ------------------------------------------------
const PHOTO_BUCKET = env.PHOTO_BUCKET || ${s(backend.photoBucket)};
const photoKeyForStudent = (id) => \`student-\${id}.jpg\`;
const logoKeyForOrg      = (orgId) => \`org-\${orgId}-logo.jpg\`;

// ---- Photo upload pipeline -------------------------------------------------
const PHOTO_MAX_RAW_BYTES   = Number(env.PHOTO_MAX_RAW_BYTES) || ${backend.photoMaxRawBytes};
const PHOTO_SIGNED_URL_TTL  = String(env.PHOTO_SIGNED_URL_TTL || ${s(backend.photoSignedUrlTtl)});
const IMAGE_MAX_DIMENSION   = Number(env.IMAGE_MAX_DIMENSION) || ${backend.imageMaxDimension};
const IMAGE_JPEG_QUALITY    = Number(env.IMAGE_JPEG_QUALITY) || ${backend.imageJpegQuality};

// ---- Request / query limits ------------------------------------------------
const JSON_BODY_LIMIT = env.JSON_BODY_LIMIT || ${s(backend.jsonBodyLimit)};
const ZCQL_PAGE_SIZE  = ${backend.zcqlPageSize}; // hard platform cap; do NOT raise

// ---- Business rules --------------------------------------------------------
const QUIZ_PASS_THRESHOLD = Number(env.QUIZ_PASS_THRESHOLD) || ${backend.quizPassThreshold};

// ---- Locale / region -------------------------------------------------------
const DEFAULT_COUNTRY_CODE = env.DEFAULT_COUNTRY_CODE || ${s(shared.countryCode)};
const DEFAULT_LOCALE       = env.DEFAULT_LOCALE       || ${s(shared.locale)};
const DEFAULT_CURRENCY     = env.DEFAULT_CURRENCY     || ${s(shared.currency)};

// ---- Identity / roles ------------------------------------------------------
const PLATFORM_ADMIN_ROLE = ${s(backend.platformAdminRole)};

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
`;
}

// ---------------------------------------------------------------------------
// 2) Frontend — client/src/config.js  (ES modules)
// ---------------------------------------------------------------------------
function frontendFile() {
  return `// ${DO_NOT_EDIT}
// =============================================================================
// FRONTEND CONFIG  (client/src/config.js)  — GENERATED from config.master.js
// =============================================================================
// Brand fallbacks, support contacts, and locale defaults for the React app.
// Each academy still sets its own display name + logo via in-app branding;
// BRAND_NAME below is only the platform fallback shown before that loads.
// =============================================================================

// ---- Brand / support -------------------------------------------------------
export const BRAND_NAME    = ${s(shared.brandName)};
export const SUPPORT_EMAIL = ${s(shared.supportEmail)};
export const SUPPORT_PHONE_TEL     = ${s(shared.supportPhoneTel)};
export const SUPPORT_PHONE_DISPLAY = ${s(shared.supportPhoneDisplay)};

// ---- Locale / region -------------------------------------------------------
export const DEFAULT_COUNTRY_CODE = ${s(shared.countryCode)};
export const DEFAULT_LOCALE       = ${s(shared.locale)};
export const DEFAULT_CURRENCY     = ${s(shared.currency)};
export const CURRENCY_SYMBOL      = ${s(shared.currencySymbol)};

// ---- Pricing (display copy only — billing is not wired) --------------------
// Live (offer) per-student / month prices. The struck-through "regular" anchors
// used on the marketing landing page live in config.master.js too.
export const PLAN_PRICES = {
  core:     ${Number(prices.core.base)},
  complete: ${Number(prices.complete.base)},
};

export default {
  BRAND_NAME,
  SUPPORT_EMAIL,
  SUPPORT_PHONE_TEL,
  SUPPORT_PHONE_DISPLAY,
  DEFAULT_COUNTRY_CODE,
  DEFAULT_LOCALE,
  DEFAULT_CURRENCY,
  CURRENCY_SYMBOL,
  PLAN_PRICES,
};
`;
}

// ---------------------------------------------------------------------------
// 3) Landing page — replace the block between GEN:CONFIG markers
// ---------------------------------------------------------------------------
// One plan as a JS object literal in the base + per-student shape.
function planLiteral(plan) {
  const num = (v) => (v === null || v === undefined ? 'null' : Number(v));
  return `{ base: ${Number(plan.base)}, baseRegular: ${num(plan.baseRegular)}, included: ${Number(plan.included)}, perStudent: ${Number(plan.perStudent)}, perStudentRegular: ${num(plan.perStudentRegular)} }`;
}

function landingBlock() {
  const counts = Array.isArray(prices.sampleCounts) ? prices.sampleCounts : [15, 30, 60];
  return `    /* GEN:CONFIG:START — generated from config.master.js, do not edit by hand */
    var LANDING_CONFIG = {
      BRAND_NAME:    ${s(shared.brandName)},
      PHONE_TEL:     ${s(shared.supportPhoneTel)},
      PHONE_DISPLAY: ${s(shared.supportPhoneDisplay)},
      SUPPORT_EMAIL: ${s(shared.supportEmail)},
      CURRENCY:      ${s(shared.currencySymbol)},
      OFFER_NAME:    ${s(prices.offerName || '')},
      PRICES: {
        core:     ${planLiteral(prices.core)},
        complete: ${planLiteral(prices.complete)},
        sampleCounts: [${counts.map(Number).join(', ')}],
      },
    };
    /* GEN:CONFIG:END */`;
}

function patchLanding(file) {
  const src = fs.readFileSync(file, 'utf8');
  const re = /[ \t]*\/\* GEN:CONFIG:START[\s\S]*?\/\* GEN:CONFIG:END \*\//;
  if (!re.test(src)) {
    throw new Error(
      path.basename(file) + ' is missing the GEN:CONFIG:START / GEN:CONFIG:END markers. ' +
      'Add them around the LANDING_CONFIG object so the generator can target it.'
    );
  }
  const next = src.replace(re, landingBlock());
  if (next !== src) {
    fs.writeFileSync(file, next);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
function write(rel, content) {
  const file = path.join(ROOT, rel);
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (prev === content) {
    console.log('  = ' + rel + ' (unchanged)');
    return;
  }
  fs.writeFileSync(file, content);
  console.log('  ✓ ' + rel);
}

function main() {
  console.log('▶ gen-config: expanding config.master.js');
  write('functions/api/config.js', backendFile());
  write('client/src/config.js', frontendFile());

  // Both static marketing pages carry the GEN:CONFIG block so their prices /
  // offer copy stay sourced from the master config.
  ['client/public/landing.html', 'client/public/pricing.html'].forEach(function (rel) {
    const changed = patchLanding(path.join(ROOT, rel));
    console.log((changed ? '  ✓ ' : '  = ') + rel + (changed ? '' : ' (unchanged)'));
  });

  console.log('✔ config generated');
}

main();
