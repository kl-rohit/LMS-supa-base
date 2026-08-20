// One-time helper: opens a real browser, waits while YOU log in, then saves the
// session to .auth/state.json so the e2e tests can reuse it. No credentials are
// ever stored in code — you type them into the real login page yourself.
//
//   node create-auth.js
//
// Log in, reach the dashboard, then press Enter in this terminal.

const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://academy-management.netlify.app';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  console.log('\n→ Log in in the opened browser, reach the dashboard, then press Enter here.');
  await new Promise((r) => process.stdin.once('data', r));
  fs.mkdirSync(path.join(__dirname, '.auth'), { recursive: true });
  await context.storageState({ path: path.join(__dirname, '.auth', 'state.json') });
  console.log('✓ Saved .auth/state.json — you can now run: npx playwright test');
  await browser.close();
  process.exit(0);
})();
