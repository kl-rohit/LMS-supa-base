// Shared Postgres (Supabase) connection pool.
//
// Replaces the per-request Catalyst SDK init. On Cloud Run the process is
// long-lived, so a single module-level pool is reused across requests.
//
// Connection string comes from (in order): env SUPABASE_DB_URL, then
// functions/api/supabase-config.json (gitignored). SSL is required by Supabase;
// rejectUnauthorized:false accepts their managed cert without a local CA file.
//
// IMPORTANT: pg returns bigint/int8 (our 17-digit ids) and numeric as STRINGS
// by default. We keep that — parsing int8 as a JS Number would silently lose
// precision on the 17-digit ids. normalize() coerces the known numeric display
// columns back to numbers where the client needs them.

const { Pool } = require('pg');

function loadDbUrl() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  try {
    const cfg = require('../supabase-config.json');
    if (cfg && cfg.supabase_db_url) return cfg.supabase_db_url;
  } catch (_) { /* fall through */ }
  throw new Error(
    'Supabase DB URL not configured: set SUPABASE_DB_URL or functions/api/supabase-config.json'
  );
}

const pool = new Pool({
  connectionString: loadDbUrl(),
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
});

pool.on('error', (e) => console.error('[pg] idle client error:', e.message));

function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
