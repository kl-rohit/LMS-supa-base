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
// (created via scripts/create-catalyst-tables.js).

const express = require('express');
const cors = require('cors');
const catalyst = require('zcatalyst-sdk-node');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Per-request Catalyst app. AdvancedIO passes the raw req object; SDK uses it
// to scope datastore() / zcql() calls to the current execution.
function ds(req) {
  return catalyst.initialize(req);
}

// Escape single quotes for ZCQL string literals.
const q = (v) => `'${String(v).replace(/'/g, "''")}'`;

// ---------- GET /api/students -------------------------------------------------
app.get('/api/students', async (req, res) => {
  try {
    const { search, status, page, limit } = req.query;
    const where = [];
    if (status) where.push(`Status = ${q(status)}`);
    if (search) {
      const s = q(`%${search}%`);
      where.push(`(Name LIKE ${s} OR ParentName LIKE ${s} OR MobileNumber LIKE ${s})`);
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
        `SELECT * FROM Students ${whereSql} ORDER BY Name ASC LIMIT ${limitNum} OFFSET ${offset}`
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
      `SELECT * FROM Students ${whereSql} ORDER BY Name ASC`
    );
    res.json({ students: rows.map((r) => normalize(r.Students)) });
  } catch (e) {
    console.error('Error fetching students:', e);
    res.status(500).json({ error: 'Failed to fetch students' });
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
      `SELECT GroupID FROM GroupStudents WHERE StudentID = ${id}`
    );
    const groupIds = links.map((l) => l.GroupStudents.GroupID);
    let groups = [];
    if (groupIds.length) {
      const ids = groupIds.join(',');
      const gRows = await ds(req).zcql().executeZCQLQuery(
        `SELECT * FROM Groups WHERE ROWID IN (${ids})`
      );
      groups = gRows.map((r) => normalize(r.Groups));
    }

    // Classes: directly assigned + via groups.
    const orParts = [`StudentID = ${id}`];
    if (groupIds.length) orParts.push(`GroupID IN (${groupIds.join(',')})`);
    const cRows = await ds(req).zcql().executeZCQLQuery(
      `SELECT * FROM Classes WHERE ${orParts.join(' OR ')}`
    );
    const classes = cRows.map((r) => normalize(r.Classes));

    res.json({ student: normalize(studentRow), groups, classes });
  } catch (e) {
    console.error('Error fetching student:', e);
    res.status(500).json({ error: 'Failed to fetch student' });
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
      Name:             name,
      ParentName:       parent_name,
      MobileNumber:     mobile_number,
      FeeOnline:        fee_online || 0,
      FeeOffline:       fee_offline || 0,
      FeeOfflineGroup:  fee_offline_group || 0,
      Status:           status || 'active',
      Notes:            notes || '',
    });
    res.status(201).json({ student: normalize(inserted) });
  } catch (e) {
    console.error('Error creating student:', e);
    res.status(500).json({ error: 'Failed to create student' });
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
    if (name !== undefined)              patch.Name             = name;
    if (parent_name !== undefined)       patch.ParentName       = parent_name;
    if (mobile_number !== undefined)     patch.MobileNumber     = mobile_number;
    if (fee_online !== undefined)        patch.FeeOnline        = fee_online;
    if (fee_offline !== undefined)       patch.FeeOffline       = fee_offline;
    if (fee_offline_group !== undefined) patch.FeeOfflineGroup  = fee_offline_group;
    if (status !== undefined)            patch.Status           = status;
    if (notes !== undefined)             patch.Notes            = notes;

    const updated = await ds(req).datastore().table('Students').updateRow(patch);
    res.json({ student: normalize(updated) });
  } catch (e) {
    console.error('Error updating student:', e);
    res.status(500).json({ error: 'Failed to update student' });
  }
});

// ---------- DELETE /api/students/inactive ------------------------------------
// Must be defined BEFORE /api/students/:id to take precedence on routing.
app.delete('/api/students/inactive', async (req, res) => {
  try {
    const rows = await ds(req).zcql().executeZCQLQuery(
      `SELECT ROWID FROM Students WHERE Status = 'inactive'`
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
    res.status(500).json({ error: 'Failed to delete inactive students' });
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
      Status: 'inactive',
    });
    res.json({ message: 'Student deactivated successfully' });
  } catch (e) {
    console.error('Error deleting student:', e);
    res.status(500).json({ error: 'Failed to delete student' });
  }
});

// Map Catalyst's PascalCase columns + ROWID back to the snake_case shape the
// existing React client expects, so no frontend changes are needed.
function normalize(row) {
  if (!row) return row;
  return {
    id:                row.ROWID,
    name:              row.Name,
    parent_name:       row.ParentName,
    mobile_number:     row.MobileNumber,
    fee_online:        row.FeeOnline,
    fee_offline:       row.FeeOffline,
    fee_offline_group: row.FeeOfflineGroup,
    status:            row.Status,
    notes:             row.Notes,
    description:       row.Description,
    class_type:        row.ClassType,
    day_of_week:       row.DayOfWeek,
    start_time:        row.StartTime,
    end_time:          row.EndTime,
    duration_hours:    row.DurationHours,
    is_active:         row.IsActive,
    student_id:        row.StudentID,
    group_id:          row.GroupID,
    created_at:        row.CREATEDTIME,
    updated_at:        row.MODIFIEDTIME,
  };
}

module.exports = app;
