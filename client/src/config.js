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
  core:     100,
  complete: 200,
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
