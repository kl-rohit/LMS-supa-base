// Playwright config for VidyaSetu e2e smoke tests.
//
// Setup (one-time):
//   cd qa && npm i -D @playwright/test && npx playwright install chromium
//   node create-auth.js            # opens a browser; log in once → saves .auth/state.json
//   npx playwright test            # runs the specs below against the live app
//
// The tests need a logged-in session. We store it in qa/.auth/state.json
// (gitignored) rather than typing credentials in code. See e2e/README.md.

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 8_000 },
  // Serial, single worker: all specs share ONE Supabase session, and parallel
  // contexts rotate/invalidate each other's refresh token (→ bounce to landing).
  // One worker keeps the session stable across the run.
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://academy-management.netlify.app',
    storageState: '.auth/state.json',
    trace: 'on-first-retry',
    // Fail a missing click/fill in 20s, not the 60s test timeout — otherwise two
    // stuck tests eat 2 minutes and the shared session expires for later ones.
    actionTimeout: 20_000,
  },
  // Run ONE project per invocation. Two projects = two browser contexts that
  // both reload the same on-disk session; once the first rotates the Supabase
  // token, the second bounces to landing. So we expose exactly one project at a
  // time. Mobile is the default (phone width is where layout/scroll bugs live);
  // check desktop separately with:  PW_DESKTOP=1 npx playwright test
  projects: process.env.PW_DESKTOP
    ? [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }]
    : [{ name: 'mobile', use: { ...devices['Pixel 5'] } }],
});
