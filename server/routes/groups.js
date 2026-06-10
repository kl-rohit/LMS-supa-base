const express = require('express');
const router = express.Router();
const { getDb } = require('../db/schema');
const { syncGroupCreate, syncGroupUpdate, syncGroupDelete, syncGroupMemberChange } = require('../services/zohoSync');

// GET /api/groups - Get all groups with member counts
router.get('/', (req, res) => {
  try {
    const db = getDb();

    const groups = db.prepare(`
      SELECT g.*,
        (SELECT COUNT(*) FROM group_students gs WHERE gs.group_id = g.id) as member_count
      FROM groups_table g
      ORDER BY g.name ASC
    `).all();

    // Fetch members for each group
    const groupsWithMembers = groups.map(group => {
      const members = db.prepare(`
        SELECT s.id, s.name, s.parent_name, s.mobile_number, s.status
        FROM students s
        JOIN group_students gs ON s.id = gs.student_id
        WHERE gs.group_id = ?
        ORDER BY s.name ASC
      `).all(group.id);
      return { ...group, members };
    });

    res.json({ groups: groupsWithMembers });
  } catch (error) {
    console.error('Error fetching groups:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// GET /api/groups/:id - Get a single group with its members
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const group = db.prepare('SELECT * FROM groups_table WHERE id = ?').get(req.params.id);

    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const members = db.prepare(`
      SELECT s.id, s.name, s.parent_name, s.mobile_number, s.fee_online, s.fee_offline, s.fee_offline_group, s.status
      FROM students s
      JOIN group_students gs ON s.id = gs.student_id
      WHERE gs.group_id = ?
      ORDER BY s.name ASC
    `).all(req.params.id);

    const classes = db.prepare(`
      SELECT * FROM classes WHERE group_id = ? ORDER BY day_of_week, start_time
    `).all(req.params.id);

    res.json({ group: { ...group, members, classes } });
  } catch (error) {
    console.error('Error fetching group:', error);
    res.status(500).json({ error: 'Failed to fetch group' });
  }
});

// GET /api/groups/:id/students - Get students in a group
router.get('/:id/students', (req, res) => {
  try {
    const db = getDb();
    const group = db.prepare('SELECT * FROM groups_table WHERE id = ?').get(req.params.id);

    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const students = db.prepare(`
      SELECT s.*
      FROM students s
      JOIN group_students gs ON s.id = gs.student_id
      WHERE gs.group_id = ?
      ORDER BY s.name ASC
    `).all(req.params.id);

    res.json({ students });
  } catch (error) {
    console.error('Error fetching group students:', error);
    res.status(500).json({ error: 'Failed to fetch group students' });
  }
});

// POST /api/groups - Create a new group
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    const existing = db.prepare('SELECT id FROM groups_table WHERE name = ?').get(name);
    if (existing) {
      return res.status(409).json({ error: 'A group with this name already exists' });
    }

    const result = db.prepare(`
      INSERT INTO groups_table (name, description) VALUES (?, ?)
    `).run(name, description || '');

    const group = db.prepare('SELECT * FROM groups_table WHERE id = ?').get(result.lastInsertRowid);
    syncGroupCreate(group);
    res.status(201).json({ group });
  } catch (error) {
    console.error('Error creating group:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// PUT /api/groups/:id - Update a group
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM groups_table WHERE id = ?').get(req.params.id);

    if (!existing) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const { name, description } = req.body;

    // Check for name conflict with another group
    if (name && name !== existing.name) {
      const conflict = db.prepare('SELECT id FROM groups_table WHERE name = ? AND id != ?').get(name, req.params.id);
      if (conflict) {
        return res.status(409).json({ error: 'A group with this name already exists' });
      }
    }

    db.prepare(`
      UPDATE groups_table SET name = ?, description = ? WHERE id = ?
    `).run(
      name ?? existing.name,
      description ?? existing.description,
      req.params.id
    );

    const group = db.prepare('SELECT * FROM groups_table WHERE id = ?').get(req.params.id);
    syncGroupUpdate(group);
    res.json({ group });
  } catch (error) {
    console.error('Error updating group:', error);
    res.status(500).json({ error: 'Failed to update group' });
  }
});

// DELETE /api/groups/:id - Delete a group
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM groups_table WHERE id = ?').get(req.params.id);

    if (!existing) {
      return res.status(404).json({ error: 'Group not found' });
    }

    // CASCADE will handle group_students cleanup
    db.prepare('DELETE FROM groups_table WHERE id = ?').run(req.params.id);
    syncGroupDelete(req.params.id);
    res.json({ message: 'Group deleted successfully' });
  } catch (error) {
    console.error('Error deleting group:', error);
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

// POST /api/groups/:id/students - Add a student to a group
router.post('/:id/students', (req, res) => {
  try {
    const db = getDb();
    const { student_id } = req.body;

    if (!student_id) {
      return res.status(400).json({ error: 'student_id is required' });
    }

    const group = db.prepare('SELECT * FROM groups_table WHERE id = ?').get(req.params.id);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(student_id);
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Check if already a member
    const alreadyMember = db.prepare(
      'SELECT id FROM group_students WHERE group_id = ? AND student_id = ?'
    ).get(req.params.id, student_id);

    if (alreadyMember) {
      return res.status(409).json({ error: 'Student is already a member of this group' });
    }

    db.prepare('INSERT INTO group_students (group_id, student_id) VALUES (?, ?)').run(req.params.id, student_id);
    syncGroupMemberChange(req.params.id);
    res.status(201).json({ message: 'Student added to group successfully' });
  } catch (error) {
    console.error('Error adding student to group:', error);
    res.status(500).json({ error: 'Failed to add student to group' });
  }
});

// DELETE /api/groups/:id/students/:studentId - Remove a student from a group
router.delete('/:id/students/:studentId', (req, res) => {
  try {
    const db = getDb();

    const membership = db.prepare(
      'SELECT id FROM group_students WHERE group_id = ? AND student_id = ?'
    ).get(req.params.id, req.params.studentId);

    if (!membership) {
      return res.status(404).json({ error: 'Student is not a member of this group' });
    }

    db.prepare('DELETE FROM group_students WHERE group_id = ? AND student_id = ?').run(
      req.params.id, req.params.studentId
    );

    syncGroupMemberChange(req.params.id);
    res.json({ message: 'Student removed from group successfully' });
  } catch (error) {
    console.error('Error removing student from group:', error);
    res.status(500).json({ error: 'Failed to remove student from group' });
  }
});

module.exports = router;
