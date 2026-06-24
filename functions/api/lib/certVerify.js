// Certificate verification codes.
//
// A certificate id is "CERT-<orgId>-<courseId>-<studentId>" — fully derivable
// from sequential ROWIDs, so on its own it's guessable. To make the public
// /api/verify page meaningful we attach a short HMAC "code": only someone with
// a genuinely issued certificate (which prints the code into its QR link) can
// present a matching pair. The secret never leaves the server.
//
// SECRET SOURCING: CERT_SECRET (preferred) or CRON_SECRET, both read from
// process.env (set in functions/api/catalyst-config.json, gitignored). If
// neither is set the code falls back to a constant so the feature still works
// in a fresh checkout, just without forgery resistance — set CERT_SECRET in
// production.

const crypto = require('crypto');

function secret() {
  return process.env.CERT_SECRET || process.env.CRON_SECRET || 'veena-cert-dev-secret';
}

// 10-hex-char code derived from the certificate's identity triple.
function codeFor(orgId, courseId, studentId) {
  return crypto
    .createHmac('sha256', secret())
    .update(`${Number(orgId)}:${Number(courseId)}:${Number(studentId)}`)
    .digest('hex')
    .slice(0, 10);
}

// Parse "CERT-1-23-456" → { orgId, courseId, studentId } or null.
function parseCertId(certId) {
  const m = String(certId || '').match(/^CERT-(\d+)-(\d+)-(\d+)$/);
  if (!m) return null;
  return { orgId: Number(m[1]), courseId: Number(m[2]), studentId: Number(m[3]) };
}

// Constant-time compare of a presented code against the expected one.
function codeMatches(orgId, courseId, studentId, presented) {
  const expected = codeFor(orgId, courseId, studentId);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(presented || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { codeFor, parseCertId, codeMatches };
