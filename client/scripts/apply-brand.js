// Build-time platform rename. Replaces the baseline brand name with the single
// source of truth (config.master.js → shared.brandName) across the built static
// files in dist/ — titles, meta, manifest (PWA install name), and the two-tone
// nav wordmark on the landing pages. No-op while brandName is still the baseline
// ("VidyaSetu"), and non-destructive to source (operates on dist only). Run
// after the dist copies, before gen-asset-manifest.
const fs = require('fs');
const path = require('path');

const master = require('../../config.master.js');
const BASELINE = 'VidyaSetu';
const NAME = String((master.shared && master.shared.brandName) || BASELINE).trim();

const dist = path.join(__dirname, '..', 'dist');
const FILES = [
  'index.html', '404.html', 'manifest.webmanifest',
  'landing.html', 'landing-2.html', 'landing-3.html', 'landing-4.html',
  'landing-demo.html', 'pricing.html',
];

if (NAME === BASELINE) {
  console.log('▶ apply-brand: brandName is the baseline — nothing to rename.');
  process.exit(0);
}

// Collapse the two-tone wordmark <span..>Vidya</span><span..>Setu</span> to a
// single span (keeps the first span's classes) showing the new name.
const twoTone = /<span([^>]*)>Vidya<\/span>\s*<span[^>]*>Setu<\/span>/g;

let touched = 0;
for (const f of FILES) {
  const p = path.join(dist, f);
  if (!fs.existsSync(p)) continue;
  const before = fs.readFileSync(p, 'utf8');
  let after = before.replace(twoTone, `<span$1>${NAME}</span>`);
  after = after.split(BASELINE).join(NAME); // whole-word occurrences (titles/meta/alt/manifest)
  if (after !== before) { fs.writeFileSync(p, after); touched++; console.log('  renamed brand in', f); }
}
console.log(`▶ apply-brand: "${BASELINE}" → "${NAME}" across ${touched} file(s).`);
