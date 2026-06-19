// One-off brand-asset generator for VidyaSetu.
//
// Source: client/public/brand/source-mockup.png — a 1402x1122 composite mockup
// (ChatGPT-generated) that contains, in its bottom-right quadrant, a finished
// dark app-icon tile: the white/gold swan+book+halo mark centred on a navy
// rounded-rect. That tile is the highest-quality, best-composed rendition of
// the mark, so we crop it once and derive everything from it.
//
// Emits:
//   public/icons/icon-192.png        (PWA, navy tile)
//   public/icons/icon-512.png        (PWA, navy tile)
//   public/icons/maskable-512.png    (PWA maskable — extra navy safe-zone)
//   public/icons/apple-touch-icon.png(iOS home screen — PNG; iOS won't do WebP)
//   public/logo.png  + public/logo.webp  (nav/footer logo; the tile itself)
//
// Run from client/:  node scripts/gen-brand.mjs
// (requires sharp:  npm i --no-save sharp --prefix client)

import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT  = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BRAND = path.join(ROOT, 'public', 'brand');
const ICONS = path.join(ROOT, 'public', 'icons');
const PUB   = path.join(ROOT, 'public');
const SRC   = path.join(BRAND, 'source-mockup.png');

// Finished dark app-icon tile in the source mockup (measured by hand).
const TILE = { left: 731, top: 820, width: 234, height: 234 };

// Flat navy for the maskable safe-zone fill (matches manifest background_color).
const NAVY = { r: 0x0e, g: 0x17, b: 0x33, alpha: 1 };

mkdirSync(ICONS, { recursive: true });

// High-res master of the tile, upscaled with a good kernel so downstream
// resizes stay crisp.
const tileMaster = await sharp(SRC)
  .extract(TILE)
  .resize(1024, 1024, { kernel: 'lanczos3' })
  .png()
  .toBuffer();

// Plain resize of the tile to a square PNG.
async function tilePng(size, out) {
  await sharp(tileMaster).resize(size, size, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9 }).toFile(out);
  console.log('icon   →', path.relative(ROOT, out));
}

// Maskable: the tile scaled to ~82% on a flat navy square so Android's mask
// has a safe zone and the true corners are full-bleed navy.
async function maskable(size, out) {
  const inner = Math.round(size * 0.82);
  const mark = await sharp(tileMaster).resize(inner, inner, { kernel: 'lanczos3' }).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: NAVY } })
    .composite([{ input: mark, gravity: 'center' }])
    .png({ compressionLevel: 9 }).toFile(out);
  console.log('icon   →', path.relative(ROOT, out));
}

const run = async () => {
  await tilePng(192, path.join(ICONS, 'icon-192.png'));
  await tilePng(512, path.join(ICONS, 'icon-512.png'));
  await tilePng(180, path.join(ICONS, 'apple-touch-icon.png'));
  await maskable(512, path.join(ICONS, 'maskable-512.png'));

  // Nav / footer logo: the tile itself (PNG + WebP). The landing logo-box is
  // made transparent so this navy rounded tile *is* the visible logo chip.
  await sharp(tileMaster).resize(256, 256, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9 }).toFile(path.join(PUB, 'logo.png'));
  await sharp(tileMaster).resize(256, 256, { kernel: 'lanczos3' })
    .webp({ quality: 92 }).toFile(path.join(PUB, 'logo.webp'));
  console.log('logo   → public/logo.png + public/logo.webp');

  console.log('\n✓ Brand assets generated.');
};

run().catch((e) => { console.error(e); process.exit(1); });
