// /api/groups — CRUD against "Groups" + member management via "GroupStudents".
// All queries are scoped to req.orgId set by middleware/org.resolveOrg.

const router = require('express').Router();
const { insert, getById, update, remove, zcql, zcqlAll, unwrap, normalize, q } = require('../db/catalystDb');
const { overCapBlock } = require('../lib/studentLimit');

// Group names are unique per org (case-insensitive). Returns true if another
// group in this org already uses `name` (optionally excluding one id, for edits).
async function groupNameTaken(req, name, excludeId) {
  try {
    const rows = await zcql(req, `SELECT * FROM Groups WHERE LOWER(Groups.name) = LOWER(${q(String(name).trim())}) AND Groups.org_id = ${Number(req.orgId)}`);
    return unwrap(rows, 'Groups').map(normalize).some((g) => String(g.id) !== String(excludeId || ''));
  } catch {
    return false; // never block creation on a lookup failure
  }
}

// Helper: fetch member students for a group (org-scoped on both ends).
async function fetchMembers(req, groupId) {
  try {
    const links = await zcql(req, `SELECT GroupStudents.student_id FROM GroupStudents WHERE GroupStudents.group_id = ${groupId} AND GroupStudents.org_id = ${Number(req.orgId)}`);
    const studentIds = unwrap(links, 'GroupStudents').map((l) => l.student_id).filter(Boolean);
    if (!studentIds.length) return [];
    const rows = await zcql(req, `SELECT * FROM Students WHERE ROWID IN (${studentIds.join(',')}) AND Students.org_id = ${Number(req.orgId)} ORDER BY Students.name ASC`);
    return unwrap(rows, 'Students').map(normalize);
  } catch {
    return [];
  }
}

// GET /api/groups
router.get('/', async (req, res) => {
  try {
    // Pull groups, all member links, and all students for the org ONCE, then
    // assemble each group's roster in memory. The old per-group fetchMembers
    // fan-out fired 2 reads per group (links + students); this caps the whole
    // list at three org-scoped SELECTs regardless of group count.
    const [groupRows, linkRows, studentRows] = await Promise.all([
      zcql(req, `SELECT * FROM Groups WHERE Groups.org_id = ${Number(req.orgId)} ORDER BY Groups.name ASC`),
      zcqlAll(req, `SELECT group_id, student_id FROM GroupStudents WHERE GroupStudents.org_id = ${Number(req.orgId)}`, 'GroupStudents').catch(() => []),
      zcqlAll(req, `SELECT * FROM Students WHERE Students.org_id = ${Number(req.orgId)}`, 'Students').catch(() => []),
    ]);
    const groups = unwrap(groupRows, 'Groups');
    const studentById = new Map(unwrap(studentRows, 'Students').map((s) => [String(s.ROWID), normalize(s)]));
    const memberIdsByGroup = new Map();
    for (const l of unwrap(linkRows, 'GroupStudents')) {
      if (!l.student_id) continue;
      const k = String(l.group_id);
      if (!memberIdsByGroup.has(k)) memberIdsByGroup.set(k, []);
      memberIdsByGroup.get(k).push(String(l.student_id));
    }
    const withCounts = groups.map((g) => {
      const members = (memberIdsByGroup.get(String(g.ROWID)) || [])
        .map((sid) => studentById.get(sid))
        .filter(Boolean)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
      return { ...normalize(g), member_count: members.length, members };
    });
    res.json({ groups: withCounts });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch groups', detail: e.message });
  }
});

// GET /api/groups/:id
router.get('/:id', async (req, res) => {
  try {
    const group = await getById(req, 'Groups', req.params.id);
    if (!group || Number(group.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Group not found' });
    }
    const students = await fetchMembers(req, req.params.id);
    res.json({ group: normalize(group), students });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch group', detail: e.message });
  }
});

// GET /api/groups/:id/students
router.get('/:id/students', async (req, res) => {
  try {
    const group = await getById(req, 'Groups', req.params.id);
    if (!group || Number(group.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Group not found' });
    }
    const students = await fetchMembers(req, req.params.id);
    res.json({ students });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch group members', detail: e.message });
  }
});

// POST /api/groups
router.post('/', async (req, res) => {
  try {
    const { description } = req.body;
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name_required', field: 'name', message: 'Please enter a group name.' });
    if (await groupNameTaken(req, name)) {
      return res.status(409).json({ error: 'duplicate_group', field: 'name', message: `A group named "${name}" already exists. Please pick a different name.` });
    }
    // Group creation stays available only while the org is within its approved
    // seat count. Over the limit, reduce active students or upgrade first.
    const capped = await overCapBlock(req);
    if (capped) return res.status(402).json(capped);
    const group = await insert(req, 'Groups', {
      name,
      description: description || '',
      org_id: Number(req.orgId),
    });
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
    if (!group || Number(group.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Group not found' });
    }
    let added = 0;
    for (const sid of ids) {
      try {
        // Verify the student also belongs to this org before linking.
        const s = await getById(req, 'Students', String(sid));
        if (!s || Number(s.org_id) !== Number(req.orgId)) continue;
        await insert(req, 'GroupStudents', {
          group_id: req.params.id,
          student_id: String(sid),
          org_id: Number(req.orgId),
        });
        added++;
      } catch (err) { console.error('group member add failed', err.message); }
    }
    res.json({ added });
  } catch (e) {
    res.status(500).json({ error: 'Failed to add group members', detail: e.message });
  }
});

// PUT /api/groups/:id  — accepts { name, description, status }
router.put('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Groups', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Group not found' });
    }
    const { name, description, status } = req.body;
    const patch = {};
    if (name !== undefined) {
      const nm = String(name || '').trim();
      if (!nm) return res.status(400).json({ error: 'name_required', field: 'name', message: 'Please enter a group name.' });
      if (await groupNameTaken(req, nm, req.params.id)) {
        return res.status(409).json({ error: 'duplicate_group', field: 'name', message: `A group named "${nm}" already exists. Please pick a different name.` });
      }
      patch.name = nm;
    }
    if (description !== undefined) patch.description = description;
    if (status !== undefined) patch.status = status;
    const updated = await update(req, 'Groups', req.params.id, patch);
    res.json({ group: normalize(updated) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update group', detail: e.message });
  }
});

// DELETE /api/groups/:id  — soft delete (status='inactive') or ?force=true hard delete
router.delete('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Groups', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Group not found' });
    }
    const force = req.query.force === 'true' || req.query.force === '1';
    if (!force) {
      await update(req, 'Groups', req.params.id, { status: 'inactive' });
      return res.json({ message: 'Group deactivated' });
    }
    try {
      const links = await zcql(req, `SELECT ROWID FROM GroupStudents WHERE GroupStudents.group_id = ${req.params.id} AND GroupStudents.org_id = ${Number(req.orgId)}`);
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
    const group = await getById(req, 'Groups', req.params.id);
    if (!group || Number(group.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Group not found' });
    }
    const links = await zcql(req, `SELECT ROWID FROM GroupStudents WHERE GroupStudents.group_id = ${req.params.id} AND GroupStudents.student_id = ${req.params.studentId} AND GroupStudents.org_id = ${Number(req.orgId)}`);
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
