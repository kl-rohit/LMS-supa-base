const express = require('express');
const router = express.Router();
const { getDb } = require('../db/schema');
const { syncClassCreate, syncClassUpdate, syncClassDelete } = require('../services/zohoSync');

// Helper: attach student_ids and student_names (from class_students) to a class row
function attachClassStudents(db, cls) {
  const rows = db.prepare(`
    SELECT s.id, s.name
    FROM class_students cs
    JOIN students s ON s.id = cs.student_id
    WHERE cs.class_id = ?
    ORDER BY s.name ASC
  `).all(cls.id);
  cls.student_ids = rows.map((r) => r.id);
  cls.student_names = rows.map((r) => r.name);
  // Override single student_name with combined display when multiple students
  if (rows.length > 1) {
    cls.student_name = rows.map((r) => r.name).join(', ');
  } else if (rows.length === 1) {
    cls.student_name = rows[0].name;
  }
  return cls;
}

// GET /api/classes/today - Get today's classes based on day_of_week
router.get('/today', (req, res) => {
  try {
    const db = getDb();
    const today = new Date().getDay(); // 0 = Sunday, 6 = Saturday

    const classes = db.prepare(`
      SELECT c.*,
        s.name as student_name,
        g.name as group_name
      FROM classes c
      LEFT JOIN students s ON c.student_id = s.id
      LEFT JOIN groups_table g ON c.group_id = g.id
      WHERE c.day_of_week = ? AND c.is_active = 1
      ORDER BY c.start_time ASC
    `).all(today);

    // For group classes, also fetch the group members; for individual classes,
    // attach the linked students from class_students.
    const classesWithDetails = classes.map(cls => {
      if (cls.group_id) {
        const members = db.prepare(`
          SELECT s.id, s.name, s.status
          FROM students s
          JOIN group_students gs ON s.id = gs.student_id
          WHERE gs.group_id = ?
          ORDER BY s.name ASC
        `).all(cls.group_id);
        return { ...cls, group_members: members };
      }
      return attachClassStudents(db, { ...cls });
    });

    res.json({ classes: classesWithDetails, day_of_week: today });
  } catch (error) {
    console.error('Error fetching today\'s classes:', error);
    res.status(500).json({ error: 'Failed to fetch today\'s classes' });
  }
});

// GET /api/classes - Get all classes with optional filters
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const { day_of_week, group_id, student_id, is_active, class_type } = req.query;

    let query = `
      SELECT c.*,
        s.name as student_name,
        g.name as group_name
      FROM classes c
      LEFT JOIN students s ON c.student_id = s.id
      LEFT JOIN groups_table g ON c.group_id = g.id
      WHERE 1=1
    `;
    const params = [];

    if (day_of_week !== undefined) {
      query += ' AND c.day_of_week = ?';
      params.push(parseInt(day_of_week));
    }

    if (group_id) {
      query += ' AND c.group_id = ?';
      params.push(parseInt(group_id));
    }

    if (student_id) {
      query += ' AND c.student_id = ?';
      params.push(parseInt(student_id));
    }

    if (is_active !== undefined) {
      query += ' AND c.is_active = ?';
      params.push(parseInt(is_active));
    }

    if (class_type) {
      query += ' AND c.class_type = ?';
      params.push(class_type);
    }

    query += ' ORDER BY c.day_of_week, c.start_time ASC';

    const classes = db.prepare(query).all(...params).map((c) => {
      if (c.group_id) return c;
      return attachClassStudents(db, { ...c });
    });
    res.json({ classes });
  } catch (error) {
    console.error('Error fetching classes:', error);
    res.status(500).json({ error: 'Failed to fetch classes' });
  }
});

// GET /api/classes/:id - Get a single class by ID
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const cls = db.prepare(`
      SELECT c.*,
        s.name as student_name, s.parent_name, s.mobile_number,
        g.name as group_name
      FROM classes c
      LEFT JOIN students s ON c.student_id = s.id
      LEFT JOIN groups_table g ON c.group_id = g.id
      WHERE c.id = ?
    `).get(req.params.id);

    if (!cls) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // If group class, fetch group members
    if (cls.group_id) {
      const members = db.prepare(`
        SELECT s.id, s.name, s.parent_name, s.mobile_number, s.status
        FROM students s
        JOIN group_students gs ON s.id = gs.student_id
        WHERE gs.group_id = ?
        ORDER BY s.name ASC
      `).all(cls.group_id);
      cls.group_members = members;
    } else {
      attachClassStudents(db, cls);
    }

    res.json({ class: cls });
  } catch (error) {
    console.error('Error fetching class:', error);
    res.status(500).json({ error: 'Failed to fetch class' });
  }
});

// POST /api/classes - Create a new class (supports student_ids[] for bulk creation)
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const {
      name, group_id, student_id, student_ids, class_type,
      day_of_week, start_time, end_time, duration_hours, is_active
    } = req.body;

    // Validation
    if (!name || class_type === undefined || day_of_week === undefined || !start_time || !end_time) {
      return res.status(400).json({
        error: 'name, class_type, day_of_week, start_time, and end_time are required'
      });
    }

    if (!['online', 'offline', 'offline_group', 'online_group'].includes(class_type)) {
      return res.status(400).json({ error: 'class_type must be online, offline, offline_group, or online_group' });
    }

    if (day_of_week < 0 || day_of_week > 6) {
      return res.status(400).json({ error: 'day_of_week must be between 0 (Sunday) and 6 (Saturday)' });
    }

    // For group classes, group_id is required
    if ((class_type === 'offline_group' || class_type === 'online_group') && !group_id) {
      return res.status(400).json({ error: 'group_id is required for group class types' });
    }

    // For individual classes, support student_ids[] array or single student_id
    const individualIds = student_ids && Array.isArray(student_ids) ? student_ids : student_id ? [student_id] : [];

    if ((class_type === 'online' || class_type === 'offline') && individualIds.length === 0) {
      return res.status(400).json({ error: 'student_id or student_ids[] is required for online/offline class type' });
    }

    // Auto-calculate duration_hours from start_time and end_time if not provided
    let calcDuration = duration_hours;
    if (!calcDuration && start_time && end_time) {
      const [sh, sm] = start_time.split(':').map(Number);
      const [eh, em] = end_time.split(':').map(Number);
      const diffMinutes = (eh * 60 + em) - (sh * 60 + sm);
      calcDuration = diffMinutes > 0 ? diffMinutes / 60 : 1;
    }

    const insertStmt = db.prepare(`
      INSERT INTO classes (name, group_id, student_id, class_type, day_of_week, start_time, end_time, duration_hours, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const linkStudent = db.prepare(
      'INSERT OR IGNORE INTO class_students (class_id, student_id) VALUES (?, ?)'
    );

    // Group classes: single insert
    if (class_type === 'offline_group' || class_type === 'online_group') {
      const result = insertStmt.run(
        name, group_id || null, null, class_type,
        day_of_week, start_time, end_time, calcDuration || 1,
        is_active !== undefined ? is_active : 1
      );
      const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(result.lastInsertRowid);
      syncClassCreate(cls);
      return res.status(201).json({ class: cls });
    }

    // Individual classes: create ONE class linked to all selected students.
    // The legacy classes.student_id column is set to the first student for
    // backward compatibility; full set lives in class_students.
    let createdClass;
    const tx = db.transaction(() => {
      const result = insertStmt.run(
        name, null, individualIds[0], class_type,
        day_of_week, start_time, end_time, calcDuration || 1,
        is_active !== undefined ? is_active : 1
      );
      const classId = result.lastInsertRowid;
      for (const sid of individualIds) linkStudent.run(classId, sid);
      createdClass = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
      attachClassStudents(db, createdClass);
    });
    tx();

    syncClassCreate(createdClass);
    res.status(201).json({
      class: createdClass,
      message: individualIds.length > 1
        ? `Created class with ${individualIds.length} students`
        : undefined,
    });
  } catch (error) {
    console.error('Error creating class:', error);
    res.status(500).json({ error: 'Failed to create class' });
  }
});

// PUT /api/classes/:id - Update a class
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM classes WHERE id = ?').get(req.params.id);

    if (!existing) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const {
      name, group_id, student_id, student_ids, class_type,
      day_of_week, start_time, end_time, duration_hours, is_active
    } = req.body;

    const newClassType = class_type ?? existing.class_type;
    if (!['online', 'offline', 'offline_group', 'online_group'].includes(newClassType)) {
      return res.status(400).json({ error: 'class_type must be online, offline, offline_group, or online_group' });
    }

    // Auto-calculate duration_hours from start_time and end_time
    const finalStartTime = start_time ?? existing.start_time;
    const finalEndTime = end_time ?? existing.end_time;
    let calcDuration = duration_hours;
    if (calcDuration === undefined && finalStartTime && finalEndTime) {
      const [sh, sm] = finalStartTime.split(':').map(Number);
      const [eh, em] = finalEndTime.split(':').map(Number);
      const diffMinutes = (eh * 60 + em) - (sh * 60 + sm);
      calcDuration = diffMinutes > 0 ? diffMinutes / 60 : existing.duration_hours;
    }

    // Resolve final student set for class_students sync (individual types only)
    const isIndividual = newClassType === 'online' || newClassType === 'offline';
    let finalStudentIds = null;
    if (isIndividual) {
      if (Array.isArray(student_ids) && student_ids.length > 0) {
        finalStudentIds = student_ids.map((n) => Number(n)).filter(Boolean);
      } else if (student_id !== undefined && student_id !== null) {
        finalStudentIds = [Number(student_id)];
      }
    }

    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE classes SET
          name = ?, group_id = ?, student_id = ?, class_type = ?,
          day_of_week = ?, start_time = ?, end_time = ?, duration_hours = ?, is_active = ?
        WHERE id = ?
      `).run(
        name ?? existing.name,
        isIndividual ? null : (group_id !== undefined ? group_id : existing.group_id),
        isIndividual
          ? (finalStudentIds && finalStudentIds.length > 0 ? finalStudentIds[0] : existing.student_id)
          : null,
        newClassType,
        day_of_week ?? existing.day_of_week,
        finalStartTime,
        finalEndTime,
        calcDuration ?? existing.duration_hours,
        is_active !== undefined ? is_active : existing.is_active,
        req.params.id
      );

      if (isIndividual && finalStudentIds) {
        // Replace student links
        db.prepare('DELETE FROM class_students WHERE class_id = ?').run(req.params.id);
        const link = db.prepare(
          'INSERT OR IGNORE INTO class_students (class_id, student_id) VALUES (?, ?)'
        );
        for (const sid of finalStudentIds) link.run(req.params.id, sid);
      } else if (!isIndividual) {
        // Group class: clear any stale individual links
        db.prepare('DELETE FROM class_students WHERE class_id = ?').run(req.params.id);
      }
    });
    tx();

    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(req.params.id);
    if (cls && !cls.group_id) attachClassStudents(db, cls);
    syncClassUpdate(cls);
    res.json({ class: cls });
  } catch (error) {
    console.error('Error updating class:', error);
    res.status(500).json({ error: 'Failed to update class' });
  }
});

// DELETE /api/classes/:id - Delete a class
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM classes WHERE id = ?').get(req.params.id);

    if (!existing) {
      return res.status(404).json({ error: 'Class not found' });
    }

    db.prepare('DELETE FROM classes WHERE id = ?').run(req.params.id);
    syncClassDelete(req.params.id);
    res.json({ message: 'Class deleted successfully' });
  } catch (error) {
    console.error('Error deleting class:', error);
    res.status(500).json({ error: 'Failed to delete class' });
  }
});

module.exports = router;
