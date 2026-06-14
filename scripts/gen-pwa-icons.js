// Generates the PWA icon set for the Veena client by compositing simple
// shapes with jimp (no external rasterizer available on this machine).
//
//   node scripts/gen-pwa-icons.js
//
// Output -> client/public/icons/{icon-192,icon-512,maskable-512,apple-touch-icon}.png
// Re-run only if the brand mark/colour changes; the PNGs are committed.

const path = require('path');
const fs = require('fs');
const { Jimp, rgbaToInt } = require(path.join(__dirname, '..', 'functions', 'api', 'node_modules', 'jimp'));

const OUT_DIR = path.join(__dirname, '..', 'client', 'public', 'icons');
const BG = { r: 0x4f, g: 0x46, b: 0xe5 }; // indigo-600, matches the in-app logo badge
const FG = { r: 0xff, g: 0xff, b: 0xff }; // white music note

const rgba = (c, a = 255) => rgbaToInt(c.r, c.g, c.b, a);

// Draw a single eighth-note (round head + stem + flag) into `img`.
// All geometry is expressed as fractions of `N` so it scales to any size.
// `inset` shrinks/centres the mark (used for maskable safe-zone padding).
function drawNote(img, N, inset = 0) {
  const s = 1 - inset * 2; // scale of the mark
  const ox = inset * N;    // origin offset so the mark stays centred
  const oy = inset * N;
  const fg = rgba(FG);

  const headCx = ox + 0.40 * N * s + (inset ? 0 : 0);
  const headCy = oy + 0.66 * N * s;
  const headR = 0.14 * N * s;
  const headRx = headR * 1.15; // slightly oval, tilted note head
  const headRy = headR * 0.9;

  const stemW = 0.05 * N * s;
  const stemX0 = headCx + headRx - stemW; // attach to the head's right side
  const stemX1 = stemX0 + stemW;
  const stemTop = oy + 0.24 * N * s;
  const stemBot = headCy;

  // Flag: a slanted parallelogram coming off the top of the stem.
  const flagX0 = stemX0;
  const flagLen = 0.20 * N * s;
  const flagTop = stemTop;
  const flagH = 0.10 * N * s;
  const flagSlant = 0.06 * N * s;

  img.scan(0, 0, img.bitmap.width, img.bitmap.height, (x, y) => {
    let on = false;

    // tilted oval note head
    const dx = x - headCx;
    const dy = y - headCy;
    // rotate point by ~ -20deg so the oval tilts like a real note head
    const a = (20 * Math.PI) / 180;
    const rx = dx * Math.cos(a) - dy * Math.sin(a);
    const ry = dx * Math.sin(a) + dy * Math.cos(a);
    if ((rx * rx) / (headRx * headRx) + (ry * ry) / (headRy * headRy) <= 1) on = true;

    // stem
    if (x >= stemX0 && x < stemX1 && y >= stemTop && y <= stemBot) on = true;

    // flag (parallelogram, slanting down to the right)
    if (y >= flagTop && y <= flagTop + flagH) {
      const t = (y - flagTop) / flagH;
      const fx0 = flagX0 + t * flagSlant;
      const fx1 = flagX0 + flagLen + t * flagSlant;
      if (x >= fx0 && x <= fx1) on = true;
    }

    if (on) img.bitmap.data.writeUInt32BE(fg >>> 0, (y * img.bitmap.width + x) * 4);
  });
}

// Rounded-corner mask: clear pixels outside a rounded square of radius `r`.
function roundCorners(img, N, r) {
  img.scan(0, 0, N, N, (x, y) => {
    let outside = false;
    // four corners
    const corners = [
      [r, r], [N - r, r], [r, N - r], [N - r, N - r],
    ];
    if (x < r && y < r) outside = (x - r) ** 2 + (y - r) ** 2 > r * r;
    else if (x > N - r && y < r) outside = (x - (N - r)) ** 2 + (y - r) ** 2 > r * r;
    else if (x < r && y > N - r) outside = (x - r) ** 2 + (y - (N - r)) ** 2 > r * r;
    else if (x > N - r && y > N - r) outside = (x - (N - r)) ** 2 + (y - (N - r)) ** 2 > r * r;
    if (outside) img.bitmap.data.writeUInt32BE(0x00000000, (y * N + x) * 4);
  });
}

async function makeIcon(N, { maskable = false } = {}) {
  const img = new Jimp({ width: N, height: N, color: rgba(BG) });
  if (maskable) {
    // full-bleed background, mark padded into the central safe zone
    drawNote(img, N, 0.18);
  } else {
    drawNote(img, N, 0);
    roundCorners(img, N, Math.round(0.20 * N));
  }
  return img;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tasks = [
    ['icon-192.png', 192, {}],
    ['icon-512.png', 512, {}],
    ['maskable-512.png', 512, { maskable: true }],
    ['apple-touch-icon.png', 180, {}],
  ];
  for (const [name, size, opts] of tasks) {
    const img = await makeIcon(size, opts);
    await img.write(path.join(OUT_DIR, name));
    console.log('  wrote', name, `(${size}x${size}${opts.maskable ? ', maskable' : ''})`);
  }
  console.log('done.');
})().catch((e) => { console.error(e); process.exit(1); });
