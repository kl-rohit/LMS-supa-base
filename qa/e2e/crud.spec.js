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

// --- The remaining three are real bodies below, kept `.skip`-gated. On the
// FIRST authenticated run, remove `.skip` one at a time and adjust any locator
// the app words differently — UI selectors normally need one confirming pass.
// The flows and assertions are source-derived (e.g. the Present toggle really
// does get `bg-green-500` when active — see Attendance.jsx). ---

test.skip('Fees — add additional fee → appears → remove (UI)', async ({ page }) => {
  await page.goto('/fees', { waitUntil: 'networkidle' });
  expect(page.url()).toContain('/fees');

  // Open the "add charge" modal (Fees.jsx sets adjustment_type:'fee').
  await page.getByRole('button', { name: /add (charge|fee)|additional/i }).first().click();
  // Pick the first student in the modal's picker, then fill the fields.
  await page.getByRole('checkbox').first().check().catch(() => {});
  await page.getByLabel(/description/i).first().fill(`${TAG} exam fee`);
  await page.getByLabel(/amount/i).first().fill('500');
  await page.getByRole('button', { name: /save|add/i }).last().click();
  await expect(page.getByText(`${TAG} exam fee`)).toBeVisible({ timeout: 10_000 });

  // Client cap: a value over ₹10,00,000 must surface an inline error, not save.
  await page.getByRole('button', { name: /add (charge|fee)|additional/i }).first().click();
  await page.getByRole('checkbox').first().check().catch(() => {});
  await page.getByLabel(/description/i).first().fill(`${TAG} too big`);
  await page.getByLabel(/amount/i).first().fill('99999999');
  await page.getByRole('button', { name: /save|add/i }).last().click();
  await expect(page.getByText(/too large|max/i)).toBeVisible();
  await page.getByRole('button', { name: /cancel|close/i }).last().click();

  // Remove the real fee we added.
  const row = page.getByRole('row', { name: new RegExp(`${TAG} exam fee`) }).first();
  await row.getByRole('button', { name: /delete|remove/i }).first().click();
  await page.getByRole('button', { name: /^(delete|remove|confirm|yes)/i }).last().click();
  await expect(page.getByText(`${TAG} exam fee`)).toHaveCount(0, { timeout: 10_000 });
});

test.skip('Attendance — Present toggle is GREEN (UI)', async ({ page }) => {
  await page.goto('/attendance', { waitUntil: 'networkidle' });
  expect(page.url()).toContain('/attendance');
  // Precondition: a class roster must be on screen (pick "Any class" → a class,
  // or use "Ad-hoc attendance" and select a student) so the per-student
  // Present/Absent toggles render.
  const present = page.getByRole('button', { name: /^present/i }).first();
  await present.click();
  // Source of truth (Attendance.jsx): active Present = 'bg-green-500 text-white'.
  await expect(present).toHaveClass(/bg-green-500/);
});

test.skip('Classes — create class → appears, timetable does not scroll page (UI)', async ({ page }) => {
  await page.goto('/classes', { waitUntil: 'networkidle' });
  expect(page.url()).toContain('/classes');

  await page.getByRole('button', { name: /new class|add class|create/i }).first().click();
  await page.getByLabel(/class name|^name/i).first().fill(`${TAG} Class`);
  // Pick a weekday and start/end times (Classes.jsx uses day_of_week + times).
  await page.getByRole('button', { name: /^mon/i }).first().click().catch(() => {});
  await page.getByLabel(/start/i).first().fill('10:00').catch(() => {});
  await page.getByLabel(/end/i).first().fill('11:00').catch(() => {});
  await page.getByRole('button', { name: /save|create|add/i }).last().click();
  await expect(page.getByText(`${TAG} Class`)).toBeVisible({ timeout: 10_000 });

  // Timetable must scroll inside its own box, not the page.
  const { scrollW, clientW } = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
  }));
  expect(scrollW, 'page scrolls sideways with a class on the timetable').toBeLessThanOrEqual(clientW + 1);

  // Clean up.
  const row = page.getByRole('row', { name: new RegExp(`${TAG} Class`) }).first();
  await row.getByRole('button', { name: /delete|remove/i }).first().click();
  await page.getByRole('button', { name: /^(delete|remove|confirm|yes)/i }).last().click();
});
