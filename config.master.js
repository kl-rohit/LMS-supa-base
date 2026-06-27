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
  // Model: a flat monthly BASE that already includes `included` students, then
  // a per-student rate for each student beyond that. `base`/`perStudent` are the
  // LIVE launch prices; `baseRegular`/`perStudentRegular` are the higher
  // struck-through anchors. Set a *Regular to null (or equal to live) to drop
  // its strike. This object is the single source for every price + the
  // estimator on client/public/landing.html.
  prices: {
    // Promotion pill above the pricing heading. '' hides the pill and presents
    // prices as the standard rate with no offer framing.
    offerName: 'Limited-time launch offer · introductory pricing',
    core: {
      base: 1000, baseRegular: 1500,        // ₹/month, includes `included` students
      included: 15,
      perStudent: 50, perStudentRegular: 75, // ₹/student/month beyond `included`
    },
    complete: {
      base: 2000, baseRegular: 2999,
      included: 15,
      perStudent: 90, perStudentRegular: 130,
    },
    // Student counts shown as example totals in the pricing comparison table.
    sampleCounts: [15, 30, 60],
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
