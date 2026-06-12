// Single point of contact with Catalyst Data Store + ZCQL.
// Every route file requires this and uses its helpers.

const catalyst = require('zcatalyst-sdk-node');

// IMPORTANT: scope: 'admin' bypasses end-user auth and uses the project's
// own credentials. Veena has no end-user authentication.
function appFor(req) {
  return catalyst.initialize(req, { scope: 'admin' });
}

// Escape single quotes for ZCQL string literals.
const q = (v) => `'${String(v).replace(/'/g, "''")}'`;

// Catalyst ROWIDs are 17-digit numbers that exceed JS Number precision.
// parseInt() on them silently rounds → wrong WHERE clauses → empty results.
// Use this helper to inline IDs into ZCQL: returns digits-only string or null
// (also prevents SQL injection by rejecting non-numeric input).
function safeId(v) {
  if (v === undefined || v === null) return null;
  const s = String(v);
  return /^\d+$/.test(s) ? s : null;
}

// Convert a Catalyst row to plain JSON (handles ZCRecord instances).
function plain(row) {
  if (!row) return row;
  return typeof row.toJSON === 'function' ? row.toJSON() : row;
}

// Translate Catalyst row → shape the React client expects.
// - Un-aliases reserved-word columns (class_date → date, fee_month → month, fee_year → year)
// - Coerces known numeric columns back to JS numbers (Catalyst can return INT/BigInt
//   columns as strings via JSON, which breaks frontend strict-equality filters
//   like `c.day_of_week === 1`).
const NUMERIC_FIELDS = [
  'day_of_week', 'is_active', 'is_sent',
  'duration_hours', 'fee_charged', 'fee_online', 'fee_offline', 'fee_offline_group',
  'amount', 'month', 'year', 'fee_month', 'fee_year',
  'min_classes_per_month',
  // Lessons module
  'duration_seconds', 'order_index', 'start_seconds', 'end_seconds',
  'watched_seconds', 'percent_complete', 'points',
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

// ---------- Row API helpers --------------------------------------------------
async function insert(req, table, row) {
  return plain(await appFor(req).datastore().table(table).insertRow(row));
}

async function bulkInsert(req, table, rows) {
  if (!rows.length) return [];
  const out = await appFor(req).datastore().table(table).insertRows(rows);
  return out.map(plain);
}

async function getById(req, table, id) {
  try {
    return plain(await appFor(req).datastore().table(table).getRow(id));
  } catch {
    return null;
  }
}

async function getAll(req, table) {
  // getAllRows() is deprecated by the SDK + caps at the same 300-row ZCQL
  // ceiling. Drain via the async iterator so we get everything regardless
  // of table size.
  const tbl = appFor(req).datastore().table(table);
  if (typeof tbl.getIterableRows === 'function') {
    const out = [];
    for await (const row of tbl.getIterableRows()) out.push(plain(row));
    return out;
  }
  // Fallback for older SDK versions
  const rows = await tbl.getAllRows();
  return rows.map(plain);
}

async function update(req, table, id, patch) {
  return plain(await appFor(req).datastore().table(table).updateRow({ ROWID: id, ...patch }));
}

async function remove(req, table, id) {
  return appFor(req).datastore().table(table).deleteRow(id);
}

// ---------- ZCQL --------------------------------------------------------------
// Catalyst ZCQL returns rows nested under the table name: [{ Students: {...} }, ...].
// Flatten if there's only one table referenced.
async function zcql(req, query) {
  return appFor(req).zcql().executeZCQLQuery(query);
}

// Paginate a SELECT until the table is exhausted.
//
// IMPORTANT: ZCQL silently caps SELECT at 300 rows per call. A bare
// `SELECT * FROM Attendance` on a 312-row table returns 300 with no error
// and no signal — your downstream filters silently miss rows.
//
// Use this helper for any SELECT that could plausibly exceed 300 rows:
// Attendance, AdditionalFees, LessonProgress, Messages, Payments. Pass
// the query WITHOUT a LIMIT/OFFSET clause; this helper appends them and
// drains the table page-by-page.
//
// Returns the same nested shape as zcql() — caller still uses unwrap().
async function zcqlAll(req, baseQuery, table) {
  const PAGE_SIZE = 300;
  const all = [];
  let offset = 0;
  // Guard against runaway loops if Catalyst ever returns >PAGE_SIZE rows.
  let safety = 200; // up to 60k rows
  while (safety-- > 0) {
    // ZCQL LIMIT syntax: "LIMIT offset, count" — same as MySQL.
    const pageQuery = `${baseQuery} LIMIT ${offset}, ${PAGE_SIZE}`;
    const page = await appFor(req).zcql().executeZCQLQuery(pageQuery);
    if (!page || page.length === 0) break;
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

// Unwrap a ZCQL result for a single-table query.
function unwrap(rows, table) {
  return rows.map((r) => plain(r[table]));
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
  zcql,
  zcqlAll,
  unwrap,
};
