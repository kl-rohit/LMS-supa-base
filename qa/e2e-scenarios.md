# E2E test scenarios — run before every deploy

The pre-deploy gate. Work top to bottom; a deploy should only go out when the
**automated** layers are green and the **manual smoke** scenarios pass. Each
scenario says whether it's `[auto]` (a test runs it) or `[manual]` (click it),
and which past bug it guards.

## How to run (pre-deploy)

```bash
# 1. Unit tests — pure logic, no browser/auth, fast. ALWAYS run.
cd functions/api && npm test

# 2. Browser e2e — needs a one-time throwaway login (see e2e/README.md).
cd qa && npx playwright test            # add --project=mobile for phone-width only

# 3. Manual smoke — the [manual] scenarios below, ~3 min.

# 4. Only if all green:
./deploy.sh
```

> Never run the e2e suite against a session you're actively using — use
> `create-auth.js` for a throwaway login (Supabase rotates tokens and will log
> your live browser out otherwise). See `e2e/README.md`.

---

## Regression guards — bugs we've already fixed, and the scenario that catches a relapse

| # | Past bug | Scenario | Layer |
|---|----------|----------|-------|
| G1 | Fee reminder showed `₹3.245e23` | S-FEE-2, S-FEE-3 | auto (unit) + auto (api) |
| G2 | Fee amount had no upper bound | S-FEE-3 | auto (api) |
| G3 | App scrolled sideways in PWA | S-NAV-1 | auto (playwright, mobile) |
| G4 | "Present" not green | S-ATT-2 | manual |
| G5 | Sign-out auto-relogged-in | S-AUTH-1 | manual |
| G6 | Forced (401) logout left session in localStorage | S-AUTH-2 | manual |
| G7 | Empty academy could not be removed / populated one wrongly deletable | S-PLAT-1 | manual |
| G8 | Pricing edits didn't reach the site without a rebuild | S-PLAT-2 | manual |
| G9 | Archived course had nowhere to view it | S-LES-2 | manual |

---

## Core scenarios by module

### Auth
- **S-AUTH-1 `[manual]`** Sign out → click Sign In → **must land on the login form**, not auto-logged-in. (Guards G5.)
- **S-AUTH-2 `[manual]`** With a stale/expired session, hit any page → bounced to `/login` AND `localStorage.veena_auth` is gone (DevTools → Application → Local Storage). No silent restore. (Guards G6.)
- **S-AUTH-3 `[manual]`** "Sign out other devices" ends other sessions.

### Navigation / layout (PWA)
- **S-NAV-1 `[auto]`** Every module route loads and **does not scroll horizontally** at 393px. (`smoke.spec.js`; guards G3.)
- **S-NAV-2 `[auto]`** No user-facing text renders `NaN`, `undefined`, `Infinity`, or scientific notation.

### Students / Groups
- **S-STU-1 `[manual]`** Create (name + parent + mobile required), edit, deactivate, reactivate; Active/Inactive/All filter.
- **S-GRP-1 `[manual]`** Create group, add member (named confirmation), remove; duplicate name rejected.

### Attendance
- **S-ATT-1 `[manual]`** Mark a roster; mark-all present/absent; ad-hoc.
- **S-ATT-2 `[manual]`** A **Present** toggle/pill is **green**, Absent red. (Guards G4.)

### Fees
- **S-FEE-1 `[manual]`** Add additional fee, record payment; totals recompute; masked figures stay masked.
- **S-FEE-2 `[auto/unit]`** A large/fractional amount renders as grouped rupees, never `e+23`. (`feeReminder.test.js`; guards G1.)
- **S-FEE-3 `[auto/api]`** `POST /fees/additional` and `/fees/payments` with an amount > ₹10,00,000 return **400**. (Guards G2.)

### Classes / Timetable
- **S-CLS-1 `[manual]`** Create a recurring class (needs `day_of_week` int, start<end); it appears on the timetable and the grid scrolls **inside its box**, not the page, at phone width.

### Messages
- **S-MSG-1 `[manual]`** Generate fee reminders → amounts are clean rupees; send / WhatsApp / copy actions work.

### Lessons
- **S-LES-1 `[manual]`** Create course, add lesson/quiz, certificate gate.
- **S-LES-2 `[manual]`** Archive a course → it disappears from Active, appears under the **Archived** filter, and **Restore** brings it back. (Guards G9.)

### Reports
- **S-REP-1 `[manual]`** Switch ranges; export PDF; empty range shows empty state, not an error; every figure is formatted rupees.

### Platform Admin
- **S-PLAT-1 `[manual]`** An academy **with data** cannot be deleted (Delete button hidden / 409); an **empty** one can. Suspend locks members out immediately and is reversible. (Guards G7.)
- **S-PLAT-2 `[manual]`** Change a price in **Plans** → the public site reflects it within ~2 min with no rebuild. (Guards G8.)

---

## Sample run log

Keep a dated line here each time you run the gate before a deploy, so there's a
history of what was verified against which commit.

```
2026-08-20  commit <fill>  unit 6/6 ✓  api-guards S3/S4/S5 ✓  playwright(mobile) 10/10 no-hscroll ✓  manual smoke ✓  → deployed
```
