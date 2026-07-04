// /api/migration — in-app data Export / Import for moving an academy between
// two separate Catalyst projects (different accounts / data centres), where
// the CLI, BaaS export and REST bulk APIs are unavailable.
//
// Flow:
//   1. On the OLD app:  GET /api/migration/export        → download a JSON bundle
//                       GET /api/migration/export/:module → one module at a time
//   2. On the NEW app:  POST /api/migration/import/:module (step by step), or
//                       POST /api/migration/import        (whole bundle, in order)
//
// Relationships survive the re-keying via the `source_id` column — see
// db/migrationRegistry.js for the full explanation. Org scoping: export filters
// by req.orgId, import stamps req.orgId on every row.

const router = require('express').Router();
const {
  zcql, zcqlAll, unwrap, update, safeId, readCount, bulkInsert, removeByOrg,
} = require('../db/catalystDb');
const {
  MODULES, SYSTEM_COLS, ALIAS_COLS, getModule, refTableFor,
} = require('../db/migrationRegistry');
const { uploadStudentPhoto } = require('../lib/photoUpload');
const storage = require('../lib/supabaseStorage');
const { requireFeature } = require('../middleware/entitlement');

const SCHEMA_VERSION = 1;

// Student photos are binary objects in a Stratus bucket, keyed by the student's
// (old) ROWID — so the photo_url column alone does not migrate them. On export
// we inline each photo as a base64 data URL under this field; on import we
// re-upload it under the NEW student's key. Never written as a table column.
const PHOTO_FIELD = '_photo_b64';

// Columns we must never write back on import.
const STRIP = new Set([...SYSTEM_COLS, ...ALIAS_COLS, 'source_id', 'org_id', PHOTO_FIELD]);

// Best-effort: inline each student's stored photo as a base64 data URL so it
// travels with the export. Reads from Supabase Storage (where photos actually
// live — the object KEY is in photo_url). Failures (missing object, a legacy
// full URL) are swallowed: a student simply migrates without a photo rather
// than failing the whole export. Bounded concurrency keeps the export snappy.
const EXPORT_PHOTO_CONCURRENCY = 5;
async function attachStudentPhotos(req, rows) {
  const targets = rows.filter((r) => {
    const key = String(r.photo_url || '').trim();
    return key && !key.startsWith('http') && !key.startsWith('stratus://');
  });
  for (let i = 0; i < targets.length; i += EXPORT_PHOTO_CONCURRENCY) {
    const chunk = targets.slice(i, i + EXPORT_PHOTO_CONCURRENCY);
    await Promise.all(chunk.map(async (r) => {
      try {
        const buf = await storage.downloadBuffer(String(r.photo_url).trim());
        if (buf && buf.length) {
          r[PHOTO_FIELD] = `data:image/jpeg;base64,${buf.toString('base64')}`;
        }
      } catch {
        // object missing / unreadable — skip this photo
      }
    }));
  }
  return rows;
}

// ---------- helpers ----------------------------------------------------------

// All org-scoped rows of a table, raw (real DB columns + ROWID, no aliasing).
// Students additionally get their Stratus photo inlined as base64.
async function exportTable(req, table) {
  const orgId = safeId(req.orgId);
  const rows = unwrap(
    await zcqlAll(req, `SELECT * FROM ${table} WHERE ${table}.org_id = ${orgId}`, table),
    table,
  );
  if (table === 'Students') await attachStudentPhotos(req, rows);
  return rows;
}

// Rows that must never exceed the Postgres bind-parameter ceiling (65535) in a
// single bulk INSERT: chunk generously below it (500 rows × up to ~30 cols).
const INSERT_CHUNK = 500;

// Load a `source_id → new ROWID` map for a parent table in this org, once.
// Replaces the per-row findBySource SELECT that made imports O(rows) round-trips.
async function loadSourceMap(req, table, orgId) {
  const rows = unwrap(
    await zcqlAll(req, `SELECT ROWID, source_id FROM ${table} WHERE ${table}.org_id = ${orgId}`, table),
    table,
  );
  const map = new Map();
  for (const r of rows) {
    const sid = safeId(r.source_id);
    if (sid) map.set(sid, String(r.ROWID));
  }
  return map;
}

// Set of source_ids already imported into this table in this org (idempotency).
async function loadExistingSources(req, table, orgId) {
  const rows = unwrap(
    await zcqlAll(req, `SELECT source_id FROM ${table} WHERE ${table}.org_id = ${orgId}`, table),
    table,
  );
  const set = new Set();
  for (const r of rows) {
    const sid = safeId(r.source_id);
    if (sid) set.add(sid);
  }
  return set;
}

// Map an AppSettings-style natural key value → existing ROWID, once.
async function loadNaturalKeyMap(req, table, key, orgId) {
  const rows = unwrap(
    await zcqlAll(req, `SELECT ROWID, ${key} FROM ${table} WHERE ${table}.org_id = ${orgId}`, table),
    table,
  );
  const map = new Map();
  for (const r of rows) {
    if (r[key] !== undefined && r[key] !== null) map.set(String(r[key]), String(r.ROWID));
  }
  return map;
}

// Bulk-insert payloads in chunks so a large module never exceeds the bind-param
// ceiling. Returns the number of rows actually written.
async function bulkInsertChunked(req, table, payloads) {
  let n = 0;
  for (let i = 0; i < payloads.length; i += INSERT_CHUNK) {
    const chunk = payloads.slice(i, i + INSERT_CHUNK);
    const out = await bulkInsert(req, table, chunk);
    n += out.length;
  }
  return n;
}

// Import one module's rows. All parent lookups and the idempotency check are
// pre-loaded into memory in a handful of queries, then every writable row is
// bulk-inserted — so a module costs a few round-trips regardless of row count
// (the old per-row SELECT+INSERT design blew past the gateway timeout at scale).
async function importModule(req, mod, rows) {
  const orgId = safeId(req.orgId);
  const orgNum = Number(req.orgId);
  const result = { module: mod.key, table: mod.table, imported: 0, skipped: 0, errors: [] };
  if (!Array.isArray(rows) || rows.length === 0) return result;

  // ---- AppSettings: upsert on natural key, no source_id / FKs ----
  if (mod.naturalKey) {
    const existingMap = await loadNaturalKeyMap(req, mod.table, mod.naturalKey, orgId);
    const toInsert = [];
    for (const raw of rows) {
      const keyVal = raw[mod.naturalKey];
      try {
        // Never carry these across a migration. appearance.* is a look-and-feel
        // choice that belongs to the destination academy (importing it would
        // flip the live theme out from under whoever is viewing); onboarding.*
        // are first-run flags whose value is meaningless in another project
        // (importing 'true' would re-trigger the setup wizard / welcome tour).
        if (mod.table === 'AppSettings' && /^(appearance|onboarding)\./.test(String(keyVal || ''))) {
          result.skipped++;
          continue;
        }
        const payload = {};
        for (const [k, v] of Object.entries(raw)) {
          if (STRIP.has(k)) continue;
          payload[k] = v;
        }
        payload.org_id = orgNum;
        const existingId = keyVal !== undefined && keyVal !== null ? existingMap.get(String(keyVal)) : null;
        if (existingId) {
          await update(req, mod.table, existingId, payload);
          result.skipped++; // updated in place rather than duplicated
        } else {
          toInsert.push(payload);
        }
      } catch (err) {
        result.errors.push({ source_id: String(keyVal || ''), error: err.message });
      }
    }
    if (toInsert.length) result.imported += await bulkInsertChunked(req, mod.table, toInsert);
    return result;
  }

  // ---- Pre-load idempotency set + every parent table's source→id map ----
  const existing = await loadExistingSources(req, mod.table, orgId);

  const parentMaps = new Map(); // refTable → Map(sourceId → newRowId)
  const refTables = new Set();
  for (const fkSpec of Object.values(mod.fks)) {
    if (typeof fkSpec === 'string') refTables.add(fkSpec);
  }
  // Polymorphic FKs (functions) resolve per-row — discover the tables they hit.
  for (const raw of rows) {
    for (const fkSpec of Object.values(mod.fks)) {
      if (typeof fkSpec === 'function') {
        const t = refTableFor(fkSpec, raw);
        if (t) refTables.add(t);
      }
    }
  }
  for (const t of refTables) parentMaps.set(t, await loadSourceMap(req, t, orgId));

  const isRequiredFk = (fkCol) =>
    (Array.isArray(mod.requiredFks) ? mod.requiredFks.includes(fkCol) : true);

  // ---- Build every writable payload in memory, then bulk-insert ----
  const toInsert = [];
  for (const raw of rows) {
    const oldId = raw.ROWID || raw.source_id || raw.id;
    const sid = safeId(oldId);
    try {
      // Idempotency: already imported this source row?
      if (sid && existing.has(sid)) { result.skipped++; continue; }

      // Copy plain columns; FK columns are remapped below.
      const payload = {};
      for (const [k, v] of Object.entries(raw)) {
        if (STRIP.has(k)) continue;
        if (mod.fks[k] !== undefined) continue;
        payload[k] = v;
      }

      let missingParent = null;
      for (const [fkCol, fkSpec] of Object.entries(mod.fks)) {
        const oldVal = raw[fkCol];
        if (oldVal === undefined || oldVal === null || oldVal === '' || String(oldVal) === '0') {
          payload[fkCol] = null;
          continue;
        }
        const refTable = refTableFor(fkSpec, raw);
        if (!refTable) { payload[fkCol] = null; continue; }
        const newId = (parentMaps.get(refTable) || new Map()).get(safeId(oldVal));
        if (!newId) {
          if (isRequiredFk(fkCol)) {
            missingParent = { fkCol, refTable, oldVal: String(oldVal) };
            break;
          }
          // Optional link to a parent that didn't migrate — drop the dead
          // reference and keep the row.
          payload[fkCol] = null;
          continue;
        }
        payload[fkCol] = String(newId);
      }

      if (missingParent) {
        result.errors.push({
          source_id: String(oldId || ''),
          error: `Parent not found: ${missingParent.refTable}.source_id=${missingParent.oldVal} for ${missingParent.fkCol}. Import ${missingParent.refTable} first.`,
        });
        continue;
      }

      payload.org_id = orgNum;
      // IMPORTANT: source_id must be stored as the exact digit-string, NOT
      // Number(oldId). Catalyst ROWIDs are 17 digits and exceed JS's safe
      // integer limit (2^53), so Number() silently rounds them — and the parent
      // source→id map (keyed via safeId) would then never match. Keep precision.
      if (sid) payload.source_id = sid;

      // Students: photo_url holds an old-ROWID/old-bucket object key that is
      // meaningless in the new project. Photos are migrated in a SEPARATE pass
      // (POST /import-photos) so a missing bucket never pollutes the row import
      // — clear the column so we never store a dangling reference.
      if (mod.table === 'Students') payload.photo_url = '';

      toInsert.push(payload);
    } catch (err) {
      result.errors.push({ source_id: String(oldId || ''), error: err.message });
    }
  }

  if (toInsert.length) result.imported += await bulkInsertChunked(req, mod.table, toInsert);
  return result;
}

// Second-pass photo import. Takes Students export rows (each carrying its old
// ROWID + inlined `_photo_b64`), finds the already-imported student by
// source_id, and uploads the photo under their NEW ROWID via Supabase Storage.
// Run this AFTER the Students rows are imported.
const PHOTO_CONCURRENCY = 5;
async function importPhotos(req, rows) {
  const orgId = safeId(req.orgId);
  const result = { module: 'students-photos', imported: 0, skipped: 0, errors: [] };
  if (!Array.isArray(rows) || rows.length === 0) return result;

  // Resolve every student once, then upload photos with bounded concurrency.
  const studentMap = await loadSourceMap(req, 'Students', orgId);
  const withPhoto = rows.filter((r) => r[PHOTO_FIELD]);
  result.skipped += rows.length - withPhoto.length; // students with no photo

  for (let i = 0; i < withPhoto.length; i += PHOTO_CONCURRENCY) {
    const chunk = withPhoto.slice(i, i + PHOTO_CONCURRENCY);
    await Promise.all(chunk.map(async (raw) => {
      const oldId = raw.ROWID || raw.source_id || raw.id;
      const newId = studentMap.get(safeId(oldId));
      if (!newId) {
        result.errors.push({ source_id: String(oldId || ''), error: 'Student not imported yet — import Students first, then re-run photos.' });
        return;
      }
      try {
        const up = await uploadStudentPhoto(req, newId, { data: raw[PHOTO_FIELD] });
        if (up && up.status === 200) result.imported++;
        else result.errors.push({ source_id: String(oldId || ''), error: (up && up.json && up.json.error) || 'Photo upload rejected' });
      } catch (err) {
        result.errors.push({ source_id: String(oldId || ''), error: err.message });
      }
    }));
  }
  return result;
}

// ---------- routes -----------------------------------------------------------

// GET /api/migration/modules — describe the migration plan (for the UI).
router.get('/modules', (req, res) => {
  res.json({
    schema_version: SCHEMA_VERSION,
    modules: MODULES.map((m, i) => ({
      key: m.key,
      table: m.table,
      label: m.label,
      order: i,
      depends_on: Array.from(
        new Set(
          Object.values(m.fks)
            .map((s) => (typeof s === 'string' ? s : null))
            .filter(Boolean),
        ),
      ),
    })),
  });
});

// GET /api/migration/counts — row count per module for the active org.
router.get('/counts', async (req, res) => {
  try {
    const orgId = safeId(req.orgId);
    const counts = {};
    for (const m of MODULES) {
      try {
        const rows = await zcql(req, `SELECT COUNT(ROWID) AS c FROM ${m.table} WHERE ${m.table}.org_id = ${orgId}`);
        counts[m.key] = readCount(rows, m.table);
      } catch (_e) {
        counts[m.key] = null; // table may not exist in this project
      }
    }
    res.json({ counts });
  } catch (e) {
    res.status(500).json({ error: 'Failed to count rows', detail: e.message });
  }
});

// GET /api/migration/export/:module — one module's rows.
router.get('/export/:module', requireFeature('data.export'), async (req, res) => {
  try {
    const mod = getModule(req.params.module);
    if (!mod) return res.status(404).json({ error: `Unknown module: ${req.params.module}` });
    const rows = await exportTable(req, mod.table);
    res.json({
      schema_version: SCHEMA_VERSION,
      module: mod.key,
      table: mod.table,
      org_id: Number(req.orgId),
      exported_at: new Date().toISOString(),
      count: rows.length,
      rows,
    });
  } catch (e) {
    res.status(500).json({ error: 'Export failed', detail: e.message });
  }
});

// GET /api/migration/export — full bundle, all modules in dependency order.
router.get('/export', requireFeature('data.export'), async (req, res) => {
  try {
    const bundle = {
      schema_version: SCHEMA_VERSION,
      kind: 'veena-migration-bundle',
      org_id: Number(req.orgId),
      exported_at: new Date().toISOString(),
      order: MODULES.map((m) => m.key),
      modules: {},
      counts: {},
    };
    for (const m of MODULES) {
      try {
        const rows = await exportTable(req, m.table);
        bundle.modules[m.key] = rows;
        bundle.counts[m.key] = rows.length;
      } catch (err) {
        bundle.modules[m.key] = [];
        bundle.counts[m.key] = null; // table missing in this project
      }
    }
    res.json(bundle);
  } catch (e) {
    res.status(500).json({ error: 'Export failed', detail: e.message });
  }
});

// POST /api/migration/import-photos  body: { rows: [...] }  (Students export rows)
// Second pass: upload student photos once the rows exist and the bucket is set.
router.post('/import-photos', async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows) return res.status(400).json({ error: 'rows[] (Students export rows) is required' });
    const result = await importPhotos(req, rows);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Photo import failed', detail: e.message });
  }
});

// POST /api/migration/import/:module  body: { rows: [...] }
router.post('/import/:module', async (req, res) => {
  try {
    const mod = getModule(req.params.module);
    if (!mod) return res.status(404).json({ error: `Unknown module: ${req.params.module}` });
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows) return res.status(400).json({ error: 'rows[] is required' });
    const result = await importModule(req, mod, rows);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Import failed', detail: e.message });
  }
});

// POST /api/migration/import  body: a full export bundle { modules: {...} }
// Imports every module in dependency order. Parents land before children, so a
// single call migrates the whole academy.
router.post('/import', async (req, res) => {
  try {
    const modules = req.body?.modules;
    if (!modules || typeof modules !== 'object') {
      return res.status(400).json({ error: 'A migration bundle with a modules{} object is required' });
    }
    const results = [];
    for (const m of MODULES) {
      const rows = modules[m.key];
      if (!Array.isArray(rows) || rows.length === 0) continue;
      results.push(await importModule(req, m, rows));
    }
    // Final pass: student photos (rows are imported above; bucket must exist).
    if (Array.isArray(modules.students) && modules.students.length) {
      results.push(await importPhotos(req, modules.students));
    }
    const totals = results.reduce(
      (acc, r) => ({
        imported: acc.imported + r.imported,
        skipped: acc.skipped + r.skipped,
        errors: acc.errors + r.errors.length,
      }),
      { imported: 0, skipped: 0, errors: 0 },
    );
    res.json({ totals, results });
  } catch (e) {
    res.status(500).json({ error: 'Import failed', detail: e.message });
  }
});

// =============================================================================
// POST /api/migration/purge  — DESTRUCTIVE, IRREVERSIBLE
// =============================================================================
// Deletes EVERY row this org owns across all migrated tables. Intended for
// offboarding / resetting an academy AFTER a verified "Export everything".
//
// Guardrails (defence in depth):
//   • Only the org owner (or a platform admin acting on the org) may call it.
//   • The caller must type the academy's exact name (or slug) in `confirm`;
//     we re-read it from the Organizations row server-side, so a blind or
//     replayed request without the live name is rejected.
//   • Deletes children → parents (the reverse of import order) so a partial
//     failure never strands a child whose parent already vanished.
//
// The Organizations row and OrgMemberships are intentionally LEFT INTACT —
// purge wipes tenant data, it does not dissolve the org or lock anyone out.
// Suspend the org separately if you also want to disable access.
router.post('/purge', async (req, res) => {
  try {
    // 1) Role gate — owners and platform admins only.
    const role = req.orgRole;
    if (role !== 'owner' && role !== 'platform_admin') {
      return res.status(403).json({ error: 'Only the academy owner can delete all data.' });
    }

    const orgId = safeId(req.orgId);

    // 2) Typed-confirmation gate — must match the live org name or slug.
    let org = null;
    try {
      const rows = await zcql(req, `SELECT * FROM Organizations WHERE ROWID = ${orgId}`);
      org = unwrap(rows, 'Organizations')[0] || null;
    } catch { /* if the lookup fails we fall through and reject below */ }

    const confirm = String(req.body?.confirm || '').trim().toLowerCase();
    const name = String(org?.name || '').trim().toLowerCase();
    const slug = String(org?.slug || '').trim().toLowerCase();
    if (!confirm || (confirm !== name && confirm !== slug)) {
      return res.status(400).json({
        error: 'Confirmation did not match. Type the academy name exactly to delete all its data.',
      });
    }

    // 3) Delete each table's rows for this org, children first (reverse import
    //    order) so a partial failure never strands a child whose parent already
    //    vanished. One statement per table via the Supabase-aware helper.
    const order = [...MODULES].reverse();
    const summary = [];
    let totalDeleted = 0;

    for (const m of order) {
      try {
        const deleted = await removeByOrg(req, m.table, orgId);
        summary.push({ module: m.key, table: m.table, deleted });
        totalDeleted += deleted;
      } catch (e) {
        // Keep going — a missing table or one failed table shouldn't abort the
        // rest of the purge. Report it in the summary instead.
        summary.push({ module: m.key, table: m.table, deleted: 0, error: e.message });
      }
    }

    res.json({ ok: true, org_id: Number(orgId), total_deleted: totalDeleted, summary });
  } catch (e) {
    res.status(500).json({ error: 'Purge failed', detail: e.message });
  }
});

module.exports = router;
