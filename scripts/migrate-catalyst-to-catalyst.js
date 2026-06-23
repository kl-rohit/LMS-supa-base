// scripts/migrate-catalyst-to-catalyst.js
//
// Full row-data migration between two Catalyst projects, PRESERVING
// relationships. Veena links tables by parent ROWID (e.g. Payments.student_id
// = Students.ROWID). Bulk CSV import (ds:import) assigns NEW ROWIDs and would
// break every foreign key. This script solves that: it inserts tables in
// dependency order, captures each new ROWID as it goes, and rewrites the
// children's FK columns to the new ROWIDs before inserting them.
//
// It also works ACROSS data centers (source India .in -> target US .com).
//
// -----------------------------------------------------------------------------
// SETUP (you do this, the tokens never go through the assistant)
// -----------------------------------------------------------------------------
// In each project's console: Settings -> API Console -> Self Client ->
// Generate Token. Scopes (note: "rows" is PLURAL; tables.ALL does NOT grant row access):
//   source token:  ZohoCatalyst.tables.rows.READ
//   target token:  ZohoCatalyst.tables.rows.READ,ZohoCatalyst.tables.rows.CREATE
// Self Client access tokens last ~1 hour. For a long run, regenerate and re-run
// the remaining tables with --only, or swap in fresh tokens.
//
// Put the values in a local, gitignored .env (or export them) like:
//   SRC_TOKEN="1000.xxxx"   SRC_PROJECT="34954000000015001"  SRC_BASE="https://api.catalyst.zoho.in"  SRC_ENV="development"
//   DST_TOKEN="1000.yyyy"   DST_PROJECT="80602000000014050"  DST_BASE="https://api.catalyst.zoho.com" DST_ENV="development"
//
// -----------------------------------------------------------------------------
// USAGE (run from repo root; Node 18+ for global fetch)
// -----------------------------------------------------------------------------
//   node scripts/migrate-catalyst-to-catalyst.js --list             # read-only: source table names + row counts + columns
//   node scripts/migrate-catalyst-to-catalyst.js --dry-run          # read source, simulate remap, write NOTHING
//   node scripts/migrate-catalyst-to-catalyst.js --dry-run --only=Students,Attendance
//   node scripts/migrate-catalyst-to-catalyst.js --only=Students    # real write of one table (test)
//   node scripts/migrate-catalyst-to-catalyst.js                    # full migration, all tables in order
//
// IMPORTANT: a real run inserts rows into the TARGET. Re-running creates
// duplicates. Truncate target tables in the console before a clean re-run.

// --------------------------- connection config -------------------------------
// ZAID (a.k.a. project key) is the number after /baas/ in the console URL:
//   https://console.catalyst.zoho.in/baas/<ZAID>/project/<projectId>/Development
// The new project's ZAID is 928044659 (from the console URL you shared).
// Find the OLD project's ZAID by opening it in the console and copying the
// number after /baas/.  Environment must match the case the API expects:
// 'Development' or 'Production'.
const SRC = {
  token:   process.env.SRC_TOKEN,
  project: process.env.SRC_PROJECT || '34954000000015001',          // OLD: Veena-Attendance
  zaid:    process.env.SRC_ZAID,                                    // REQUIRED: old project ZAID
  env:     process.env.SRC_ENV     || 'Development',
  base:    process.env.SRC_BASE    || 'https://api.catalyst.zoho.in', // India DC
};
const DST = {
  token:   process.env.DST_TOKEN,
  project: process.env.DST_PROJECT || '80602000000014050',           // NEW: vidyasethu
  zaid:    process.env.DST_ZAID    || '928044659',                   // NEW project ZAID (from console URL)
  env:     process.env.DST_ENV     || 'Development',
  base:    process.env.DST_BASE    || 'https://api.catalyst.zoho.com', // US DC
};

// --------------------------- migration plan ----------------------------------
// Tables are processed in THIS order. Parents must come before children so the
// old->new ROWID map for a parent exists when its children are remapped.
//
// fks: maps a foreign-key COLUMN on this table to the table it references.
//      Each value is remapped from old ROWID -> new ROWID at insert time.
//
// skip: true            -> read-only awareness only; never written.
// note:                 -> printed as a heads-up.
//
// Column names follow the lowercase snake_case convention in BACKEND_HANDOFF.md.
// Run --list first to confirm the actual columns of each source table; adjust
// the fks map if a column name differs from what's assumed here.
const PLAN = [
  // ---- tenant root ----------------------------------------------------------
  { table: 'Organizations', fks: {} },

  // ---- top-level entities (only org_id points upward) -----------------------
  { table: 'Students', fks: { org_id: 'Organizations' } },
  { table: 'Groups',   fks: { org_id: 'Organizations' } },
  { table: 'Courses',  fks: { org_id: 'Organizations' } },
  { table: 'Camps',    fks: { org_id: 'Organizations' } },

  // ---- entities that reference the above ------------------------------------
  { table: 'Classes',          fks: { org_id: 'Organizations', group_id: 'Groups', student_id: 'Students' } },
  { table: 'GroupStudents',    fks: { group_id: 'Groups',  student_id: 'Students' } },
  { table: 'ClassStudents',    fks: { class_id: 'Classes', student_id: 'Students' } },
  { table: 'Lessons',          fks: { org_id: 'Organizations', course_id: 'Courses' } },
  { table: 'CourseEnrollments',fks: { org_id: 'Organizations', course_id: 'Courses', student_id: 'Students' } },
  { table: 'LessonProgress',   fks: { student_id: 'Students', lesson_id: 'Lessons', course_id: 'Courses' } },
  { table: 'LessonQuizzes',    fks: { lesson_id: 'Lessons' } },
  { table: 'QuizAttempts',     fks: { quiz_id: 'LessonQuizzes', student_id: 'Students', lesson_id: 'Lessons' } },
  { table: 'Assignments',      fks: { org_id: 'Organizations', course_id: 'Courses', lesson_id: 'Lessons' } },
  { table: 'AssignmentCompletions', fks: { assignment_id: 'Assignments', student_id: 'Students' } },
  { table: 'QuestionPapers',   fks: { org_id: 'Organizations', course_id: 'Courses' } },
  { table: 'CampDays',         fks: { camp_id: 'Camps' } },

  // ---- student-scoped records -----------------------------------------------
  { table: 'Attendance',       fks: { student_id: 'Students', class_id: 'Classes' } },
  { table: 'AdditionalFees',   fks: { student_id: 'Students' } },
  { table: 'Payments',         fks: { student_id: 'Students' } },
  { table: 'Messages',         fks: { student_id: 'Students' } },
  { table: 'Notifications',    fks: { org_id: 'Organizations', student_id: 'Students' } },
  { table: 'PushSubscriptions',fks: { student_id: 'Students' } },

  // ---- key/value + tenant membership ----------------------------------------
  { table: 'AppSettings',      fks: { org_id: 'Organizations' } },
  // OrgMemberships.user_id points at Catalyst AUTH users, not a data table. Those
  // users do not exist in the new project until re-invited, so user_id cannot be
  // remapped here. Re-create memberships after inviting users in the new project.
  { table: 'OrgMemberships',   fks: { org_id: 'Organizations' }, note: 'user_id references Catalyst auth users; re-invite users in the new project, do not rely on these rows.' },
];

// Catalyst auto-manages these; never send them on insert.
const SYSTEM_COLS = new Set(['ROWID', 'CREATORID', 'CREATEDTIME', 'MODIFIEDTIME']);

// --------------------------- flags -------------------------------------------
const args = process.argv.slice(2);
const LIST    = args.includes('--list');
const DRY     = args.includes('--dry-run');
const onlyArg = args.find((a) => a.startsWith('--only='));
const ONLY    = onlyArg ? onlyArg.slice(7).split(',').map((s) => s.trim()).filter(Boolean) : null;

// --------------------------- HTTP helpers ------------------------------------
// Mirrors the official zcatalyst-sdk-node request shape:
//   path:    /baas/v1/project/{projectId}/table/{name}/row   (NO /{env}/ segment)
//   headers: Accept v2+json, PROJECT_ID = ZAID, environment headers, admin user
//   query:   ?zaid={ZAID}
function authHeaders(conn) {
  return {
    'Authorization':         `Zoho-oauthtoken ${conn.token}`,
    'Content-Type':          'application/json',
    'Accept':                'application/vnd.catalyst.v2+json',
    'PROJECT_ID':            conn.zaid || '',          // SDK PROJECT_KEY_NAME header carries the ZAID
    'Environment':           conn.env,
    'X-Catalyst-Environment':conn.env,
    'x-zc-environment':      conn.env,
    'X-CATALYST-USER':       'admin',
  };
}

function rowUrl(conn, table, extraQs = {}) {
  const qs = new URLSearchParams({ zaid: conn.zaid || '', ...extraQs });
  return `${conn.base}/baas/v1/project/${conn.project}/table/${table}/row?${qs.toString()}`;
}

// Unwrap Catalyst's response envelope defensively: rows may sit at body.data,
// body.data.data, or body itself; next_token may be a sibling of either.
function unwrap(body) {
  const d = body && body.data !== undefined ? body.data : body;
  if (Array.isArray(d)) return { rows: d, next: body && body.next_token };
  if (d && Array.isArray(d.data)) return { rows: d.data, next: d.next_token || (body && body.next_token) };
  return { rows: [], next: undefined };
}

// Read every row of a table, following next_token pagination. Returns rows incl. ROWID.
async function readAllRows(conn, table) {
  const MAX = 200;
  let next, all = [];
  while (true) {
    const url = rowUrl(conn, table, next ? { max_rows: MAX, next_token: next } : { max_rows: MAX });
    const res = await fetch(url, { headers: authHeaders(conn) });
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 404) throw new Error(`table not found (HTTP 404): ${text.slice(0, 120)}`);
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    let body; try { body = JSON.parse(text); } catch { body = {}; }
    const { rows, next: nextTok } = unwrap(body);
    all = all.concat(rows);
    if (!nextTok || rows.length === 0) break;
    next = nextTok;
  }
  return all;
}

// Insert a batch of rows; returns the created rows (with new ROWIDs) in order.
async function insertRows(conn, table, rows) {
  const res = await fetch(rowUrl(conn, table), { method: 'POST', headers: authHeaders(conn), body: JSON.stringify(rows) });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  let body; try { body = JSON.parse(text); } catch { body = {}; }
  return unwrap(body).rows;
}

// --------------------------- core --------------------------------------------
// maps[table] = Map(oldROWID -> newROWID)
const maps = {};

function selected(table) {
  return !ONLY || ONLY.includes(table);
}

function stripSystem(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (SYSTEM_COLS.has(k)) continue;
    // Catalyst sometimes returns CREATORID as an object; already filtered above.
    out[k] = v;
  }
  return out;
}

function remapFks(table, row, fks, warnings) {
  const out = stripSystem(row);
  for (const [col, refTable] of Object.entries(fks)) {
    const oldVal = out[col];
    if (oldVal === undefined || oldVal === null || oldVal === '') continue;
    const map = maps[refTable];
    const newVal = map ? map.get(String(oldVal)) : undefined;
    if (newVal === undefined) {
      warnings.push(`${table}.${col}=${oldVal} -> no ${refTable} mapping (parent not migrated this run?)`);
      out[col] = null; // avoid pointing at a stale/foreign ROWID
    } else {
      out[col] = String(newVal);
    }
  }
  return out;
}

async function listMode() {
  console.log(`LIST (read-only) source project ${SRC.project} @ ${SRC.base} (${SRC.env})\n`);
  for (const { table } of PLAN) {
    if (!selected(table)) continue;
    try {
      const rows = await readAllRows(SRC, table);
      const cols = rows[0] ? Object.keys(rows[0]).filter((c) => !SYSTEM_COLS.has(c)) : [];
      console.log(`- ${table}: ${rows.length} rows` + (cols.length ? `  cols: ${cols.join(', ')}` : '  (empty)'));
    } catch (e) {
      console.log(`- ${table}: ${e.message}`);
    }
  }
}

async function migrate() {
  console.log(`${DRY ? 'DRY-RUN' : 'MIGRATE'}  ${SRC.project}(${SRC.base}) -> ${DST.project}(${DST.base})`);
  if (ONLY) console.log(`Limited to: ${ONLY.join(', ')}`);
  console.log('');

  let totalOk = 0, totalSkip = 0;
  const allWarnings = [];

  for (const step of PLAN) {
    const { table, fks, skip, note } = step;
    if (note) console.log(`  note[${table}]: ${note}`);
    if (skip) { console.log(`- ${table}: skipped (skip:true)`); continue; }

    // Read source rows (always, so parent maps exist even if a child is --only'd
    // out we still need the parent's map; but to keep it simple we read only
    // selected tables and warn on unmapped FKs).
    if (!selected(table)) { console.log(`- ${table}: not selected`); continue; }

    let srcRows;
    try {
      srcRows = await readAllRows(SRC, table);
    } catch (e) {
      console.log(`- ${table}: read skipped (${e.message})`);
      continue;
    }

    maps[table] = maps[table] || new Map();
    const warnings = [];
    const prepared = srcRows.map((r) => ({ old: String(r.ROWID), body: remapFks(table, r, fks, warnings) }));

    if (DRY) {
      // simulate new ROWIDs so downstream children can be checked too
      prepared.forEach((p, i) => maps[table].set(p.old, `DRY-${table}-${i + 1}`));
      console.log(`- ${table}: ${prepared.length} rows ready (dry-run, no write)` + (warnings.length ? `  [${warnings.length} FK warnings]` : ''));
      allWarnings.push(...warnings);
      totalOk += prepared.length;
      continue;
    }

    // real write, batched at 200, aligning returned ROWIDs to source rows by index
    const BATCH = 200;
    let ok = 0, fail = 0;
    for (let i = 0; i < prepared.length; i += BATCH) {
      const slice = prepared.slice(i, i + BATCH);
      try {
        const created = await insertRows(DST, table, slice.map((p) => p.body));
        created.forEach((row, j) => {
          const newId = row && (row.ROWID || (row.data && row.data.ROWID));
          if (newId && slice[j]) maps[table].set(slice[j].old, String(newId));
        });
        ok += slice.length;
      } catch (e) {
        console.error(`  x ${table} batch ${i / BATCH + 1}: ${e.message}`);
        fail += slice.length;
      }
    }
    console.log(`- ${table}: ${ok} written, ${fail} failed` + (warnings.length ? `  [${warnings.length} FK warnings]` : ''));
    allWarnings.push(...warnings);
    totalOk += ok;
  }

  if (allWarnings.length) {
    console.log(`\nFK warnings (${allWarnings.length}):`);
    for (const w of allWarnings.slice(0, 40)) console.log(`  ! ${w}`);
    if (allWarnings.length > 40) console.log(`  ...and ${allWarnings.length - 40} more`);
  }
  console.log(`\nDone. ${totalOk} rows ${DRY ? 'prepared' : 'written'}.` + (DRY ? ' (dry-run wrote nothing)' : ''));
}

// --------------------------- entry -------------------------------------------
(async () => {
  if (!SRC.token) { console.error('ERROR: set SRC_TOKEN (source self-client access token).'); process.exit(1); }
  if (!SRC.zaid)  { console.error('ERROR: set SRC_ZAID (old project ZAID, the number after /baas/ in its console URL).'); process.exit(1); }
  if (LIST) { await listMode(); return; }
  if (!DRY && !DST.token) { console.error('ERROR: set DST_TOKEN (target self-client access token) for a real write.'); process.exit(1); }
  if (!DRY && !DST.zaid)  { console.error('ERROR: set DST_ZAID (new project ZAID).'); process.exit(1); }
  await migrate();
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
