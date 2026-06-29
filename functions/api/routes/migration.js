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
  zcql, zcqlAll, unwrap, insert, update, safeId, appFor, readCount,
} = require('../db/catalystDb');
const {
  MODULES, SYSTEM_COLS, ALIAS_COLS, getModule, refTableFor,
} = require('../db/migrationRegistry');
const { PHOTO_BUCKET, uploadStudentPhoto } = require('../lib/photoUpload');
const { requireFeature } = require('../middleware/entitlement');

const SCHEMA_VERSION = 1;

// Student photos are binary objects in a Stratus bucket, keyed by the student's
// (old) ROWID — so the photo_url column alone does not migrate them. On export
// we inline each photo as a base64 data URL under this field; on import we
// re-upload it under the NEW student's key. Never written as a table column.
const PHOTO_FIELD = '_photo_b64';

// Columns we must never write back on import.
const STRIP = new Set([...SYSTEM_COLS, ...ALIAS_COLS, 'source_id', 'org_id', PHOTO_FIELD]);

// Drain a Stratus Readable stream into a Buffer.
function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

// Best-effort: inline each student's Stratus photo as a base64 data URL so it
// travels with the export. Failures (missing object, no bucket) are swallowed —
// a student simply migrates without a photo rather than failing the export.
async function attachStudentPhotos(req, rows) {
  let bucket;
  try {
    bucket = appFor(req).stratus().bucket(PHOTO_BUCKET);
  } catch {
    return rows; // no Stratus / bucket in this project
  }
  for (const r of rows) {
    const key = String(r.photo_url || '').trim();
    if (!key || key.startsWith('http') || key.startsWith('stratus://')) continue;
    try {
      const stream = await bucket.getObject(key);
      const buf = await streamToBuffer(stream);
      if (buf && buf.length) {
        r[PHOTO_FIELD] = `data:image/jpeg;base64,${buf.toString('base64')}`;
      }
    } catch {
      // object missing / unreadable — skip this photo
    }
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

// Find a row in `table` already carrying this source_id in this org.
async function findBySource(req, table, oldId, orgId) {
  const sid = safeId(oldId);
  if (!sid) return null;
  const rows = await zcql(
    req,
    `SELECT ROWID FROM ${table} WHERE ${table}.source_id = ${sid} AND ${table}.org_id = ${orgId} LIMIT 1`,
  );
  const r = rows && rows[0] && rows[0][table];
  return r ? r.ROWID : null;
}

// Find an AppSettings row by its natural key (setting_key) in this org.
async function findByNaturalKey(req, table, key, value, orgId) {
  if (value === undefined || value === null) return null;
  const rows = await zcql(
    req,
    `SELECT ROWID FROM ${table} WHERE ${table}.${key} = '${String(value).replace(/'/g, "''")}' AND ${table}.org_id = ${orgId} LIMIT 1`,
  );
  const r = rows && rows[0] && rows[0][table];
  return r ? r.ROWID : null;
}

// Import one module's rows. Caches parent lookups for the duration of the call.
async function importModule(req, mod, rows) {
  const orgId = safeId(req.orgId);
  const result = { module: mod.key, table: mod.table, imported: 0, skipped: 0, errors: [] };
  if (!Array.isArray(rows) || rows.length === 0) return result;

  const parentCache = new Map(); // `${refTable}:${oldId}` → newRowId | null

  async function resolveParent(refTable, oldId) {
    const cacheKey = `${refTable}:${oldId}`;
    if (parentCache.has(cacheKey)) return parentCache.get(cacheKey);
    const newId = await findBySource(req, refTable, oldId, orgId);
    parentCache.set(cacheKey, newId);
    return newId;
  }

  for (const raw of rows) {
    const oldId = raw.ROWID || raw.source_id || raw.id;
    try {
      // ---- AppSettings: upsert on natural key, no source_id / FKs ----
      if (mod.naturalKey) {
        const keyVal = raw[mod.naturalKey];
        // Never carry these across a migration. appearance.* is a look-and-feel
        // choice that belongs to the destination academy (importing it would
        // flip the live theme out from under whoever is viewing); onboarding.*
        // are first-run flags whose value is meaningless in another project
        // (importing 'true' would re-trigger the setup wizard / welcome tour).
        if (mod.table === 'AppSettings' && /^(appearance|onboarding)\./.test(String(keyVal || ''))) {
          result.skipped++;
          continue;
        }
        const existing = await findByNaturalKey(req, mod.table, mod.naturalKey, keyVal, orgId);
        const payload = {};
        for (const [k, v] of Object.entries(raw)) {
          if (STRIP.has(k)) continue;
          payload[k] = v;
        }
        payload.org_id = Number(req.orgId);
        if (existing) {
          await update(req, mod.table, existing, payload);
          result.skipped++; // updated in place rather than duplicated
        } else {
          await insert(req, mod.table, payload);
          result.imported++;
        }
        continue;
      }

      // ---- Idempotency: already imported this source row? ----
      if (oldId) {
        const dup = await findBySource(req, mod.table, oldId, orgId);
        if (dup) { result.skipped++; continue; }
      }

      // ---- Build the payload: copy plain columns, remap FKs ----
      const payload = {};
      for (const [k, v] of Object.entries(raw)) {
        if (STRIP.has(k)) continue;
        if (mod.fks[k] !== undefined) continue; // FK handled below
        payload[k] = v;
      }

      // Which FK columns MUST resolve. Omitted → all required (strict);
      // [] → none; [cols] → only those. Non-required FKs whose parent is
      // missing are nulled and the row is kept (a stale/orphaned link is
      // dropped rather than skipping the whole row).
      const isRequiredFk = (fkCol) =>
        (Array.isArray(mod.requiredFks) ? mod.requiredFks.includes(fkCol) : true);

      let missingParent = null;
      for (const [fkCol, fkSpec] of Object.entries(mod.fks)) {
        const oldVal = raw[fkCol];
        if (oldVal === undefined || oldVal === null || oldVal === '' || String(oldVal) === '0') {
          payload[fkCol] = null;
          continue;
        }
        const refTable = refTableFor(fkSpec, raw);
        if (!refTable) { payload[fkCol] = null; continue; }
        const newId = await resolveParent(refTable, oldVal);
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

      payload.org_id = Number(req.orgId);
      // IMPORTANT: source_id must be stored as the exact digit-string, NOT
      // Number(oldId). Catalyst ROWIDs are 17 digits and exceed JS's safe
      // integer limit (2^53), so Number() silently rounds them — and the
      // child FK lookup (findBySource, which uses the exact value via safeId)
      // would then never match the rounded stored value. Keep full precision.
      const sid = safeId(oldId);
      if (sid) payload.source_id = sid;

      // Students: photo_url holds an old-ROWID/old-bucket object key that is
      // meaningless in the new project. Photos are migrated in a SEPARATE pass
      // (POST /import-photos) so a missing bucket never pollutes the row import
      // — clear the column so we never store a dangling reference.
      if (mod.table === 'Students') payload.photo_url = '';

      await insert(req, mod.table, payload);
      result.imported++;
    } catch (err) {
      result.errors.push({ source_id: String(oldId || ''), error: err.message });
    }
  }

  return result;
}

// Second-pass photo import. Takes Students export rows (each carrying its old
// ROWID + inlined `_photo_b64`), finds the already-imported student by
// source_id, and uploads the photo under their NEW ROWID. Run this AFTER the
// Students rows are imported and the Stratus bucket exists.
async function importPhotos(req, rows) {
  const orgId = safeId(req.orgId);
  const result = { module: 'students-photos', imported: 0, skipped: 0, errors: [] };
  if (!Array.isArray(rows) || rows.length === 0) return result;

  // Surface a missing-bucket problem once, clearly, instead of per row.
  try {
    appFor(req).stratus().bucket(PHOTO_BUCKET);
  } catch (e) {
    result.errors.push({ source_id: '', error: `Stratus bucket "${PHOTO_BUCKET}" is unavailable: ${e.message}` });
    return result;
  }

  for (const raw of rows) {
    const oldId = raw.ROWID || raw.source_id || raw.id;
    if (!raw[PHOTO_FIELD]) { result.skipped++; continue; } // no photo on this student
    try {
      const newId = await findBySource(req, 'Students', oldId, orgId);
      if (!newId) {
        result.errors.push({ source_id: String(oldId || ''), error: 'Student not imported yet — import Students first, then re-run photos.' });
        continue;
      }
      await uploadStudentPhoto(req, newId, { data: raw[PHOTO_FIELD] });
      result.imported++;
    } catch (err) {
      result.errors.push({ source_id: String(oldId || ''), error: err.message });
    }
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

    // 3) Drain each table, children first. Read up to 300 ROWIDs at a time and
    //    bulk-delete that page; because deleted rows are gone, re-reading the
    //    first page walks the table to empty. The guard caps a runaway loop.
    const order = [...MODULES].reverse();
    const ds = appFor(req).datastore();
    const summary = [];
    let totalDeleted = 0;

    for (const m of order) {
      let deleted = 0;
      try {
        for (let guard = 0; guard < 1000; guard++) {
          const page = await zcql(
            req,
            `SELECT ROWID FROM ${m.table} WHERE ${m.table}.org_id = ${orgId} LIMIT 0, 300`,
          );
          if (!page || page.length === 0) break;
          const ids = page.map((r) => r[m.table] && r[m.table].ROWID).filter(Boolean);
          if (!ids.length) break;
          await ds.table(m.table).deleteRows(ids);
          deleted += ids.length;
          if (page.length < 300) break;
        }
        summary.push({ module: m.key, table: m.table, deleted });
      } catch (e) {
        // Keep going — a missing table or one failed table shouldn't abort the
        // rest of the purge. Report it in the summary instead.
        summary.push({ module: m.key, table: m.table, deleted, error: e.message });
      }
      totalDeleted += deleted;
    }

    res.json({ ok: true, org_id: Number(orgId), total_deleted: totalDeleted, summary });
  } catch (e) {
    res.status(500).json({ error: 'Purge failed', detail: e.message });
  }
});

module.exports = router;
