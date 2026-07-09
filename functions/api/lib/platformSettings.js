// Global platform branding/identity — the single editable record for the SaaS
// brand (name, logo, tagline, support contacts, offer text). Stored as one row
// in `platformsettings` (id = 1). Read publicly (login + landing), written by
// platform admins. Degrades to config defaults if the row/table is absent, so
// the app never breaks before the table is created.

const { zcql, unwrap, normalize, update, insert } = require('../db/catalystDb');
const config = require('../config');

const FIELDS = ['brand_name', 'tagline', 'logo_url', 'support_email', 'support_phone_tel', 'support_phone_display', 'offer_name'];

function defaults() {
  return {
    brand_name: config.BRAND_NAME || 'VidyaSetu',
    tagline: config.BRAND_TAGLINE || 'Bridging teachers and learners',
    logo_url: '',
    support_email: config.SUPPORT_EMAIL || 'support@veena.app',
    support_phone_tel: config.SUPPORT_PHONE_TEL || '+919360390883',
    support_phone_display: config.SUPPORT_PHONE_DISPLAY || '+91 93603 90883',
    offer_name: '',
  };
}

// Short in-memory cache — the public read is hit on every login/landing load.
let _cache = null;
let _exp = 0;
const TTL_MS = 60 * 1000;

async function loadBranding(req) {
  if (_cache && _exp > Date.now()) return _cache;
  const out = defaults();
  try {
    const rows = await zcql(req, 'SELECT * FROM platformsettings WHERE platformsettings.id = 1');
    const row = unwrap(rows, 'platformsettings').map(normalize)[0];
    if (row) {
      for (const k of FIELDS) {
        if (row[k] !== undefined && row[k] !== null && row[k] !== '') out[k] = row[k];
      }
    }
  } catch { /* table not created yet → defaults stand */ }
  _cache = out; _exp = Date.now() + TTL_MS;
  return out;
}

async function saveBranding(req, patch) {
  const clean = {};
  for (const k of FIELDS) if (patch[k] !== undefined) clean[k] = patch[k] == null ? '' : String(patch[k]);
  clean.updated_at = new Date().toISOString();
  // The singleton row is seeded by the migration; update it. Fall back to insert
  // if it somehow isn't there.
  try { await update(req, 'platformsettings', 1, clean); }
  catch { await insert(req, 'platformsettings', { id: 1, ...clean }); }
  _cache = null; _exp = 0;
  return loadBranding(req);
}

module.exports = { loadBranding, saveBranding };
