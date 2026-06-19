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
const { normalizePlan, PREMIUM_MODULES, isModuleEntitled } = require('../lib/plans');

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
  // req.orgId is set by middleware/org.resolveOrg on tenant routes; the
  // shared cron driver and fee-reminder lib also set it explicitly before
  // calling. Anything calling loadTemplates without orgId returns defaults.
  if (!req.orgId) return { ...DEFAULT_TEMPLATES };
  const rows = await zcql(req, `SELECT * FROM ${TEMPLATES_TABLE} WHERE ${TEMPLATES_TABLE}.org_id = ${Number(req.orgId)}`);
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
    const rows = await zcql(req, `SELECT * FROM ${TEMPLATES_TABLE} WHERE ${TEMPLATES_TABLE}.org_id = ${Number(req.orgId)}`);
    const existing = unwrap(rows, TEMPLATES_TABLE).map(normalize);
    const byType = new Map(existing.map((r) => [r.type, r]));

    let updated = 0;
    for (const type of TEMPLATE_TYPES) {
      if (incoming[type] === undefined) continue;
      const body = String(incoming[type] ?? '');
      const row = byType.get(type);
      try {
        if (row) await update(req, TEMPLATES_TABLE, row.id, { body });
        else      await insert(req, TEMPLATES_TABLE, { type, body, org_id: Number(req.orgId) });
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
//
// The columns are named `setting_key` + `setting_value` (not plain key/value)
// because Catalyst rejects `key` / `value` as reserved column names.
// =============================================================================

const APP_TABLE = 'AppSettings';
const APP_KEY_COL = 'setting_key';
const APP_VAL_COL = 'setting_value';

// Whitelist of recognised keys. Anything not in this map is rejected on PUT
// to prevent the table getting littered with typos. To add a new setting,
// add a row here with its default value + a brief comment.
const APP_SETTINGS_DEFAULTS = {
  // ---- School identity (Phase 1) ----------------------------------------
  // Empty by default — loadAppSettings() backfills these from the calling
  // org's Organizations.name so each academy gets ITS OWN name/signature,
  // not a hard-coded one. They only become non-empty here once the owner
  // explicitly overrides them in Settings.
  'school.name':           '', // shown in templates as {school}
  'school.signature':      '', // shown in templates as {signature}
  'school.contact_phone':  '',
  'school.contact_email':  '',
  'school.address':        '',                     // multi-line OK

  // ---- Billing defaults (Phase 2) ---------------------------------------
  // Used to pre-fill the Add Student form. Integers, ₹ per hour.
  'billing.default_online_fee':  '',  // string-encoded so empty means "no default"
  'billing.default_offline_fee': '',
  'billing.default_group_fee':   '',
  'billing.default_min_classes': '',

  // ---- Modules (Phase 3) -----------------------------------------------
  // Per-org module enable/disable. Stored as 'true'/'false' strings so the
  // JSON column doesn't need to handle bool serialisation. Empty value
  // falls back to defaults below.
  'modules.lessons':        'true',
  'modules.fees':           'true',
  'modules.messages':       'true',
  'modules.reports':        'true',
  'modules.camps':          'false', // off by default — not everyone runs camps
  'modules.groups':         'true',
  'modules.student_photos': 'true',
  'modules.assignments':    'false', // off by default — opt-in
  'modules.question_papers':'false', // off by default — opt-in

  // ---- Parent portal visibility (Phase 3) ------------------------------
  // What parents see in their portal. attendance is always visible — that's
  // the foundation of the relationship.
  'portal.show_lessons':      'true',
  'portal.show_fees':         'true',
  'portal.allow_profile_edit':'true',

  // ---- Appearance (Phase 4) --------------------------------------------
  // Accent theme + light/dark mode. accent is 'default' (stock indigo), a
  // preset id (e.g. 'emerald'), or a custom '#rrggbb'. Applied client-side
  // via utils/theme.js — also cached in localStorage for instant boot.
  'appearance.accent': 'default',
  'appearance.mode':   'light',

  // ---- Onboarding (first-login welcome tour) ---------------------------
  // 'true' only on a brand-new org (stamped at signup — see lib/onboarding.js);
  // the client clears it to 'false' the moment the owner dismisses the tour.
  // Existing orgs have no row → defaults to 'false' → tour never shows.
  'onboarding.admin_pending': 'false',

  // ---- Schedule / working hours (Phase 5) ------------------------------
  // Per-day availability windows that bound the Classes timetable grid and
  // shade out non-working hours. JSON array of 7 entries, index 0 = Sunday:
  //   [{ "open": true, "start": "HH:MM", "end": "HH:MM" }, ...]
  // Empty by default — the client falls back to all days open 08:00–20:00
  // (utils/workingHours.js). Fits comfortably in setting_value (Text 4000).
  'schedule.working_hours': '',
};

const APP_SETTINGS_KEYS = Object.keys(APP_SETTINGS_DEFAULTS);

// Read every AppSettings row, fold into a flat object keyed by setting name.
// Missing keys are filled from APP_SETTINGS_DEFAULTS so the caller always
// gets a complete map.
async function loadAppSettings(req) {
  // Same orgId precondition as loadTemplates — callers without org context
  // (e.g. cron driver before it picks an org) get defaults.
  if (!req.orgId) return { ...APP_SETTINGS_DEFAULTS };
  let rows;
  try {
    rows = await zcql(req, `SELECT * FROM ${APP_TABLE} WHERE ${APP_TABLE}.org_id = ${Number(req.orgId)}`);
  } catch (e) {
    console.error('AppSettings unavailable; using defaults.', e.message);
    return { ...APP_SETTINGS_DEFAULTS };
  }
  const all = unwrap(rows, APP_TABLE).map(normalize);
  const byKey = new Map(all.map((r) => [r[APP_KEY_COL], r[APP_VAL_COL]]));
  const out = {};
  for (const k of APP_SETTINGS_KEYS) {
    out[k] = byKey.has(k) ? byKey.get(k) : APP_SETTINGS_DEFAULTS[k];
  }

  // School identity falls back to the org's own name when not explicitly set,
  // so a brand-new academy shows ITS name everywhere (messages, signatures,
  // templates) instead of a hard-coded one. signature defaults to name.
  if (!String(out['school.name'] || '').trim()) {
    const orgName = await resolveOrgName(req);
    if (orgName) out['school.name'] = orgName;
  }
  if (!String(out['school.signature'] || '').trim()) {
    out['school.signature'] = out['school.name'] || '';
  }
  return out;
}

// Look up the calling org's display name. Cached on req so repeated
// loadAppSettings() calls in one request hit the DB once. Uses a lossy ROWID
// match (Number === Number) to dodge the Catalyst ROWID-precision gotcha —
// see HANDOFF.md "Critical gotchas #1".
async function resolveOrgName(req) {
  if (!req.orgId) return '';
  if (req._orgNameCache !== undefined) return req._orgNameCache;
  let name = '';
  try {
    const rows = await zcql(req, `SELECT name, ROWID FROM Organizations`);
    const orgs = unwrap(rows, 'Organizations').map(normalize);
    const match = orgs.find((o) => Number(o.ROWID ?? o.id) === Number(req.orgId));
    name = match?.name || '';
  } catch { /* table may be missing in un-bootstrapped envs */ }
  req._orgNameCache = name;
  return name;
}

// Build the plan/entitlement block the client uses to lock premium modules
// and surface plan limits (student cap, trial countdown). plan is the
// EFFECTIVE plan (an expired trial reads as 'free') — see middleware/org.js.
async function entitlementBlock(req) {
  const plan = normalizePlan(req.orgPlan);
  const entitlements = {};
  for (const k of PREMIUM_MODULES) entitlements[k] = isModuleEntitled(plan, k);

  // Active-student usage so the client can show "2 / 2 students" and gate the
  // Add-student button before the server rejects it.
  let studentCount = null;
  try {
    if (req.orgId) {
      const rows = await zcql(
        req,
        `SELECT COUNT(ROWID) AS total FROM Students WHERE Students.org_id = ${Number(req.orgId)} AND Students.status = 'active'`
      );
      studentCount = rows[0]?.Students?.total ?? null;
    }
  } catch { /* non-fatal — leave null */ }

  return {
    plan,
    planRaw: req.orgPlanRaw || plan,
    premiumModules: PREMIUM_MODULES,
    entitlements,
    maxStudents: req.orgMaxStudents ?? null, // null = unlimited
    studentCount,
    trial: req.orgTrial || null,
  };
}

// GET /api/settings/app
// Returns { settings: { 'school.name': ... }, plan, premiumModules, entitlements }.
// `entitlements` tells the client which premium modules this plan unlocks, so
// the UI can show locked ("Upgrade to Complete") rows.
router.get('/app', async (req, res) => {
  try {
    const settings = await loadAppSettings(req);
    res.json({ settings, ...(await entitlementBlock(req)) });
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

    let rows;
    try {
      rows = await zcql(req, `SELECT * FROM ${APP_TABLE} WHERE ${APP_TABLE}.org_id = ${Number(req.orgId)}`);
    } catch (e) {
      return res.status(503).json({
        error: 'AppSettings table not available',
        detail: 'Create the AppSettings table in Catalyst console (setting_key Text 100 unique, setting_value Text 4000, org_id Bigint).',
      });
    }
    const existing = unwrap(rows, APP_TABLE).map(normalize);
    const byKey = new Map(existing.map((r) => [r[APP_KEY_COL], r]));

    const plan = normalizePlan(req.orgPlan);

    let upserted = 0;
    for (const key of APP_SETTINGS_KEYS) {
      if (incoming[key] === undefined) continue;
      let value = incoming[key] === null ? '' : String(incoming[key]);

      // Entitlement guard: an academy can never ENABLE a premium module its
      // plan doesn't include. Coerce such a toggle back to 'false' so a Core
      // org can't unlock Complete features by PUTing the flag directly.
      if (key.startsWith('modules.') && value === 'true') {
        const mod = key.slice('modules.'.length);
        if (PREMIUM_MODULES.includes(mod) && !isModuleEntitled(plan, mod)) {
          value = 'false';
        }
      }
      const row = byKey.get(key);
      try {
        if (row) {
          if (row[APP_VAL_COL] !== value) {
            await update(req, APP_TABLE, row.id, { [APP_VAL_COL]: value });
            upserted++;
          }
        } else {
          await insert(req, APP_TABLE, {
            [APP_KEY_COL]: key,
            [APP_VAL_COL]: value,
            org_id: Number(req.orgId),
          });
          upserted++;
        }
      } catch (err) {
        console.error('app setting upsert failed for', key, err.message);
      }
    }

    const settings = await loadAppSettings(req);
    res.json({ upserted, settings, ...(await entitlementBlock(req)) });
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
