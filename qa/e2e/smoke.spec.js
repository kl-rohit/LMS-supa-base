// Smoke + regression sweep across every module. The star assertion is
// "no horizontal scroll" — the automated version of the manual PWA sweep.
// Rules verified here are documented in qa/module-rules.md.

const { test, expect } = require('@playwright/test');

const MODULES = [
  '/dashboard', '/students', '/groups', '/attendance', '/fees',
  '/classes', '/messages', '/reports', '/lessons', '/settings',
];

for (const path of MODULES) {
  test(`${path} — loads and does not scroll horizontally`, async ({ page }) => {
    const resp = await page.goto(path, { waitUntil: 'networkidle' });
    expect(resp?.status(), `${path} should not error`).toBeLessThan(400);

    // Must not have bounced to the marketing/login page (i.e. session is valid).
    expect(page.url(), 'session expired — regenerate .auth/state.json').toContain(path);

    // The page may only scroll vertically.
    const { scrollW, clientW } = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    expect(scrollW, `${path} scrolls sideways (scrollW ${scrollW} > clientW ${clientW})`)
      .toBeLessThanOrEqual(clientW + 1);
  });
}

test('no rupee value renders in scientific notation (Messages)', async ({ page }) => {
  await page.goto('/messages', { waitUntil: 'networkidle' });
  const body = await page.evaluate(() => document.body.innerText);
  // e.g. "₹3.245678944343434e+23" — must never appear in a user-facing message.
  expect(body, 'a money value leaked scientific notation').not.toMatch(/e\+?\d{2,}/i);
});
