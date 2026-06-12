// /api/settings — Settings-related routes. Today only message templates
// live here; the broader Settings module (school name, signature, working
// hours, etc.) will mount additional sub-routes on this same prefix later.
//
// Templates are stored in a dedicated Catalyst Data Store table so they
// don't get tangled with future generic key/value settings:
//
//   MessageTemplates { type (Text, unique), body (Multi-line Text) }
//
// Each row's `type` is the template key (absence_alert, fee_reminder,
// class_update, thank_you, holiday_notice) and `body` is the template
// text. Templates support these placeholders (substituted at send time —
// see messages.js + Messages.jsx):
//
//   {name}    student name
//   {parent}  parent name
//   {amount}  total monthly fee   (auto-fee-reminder only)
//   {month}   month name (e.g. "March")
//   {year}    year (e.g. 2026)
//   {count}   consecutive absences (auto-absence-alert only)
//   {class_fees}, {additional_fees}  fee breakdown components

const router = require('express').Router();
const { insert, update, zcql, unwrap, normalize } = require('../db/catalystDb');

const TABLE = 'MessageTemplates';

// Default templates. These match the wording that was hard-coded in
// messages.js + Messages.jsx before this feature shipped — so an empty
// MessageTemplates table behaves identically to the pre-templates version.
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

const TEMPLATE_TYPES = Object.keys(DEFAULT_TEMPLATES);

// Fetch all template rows in one query and return a complete templates map
// (default-padded). Shared by the GET route and any other module that wants
// templates server-side (messages.js).
async function loadTemplates(req) {
  const rows = await zcql(req, `SELECT * FROM ${TABLE}`);
  const all = unwrap(rows, TABLE).map(normalize);
  const byType = new Map(all.map((r) => [r.type, r.body]));
  const out = {};
  for (const t of TEMPLATE_TYPES) {
    out[t] = byType.has(t) ? byType.get(t) : DEFAULT_TEMPLATES[t];
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
// Upserts each provided template into MessageTemplates (insert if missing,
// update if existing). Ignores unknown keys.
router.put('/templates', async (req, res) => {
  try {
    const incoming = req.body?.templates || {};
    // Index existing rows by type so we know whether to insert or update.
    const rows = await zcql(req, `SELECT * FROM ${TABLE}`);
    const existing = unwrap(rows, TABLE).map(normalize);
    const byType = new Map(existing.map((r) => [r.type, r]));

    let updated = 0;
    for (const type of TEMPLATE_TYPES) {
      if (incoming[type] === undefined) continue;
      const body = String(incoming[type] ?? '');
      const row = byType.get(type);
      try {
        if (row) {
          await update(req, TABLE, row.id, { body });
        } else {
          await insert(req, TABLE, { type, body });
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
