// /api/settings — generic key/value store backed by the Catalyst Settings
// table. Today it powers customizable message templates; future settings
// (school name, signature, working hours, etc.) would live here too.
//
// Table schema (manage in Catalyst console):
//   Settings { key (Text, unique), value (Text — long) }
//
// Templates are stored as rows keyed `template_<type>` so they live in the
// same flat table as any other setting. Templates support these placeholders
// (substituted at send time — see messages.js + Messages.jsx):
//   {name}    student name
//   {parent}  parent name
//   {amount}  total monthly fee (auto-fee-reminder only)
//   {month}   month name (e.g. "March")
//   {year}    year (e.g. 2026)
//   {count}   consecutive absences (auto-absence-alert only)
//   {class_fees}, {additional_fees}  fee breakdown components

const router = require('express').Router();
const { insert, update, zcql, unwrap, normalize } = require('../db/catalystDb');

// Default templates. These match the wording that was hard-coded in
// messages.js + Messages.jsx before this feature shipped — so an empty
// Settings table behaves identically to the pre-templates version.
const DEFAULT_TEMPLATES = {
  absence_alert:
    `Dear {parent},\n\nThis is to inform you that {name} has been absent for the last {count} consecutive classes. Kindly ensure regular attendance for better progress.\n\nPlease reach out if there are any concerns.\n\nRegards,\nVeena Dhwani Academy`,
  fee_reminder:
    `Dear {parent},\n\nThis is a gentle reminder regarding the {month} {year} fee payment for {name}.\n\nFees for {name} — {month} {year}: ₹{amount}\n  • Class fees: ₹{class_fees}\n  • Additional: ₹{additional_fees}\n\nKindly do the needful. Thank you.\n\nVeena Dhwani Academy`,
  class_update:
    `Dear {parent},\n\nThis is to inform you about an update regarding {name}'s music class schedule. Please check with us for the revised timings.\n\nRegards,\nVeena Dhwani Academy`,
  thank_you:
    `Dear {parent},\n\nThank you for your continued support and for ensuring {name}'s regular attendance at Veena Dhwani Academy. We truly appreciate it.\n\nRegards,\nVeena Dhwani Academy`,
  holiday_notice:
    `Dear {parent},\n\nThis is to inform you that Veena Dhwani Academy will remain closed on account of the upcoming holiday. {name}'s classes will resume as per the regular schedule after the break.\n\nRegards,\nVeena Dhwani Academy`,
};

const TEMPLATE_KEYS = Object.keys(DEFAULT_TEMPLATES);
const ROW_KEY = (type) => `template_${type}`;

// Fetch all template rows in one query and return a complete templates map
// (default-padded). Shared by the GET route and any other module that wants
// templates server-side (messages.js).
async function loadTemplates(req) {
  const rows = await zcql(req, `SELECT * FROM Settings`);
  const all = unwrap(rows, 'Settings').map(normalize);
  const byKey = new Map(all.map((r) => [r.key, r.value]));
  const out = {};
  for (const t of TEMPLATE_KEYS) {
    out[t] = byKey.has(ROW_KEY(t)) ? byKey.get(ROW_KEY(t)) : DEFAULT_TEMPLATES[t];
  }
  return out;
}

// GET /api/settings/templates
router.get('/templates', async (req, res) => {
  try {
    const templates = await loadTemplates(req);
    res.json({ templates });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load templates', detail: e.message });
  }
});

// PUT /api/settings/templates
// Body: { templates: { absence_alert?, fee_reminder?, class_update?, thank_you?, holiday_notice? } }
// Upserts each provided template into the Settings table (insert if missing,
// update if existing). Ignores unknown keys.
router.put('/templates', async (req, res) => {
  try {
    const incoming = req.body?.templates || {};
    // Index existing rows by key so we know whether to insert or update.
    const rows = await zcql(req, `SELECT * FROM Settings`);
    const existing = unwrap(rows, 'Settings').map(normalize);
    const byKey = new Map(existing.map((r) => [r.key, r]));

    let updated = 0;
    for (const type of TEMPLATE_KEYS) {
      if (incoming[type] === undefined) continue;
      const key = ROW_KEY(type);
      const value = String(incoming[type] ?? '');
      const row = byKey.get(key);
      try {
        if (row) {
          await update(req, 'Settings', row.id, { value });
        } else {
          await insert(req, 'Settings', { key, value });
        }
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

// The Express router is the primary export, but we also attach
// loadTemplates / DEFAULT_TEMPLATES as properties so messages.js can
// reuse the same fetch + defaults without duplicating the schema.
router.loadTemplates    = loadTemplates;
router.DEFAULT_TEMPLATES = DEFAULT_TEMPLATES;
module.exports = router;
