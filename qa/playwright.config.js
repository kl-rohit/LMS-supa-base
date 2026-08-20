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
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://academy-management.netlify.app',
    storageState: '.auth/state.json',
    trace: 'on-first-retry',
  },
  projects: [
    // Phone-sized: this is where horizontal-scroll and layout bugs surface.
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
});
