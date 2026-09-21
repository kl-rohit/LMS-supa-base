# Programs module — spec (v1)

**Purpose.** Let teachers plan events/programs — recitals, *kutcheris*, workshops,
competitions — pick which students take part, and optionally **bill participants**
through the existing fee system. Module name: **Programs** (org-relabelable, e.g.
"Kutcheris" for a music academy). Entity: a **Program**.

Closest existing module is **Camps** (multi-day, roster, daily fee). Programs is
the *single-event* cousin (one date, a participation fee). Reuses Camps/Groups
patterns; multi-day recurring stays with Camps.

## Data model (new tables)
- **Programs**: `id, org_id, name, type (recital|workshop|competition|kutchery|other),
  program_date, description, fee (₹/student, 0–10,00,000, optional), status
  (planned|completed|cancelled), created_at`
- **ProgramStudents**: `id, org_id, program_id, student_id, billed (0/1), created_at`

## API — `/api/programs` (auth + resolveOrg + requireOrgId + `requireFeature('modules.programs')`)
- `GET /` — list, org-scoped, `?status=` filter
- `POST /` — create (name required; fee `feeInRange`)
- `GET /:id` — detail + roster (org-ownership check)
- `PUT /:id` — edit (`safeId` + org check)
- `DELETE /:id` — soft-delete → `status: 'cancelled'`
- `POST /:id/students` `{ student_ids[] }` — enroll (verify each student's `org_id`)
- `DELETE /:id/students/:studentId` — remove (`safeId` both params)
- `POST /:id/bill` `{ student_ids? }` — **fee tie-in**: for each enrolled, unbilled
  student create an `AdditionalFees` row `{ description: "Program: <name>", amount: fee,
  fee_date: program_date, month, year }`, mark `billed=1`. Idempotent (skips already
  billed). Flows straight into Fees → reminders → statements — **no new billing code.**

**Security (follows the audit fixes):** every query `org_id`-scoped; all client ids
via `safeId()`; fee capped with `feeInRange` (₹10,00,000).

## Plan / cost
- Gated by module flag **`modules.programs`** (default off), toggled per org in
  Platform Admin (like Camps/Assignments).
- **Bundled in the Complete plan** as a differentiator — **no separate line-item
  charge** for the pilot.

## Frontend
- Nav item **Programs**, gated by `useModuleFlags().modules.programs`.
- List page: cards (name · date · type · fee · participant count · status) + status
  filter + **New program**.
- Create/edit modal: name, type, date, description, fee (`V.text` / `V.date` /
  `V.nonNegative max 1_000_000`).
- Detail: roster picker (Groups-style add members), participant list with **billed**
  badges, **Bill participants** button → confirm → creates fees.
- Desktop table + mobile cards, matching the app.

## Phasing
- **P1** — tables + route + flag + Programs page (create, roster, bill). ~Camps-sized.
- **P2** — show a student's upcoming programs in the parent portal "For you" feed.

## Testing
- Extend `qa/api-crud.mjs`: create → enroll → bill → cleanup.
- Add Programs to the UI smoke sweep.

## Catalyst console (before deploy)
Create **Programs** and **ProgramStudents** tables with the columns above.

## Open questions for you
1. **Single date** per program (v1), or multi-date like Camps?
2. **Attendance** for programs (who actually showed up), or participation list only? (v1: list only.)
3. Per-org **custom label** ("Kutcheris", "Recitals") — worth adding in v1?
