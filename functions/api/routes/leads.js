// /api/leads — PUBLIC contact / "request a demo" capture from the marketing
// landing page. Mounted BEFORE requireAuth in index.js: a prospect filling in
// the contact form has no account yet, so this endpoint takes a small, clamped
// payload and records it for the platform owner to follow up on.
//
// The matching admin views (list + status pipeline) live under
// /api/platform/leads (platform-admin only).
//
// Backed by a Leads table in the Catalyst console; if that table is absent the
// POST degrades gracefully (503 with a clear hint) instead of 500-ing.
//
//   Leads columns (Data Store):
//     name           varchar    prospect name
//     email          varchar    contact email
//     phone          varchar    contact phone
//     academy_type   varchar    Music | Dance | Coaching | Tuition | Arts | Other
//     academy_name   varchar    name of their academy (optional)
//     student_count  varchar    rough size, free-form (optional)
//     city           varchar    city / location (optional)
//     message        varchar    free-form note (optional)
//     source         varchar    where the lead came from, e.g. "landing"
//     status         varchar    new | called | signed_up | invited | trial | won | lost
//     notes          varchar    internal follow-up notes (owner-only)

const router = require('express').Router();
const { insert } = require('../db/catalystDb');

const ACADEMY_TYPES = ['Music', 'Dance', 'Coaching', 'Tuition', 'Arts', 'Other'];

// Trim + cap a free-form string field.
const clamp = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

// Loose email shape check — we are not authenticating, only sanity-checking so
// the owner gets a usable address. Empty is rejected; exotic-but-valid passes.
const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

// Best-effort per-IP rate limit (warm-container only; resets on cold start).
// Slows a bot hammering the public form. Not a hard security boundary.
const RL = new Map(); // ip -> [timestamps within the window]
const RL_MAX = 5;
const RL_WINDOW_MS = 10 * 60 * 1000;
function rateLimited(req) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
  const now = Date.now();
  const hits = (RL.get(ip) || []).filter((t) => now - t < RL_WINDOW_MS);
  hits.push(now);
  RL.set(ip, hits);
  return hits.length > RL_MAX;
}

router.post('/', async (req, res) => {
  try {
    // ---- Spam guards (run before any work) ----
    // Honeypot: the hidden "company" field is invisible to people; a bot that
    // fills it gets a fake success and nothing is stored.
    if (clamp(req.body.company, 200)) return res.json({ ok: true, id: null });
    // Time trap: humans take a few seconds; bots submit instantly. Quietly drop
    // anything submitted under 2 seconds after the form loaded.
    const elapsed = Number(req.body.elapsed_ms);
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 2000) {
      return res.json({ ok: true, id: null });
    }
    // Per-IP rate limit.
    if (rateLimited(req)) {
      return res.status(429).json({ error: 'Too many requests. Please try again in a few minutes.' });
    }

    const name  = clamp(req.body.name, 120);
    const email = clamp(req.body.email, 160).toLowerCase();
    const phone = clamp(req.body.phone, 40);

    if (!name)  return res.status(400).json({ error: 'Please share your name.' });
    if (!email) return res.status(400).json({ error: 'Please share your email.' });
    if (!phone) return res.status(400).json({ error: 'Please share your phone number.' });
    if (!looksLikeEmail(email)) {
      return res.status(400).json({ error: 'That email does not look right — please check it.' });
    }

    let academy_type = clamp(req.body.academy_type, 40);
    if (academy_type && !ACADEMY_TYPES.includes(academy_type)) academy_type = 'Other';

    const academy_name  = clamp(req.body.academy_name, 160);
    const student_count = clamp(req.body.student_count, 40);
    const city          = clamp(req.body.city, 80);
    const message       = clamp(req.body.message, 1000);

    let row;
    try {
      row = await insert(req, 'Leads', {
        name, email, phone,
        academy_type, academy_name, student_count, city, message,
        source: 'landing',
        status: 'new',
        notes: '',
      });
    } catch (e) {
      return res.status(503).json({
        error: 'Leads table not set up',
        hint: 'Create a Leads table in the Catalyst console (Data Store) with columns name, email, phone, academy_type, academy_name, student_count, city, message, source, status, notes.',
        detail: e.message,
      });
    }

    // Return only an acknowledgement — never echo the stored row to a public caller.
    res.json({ ok: true, id: row && row.ROWID ? String(row.ROWID) : null });
  } catch (e) {
    res.status(500).json({ error: 'Could not submit your request. Please try again.', detail: e.message });
  }
});

module.exports = router;
