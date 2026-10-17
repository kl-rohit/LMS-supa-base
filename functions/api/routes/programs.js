// /api/programs — plan one-off programs/events (recitals, kutcheris, workshops,
// competitions), pick participating students, and optionally bill them through
// the existing AdditionalFees pipeline. Org-scoped; all client ids via safeId().
// See docs/programs-module-spec.md.

const router = require('express').Router();
const { insert, getById, update, remove, zcql, zcqlAll, unwrap, normalize, q, safeId } = require('../db/catalystDb');

// Fee cap mirrors fees.js — guards a mistyped/garbage amount.
const MAX_FEE = 1000000;
const feeInRange = (n) => Number.isFinite(n) && n >= 0 && n <= MAX_FEE;
const VALID_TYPES = ['recital', 'workshop', 'competition', 'kutchery', 'other'];

// ---- list ----
router.get('/', async (req, res) => {
  try {
    const status = req.query.status;
    const where = [`Programs.org_id = ${Number(req.orgId)}`];
    if (status && status !== 'all') where.push(`Programs.status = ${q(status)}`);
    const rows = await zcqlAll(req, `SELECT * FROM Programs WHERE ${where.join(' AND ')} ORDER BY Programs.program_date DESC`, 'Programs');
    const programs = unwrap(rows, 'Programs').map(normalize);
    // attach participant counts
    for (const p of programs) {
      try {
        const c = await zcql(req, `SELECT COUNT(ROWID) AS c FROM ProgramStudents WHERE ProgramStudents.program_id = ${Number(p.id ?? p.ROWID)} AND ProgramStudents.org_id = ${Number(req.orgId)}`);
        const arr = unwrap(c, 'ProgramStudents'); p.participant_count = Number(arr[0]?.c) || 0;
      } catch { p.participant_count = 0; }
    }
    res.json({ programs });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch programs', detail: e.message }); }
});

// ---- create ----
router.post('/', async (req, res) => {
  try {
    const name = String(req.body.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    let type = String(req.body.type ?? 'other');
    if (!VALID_TYPES.includes(type)) type = 'other';
    const fee = Number(req.body.fee) || 0;
    if (!feeInRange(fee)) return res.status(400).json({ error: `Fee must be a number no larger than ${MAX_FEE.toLocaleString('en-IN')}.` });
    const row = await insert(req, 'Programs', {
      name, type,
      program_date: String(req.body.program_date ?? '').trim(),
      description: String(req.body.description ?? '').trim().slice(0, 2000),
      fee,
      status: 'planned',
      org_id: Number(req.orgId),
    });
    res.status(201).json({ program: normalize(row) });
  } catch (e) { res.status(500).json({ error: 'Failed to create program', detail: e.message }); }
});

// ---- detail (+ roster) ----
router.get('/:id', async (req, res) => {
  try {
    const id = safeId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const program = await getById(req, 'Programs', id);
    if (!program || Number(program.org_id) !== Number(req.orgId)) return res.status(404).json({ error: 'Program not found' });
    const rows = await zcqlAll(req, `SELECT * FROM ProgramStudents WHERE ProgramStudents.program_id = ${id} AND ProgramStudents.org_id = ${Number(req.orgId)}`, 'ProgramStudents');
    const roster = unwrap(rows, 'ProgramStudents').map(normalize);
    res.json({ program: normalize(program), roster });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch program', detail: e.message }); }
});

// ---- edit ----
router.put('/:id', async (req, res) => {
  try {
    const id = safeId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const existing = await getById(req, 'Programs', id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) return res.status(404).json({ error: 'Program not found' });
    const patch = {};
    if (req.body.name !== undefined) patch.name = String(req.body.name).trim();
    if (req.body.type !== undefined) patch.type = VALID_TYPES.includes(req.body.type) ? req.body.type : 'other';
    if (req.body.program_date !== undefined) patch.program_date = String(req.body.program_date).trim();
    if (req.body.description !== undefined) patch.description = String(req.body.description).slice(0, 2000);
    if (req.body.status !== undefined) patch.status = String(req.body.status).slice(0, 20);
    if (req.body.fee !== undefined) {
      const fee = Number(req.body.fee);
      if (!feeInRange(fee)) return res.status(400).json({ error: `Fee must be a number no larger than ${MAX_FEE.toLocaleString('en-IN')}.` });
      patch.fee = fee;
    }
    const updated = await update(req, 'Programs', id, patch);
    res.json({ program: normalize(updated) });
  } catch (e) { res.status(500).json({ error: 'Failed to update program', detail: e.message }); }
});

// ---- soft delete (cancel) ----
router.delete('/:id', async (req, res) => {
  try {
    const id = safeId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const existing = await getById(req, 'Programs', id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) return res.status(404).json({ error: 'Program not found' });
    await update(req, 'Programs', id, { status: 'cancelled' });
    res.json({ message: 'Program cancelled' });
  } catch (e) { res.status(500).json({ error: 'Failed to cancel program', detail: e.message }); }
});

// ---- enroll participants ----
router.post('/:id/students', async (req, res) => {
  try {
    const id = safeId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const program = await getById(req, 'Programs', id);
    if (!program || Number(program.org_id) !== Number(req.orgId)) return res.status(404).json({ error: 'Program not found' });
    const ids = Array.isArray(req.body.student_ids) ? req.body.student_ids : [];
    if (!ids.length) return res.status(400).json({ error: 'student_ids[] required' });
    // existing roster to avoid duplicates
    const existRows = await zcqlAll(req, `SELECT student_id FROM ProgramStudents WHERE ProgramStudents.program_id = ${id} AND ProgramStudents.org_id = ${Number(req.orgId)}`, 'ProgramStudents');
    const already = new Set(unwrap(existRows, 'ProgramStudents').map((r) => String(r.student_id)));
    let added = 0;
    for (const sid of ids) {
      const s = safeId(sid);
      if (!s || already.has(String(s))) continue;
      const stu = await getById(req, 'Students', s);
      if (!stu || Number(stu.org_id) !== Number(req.orgId)) continue; // not this org
      await insert(req, 'ProgramStudents', { program_id: Number(id), student_id: Number(s), billed: 0, org_id: Number(req.orgId) });
      added++;
    }
    res.json({ message: `Added ${added} participant(s)`, added });
  } catch (e) { res.status(500).json({ error: 'Failed to enroll', detail: e.message }); }
});

// ---- remove a participant ----
router.delete('/:id/students/:studentId', async (req, res) => {
  try {
    const id = safeId(req.params.id), sid = safeId(req.params.studentId);
    if (!id || !sid) return res.status(400).json({ error: 'Invalid id' });
    const program = await getById(req, 'Programs', id);
    if (!program || Number(program.org_id) !== Number(req.orgId)) return res.status(404).json({ error: 'Program not found' });
    const links = await zcql(req, `SELECT ROWID FROM ProgramStudents WHERE ProgramStudents.program_id = ${id} AND ProgramStudents.student_id = ${sid} AND ProgramStudents.org_id = ${Number(req.orgId)}`);
    for (const l of unwrap(links, 'ProgramStudents')) { try { await remove(req, 'ProgramStudents', l.ROWID); } catch {} }
    res.json({ message: 'Removed' });
  } catch (e) { res.status(500).json({ error: 'Failed to remove participant', detail: e.message }); }
});

// ---- set a participant's itinerary note (parent-visible) ----
router.put('/:id/students/:studentId', async (req, res) => {
  try {
    const id = safeId(req.params.id), sid = safeId(req.params.studentId);
    if (!id || !sid) return res.status(400).json({ error: 'Invalid id' });
    const program = await getById(req, 'Programs', id);
    if (!program || Number(program.org_id) !== Number(req.orgId)) return res.status(404).json({ error: 'Program not found' });
    const notes = String(req.body.notes ?? '').slice(0, 2000);
    const links = await zcql(req, `SELECT ROWID FROM ProgramStudents WHERE ProgramStudents.program_id = ${id} AND ProgramStudents.student_id = ${sid} AND ProgramStudents.org_id = ${Number(req.orgId)}`);
    const rows = unwrap(links, 'ProgramStudents');
    if (!rows.length) return res.status(404).json({ error: 'Participant not found' });
    for (const l of rows) { try { await update(req, 'ProgramStudents', l.ROWID, { notes }); } catch {} }
    res.json({ message: 'Note saved', notes });
  } catch (e) { res.status(500).json({ error: 'Failed to save note', detail: e.message }); }
});

// ---- bill participants: create an AdditionalFees row per enrolled, unbilled
// student, then mark them billed. Flows into fee collection + reminders. ----
router.post('/:id/bill', async (req, res) => {
  try {
    const id = safeId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const program = await getById(req, 'Programs', id);
    if (!program || Number(program.org_id) !== Number(req.orgId)) return res.status(404).json({ error: 'Program not found' });
    const fee = Number(program.fee) || 0;
    if (!feeInRange(fee) || fee <= 0) return res.status(400).json({ error: 'Set a program fee greater than 0 before billing.' });
    const date = String(program.program_date || new Date().toISOString().slice(0, 10));
    const month = parseInt(date.slice(5, 7), 10) || (new Date().getMonth() + 1);
    const year = parseInt(date.slice(0, 4), 10) || new Date().getFullYear();
    const only = Array.isArray(req.body.student_ids) ? new Set(req.body.student_ids.map(String)) : null;

    const rows = await zcqlAll(req, `SELECT ROWID, student_id, billed FROM ProgramStudents WHERE ProgramStudents.program_id = ${id} AND ProgramStudents.org_id = ${Number(req.orgId)}`, 'ProgramStudents');
    let billed = 0;
    for (const r of unwrap(rows, 'ProgramStudents')) {
      if (Number(r.billed) === 1) continue;                       // idempotent
      if (only && !only.has(String(r.student_id))) continue;
      try {
        await insert(req, 'AdditionalFees', {
          student_id: Number(r.student_id),
          description: `Program: ${program.name}`,
          amount: fee, fee_date: date, fee_month: month, fee_year: year,
          org_id: Number(req.orgId),
        });
        await update(req, 'ProgramStudents', r.ROWID, { billed: 1 });
        billed++;
      } catch {}
    }
    res.json({ message: `Billed ${billed} participant(s) ₹${fee.toLocaleString('en-IN')} each`, billed });
  } catch (e) { res.status(500).json({ error: 'Failed to bill participants', detail: e.message }); }
});

module.exports = router;
