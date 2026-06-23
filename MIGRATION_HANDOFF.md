# Data Migration — Handoff & Next Steps

In-app **Export / Import** that moves one academy's data between Catalyst
deployments (or between orgs), preserving relationships across the re-keying.

- UI: **Settings → Backup & migrate** (`client/src/components/DataMigration.jsx`)
- API: `functions/api/routes/migration.js` (mounted at `/api/migration`)
- Plan/registry: `functions/api/db/migrationRegistry.js`

## How it works (the short version)

- **Export** filters every table by the caller's active `org_id` and downloads
  JSON (per-module or a full bundle). CSV is offered per module for readable
  backups only — JSON is the format that preserves types + relationships.
- **Import** stamps the caller's `org_id` on every row and re-links children to
  their new parents via a **`source_id`** column: each imported row stores its
  old ROWID in `source_id`; a child's FK is remapped by
  `SELECT ROWID FROM <RefTable> WHERE source_id = <oldFk> AND org_id = <org>`.
- Idempotent: re-importing skips rows whose `source_id` already exists.
- **Student photos** migrate in a SEPARATE second pass (the **Photos** button on
  the Students row) so a missing bucket never pollutes the row import.

## Current status (as of this handoff)

- Feature built and **deployed to the veena Development environment**
  (`https://veena-attendance-60070745325.development.catalystserverless.in/app/`).
- **Precision bug fixed + deployed.** 17-digit Catalyst ROWIDs exceed JS's safe
  integer limit, so the old `Number(oldId)` rounded `source_id` on insert while
  the lookup used the exact value — causing false "Parent not found". Now stored
  as the exact digit-string via `safeId(oldId)`.
- `source_id` column has been added to **Students** and **Groups** so far.
- Error messages now render inline in the panel (not just a tooltip).

## NEXT STEPS

### 1. Clean re-test (do this first)
The Students/Groups already imported carry the *old corrupted* `source_id`, and
re-import won't overwrite them (dedupe won't match) → duplicates. So:
- Use a **fresh empty destination org** (simplest), OR delete the already-imported
  rows from the test org.
- Re-import **top to bottom**: Students → Groups → Group memberships.
- Verify a group's member list shows the right students. No "Parent not found".

### 2. Add `source_id` (BigInt, nullable) to the remaining tables
Console → Data Store → table → New Column → name `source_id`, type **BigInt**,
NOT mandatory. Still needed on:

```
Courses, QuestionPapers,
Camps, Lessons, GroupStudents, Classes, CourseEnrollments,
ClassStudents, CampDays, LessonQuizzes, Assignments,
Attendance, AdditionalFees, Payments, Messages,
LessonProgress, QuizAttempts, AssignmentCompletions
```
(Students + Groups done. `AppSettings` does NOT need it — matched on `setting_key`.)

### 3. Full module-by-module migration, in panel order
Parents before children. Then run the **Photos** pass (feed the Students JSON)
once the `student-photos-profile` bucket exists in the destination.

### 4. Optional helper (offered, not built)
A scoped **"clear this org's migrated data"** button — deletes only rows with a
`source_id` in the current org — to make re-test cleanup one click.

### 5. Real cross-project move (later — currently parked)
Target was vidyasethu (separate account/DC). Destination tables need `source_id`
+ the photo bucket; the import endpoint runs on the receiving side. Parked per
"forget about vidyasethu for now."

## Gotchas to remember
- **IDs are 17-digit strings** — never `Number()` a ROWID/`source_id`. Use the
  exact string (`safeId`). `org_id` is the one exception: `req.orgId` is already a
  `Number` app-wide, so it stays consistent.
- Don't feed migration exports to the **Students page** importer — it expects a
  flat `[{name,...}]` array and reports "No valid students found in JSON". Use the
  migration panel's Import buttons.
- `catalyst deploy` wipes Console-set env vars — all env vars live in
  `functions/api/catalyst-config.json` (gitignored).

## Separate, unrelated pending work
- Landing-page introductory pricing (plan: `~/.claude/plans/starry-snuggling-tome.md`).
- Replace fictional testimonials before public launch.
