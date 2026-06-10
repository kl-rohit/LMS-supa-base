// /api/groups — CRUD against "Groups" + member management via "GroupStudents".

const router = require('express').Router();
const { insert, getById, getAll, update, remove, zcql, unwrap, normalize } = require('../db/catalystDb');

// Helper: fetch member students for a group
async function fetchMembers(req, groupId) {
  try {
    const links = await zcql(req, `SELECT GroupStudents.student_id FROM GroupStudents WHERE GroupStudents.group_id = ${groupId}`);
    const studentIds = unwrap(links, 'GroupStudents').map((l) => l.student_id).filter(Boolean);
    if (!studentIds.length) return [];
    const rows = await zcql(req, `SELECT * FROM Students WHERE ROWID IN (${studentIds.join(',')}) ORDER BY Students.name ASC`);
    return unwrap(rows, 'Students').map(normalize);
  } catch {
    return [];
  }
}

// GET /api/groups
router.get('/', async (req, res) => {
  try {
    const rows = await getAll(req, 'Groups');
    rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    // Attach member_count for each
    const withCounts = await Promise.all(rows.map(async (g) => {
      const members = await fetchMembers(req, g.ROWID);
      return { ...normalize(g), member_count: members.length, members };
    }));
    res.json({ groups: withCounts });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch groups', detail: e.message });
  }
});

// GET /api/groups/:id
router.get('/:id', async (req, res) => {
  try {
    const group = await getById(req, 'Groups', req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const students = await fetchMembers(req, req.params.id);
    res.json({ group: normalize(group), students });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch group', detail: e.message });
  }
});

// GET /api/groups/:id/students
router.get('/:id/students', async (req, res) => {
  try {
    const students = await fetchMembers(req, req.params.id);
    res.json({ students });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch group members', detail: e.message });
  }
});

// POST /api/groups
router.post('/', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const group = await insert(req, 'Groups', { name, description: description || '' });
    res.status(201).json({ group: normalize(group) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create group', detail: e.message });
  }
});

// POST /api/groups/:id/students   body: { student_ids: [...] } OR { student_id: X }
router.post('/:id/students', async (req, res) => {
  try {
    const { student_ids, student_id } = req.body;
    const ids = Array.isArray(student_ids) && student_ids.length
      ? student_ids
      : student_id ? [student_id] : [];
    if (!ids.length) {
      return res.status(400).json({ error: 'student_ids[] or student_id is required' });
    }
    const group = await getById(req, 'Groups', req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    let added = 0;
    for (const sid of ids) {
      try {
        await insert(req, 'GroupStudents', { group_id: req.params.id, student_id: String(sid) });
        added++;
      } catch (err) { console.error('group member add failed', err.message); }
    }
    res.json({ added });
  } catch (e) {
    res.status(500).json({ error: 'Failed to add group members', detail: e.message });
  }
});

// PUT /api/groups/:id  — accepts { name, description, status }
// status flips between 'active' and 'inactive' (soft activation/deactivation).
router.put('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Groups', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Group not found' });
    const { name, description, status } = req.body;
    const patch = {};
    if (name !== undefined) patch.name = name;
    if (description !== undefined) patch.description = description;
    if (status !== undefined) patch.status = status;
    const updated = await update(req, 'Groups', req.params.id, patch);
    res.json({ group: normalize(updated) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update group', detail: e.message });
  }
});

// DELETE /api/groups/:id  — soft-delete by default (status='inactive').
// Use ?force=true to permanently delete the row + its M2M links.
router.delete('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Groups', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Group not found' });
    const force = req.query.force === 'true' || req.query.force === '1';
    if (!force) {
      // Soft delete — keep the row + members intact, just mark inactive.
      await update(req, 'Groups', req.params.id, { status: 'inactive' });
      return res.json({ message: 'Group deactivated' });
    }
    // Hard delete — remove M2M links first, then the group itself.
    try {
      const links = await zcql(req, `SELECT ROWID FROM GroupStudents WHERE GroupStudents.group_id = ${req.params.id}`);
      for (const l of unwrap(links, 'GroupStudents')) {
        try { await remove(req, 'GroupStudents', l.ROWID); } catch {}
      }
    } catch {}
    await remove(req, 'Groups', req.params.id);
    res.json({ message: 'Group permanently deleted' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete group', detail: e.message });
  }
});

// DELETE /api/groups/:id/students/:studentId  — remove a single member
router.delete('/:id/students/:studentId', async (req, res) => {
  try {
    const links = await zcql(req, `SELECT ROWID FROM GroupStudents WHERE GroupStudents.group_id = ${req.params.id} AND GroupStudents.student_id = ${req.params.studentId}`);
    const rowsToDel = unwrap(links, 'GroupStudents');
    for (const l of rowsToDel) {
      try { await remove(req, 'GroupStudents', l.ROWID); } catch {}
    }
    res.json({ message: `Removed ${rowsToDel.length} link(s)` });
  } catch (e) {
    res.status(500).json({ error: 'Failed to remove member', detail: e.message });
  }
});

module.exports = router;
