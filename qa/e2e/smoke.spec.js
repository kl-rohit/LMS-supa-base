// Smoke + regression sweep across every module. The headline assertion is
// "no horizontal scroll" — the automated version of the manual PWA sweep.
//
// IMPORTANT: this is ONE test that sweeps every route on a SINGLE page/context.
// Do NOT split it into one-test-per-route: each Playwright test spawns a fresh
// context that reloads the shared session, and Supabase rotates the refresh
// token — so multiple contexts invalidate each other's session and bounce to
// the landing page. One page + workers:1 (see playwright.config.js) avoids that.
// Rules verified here are documented in qa/module-rules.md and e2e-scenarios.md.

const { test, expect } = require('@playwright/test');

const MODULES = [
  '/dashboard', '/students', '/groups', '/attendance', '/fees',
  '/classes', '/messages', '/reports', '/lessons', '/assignments',
  '/question-papers', '/quizzes', '/student-logins', '/settings', '/help',
];

test('all modules: load, scroll only vertically, no bad values', async ({ page }) => {
  const problems = [];

  for (const path of MODULES) {
    const resp = await page.goto(path, { waitUntil: 'networkidle' });
    if (resp && resp.status() >= 400) { problems.push(`${path}: HTTP ${resp.status()}`); continue; }

    // Bounced to marketing/login ⇒ the .auth session lapsed — regenerate it
    // with create-auth.js (see e2e/README.md). Not an app bug.
    if (!page.url().includes(path)) {
      problems.push(`${path}: bounced to ${page.url()} — session expired, run create-auth.js`);
      continue;
    }

    const { scrollW, clientW, bad } = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      // e.g. "₹3.2e+23", "₹NaN", stray "undefined" in a value
      bad: (document.body.innerText || '').match(/e\+\d{2,}|₹\s?NaN|\bNaN\b/i),
    }));

    if (scrollW > clientW + 1) problems.push(`${path}: scrolls sideways (${scrollW} > ${clientW})`);
    if (bad) problems.push(`${path}: bad value in text ("${bad[0]}")`);
  }

  expect(problems, `\n${problems.join('\n')}\n`).toEqual([]);
});
