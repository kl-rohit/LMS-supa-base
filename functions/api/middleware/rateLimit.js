// Anti-hammer rate limiter.
//
// Policy (per the product owner's choice): ~100 requests/minute per client IP.
// Exceed it and the client is blocked with HTTP 429 for a 5-minute cool-off.
// This is a coarse abuse guard, not a fine-grained quota — normal human use of
// the app (a dashboard screen fires a handful of calls) stays well under 100/min.
//
// EXEMPT (never throttled): health probes, unattended cron (/api/internal), and
// bulk import / export flows (/api/import, /api/migration, any path with
// "export", or a request that carries the X-Bulk-Op header) — so a large import
// or a data export is never cut off mid-way.
//
// State is in-memory and per-instance. On a warm Catalyst/AppSail process this
// is shared across requests; if the host scales to multiple instances each keeps
// its own counters (effective limit scales with instance count). That is fine
// for basic hammering protection on this deployment size.

const WINDOW_MS = 60 * 1000;   // rolling 1-minute window
const MAX = 100;               // requests allowed per window
const BLOCK_MS = 5 * 60 * 1000; // cool-off once tripped

const buckets = new Map(); // ip -> { start, count, blockedUntil }
let lastSweep = 0;

function sweep(now) {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  for (const [k, b] of buckets) {
    if ((b.blockedUntil || 0) < now && now - b.start > WINDOW_MS) buckets.delete(k);
  }
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function isExempt(req) {
  if (req.method === 'OPTIONS') return true;            // CORS preflight
  if (req.headers['x-bulk-op']) return true;            // client-marked bulk loop
  const p = req.path || req.url || '';
  if (p === '/') return true;
  if (/^\/api\/(health|internal|import|migration)\b/.test(p)) return true;
  if (/export/i.test(p)) return true;                   // any export endpoint
  return false;
}

module.exports = function rateLimit(req, res, next) {
  try {
    if (isExempt(req)) return next();
    const now = Date.now();
    sweep(now);
    const ip = clientIp(req);
    let b = buckets.get(ip);
    if (!b) { b = { start: now, count: 0, blockedUntil: 0 }; buckets.set(ip, b); }

    if (b.blockedUntil > now) {
      res.set('Retry-After', String(Math.ceil((b.blockedUntil - now) / 1000)));
      return res.status(429).json({ error: 'rate_limited', message: 'Too many requests in a short time. Please wait a few minutes and try again.' });
    }
    if (now - b.start > WINDOW_MS) { b.start = now; b.count = 0; }
    b.count += 1;
    if (b.count > MAX) {
      b.blockedUntil = now + BLOCK_MS;
      res.set('Retry-After', String(Math.ceil(BLOCK_MS / 1000)));
      return res.status(429).json({ error: 'rate_limited', message: 'Too many requests. Please wait 5 minutes and try again.' });
    }
    return next();
  } catch {
    return next(); // never let the limiter itself break a request
  }
};
