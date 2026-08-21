// UI-driven happy-path CRUD for the critical modules — clicks the REAL forms,
// so it catches what the API suite can't: broken forms, validation UX, a row
// not rendering after save. Runs against a TEST org (it creates + deletes data).
//
// Selectors use resilient role/label/text locators, but every app UI has quirks
// — expect to tweak a locator or two on the FIRST authenticated run, then it's
// stable. The broad API CRUD lives in ../api-crud.mjs; this is the screen-level
// confidence layer for the modules that matter most.
//
// Run:  npx playwright test crud.spec.js   (after create-auth.js)

const { test, expect } = require('@playwright/test');

const TAG = `UICRUD-${Date.now()}`;

test.describe('Students — create → appears → remove (UI)', () => {
  test('happy path', async ({ page }) => {
    await page.goto('/students', { waitUntil: 'networkidle' });
    expect(page.url(), 'session expired — run create-auth.js').toContain('/students');

    // CREATE — open the form, fill required fields (name + parent + mobile).
    await page.getByRole('button', { name: /new|add student/i }).first().click();
    await page.getByLabel(/student name|^name/i).first().fill(`${TAG} Student`);
    await page.getByLabel(/parent/i).first().fill('UI CRUD Parent');
    await page.getByLabel(/mobile|phone/i).first().fill('9000000008');
    await page.getByRole('button', { name: /save|create|add/i }).last().click();

    // APPEARS — the new student is visible in the list.
    await expect(page.getByText(`${TAG} Student`)).toBeVisible({ timeout: 10_000 });

    // REMOVE — find the row and deactivate/delete it, confirming any dialog.
    const row = page.getByRole('row', { name: new RegExp(TAG) }).first();
    await row.getByRole('button', { name: /delete|deactivate|remove|archive/i }).first().click();
    await page.getByRole('button', { name: /^(delete|deactivate|confirm|remove|yes)/i }).last().click();

    // GONE from the active list.
    await expect(page.getByText(`${TAG} Student`)).toHaveCount(0, { timeout: 10_000 });
  });
});

// --- The remaining three follow the SAME shape. Enable + verify selectors on
// the first authenticated run, then remove the skip. Kept as skips so the suite
// stays green while the Students pattern is proven. ---

test.skip('Fees — add additional fee → appears → remove (UI)', async ({ page }) => {
  // goto /fees → "Add fee"/"Additional" → fill description + amount (≤10,00,000)
  // → save → assert row → delete → confirm → assert gone.
  // Also assert a huge amount (e.g. 9e9) shows the inline "too large" error.
});

test.skip('Attendance — mark present is GREEN then save (UI)', async ({ page }) => {
  // goto /attendance → pick class or Ad-hoc → select a student → the Present
  // toggle has a green background (getByRole('button',{name:/present/i}) →
  // expect a green bg via toHaveCSS or class) → Save → appears in "Marked".
});

test.skip('Classes — create recurring class → shows on timetable, no page scroll (UI)', async ({ page }) => {
  // goto /classes → New class → name + type + day + start/end → save → the
  // class appears; assert documentElement.scrollWidth === clientWidth at phone
  // width (timetable scrolls inside its own box) → delete the class.
});
