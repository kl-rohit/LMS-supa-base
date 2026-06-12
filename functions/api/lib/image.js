// Lightweight image utilities — sized for our needs (passport-style
// student photos uploaded by parents). Powered by jimp (pure JS, no
// native deps — safe to run inside any Node runtime including Catalyst).

const { Jimp } = require('jimp');

const MAX_DIMENSION = 800;     // max width or height in pixels
const JPEG_QUALITY  = 85;      // 85 is a sweet spot for portraits

/**
 * Decode a Buffer, downscale so neither dimension exceeds MAX_DIMENSION
 * (preserving aspect ratio — upscaling is never performed), re-encode as
 * JPEG. Returns the resulting Buffer.
 *
 * Idempotent on already-small images: jimp won't upscale, so a 400x400
 * input comes back as a 400x400 JPEG.
 */
async function resizeAndCompress(buffer) {
  const img = await Jimp.read(buffer);
  const w = img.bitmap.width;
  const h = img.bitmap.height;
  if (Math.max(w, h) > MAX_DIMENSION) {
    if (w >= h) img.resize({ w: MAX_DIMENSION });
    else        img.resize({ h: MAX_DIMENSION });
  }
  // getBuffer in jimp v1 takes the MIME type as a string
  return await img.getBuffer('image/jpeg', { quality: JPEG_QUALITY });
}

module.exports = { resizeAndCompress, MAX_DIMENSION, JPEG_QUALITY };
