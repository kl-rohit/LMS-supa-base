#!/usr/bin/env node
// gen-asset-manifest.js — list every emitted app chunk for the service worker.
//
// The app is route-split into many lazy chunks that webpack loads at runtime
// via import(). index.html only references the entry bundle (main.*.js), so a
// service worker that precaches "the scripts in the HTML" misses every route
// chunk. Offline, the shell + main.js boot, then the first dynamic import
// fails and the app renders a blank themed page.
//
// This writes dist/asset-manifest.json — a flat list of every .js chunk (app
// CSS is injected via style-loader, so it rides inside the JS) — which sw.js
// fetches on install and precaches in full. Bare filenames; the SW resolves
// them against its own scope, so this stays correct whatever PUBLIC_URL is.
//
// Excludes sw.js itself (the worker is registered, not cached as an asset).

const fs = require('fs');
const path = require('path');

const DIST = path.resolve(__dirname, '..', 'dist');

function main() {
  if (!fs.existsSync(DIST)) {
    console.error('✖ gen-asset-manifest: dist/ not found — run webpack first.');
    process.exit(1);
  }
  const assets = fs
    .readdirSync(DIST)
    .filter((f) => f.endsWith('.js') && f !== 'sw.js')
    .sort();

  const out = path.join(DIST, 'asset-manifest.json');
  fs.writeFileSync(out, JSON.stringify({ assets }, null, 2) + '\n');
  console.log(`▶ gen-asset-manifest: ${assets.length} chunks → dist/asset-manifest.json`);
}

main();
