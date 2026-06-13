// /api/settings — Settings module. Two stores:
//
//   1. MessageTemplates    — purpose-built table for the 5 reminder templates.
//      Mounted at /api/settings/templates (GET, PUT).
//
//   2. AppSettings         — generic key/value store for everything else
//      (school identity, billing defaults, notification thresholds, etc.).
//      Mounted at /api/settings/app (GET, PUT).
//
// AppSettings keys are namespaced (`school.name`, `billing.default_online_fee`)
// so the schema never needs to change — adding a new setting is just writing
// to a new key.
//
// Templates support these placeholders (substituted at send time — see
// lib/feeReminder.js and routes/messages.js):
//
//   {name}                    student name
//   {parent}                  parent name
//   {amount}                  total monthly fee     (fee_reminder only)
//   {month} / {year}          month name + year
//   {count}                   consecutive absences  (absence_alert only)
//   {class_fees}, {additional_fees}  fee breakdown components
//   {school}                  school.name from AppSettings (fallback below)
//   {signature}               school.signature from AppSettings (fallback below)

const router = require('express').Router();
const { insert, update, zcql, unwrap, normalize } = require('../db/catalystDb');

// =============================================================================
// MessageTemplates (existing)
// =============================================================================

const TEMPLATES_TABLE = 'MessageTemplates';

// Default templates use {school} and {signature} so a saved AppSettings row
// flows through automatically. If those settings are blank we fall back to
// the literal "Veena Dhwani Academy" — matches the pre-Settings behaviour.
const DEFAULT_TEMPLATES = {
  absence_alert:
    `Dear {parent},\n\nThis is to inform you that {name} has been absent for the last {count} consecutive classes. Kindly ensure regular attendance for better progress.\n\nPlease reach out if there are any concerns.\n\nRegards,\n{signature}`,
  fee_reminder:
    `Dear {parent},\n\nThis is a gentle reminder regarding the {month} {year} fee payment for {name}.\n\nFees for {name} — {month} {year}: ₹{amount}\n  • Class fees: ₹{class_fees}\n  • Additional: ₹{additional_fees}\n\nKindly do the needful. Thank you.\n\n{signature}`,
  class_update:
    `Dear {parent},\n\nThis is to inform you about an update regarding {name}'s music class schedule. Please check with us for the revised timings.\n\nRegards,\n{signature}`,
  thank_you:
    `Dear {parent},\n\nThank you for your continued support and for ensuring {name}'s regular attendance at {school}. We truly appreciate it.\n\nRegards,\n{signature}`,
  holiday_notice:
    `Dear {parent},\n\nThis is to inform you that {school} will remain closed on account of the upcoming holiday. {name}'s classes will resume as per the regular schedule after the break.\n\nRegards,\n{signature}`,
};

const TEMPLATE_TYPES = Object.keys(DEFAULT_TEMPLATES);

async function loadTemplates(req) {
  const rows = await zcql(req, `SELECT * FROM ${TEMPLATES_TABLE}`);
  const all = unwrap(rows, TEMPLATES_TABLE).map(normalize);
  const byType = new Map(all.map((r) => [r.type, r.body]));
  const out = {};
  for (const t of TEMPLATE_TYPES) {
    out[t] = byType.has(t) ? byType.get(t) : DEFAULT_TEMPLATES[t];
  }
  return out;
}

router.get('/templates', async (req, res) => {
  try {
    const templates = await loadTemplates(req);
    res.json({ templates });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load templates', detail: e.message });
  }
});

router.put('/templates', async (req, res) => {
  try {
    const incoming = req.body?.templates || {};
    const rows = await zcql(req, `SELECT * FROM ${TEMPLATES_TABLE}`);
    const existing = unwrap(rows, TEMPLATES_TABLE).map(normalize);
    const byType = new Map(existing.map((r) => [r.type, r]));

    let updated = 0;
    for (const type of TEMPLATE_TYPES) {
      if (incoming[type] === undefined) continue;
      const body = String(incoming[type] ?? '');
      const row = byType.get(type);
      try {
        if (row) await update(req, TEMPLATES_TABLE, row.id, { body });
        else      await insert(req, TEMPLATES_TABLE, { type, body });
        updated++;
      } catch (err) {
        console.error('template upsert failed for', type, err.message);
      }
    }

    const templates = await loadTemplates(req);
    res.json({ updated, templates });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save templates', detail: e.message });
  }
});

// =============================================================================
// AppSettings — generic key/value store
// =============================================================================

const APP_TABLE = 'AppSettings';

// Whitelist of recognised keys. Anything not in this map is rejected on PUT
// to prevent the table getting littered with typos. To add a new setting,
// add a row here with its default value + a brief comment.
const APP_SETTINGS_DEFAULTS = {
  // ---- School identity (Phase 1) ----------------------------------------
  'school.name':           'Veena Dhwani Academy', // shown in templates as {school}
  'school.signature':      'Veena Dhwani Academy', // shown in templates as {signature}
  'school.contact_phone':  '',
  'school.contact_email':  '',
  'school.address':        '',                     // multi-line OK

  // ---- Billing defaults (Phase 2) ---------------------------------------
  // Used to pre-fill the Add Student form. Integers, ₹ per hour.
  'billing.default_online_fee':  '',  // string-encoded so empty means "no default"
  'billing.default_offline_fee': '',
  'billing.default_group_fee':   '',
  'billing.default_min_classes': '',
};

const APP_SETTINGS_KEYS = Object.keys(APP_SETTINGS_DEFAULTS);

// Read every AppSettings row, fold into a flat object keyed by setting name.
// Missing keys are filled from APP_SETTINGS_DEFAULTS so the caller always
// gets a complete map.
async function loadAppSettings(req) {
  let rows;
  try {
    rows = await zcql(req, `SELECT * FROM ${APP_TABLE}`);
  } catch (e) {
    // Table doesn't exist yet (admin hasn't created it in console) — return
    // defaults so the rest of the app still works.
    console.error('AppSettings unavailable; using defaults.', e.message);
    return { ...APP_SETTINGS_DEFAULTS };
  }
  const all = unwrap(rows, APP_TABLE).map(normalize);
  const byKey = new Map(all.map((r) => [r.key, r.value]));
  const out = {};
  for (const k of APP_SETTINGS_KEYS) {
    out[k] = byKey.has(k) ? byKey.get(k) : APP_SETTINGS_DEFAULTS[k];
  }
  return out;
}

// GET /api/settings/app — returns { settings: { 'school.name': '...', ... } }
router.get('/app', async (req, res) => {
  try {
    const settings = await loadAppSettings(req);
    res.json({ settings });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load app settings', detail: e.message });
  }
});

// PUT /api/settings/app
// Body: { settings: { 'school.name': 'My Academy', 'billing.default_online_fee': '500' } }
// Upserts each provided whitelisted key. Unknown keys are ignored silently.
router.put('/app', async (req, res) => {
  try {
    const incoming = req.body?.settings || {};

    // Index existing rows by key
    let rows;
    try {
      rows = await zcql(req, `SELECT * FROM ${APP_TABLE}`);
    } catch (e) {
      return res.status(503).json({
        error: 'AppSettings table not available',
        detail: 'Create the AppSettings table in Catalyst console (key Text 100 unique, value Text 4000).',
      });
    }
    const existing = unwrap(rows, APP_TABLE).map(normalize);
    const byKey = new Map(existing.map((r) => [r.key, r]));

    let upserted = 0;
    for (const key of APP_SETTINGS_KEYS) {
      if (incoming[key] === undefined) continue;
      const value = incoming[key] === null ? '' : String(incoming[key]);
      const row = byKey.get(key);
      try {
        if (row) {
          // Skip the write if the value didn't actually change — saves a
          // round-trip on the common "Save with no edits" case.
          if (row.value !== value) {
            await update(req, APP_TABLE, row.id, { value });
            upserted++;
          }
        } else {
          await insert(req, APP_TABLE, { key, value });
          upserted++;
        }
      } catch (err) {
        console.error('app setting upsert failed for', key, err.message);
      }
    }

    const settings = await loadAppSettings(req);
    res.json({ upserted, settings });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save app settings', detail: e.message });
  }
});

// =============================================================================
// Exports
// =============================================================================

router.loadTemplates       = loadTemplates;
router.DEFAULT_TEMPLATES   = DEFAULT_TEMPLATES;
router.loadAppSettings     = loadAppSettings;
router.APP_SETTINGS_KEYS   = APP_SETTINGS_KEYS;
module.exports = router;
