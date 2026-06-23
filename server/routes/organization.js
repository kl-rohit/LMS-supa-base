const express = require('express');
const router = express.Router();
const { getSetting, setSetting } = require('../services/zohoAuth');

// =============================================================================
// Local dev implementation of /organization
// -----------------------------------------------------------------------------
// In production the organization (academy identity, members, ownership) lives
// in the Catalyst backend (functions/api/routes/organization.js). The offline
// dev server has no Catalyst, so we back the name + logo with the local SQLite
// `settings` table and report the local operator as the sole owner. This keeps
// the admin Settings → Organization tab working while developing offline.
// =============================================================================
const ORG_NAME_KEY = 'app:org.name';
const ORG_LOGO_KEY = 'app:org.logo_url';
const DEFAULT_ORG_NAME = 'My Academy';

function currentOrg() {
  const name = getSetting(ORG_NAME_KEY) || DEFAULT_ORG_NAME;
  return { id: 1, name };
}

// GET /api/organization
router.get('/', (req, res) => {
  try {
    res.json({
      org: currentOrg(),
      role: 'owner',
      members: [
        { id: 1, name: 'Local Admin', email: 'admin@localhost', role: 'owner' },
      ],
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/organization  { name }
router.put('/', (req, res) => {
  try {
    const name = (req.body?.name || '').trim();
    if (name) setSetting(ORG_NAME_KEY, name);
    res.json({ org: currentOrg() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/organization/logo-url
router.get('/logo-url', (req, res) => {
  try {
    res.json({ logo_url: getSetting(ORG_LOGO_KEY) || '' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/organization/logo  { data }  (data: a data: URL or hosted URL)
router.post('/logo', (req, res) => {
  try {
    const data = req.body?.data || '';
    setSetting(ORG_LOGO_KEY, data);
    res.json({ logo_url: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Owner-only member management. Local dev is single-operator, so these are
// no-ops that return success to keep the Organization tab interactive offline.
router.post('/invite', (req, res) => res.json({ ok: true, message: 'Invites are not available on the local dev server' }));
router.delete('/members/:id', (req, res) => res.json({ ok: true }));
router.post('/transfer-ownership', (req, res) => res.json({ ok: true }));

module.exports = router;
