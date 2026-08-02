// routes/pricing.js — PUBLIC, read-only pricing feed for the marketing pages.
//
// The platform owner edits plan prices in Platform Admin -> Plans, which saves
// to the PlatformConfig 'pricing' row (see lib/pricingStore.js). Until now those
// changes only reached the public landing/pricing pages at DEPLOY time, when
// scripts/sync-pricing.js baked them into config.master.js. This endpoint lets
// the pages read the saved overrides LIVE instead, so a price change in the
// admin shows up on the site without a rebuild.
//
// Shape returned:  { overrides: { prices?: {...}, features?: {...} } }
// The client merges `overrides.prices` OVER its own baked defaults, so a missing
// row / missing field simply falls back to the last deployed value (no blank
// prices, ever). Mirrors the public /api/branding pattern: mounted before
// requireAuth, no session needed.

const express = require('express');
const router = express.Router();
const { getOverrides } = require('../lib/pricingStore');

// GET /api/pricing — current saved pricing overrides ({} when none / table
// absent). Cached briefly at the edge/browser so a burst of landing-page views
// doesn't hit the datastore on every request; a price change is visible within
// the cache window.
router.get('/', async (req, res) => {
  try {
    const overrides = await getOverrides(req);
    res.set('Cache-Control', 'public, max-age=120');
    res.json({ overrides: overrides || {} });
  } catch (e) {
    // Never break the page over pricing: fall back to "no overrides" so the
    // client keeps its baked defaults.
    res.json({ overrides: {} });
  }
});

module.exports = router;
