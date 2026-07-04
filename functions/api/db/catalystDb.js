// Single point of contact with the database.
//
// PORTED FROM ZOHO CATALYST TO POSTGRES (Supabase). The public API and return
// shapes are UNCHANGED so the ~27 route files keep working without edits:
//   - insert/bulkInsert/getById/getAll/update/remove operate on lowercased
//     table names (Catalyst "Students" -> Postgres "students").
//   - zcql/zcqlAll accept the app's existing ZCQL strings, translate the few
//     differences to Postgres SQL, and return the SAME nested shape
//     ([{ Students: {...} }, ...]) that unwrap()/readCount() expect.
//   - Every returned row carries BOTH `id` and a Catalyst-style `ROWID` alias
//     (and created_at/CREATEDTIME, updated_at/MODIFIEDTIME), so code that reads
//     either name is unaffected. normalize() is unchanged.
//
// ROWIDs stay strings (17-digit; JS Number would lose precision). See db/pg.js.

const { query } = require('./pg');

// Kept for the not-yet-migrated Stratus (file storage, Phase 4) and Catalyst
// Auth (Phase 3) call sites that still do appFor(req).stratus()/.userManagement().
// Datastore access no longer goes through this — it uses the pool above.
let _catalyst;
function appFor(req) {
  if (!_catalyst) _catalyst = require('zcatalyst-sdk-node');
  return _catalyst.initialize(req, { scope: 'admin' });
}

// Escape single quotes for SQL string literals (works in Postgres too).
const q = (v) => `'${String(v).replace(/'/g, "''")}'`;

// 17-digit ids exceed JS Number precision; inline into SQL as a validated
// digit-string (also blocks injection by rejecting non-numeric input).
function safeId(v) {
  if (v === undefined || v === null) return null;
  const s = String(v);
  return /^\d+$/.test(s) ? s : null;
}

// Postgres rows are already plain objects; keep the toJSON guard for safety.
function plain(row) {
  if (!row) return row;
  return typeof row.toJSON === 'function' ? row.toJSON() : row;
}

// Add the Catalyst-style aliases onto a flat Postgres row so downstream code
// that reads .ROWID / .CREATEDTIME / .MODIFIEDTIME keeps working. ROWID is a
// string to match the historical Catalyst shape (normalize() sets id = ROWID).
function catalystify(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  if (row.id !== undefined && row.id !== null && out.ROWID === undefined) out.ROWID = String(row.id);
  if (row.created_at !== undefined && out.CREATEDTIME === undefined) out.CREATEDTIME = row.created_at;
  if (row.updated_at !== undefined && out.MODIFIEDTIME === undefined) out.MODIFIEDTIME = row.updated_at;
  return out;
}

// Translate Catalyst row → shape the React client expects.
// Postgres returns numeric/int8 columns as STRINGS, so every column the app
// treats as a number must be listed here to be coerced back (this list is
// extended vs. the Catalyst original for exactly that reason — e.g.
// monthly_fee/paid_amount/daily_fee drive fee math and must not stay strings).
const NUMERIC_FIELDS = [
  'day_of_week', 'is_active', 'is_sent',
  'duration_hours', 'fee_charged', 'fee_online', 'fee_offline', 'fee_offline_group',
  'amount', 'month', 'year', 'fee_month', 'fee_year',
  'min_classes_per_month', 'monthly_fee',
  // fees / payments / camps
  'paid_amount', 'daily_fee', 'total_days',
  // lessons module
  'duration_seconds', 'order_index', 'start_seconds', 'end_seconds',
  'watched_seconds', 'percent_complete', 'points', 'completed_count',
  // quizzes
  'score', 'total_questions', 'correct_count', 'attempts', 'correct_index',
];

function normalize(row) {
  const r = plain(row);
  if (!r) return r;
  const out = {
    ...r,
    id: r.ROWID,
    created_at: r.created_at || r.CREATEDTIME,
    updated_at: r.updated_at || r.MODIFIEDTIME,
  };
  if (r.class_date !== undefined) out.date = r.class_date;
  if (r.fee_month !== undefined) out.month = r.fee_month;
  if (r.fee_year !== undefined) out.year = r.fee_year;
  for (const k of NUMERIC_FIELDS) {
    if (out[k] !== undefined && out[k] !== null && out[k] !== '') {
      const n = Number(out[k]);
      if (!Number.isNaN(n)) out[k] = n;
    }
  }
  return out;
}

// ---------- table/column helpers --------------------------------------------
const qi = (k) => `"${String(k).replace(/"/g, '')}"`; // quote identifier
const MANAGED = new Set(['id', 'ROWID', 'CREATEDTIME', 'MODIFIEDTIME', 'created_at', 'updated_at']);

// Cache each table's real column set so write payloads can be filtered to
// existing columns (drops client aliases like date/month/year and any stray
// keys — mirrors a tolerant ORM and avoids "column does not exist" errors).
const _colCache = new Map();
async function tableColumns(table) {
  const t = table.toLowerCase();
  if (_colCache.has(t)) return _colCache.get(t);
  const { rows } = await query(
    `select column_name from information_schema.columns where table_schema='public' and table_name=$1`,
    [t]
  );
  const set = new Set(rows.map((r) => r.column_name));
  _colCache.set(t, set);
  return set;
}

// jsonb columns accept objects/arrays; stringify them. undefined -> null.
function coerce(v) {
  if (v === undefined) return null;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

function writableEntries(row, cols) {
  return Object.entries(row).filter(([k]) => cols.has(k) && !MANAGED.has(k));
}

// ---------- Row API helpers --------------------------------------------------
async function insert(req, table, row) {
  const t = table.toLowerCase();
  const cols = await tableColumns(t);
  const entries = writableEntries(row, cols);
  if (!entries.length) {
    const { rows } = await query(`insert into ${qi(t)} default values returning *`);
    return catalystify(rows[0]);
  }
  const keys = entries.map(([k]) => k);
  const vals = entries.map(([, v]) => coerce(v));
  const params = vals.map((_, i) => `$${i + 1}`);
  const sql = `insert into ${qi(t)} (${keys.map(qi).join(', ')}) values (${params.join(', ')}) returning *`;
  const { rows } = await query(sql, vals);
  return catalystify(rows[0]);
}

async function bulkInsert(req, table, rows) {
  if (!rows.length) return [];
  const t = table.toLowerCase();
  const cols = await tableColumns(t);
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => cols.has(k) && !MANAGED.has(k));
  if (!keys.length) return [];
  const params = [];
  const tuples = rows.map((r) => {
    const ph = keys.map((k) => {
      params.push(coerce(r[k]));
      return `$${params.length}`;
    });
    return `(${ph.join(', ')})`;
  });
  const sql = `insert into ${qi(t)} (${keys.map(qi).join(', ')}) values ${tuples.join(', ')} returning *`;
  const { rows: out } = await query(sql, params);
  return out.map(catalystify);
}

async function getById(req, table, id) {
  const t = table.toLowerCase();
  const sid = safeId(id);
  if (sid === null) return null;
  try {
    const { rows } = await query(`select * from ${qi(t)} where id = $1 limit 1`, [sid]);
    return rows[0] ? catalystify(rows[0]) : null;
  } catch {
    return null;
  }
}

async function getAll(req, table) {
  const t = table.toLowerCase();
  const { rows } = await query(`select * from ${qi(t)}`);
  return rows.map(catalystify);
}

async function update(req, table, id, patch) {
  const t = table.toLowerCase();
  const sid = safeId(id);
  const cols = await tableColumns(t);
  const entries = writableEntries(patch, cols);
  const vals = entries.map(([, v]) => coerce(v));
  const sets = entries.map(([k], i) => `${qi(k)} = $${i + 1}`);
  sets.push('updated_at = now()');
  const sql = `update ${qi(t)} set ${sets.join(', ')} where id = $${vals.length + 1} returning *`;
  const { rows } = await query(sql, [...vals, sid]);
  return rows[0] ? catalystify(rows[0]) : null;
}

async function remove(req, table, id) {
  const t = table.toLowerCase();
  const sid = safeId(id);
  const { rowCount } = await query(`delete from ${qi(t)} where id = $1`, [sid]);
  return { ROWID: String(id), deleted: rowCount };
}

// Delete EVERY row an org owns in a table, in a single statement. Used by the
// migration purge (offboarding / reset). Returns the number of rows removed.
async function removeByOrg(req, table, orgId) {
  const t = table.toLowerCase();
  const sid = safeId(orgId);
  const { rowCount } = await query(`delete from ${qi(t)} where org_id = $1`, [sid]);
  return rowCount;
}

// ---------- ZCQL-compatibility layer -----------------------------------------
// Translate the app's existing ZCQL strings to Postgres SQL. Only a few things
// differ; table/column case-folding is handled by Postgres itself (our tables
// are lowercase, matching the fold of the app's PascalCase names).
function translateQuery(zq) {
  return String(zq)
    // system columns → our real column names
    .replace(/\bROWID\b/gi, 'id')
    .replace(/\bCREATEDTIME\b/gi, 'created_at')
    .replace(/\bMODIFIEDTIME\b/gi, 'updated_at')
    // MySQL-style "LIMIT offset, count" → Postgres "LIMIT count OFFSET offset"
    .replace(/\bLIMIT\s+(\d+)\s*,\s*(\d+)/gi, 'LIMIT $2 OFFSET $1');
}

// The table a single-table query selects from — used as the nesting key so the
// result matches Catalyst's [{ TableName: {...} }] shape that unwrap() expects.
function fromTable(zq) {
  const m = /\bFROM\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(String(zq));
  return m ? m[1] : '';
}

async function runQuery(zq, nestKey) {
  const { rows } = await query(translateQuery(zq));
  const key = nestKey || fromTable(zq) || '';
  return rows.map((r) => ({ [key]: catalystify(r) }));
}

// Run a ZCQL query. Returns rows nested under the table name (same as Catalyst).
async function zcql(req, queryStr) {
  return runQuery(queryStr, fromTable(queryStr));
}

// Historically paginated around Catalyst's silent 300-row SELECT cap. Postgres
// has no such cap, so this runs the query once. Signature unchanged; `table` is
// used as the nesting key. Pass the query WITHOUT a LIMIT/OFFSET.
async function zcqlAll(req, baseQuery, table) {
  return runQuery(baseQuery, table);
}

// Unwrap a single-table ZCQL result. UNCHANGED.
function unwrap(rows, table) {
  return rows.map((r) => plain(r[table]));
}

// Read a COUNT(...) aggregate out of a ZCQL result. UNCHANGED.
function readCount(rows, table, alias = 'c') {
  if (!rows || !rows.length) return 0;
  const top = plain(rows[0]) || {};
  let inner = top[table];
  if (inner == null) inner = top[''];
  if (inner == null) inner = top;
  inner = plain(inner) || {};
  if (inner[alias] != null) {
    const n = Number(inner[alias]);
    if (Number.isFinite(n)) return n;
  }
  for (const k of Object.keys(inner)) {
    const n = Number(inner[k]);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

// Bounded-concurrency map. Kept for API compatibility (the pool also bounds
// concurrency, but callers still import this).
async function mapLimit(items, fn, limit = 4) {
  const out = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const cur = idx++;
      out[cur] = await fn(items[cur], cur);
    }
  }
  const n = Math.min(limit, items.length) || 0;
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

module.exports = {
  appFor,
  q,
  safeId,
  plain,
  normalize,
  insert,
  bulkInsert,
  getById,
  getAll,
  update,
  remove,
  removeByOrg,
  zcql,
  zcqlAll,
  unwrap,
  readCount,
  mapLimit,
  tableColumns,
};
