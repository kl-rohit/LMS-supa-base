// Public platform branding — GET /api/branding. No auth (login + landing pages
// read it before a session exists). Writes happen under /api/platform/branding
// (platform-admin only). Falls back to config defaults if unset.

const router = require('express').Router();
const { loadBranding } = require('../lib/platformSettings');

router.get('/', async (req, res) => {
  try {
    res.json(await loadBranding(req));
  } catch {
    res.json({ brand_name: 'VidyaSetu', tagline: 'Bridging teachers and learners' });
  }
});

module.exports = router;
