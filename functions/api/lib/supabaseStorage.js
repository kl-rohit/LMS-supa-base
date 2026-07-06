// Supabase Storage helper (replaces Zoho Stratus).
//
// One private bucket holds student photos (student-<id>.jpg), org assets
// (org-<id>-logo.jpg / -signature.jpg / -fee_qr.jpg) and per-org JSON backups.
// The object KEY is stored in the DB; URLs are signed on demand. Uses the
// service-role client so it bypasses Storage RLS (server-side only).

const { admin } = require('./supabaseAuth');
const config = require('../config');

const BUCKET = process.env.SUPABASE_BUCKET || config.PHOTO_BUCKET || 'assets';

// Create the bucket if missing (idempotent). Private — access is via signed URLs.
async function ensureBucket() {
  try {
    const { data } = await admin.storage.getBucket(BUCKET);
    if (data) return;
  } catch { /* not found — fall through to create */ }
  const { error } = await admin.storage.createBucket(BUCKET, { public: false });
  if (error && !/exist/i.test(error.message)) throw new Error(error.message);
}

async function putObject(key, buffer, contentType = 'application/octet-stream') {
  const { error } = await admin.storage.from(BUCKET).upload(key, buffer, {
    contentType,
    upsert: true, // overwrite — one object per student/org/backup key
  });
  if (error) throw new Error(error.message);
  return key;
}

// Short-lived signed GET URL for display. Returns '' on error (caller degrades).
async function signedUrl(key, expiresIn = 3600) {
  try {
    const { data, error } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(key, Number(expiresIn) || 3600);
    if (error) return '';
    return data?.signedUrl || '';
  } catch {
    return '';
  }
}

async function removeObject(key) {
  try {
    await admin.storage.from(BUCKET).remove([key]);
    return true;
  } catch {
    return false;
  }
}

// List object keys directly under a folder prefix (e.g. 'backups'). Returns
// full keys (prefix + name). Non-recursive — Supabase returns direct children.
async function listObjects(prefix = '') {
  const { data, error } = await admin.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error || !data) return [];
  return data
    .filter((o) => o && o.name && o.id) // drop pseudo-folder entries (id null)
    .map((o) => (prefix ? `${prefix}/${o.name}` : o.name));
}

// Remove many objects in one call. Best-effort; returns true on success.
async function removeObjects(keys) {
  if (!keys || !keys.length) return true;
  try {
    await admin.storage.from(BUCKET).remove(keys);
    return true;
  } catch {
    return false;
  }
}

// Download an object as a Buffer (for certificate PDF embedding / backups read).
async function downloadBuffer(key) {
  try {
    const { data, error } = await admin.storage.from(BUCKET).download(key);
    if (error || !data) return null;
    const ab = await data.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

module.exports = { BUCKET, ensureBucket, putObject, signedUrl, removeObject, removeObjects, listObjects, downloadBuffer };
