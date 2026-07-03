// Per-academy certificate assets (logo + signature image).
//
// Mirrors lib/photoUpload.js but scopes objects to the ORG rather than a
// student, so each academy gets one logo and one signature graphic. Objects
// live in the same Stratus bucket under flat keys:
//   org-<orgId>-logo.jpg
//   org-<orgId>-signature.jpg
//
// The object KEY is stored in AppSettings (certificate.logo_key /
// certificate.signature_key); URLs are signed on demand. For certificate PDF
// generation we also expose loadAssetDataUrl(), which streams the object back
// and returns it as a base64 data URL so the client can embed it without
// hitting a cross-origin fetch on the signed Stratus URL.

const { resizeAndCompress } = require('./image');
const storage = require('./supabaseStorage');
const config = require('../config');

const BUCKET = config.PHOTO_BUCKET;
const MAX_RAW_BYTES = config.PHOTO_MAX_RAW_BYTES;
const TTL = String(config.PHOTO_SIGNED_URL_TTL || '3600');

// 'logo' / 'signature' back the certificate; 'fee_qr' is the academy's
// payment QR image shown to parents on the portal Fees tab.
const KINDS = ['logo', 'signature', 'fee_qr'];

function assetKey(orgId, kind) {
  return `org-${Number(orgId)}-${kind}.jpg`;
}

// Validate + resize a base64 image and store it as the org's logo/signature.
// Returns { status, json } in the same shape as photoUpload for easy routing.
async function uploadOrgAsset(req, kind, body) {
  if (!KINDS.includes(kind)) {
    return { status: 400, json: { error: 'Unknown asset type' } };
  }
  const { data } = body || {};
  if (!data || typeof data !== 'string') {
    return { status: 400, json: { error: 'data (base64 image) is required' } };
  }
  const m = data.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  const b64 = m ? m[2] : data;

  let raw;
  try {
    raw = Buffer.from(b64, 'base64');
  } catch (e) {
    return { status: 400, json: { error: 'Invalid base64 payload' } };
  }
  if (raw.length === 0) return { status: 400, json: { error: 'Empty image payload' } };
  if (raw.length > MAX_RAW_BYTES) {
    return { status: 413, json: { error: 'Image must be 8MB or smaller before upload' } };
  }

  let processed;
  try {
    processed = await resizeAndCompress(raw);
  } catch (e) {
    return { status: 422, json: { error: 'Could not process image (corrupt or unsupported format)', detail: e.message } };
  }

  const key = assetKey(req.orgId, kind);
  await storage.putObject(key, processed, 'image/jpeg');
  const signedUrl = await storage.signedUrl(key, TTL);

  return { status: 200, json: { object_key: key, url: signedUrl } };
}

// Remove the stored object (best-effort). Used when an academy clears its logo.
async function deleteOrgAsset(req, kind) {
  if (!KINDS.includes(kind)) return false;
  return storage.removeObject(assetKey(req.orgId, kind));
}

// Stream a stored asset back as a base64 data URL (for PDF embedding). Returns
// '' when the key is empty / object missing — caller renders without it.
async function loadAssetDataUrl(req, key) {
  const k = String(key || '').trim();
  if (!k || k.startsWith('http')) return '';
  const buf = await storage.downloadBuffer(k);
  if (buf && buf.length) return `data:image/jpeg;base64,${buf.toString('base64')}`;
  return '';
}

module.exports = { uploadOrgAsset, deleteOrgAsset, loadAssetDataUrl, assetKey };
