// scripts/migrate-sqlite-to-catalyst.js
//
// One-shot data migration from local SQLite (server/data/veena.db) into
// Catalyst Data Store tables created by scripts/create-catalyst-tables.js.
//
// Usage:
//   ZOHO_OAUTH_TOKEN="<self-client access token>" \
//   CATALYST_PROJECT_ID="<project id>" \
//   CATALYST_ENV="development" \
//   CATALYST_API_BASE="https://api.catalyst.zoho.com" \
//   SQLITE_PATH="./server/data/veena.db" \
//   node scripts/migrate-sqlite-to-catalyst.js
//
// Required scope on the OAuth token: ZohoCatalyst.tables.row.CREATE
//
// Notes:
//   - Re-running this script will create duplicate rows. Truncate tables in
//     the Catalyst console first if you need a clean re-run.
//   - SQLite integer ids are NOT preserved. Catalyst assigns its own ROWID.
//     This means foreign-key columns (group_id, student_id, class_id) will
//     reference the OLD SQLite ids. After migration, run a separate fixup
//     pass that maps old ids → new ROWIDs (TODO: implement when needed).

const Database = require('better-sqlite3');

const TOKEN   = process.env.ZOHO_OAUTH_TOKEN;
const PROJECT = process.env.CATALYST_PROJECT_ID || '34954000000015001';
const ENV     = process.env.CATALYST_ENV || 'development';
// India DC default. See create-catalyst-tables.js for other DC URLs.
const BASE    = process.env.CATALYST_API_BASE || 'https://api.catalyst.zoho.in';
const SQLITE  = process.env.SQLITE_PATH || './server/data/veena.db';

if (!TOKEN) {
  console.error('ERROR: set ZOHO_OAUTH_TOKEN env var (Self Client access token).');
  process.exit(1);
}

// Map SQLite table → Catalyst table name and column projection.
// Each entry: { catalystTable, sqliteTable, mapRow: (sqliteRow) => row }
const MIGRATIONS = [
  {
    catalystTable: 'Students',
    sqliteTable:   'students',
    mapRow: (r) => ({
      name:              r.name,
      parent_name:       r.parent_name,
      mobile_number:     r.mobile_number,
      fee_online:        r.fee_online || 0,
      fee_offline:       r.fee_offline || 0,
      fee_offline_group: r.fee_offline_group || 0,
      status:            r.status || 'active',
      notes:             r.notes || '',
    }),
  },
  {
    catalystTable: 'Groups',
    sqliteTable:   'groups_table',
    mapRow: (r) => ({
      name:        r.name,
      description: r.description || '',
    }),
  },
  {
    catalystTable: 'GroupStudents',
    sqliteTable:   'group_students',
    // WARNING: this references OLD SQLite ids. Catalyst assigns its own ROWIDs,
    // so these foreign keys will NOT match anything. Either skip this table
    // (re-add members manually in the UI) or write a separate id-remap pass.
    mapRow: (r) => ({
      group_id:   String(r.group_id),
      student_id: String(r.student_id),
    }),
  },
  {
    catalystTable: 'Classes',
    sqliteTable:   'classes',
    // WARNING: same as GroupStudents — group_id / student_id reference OLD ids.
    mapRow: (r) => ({
      name:             r.name,
      group_id:         r.group_id ? String(r.group_id) : null,
      student_id:       r.student_id ? String(r.student_id) : null,
      class_type:       r.class_type,
      day_of_week:      r.day_of_week,
      start_time:       r.start_time,
      end_time:         r.end_time,
      duration_hours:   r.duration_hours || 1,
      is_active:        r.is_active !== undefined ? r.is_active : 1,
    }),
  },
  {
    catalystTable: 'Attendance',
    sqliteTable:   'attendance',
    // NOTE: SQLite `date` column maps to Catalyst `class_date` (reserved word)
    mapRow: (r) => ({
      student_id:        String(r.student_id),
      class_id:          r.class_id ? String(r.class_id) : null,
      class_date:        r.date,
      status:            r.status,
      class_type:        r.class_type,
      duration_hours:    r.duration_hours,
      fee_charged:       r.fee_charged,
      topic:             r.topic || '',
      notes:             r.notes || '',
    }),
  },
  {
    catalystTable: 'AdditionalFees',
    sqliteTable:   'additional_fees',
    // NOTE: SQLite `month`/`year` map to Catalyst `fee_month`/`fee_year` (reserved words)
    mapRow: (r) => ({
      student_id:        String(r.student_id),
      description:       r.description,
      amount:            r.amount,
      fee_date:          r.fee_date,
      fee_month:         r.month,
      fee_year:          r.year,
    }),
  },
  {
    catalystTable: 'Messages',
    sqliteTable:   'messages',
    mapRow: (r) => ({
      student_id:        r.student_id ? String(r.student_id) : null,
      parent_name:       r.parent_name || '',
      mobile_number:     r.mobile_number || '',
      message:           r.message,
      message_type:      r.message_type || 'custom',
      is_sent:           r.is_sent || 0,
    }),
  },
];

async function insertRows(table, rows) {
  if (rows.length === 0) return { ok: 0, fail: 0 };
  // Catalyst row insert API: POST /baas/v1/project/{id}/{env}/table/{name}/row
  const url = `${BASE}/baas/v1/project/${PROJECT}/${ENV}/table/${table}/row`;
  // Insert in batches of 200 to stay within request size limits.
  const BATCH = 200;
  let ok = 0, fail = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Zoho-oauthtoken ${TOKEN}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(slice),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`  ✗ batch ${i / BATCH + 1}: HTTP ${res.status}`, text.slice(0, 200));
      fail += slice.length;
    } else {
      ok += slice.length;
    }
  }
  return { ok, fail };
}

// Optional CLI: --only Students,Messages  → migrate just these tables
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const onlyTables = onlyArg ? onlyArg.slice(7).split(',').map((s) => s.trim()) : null;

(async () => {
  const db = new Database(SQLITE, { readonly: true });
  console.log(`Migrating from ${SQLITE} → Catalyst project ${PROJECT} (${ENV})`);
  if (onlyTables) console.log(`Limiting to: ${onlyTables.join(', ')}`);
  console.log('');

  for (const m of MIGRATIONS) {
    if (onlyTables && !onlyTables.includes(m.catalystTable)) {
      console.log(`- ${m.catalystTable}: skipped (not in --only list)`);
      continue;
    }
    let sqliteRows;
    try {
      sqliteRows = db.prepare(`SELECT * FROM ${m.sqliteTable}`).all();
    } catch (e) {
      console.warn(`- ${m.sqliteTable}: skipped (${e.message})`);
      continue;
    }
    const rows = sqliteRows.map(m.mapRow);
    process.stdout.write(`→ ${m.catalystTable} (${rows.length} rows)... `);
    const { ok, fail } = await insertRows(m.catalystTable, rows);
    console.log(`${ok} ok, ${fail} failed`);
  }

  db.close();
  console.log('\nMigration complete. Foreign-key columns (group_id/student_id/class_id in Classes/Attendance/etc.) reference OLD SQLite ids — re-link manually if needed.');
})();
