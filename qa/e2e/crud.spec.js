// UI-driven CRUD for the admin modules — clicks the REAL forms, so it catches
// what the API suite can't (a broken form, a dead save button, a row that
// doesn't render). Runs against a TEST org (creates + deletes data). Selectors
// are derived from the page source; the four rules learned while stabilising
// Students apply throughout:
//   1. Fields are targeted by PLACEHOLDER / [data-field] — labels aren't linked.
//   2. Data must be valid — names via V.name are letters-only (no digits);
//      amounts <= 10,00,000; mobiles are 10 digits starting 6-9.
//   3. Lists render a desktop row AND a mobile card — assert toBeAttached()
//      (both are in the DOM; which is visible depends on the breakpoint).
//   4. Clean up through the authenticated API, not the mobile-card delete UI.
//
// Run:  npm run e2e -- crud.spec.js            (all)
//       npm run e2e -- crud.spec.js -g Groups  (one module)

const { test, expect } = require('@playwright/test');

const STAMP = Date.now();                 // unique per run, for names allowing digits
const LETTERS = 'Zzqa Crud';              // prefix for name-validated fields (no digits)

// --- authenticated API helpers (run in the page, reuse the live session) ---
async function apiList(page, path, key) {
  return page.evaluate(async ({ path, key }) => {
    const org = localStorage.getItem('veena_impersonate_org_id') || localStorage.getItem('veena_active_org_id') || '0';
    const tok = JSON.parse(localStorage.getItem('veena_auth') || '{}').access_token;
    const r = await fetch(`/api${path}${path.includes('?') ? '&' : '?'}org=${org}`, { headers: { 'X-Auth-Token': tok } });
    const j = await r.json().catch(() => ({}));
    return j[key] || j.data || [];
  }, { path, key });
}
async function apiDeleteWhere(page, listPath, key, matchKeys, needle, delBase, force = false) {
  await page.evaluate(async ({ listPath, key, matchKeys, needle, delBase, force }) => {
    const org = localStorage.getItem('veena_impersonate_org_id') || localStorage.getItem('veena_active_org_id') || '0';
    const tok = JSON.parse(localStorage.getItem('veena_auth') || '{}').access_token;
    const h = { 'X-Auth-Token': tok };
    const r = await fetch(`/api${listPath}${listPath.includes('?') ? '&' : '?'}org=${org}`, { headers: h });
    const j = await r.json().catch(() => ({}));
    for (const it of (j[key] || j.data || [])) {
      if (matchKeys.some((k) => String(it[k] || '').includes(needle))) {
        const id = it.id || it.ROWID;
        await fetch(`/api${delBase}/${id}?org=${org}${force ? '&force=true' : ''}`, { method: 'DELETE', headers: h });
      }
    }
  }, { listPath, key, matchKeys, needle, delBase, force });
}
const guard = (page, path) => expect(page.url(), 'session expired — run create-auth.js').toContain(path);

// ============================ Students ============================
test.describe('Students', () => {
  const NAME = `${LETTERS} Student`; // letters only (V.name)
  const purge = (page) => apiDeleteWhere(page, '/students?status=all&limit=500', 'students', ['name'], NAME, '/students');
  test('create → appears → remove', async ({ page }) => {
    await page.goto('/students', { waitUntil: 'domcontentloaded' }); guard(page, '/students');
    await purge(page);
    await page.getByRole('button', { name: 'Add Student' }).first().click();
    await page.getByPlaceholder('Student name').fill(NAME);
    await page.getByPlaceholder('Parent name').fill(`${LETTERS} Parent`);
    await page.getByPlaceholder('98765 43210').fill('9000000008');
    await page.getByRole('button', { name: 'Add Student' }).last().click();
    await expect(page.getByText(NAME).first()).toBeAttached({ timeout: 10_000 });
    await purge(page);
  });
});

// ============================ Groups ============================
test.describe('Groups', () => {
  const NAME = `ZzGroup ${STAMP}`; // V.text — digits allowed
  const purge = (page) => apiDeleteWhere(page, '/groups?status=all&limit=500', 'groups', ['name'], String(STAMP), '/groups', true);
  test('create → appears → remove', async ({ page }) => {
    await page.goto('/groups', { waitUntil: 'domcontentloaded' }); guard(page, '/groups');
    await purge(page);
    await page.getByRole('button', { name: 'New Group' }).first().click();
    await page.getByPlaceholder('e.g., Beginners Batch').fill(NAME);
    await page.getByRole('button', { name: 'Create Group' }).click();
    await expect(page.getByText(NAME).first()).toBeAttached({ timeout: 10_000 });
    await purge(page);
  });
});

// ============================ Assignments ============================
test.describe('Assignments', () => {
  const TITLE = `ZzAssignment ${STAMP}`;
  const purge = (page) => apiDeleteWhere(page, '/assignments', 'assignments', ['title'], String(STAMP), '/assignments');
  test('create (target everyone) → appears → remove', async ({ page }) => {
    await page.goto('/assignments', { waitUntil: 'domcontentloaded' }); guard(page, '/assignments');
    await purge(page);
    await page.getByRole('button', { name: 'New Assignment' }).first().click();
    await page.locator('[data-field="title"]').fill(TITLE);
    await page.getByRole('button', { name: 'Everyone' }).click().catch(() => {}); // default target
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText(TITLE).first()).toBeAttached({ timeout: 10_000 });
    await purge(page);
  });
});

// ============================ Question Papers ============================
test.describe('Question Papers', () => {
  const TITLE = `ZzPaper ${STAMP}`;
  const purge = (page) => apiDeleteWhere(page, '/question-papers', 'question_papers', ['title'], String(STAMP), '/question-papers');
  test('create → appears → remove', async ({ page }) => {
    await page.goto('/question-papers', { waitUntil: 'domcontentloaded' }); guard(page, '/question-papers');
    await purge(page);
    await page.getByRole('button', { name: 'Add Paper' }).first().click();
    await page.locator('[data-field="title"]').fill(TITLE);
    await page.locator('[data-field="link"]').fill('https://example.com/paper.pdf');
    await page.getByRole('button', { name: 'Everyone' }).click().catch(() => {});
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText(TITLE).first()).toBeAttached({ timeout: 10_000 });
    await purge(page);
  });
});

// ============================ Lessons (Course) ============================
test.describe('Lessons', () => {
  const NAME = `ZzCourse ${STAMP}`;
  const purge = (page) => apiDeleteWhere(page, '/courses?status=all', 'courses', ['name'], String(STAMP), '/courses');
  test('create course → appears → archive', async ({ page }) => {
    await page.goto('/lessons', { waitUntil: 'domcontentloaded' }); guard(page, '/lessons');
    await purge(page);
    await page.getByRole('button', { name: 'New course' }).first().click();
    await page.locator('[data-field="name"]').fill(NAME);
    await page.getByRole('button', { name: 'Create course' }).click();
    await expect(page.getByText(NAME).first()).toBeAttached({ timeout: 10_000 });
    await purge(page);
  });
});

// ============================ Messages ============================
test.describe('Messages', () => {
  const BODY = `Zzmsg CRUD ${STAMP}`;
  // "Everyone" fans out one row per student — purge every row carrying our stamp.
  const purge = (page) => apiDeleteWhere(page, '/messages', 'messages', ['message', 'body'], String(STAMP), '/messages');
  test('compose (everyone) → created → remove', async ({ page }) => {
    await page.goto('/messages', { waitUntil: 'domcontentloaded' }); guard(page, '/messages');
    await purge(page);
    await page.getByRole('button', { name: 'Compose' }).first().click();
    await page.getByRole('button', { name: 'Everyone' }).click().catch(() => {});
    await page.locator('[data-field="message_text"]').fill(BODY);
    await page.getByRole('button', { name: 'Create Message' }).click();
    // Verify via API (fan-out means the on-screen match is ambiguous).
    await expect.poll(async () => {
      const list = await apiList(page, '/messages', 'messages');
      return list.filter((m) => JSON.stringify(m).includes(String(STAMP))).length;
    }, { timeout: 10_000 }).toBeGreaterThan(0);
    await purge(page);
  });
});

// ============================ Fees (student picker) ============================
test.describe('Fees', () => {
  const DESC = `Zzfee CRUD ${STAMP}`;
  const purge = (page) => apiDeleteWhere(page, `/fees/additional?month=${new Date().getMonth() + 1}&year=${new Date().getFullYear()}`, 'additional_fees', ['description'], String(STAMP), '/fees/additional');
  test('add additional fee (first student) → appears → remove', async ({ page }) => {
    await page.goto('/fees', { waitUntil: 'domcontentloaded' }); guard(page, '/fees');
    await purge(page);
    await page.getByRole('button', { name: 'Add Additional Fee' }).first().click();
    // Pick students: "Select All" is the simplest reliable way to satisfy the
    // "at least one student" requirement (save is disabled until then).
    await page.getByRole('button', { name: 'Select All' }).click();
    await page.locator('[data-field="description"]').fill(DESC);
    await page.locator('[data-field="amount"]').fill('500');
    await page.getByRole('button', { name: /^Add Fee( \(\d+ students\))?$/ }).click();
    await expect.poll(async () => {
      const list = await apiList(page, `/fees/additional?month=${new Date().getMonth() + 1}&year=${new Date().getFullYear()}`, 'additional_fees');
      return list.filter((f) => String(f.description || '').includes(String(STAMP))).length;
    }, { timeout: 10_000 }).toBeGreaterThan(0);
    await purge(page);
  });
});

// ============================ Camps (needs a group) ============================
test.describe('Camps', () => {
  const NAME = `ZzCamp ${STAMP}`;
  const purge = (page) => apiDeleteWhere(page, '/camps', 'camps', ['name'], String(STAMP), '/camps');
  test('create camp → appears → remove', async ({ page }) => {
    await page.goto('/classes', { waitUntil: 'domcontentloaded' }); guard(page, '/classes');
    await purge(page);
    await page.getByRole('button', { name: 'Camps' }).click();          // Camps tab
    await page.getByRole('button', { name: 'New Camp' }).first().click();
    await page.locator('[data-field="name"]').fill(NAME);
    await page.locator('[data-field="group_id"]').selectOption({ index: 1 }); // first real group
    // start_date defaults today, total_days default 5, daily_fee optional.
    await page.getByRole('button', { name: /^Create Camp \(\d+ days\)$/ }).click();
    await expect(page.getByText(NAME).first()).toBeAttached({ timeout: 10_000 });
    await purge(page);
  });
});

// ============================ Attendance (ad-hoc) ============================
test.describe('Attendance', () => {
  const TOPIC = `Zzatt CRUD ${STAMP}`;
  test('ad-hoc mark present → saved', async ({ page }) => {
    await page.goto('/attendance', { waitUntil: 'domcontentloaded' }); guard(page, '/attendance');
    await page.getByRole('button', { name: 'Ad-hoc attendance' }).click();
    await page.getByPlaceholder('What was taught...').fill(TOPIC).catch(() => {});
    await page.getByRole('button', { name: 'Select All' }).click();     // select all students
    await page.getByRole('button', { name: 'Mark Present & Save' }).click();
    // Verify at least one attendance row saved for today with our topic.
    const today = new Date().toISOString().slice(0, 10);
    await expect.poll(async () => {
      const list = await apiList(page, `/attendance?date=${today}`, 'attendance');
      return list.filter((a) => String(a.topic || '').includes(String(STAMP))).length;
    }, { timeout: 10_000 }).toBeGreaterThan(0);
    // Clean up today's ad-hoc rows carrying our stamp.
    await apiDeleteWhere(page, `/attendance?date=${today}`, 'attendance', ['topic'], String(STAMP), '/attendance');
  });
});

// ============================ Classes (recurring) ============================
test.describe('Classes', () => {
  const NAME = `ZzClass ${STAMP}`;
  const purge = (page) => apiDeleteWhere(page, '/classes', 'classes', ['name'], String(STAMP), '/classes');
  test('create class (offline group, Monday) → appears → remove', async ({ page }) => {
    await page.goto('/classes', { waitUntil: 'domcontentloaded' }); guard(page, '/classes');
    await purge(page);
    await page.getByRole('button', { name: 'List' }).click().catch(() => {}); // Add Class lives in List view
    await page.getByRole('button', { name: 'Add Class' }).first().click();
    await page.locator('[data-field="name"]').fill(NAME);
    await page.locator('select').first().selectOption('offline_group').catch(() => {});
    await page.locator('[data-field="group_id"]').selectOption({ index: 1 }).catch(() => {});
    await page.locator('[data-field="day_of_week"]').getByRole('button', { name: 'Mon' }).click();
    await page.getByRole('button', { name: 'Create Class' }).click();
    await expect(page.getByText(NAME).first()).toBeAttached({ timeout: 10_000 });
    await purge(page);
  });
});
