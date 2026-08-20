# Module rules & QA spec

One section per module. Each lists the module's **purpose**, its **validation
& limits**, the **invariants** that must always hold, and a short **QA
checklist**. This is the reference the e2e/unit tests are built against — when a
rule changes, update it here first, then the test.

Conventions that apply to **every** module:

- **Tenant isolation** — every query is scoped by `org_id`; a user of academy A
  must never see or affect academy B's data. (App-layer today; no RLS yet.)
- **No horizontal scroll** — pages scroll vertically only. Wide content (tables,
  timetable) scrolls inside its own `overflow-x-auto` box, never the page. A
  global `html,body{overflow-x:clip}` guard backstops this.
- **Money is formatted** — every rupee value shown to a user uses Indian digit
  grouping (`toLocaleString('en-IN')`), never a raw number and never scientific
  notation. Fee inputs are capped at **₹10,00,000** per line (client + server).
- **Validation is per-field** — inline message + highlight; the first invalid
  field is focused. No silent failures, no harsh copy.
- **Dark mode** — base classes auto-theme; never hardcode a dark colour.
- **Destructive actions confirm** — and soft-delete (archive/deactivate) is
  preferred over hard delete for anything with dependents.

---

## Students
- **Purpose:** roster of learners; the root record most modules hang off.
- **Validation & limits:** name required; phone 10 digits; email shape-checked;
  monthly/per-class fees are non-negative and ≤ ₹10,00,000.
- **Invariants:** delete is **soft** (`status: 'inactive'`) — lessons, fees and
  attendance are retained; a student over the plan's cap cannot be re-activated
  past the limit.
- **QA checklist:** create / edit / deactivate / reactivate; Active/Inactive/All
  filter works; "delete all inactive" only removes inactive; card layout on
  mobile has no sideways scroll.

## Groups / Batches
- **Purpose:** named groupings of students for classes and messaging.
- **Validation & limits:** name required; duplicate name rejected with a clear
  message; members must belong to the same org.
- **Invariants:** delete is **soft** (`status: 'inactive'`); adding/removing a
  member shows a named confirmation ("X added to this group").
- **QA checklist:** create, add/remove members, Active/Inactive/All filter,
  reactivate.

## Attendance
- **Purpose:** mark present/absent per student per class/date; drives fees.
- **Validation & limits:** a record needs a student + date + status; ad-hoc mode
  needs at least one student.
- **Invariants:** **Present renders green** (`bg-green-500`), Absent red; default
  status on a fresh roster is present; marking absent zeroes that line's fee;
  editing a record is **hard** delete/update of that row only.
- **QA checklist:** today vs any-class toggle; mark-all present/absent; ad-hoc;
  recorded view groups by class with correct present/absent/late counts and a
  green "present" pill.

## Fees
- **Purpose:** monthly aggregation (class fees + additional − discount),
  payments, reminders, UPI/QR.
- **Validation & limits:** amount required, non-negative, **≤ ₹10,00,000**
  (client + server); payments cannot be negative. Discounts are stored as
  negative additional fees.
- **Invariants:** amounts always display grouped, never `e+23`; masked/partial
  fee figures stay masked by design; a reminder's `{amount}` is formatted.
- **QA checklist:** add/edit/remove additional fee; record payment; a huge or
  fractional amount is rejected client- and server-side; reminder preview shows
  a clean rupee figure.

## Classes / Timetable
- **Purpose:** weekly schedule; online/in-person/group classes; join links.
- **Validation & limits:** start < end; valid days; meeting link is a URL.
- **Invariants:** the week grid scrolls inside its own box (never the page);
  deleting a class **hard**-deletes it and its rosters; a single-date
  cancel/reschedule is an exception, not a delete.
- **QA checklist:** create recurring class, multi-day repeat, exception, online
  link renders "Join"; grid has no page-level sideways scroll on mobile.

## Camps
- **Purpose:** short-term intensives with their own dates/roster.
- **Invariants:** delete is **soft** (`status: 'archived'`); Active/Completed/
  Archived filter exists; a cancelled camp day is `status: 'cancelled'`.
- **QA checklist:** create camp, add days, cancel a day, archive, filter.

## Messages & Notifications
- **Purpose:** WhatsApp/in-app messaging, templates, absence/fee alerts, bell,
  web-push, morning digest.
- **Validation & limits:** template placeholders (`{name}`,`{amount}`,…) resolve;
  money placeholders are formatted; unknown placeholders stay literal.
- **Invariants:** a fee reminder never shows scientific notation; sending marks
  `is_sent`; bulk send fans out per recipient; delete is **hard** (single row).
- **QA checklist:** compose with template, generate reminders, WhatsApp/in-app/
  copy actions, no `e+23` anywhere.

## Reports
- **Purpose:** attendance/fee analytics, per-student statements, PDF export.
- **Validation & limits:** date/month ranges valid; empty ranges show an empty
  state, not an error.
- **Invariants:** every figure is formatted rupees; charts + tables agree.
- **QA checklist:** switch ranges, export PDF, mobile card fallback for tables.

## Lessons / Courses (+ quizzes, certificates)
- **Purpose:** video courses, lessons, quizzes, completion certificates.
- **Invariants:** course delete is **soft** (`status: 'archived'`) with an
  Active/Archived/All filter and a Restore action; a quiz gates certificate
  issue; content is org-scoped.
- **QA checklist:** create course, archive + restore, quiz pass/fail, cert issue.

## Assignments & Question Papers
- **Purpose:** distribute assignments / papers to students.
- **Invariants:** delete is **hard** (plus dependent completions); quiz-type rows
  are hidden from the Assignments list.
- **QA checklist:** create, deliver, complete (portal), delete.

## Settings
- **Purpose:** academy config — fee modes, class modes, schedule/working hours,
  branding, appearance, templates, UPI/QR, billing reminder day.
- **Validation & limits:** only whitelisted keys accepted server-side; working
  hours start < end.
- **Invariants:** an academy cannot change platform-managed keys (plan, trial,
  caps); appearance persists per user.
- **QA checklist:** each tab saves; modals/settings not broken by a wrapper
  transform (known past regression); dark-mode legibility.

## Parent Portal
- **Purpose:** per-family login; attendance/fees at a glance; "for you" feed;
  assignments/papers; fee QR.
- **Invariants:** a parent sees only their student(s), scoped by `student_id`;
  multi-academy parents switch org via `?org=`; auto-theme.
- **QA checklist:** login, glance cards, feed, pay-by-QR, sign out (no
  auto-relogin), sign-out-other-devices.

## Platform Admin
- **Purpose:** owner console — orgs, plans/trials, suspend, MRR, funnel, audit,
  feature flags, export, broadcast, pricing (Plans tab), leads (Requests).
- **Validation & limits:** admin-auth only; pricing values non-negative.
- **Invariants:** an academy with data **cannot** be deleted (409 + list of
  non-empty modules) — only an empty org is deletable; suspend locks out all
  members immediately and is reversible; pricing edits flow live to the public
  site via `/api/pricing`.
- **QA checklist:** suspend/reactivate, change plan/trial, delete empty org,
  edit prices → site reflects them, new lead appears under Requests.
