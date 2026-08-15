// lib/mailer.js — minimal transactional email via the Resend HTTP API.
//
// Deliberately dependency-free (uses Node 18+ global fetch) and SAFE-BY-DEFAULT:
// if RESEND_API_KEY is not set it simply no-ops, so shipping this never breaks
// anything — email just starts flowing once the key is added to
// catalyst-config.json. Works TODAY with a free Resend key and the shared
// sender `onboarding@resend.dev` (delivers to your own verified inbox); set
// LEADS_FROM_EMAIL to a branded address once your domain is verified in Resend.
//
// Config (all via env / catalyst-config.json):
//   RESEND_API_KEY     — Resend API key. Absent → email disabled (no error).
//   LEADS_NOTIFY_EMAIL — where new-lead alerts go. Default: config.SUPPORT_EMAIL.
//   LEADS_FROM_EMAIL   — From header. Default: "<brand> <onboarding@resend.dev>".

const config = require('../config');

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function cfg(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === null || v === '' ? fallback : v;
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Low-level send. Never throws; resolves a small result object so callers can
// log the outcome without try/catch. `skipped` when email is not configured.
async function sendEmail({ to, subject, html, text, replyTo }) {
  const key = cfg('RESEND_API_KEY', '');
  if (!key) return { ok: false, skipped: 'RESEND_API_KEY not set' };
  if (!to) return { ok: false, skipped: 'no recipient' };
  const from = cfg('LEADS_FROM_EMAIL', `${config.BRAND_NAME || 'VidyaSetu'} <onboarding@resend.dev>`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000); // never hang a request
  try {
    const resp = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      return { ok: false, error: `Resend ${resp.status}: ${detail.slice(0, 300)}` };
    }
    const data = await resp.json().catch(() => ({}));
    return { ok: true, id: data && data.id };
  } catch (e) {
    return { ok: false, error: e && e.name === 'AbortError' ? 'timeout' : (e && e.message) || 'send failed' };
  } finally {
    clearTimeout(timer);
  }
}

// Notify the platform admin of a new demo/contact request. Best-effort — the
// caller should not let its result affect the form response. reply_to is set to
// the lead's own email so the owner can reply straight from their inbox.
async function notifyNewLead(lead) {
  const to = cfg('LEADS_NOTIFY_EMAIL', config.SUPPORT_EMAIL);
  const L = lead || {};
  const subject = `New demo request: ${L.name || 'someone'}${L.academy_name ? ' · ' + L.academy_name : ''}`;

  const row = (label, v) => (v
    ? `<tr><td style="padding:5px 16px 5px 0;color:#64748b;font-size:13px;white-space:nowrap;vertical-align:top;">${esc(label)}</td><td style="padding:5px 0;font-size:14px;font-weight:600;color:#0f172a;">${esc(v)}</td></tr>`
    : '');
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;">
      <h2 style="font-size:18px;color:#0f172a;margin:0 0 4px;">New demo request</h2>
      <p style="color:#64748b;font-size:13px;margin:0 0 16px;">Someone submitted the contact form on your site.</p>
      <table style="border-collapse:collapse;width:100%;">
        ${row('Name', L.name)}
        ${row('Phone', L.phone)}
        ${row('Email', L.email)}
        ${row('Academy type', L.academy_type)}
        ${row('Academy name', L.academy_name)}
        ${row('Students', L.student_count)}
        ${row('City', L.city)}
        ${L.message ? `<tr><td style="padding:5px 16px 5px 0;color:#64748b;font-size:13px;vertical-align:top;">Message</td><td style="padding:5px 0;font-size:14px;color:#0f172a;white-space:pre-wrap;">${esc(L.message)}</td></tr>` : ''}
      </table>
      <p style="color:#94a3b8;font-size:12px;margin:18px 0 0;">Reply to this email to respond to ${esc(L.name || 'them')} directly. Full list under Platform Admin &rarr; Requests.</p>
    </div>`;
  const text = [
    'New demo request',
    L.name && `Name: ${L.name}`,
    L.phone && `Phone: ${L.phone}`,
    L.email && `Email: ${L.email}`,
    L.academy_type && `Academy type: ${L.academy_type}`,
    L.academy_name && `Academy name: ${L.academy_name}`,
    L.student_count && `Students: ${L.student_count}`,
    L.city && `City: ${L.city}`,
    L.message && `Message: ${L.message}`,
  ].filter(Boolean).join('\n');

  return sendEmail({ to, subject, html, text, replyTo: L.email });
}

module.exports = { sendEmail, notifyNewLead };
