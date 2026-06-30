#!/usr/bin/env node
// =============================================================================
// scripts/sync-pricing.js
// =============================================================================
// Pulls the pricing / feature-plan overrides the owner saved in the Platform
// Admin "Plans" editor from the LIVE app, and writes them to
// pricing.overrides.json at the repo root. config.master.js merges that file
// over its defaults, so the next gen-config + build bakes the owner's settings
// into BOTH the in-app gating and the public pricing page.
//
// Runs as the first step of deploy.sh. It is intentionally NON-FATAL: if the
// app is unreachable, the secret is missing, or nothing has been saved, it logs
// and exits 0 so the deploy proceeds with the committed defaults.
//
// Auth: reuses the cron shared secret (CRON_SECRET) to read the guarded
// /api/internal/pricing-export endpoint, so no user login is needed on the
// deploy machine. Override the target with SYNC_BASE_URL=... if needed.
// =============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'pricing.overrides.json');
const BASE = (process.env.SYNC_BASE_URL
  || 'https://veena-attendance-60070745325.development.catalystserverless.in').replace(/\/$/, '');
const ENDPOINT = `${BASE}/server/api/api/internal/pricing-export`;

function log(msg) { console.log('  ' + msg); }

function readSecret() {
  if (process.env.CRON_SECRET) return process.env.CRON_SECRET;
  try {
    const raw = fs.readFileSync(path.join(ROOT, 'functions/api/catalyst-config.json'), 'utf8');
    const m = raw.match(/"CRON_SECRET"\s*:\s*"([^"]+)"/);
    return m ? m[1] : null;
  } catch (e) { return null; }
}

(async () => {
  const secret = readSecret();
  if (!secret) { log('= sync-pricing: no CRON_SECRET found — using committed defaults'); return; }
  if (typeof fetch !== 'function') { log('= sync-pricing: fetch unavailable (Node < 18) — skipping'); return; }
  try {
    const res = await fetch(ENDPOINT, { headers: { 'X-Cron-Secret': secret } });
    if (!res.ok) { log(`= sync-pricing: export returned ${res.status} — using committed defaults`); return; }
    const data = await res.json();
    const overrides = (data && data.overrides && typeof data.overrides === 'object') ? data.overrides : {};
    const hasAny = overrides && (overrides.prices || overrides.features) && Object.keys(overrides).length > 0;
    if (!hasAny) {
      if (fs.existsSync(OUT)) fs.unlinkSync(OUT);
      log('= sync-pricing: no overrides saved — using config defaults');
      return;
    }
    fs.writeFileSync(OUT, JSON.stringify(overrides, null, 2) + '\n');
    log('✓ sync-pricing: wrote pricing.overrides.json from the live Plans editor');
  } catch (e) {
    log(`= sync-pricing: could not reach the app (${e.message}) — using committed defaults`);
  }
})();
