const express = require('express');
const router = express.Router();
const { getSetting, setSetting, getAllZohoSettings, testConnection } = require('../services/zohoAuth');
const { createSpreadsheet, addSheet, deleteSheet, addHeaderRow } = require('../services/zohoSheets');
const { SHEET_MAPPINGS, SHEET_NAMES } = require('../services/zohoConfig');
const { syncAllData } = require('../services/zohoSync');

// GET /api/settings/zoho - Get current Zoho config (masked secrets)
router.get('/zoho', (req, res) => {
  try {
    const settings = getAllZohoSettings();
    // Mask sensitive fields
    const masked = { ...settings };
    if (masked.zoho_client_secret) {
      masked.zoho_client_secret = '••••' + masked.zoho_client_secret.slice(-4);
    }
    if (masked.zoho_refresh_token) {
      masked.zoho_refresh_token = '••••' + masked.zoho_refresh_token.slice(-4);
    }
    if (masked.zoho_access_token) {
      masked.zoho_access_token = '(cached)';
    }
    res.json({ settings: masked });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/settings/zoho - Save Zoho credentials
router.put('/zoho', (req, res) => {
  try {
    const {
      zoho_client_id,
      zoho_client_secret,
      zoho_refresh_token,
      zoho_domain,
      zoho_accounts_domain,
      zoho_sync_enabled,
      zoho_spreadsheet_id,
    } = req.body;

    if (zoho_client_id !== undefined) setSetting('zoho_client_id', zoho_client_id);
    if (zoho_client_secret !== undefined && !zoho_client_secret.startsWith('••••')) {
      setSetting('zoho_client_secret', zoho_client_secret);
    }
    if (zoho_refresh_token !== undefined && !zoho_refresh_token.startsWith('••••')) {
      setSetting('zoho_refresh_token', zoho_refresh_token);
    }
    if (zoho_domain !== undefined) setSetting('zoho_domain', zoho_domain);
    if (zoho_accounts_domain !== undefined) setSetting('zoho_accounts_domain', zoho_accounts_domain);
    if (zoho_sync_enabled !== undefined) setSetting('zoho_sync_enabled', zoho_sync_enabled);
    if (zoho_spreadsheet_id !== undefined) setSetting('zoho_spreadsheet_id', zoho_spreadsheet_id);

    // Clear cached token if credentials change
    if (zoho_client_id || zoho_client_secret || zoho_refresh_token) {
      setSetting('zoho_access_token', '');
      setSetting('zoho_token_expiry', '0');
    }

    res.json({ message: 'Settings saved successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/settings/zoho/test - Test connection
router.post('/zoho/test', async (req, res) => {
  try {
    const result = await testConnection();
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/settings/zoho/create-spreadsheet - Create spreadsheet with all tabs
router.post('/zoho/create-spreadsheet', async (req, res) => {
  try {
    const name = req.body.name || 'Veena Student Tracker';

    // Create the spreadsheet
    const result = await createSpreadsheet(name);
    const spreadsheetId = result.resource_id || result.spreadsheet_id;

    if (!spreadsheetId) {
      return res.status(400).json({
        error: 'Failed to get spreadsheet ID from response',
        details: result,
      });
    }

    setSetting('zoho_spreadsheet_id', spreadsheetId);

    // Create each sheet tab and add headers
    const created = [];
    for (const key of Object.keys(SHEET_MAPPINGS)) {
      const mapping = SHEET_MAPPINGS[key];
      try {
        await addSheet(spreadsheetId, mapping.sheetName);
        await addHeaderRow(spreadsheetId, mapping.sheetName, mapping.columns);
        created.push(mapping.sheetName);
      } catch (e) {
        console.error(`Failed to create sheet ${mapping.sheetName}:`, e.message);
      }
      // Small delay between API calls
      await new Promise((r) => setTimeout(r, 500));
    }

    // Try to delete the default "Sheet1"
    try {
      await deleteSheet(spreadsheetId, 'Sheet1');
    } catch {
      // Ignore - may not exist
    }

    res.json({
      message: 'Spreadsheet created successfully',
      spreadsheet_id: spreadsheetId,
      sheets_created: created,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/settings/zoho/sync-all - Full data sync
router.post('/zoho/sync-all', async (req, res) => {
  try {
    const results = await syncAllData();
    res.json({ message: 'Full sync completed', results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// Local dev implementation of /settings/app
// -----------------------------------------------------------------------------
// In production these app settings live in the Catalyst AppSettings table
// (functions/api/routes/settings.js). The offline dev server has no Catalyst,
// so we back the same key/value contract with the local SQLite `settings`
// table via getSetting/setSetting. Keys mirror EMPTY_SETTINGS in
// client/src/pages/Settings.jsx. Local dev unlocks every plan/entitlement so
// all tabs and modules are reachable while working offline.
// =============================================================================
const APP_SETTINGS_DEFAULTS = {
  'school.name': '',
  'school.signature': '',
  'school.contact_phone': '',
  'school.contact_email': '',
  'school.address': '',
  'billing.default_online_fee': '',
  'billing.default_offline_fee': '',
  'billing.default_group_fee': '',
  'billing.default_min_classes': '',
  'modules.lessons': 'true',
  'modules.fees': 'true',
  'modules.messages': 'true',
  'modules.reports': 'true',
  'modules.camps': 'false',
  'modules.groups': 'true',
  'modules.student_photos': 'true',
  'modules.assignments': 'false',
  'modules.question_papers': 'false',
  'portal.show_lessons': 'true',
  'portal.show_fees': 'true',
  'portal.allow_profile_edit': 'true',
  'appearance.accent': 'default',
  'appearance.mode': 'light',
  'schedule.working_hours': '',
};
const APP_KEY_PREFIX = 'app:'; // namespace so app settings never collide with zoho_* keys

function loadAppSettings() {
  const out = {};
  for (const key of Object.keys(APP_SETTINGS_DEFAULTS)) {
    const stored = getSetting(APP_KEY_PREFIX + key);
    out[key] = stored !== undefined && stored !== null ? stored : APP_SETTINGS_DEFAULTS[key];
  }
  return out;
}

function entitlementBlock() {
  // Local dev: grant the full plan so every premium module/tab is visible.
  return {
    plan: 'complete',
    premiumModules: ['lessons', 'assignments', 'question_papers'],
    entitlements: { lessons: true, assignments: true, question_papers: true },
    maxStudents: null,
    trial: null,
  };
}

// GET /api/settings/app
router.get('/app', (req, res) => {
  try {
    res.json({ settings: loadAppSettings(), ...entitlementBlock() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load app settings', detail: error.message });
  }
});

// PUT /api/settings/app
router.put('/app', (req, res) => {
  try {
    const incoming = req.body?.settings || {};
    let upserted = 0;
    for (const key of Object.keys(APP_SETTINGS_DEFAULTS)) {
      if (incoming[key] === undefined) continue;
      const value = incoming[key] === null ? '' : String(incoming[key]);
      setSetting(APP_KEY_PREFIX + key, value);
      upserted++;
    }
    res.json({ upserted, settings: loadAppSettings(), ...entitlementBlock() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save app settings', detail: error.message });
  }
});

// GET /api/settings/zoho/status - Sync status
router.get('/zoho/status', (req, res) => {
  try {
    res.json({
      enabled: getSetting('zoho_sync_enabled') === 'true',
      spreadsheet_id: getSetting('zoho_spreadsheet_id') || null,
      last_full_sync: getSetting('zoho_last_full_sync') || null,
      domain: getSetting('zoho_domain') || 'sheet.zoho.in',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
