// Shared student-photo upload pipeline. Used by:
//   • POST /api/portal/photo        (parent self-service)
//   • POST /api/students/:id/photo  (admin upload-on-behalf)
//
// Steps:
//   1. Validate base64 payload (size, decode)
//   2. Resize / compress to ≤ 800px JPEG via lib/image
//   3. Upload to the Stratus bucket at student-<id>.jpg (flat, one per student)
//   4. Patch Students.photo_url with the object KEY (not URL — URLs sign on demand)
//   5. Return a short-lived signed URL for the immediate preview render

const { update } = require('../db/catalystDb');
const { resizeAndCompress } = require('./image');
const storage = require('./supabaseStorage');
const config = require('../config');

// Bucket + thresholds come from the master config (functions/api/config.js) so
// a project / data-centre move only touches one file. Still re-exported below
// for callers (e.g. routes/organization.js) that import PHOTO_BUCKET from here.
const PHOTO_BUCKET = config.PHOTO_BUCKET;
const MAX_RAW_BYTES = config.PHOTO_MAX_RAW_BYTES;        // before resize
const SIGNED_URL_TTL_SECS = config.PHOTO_SIGNED_URL_TTL; // string seconds, immediate preview

async function uploadStudentPhoto(req, studentId, body) {
  const { data } = body || {};
  if (!data || typeof data !== 'string') {
    return { status: 400, json: { error: 'data (base64 image) is required' } };
  }

  // Accept both `data:image/...;base64,xxx` and raw base64.
  const m = data.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  const b64 = m ? m[2] : data;

  let rawBuffer;
  try {
    rawBuffer = Buffer.from(b64, 'base64');
  } catch (e) {
    return { status: 400, json: { error: 'Invalid base64 payload' } };
  }
  if (rawBuffer.length === 0) return { status: 400, json: { error: 'Empty image payload' } };
  if (rawBuffer.length > MAX_RAW_BYTES) {
    return { status: 413, json: { error: 'Image must be 8MB or smaller before upload' } };
  }

  // Resize/compress — turns a 4MB phone photo into ~80-150KB.
  let processed;
  try {
    processed = await resizeAndCompress(rawBuffer);
  } catch (e) {
    return { status: 422, json: { error: 'Could not process image (corrupt or unsupported format)', detail: e.message } };
  }

  // Flat key — one object per student. Always JPEG after resize.
  const objectKey = `student-${studentId}.jpg`;

  await storage.putObject(objectKey, processed, 'image/jpeg');

  const signedUrl = await storage.signedUrl(objectKey, SIGNED_URL_TTL_SECS);

  await update(req, 'Students', studentId, { photo_url: objectKey });

  return {
    status: 200,
    json: {
      photo_url: signedUrl,
      object_key: objectKey,
      original_bytes: rawBuffer.length,
      processed_bytes: processed.length,
    },
  };
}

// Re-sign a stored photo key (object_key) for display. Returns '' if the
// row has no photo or the value is a legacy full URL.
async function signStoredPhoto(req, value) {
  const key = String(value || '').trim();
  if (!key) return '';
  if (key.startsWith('http')) return key;               // legacy full URL
  if (key.startsWith('stratus://')) return '';          // legacy bogus fallback
  return storage.signedUrl(key, SIGNED_URL_TTL_SECS);
}

module.exports = {
  PHOTO_BUCKET,
  uploadStudentPhoto,
  signStoredPhoto,
};
