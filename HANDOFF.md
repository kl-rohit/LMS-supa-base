# Veena — Handoff for next session

Quick context to pick up from where the previous Claude session left off.
**Read this first.** The original v1 spec (single-tenant, pre-Catalyst-deep)
is preserved at `HANDOFF_v1_INITIAL_SPEC.md` for reference.

---

## What this is now

A **multi-tenant SaaS** music academy tracker. Multiple academies can sign
themselves up via `/app/signup` and operate independently on the same
deployment. Today only one is live (Veena Dhwani Academy), but the
plumbing supports any number.

- **Backend**: Node.js / Express monolith on Catalyst AdvancedIO (`functions/api`)
- **Frontend**: React + Webpack + Tailwind, served as a single Catalyst Web Client (`client/dist`)
- **Auth**: Catalyst Native Auth
  - "App Administrator" = platform owner (you, Rohit) — sees all orgs
  - "App User" = academy owners/teachers/parents — scoped to their org(s)
- **Multi-tenancy enforcement**: app-level via `org_id` column on every tenant table + `resolveOrg` middleware that gates every API request

---

## Repository state — most recent commits

```
981d010 Fix: org lookup precision, Camps gating, app branding
3a15d07 Org management + platform admin actions (Phase D + D.5)
17ce6c6 Mobile UX + photo cache + per-org module toggles
36071c4 Phase C: public /signup so academies can self-register
3c472be Phase B.2 + B.3: org-scope every remaining route + portal + cron
2033718 Phase B.1 + B.2 (Students): resolveOrg middleware + first org-scoped route
b9fe5bd Phase A: multi-tenancy foundation — bootstrap endpoint + schema verifier
```

All on `main`, pushed to `github.com/kl-rohit/Attendance-tracker`.

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
| Classes, ClassStudents | |
| Attendance | Fastest-growing table; queries use `zcqlAll` for pagination |
| AdditionalFees, Payments | |
| Messages | Drafts of WhatsApp messages to parents |
| MessageTemplates | `type` (Text unique) + `body` (Multi-line Text) |
| AppSettings | `setting_key` (Text 100 unique) + `setting_value` (Multi-line Text). NOT `key`/`value` — those are reserved words in Catalyst. |
| Courses, Lessons, LessonProgress, CourseEnrollments | Udemy-style lessons module |
| Camps, CampDays | Time-bounded special programs |
| **Organizations** | name, slug (unique), owner_user_id, status (active/suspended), plan (free/pro), logo_url |
| **OrgMemberships** | user_id, org_id (Bigint), role (owner/teacher/parent), status (active/invited/removed) |

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
- Cron expression: `30 12 28-31 * *` (= 6 PM IST on 28-31 of each month)
- Target: `POST .../server/api/api/internal/cron-fee-reminder`
- Header: `X-Cron-Secret: <CRON_SECRET value>`
- Behavior: endpoint self-checks "is today actually the last day of the
  month in IST?" — early-returns on days 28-30 if not. When it does run,
  loops every active Organization and generates per-org reminders.

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
| Multi-tenant SaaS | Self-serve signup, per-org isolation, platform admin (impersonate / suspend), org management (invite teachers, transfer ownership) |
| Settings | 5 tabs: School, Billing, Modules (enable/disable per-org), Templates, Organization |
| Mobile UX | Photo cache, YT thumbnail hiding on phone screens |
| Lessons module | YouTube + Google Drive document lessons, progress tracking, course player, per-org isolation |
| Communications | Customisable message templates with placeholder substitution; bulk WhatsApp send; auto absence/fee reminders; cron-driven monthly fee-reminder |
| Fees | Per-class + additional fees, monthly aggregation, masked totals (bank-style click-to-reveal), bulk mark paid |
| Students | Bank-style phone masking, bulk operations, slide-in detail panel, photo upload via Stratus (parent OR admin), DOB + birthdays card on Dashboard |
| Org branding | Renaming the academy updates the sidebar + browser tab title; logo upload replaces the music icon |
| Parent portal | Profile self-service (photo + Grade-exam details), Lessons, Attendance, Fees views — visibility per-org toggleable |
| Infrastructure | `deploy.sh` with verification gates, code-splitting (282 KiB initial bundle), ZCQL pagination, per-route org-scoping |

---

## 🔜 Pending tasks (priority-ordered)

### 1. Verify Attendance org_id stamping in production *(urgent)*

User reported on day-of-handoff that an attendance row inserted today
did not have `org_id` set. **The code IS correct** — every Attendance
insert (POST `/attendance`, `/attendance/adhoc`, `/attendance/bulk`,
and `/camps/days/:id/attendance`) explicitly stamps `org_id:
Number(req.orgId)` (audited in `routes/attendance.js` lines 145, 185,
244 and `routes/camps.js`).

**Most likely cause**: the row was created before commit `3c472be` was
deployed.

**Verification steps**:
1. Check the production deploy commit hash matches `981d010` (latest)
2. Insert a fresh attendance row via the UI
3. Catalyst console → Data Store → Attendance → newest row → confirm
   `org_id` column has a value
4. If still null, dump the Express logs from the function. The
   `console.error` in the insert path will show the cause.

### 2. Slug in URL (`/app/o/<slug>/...`)

React Router restructure. Every route prefixed with `/o/<slug>/`. The
slug propagates as `?org=<id>` to API calls. Org switcher UI in sidebar
for users with 2+ memberships. ~1.5 hrs.

### 3. PWA — installable on mobile home screens

`public/manifest.json` (icons, theme color, display: standalone). Link
from `index.html`. Basic service worker for offline shell cache. ~2 hrs.

### 4. CSV export

Settings → new "Export" tab. Org-scoped downloads:
`Students.csv`, `Attendance.csv`, `Fees+Payments.csv`, `Messages.csv`.
Streamed from API on the fly. ~1.5 hrs.

### 5. Courses revamp — one-click enrollment + simpler creation

- Inside Students slide-in panel: "Enroll in..." dropdown
- Strip the lesson creation form (drop chapter timestamps + duration;
  auto-detect from YouTube URL)
- ~1.5 hrs

### 6. Quizzes (MCQ at end of lesson)

New tables:
- `LessonQuizzes` (lesson_id, question, options JSON, correct_index,
  explanation, order_index, org_id)
- `QuizAttempts` (student_id, lesson_id, score, attempts,
  last_attempted_at, org_id)

Teacher authors via Lessons admin; student attempts in portal
CoursePlayer; ≥70% required to mark lesson complete. ~6-8 hrs.

### 7. Q&A — threaded async comments per lesson

New table `LessonComments` (lesson_id, user_id, parent_comment_id for
threading, body, is_answer, org_id). Side panel in CoursePlayer:
student posts, teacher answers. Optional WhatsApp notify on teacher
reply. ~5-6 hrs.

### 8. Course completion certificates (PDF)

Auto-generate when student completes all lessons in a course.
Backend: GET `/api/portal/courses/:id/certificate`.
Choice between jsPDF (client-side) or Catalyst SmartBrowz (server-side
HTML→PDF). Template: school name, student, course, date, signature.
~3-4 hrs.

### 9. Housekeeping

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
    auth.js                      — /me, /logout, /signup (public)
    platform.js                  — /platform/* (Catalyst App Administrator only)
    organization.js              — /organization/* (per-org mgmt: invite, transfer, logo)
    students.js                  — Students CRUD + photo-urls batch + admin photo upload
    groups.js, classes.js, attendance.js, fees.js, messages.js,
    reports.js, dashboard.js, lessons.js, courses.js, enrollments.js,
    camps.js, import.js, student-logins.js, settings.js, portal.js
    internal.js                  — cron endpoints (shared-secret auth, loops all orgs)
  lib/
    feeReminder.js               — shared fee-reminder generator (used by route + cron)
    photoUpload.js               — Stratus pipeline (validate, resize, upload, sign)
    image.js                     — jimp resize/compress
  db/catalystDb.js               — Catalyst SDK helpers + zcql + zcqlAll + safeId

client/src/
  App.jsx                        — TeacherLayout + routing + role-gated nav
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
    Platform.jsx                 — Cross-org admin (App Administrator only)
    Login.jsx, Signup.jsx        — public auth flows
    portal/                      — Parent portal pages (Dashboard, Lessons, Attendance,
                                    Fees, Profile, CoursePlayer, Courses)
  components/
    StudentDetailPanel.jsx       — Slide-in detail with top toolbar
    TemplatesEditor.jsx          — Inline templates editor (used in Settings)
    Modal.jsx, ConfirmDialog.jsx, Loader.jsx, EmptyState.jsx, Select.jsx
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
> ZCQL 300-row cap).
>
> Two things to tackle first:
> 1. **Verify** the production deploy actually includes commit
>    `981d010` (latest), then insert a test attendance row and
>    confirm the `org_id` column gets stamped. The user reported a
>    row without `org_id` shortly before handoff — code is correct
>    in `attendance.js`, suspect deploy lag.
> 2. **Continue** the pending task list — likely PWA (~2 hrs) and
>    CSV export (~1.5 hrs) as the next batch, or jump straight to
>    Courses revamp / Quizzes if user prefers.
