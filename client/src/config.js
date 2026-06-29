// GENERATED FILE — do not edit by hand.
// Edit values in config.master.js (repo root) then run `npm run config:gen`
// (build / deploy run it automatically). Hand edits here are overwritten.
// =============================================================================
// FRONTEND CONFIG  (client/src/config.js)  — GENERATED from config.master.js
// =============================================================================
// Brand fallbacks, support contacts, and locale defaults for the React app.
// Each academy still sets its own display name + logo via in-app branding;
// BRAND_NAME below is only the platform fallback shown before that loads.
// =============================================================================

// ---- Brand / support -------------------------------------------------------
export const BRAND_NAME    = 'VidyaSetu';
export const SUPPORT_EMAIL = 'support@veena.app';
export const SUPPORT_PHONE_TEL     = '+919360390883';
export const SUPPORT_PHONE_DISPLAY = '+91 93603 90883';

// ---- Locale / region -------------------------------------------------------
export const DEFAULT_COUNTRY_CODE = '91';
export const DEFAULT_LOCALE       = 'en-IN';
export const DEFAULT_CURRENCY     = 'INR';
export const CURRENCY_SYMBOL      = '₹';

// ---- Pricing (display copy only — billing is not wired) --------------------
// Live (offer) per-student / month prices. The struck-through "regular" anchors
// used on the marketing landing page live in config.master.js too.
export const PLAN_PRICES = {
  core:     1000,
  complete: 2000,
};

// Module keys unlocked only on the Complete plan, derived from the feature
// catalog in config.master.js. useModuleFlags reads this to force-hide a
// premium module the org's plan does not include.
export const PREMIUM_MODULES = ['assignments', 'lessons', 'question_papers'];

// Per-feature plan availability (key -> { core, complete }), used by featureOn
// to hide a feature's UI when the org's plan does not include it.
export const FEATURE_PLANS = {
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
  PREMIUM_MODULES,
  FEATURE_PLANS,
};
