const express = require('express');
const router = express.Router();
const { getDb } = require('../db/schema');
const { syncStudentCreate, syncStudentUpdate, syncStudentDelete } = require('../services/zohoSync');

// GET /api/students - Get all students with optional search/filter
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const { search, status, page, limit } = req.query;

    let query = 'SELECT * FROM students WHERE 1=1';
    const params = [];

    // Filter by status (default: show active only unless explicitly requested)
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    // Search by name, parent_name, or mobile_number
    if (search) {
      query += ' AND (name LIKE ? OR parent_name LIKE ? OR mobile_number LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    query += ' ORDER BY name ASC';

    // Pagination
    if (limit) {
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit);
      const offset = (pageNum - 1) * limitNum;

      // Get total count for pagination metadata
      const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
      const { total } = db.prepare(countQuery).get(...params);

      query += ' LIMIT ? OFFSET ?';
      params.push(limitNum, offset);

      const students = db.prepare(query).all(...params);
      return res.json({
        students,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum)
        }
      });
    }

    const students = db.prepare(query).all(...params);
    res.json({ students });
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

// GET /api/students/:id - Get a single student by ID
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Also fetch the groups this student belongs to
    const groups = db.prepare(`
      SELECT g.id, g.name, g.description
      FROM groups_table g
      JOIN group_students gs ON g.id = gs.group_id
      WHERE gs.student_id = ?
    `).all(req.params.id);

    // Also fetch the student's classes
    const classes = db.prepare(`
      SELECT * FROM classes WHERE student_id = ? OR
        (group_id IN (SELECT group_id FROM group_students WHERE student_id = ?))
    `).all(req.params.id, req.params.id);

    res.json({ student, groups, classes });
  } catch (error) {
    console.error('Error fetching student:', error);
    res.status(500).json({ error: 'Failed to fetch student' });
  }
});

// POST /api/students - Create a new student
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const {
      name, parent_name, mobile_number,
      fee_online, fee_offline, fee_offline_group,
      status, notes
    } = req.body;

    // Validation
    if (!name || !parent_name || !mobile_number) {
      return res.status(400).json({ error: 'name, parent_name, and mobile_number are required' });
    }

    const result = db.prepare(`
      INSERT INTO students (name, parent_name, mobile_number, fee_online, fee_offline, fee_offline_group, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      parent_name,
      mobile_number,
      fee_online || 0,
      fee_offline || 0,
      fee_offline_group || 0,
      status || 'active',
      notes || ''
    );

    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(result.lastInsertRowid);
    syncStudentCreate(student);
    res.status(201).json({ student });
  } catch (error) {
    console.error('Error creating student:', error);
    res.status(500).json({ error: 'Failed to create student' });
  }
});

// PUT /api/students/:id - Update a student
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);

    if (!existing) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const {
      name, parent_name, mobile_number,
      fee_online, fee_offline, fee_offline_group,
      status, notes
    } = req.body;

    db.prepare(`
      UPDATE students SET
        name = ?, parent_name = ?, mobile_number = ?,
        fee_online = ?, fee_offline = ?, fee_offline_group = ?,
        status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name ?? existing.name,
      parent_name ?? existing.parent_name,
      mobile_number ?? existing.mobile_number,
      fee_online ?? existing.fee_online,
      fee_offline ?? existing.fee_offline,
      fee_offline_group ?? existing.fee_offline_group,
      status ?? existing.status,
      notes ?? existing.notes,
      req.params.id
    );

    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
    syncStudentUpdate(student);
    res.json({ student });
  } catch (error) {
    console.error('Error updating student:', error);
    res.status(500).json({ error: 'Failed to update student' });
  }
});

// DELETE /api/students/inactive - Hard-delete every inactive student.
// Cascading FKs handle attendance/class_students/group_students/additional_fees.
// classes.student_id and messages.student_id are SET NULL by FK definition.
router.delete('/inactive', (req, res) => {
  try {
    const db = getDb();
    const inactive = db.prepare("SELECT id FROM students WHERE status = 'inactive'").all();
    const stmt = db.prepare('DELETE FROM students WHERE id = ?');
    const tx = db.transaction(() => {
      for (const s of inactive) stmt.run(s.id);
    });
    tx();
    for (const s of inactive) syncStudentDelete(s.id);
    res.json({
      message: `Deleted ${inactive.length} inactive student(s)`,
      count: inactive.length,
    });
  } catch (error) {
    console.error('Error deleting inactive students:', error);
    res.status(500).json({ error: 'Failed to delete inactive students' });
  }
});

// DELETE /api/students/:id - Soft delete by default (status -> inactive).
// Pass ?force=true to permanently remove the row from the DB.
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);

    if (!existing) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const force = req.query.force === 'true' || req.query.force === '1';

    if (force) {
      db.prepare('DELETE FROM students WHERE id = ?').run(req.params.id);
      syncStudentDelete(req.params.id);
      return res.json({ message: 'Student permanently deleted' });
    }

    db.prepare(`
      UPDATE students SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(req.params.id);

    syncStudentDelete(req.params.id);
    res.json({ message: 'Student deactivated successfully' });
  } catch (error) {
    console.error('Error deleting student:', error);
    res.status(500).json({ error: 'Failed to delete student' });
  }
});

module.exports = router;
