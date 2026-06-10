// scripts/create-catalyst-tables.js
//
// Bulk-creates all Veena tables in Catalyst Data Store via the Admin REST API.
//
// Usage:
//   ZOHO_OAUTH_TOKEN="<self-client access token>" \
//   CATALYST_PROJECT_ID="<project id>" \
//   CATALYST_ENV="development" \
//   CATALYST_API_BASE="https://api.catalyst.zoho.com" \   # change DC if needed: .in / .eu / .com.au
//   node scripts/create-catalyst-tables.js
//
// Requires: Node 18+ (uses global fetch). No npm dependencies.
//
// How to get ZOHO_OAUTH_TOKEN:
//   1. Catalyst console -> Settings -> API Console -> create a Self Client.
//   2. Generate an access token with scope:
//        ZohoCatalyst.tables.CREATE  (or ZohoCatalyst.admin.ALL)
//   3. Tokens last ~1 hour. If the run takes longer, regenerate.

const TOKEN   = process.env.ZOHO_OAUTH_TOKEN;
const PROJECT = process.env.CATALYST_PROJECT_ID || '34954000000015001';
const ENV     = process.env.CATALYST_ENV || 'development';
// Defaults to India DC. Override with CATALYST_API_BASE env var for other DCs:
//   US:  https://api.catalyst.zoho.com
//   IN:  https://api.catalyst.zoho.in    (default)
//   EU:  https://api.catalyst.zoho.eu
//   AU:  https://api.catalyst.zoho.com.au
const BASE    = process.env.CATALYST_API_BASE || 'https://api.catalyst.zoho.in';

if (!TOKEN) {
  console.error('ERROR: set ZOHO_OAUTH_TOKEN env var (Self Client access token).');
  process.exit(1);
}

// Catalyst Data Store column types: text, bigint, int, double, boolean, datetime, encryptedtext.
// Per-column flags: is_mandatory, is_unique, default_value, max_length.
function col(column_name, data_type, opts = {}) {
  const c = {
    column_name,
    data_type,
    is_mandatory: opts.is_mandatory ?? false,
    is_unique:    opts.is_unique    ?? false,
  };
  if (opts.default_value !== undefined) c.default_value = opts.default_value;
  if (opts.max_length    !== undefined) c.max_length    = opts.max_length;
  return c;
}

const tables = [
  {
    table_name: 'Students',
    columns: [
      col('name',              'text', { is_mandatory: true }),
      col('parent_name',       'text', { is_mandatory: true }),
      col('mobile_number',     'text', { is_mandatory: true }),
      col('fee_online',        'double', { default_value: 0 }),
      col('fee_offline',       'double', { default_value: 0 }),
      col('fee_offline_group', 'double', { default_value: 0 }),
      col('status',            'text',   { default_value: 'active' }),
      col('notes',             'text'),
      col('created_at',        'datetime'),
      col('updated_at',        'datetime'),
    ],
  },
  {
    table_name: 'Groups',
    columns: [
      col('name',        'text', { is_mandatory: true, is_unique: true }),
      col('description', 'text'),
      col('created_at',  'datetime'),
    ],
  },
  {
    table_name: 'GroupStudents',
    columns: [
      col('group_id',   'bigint', { is_mandatory: true }),
      col('student_id', 'bigint', { is_mandatory: true }),
    ],
  },
  {
    table_name: 'Classes',
    columns: [
      col('name',           'text',   { is_mandatory: true }),
      col('group_id',       'bigint'),
      col('student_id',     'bigint'),
      col('class_type',     'text',   { is_mandatory: true }),
      col('day_of_week',    'int',    { is_mandatory: true }),
      col('start_time',     'text',   { is_mandatory: true }),
      col('end_time',       'text',   { is_mandatory: true }),
      col('duration_hours', 'double', { default_value: 1 }),
      col('is_active',      'int',    { default_value: 1 }),
      col('created_at',     'datetime'),
    ],
  },
  {
    table_name: 'ClassStudents',
    columns: [
      col('class_id',   'bigint', { is_mandatory: true }),
      col('student_id', 'bigint', { is_mandatory: true }),
    ],
  },
  {
    table_name: 'Attendance',
    columns: [
      col('student_id',     'bigint', { is_mandatory: true }),
      col('class_id',       'bigint', { is_mandatory: true }),
      col('date',           'text',   { is_mandatory: true }),
      col('status',         'text',   { is_mandatory: true }),
      col('class_type',     'text',   { is_mandatory: true }),
      col('duration_hours', 'double', { default_value: 1 }),
      col('fee_charged',    'double', { default_value: 0 }),
      col('topic',          'text'),
      col('notes',          'text'),
      col('created_at',     'datetime'),
    ],
  },
  {
    table_name: 'AdditionalFees',
    columns: [
      col('student_id',  'bigint', { is_mandatory: true }),
      col('description', 'text',   { is_mandatory: true }),
      col('amount',      'double', { is_mandatory: true }),
      col('fee_date',    'text',   { is_mandatory: true }),
      col('month',       'int',    { is_mandatory: true }),
      col('year',        'int',    { is_mandatory: true }),
      col('created_at',  'datetime'),
    ],
  },
  {
    table_name: 'Messages',
    columns: [
      col('student_id',    'bigint'),
      col('parent_name',   'text'),
      col('mobile_number', 'text'),
      col('message',       'text', { is_mandatory: true }),
      col('message_type',  'text', { default_value: 'custom' }),
      col('is_sent',       'int',  { default_value: 0 }),
      col('created_at',    'datetime'),
    ],
  },
  {
    table_name: 'Settings',
    columns: [
      col('key',        'text', { is_mandatory: true, is_unique: true }),
      col('value',      'text', { is_mandatory: true }),
      col('updated_at', 'datetime'),
    ],
  },
];

async function createTable(t) {
  const url = `${BASE}/baas/v1/project/${PROJECT}/${ENV}/table`;
  let res, text, body;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Zoho-oauthtoken ${TOKEN}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(t),
    });
    text = await res.text();
    try { body = JSON.parse(text); } catch { body = text; }
  } catch (err) {
    console.error(`✗ ${t.table_name}: network error`, err.message);
    return false;
  }
  if (!res.ok) {
    console.error(`✗ ${t.table_name}: HTTP ${res.status}`,
      typeof body === 'string' ? body.slice(0, 300) : body);
    return false;
  }
  console.log(`✓ ${t.table_name} created`);
  return true;
}

(async () => {
  console.log(`Creating ${tables.length} tables in project ${PROJECT} (${ENV})...\n`);
  let ok = 0, fail = 0;
  for (const t of tables) {
    const r = await createTable(t);
    r ? ok++ : fail++;
  }
  console.log(`\nDone. ${ok} created, ${fail} failed.`);
  process.exit(fail ? 1 : 0);
})();
