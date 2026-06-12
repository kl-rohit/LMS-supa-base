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

const { appFor, update } = require('../db/catalystDb');
const { resizeAndCompress } = require('./image');

const PHOTO_BUCKET = 'student-photos-profile';

// Validation thresholds
const MAX_RAW_BYTES = 8 * 1024 * 1024;    // 8 MB before resize — parents
                                          // sometimes pick straight-out-of-camera shots
const SIGNED_URL_TTL_SECS = '3600';       // 1 hour — just for the immediate preview

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

  const bucket = appFor(req).stratus().bucket(PHOTO_BUCKET);
  await bucket.putObject(objectKey, processed, {
    contentType: 'image/jpeg',
    overwrite: true,
  });

  let signedUrl = '';
  try {
    const r = await bucket.generatePreSignedUrl(objectKey, 'GET', { expiryIn: SIGNED_URL_TTL_SECS });
    signedUrl = r?.signature || '';
  } catch (err) {
    console.error('generatePreSignedUrl failed', err.message);
  }

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
  const bucket = appFor(req).stratus().bucket(PHOTO_BUCKET);
  try {
    const r = await bucket.generatePreSignedUrl(key, 'GET', { expiryIn: SIGNED_URL_TTL_SECS });
    return r?.signature || '';
  } catch (err) {
    console.error('signStoredPhoto failed for', key, err.message);
    return '';
  }
}

module.exports = {
  PHOTO_BUCKET,
  uploadStudentPhoto,
  signStoredPhoto,
};
