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
//   {class_name}, {time}, {link}     online_meeting only (class title, time, join URL)
//   {school}                  school.name from AppSettings (fallback below)
//   {signature}               school.signature from AppSettings (fallback below)

const router = require('express').Router();
const { insert, update, zcql, unwrap, normalize, readCount } = require('../db/catalystDb');
const { normalizePlan, PREMIUM_MODULES, isModuleEntitled } = require('../lib/plans');
const { uploadOrgAsset, deleteOrgAsset } = require('../lib/orgAsset');
const { requireFeature } = require('../middleware/entitlement');

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
  online_meeting:
    `Dear {parent},\n\nThe online class "{class_name}" for {name} is ready to join {time}.\n\nJoin link: {link}\n\nRegards,\n{signature}`,
};

const TEMPLATE_TYPES = Object.keys(DEFAULT_TEMPLATES);

// Short-TTL cache for the folded templates map, keyed by org. Same rationale as
// the AppSettings cache below: templates change rarely but are re-read on every
// message-send and the daily reminder cron, so a brief cache removes those
// repeated reads. Invalidated on PUT /templates.
const TEMPLATES_CACHE_TTL_MS = 30 * 1000;
const templatesCache = new Map(); // orgId → { value, exp }

function templatesCacheGet(orgId) {
  const hit = templatesCache.get(String(orgId));
  if (hit && hit.exp > Date.now()) return hit.value;
  if (hit) templatesCache.delete(String(orgId));
  return undefined;
}
function templatesCacheSet(orgId, value) {
  templatesCache.set(String(orgId), { value, exp: Date.now() + TEMPLATES_CACHE_TTL_MS });
}

async function loadTemplates(req) {
  // req.orgId is set by middleware/org.resolveOrg on tenant routes; the
  // shared cron driver and fee-reminder lib also set it explicitly before
  // calling. Anything calling loadTemplates without orgId returns defaults.
  if (!req.orgId) return { ...DEFAULT_TEMPLATES };

  const cached = templatesCacheGet(req.orgId);
  if (cached) return { ...cached };

  const rows = await zcql(req, `SELECT * FROM ${TEMPLATES_TABLE} WHERE ${TEMPLATES_TABLE}.org_id = ${Number(req.orgId)}`);
  const all = unwrap(rows, TEMPLATES_TABLE).map(normalize);
  const byType = new Map(all.map((r) => [r.type, r.body]));
  const out = {};
  for (const t of TEMPLATE_TYPES) {
    out[t] = byType.has(t) ? byType.get(t) : DEFAULT_TEMPLATES[t];
  }
  templatesCacheSet(req.orgId, out);
  return { ...out };
}

router.get('/templates', async (req, res) => {
  try {
    const templates = await loadTemplates(req);
    res.json({ templates });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load templates', detail: e.message });
  }
});

router.put('/templates', requireFeature('messages.templates'), async (req, res) => {
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

    templatesCache.delete(String(req.orgId)); // serve the just-saved bodies
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

// Short-TTL in-process cache for the folded settings object, keyed by org.
// loadAppSettings() is called on most admin/portal requests (14 call sites,
// some endpoints twice), and each uncached call is an AppSettings SELECT plus
// an Organizations SELECT for the school-name backfill. A new org clicking
// around fires many requests in a few seconds, so a short cache collapses
// almost all of those reads to zero. The cache lives only in the warm function
// container and is invalidated immediately on any settings write, so an edit
// takes effect on the next request (and within the TTL elsewhere).
const APP_SETTINGS_CACHE_TTL_MS = 30 * 1000;
const appSettingsCache = new Map(); // orgId → { value, exp }

function appCacheGet(orgId) {
  const hit = appSettingsCache.get(String(orgId));
  if (hit && hit.exp > Date.now()) return hit.value;
  if (hit) appSettingsCache.delete(String(orgId));
  return undefined;
}
function appCacheSet(orgId, value) {
  appSettingsCache.set(String(orgId), { value, exp: Date.now() + APP_SETTINGS_CACHE_TTL_MS });
}
function invalidateAppSettings(orgId) {
  appSettingsCache.delete(String(orgId));
}

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
  // Fee collection model for the whole academy:
  //   'per_class'  — fee = per-hour rate x duration, summed across attendance
  //                  (the original model; uses the rates above + min_classes).
  //   'per_month'  — fee = each student's flat monthly_fee, independent of how
  //                  many classes they attend (shortfall logic is skipped).
  'billing.fee_mode':            'per_class',
  // Org default flat monthly amount, used to pre-fill new students when the
  // academy bills per month. Empty means "no default".
  'billing.default_monthly_fee': '',
  // Which class modes this academy offers, as a CSV of: online, offline, group.
  // Drives which fee-rate fields appear and which class types can be recorded.
  'billing.class_modes':         'online,offline,group',
  // When the monthly fee-reminder cron drafts this academy's reminders:
  //   'last_day'  — the actual last calendar day of the month (default, works
  //                 for any month length with no configuration needed).
  //   'fixed_day' — a specific day (billing.fee_reminder_day, 1-28 so it
  //                 always exists, even in February).
  'billing.fee_reminder_trigger': 'last_day',
  'billing.fee_reminder_day':     '1',

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

  // ---- Alerts ----------------------------------------------------------
  // How many consecutive absences trigger an attendance alert (banner on the
  // Attendance page + the message the academy can send the parent). Whole
  // number, typically 2, 3 or 4. Stored as a string like every other setting.
  'alerts.absence_threshold': '2',

  // ---- Parent portal visibility (Phase 3) ------------------------------
  // What parents see in their portal. Each is a per-org toggle so an academy
  // can tailor the portal to what it wants families to see.
  'portal.show_lessons':      'true',
  'portal.show_fees':         'true',
  'portal.show_attendance':   'true', // class-history visibility for parents
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
  // 'true' only on a brand-new org (stamped at signup); gates the first-run
  // SETUP WIZARD (class modes, fee model, portal toggles). Defaults to 'false'
  // so existing orgs (no row) never see the wizard. Cleared when the owner
  // finishes or skips setup.
  'onboarding.setup_pending': 'false',

  // ---- Schedule / working hours (Phase 5) ------------------------------
  // Per-day availability windows that bound the Classes timetable grid and
  // shade out non-working hours. JSON array of 7 entries, index 0 = Sunday:
  //   [{ "open": true, "start": "HH:MM", "end": "HH:MM" }, ...]
  // Empty by default — the client falls back to all days open 08:00–20:00
  // (utils/workingHours.js). Fits comfortably in setting_value (Text 4000).
  'schedule.working_hours': '',

  // ---- Certificate customisation (Phase 6) -----------------------------
  // Controls how the completion certificate PDF (utils/certificate.js) is
  // rendered for this academy. All toggles are 'true'/'false' strings. The
  // two *_key fields hold a Stratus object key written by the asset-upload
  // endpoints below (POST /app/certificate-asset) — never a raw URL.
  'certificate.enabled':        'true',  // master switch for the feature
  'certificate.title':          'Certificate of Completion',
  'certificate.body':           'has successfully completed the course',
  'certificate.signatory_name': '',      // printed under the signature line
  'certificate.show_logo':      'true',  // institute logo across the top
  'certificate.show_photo':     'false', // student photo on the certificate
  'certificate.show_signature': 'true',  // signature graphic above signatory
  'certificate.show_seal':      'true',  // gold completion seal
  'certificate.show_footer':    'true',  // academy contact footer line
  'certificate.use_brand_color':'true',  // accent border + title in brand color
  'certificate.verify_enabled': 'true',  // QR + public /verify page link
  'certificate.logo_key':       '',      // Stratus key for the logo image
  'certificate.signature_key':  '',      // Stratus key for the signature image

  // ---- Online classes (Phase 7) ----------------------------------------
  // Manual meeting-link approach (no OAuth). The academy picks which provider
  // it uses for branding/labels, and may set a single default link reused by
  // every online class that has no link of its own. Per-class links live on
  // Classes.meeting_link and take precedence over this default.
  'online.provider':     'gmeet',  // 'gmeet' | 'zoom' | 'zoho_meet'
  'online.default_link': '',       // fallback join link for online classes

  // ---- Fee collection QR (Phase 8) -------------------------------------
  // Static UPI collection per academy (no payment-gateway / OAuth). The
  // portal Fees tab renders a QR a parent can scan: either a UPI deep-link QR
  // built client-side from fees.upi_id (+ fees.payee_name), or an image the
  // academy uploaded (fees.qr_key, a Stratus object key). A short note can be
  // shown alongside (e.g. account holder name or reference instructions).
  'fees.upi_id':      '',   // e.g. academy@okhdfcbank
  'fees.payee_name':  '',   // name shown in the UPI app
  'fees.qr_key':      '',   // Stratus key for an uploaded payment QR image
  'fees.note':        '',   // free-text note shown under the QR
};

const APP_SETTINGS_KEYS = Object.keys(APP_SETTINGS_DEFAULTS);

// Read every AppSettings row, fold into a flat object keyed by setting name.
// Missing keys are filled from APP_SETTINGS_DEFAULTS so the caller always
// gets a complete map.
async function loadAppSettings(req) {
  // Same orgId precondition as loadTemplates — callers without org context
  // (e.g. cron driver before it picks an org) get defaults.
  if (!req.orgId) return { ...APP_SETTINGS_DEFAULTS };

  // Cache hit → hand back a shallow copy so callers can mutate their result
  // without poisoning the shared cached object.
  const cached = appCacheGet(req.orgId);
  if (cached) return { ...cached };

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

  appCacheSet(req.orgId, out);
  return { ...out };
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
      studentCount = readCount(rows, 'Students', 'total');
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

    // Drop the cached snapshot so the reload below (and the next request) sees
    // the values we just wrote rather than a stale copy.
    invalidateAppSettings(req.orgId);
    const settings = await loadAppSettings(req);
    res.json({ upserted, settings, ...(await entitlementBlock(req)) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save app settings', detail: e.message });
  }
});

// =============================================================================
// Certificate assets (logo + signature image)
//
// These live in Stratus (lib/orgAsset.js), NOT in AppSettings — only the
// resulting object KEY is stored back into certificate.logo_key /
// certificate.signature_key so the certificate renderer can stream + embed
// them. Upload writes the image and persists its key in one round-trip.
// =============================================================================

// Upsert a single whitelisted AppSettings key (used by the asset endpoints).
async function setAppSetting(req, key, value) {
  if (!APP_SETTINGS_KEYS.includes(key)) return;
  const rows = await zcql(req, `SELECT * FROM ${APP_TABLE} WHERE ${APP_TABLE}.${APP_KEY_COL} = '${key}' AND ${APP_TABLE}.org_id = ${Number(req.orgId)}`);
  const existing = unwrap(rows, APP_TABLE).map(normalize);
  const row = existing[0];
  const v = value === null || value === undefined ? '' : String(value);
  if (row) {
    if (row[APP_VAL_COL] !== v) await update(req, APP_TABLE, row.id, { [APP_VAL_COL]: v });
  } else {
    await insert(req, APP_TABLE, { [APP_KEY_COL]: key, [APP_VAL_COL]: v, org_id: Number(req.orgId) });
  }
  invalidateAppSettings(req.orgId); // asset-key writes must not serve stale settings
}

// kind → the AppSettings key that stores its object key.
const ASSET_KEY_SETTING = {
  logo: 'certificate.logo_key',
  signature: 'certificate.signature_key',
  fee_qr: 'fees.qr_key',
};

const ASSET_KINDS_MSG = "kind must be 'logo', 'signature', or 'fee_qr'";

// POST /api/settings/app/certificate-asset
// Body: { kind: 'logo'|'signature'|'fee_qr', data: '<base64 or data URL>' }
// Stores the image in Stratus and records its key in AppSettings. Despite the
// route name it also handles the fee-collection QR image (kind 'fee_qr') —
// same upload + key-persist flow, just a different AppSettings key.
router.post('/app/certificate-asset', async (req, res) => {
  try {
    const kind = String(req.body?.kind || '');
    if (!ASSET_KEY_SETTING[kind]) {
      return res.status(400).json({ error: ASSET_KINDS_MSG });
    }
    const { status, json } = await uploadOrgAsset(req, kind, req.body);
    if (status === 200 && json.object_key) {
      try { await setAppSetting(req, ASSET_KEY_SETTING[kind], json.object_key); }
      catch (err) { console.error('persist asset key failed', err.message); }
    }
    res.status(status).json(json);
  } catch (e) {
    res.status(500).json({ error: 'Failed to upload asset', detail: e.message });
  }
});

// DELETE /api/settings/app/certificate-asset?kind=logo
// Removes the stored image and clears its key.
router.delete('/app/certificate-asset', async (req, res) => {
  try {
    const kind = String(req.query?.kind || '');
    if (!ASSET_KEY_SETTING[kind]) {
      return res.status(400).json({ error: ASSET_KINDS_MSG });
    }
    await deleteOrgAsset(req, kind);
    try { await setAppSetting(req, ASSET_KEY_SETTING[kind], ''); }
    catch (err) { console.error('clear asset key failed', err.message); }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to remove asset', detail: e.message });
  }
});

// =============================================================================
// Exports
// =============================================================================

router.loadTemplates        = loadTemplates;
router.DEFAULT_TEMPLATES    = DEFAULT_TEMPLATES;
router.loadAppSettings      = loadAppSettings;
router.APP_SETTINGS_KEYS    = APP_SETTINGS_KEYS;
router.invalidateAppSettings = invalidateAppSettings;
module.exports = router;
