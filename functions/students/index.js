// Catalyst AdvancedIO function: Students CRUD on Data Store.
//
// Routes mounted under /api/students (Catalyst strips the /server/students
// prefix before forwarding to this app):
//   GET    /api/students            list (with ?search, ?status, ?page, ?limit)
//   GET    /api/students/:id        single student + groups + classes
//   POST   /api/students            create
//   PUT    /api/students/:id        update
//   DELETE /api/students/:id?force  soft-delete (or hard-delete with force=true)
//   DELETE /api/students/inactive   bulk-delete all inactive
//
// Reads/writes Catalyst Data Store tables: Students, Groups, GroupStudents, Classes
// (created via scripts/create-catalyst-tables.js, which uses snake_case columns).

const express = require('express');
const cors = require('cors');
const catalyst = require('zcatalyst-sdk-node');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Per-request Catalyst app initialized with ADMIN scope.
// Veena has no end-user authentication — only the teacher uses it, and access
// control is via Catalyst's project domain. Admin scope bypasses user-auth
// and uses the project's own credentials, which Catalyst injects as env vars
// (X_ZOHO_CATALYST_PROJECT_ID, X_ZOHO_CATALYST_PROJECT_KEY, etc.) in both
// deployed and `catalyst serve` environments.
function ds(req) {
  return catalyst.initialize(req, { scope: 'admin' });
}

// Escape single quotes for ZCQL string literals.
const q = (v) => `'${String(v).replace(/'/g, "''")}'`;

// ---------- GET / -------------------------------------------------------------
// Friendly landing page so visiting /server/students directly doesn't return
// a bare "Cannot GET /" from Express. Lists the available routes.
app.get('/', (_req, res) => {
  res.json({
    function: 'students',
    routes: [
      'GET    /api/health',
      'GET    /api/students/debug/tables',
      'GET    /api/students',
      'GET    /api/students/:id',
      'POST   /api/students',
      'PUT    /api/students/:id',
      'DELETE /api/students/:id',
      'DELETE /api/students/inactive',
    ],
  });
});

// ---------- GET /api/health ---------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, function: 'students' });
});

// ---------- GET /api/students/debug/tables -----------------------------------
// Diagnostics: tries multiple SDK paths to discover what tables exist.
// SDK method names differ across zcatalyst-sdk-node versions, so we try
// several. If all listing methods fail, we directly probe known table
// names — that's enough to confirm whether `Students` exists.
app.get('/api/students/debug/tables', async (req, res) => {
  const result = { tried: [], tables: null, probe: null };
  const catalystApp = ds(req);
  const datastore = catalystApp.datastore();

  // Try every known table-listing method name.
  const methodsToTry = ['getAllTables', 'getAllTableDetails', 'listTables', 'tables'];
  for (const m of methodsToTry) {
    if (typeof datastore[m] === 'function') {
      try {
        const out = await datastore[m]();
        result.tried.push({ method: m, ok: true, type: Array.isArray(out) ? `array(${out.length})` : typeof out });
        if (Array.isArray(out)) {
          result.tables = out.map((t) => {
            // Different SDK versions expose names differently.
            const name =
              (typeof t.getTableName === 'function' && t.getTableName()) ||
              t.table_name ||
              t.tableName ||
              t.name ||
              null;
            return { name, raw_keys: Object.keys(t).slice(0, 8) };
          });
          break;
        }
      } catch (e) {
        result.tried.push({ method: m, ok: false, error: e.message });
      }
    } else {
      result.tried.push({ method: m, ok: false, error: 'not a function' });
    }
  }

  // Probe known table names directly via the row API.
  // If the table exists, getAllRows() returns []; if not, it throws.
  const probes = ['Students', 'students', 'Student'];
  result.probe = {};
  for (const tableName of probes) {
    try {
      const rows = await datastore.table(tableName).getAllRows();
      result.probe[tableName] = { exists: true, row_count: Array.isArray(rows) ? rows.length : 'unknown' };
    } catch (e) {
      result.probe[tableName] = { exists: false, error: e.message };
    }
  }

  res.json(result);
});

// ---------- GET /api/students -------------------------------------------------
// Uses the direct Data Store API (not ZCQL) for the unfiltered/unsorted case.
// This gives a clearer error if the table doesn't exist. Falls back to ZCQL
// only when search/status filters or pagination are requested.
app.get('/api/students', async (req, res) => {
  try {
    const { search, status, page, limit } = req.query;

    // Simple path: no filters, no pagination. Use getAllRows() — fastest, no ZCQL.
    if (!search && !status && !limit) {
      const rows = await ds(req).datastore().table('Students').getAllRows();
      // getAllRows returns ZCRecord objects in some SDK versions; coerce to plain objects.
      const plainRows = rows.map((r) => (typeof r.toJSON === 'function' ? r.toJSON() : r));
      // Sort in JS so we don't depend on ZCQL ORDER BY.
      plainRows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
      return res.json({ students: plainRows.map(normalize) });
    }

    // Filtered/paginated path: ZCQL.
    const where = [];
    if (status) where.push(`Students.status = ${q(status)}`);
    if (search) {
      const s = q(`%${search}%`);
      where.push(`(Students.name LIKE ${s} OR Students.parent_name LIKE ${s} OR Students.mobile_number LIKE ${s})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    if (limit) {
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit);
      const offset = (pageNum - 1) * limitNum;

      const countRows = await ds(req).zcql().executeZCQLQuery(
        `SELECT COUNT(ROWID) AS total FROM Students ${whereSql}`
      );
      const total = countRows[0]?.Students?.total || 0;

      const rows = await ds(req).zcql().executeZCQLQuery(
        `SELECT * FROM Students ${whereSql} ORDER BY Students.name ASC LIMIT ${limitNum} OFFSET ${offset}`
      );
      return res.json({
        students: rows.map((r) => normalize(r.Students)),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    }

    const rows = await ds(req).zcql().executeZCQLQuery(
      `SELECT * FROM Students ${whereSql} ORDER BY Students.name ASC`
    );
    res.json({ students: rows.map((r) => normalize(r.Students)) });
  } catch (e) {
    console.error('Error fetching students:', e);
    res.status(500).json({ error: 'Failed to fetch students', detail: e.message });
  }
});

// ---------- GET /api/students/:id --------------------------------------------
app.get('/api/students/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const studentRow = await ds(req).datastore().table('Students').getRow(id).catch(() => null);
    if (!studentRow) return res.status(404).json({ error: 'Student not found' });

    // Fetch groups this student belongs to (no JOINs in Data Store -> two queries).
    const links = await ds(req).zcql().executeZCQLQuery(
      `SELECT GroupStudents.group_id FROM GroupStudents WHERE GroupStudents.student_id = ${id}`
    );
    const groupIds = links.map((l) => l.GroupStudents.group_id).filter(Boolean);
    let groups = [];
    if (groupIds.length) {
      const ids = groupIds.join(',');
      const gRows = await ds(req).zcql().executeZCQLQuery(
        `SELECT * FROM Groups WHERE ROWID IN (${ids})`
      );
      groups = gRows.map((r) => normalize(r.Groups));
    }

    // Classes: directly assigned + via groups.
    const orParts = [`Classes.student_id = ${id}`];
    if (groupIds.length) orParts.push(`Classes.group_id IN (${groupIds.join(',')})`);
    const cRows = await ds(req).zcql().executeZCQLQuery(
      `SELECT * FROM Classes WHERE ${orParts.join(' OR ')}`
    );
    const classes = cRows.map((r) => normalize(r.Classes));

    res.json({ student: normalize(studentRow), groups, classes });
  } catch (e) {
    console.error('Error fetching student:', e);
    res.status(500).json({ error: 'Failed to fetch student', detail: e.message });
  }
});

// ---------- POST /api/students -----------------------------------------------
app.post('/api/students', async (req, res) => {
  try {
    const { name, parent_name, mobile_number, fee_online, fee_offline, fee_offline_group, status, notes } = req.body;
    if (!name || !parent_name || !mobile_number) {
      return res.status(400).json({ error: 'name, parent_name, and mobile_number are required' });
    }

    const inserted = await ds(req).datastore().table('Students').insertRow({
      name,
      parent_name,
      mobile_number,
      fee_online:        fee_online || 0,
      fee_offline:       fee_offline || 0,
      fee_offline_group: fee_offline_group || 0,
      status:            status || 'active',
      notes:             notes || '',
    });
    res.status(201).json({ student: normalize(inserted) });
  } catch (e) {
    console.error('Error creating student:', e);
    res.status(500).json({ error: 'Failed to create student', detail: e.message });
  }
});

// ---------- PUT /api/students/:id --------------------------------------------
app.put('/api/students/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await ds(req).datastore().table('Students').getRow(id).catch(() => null);
    if (!existing) return res.status(404).json({ error: 'Student not found' });

    const { name, parent_name, mobile_number, fee_online, fee_offline, fee_offline_group, status, notes } = req.body;
    const patch = { ROWID: id };
    if (name !== undefined)              patch.name              = name;
    if (parent_name !== undefined)       patch.parent_name       = parent_name;
    if (mobile_number !== undefined)     patch.mobile_number     = mobile_number;
    if (fee_online !== undefined)        patch.fee_online        = fee_online;
    if (fee_offline !== undefined)       patch.fee_offline       = fee_offline;
    if (fee_offline_group !== undefined) patch.fee_offline_group = fee_offline_group;
    if (status !== undefined)            patch.status            = status;
    if (notes !== undefined)             patch.notes             = notes;

    const updated = await ds(req).datastore().table('Students').updateRow(patch);
    res.json({ student: normalize(updated) });
  } catch (e) {
    console.error('Error updating student:', e);
    res.status(500).json({ error: 'Failed to update student', detail: e.message });
  }
});

// ---------- DELETE /api/students/inactive ------------------------------------
// Must be defined BEFORE /api/students/:id to take precedence on routing.
app.delete('/api/students/inactive', async (req, res) => {
  try {
    const rows = await ds(req).zcql().executeZCQLQuery(
      `SELECT ROWID FROM Students WHERE Students.status = 'inactive'`
    );
    const ids = rows.map((r) => r.Students.ROWID);
    // Data Store has no transactions; delete sequentially. Document partial-failure risk.
    let deleted = 0;
    for (const id of ids) {
      try {
        await ds(req).datastore().table('Students').deleteRow(id);
        deleted++;
      } catch (err) {
        console.error('Failed to delete student', id, err.message);
      }
    }
    res.json({ message: `Deleted ${deleted} inactive student(s)`, count: deleted });
  } catch (e) {
    console.error('Error bulk-deleting inactive students:', e);
    res.status(500).json({ error: 'Failed to delete inactive students', detail: e.message });
  }
});

// ---------- DELETE /api/students/:id -----------------------------------------
app.delete('/api/students/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await ds(req).datastore().table('Students').getRow(id).catch(() => null);
    if (!existing) return res.status(404).json({ error: 'Student not found' });

    const force = req.query.force === 'true' || req.query.force === '1';
    if (force) {
      await ds(req).datastore().table('Students').deleteRow(id);
      return res.json({ message: 'Student permanently deleted' });
    }

    await ds(req).datastore().table('Students').updateRow({
      ROWID: id,
      status: 'inactive',
    });
    res.json({ message: 'Student deactivated successfully' });
  } catch (e) {
    console.error('Error deleting student:', e);
    res.status(500).json({ error: 'Failed to delete student', detail: e.message });
  }
});

// Map a Catalyst row (snake_case columns + ROWID + CREATEDTIME/MODIFIEDTIME)
// to the shape the React client already expects: snake_case + numeric `id`.
function normalize(row) {
  if (!row) return row;
  return {
    id:                row.ROWID,
    name:              row.name,
    parent_name:       row.parent_name,
    mobile_number:     row.mobile_number,
    fee_online:        row.fee_online,
    fee_offline:       row.fee_offline,
    fee_offline_group: row.fee_offline_group,
    status:            row.status,
    notes:             row.notes,
    description:       row.description,
    class_type:        row.class_type,
    day_of_week:       row.day_of_week,
    start_time:        row.start_time,
    end_time:          row.end_time,
    duration_hours:    row.duration_hours,
    is_active:         row.is_active,
    student_id:        row.student_id,
    group_id:          row.group_id,
    created_at:        row.created_at || row.CREATEDTIME,
    updated_at:        row.updated_at || row.MODIFIEDTIME,
  };
}

module.exports = app;
