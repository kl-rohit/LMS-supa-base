# Veena — Handoff for next session

Quick context to pick up from where the previous Claude session left off.
**Read this first.** The original v1 spec (single-tenant, pre-Catalyst-deep)
is preserved at `HANDOFF_v1_INITIAL_SPEC.md` for reference.

---

## What this is now

A **multi-tenant SaaS** music academy tracker. Multiple academies operate
independently on the same deployment. Today only one is live (Veena Dhwani
Academy), but the plumbing supports any number.

**Academy signup is invite-only.** New academies are created by the platform
admin (Rohit) via the Platform page's "Create academy" form — there is no
public self-serve signup. `/app/signup` now redirects to `/login`, and
`POST /api/auth/signup` 403s unless the caller is a Catalyst App Administrator.

- **Backend**: Node.js / Express monolith on Catalyst AdvancedIO (`functions/api`)
- **Frontend**: React + Webpack + Tailwind, served as a single Catalyst Web Client (`client/dist`)
- **Auth**: Catalyst Native Auth + app-data role resolution
  - Catalyst role "App Administrator" = platform owner (you, Rohit) — sees all orgs
  - Catalyst role "App User" = everyone else (academy owners/teachers/parents)
  - **Frontend routing keys off a server-computed `app_role`**, NOT the Catalyst
    role (see "Role routing & invite-only signup" below). This is because
    signup creates owners as plain `App User`s — same Catalyst role as parents.
- **Multi-tenancy enforcement**: app-level via `org_id` column on every tenant table + `resolveOrg` middleware that gates every API request

---

## Repository state — most recent commits

```
c54e2cf Remove orphaned public Signup page
ec81dda Invite-only signup + app_role routing fix, PWA, theming, mobile polish
981d010 Fix: org lookup precision, Camps gating, app branding
3a15d07 Org management + platform admin actions (Phase D + D.5)
17ce6c6 Mobile UX + photo cache + per-org module toggles
36071c4 Phase C: public /signup so academies can self-register
3c472be Phase B.2 + B.3: org-scope every remaining route + portal + cron
2033718 Phase B.1 + B.2 (Students): resolveOrg middleware + first org-scoped route
b9fe5bd Phase A: multi-tenancy foundation — bootstrap endpoint + schema verifier
```

All on `main`, pushed to `github.com/kl-rohit/Attendance-tracker`.
Live deploy stamped commit `c54e2cf` (verified via `/api/health`).

---

## How to deploy

```bash
cd /Users/rohit-10558/Documents/Veena-web-app
./deploy.sh
```

The script:
1. Runs `cd client && npm run build` — builds with `PUBLIC_URL=/app/` and
   copies `public/client-package.json` to `dist/` and emits `404.html`
2. Sanity-checks the artefacts (refuses to deploy if anything's missing)
3. Runs `catalyst deploy`

**Never use raw `npx webpack --mode production`** — it skips the
Catalyst-specific publicPath + 404 fallback. The site will 404 on every
route after deploy. Always go through `./deploy.sh` or `npm run build`.

Dev URL: `https://veena-attendance-60070745325.development.catalystserverless.in`

---

## Catalyst console state (what should already exist)

### Data Store tables — 18 tenant tables + 2 meta tables

Every tenant table has an `org_id` (Bigint) column for multi-tenancy.

| Table | Notes |
|---|---|
| Students | Has `login_email`/`login_user_id`/`login_status` columns (parent portal logins live ON this table, not a separate table) |
| Groups, GroupStudents | |
| Classes, ClassStudents | `ClassStudents` now also stores **extra individual students added to a group/batch class** (tuition mode: pick a batch + add a few extras), not just multi-student individual classes. Roster = group members ∪ `ClassStudents` extras ∪ legacy single `student_id`. ⚠️ `Classes` NEEDS a new `exceptions` (Multi-line Text) column — backs timetable reschedule/cancel. See "Console actions" below. |
| Attendance | Fastest-growing table; queries use `zcqlAll` for pagination |
| AdditionalFees, Payments | |
| Messages | Drafts of WhatsApp messages to parents |
| MessageTemplates | `type` (Text unique) + `body` (Multi-line Text) |
| AppSettings | `setting_key` (Text 100 unique) + `setting_value` (Multi-line Text). NOT `key`/`value` — those are reserved words in Catalyst. |
| Courses, Lessons, LessonProgress, CourseEnrollments | Udemy-style lessons module. `Lessons.content_type` ∈ `video`/`document`/`quiz`. ⚠️ NEEDS a `quiz_required` (Boolean) column — see "Console actions" below |
| **LessonQuizzes** | MCQ bank, keyed by `lesson_id` (now points at a quiz-type lesson). Created ✅ |
| **QuizAttempts** | Per-student quiz results, keyed by `lesson_id`. Created ✅ |
| Camps, CampDays | Time-bounded special programs |
| **Organizations** | name, slug (unique), owner_user_id, status (active/suspended), plan (free/pro), logo_url |
| **OrgMemberships** | user_id, org_id (Bigint), role (owner/teacher/parent), status (active/invited/removed) |

### ⚠️ Console actions still required (quiz-as-lesson refactor)

The Q&A feature was **removed entirely**, and Quizzes were refactored into a
**first-class lesson type** (`content_type === 'quiz'`) that can be inserted
anywhere in a course — exactly like video/document lessons. `LessonQuizzes`
and `QuizAttempts` already key off `lesson_id`, so the only schema changes are:

1. **ADD a `quiz_required` (Boolean) column to the `Lessons` table.**
   - Set on quiz-type lessons only. When `true`, the lesson's quiz must be
     passed (≥70%) before the course certificate is offered. When `false`,
     the quiz is optional (students may skip it).
   - Code only ever sends `quiz_required` in the payload for quiz lessons, so
     video/document creation never references the column — safe to deploy even
     before the column exists, but quizzes won't gate correctly until it's added.

2. **DELETE the `LessonComments` table.** It backed the removed Q&A feature and
   is no longer referenced by any code.

`LessonQuizzes` and `QuizAttempts` are unchanged and already created.

### ⚠️ Console action required (timetable / class calendar)

3. **ADD an `exceptions` (Multi-line Text) column to the `Classes` table.**
   Backs cancel/reschedule of a single dated class occurrence from the
   timetable view. It holds a JSON array (one entry per overridden date, keyed
   by `date`):

   ```json
   [
     { "date": "2026-06-16", "status": "cancelled" },
     { "date": "2026-06-23", "status": "moved",
       "new_date": "2026-06-24", "new_start_time": "17:00",
       "new_end_time": "18:00", "note": "" }
   ]
   ```

   We chose a JSON column over a separate `ClassExceptions` table because this
   is a single-teacher tuition workload where exceptions are sparse — fewer
   moving parts, lighter console step, and the data rides along with every
   `GET /classes` response (no extra fetch). The only trade-off is
   read-modify-write on the blob, negligible at this scale. Precedent:
   `AppSettings.setting_value` / `MessageTemplates.body` are also Multi-line
   Text holding structured values. `exceptions` is **not** a reserved word.

   Routes: `POST /api/classes/:id/exceptions` (body `{exception_date, status,
   new_date, new_start_time, new_end_time, note}`) and
   `DELETE /api/classes/:id/exceptions/:date`. `GET /api/classes` returns each
   class's parsed `exceptions` array. The frontend degrades gracefully to a
   plain recurring view if the column is missing (it just reads an empty array),
   so it's safe to deploy before adding the column — reschedule/cancel just
   won't persist until then.

### Stratus

One bucket: `student-photos-profile` (Authenticated, encryption on).
Stores:
- Student photos: key `student-<student_id>.jpg`
- Org logos: key `org-<org_id>-logo.jpg`

### Env vars (`functions/api/catalyst-config.json`)

- `CRON_SECRET` — long random string. Used by `/api/internal/*`
  shared-secret middleware. **The file is currently in git** —
  needs to be gitignored + a `.example.json` placeholder committed.

### Job Scheduling

Pre-defined Webhook Cron `monthly-fee-reminder`:
- Cron expression: `30 12 * * *` (= 6 PM IST, every day) — **changed from the
  old `30 12 28-31 * *`; update this in the Catalyst console**, otherwise
  academies configured for a fixed day outside 28-31 will silently never fire.
- Target: `POST .../server/api/api/internal/cron-fee-reminder`
- Header: `X-Cron-Secret: <CRON_SECRET value>`
- Behavior: fires daily, loops every active Organization, and each org
  decides for itself whether TODAY (IST) is its trigger day — configurable
  per academy in Settings → Billing → "Monthly fee reminders":
    - `last_day` (default) — the actual last calendar day of that month.
    - `fixed_day` — a specific day, 1-28 (billing.fee_reminder_day).
  Orgs whose trigger doesn't match today are recorded as `skipped: true` in
  that org's summary entry, with no other side effects.
- On success, each org whose reminders actually got created (skips a month
  with nothing owed) also gets an admin-only in-app + push notification
  ("Fee reminders ready for <Month> <Year>") that opens Messages on tap.
  Idempotent the same way as the class digest, so a cron retry can't
  double-notify.

Pre-defined Webhook Cron `cleanup-notifications` (NEW — add this job):
- Cron expression: `30 21 * * *` (= 3 AM IST, every day; any low-traffic hour
  works, this just avoids clashing with the fee-reminder/digest crons)
- Target: `POST .../server/api/api/internal/cron-cleanup-notifications`
- Header: `X-Cron-Secret: <CRON_SECRET value>`
- Behavior: deletes notifications that are BOTH read (`is_read`) AND older
  than 3 days (`NOTIF_CLEANUP_MAX_AGE_DAYS` in internal.js), per active org.
  Unread notifications are never touched, however old. Keeps the
  Notifications table from growing unbounded, which keeps every future read
  against it (the bell list, the digest de-dup checks) cheaper.

---

## Multi-tenancy architecture

### Middleware chain (in `functions/api/index.js`)

```
/api/auth          → public
/api/internal      → shared-secret (X-Cron-Secret header)
/api/portal        → requireAuth + requireParent (sets req.studentId + req.orgId)
/api/platform      → requireAuth + requireAdmin (Catalyst App Administrator only)
/api/<every tenant route> → requireAuth + resolveOrg + requireOrgId
```

### What `resolveOrg` does

1. Looks up `OrgMemberships` for the calling user
2. Sets `req.orgId` (Number) + `req.orgRole` (owner/teacher/parent)
3. If platform admin + `?org=<id>` in URL → impersonates that org
4. 403 if the org's status is `suspended` (platform admin bypass)

### Every tenant route follows this pattern

```js
// SELECT
WHERE Table.org_id = ${Number(req.orgId)}

// INSERT
{ ..., org_id: Number(req.orgId) }

// UPDATE / DELETE
const existing = await getById(req, 'Table', id);
if (!existing || Number(existing.org_id) !== Number(req.orgId)) {
  return res.status(404).json({ error: 'Not found' });
}
```

---

## Role routing & invite-only signup

**The problem this solves:** Catalyst Native Auth assigns every signed-up user
the `App User` role by default (signup never sets a role). So academy owners
and parents have the *same* Catalyst role. The frontend used to route on the
Catalyst role, so a freshly-created owner got sent to the **parent portal** and
hit an "Account not set up yet" dead-end. (Admin *API* routes were never
affected — they gate on `OrgMembership` via `resolveOrg`, not the Catalyst role.)

**The fix (server-computed `app_role`):**

- `GET /api/auth/me` returns `user.app_role` ∈ `{'admin','parent','unlinked'}`,
  computed by `resolveAppRole(req, user)` in `routes/auth.js`:
  - `'admin'` if Catalyst `App Administrator`, OR an **active** OrgMembership
    with role in `['owner','admin','teacher']`
  - `'parent'` if a `Students` row has `login_user_id = userId`
  - `'unlinked'` otherwise
- Frontend `RequireAuth.jsx`: `roleHome(appRole)` → `'/dashboard'` for admin,
  `'/portal/dashboard'` otherwise; the guard redirects on `app_role` mismatch.
- This auto-rescues any previously-stuck owner (they now resolve to `'admin'`
  via their owner membership and land on the teacher dashboard).

**Invite-only signup:**

- `POST /api/auth/signup` is gated at the top: 403 unless the caller's Catalyst
  role is `App Administrator`.
- `client/src/App.jsx`: `/signup` route → `<Navigate to="/login" replace />`.
  `Signup.jsx` was **deleted** (orphaned).
- `Login.jsx`: removed the "Create a new academy" link; now says signup is
  invite-only.
- Platform admins create academies via the **"Create academy"** button on
  `Platform.jsx` (a collapsible invite form that POSTs to `/auth/signup`).
- The parent portal's unlinked screen (`portal/Dashboard.jsx`) now shows the
  signed-in email in a copy box + a Sign-out button, guiding the user to share
  that exact email with their teacher (or sign in with the invited email).

---

## ⚠️ Critical gotchas — read before editing

### 1. Catalyst ROWIDs exceed JS Number precision

ROWIDs are 17-digit numbers > `Number.MAX_SAFE_INTEGER` (~9e15).
`Number("34954000000139895")` silently rounds.

**Where it bites**: When the bootstrap did `org_id: Number(orgRow.ROWID)`,
it stored a rounded value in OrgMemberships + tenant tables. But
`Organizations.ROWID` is the precise original. They don't match.
`getById('Organizations', req.orgId)` fails because Catalyst's lookup
uses the precise string.

**Current workaround**: `findOrgByLossyId()` in `routes/organization.js`
iterates all orgs and matches via `Number(o.ROWID) === Number(req.orgId)` —
both sides round consistently so this comparison is reliable.

**Proper fix (not done)**: write a migration endpoint that re-writes
every `org_id` column with the precise ROWID string. Will let us drop
the iteration workaround.

### 2. Reserved column names in Catalyst

`key`, `value`, `index`, `from`, `to`, `order`, `group`, `user`,
`password` — all reserved. Console rejects them on column creation.
Use prefixed names: `setting_key`, `setting_value`, `order_index`, etc.

### 3. ZCQL 300-row silent cap

`SELECT * FROM Table` returns max 300 rows with no error or signal.
`zcqlAll(req, baseQuery, tableName)` in `db/catalystDb.js` paginates
with LIMIT/OFFSET. Use it for anything that can grow past 300:
Attendance, AdditionalFees, LessonProgress, Messages, CourseEnrollments.

### 4. `catalyst deploy` wipes console env vars

The CLI replaces the function's env vars with what's in
`catalyst-config.json`. Don't set secrets in the console UI — they'll
disappear on the next deploy.

### 5. The Catalyst build needs PUBLIC_URL=/app/

`npm run build` in `client/` sets this correctly. Raw `webpack` won't,
and the deployed site 404s on every route because asset paths are wrong.

---

## ✅ What's shipped (recent → older highlights)

| Area | Notes |
|---|---|
| Class timetable / calendar | Week-at-a-glance time-grid in `Classes.jsx` (Timetable｜List switcher). Desktop = 7-column time grid, Sun-first; mobile = swipeable single-day agenda. Click an empty slot to add a class prefilled with that day + start time (tuition mode = pick a batch + add extra students; class auto-named from roster). Tap an occurrence → action sheet: Mark attendance (deep-links to `/attendance?date=&class=`), Reschedule this date, Cancel this date, Edit recurring class. Date-aware: reschedule/cancel write to the `Classes.exceptions` JSON column (single occurrence; recurring class untouched). Roster labels resolved client-side from loaded students/groups (no N+1). **Code built, uncommitted; needs `exceptions` column on `Classes`.** |
| Multi-tenant SaaS | Invite-only academy creation (platform admin), per-org isolation, platform admin (impersonate / suspend / create academy), org management (invite teachers, transfer ownership) |
| Role routing | Server-computed `app_role` (admin/parent/unlinked) drives frontend routing; fixes owners landing in the parent portal |
| PWA | Installable on mobile home screens — `manifest.json` + service worker (scope locked to `/app/`) |
| Settings | 5 tabs: School, Billing, Modules (enable/disable per-org), Templates, Organization |
| Mobile UX | Photo cache, YT thumbnail hiding on phone screens |
| Lessons module | YouTube + Google Drive document lessons, progress tracking, course player, per-org isolation. Lessons have a `content_type` (`video`/`document`/`quiz`) and can be reordered freely. |
| Quizzes (first-class lessons) | A quiz is its own lesson type — insert it anywhere in a course like a video or document. Two-step authoring: create the quiz lesson (title + section + "required to earn certificate" toggle), then author MCQs in `QuizEditor`. Portal: full-width, one-question-at-a-time flow with progress dots, pass/fail result + per-question review. Navigation is always soft (students may skip any quiz); a **required** quiz must be passed (≥70%) before the certificate unlocks. **Code built, uncommitted; needs `quiz_required` column on Lessons.** |
| Certificates | Client-side jsPDF "Certificate of Completion" (lazy-loaded chunk) once every content lesson is consumed AND every required quiz is passed. **Code built, uncommitted** |
| Communications | Customisable message templates with placeholder substitution; bulk WhatsApp send; auto absence/fee reminders; cron-driven monthly fee-reminder |
| Fees | Per-class + additional fees, monthly aggregation, masked totals (bank-style click-to-reveal), bulk mark paid |
| Students | Bank-style phone masking, bulk operations, slide-in detail panel, photo upload via Stratus (parent OR admin), DOB + birthdays card on Dashboard |
| Org branding | Renaming the academy updates the sidebar + browser tab title; logo upload replaces the music icon |
| Parent portal | Profile self-service (photo + Grade-exam details), Lessons, Attendance, Fees views — visibility per-org toggleable |
| Infrastructure | `deploy.sh` with verification gates, code-splitting (282 KiB initial bundle), ZCQL pagination, per-route org-scoping |

---

## 🔜 Pending tasks (priority-ordered)

> **STATUS UPDATE — 2026-06-27.** Most of the list below is now done or
> obsolete. Current reality (everything deployed; live health endpoint reports
> the latest commit):
>
> | Item | State |
> |---|---|
> | 1. Attendance `org_id` stamping | ✅ Resolved (audit confirmed code correct). |
> | 2. Slug in URL `/app/o/<slug>/` | ❎ Obsolete — replaced by the OrgSwitcher + `?org=` active-org approach. |
> | 3. CSV export | ✅ Done — per-module CSV in Settings → **Backup & migrate** (`DataMigration.jsx`). |
> | 4. Courses revamp (one-click "Enroll in" from student panel, simpler lesson form) | ⏳ Still open (optional enhancement). |
> | 5. Quizzes + Certificates | ✅ Built, deployed, live. |
>
> **Console columns** flagged below are all in place (the features using them
> work live): `Classes.exceptions`, `Lessons.quiz_required`,
> `CourseEnrollments.completed_count`.
>
> **Shipped since this doc was last hand-edited** (admin + portal, all live):
> N+1 read-batching + short-TTL org caches; precomputed `completed_count`;
> offline games + PWA hardening (chunk self-heal, SW auto-update prompt, error
> boundary, offline read-cache); parent engagement (weekly digest cron,
> streak/progress badges); per-org Stratus backup cron; **online meeting-link
> share** (Classes + Attendance → push via the `online_meeting` template);
> timetable-exception–aware "today's classes" across Attendance, Dashboard and
> the morning digest.
>
> **Console / ops still to confirm:** the `weekly-digest` and `backup` Job
> Scheduling crons (Webhook + `X-Cron-Secret`), and a one-time
> `POST /api/enrollments/recompute` after adding `completed_count`.
>
> The original (now mostly historical) list follows.

### 1. Verify Attendance org_id stamping in production *(urgent)*

User reported on day-of-handoff that an attendance row inserted today
did not have `org_id` set. **A full audit on `2026-06-14` confirmed
the code IS correct** — every INSERT in the codebase stamps `org_id`,
and every UPDATE/DELETE checks `Number(existing.org_id) === Number(req.orgId)`
before mutating.

**Audit results** (commit `dd37dfe`):

| Path | File:line | Has org_id? |
|---|---|---|
| POST `/api/attendance` | attendance.js:134 | ✅ |
| POST `/api/attendance/adhoc` | attendance.js:174 | ✅ |
| POST `/api/attendance/bulk` | attendance.js:250 | ✅ |
| POST `/api/camps/days/:id/attendance` | camps.js:167 | ✅ |
| POST `/api/import/attendance` | import.js:60 | ✅ |
| Cron Messages insert (`feeReminder.js`) | lib/feeReminder.js:128 | ✅ |
| Every other table's INSERT/UPDATE | all files | ✅ |

**Most likely cause of the reported issue**: the row was created before
commit `3c472be` was deployed. Phase B.2 (3c472be) is what added org_id
stamping; anything inserted on an older deploy would have null org_id.

**Verification steps**:
1. Verify the deployed commit is `dd37dfe` or later: `git rev-parse HEAD`
   on the local machine matches the latest deploy.
2. Insert a fresh attendance row via the UI (admin → Attendance → mark
   a student present).
3. Catalyst console → Data Store → Attendance → sort by `CREATEDTIME`
   descending → top row → confirm `org_id` column has a value
   (will be the lossy Number version of Veena's Organizations.ROWID).
4. If still null after a fresh insert, dump the function logs in
   Catalyst console → DevOps → Logs → look for "Failed to create
   attendance" with a stack trace.

### 2. Slug in URL (`/app/o/<slug>/...`)

React Router restructure. Every route prefixed with `/o/<slug>/`. The
slug propagates as `?org=<id>` to API calls. Org switcher UI in sidebar
for users with 2+ memberships. ~1.5 hrs.

### 3. CSV export

Settings → new "Export" tab. Org-scoped downloads:
`Students.csv`, `Attendance.csv`, `Fees+Payments.csv`, `Messages.csv`.
Streamed from API on the fly. ~1.5 hrs.

### 4. Courses revamp — one-click enrollment + simpler creation

- Inside Students slide-in panel: "Enroll in..." dropdown
- Strip the lesson creation form (drop chapter timestamps + duration;
  auto-detect from YouTube URL)
- ~1.5 hrs

### 5. Quizzes (as lessons) + Certificates — ✅ built, ⏳ not deployed

**Code-complete and builds clean, but uncommitted.** The Q&A feature has been
fully removed. To finish shipping:

1. In the console: **ADD `quiz_required` (Boolean) to `Lessons`**,
   **DELETE the `LessonComments` table**, and **ADD an `exceptions` (Multi-line
   Text) column to `Classes`** (see "Console actions" above).
2. Commit the working-tree changes (note: the name/signature hardcoding
   fix is intentionally bundled here and was being held uncommitted — see
   the user before committing).
3. `./deploy.sh`, then smoke-test: create a quiz lesson mid-course, author
   MCQs, take it as a parent (skip an optional one, pass a required one),
   then complete the course → download certificate. Confirm a course with an
   unpassed *required* quiz does NOT offer the certificate.

What's wired:
- Backend: `routes/quizzes.js` (admin MCQ CRUD keyed by lesson_id); portal
  endpoints in `portal.js` (quiz take/submit, `GET /courses/:id/certificate`);
  `lessons.js` POST/PUT handle `content_type: 'quiz'` + `quiz_required`, and
  skip URL validation for quiz lessons; `quiz_count` batched into `GET /api/lessons`.
- Gating mirrored backend + frontend via `lessonFullyDone` (portal.js) /
  `lessonDone` (CoursePlayer.jsx): content lesson → `progress.completed`;
  optional quiz → done regardless; required quiz → done only once passed.
- Admin UI: `Lessons.jsx` lesson-type tabs (Video/Document/Quiz, locked after
  creation); creating a quiz lesson jumps straight into `QuizEditor.jsx`.
- Portal UI: `LessonQuiz.jsx` renders as the full-width main content for a
  quiz lesson in `CoursePlayer.jsx` (intro → one-question-at-a-time → review),
  with a soft "Next lesson" hand-off. Award/Certificate button when
  `allCourseComplete`.
- Certificate: `utils/certificate.js` → dynamic `import('jspdf')` (lazy
  chunk, keeps main bundle at 317 KiB).

### 5b. Class timetable / calendar (tuition-tuned)

**Code-complete and builds clean, but uncommitted.** A week-at-a-glance
time-grid that makes the app feel like a real "classes" product (closes the
biggest gap vs Zoho Classes).

1. In the console: **ADD an `exceptions` (Multi-line Text) column to `Classes`**
   (details in "Console actions" above). Safe to deploy before — the timetable
   degrades to a plain recurring view and reschedule/cancel just won't persist
   until the column exists.
2. Commit + `./deploy.sh` (bundled with the same uncommitted working tree as
   the quiz/cert/dark-theme work and the held name/signature fix).
3. Smoke-test: switch Classes to the Timetable view; click an empty slot →
   add a batch class with extra students; tap an occurrence → Reschedule and
   Cancel a single date; tap Mark attendance → confirms it lands on
   `/attendance` with the right date + class preselected and the merged roster.

What's wired:
- `components/Timetable.jsx` — self-contained week grid. Props
  `{ classes, students, groups, onAddSlot, onEditClass, onRefresh }`. Renders
  recurring `Classes` directly; reads each class's embedded `exceptions` array
  (no separate fetch) and calls `onRefresh` (the parent's `fetchData`) after a
  cancel/reschedule. Sun-first week to match the app. Desktop = 48px gutter + 7
  columns of absolutely-positioned blocks; mobile = swipeable single-day agenda.
  Roster labels resolved client-side from loaded students/groups.
- `routes/classes.js` — exceptions stored in the `Classes.exceptions` JSON
  column via `POST /:id/exceptions` + `DELETE /:id/exceptions/:date`
  (read-modify-write); `decorate()` parses it into an array on every read.
  `POST /` now also persists extra students to `ClassStudents` for group/batch
  classes (tuition group+extras); `PUT /:id` already replaces from `student_ids`.
- `pages/Classes.jsx` — Timetable｜List switcher; `openAddAt(day, time)`
  prefill; `deriveName()` auto-names from batch/student; create form sends a
  single payload with both `group_id` (groups) and `student_ids` (extras).
- `pages/Attendance.jsx` — `handleClassSelect` merges group members ∪
  `ClassStudents` extras ∪ legacy single `student_id` (deduped); reads
  `?date=`/`?class=` to prefill from the timetable's Mark-attendance action,
  then clears the query.

### 6. Housekeeping

- Gitignore `functions/api/catalyst-config.json` + commit
  `catalyst-config.example.json`
- PII/ePHI flag on `Students.mobile_number`, `email`, `address`
  (console-only, just a checkbox per column)
- Repair migration for ROWID precision issue
- Multi-teacher: largely handled by Phase D org management; needs
  testing once a second org exists
- Backup / data export — same as CSV export above

---

## Key file map

```
functions/api/
  index.js                       — Express app, route mounting + auth chain
  middleware/
    auth.js                      — requireAuth + requireAdmin (Catalyst role)
    org.js                       — resolveOrg + requireOrgId (multi-tenancy)
    parent.js                    — requireParent (sets req.studentId + req.orgId)
  routes/
    auth.js                      — /me (returns app_role via resolveAppRole),
                                   /logout, /signup (invite-only: 403 unless caller is App Administrator)
    platform.js                  — /platform/* (Catalyst App Administrator only)
    organization.js              — /organization/* (per-org mgmt: invite, transfer, logo)
    students.js                  — Students CRUD + photo-urls batch + admin photo upload
    groups.js, classes.js, attendance.js, fees.js, messages.js,
    reports.js, dashboard.js, lessons.js, courses.js, enrollments.js,
    camps.js, import.js, student-logins.js, settings.js, portal.js
    quizzes.js                   — /api/quizzes (admin MCQ CRUD, keyed by quiz-lesson id)
    internal.js                  — cron endpoints (shared-secret auth, loops all orgs)
  lib/
    feeReminder.js               — shared fee-reminder generator (used by route + cron)
    photoUpload.js               — Stratus pipeline (validate, resize, upload, sign)
    image.js                     — jimp resize/compress
  db/catalystDb.js               — Catalyst SDK helpers + zcql + zcqlAll + safeId

client/src/
  App.jsx                        — TeacherLayout + routing (role="admin" via app_role) + role-gated nav
  components/RequireAuth.jsx     — guards routes on user.app_role; roleHome() redirect
  layouts/ParentLayout.jsx       — Parent portal shell
  pages/
    Dashboard.jsx                — Stats + Birthdays card + Absence alerts
    Students.jsx                 — List + slide-in detail panel + bulk ops
    Groups.jsx, Classes.jsx      — (Classes has Camps tab gated by modules.camps)
    Attendance.jsx, Fees.jsx
    Messages.jsx                 — WhatsApp drafts + bulk send + compose
    Reports.jsx, Lessons.jsx
    StudentLogins.jsx            — Parent login mgmt
    Settings.jsx                 — 5 tabs (School/Billing/Modules/Templates/Organization)
    Platform.jsx                 — Cross-org admin + "Create academy" invite form (App Administrator only)
    Login.jsx                    — sign-in (signup is invite-only; Signup.jsx deleted)
    portal/                      — Parent portal pages (Dashboard, Lessons, Attendance,
                                    Fees, Profile, CoursePlayer, Courses)
  components/
    StudentDetailPanel.jsx       — Slide-in detail with top toolbar
    TemplatesEditor.jsx          — Inline templates editor (used in Settings)
    Modal.jsx, ConfirmDialog.jsx, Loader.jsx, EmptyState.jsx, Select.jsx
    QuizEditor.jsx               — admin MCQ authoring modal (opened when editing a quiz lesson)
    LessonQuiz.jsx               — portal quiz lesson (full-width main content in CoursePlayer)
  contexts/
    AuthContext.jsx              — current user + signout
    ConfirmContext.jsx           — global confirm() dialog
  hooks/
    useModuleFlags.js            — fetches per-org modules.* / portal.* toggles
    useOrgBranding.js            — org name + logo URL (localStorage cached)
    useRevealTimer.js            — bank-style click-to-reveal w/ auto-hide
  utils/
    api.js                       — fetch wrapper (auto ?org= for impersonation)
    photoCache.js                — photo URL localStorage cache w/ TTL
    youtube.js                   — YT/Drive URL parsing + thumbnails
    phone.js                     — mobile number normalize/mask/format
    mask.js                      — phone/email/amount masking helpers
    certificate.js               — jsPDF "Certificate of Completion" (dynamic import)

deploy.sh                        — one-shot build + verify + deploy script
catalyst.json                    — Catalyst project config
HANDOFF.md                       — THIS FILE
HANDOFF_v1_INITIAL_SPEC.md       — Original single-tenant spec doc (historical)
```

---

## Suggested opening prompt for next session

> Continuing work on the Veena Dhwani Academy multi-tenant SaaS music
> academy tracker. Read `HANDOFF.md` at the repo root for the current
> state, recent commits, console setup, pending tasks, and known
> gotchas (especially the Catalyst ROWID precision issue and the
> ZCQL 300-row cap). Note signup is now invite-only and frontend
> routing keys off a server-computed `app_role` — see "Role routing
> & invite-only signup".
>
> Where things stand:
> 1. **Quizzes are now a first-class lesson type** (insert anywhere, like
>    video/document) and the **Q&A feature was removed entirely**.
>    Certificates gate on all content consumed + all *required* quizzes
>    passed. Code is **complete and builds clean but is uncommitted**.
> 1b. **Class timetable / calendar** (tuition-tuned week time-grid with
>    reschedule/cancel + batch+extras roster) is also **complete, builds
>    clean, uncommitted**. To ship 1 + 1b: in the console **ADD
>    `quiz_required` (Boolean) to `Lessons`**, **DELETE the `LessonComments`
>    table**, and **ADD an `exceptions` (Multi-line Text) column to `Classes`**
>    (see "Console actions"), confirm with the user before committing (the
>    name/signature fix is bundled in the same uncommitted working tree), then
>    `./deploy.sh` and smoke-test.
> 2. **Next feature** per the user's list is **CSV export** (pending #3).
> 3. Still **awaiting user input**: a neutral product brand name; billing
>    tiers (plan only — don't build yet).
