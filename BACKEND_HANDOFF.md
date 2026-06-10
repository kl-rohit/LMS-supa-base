# Veena — Backend Handoff (Catalyst)

Build the Veena REST API on Zoho Catalyst from scratch. Single user (the music teacher). No end-user authentication. Data lives in Catalyst Data Store.

---

## 1. Tech stack

| Concern | Choice |
|---------|--------|
| Compute | Catalyst **AdvancedIO Function** (Node.js 20) |
| Framework | Express 4 (`module.exports = app`) |
| Database | Catalyst **Data Store** (NoSQL row store) |
| Query language | **ZCQL** (SQL subset — used when Data Store row API isn't enough) |
| SDK | `zcatalyst-sdk-node@^3.4.0` |
| Outbound HTTP (Zoho Sheets sync) | global `fetch` (Node 20 built-in) |

### Catalyst project info
- Project ID: `34954000000015001`
- Data center: **India** (`api.catalyst.zoho.in`, `console.catalyst.zoho.in`)
- Stack: `node20`

---

## 2. Architecture decision

**Recommended: one monolith function `api`** that mounts all Express route files. Why:
- Simpler deployment (one function).
- Frontend hits a single base URL `/server/api/api/...`.
- Cold-start hits one function not nine.
- All route files share the same `catalystDb` helper.

Alternative (one function per resource: `students`, `groups`, etc.) only makes sense if you need fine-grained scaling or memory isolation — Veena doesn't.

---

## 3. Folder structure

```
veena/
├── catalyst.json                  # CLI-managed project binding
└── functions/
    └── api/
        ├── catalyst-config.json
        ├── package.json
        ├── index.js               # Express app entry, mounts all routes
        ├── db/
        │   └── catalystDb.js      # Data Store helper (initialize, insert, getById, find, ZCQL)
        ├── routes/
        │   ├── students.js
        │   ├── groups.js
        │   ├── classes.js
        │   ├── attendance.js
        │   ├── fees.js
        │   ├── messages.js
        │   ├── reports.js
        │   ├── dashboard.js
        │   ├── import.js
        │   └── settings.js
        └── services/
            ├── zohoAuth.js        # OAuth token cache + refresh
            ├── zohoSheets.js      # Zoho Sheet API v2 wrapper
            ├── zohoConfig.js      # column mappings per sheet tab
            └── zohoSync.js        # fire-and-forget sync hooks
```

### `catalyst.json` (top level)
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
    "targets": ["api"],
    "ignore": [],
    "source": "functions"
  },
  "client": {
    "name": "veena-client",
    "source": "client/dist"
  }
}
```

### `functions/api/catalyst-config.json`
```json
{
  "deployment": {
    "name": "api",
    "stack": "node20",
    "type": "advancedio",
    "env_variables": {}
  },
  "execution": {
    "main": "index.js"
  }
}
```

### `functions/api/package.json`
```json
{
  "name": "veena-api",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "express": "^4.21.1",
    "cors": "^2.8.5",
    "multer": "^1.4.5-lts.1",
    "zcatalyst-sdk-node": "^3.4.0"
  }
}
```

### `functions/api/index.js` (entry)
```js
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api/students',   require('./routes/students'));
app.use('/api/groups',     require('./routes/groups'));
app.use('/api/classes',    require('./routes/classes'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/fees',       require('./routes/fees'));
app.use('/api/messages',   require('./routes/messages'));
app.use('/api/reports',    require('./routes/reports'));
app.use('/api/dashboard',  require('./routes/dashboard'));
app.use('/api/import',     require('./routes/import'));
app.use('/api/settings',   require('./routes/settings'));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

if (require.main === module) {
  app.listen(process.env.PORT || 3001);
}

module.exports = app;
```

---

## 4. Data Store helper (`functions/api/db/catalystDb.js`)

The single point of contact with Catalyst's SDK. Every route file requires this and uses its helpers.

```js
const catalyst = require('zcatalyst-sdk-node');

// IMPORTANT: scope: 'admin' bypasses user-auth and uses the project's own
// credentials. Veena has no end-user auth, so every call uses admin scope.
function app(req) {
  return catalyst.initialize(req, { scope: 'admin' });
}

const q = (v) => `'${String(v).replace(/'/g, "''")}'`;

async function insert(table, row, req) {
  return app(req).datastore().table(table).insertRow(row);
}

async function bulkInsert(table, rows, req) {
  if (!rows.length) return [];
  return app(req).datastore().table(table).insertRows(rows);
}

async function getById(table, id, req) {
  try { return await app(req).datastore().table(table).getRow(id); }
  catch { return null; }
}

async function getAll(table, req) {
  const rows = await app(req).datastore().table(table).getAllRows();
  return rows.map((r) => (typeof r.toJSON === 'function' ? r.toJSON() : r));
}

async function update(table, id, patch, req) {
  return app(req).datastore().table(table).updateRow({ ROWID: id, ...patch });
}

async function remove(table, id, req) {
  return app(req).datastore().table(table).deleteRow(id);
}

async function zcql(query, req) {
  return app(req).zcql().executeZCQLQuery(query);
}

// Translate a Catalyst row (PascalCase system cols + snake_case data cols)
// into the snake_case shape the React client expects (with numeric `id`).
function normalize(row) {
  if (!row) return row;
  return {
    ...row,
    id: row.ROWID,
    created_at: row.created_at || row.CREATEDTIME,
    updated_at: row.updated_at || row.MODIFIEDTIME,
  };
}

module.exports = { insert, bulkInsert, getById, getAll, update, remove, zcql, normalize, q };
```

---

## 5. Data model — Catalyst Data Store tables

All columns are **lowercase snake_case** (case-sensitive in ZCQL). Don't add `ROWID`, `CREATEDTIME`, `MODIFIEDTIME` — those are auto-created.

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
| student_id | BigInt | | nullable (legacy single-student) |
| class_type | Text | ✓ | online \| offline \| offline_group \| online_group |
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
| status | Text | ✓ | present \| absent \| late |
| class_type | Text | ✓ | denormalized for reports |
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
| message_type | Text | | `custom` |
| is_sent | Integer | | 0 |

### Settings
| Column | Type | Mandatory | Notes |
|--------|------|-----------|-------|
| key | Text | ✓ | unique. Keys: zoho_client_id, zoho_client_secret, zoho_refresh_token, zoho_region, zoho_access_token, zoho_token_expiry, zoho_spreadsheet_id, zoho_last_sync, zoho_auto_sync |
| value | Text | ✓ | |

---

## 6. API contract (what to implement)

All routes return JSON `{ ... }` or `{ error: string, detail?: string }`.

### Students (10 endpoints)
```
GET    /api/students                   query: ?search, ?status, ?page, ?limit
GET    /api/students/:id               returns { student, groups, classes }
POST   /api/students                   body: { name, parent_name, mobile_number, fee_online, fee_offline, fee_offline_group, status, notes }
PUT    /api/students/:id
DELETE /api/students/:id?force=true    soft-delete by default, hard-delete with force=true
DELETE /api/students/inactive          bulk hard-delete all inactive (MUST be declared BEFORE /:id)
```

### Groups (8 endpoints)
```
GET    /api/groups
GET    /api/groups/:id                 returns { group, students }
GET    /api/groups/:id/students
POST   /api/groups
POST   /api/groups/:id/students        body: { student_ids: [...] }
PUT    /api/groups/:id
DELETE /api/groups/:id
DELETE /api/groups/:id/students/:studentId
```

### Classes (5 endpoints)
```
GET    /api/classes
GET    /api/classes/today
GET    /api/classes/:id                returns class + group_members[] if group class
POST   /api/classes                    body supports student_ids[] (multi-student) or single student_id, or group_id
PUT    /api/classes/:id
DELETE /api/classes/:id
```

### Attendance (8 endpoints)
```
GET    /api/attendance                 query: ?class_id, ?student_id, ?from, ?to, ?date
GET    /api/attendance/by-date/:date
GET    /api/attendance/by-student/:studentId
GET    /api/attendance/absent-streaks/all  returns { alerts: [{student_id, student_name, consecutive_absences}] }
POST   /api/attendance
POST   /api/attendance/bulk            body: { class_id, date, records: [{student_id, status, topic, fee_charged}] }
PUT    /api/attendance/:id
DELETE /api/attendance/:id
```

### Fees (7 endpoints)
```
GET    /api/fees/monthly/:year/:month
GET    /api/fees/student/:id?from&to
GET    /api/fees/overall
GET    /api/fees/additional?month&year&student_id
POST   /api/fees/additional            body supports student_ids[] (multi-student)
PUT    /api/fees/additional/:id
DELETE /api/fees/additional/:id
```

### Messages (5 endpoints)
```
GET    /api/messages
POST   /api/messages
POST   /api/messages/generate-absence-alert  creates draft message per student with ≥3 absences
POST   /api/messages/generate-fee-reminder   creates draft message per student with outstanding fees
PUT    /api/messages/:id
DELETE /api/messages/:id
```

### Reports (3 endpoints)
```
GET    /api/reports/student/:id?from&to
GET    /api/reports/monthly/:year/:month
GET    /api/reports/overall
```

### Import (2 endpoints)
```
POST   /api/import/students            body: { rows: [...] }
POST   /api/import/attendance          body: { rows: [...] }
```

### Dashboard (1 endpoint)
```
GET    /api/dashboard                  returns { stats: { total_students, classes_today, attendance_rate, fees_collected }, today_classes: [...], alerts: [...] }
```

### Settings (6 endpoints)
```
GET    /api/settings/zoho              returns credentials masked (e.g. "xxxx...1234")
PUT    /api/settings/zoho              body: { client_id, client_secret, refresh_token, region }
POST   /api/settings/zoho/test         verifies OAuth
POST   /api/settings/zoho/create-spreadsheet
POST   /api/settings/zoho/sync-all
GET    /api/settings/zoho/status       returns { enabled, spreadsheet_id, last_sync }
```

**Total: 55 endpoints.**

---

## 7. Business rules

### 7.1 Fee calculation
For each attendance record where `status ∈ {present, late}`:
```
fee_per_hour = student.fee_online         if class_type == 'online'
             | student.fee_offline        if class_type == 'offline'
             | student.fee_offline_group  if class_type ∈ {offline_group, online_group}

fee_charged = fee_per_hour × duration_hours
```
For `absent` → `fee_charged = 0`.
The user can override `fee_charged` manually per record.

### 7.2 Class duration
`duration_hours = (end_time − start_time) in hours`. Computed on create/update. Stored on the Attendance row too (denormalized) so reports stay correct if class times change later.

### 7.3 Absence streak
For each student, count consecutive `absent` records starting from the most recent date and going backward. If streak ≥ 3 → student appears in alerts banner and "Generate Absence Alerts" picks them up.

### 7.4 Multi-student classes (Classes POST)
When `class_type` is individual (online/offline) and `student_ids` array is provided, create:
- One row in Classes (no student_id)
- One row per student in ClassStudents (`class_id`, `student_id`)

When a single `student_id` is provided, store on the Classes row directly (legacy path).

### 7.5 Soft-delete students
`DELETE /api/students/:id` sets `status='inactive'` by default. `?force=true` deletes the row. Soft-deleted students are excluded from default Active queries but still appear in attendance/fee history (their records remain).

### 7.6 Zoho Sheets sync (fire-and-forget)
Every mutation route MUST call the corresponding sync helper AFTER the DB write succeeds. The helper is async but the route doesn't await it — the HTTP response is sent immediately. Errors are logged but don't fail the API call.

Pattern:
```js
router.post('/', async (req, res) => {
  const student = await insert('Students', {...}, req);
  syncStudentCreate(student);  // <-- fire-and-forget, no await
  res.status(201).json({ student: normalize(student) });
});
```

Sync only runs if `getSetting('zoho_spreadsheet_id')` returns a value (i.e. user has set up Zoho).

---

## 8. Catalyst SDK / ZCQL cheat sheet

### Initializing
```js
const catalyst = require('zcatalyst-sdk-node');
const app = catalyst.initialize(req, { scope: 'admin' });
```
Without `scope: 'admin'`, calls 401 because Veena has no end-user auth.

### Single-row operations (preferred — fastest, clearest errors)
```js
const ds = app.datastore();
const row = await ds.table('Students').insertRow({ name: 'A', parent_name: 'B', ... });
const row = await ds.table('Students').getRow(rowId);
await ds.table('Students').updateRow({ ROWID: id, status: 'inactive' });
await ds.table('Students').deleteRow(id);
const rows = await ds.table('Students').getAllRows();
```

### Bulk insert (up to 1000 rows)
```js
const rows = await ds.table('Students').insertRows([row1, row2, ...]);
```

### ZCQL queries (when you need WHERE / ORDER BY / aggregation)
```js
const results = await app.zcql().executeZCQLQuery(
  `SELECT * FROM Students WHERE Students.status = 'active' ORDER BY Students.name ASC`
);
// Result shape: [{ Students: { ROWID, name, parent_name, ... } }, ...]
const list = results.map((r) => r.Students);
```

**ZCQL quirks:**
- Table names are case-sensitive (`Students` not `students`).
- Column refs in WHERE/ORDER BY must be table-qualified: `Students.name`, NOT `name`.
- Results nested under the table name: `r.Students.name`.
- No JOINs — fetch related rows separately and stitch in JS.
- No transactions — sequential `await`s with try/catch around each.
- Aggregations like `COUNT(ROWID)`, `SUM(fee_charged)` work; `GROUP BY` works.
- String literals use single quotes; escape single quotes inside by doubling them.

---

## 9. Step-by-step build plan

### Phase 1 — Setup (½ day)
1. Install Catalyst CLI: `npm i -g zcatalyst-cli`
2. `catalyst login` → pick **zoho.in** DC
3. `catalyst init` in repo root, pick existing project `34954000000015001`, env `development`, component `Functions`
4. Create `functions/api/` with `catalyst-config.json`, `package.json`, `index.js` (with just `/api/health`).
5. `cd functions/api && npm install`
6. `catalyst serve` and verify `http://localhost:3000/server/api/api/health` returns `{"ok":true}`.

### Phase 2 — Data Store tables (1–2 hours)
Create all 9 tables via the Catalyst console UI (Cloud Scale → Data Store → Create Table). Use column specs from §5. Verify each table appears with the correct snake_case columns.

### Phase 3 — Helper (1 hour)
Write `functions/api/db/catalystDb.js` from §4. Test it by adding a quick route that calls `getAll('Students', req)` and returns the array.

### Phase 4 — Routes (3–5 days, port one resource at a time)
Suggested order — each is independent except for foreign-key references:
1. **students** (CRUD only — best to get the pattern right)
2. **groups** + group/students linking (M2M)
3. **classes** (multi-student via ClassStudents)
4. **attendance** + bulk + absent-streaks (most complex; §7.1, §7.3)
5. **fees** (aggregates Attendance + AdditionalFees by month — uses ZCQL `SUM`/`GROUP BY`)
6. **messages** + the two `generate-*` endpoints (depend on attendance + fees logic)
7. **reports** (read-only aggregations)
8. **dashboard** (calls into other route logic; can extract to shared helpers)
9. **import** (bulk insert from CSV-parsed rows)
10. **settings** + Zoho services (see §10)

For each route file, follow this template (Students example):

```js
const router = require('express').Router();
const { insert, getById, getAll, update, remove, zcql, normalize, q } = require('../db/catalystDb');
const { syncStudentCreate, syncStudentUpdate, syncStudentDelete } = require('../services/zohoSync');

router.get('/', async (req, res) => {
  try {
    const rows = await getAll('Students', req);
    rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    res.json({ students: rows.map(normalize) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch students', detail: e.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, parent_name, mobile_number, fee_online, fee_offline, fee_offline_group, status, notes } = req.body;
    if (!name || !parent_name || !mobile_number) {
      return res.status(400).json({ error: 'name, parent_name, mobile_number required' });
    }
    const student = await insert('Students', {
      name, parent_name, mobile_number,
      fee_online: fee_online || 0,
      fee_offline: fee_offline || 0,
      fee_offline_group: fee_offline_group || 0,
      status: status || 'active',
      notes: notes || '',
    }, req);
    syncStudentCreate(student);  // fire-and-forget
    res.status(201).json({ student: normalize(student) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create student', detail: e.message });
  }
});

// ... PUT, DELETE follow the same pattern

module.exports = router;
```

### Phase 5 — Deploy & verify (½ day)
```bash
catalyst deploy --only api
```
Then build the client with `API_BASE=/server/api/api npm run build:catalyst --prefix client` and deploy that too:
```bash
catalyst deploy --only client
```
Smoke-test every page in order.

---

## 10. Zoho Sheets integration (Phase 4.10 — optional, can skip initially)

Four service files in `functions/api/services/`:

### `zohoAuth.js`
- `getSetting(key)`, `setSetting(key, value)` — backed by the Settings Data Store table.
- `getAccessToken()` — returns cached token; refreshes 5 min before expiry.
- `testConnection()` — POSTs to `https://accounts.zoho.<region>/oauth/v2/token` with the refresh_token grant.
- `isZohoEnabled()` — returns true if all 4 creds + spreadsheet_id are set.

### `zohoConfig.js`
- `SHEET_MAPPINGS` object with one entry per Sheet tab: Students, Groups, Classes, Attendance, Fees, Messages.
- Each entry has `columns: [...]` (array of column names) and `mapRow(row) → array` (converts a DB row to a Sheet row).

### `zohoSheets.js`
- Low-level wrapper around Zoho Sheet API v2.
- Functions: `createSpreadsheet`, `addSheet`, `deleteSheet`, `addHeaderRow`, `addRows`, `updateRow`, `deleteRow`, `clearSheet`, `getRows`.
- All take an access token + spreadsheet_id + sheet_name.

### `zohoSync.js`
- One exported function per resource × operation: `syncStudentCreate(row)`, `syncStudentUpdate(row)`, `syncStudentDelete(id)`, etc.
- Each wraps the work in `(async () => { ... })().catch(logError)` — non-blocking.
- Each first calls `canSync()` (which checks `isZohoEnabled()`); if false, returns silently.
- `syncAllData()` — wipes every sheet and re-pushes all rows in batches of 200. Used by `POST /api/settings/zoho/sync-all`.

The Zoho Sheets piece is **optional** — skip it during initial development. The 6 mutation routes (students/groups/classes/attendance/fees/messages) work without it; the sync calls become no-ops when `isZohoEnabled()` returns false.

---

## 11. Common gotchas

| Issue | Cause / Fix |
|-------|-------------|
| `statusCode: 401, code: AUTHENTICATION_FAILURE` | Missing `{ scope: 'admin' }` on `catalyst.initialize(req, ...)`. Veena has no user auth — admin scope is mandatory. |
| `Unknown Table Students` ZCQL error | Table doesn't exist in your Data Store OR is named with wrong casing (`students` vs `Students`). Verify in console. |
| `Unknown Column name in ORDER BY` | The `name` column doesn't exist on the table, OR the ORDER BY isn't table-qualified (`ORDER BY Students.name`, not `ORDER BY name`). |
| `zcatalyst-sdk-node@^4.0.0` install fails | v4 doesn't exist on npm. Use `^3.4.0`. |
| `catalyst-config.json` schema errors | Run `catalyst functions:add api --type advancedio` to let the CLI generate a canonical config. |
| `catalyst.json` "no targets found" | Use `"functions": { "targets": [...], "source": "functions" }`, NOT an array of objects. |
| Cold-start latency on first hit (~2–3s) | Normal for serverless. The 2nd request is fast. Acceptable for a single-user app. |
| Data lost between requests | If you accidentally write to `/tmp` (e.g. SQLite file), it doesn't persist across cold starts. ALL data must live in Data Store. |
| No transactions | Data Store has no multi-row transactions. Sequential `await`s with try/catch around each. Document any non-atomic risk in route comments. |
| Time/date strings | Catalyst stores dates as ISO strings or `datetime` columns; Veena uses simple `YYYY-MM-DD` strings (Text column) for `date`/`fee_date` to keep parsing trivial. |

---

## 12. Verification checklist (before considering "done")

For each route, manually verify:
- `GET` returns expected rows (and pagination if applicable)
- `POST` creates a row and the response includes the new ROWID
- `PUT` updates and returns the updated row
- `DELETE` removes the row (or soft-deletes for Students)
- Error responses include both `error` (short) and `detail` (raw error message) during dev — strip `detail` before production

For the system as a whole:
- `/api/dashboard` returns stats that match what you see on each page
- Multi-student class creation produces both a Classes row AND ClassStudents rows
- Marking attendance with `status='absent'` sets `fee_charged=0`
- The `attendance/absent-streaks/all` endpoint returns the right students after marking 3+ consecutive absences

---

## 13. Helpful debug endpoint

While developing, add this to `students.js` (or any route file) — it lists every table that actually exists in your Data Store, so you can verify table names + columns match what your code expects:

```js
router.get('/debug/tables', async (req, res) => {
  try {
    const catalyst = require('zcatalyst-sdk-node');
    const app = catalyst.initialize(req, { scope: 'admin' });
    const tables = await app.datastore().getAllTableDetails();
    res.json({
      tables: tables.map((t) => ({
        name: t.getTableName(),
        columns: t.getColumnDetails().map((c) => c.column_name),
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

Visit `https://<deployment-url>/server/api/api/students/debug/tables` to see your Data Store contents from outside the console. Remove this route before going to production.
