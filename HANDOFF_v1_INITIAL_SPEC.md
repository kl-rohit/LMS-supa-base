# Veena — Build Handoff Document

A complete spec for rebuilding the Veena student-attendance app from scratch.
Frontend stays the same (React + Vite + Tailwind). **Backend is Catalyst from day one** (no SQLite intermediate step). Hand this doc + the existing `client/` folder to an agent or developer and they should be able to ship the full app.

---

## 1. Product overview

**Veena** is a single-tenant web app for a music teacher to manage students, classes, attendance, fees, parent communication, and reporting. Single user (the teacher). No authentication required for v1 — Catalyst's project domain is the only access control.

### What the teacher does each day
1. Opens **Attendance** → picks today's class → marks each student Present/Absent → enters topic taught → saves.
2. Looks at the **Absence Alerts** banner — students with ≥3 consecutive absences are highlighted.
3. Adds a class on the fly from **Classes** (recurring weekly schedule by day-of-week).
4. End of month: reviews **Fees** (auto-computed from attendance + class fee rate) → adds any one-off fees (books, stationery).
5. Sends WhatsApp-ready message links from **Messages** for fee reminders or absence follow-up.

### What's not in v1
- Multi-tenant / multi-teacher
- Real-time messaging (messages just generate WhatsApp deep-links the teacher clicks)
- Payment collection (we track what's owed, not what's paid)
- Login / role-based access
- Mobile native app

---

## 2. Tech stack

### Frontend (rebuild from same `client/` source if possible)
| Concern | Tool |
|---------|------|
| Framework | React 18 |
| Build | Vite 6 |
| Routing | react-router-dom v6 |
| Styling | Tailwind CSS 3 |
| Icons | `lucide-react` |
| Notifications | `react-hot-toast` |
| CSV import | `papaparse` |
| HTTP | native `fetch` (wrapped in `src/utils/api.js`) |

### Backend
| Concern | Catalyst service |
|---------|------------------|
| HTTP API | **AdvancedIO Functions** (Express apps exported as `module.exports = app`) |
| Database | **Data Store** (NoSQL row-store, queried via ZCQL — a SQL subset) |
| File hosting | **Web Client Hosting** (serves the built React app) |
| Outbound HTTP (Zoho Sheets sync) | function code uses global `fetch` to Zoho Sheet API v2 |
| Secrets | **Settings** table in Data Store (NOT environment variables — Zoho creds are entered through the Settings UI at runtime) |

### Catalyst project info
- Project ID: `34954000000015001`
- Data Center: **India** (`https://api.catalyst.zoho.in`, `https://console.catalyst.zoho.in`)
- Stack: Node 20 (`stack: "node20"` in `catalyst-config.json`)
- SDK: `zcatalyst-sdk-node@^3.4.0`

---

## 3. UI / Design system

### Colors (Tailwind classes)
| Role | Class |
|------|-------|
| Primary | `indigo-600` (buttons, active nav, accents) |
| Primary hover | `indigo-700` |
| Primary tint | `indigo-50` (selected nav background, totals row) |
| Success | `emerald-500` / `green-500` |
| Danger | `red-500` / `red-600` |
| Background | `gray-50` |
| Card | `white` with `border-gray-100`, `rounded-xl`, `shadow-sm` |
| Text primary | `gray-900` |
| Text secondary | `gray-500` / `gray-600` |
| Text muted | `gray-400` |

### Class-type color coding (used in Classes, Attendance, Dashboard, Fees)
| Class type | Border | Background | Icon |
|------------|--------|-----------|------|
| `online` | `blue-500` | `blue-50` | `Monitor` |
| `offline` | `emerald-500` | `emerald-50` | `MapPin` |
| `offline_group` | `purple-500` | `purple-50` | `UsersRound` |
| `online_group` | `cyan-500` | `cyan-50` | `Wifi` |

### Typography
- Font: system-ui (Tailwind default)
- Page header: `text-2xl font-bold text-gray-900 mb-6` (utility class `.page-header`)
- Table header: `text-xs font-semibold text-gray-500 uppercase tracking-wider`
- Body: `text-sm text-gray-700`

### Layout
- **Sidebar**: 256px fixed-width, collapsible drawer on mobile (`lg:translate-x-0`).
  - Logo: indigo square with `Music2` icon + "Veena" wordmark.
  - 9 nav items (see App.jsx list above) with lucide icons.
  - Active item: `bg-indigo-50 text-indigo-700`.
- **Top bar**: 64px, sticky, capitalized current route name, hamburger toggle on mobile.
- **Main content**: `p-4 lg:p-6`, scrollable.

### Reusable components (in `client/src/components/`)
| Component | Purpose |
|-----------|---------|
| `Modal` | Centered overlay with backdrop; props: `isOpen, onClose, title, size: 'sm'|'md'|'lg'` |
| `ConfirmDialog` | Simple yes/no modal; props: `isOpen, onClose, onConfirm, title, message, confirmText` |
| `Loader` | Centered spinner with optional `text` prop |
| `EmptyState` | Icon + title + message for empty data states; props: `icon, title, message` |
| `StatsCard` | Dashboard metric card; props: `icon, label, value, color` |

### Utility CSS classes (defined in `client/src/index.css` via `@apply`)
- `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-success`, `.btn-sm`
- `.input-field`, `.select-field`
- `.card`
- `.table-header`, `.table-cell`
- `.badge`, `.badge-online`, `.badge-offline`, `.badge-offline-group`

### Toast notifications
- `react-hot-toast`, top-right, 3s duration, dark background.
- Use `toast.success(...)`, `toast.error(...)` after every mutation.

---

## 4. Pages — detailed spec

### 4.1 Dashboard (`/dashboard`)
- 4 stat cards: Total Students, Today's Classes, This Month's Attendance, This Month's Fees.
- "Today's classes" list — each class card shows time, name, student/group, type badge. Click → Attendance.
- "Absence alerts" widget — students with ≥3 consecutive absences.
- Data source: `GET /api/dashboard`.

### 4.2 Students (`/students`)
- Searchable, sortable table (Name, Parent, Mobile, Fees, Status).
- **Add Student** modal: name, parent_name, mobile_number, fee_online, fee_offline, fee_offline_group, status, notes.
- **Import CSV**: `papaparse` parses a file with columns `name, parent_name, mobile_number, fee_online, fee_offline, fee_offline_group, notes` → POSTs each row.
- Soft-delete by default (sets `status='inactive'`); hard-delete with `?force=true`.
- "Delete all inactive" bulk action.
- Filter by status: All / Active / Inactive.

### 4.3 Groups (`/groups`)
- List of groups with name, description, member count.
- **Add Group** modal: name, description.
- Expand a group → see members, add/remove students from group.

### 4.4 Classes (`/classes`)
- **Weekly calendar view** — 7 cards (Sun–Sat). Today is highlighted with indigo ring.
- Each card shows the day's classes sorted by start_time.
- Class card: name, time range + duration, type badge, assigned student or group name.
- Filter chips at top: All / Online / Offline / Offline Group / Online Group.
- **Add Class** modal:
  - Inputs: name, class_type, day_of_week, start_time, end_time.
  - Duration shown live (computed from start/end).
  - If `class_type` is individual (online/offline): **multi-select students** with checkboxes, search, Select All / Clear → creates **one class with multiple students** (or one per student depending on architecture — see §6.3).
  - If `class_type` is group (offline_group/online_group): single Group dropdown.

### 4.5 Attendance (`/attendance`)
- Date picker (defaults to today) with ← → arrows.
- **Absence alerts banner** at top (red) listing students with ≥3 consecutive absences.
- Below the date picker: list of classes scheduled for that day-of-week.
- Click a class → renders an attendance table with one row per student:
  - Status (Present / Absent toggle)
  - Topic field (free text)
  - Fee shown when Present, editable (defaults to auto-calculated)
  - Trash icon to delete an existing record
- Running totals: `Present | Absent | ₹fee_total`.
- **Save Attendance** button → POST `/api/attendance/bulk`.
- **Delete All** button if existing records exist for the class+date.
- Planned (not yet shipped): **Custom Attendance** mode — skip class selection, multi-select students, pick class_type + duration, save without linking to a class.

### 4.6 Fees (`/fees`)
- Month selector (← → arrows + month/year dropdowns).
- Per-student row: classes_taken, class_fees_total, additional_fees_total, grand_total.
- Click row to expand → shows class-by-class breakdown for that month + additional fee items.
- **Add Additional Fee** modal: **multi-select students** + description + amount (per student) + date → creates one row per student.

### 4.7 Messages (`/messages`)
- Templates (5 pre-built): Fee Reminder, Absence Alert, General Reminder, Class Schedule, Custom.
- **New Message** modal: pick student → pick template → message body editable → save.
- Each message row has a "WhatsApp" button that opens `https://wa.me/<mobile>?text=<encoded message>` in a new tab.
- Mark sent (toggle `is_sent`), delete individual or bulk delete.
- "Generate Absence Alerts" button → creates a draft message for every student with ≥3 absences.
- "Generate Fee Reminders" button → creates a draft message for every student with outstanding fees this month.

### 4.8 Reports (`/reports`)
- 3 tabs: **Student** (per-student attendance + fee summary for date range), **Monthly** (table of all students × months), **Overall** (totals + breakdown by class type).
- Date range picker. Export buttons (CSV).

### 4.9 Settings (`/settings`)
- **Zoho Sheets integration setup**:
  - Expandable setup guide (3 steps: create Sheet, get OAuth, paste credentials).
  - Form: Client ID, Client Secret, Refresh Token, Region (`com` / `in` / `eu` / `au`).
  - **Test Connection** button → verifies OAuth works.
  - **Create Spreadsheet** button → creates a workbook with 6 tabs (Students, Groups, Classes, Attendance, Fees, Messages) + header rows.
  - **Sync All Data** button → wipes and re-pushes all DB data.
  - Auto-sync toggle (default on) → every mutation fires a background sync to update the matching Sheet row.

---

## 5. Data model — Catalyst Data Store tables

All column names are **snake_case**. System columns (`ROWID`, `CREATEDTIME`, `MODIFIEDTIME`) are auto-created by Catalyst — don't define them.

### Students
| Column | Type | Mandatory | Default |
|--------|------|-----------|---------|
| name | Text | ✓ | |
| parent_name | Text | ✓ | |
| mobile_number | Text | ✓ | |
| fee_online | Decimal | | 0 |
| fee_offline | Decimal | | 0 |
| fee_offline_group | Decimal | | 0 |
| status | Text | | `active` |
| notes | Text | | |

### Groups
| Column | Type | Mandatory | Notes |
|--------|------|-----------|-------|
| name | Text | ✓ | unique |
| description | Text | | |

### GroupStudents (M2M)
| Column | Type | Mandatory |
|--------|------|-----------|
| group_id | BigInt | ✓ |
| student_id | BigInt | ✓ |

### Classes
| Column | Type | Mandatory | Default |
|--------|------|-----------|---------|
| name | Text | ✓ | |
| group_id | BigInt | | nullable |
| student_id | BigInt | | nullable (legacy single-student field) |
| class_type | Text | ✓ | one of: online, offline, offline_group, online_group |
| day_of_week | Integer | ✓ | 0–6 (Sun–Sat) |
| start_time | Text | ✓ | HH:MM 24h |
| end_time | Text | ✓ | HH:MM 24h |
| duration_hours | Decimal | | 1 |
| is_active | Integer | | 1 |

### ClassStudents (M2M, for multi-student individual classes)
| Column | Type | Mandatory |
|--------|------|-----------|
| class_id | BigInt | ✓ |
| student_id | BigInt | ✓ |

### Attendance
| Column | Type | Mandatory | Default |
|--------|------|-----------|---------|
| student_id | BigInt | ✓ | |
| class_id | BigInt | | nullable (custom attendance has no class) |
| date | Text | ✓ | YYYY-MM-DD |
| status | Text | ✓ | present / absent / late |
| class_type | Text | ✓ | denormalized from class for reporting |
| duration_hours | Decimal | | 1 |
| fee_charged | Decimal | | 0 |
| topic | Text | | |
| notes | Text | | |

### AdditionalFees
| Column | Type | Mandatory |
|--------|------|-----------|
| student_id | BigInt | ✓ |
| description | Text | ✓ |
| amount | Decimal | ✓ |
| fee_date | Text | ✓ (YYYY-MM-DD) |
| month | Integer | ✓ (1–12) |
| year | Integer | ✓ |

### Messages
| Column | Type | Mandatory | Default |
|--------|------|-----------|---------|
| student_id | BigInt | | |
| parent_name | Text | | |
| mobile_number | Text | | |
| message | Text | ✓ | |
| message_type | Text | | `custom` (fee_reminder / absence_alert / schedule / general / custom) |
| is_sent | Integer | | 0 |

### Settings
| Column | Type | Mandatory | Notes |
|--------|------|-----------|-------|
| key | Text | ✓ | unique. Keys: `zoho_client_id`, `zoho_client_secret`, `zoho_refresh_token`, `zoho_region`, `zoho_access_token`, `zoho_token_expiry`, `zoho_spreadsheet_id`, `zoho_last_sync`, `zoho_auto_sync` |
| value | Text | ✓ | |

---

## 6. Business rules

### 6.1 Fee calculation
For every attendance record where `status ∈ {present, late}`:
```
fee_per_hour = student.fee_online           if class_type == 'online'
             | student.fee_offline          if class_type == 'offline'
             | student.fee_offline_group    if class_type ∈ {offline_group, online_group}

fee_charged = fee_per_hour × duration_hours
```
- For `absent` status → `fee_charged = 0`.
- The user can override `fee_charged` manually per record (input is editable).
- `duration_hours` is derived from `end_time − start_time` of the class, but stored on the attendance row (denormalized) so the report stays correct if class times change later.

### 6.2 Absence streak alerts
- Run on every attendance fetch: for each student, count consecutive `absent` records starting from the most recent date going backward.
- If streak ≥ 3 → student appears in the alerts banner with the count.
- Used to power the auto-generated "Absence Alert" messages.

### 6.3 Multi-student class creation (Classes page)
Two architectural choices — pick one when rebuilding:

**Option A (current code path):** One class row per student.
- POST `/api/classes` with `student_ids: [1, 2, 3]` → backend inserts 3 separate rows in the Classes table, each with one `student_id`.
- Simpler queries; each row stands alone.
- Downside: editing time/name in one place doesn't update siblings.

**Option B (cleaner):** One class row + many rows in ClassStudents.
- POST `/api/classes` with `student_ids: [1, 2, 3]` → one Classes row, three ClassStudents rows.
- Attendance fetch joins ClassStudents to list participants.
- Recommended for the rebuild.

### 6.4 Class-type fee mapping for groups
- `offline_group` and `online_group` both use `student.fee_offline_group` as the per-hour rate. There is no separate "online_group" fee column — the group discount applies regardless of online/offline.

### 6.5 Zoho Sheets sync (fire-and-forget)
- Every mutation route (POST/PUT/DELETE for Students, Groups, Classes, Attendance, Fees, Messages) calls `syncXxxCreate/Update/Delete(row)` AFTER the DB write succeeds.
- Sync functions are **non-blocking**: they wrap the work in `(async () => { ... })().catch(logError)` so the HTTP response is sent immediately.
- Sync functions first check `canSync()` — only run if `zoho_spreadsheet_id` is set in Settings.
- Access token is cached in Settings; auto-refreshes when within 5 min of expiry.

---

## 7. API contract

All routes mounted under `/api/`. Request/response bodies are JSON.

### Students
```
GET    /api/students                  → { students: [...], pagination?: {...} }
GET    /api/students/:id              → { student, groups, classes }
POST   /api/students                  → { student }
PUT    /api/students/:id              → { student }
DELETE /api/students/:id?force=true   → { message }
DELETE /api/students/inactive         → { message, count }
```

### Groups
```
GET    /api/groups                            → { groups: [...] }
GET    /api/groups/:id                        → { group, students }
GET    /api/groups/:id/students               → { students }
POST   /api/groups                            → { group }
POST   /api/groups/:id/students               body: { student_ids: [] } → { added: count }
PUT    /api/groups/:id                        → { group }
DELETE /api/groups/:id                        → { message }
DELETE /api/groups/:id/students/:studentId    → { message }
```

### Classes
```
GET    /api/classes                          → { classes }
GET    /api/classes/today                    → { classes, day_of_week }
GET    /api/classes/:id                      → { class }   (with group_members[] for group classes)
POST   /api/classes                          body: { ..., student_ids: [] | student_id, group_id } → { class } or { classes }
PUT    /api/classes/:id                      → { class }
DELETE /api/classes/:id                      → { message }
```

### Attendance
```
GET    /api/attendance                              query: ?class_id, ?student_id, ?from, ?to, ?date → { attendance: [...] }
GET    /api/attendance/by-date/:date                → { attendance }
GET    /api/attendance/by-student/:studentId        → { attendance }
GET    /api/attendance/absent-streaks/all           → { alerts: [{ student_id, student_name, consecutive_absences }] }
POST   /api/attendance                              → { attendance }
POST   /api/attendance/bulk                         body: { class_id, date, records: [{student_id, status, topic, fee_charged}] } → { results }
POST   /api/attendance/adhoc                        body: { date, class_type, duration_hours, topic, records: [...] } → { results }  (planned)
PUT    /api/attendance/:id                          → { attendance }
DELETE /api/attendance/:id                          → { message }
```

### Fees
```
GET    /api/fees/monthly/:year/:month       → { students: [{ student_id, student_name, class_fees, additional_fees, grand_total }] }
GET    /api/fees/student/:id                query: ?from, ?to → { ... }
GET    /api/fees/overall                    → totals
GET    /api/fees/additional                 query: ?month, ?year, ?student_id → { additional_fees }
POST   /api/fees/additional                 body: { student_ids: [] | student_id, description, amount, fee_date, month, year } → { additional_fee | additional_fees }
PUT    /api/fees/additional/:id             → { additional_fee }
DELETE /api/fees/additional/:id             → { message }
```

### Messages
```
GET    /api/messages                            → { messages }
POST   /api/messages                            → { message }
POST   /api/messages/generate-absence-alert     → { created: count }
POST   /api/messages/generate-fee-reminder      → { created: count }
PUT    /api/messages/:id                        body: { is_sent? | message? } → { message }
DELETE /api/messages/:id                        → { message }
```

### Reports
```
GET    /api/reports/student/:id              query: ?from, ?to → student report
GET    /api/reports/monthly/:year/:month     → monthly report
GET    /api/reports/overall                  → overall report
```

### Import
```
POST   /api/import/students                  body: { rows: [...] } → { imported: count }
POST   /api/import/attendance                body: { rows: [...] } → { imported: count }
```

### Dashboard
```
GET    /api/dashboard                        → { stats, today_classes, alerts }
```

### Settings (Zoho Sheets)
```
GET    /api/settings/zoho                          → { client_id?, client_secret? (masked), refresh_token? (masked), region, has_credentials }
PUT    /api/settings/zoho                          body: { client_id?, client_secret?, refresh_token?, region } → { ok }
POST   /api/settings/zoho/test                     → { ok }
POST   /api/settings/zoho/create-spreadsheet       → { spreadsheet_id, url }
POST   /api/settings/zoho/sync-all                 → { results: { table: count } }
GET    /api/settings/zoho/status                   → { enabled, spreadsheet_id, last_sync }
```

---

## 8. Catalyst architecture — recommended structure

```
veena/
├── catalyst.json                         # CLI binds here; functions targets list
├── client/
│   ├── public/
│   │   └── client-package.json           # { "name": "veena-client" }
│   ├── src/                              # React app (copy from existing)
│   ├── vite.config.js                    # base: process.env.VITE_BASE || '/'
│   └── package.json
└── functions/
    ├── students/                         # one AdvancedIO function per resource
    │   ├── index.js                      # Express app, module.exports = app
    │   ├── catalyst-config.json
    │   └── package.json
    ├── groups/
    ├── classes/
    ├── attendance/
    ├── fees/
    ├── messages/
    ├── reports/
    ├── dashboard/
    ├── import/
    └── settings/
```

### Standard `catalyst-config.json` per function
```json
{
  "deployment": {
    "name": "students",
    "stack": "node20",
    "type": "advancedio",
    "env_variables": {}
  },
  "execution": {
    "main": "index.js"
  }
}
```

### Standard `package.json` per function
```json
{
  "name": "veena-<name>-fn",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "express": "^4.21.1",
    "cors": "^2.8.5",
    "zcatalyst-sdk-node": "^3.4.0"
  }
}
```

### Top-level `catalyst.json`
```json
{
  "project": {
    "project_name": "veena",
    "id": "34954000000015001",
    "project_domain": "https://api.catalyst.zoho.in",
    "console_domain": "https://console.catalyst.zoho.in"
  },
  "envCwd": ".",
  "functions": {
    "targets": ["students", "groups", "classes", "attendance", "fees", "messages", "reports", "dashboard", "import", "settings"],
    "ignore": [],
    "source": "functions"
  },
  "client": {
    "name": "veena-client",
    "source": "client/dist"
  }
}
```

### Frontend → Catalyst URL mapping
Catalyst forwards `/server/<function_name>/<path>` to the function with the function prefix stripped. So the frontend's `BASE_URL` per resource is **different**:

```js
// client/src/utils/api.js — option 1: one BASE_URL, but route to different functions
// Simpler: just hit one "monolith" function `api` that mounts ALL the express routes.
const BASE_URL = '/server/api/api';
```

OR

```js
// option 2: per-resource base URLs
const BASES = {
  students: '/server/students/api',
  groups: '/server/groups/api',
  ...
};
```

**Recommended: Option 1 (single monolith `api` function).** Less deployment surface, no CORS issues across functions, the existing Express route files (one per resource) just `app.use(...)` into one function. Only break it out if cold-start becomes a problem (>1MB bundle).

### Reusable Catalyst Data Store wrapper

Put this in every function (or share via a `commons/` folder + symlink):

```js
const catalyst = require('zcatalyst-sdk-node');
function ds(req) { return catalyst.initialize(req); }

// Normalize a Catalyst row (snake_case + ROWID/CREATEDTIME) to the shape
// the React client expects (snake_case + numeric `id`).
function normalize(row) {
  if (!row) return row;
  return {
    ...row,
    id: row.ROWID,
    created_at: row.created_at || row.CREATEDTIME,
    updated_at: row.updated_at || row.MODIFIEDTIME,
  };
}

const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
```

### ZCQL quirks to know

- Table names ARE case-sensitive (`Students` not `students`).
- Column references in WHERE/ORDER BY MUST be qualified: `Students.name = 'X'`, NOT `name = 'X'`.
- Results come back nested under the table name: `rows[i].Students.name`.
- No JOINs — emulate by issuing two queries and stitching in JS.
- No transactions — sequential awaits with try/catch around each.
- ROWID is auto-generated, used everywhere as the primary key.

---

## 9. Step-by-step build plan

### Phase 1 — Project setup (½ day)
1. `catalyst login` (pick zoho.in DC)
2. Create a new Catalyst project in the console; copy project ID.
3. `catalyst init` in repo root → creates `catalyst.json`.
4. Create all 9 Data Store tables (use the existing `scripts/create-catalyst-tables.js` as the source of truth for column specs, run it with a Self Client OAuth token).

### Phase 2 — Monolith function scaffold (½ day)
1. Create `functions/api/` with `index.js`, `package.json`, `catalyst-config.json`.
2. Add health endpoint: `app.get('/api/health', (_, r) => r.json({ok:true}))`.
3. `catalyst serve` → confirm `http://localhost:3000/server/api/api/health` returns JSON.

### Phase 3 — Backend routes (3–5 days)
Port one resource at a time, in this order (each is independent except for foreign-key references):
1. **students** — the simplest CRUD, get the pattern right.
2. **groups** + **groups/:id/students** (M2M).
3. **classes** — uses Groups and Students references; multi-student support (§6.3).
4. **attendance** + bulk + absent-streaks (§6.1–6.2). This is the most complex.
5. **fees** — aggregates Attendance + AdditionalFees by month. Uses ZCQL `GROUP BY`/`SUM`.
6. **messages** — straightforward CRUD, plus the two `generate-*` endpoints that query absent students / outstanding fees.
7. **reports** — read-only aggregations.
8. **dashboard** — read-only, mostly just calls the above logic and assembles a summary.
9. **import** — bulk insert from CSV-parsed rows.
10. **settings** + Zoho services (port `zohoAuth.js`, `zohoConfig.js`, `zohoSheets.js`, `zohoSync.js` unchanged).

Use `functions/students/index.js` (existing file in this repo) as the canonical reference for the Data Store pattern.

### Phase 4 — Frontend wiring (½ day)
1. Copy `client/` from this repo.
2. `client/public/client-package.json` → `{ "name": "veena-client" }`.
3. `client/vite.config.js` → `base: process.env.VITE_BASE || '/'`.
4. `client/src/main.jsx` → `<BrowserRouter basename={import.meta.env.BASE_URL}>`.
5. `client/src/utils/api.js` → `const BASE_URL = import.meta.env.VITE_API_BASE || '/api';`

### Phase 5 — Deploy & verify (½ day)
```bash
VITE_BASE="/app/" VITE_API_BASE="/server/api/api" npm run build --prefix client
catalyst deploy
```
Smoke-test each page in order. Fix issues as they surface — the most likely failure modes:
- Column-name mismatches between table definition and function code.
- ZCQL queries missing the `TableName.` qualifier.
- Cold-start latency (first hit after idle takes 2–3s).

---

## 10. Known gotchas / lessons learned

| Issue | Lesson |
|-------|--------|
| `zcatalyst-sdk-node@^4` doesn't exist | Use `^3.4.0` (latest stable as of 2026-05) |
| `catalyst.json` schema | `functions: { targets: [...], source: "functions", ignore: [] }` — NOT an array of objects |
| `client-package.json` location | Must be in the served folder (`client/dist/`), so put it in `client/public/` and let Vite copy it |
| Vite asset paths blank at `/app/` | Set `base: '/app/'` in `vite.config.js` and `basename` in `BrowserRouter` |
| Insert returns 500 with no detail | Add `detail: e.message` to error responses while developing; remove before production |
| Data Store column names case-sensitive | Stick to `snake_case` everywhere; never `PascalCase` |
| No JOINs in Data Store | Split into 2 ZCQL queries + JS stitch |
| `MODIFIEDTIME` doesn't auto-update on `updateRow` for some Catalyst versions | If `updated_at` matters, set it explicitly in the patch |
| Settings stored in DB, not env vars | Lets the teacher reconfigure Zoho creds without redeploying |
| Local `catalyst serve` needs Catalyst credentials to reach Data Store | First-call 401? Set `CATALYST_PROJECT_KEY` env var or run via `catalyst serve --client-only` for UI-only testing |

---

## 11. Recently added features (post-rebuild starting point)

These were the last shipped changes in the current codebase — make sure the rebuild includes them:

1. **Multi-select students for Add Class** (Classes page) — checkbox list with search, Select All, Clear.
2. **Multi-select students for Add Additional Fee** (Fees page) — same UX, creates one fee row per student.
3. **`online_group` class type** — same UX as `offline_group`, cyan color, uses `Wifi` icon.
4. **Delete attendance** — per-row trash icon + Delete All button for the class+date.
5. **Settings page + Zoho Sheets auto-sync** — fire-and-forget background sync on every mutation, configurable through UI.
6. **Custom attendance flow** (planned, not yet built) — skip class selection, multi-select students, set class_type + duration, mark + save.

---

## 12. Files to copy directly from existing repo (no logic change)

These are pure UI/config files that should land in the new repo unchanged:

```
client/src/                            (entire folder — all pages, components, utils)
client/index.html
client/tailwind.config.js
client/postcss.config.js
client/package.json
client/public/                         (if any static assets)
scripts/create-catalyst-tables.js     (modulo table edits for ClassStudents)
scripts/migrate-sqlite-to-catalyst.js (only if migrating data, otherwise skip)
```

Files that should be REWRITTEN from scratch (not copied):
```
server/                                (delete entirely — replaced by functions/)
catalyst.json                          (new — use template in §8)
functions/                             (new — one folder per resource OR one monolith)
```

---

## 13. What to give the next agent

Hand them:
1. This `HANDOFF.md`
2. The entire `client/` folder from this repo
3. `scripts/create-catalyst-tables.js`
4. The existing `functions/students/index.js` as a worked example of the Data Store pattern
5. A Catalyst Self Client OAuth token (1-hour validity) for running the table-creation script

Estimated time to rebuild end-to-end: **5–7 working days** for a developer familiar with React + Express. Most of the time is porting the 10 route files to the Data Store API.
