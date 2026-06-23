// =============================================================================
// MASTER CONFIG  (config.master.js)  —  THE single place to edit shared values
// =============================================================================
// Edit values HERE. Then run `npm run config:gen` (or just build / deploy — it
// runs automatically). The generator (scripts/gen-config.js) expands this file
// into the three per-runtime configs that actually ship:
//
//   • functions/api/config.js     — backend (Catalyst function bundle)
//   • client/src/config.js        — React app (webpack bundle)
//   • client/public/landing.html  — static marketing page (CONFIG block)
//
// WHY THREE OUTPUT FILES (and not one shared import): Catalyst deploys the
// backend and the client as SEPARATE bundles, and the landing page is plain
// static HTML. None of them can import a common module at runtime. So we keep
// ONE editable source (this file) and generate the three at build time. Those
// generated files carry a "DO NOT EDIT" header — change them here instead.
//
// SECRETS DO NOT BELONG HERE. CRON_SECRET / VAPID keys stay in
// functions/api/catalyst-config.json (gitignored) and are read via process.env.
// Backend values below may still be overridden per-deploy by env vars — the
// generator preserves the `process.env.X || <default>` pattern using these as
// the defaults.
// =============================================================================

module.exports = {
  // ---- Shared everywhere (backend + client + landing) ----------------------
  shared: {
    brandName:          'VidyaSetu',          // platform fallback name
    supportEmail:       'support@veena.app',
    supportPhoneTel:    '+919360390883',      // digits for tel: hrefs
    supportPhoneDisplay:'+91 93603 90883',    // what users see
    countryCode:        '91',                 // WhatsApp / phone normalization
    locale:             'en-IN',
    currency:           'INR',
    currencySymbol:     '₹',             // the rupee symbol
  },

  // ---- Pricing (landing-page display copy only — billing is not wired) -----
  // Per-student / month. `offer` is the LIVE price shown prominently; `regular`
  // is the higher struck-through anchor for the launch-offer treatment. To drop
  // the strike + "Save X%" tag, set regular to null (or equal to offer).
  // The save % and every volume-tier total are computed from these — they are
  // the single source for all prices on client/public/landing.html.
  prices: {
    // Name of the current promotion, shown as the pill above the pricing
    // heading on the landing page. Change it per campaign (e.g. 'Diwali offer',
    // 'Founding-member pricing'). Set to '' (empty) to hide the pill entirely
    // and present prices as the standard rate with no offer framing.
    offerName: 'Limited-time launch offer · introductory pricing',
    core:     { offer: 100, regular: 149 },   // ~33% off
    complete: { offer: 200, regular: 299 },   // ~33% off
    // Student counts shown in the "volume pricing" cards.
    volumeTiers: [10, 25, 50],
  },

  // ---- Backend-only (functions/api/config.js) ------------------------------
  backend: {
    photoBucket:        'student-photos-profile', // Stratus bucket name
    photoMaxRawBytes:   8 * 1024 * 1024,          // 8 MB pre-resize
    photoSignedUrlTtl:  '3600',                   // seconds (string for SDK)
    imageMaxDimension:  800,                       // px, longest side
    imageJpegQuality:   85,                        // 0-100
    jsonBodyLimit:      '10mb',                     // express.json limit
    zcqlPageSize:       300,                         // hard platform cap
    quizPassThreshold:  70,                          // percent to pass a quiz
    platformAdminRole:  'App Administrator',         // Catalyst role string
  },
};
