// /api/classes — CRUD against "Classes" + multi-student via "ClassStudents".
// Org-scoped via middleware/org.resolveOrg (req.orgId).

const router = require('express').Router();
const { insert, getById, update, remove, zcql, zcqlAll, unwrap, normalize, safeId } = require('../db/catalystDb');
const { createNotifications } = require('../lib/notify');
const { substituteTemplate } = require('../lib/feeReminder');
const { loadTemplates, loadAppSettings } = require('./settings');

// Fallback body if the org hasn't customised the online_meeting template
// (kept identical to settings.DEFAULT_TEMPLATES.online_meeting).
const ONLINE_MEETING_DEFAULT =
  `Dear {parent},\n\nThe online class "{class_name}" for {name} is ready to join {time}.\n\nJoin link: {link}\n\nRegards,\n{signature}`;

// 24h "HH:MM" → "H:MM AM/PM" for the {time} placeholder.
function fmtTime(t) {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  let h = parseInt(m[1], 10);
  const ap = h < 12 ? 'AM' : 'PM';
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
}

// Every student in a class: direct (student_id), group members, and roster
// links. Mirrors the digest's classRoster, org-scoped.
async function resolveRoster(req, cls) {
  const ids = new Set();
  if (cls.student_id) ids.add(String(cls.student_id));
  if (cls.group_id) {
    try {
      const rows = await zcqlAll(req, `SELECT student_id FROM GroupStudents WHERE GroupStudents.group_id = ${Number(cls.group_id)} AND GroupStudents.org_id = ${Number(req.orgId)}`, 'GroupStudents');
      for (const r of unwrap(rows, 'GroupStudents')) if (r.student_id) ids.add(String(r.student_id));
    } catch { /* ignore */ }
  }
  try {
    const rows = await zcqlAll(req, `SELECT student_id FROM ClassStudents WHERE ClassStudents.class_id = ${Number(cls.ROWID)} AND ClassStudents.org_id = ${Number(req.orgId)}`, 'ClassStudents');
    for (const r of unwrap(rows, 'ClassStudents')) if (r.student_id) ids.add(String(r.student_id));
  } catch { /* ignore */ }
  return [...ids];
}

const VALID_TYPES = ['online', 'offline', 'offline_group', 'online_group'];
const VALID_EXCEPTION_STATUS = ['cancelled', 'moved'];
const isGroupType = (t) => t === 'offline_group' || t === 'online_group';
const isOnlineType = (t) => t === 'online' || t === 'online_group';

// Online classes carry an optional meeting link (Google Meet / Zoom / Zoho
// Meet). We store whatever the academy pastes; only online types keep it.
// Length-capped so a bad paste can't blow past the Classes.meeting_link
// (Text) column. Offline types always clear it.
function cleanMeetingLink(raw) {
  if (raw === undefined || raw === null) return undefined; // caller decides default
  const s = String(raw).trim();
  return s ? s.slice(0, 500) : '';
}

// Schedule exceptions are stored as a JSON array in the Classes.exceptions
// (Multi-line Text) column — one entry per overridden date, keyed by `date`:
//   { date, status:'cancelled'|'moved', new_date, new_start_time, new_end_time, note }
// This keeps reschedule/cancel data on the class itself (no separate table),
// which suits a single-teacher tuition workload where exceptions are sparse.
function parseExceptions(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function calcDuration(start, end) {
  if (!start || !end) return 1;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const diff = (eh * 60 + em) - (sh * 60 + sm);
  return diff > 0 ? diff / 60 : 1;
}

async function fetchClassStudents(req, classId) {
  try {
    const links = await zcql(req, `SELECT ClassStudents.student_id FROM ClassStudents WHERE ClassStudents.class_id = ${classId} AND ClassStudents.org_id = ${Number(req.orgId)}`);
    return unwrap(links, 'ClassStudents').map((l) => l.student_id).filter(Boolean);
  } catch {
    return [];
  }
}

async function decorate(req, cls) {
  const out = { ...normalize(cls) };
  if (cls.student_id) {
    try {
      const s = await getById(req, 'Students', cls.student_id);
      if (s && Number(s.org_id) === Number(req.orgId)) out.student_name = s.name;
    } catch {}
  }
  if (cls.group_id) {
    try {
      const g = await getById(req, 'Groups', cls.group_id);
      if (g && Number(g.org_id) === Number(req.orgId)) out.group_name = g.name;
    } catch {}
  }
  out.student_ids = await fetchClassStudents(req, cls.ROWID);
  out.exceptions = parseExceptions(cls.exceptions);
  return out;
}

// Batched decoration for a list of classes. The single-row decorate() fires
// three reads per class (Students + Groups + ClassStudents links). Here we
// pull each of those tables ONCE for the org and resolve in memory, turning
// 3N reads into three org-scoped SELECTs regardless of class count.
async function decorateList(req, list) {
  if (!list.length) return [];
  const [studentRows, groupRows, linkRows] = await Promise.all([
    zcqlAll(req, `SELECT ROWID, name FROM Students WHERE Students.org_id = ${Number(req.orgId)}`, 'Students').catch(() => []),
    zcqlAll(req, `SELECT ROWID, name FROM Groups WHERE Groups.org_id = ${Number(req.orgId)}`, 'Groups').catch(() => []),
    zcqlAll(req, `SELECT class_id, student_id FROM ClassStudents WHERE ClassStudents.org_id = ${Number(req.orgId)}`, 'ClassStudents').catch(() => []),
  ]);
  const studentName = new Map(unwrap(studentRows, 'Students').map((s) => [String(s.ROWID), s.name]));
  const groupName   = new Map(unwrap(groupRows, 'Groups').map((g) => [String(g.ROWID), g.name]));
  const studentIdsByClass = new Map();
  for (const l of unwrap(linkRows, 'ClassStudents')) {
    if (!l.student_id) continue;
    const k = String(l.class_id);
    if (!studentIdsByClass.has(k)) studentIdsByClass.set(k, []);
    studentIdsByClass.get(k).push(l.student_id);
  }
  return list.map((cls) => {
    const out = { ...normalize(cls) };
    if (cls.student_id && studentName.has(String(cls.student_id))) out.student_name = studentName.get(String(cls.student_id));
    if (cls.group_id && groupName.has(String(cls.group_id)))       out.group_name   = groupName.get(String(cls.group_id));
    out.student_ids = studentIdsByClass.get(String(cls.ROWID)) || [];
    out.exceptions = parseExceptions(cls.exceptions);
    return out;
  });
}

// GET /api/classes/today
router.get('/today', async (req, res) => {
  try {
    const today = new Date().getDay();
    const rows = await zcql(req, `SELECT * FROM Classes WHERE Classes.day_of_week = ${today} AND Classes.is_active = 1 AND Classes.org_id = ${Number(req.orgId)} ORDER BY Classes.start_time ASC`);
    const decorated = await decorateList(req, unwrap(rows, 'Classes'));
    res.json({ classes: decorated, day_of_week: today });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch today\'s classes', detail: e.message });
  }
});

// ---- Schedule exceptions (cancel / reschedule a single occurrence) ----
// A recurring class repeats weekly on its day_of_week. An exception overrides
// ONE dated occurrence: status='cancelled' hides it for that date;
// status='moved' relocates it to new_date + new_start_time/new_end_time.
// Exceptions live in the Classes.exceptions JSON column (no separate table),
// so they ride along with every GET /classes response.

// POST /api/classes/:id/exceptions  — cancel or move a single occurrence
router.post('/:id/exceptions', async (req, res) => {
  try {
    const { exception_date, status, new_date, new_start_time, new_end_time, note } = req.body;
    if (!exception_date || !status) {
      return res.status(400).json({ error: 'exception_date and status are required' });
    }
    if (!VALID_EXCEPTION_STATUS.includes(status)) {
      return res.status(400).json({ error: 'invalid status' });
    }
    const cls = await getById(req, 'Classes', req.params.id);
    if (!cls || Number(cls.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Class not found' });
    }
    if (status === 'moved' && !new_date) {
      return res.status(400).json({ error: 'new_date required when moving an occurrence' });
    }
    // One exception per date: drop any existing entry for this date, then add.
    const list = parseExceptions(cls.exceptions).filter((e) => e.date !== exception_date);
    const entry = {
      date: exception_date,
      status,
      new_date: status === 'moved' ? (new_date || null) : null,
      new_start_time: status === 'moved' ? (new_start_time || cls.start_time) : null,
      new_end_time: status === 'moved' ? (new_end_time || cls.end_time) : null,
      note: note || '',
    };
    list.push(entry);
    await update(req, 'Classes', req.params.id, { exceptions: JSON.stringify(list) });
    res.status(201).json({ exception: entry, exceptions: list });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save exception', detail: e.message });
  }
});

// DELETE /api/classes/:id/exceptions/:date  — un-cancel / un-move (restore default)
router.delete('/:id/exceptions/:date', async (req, res) => {
  try {
    const cls = await getById(req, 'Classes', req.params.id);
    if (!cls || Number(cls.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Class not found' });
    }
    const list = parseExceptions(cls.exceptions).filter((e) => e.date !== req.params.date);
    await update(req, 'Classes', req.params.id, { exceptions: JSON.stringify(list) });
    res.json({ message: 'Exception removed', exceptions: list });
  } catch (e) {
    res.status(500).json({ error: 'Failed to remove exception', detail: e.message });
  }
});

// GET /api/classes  (optional filters: day_of_week, group_id, student_id, is_active, class_type)
router.get('/', async (req, res) => {
  try {
    const { day_of_week, group_id, student_id, is_active, class_type } = req.query;
    const where = [`Classes.org_id = ${Number(req.orgId)}`];
    if (day_of_week !== undefined) where.push(`Classes.day_of_week = ${parseInt(day_of_week)}`);
    const gid = safeId(group_id);
    const sid = safeId(student_id);
    if (gid) where.push(`Classes.group_id = ${gid}`);
    if (sid) where.push(`Classes.student_id = ${sid}`);
    if (is_active !== undefined) where.push(`Classes.is_active = ${parseInt(is_active)}`);
    if (class_type) where.push(`Classes.class_type = '${class_type}'`);
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const rows = await zcql(req, `SELECT * FROM Classes ${whereSql} ORDER BY Classes.day_of_week, Classes.start_time ASC`);
    const list = unwrap(rows, 'Classes');
    const decorated = await decorateList(req, list);
    res.json({ classes: decorated });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch classes', detail: e.message });
  }
});

// GET /api/classes/:id
router.get('/:id', async (req, res) => {
  try {
    const cls = await getById(req, 'Classes', req.params.id);
    if (!cls || Number(cls.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Class not found' });
    }
    const decorated = await decorate(req, cls);
    res.json({ class: decorated });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch class', detail: e.message });
  }
});

// POST /api/classes
router.post('/', async (req, res) => {
  try {
    const { name, group_id, student_id, student_ids, class_type, day_of_week, start_time, end_time, is_active, meeting_link } = req.body;
    if (!name || class_type === undefined || day_of_week === undefined || !start_time || !end_time) {
      return res.status(400).json({ error: 'name, class_type, day_of_week, start_time, end_time are required' });
    }
    if (!VALID_TYPES.includes(class_type)) {
      return res.status(400).json({ error: 'invalid class_type' });
    }
    if (isGroupType(class_type) && !group_id) {
      return res.status(400).json({ error: 'group_id required for group types' });
    }
    const individualIds = Array.isArray(student_ids) && student_ids.length ? student_ids : student_id ? [student_id] : [];
    if (!isGroupType(class_type) && !individualIds.length) {
      return res.status(400).json({ error: 'student_id or student_ids[] required for individual types' });
    }
    const duration_hours = calcDuration(start_time, end_time);
    const baseRow = {
      name,
      group_id: isGroupType(class_type) ? String(group_id) : null,
      student_id: !isGroupType(class_type) && individualIds.length === 1 ? String(individualIds[0]) : null,
      class_type,
      day_of_week: parseInt(day_of_week),
      start_time, end_time,
      duration_hours,
      is_active: is_active !== undefined ? parseInt(is_active) : 1,
      meeting_link: isOnlineType(class_type) ? (cleanMeetingLink(meeting_link) || '') : '',
      org_id: Number(req.orgId),
    };
    const cls = await insert(req, 'Classes', baseRow);
    // Persist roster links in ClassStudents. For a group class these are the
    // EXTRA individual students added on top of the batch (tuition mode); for
    // an individual class they're the full roster when there's more than one.
    // A single-student individual class is stored compactly in student_id.
    const linkIds = isGroupType(class_type)
      ? individualIds
      : (individualIds.length > 1 ? individualIds : []);
    for (const sid of linkIds) {
      try { await insert(req, 'ClassStudents', { class_id: cls.ROWID, student_id: String(sid), org_id: Number(req.orgId) }); } catch {}
    }
    const decorated = await decorate(req, cls);
    res.status(201).json({ class: decorated });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create class', detail: e.message });
  }
});

// PUT /api/classes/:id
router.put('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Classes', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Class not found' });
    }
    const { name, group_id, student_id, student_ids, class_type, day_of_week, start_time, end_time, is_active, meeting_link } = req.body;
    const newType = class_type ?? existing.class_type;
    if (!VALID_TYPES.includes(newType)) return res.status(400).json({ error: 'invalid class_type' });
    const finalStart = start_time ?? existing.start_time;
    const finalEnd = end_time ?? existing.end_time;
    const patch = {
      name: name ?? existing.name,
      class_type: newType,
      day_of_week: day_of_week !== undefined ? parseInt(day_of_week) : existing.day_of_week,
      start_time: finalStart,
      end_time: finalEnd,
      duration_hours: calcDuration(finalStart, finalEnd),
      is_active: is_active !== undefined ? parseInt(is_active) : existing.is_active,
      group_id: isGroupType(newType) ? String(group_id ?? existing.group_id) : null,
      student_id: !isGroupType(newType) && student_id !== undefined ? (student_id ? String(student_id) : null) : (isGroupType(newType) ? null : existing.student_id),
      // Online types keep their link (new value if given, else preserve);
      // switching to an offline type clears it.
      meeting_link: isOnlineType(newType)
        ? (cleanMeetingLink(meeting_link) ?? (existing.meeting_link || ''))
        : '',
    };
    const updated = await update(req, 'Classes', req.params.id, patch);
    if (Array.isArray(student_ids)) {
      try {
        const links = await zcql(req, `SELECT ROWID FROM ClassStudents WHERE ClassStudents.class_id = ${req.params.id} AND ClassStudents.org_id = ${Number(req.orgId)}`);
        for (const l of unwrap(links, 'ClassStudents')) {
          try { await remove(req, 'ClassStudents', l.ROWID); } catch {}
        }
      } catch {}
      for (const sid of student_ids) {
        try { await insert(req, 'ClassStudents', { class_id: req.params.id, student_id: String(sid), org_id: Number(req.orgId) }); } catch {}
      }
    }
    const decorated = await decorate(req, updated);
    res.json({ class: decorated });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update class', detail: e.message });
  }
});

// DELETE /api/classes/:id
router.delete('/:id', async (req, res) => {
  try {
    const existing = await getById(req, 'Classes', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Class not found' });
    }
    try {
      const links = await zcql(req, `SELECT ROWID FROM ClassStudents WHERE ClassStudents.class_id = ${req.params.id} AND ClassStudents.org_id = ${Number(req.orgId)}`);
      for (const l of unwrap(links, 'ClassStudents')) {
        try { await remove(req, 'ClassStudents', l.ROWID); } catch {}
      }
    } catch {}
    await remove(req, 'Classes', req.params.id);
    res.json({ message: 'Class deleted' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete class', detail: e.message });
  }
});

// POST /api/classes/:id/share-link — save a meeting link on the class (so the
// portal Join button updates) and push an in-app notification to its students.
// Body: { meeting_link, student_ids? }. Without student_ids, sends to the whole
// roster; with them, only those (filtered to the class roster). The message is
// rendered from the editable `online_meeting` template, personalised per student.
router.post('/:id/share-link', async (req, res) => {
  try {
    const cls = await getById(req, 'Classes', req.params.id);
    if (!cls || Number(cls.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Class not found' });
    }
    const link = cleanMeetingLink(req.body.meeting_link);
    if (!link) return res.status(400).json({ error: 'meeting_link is required' });

    // Persist on the class so the portal Join button reflects it.
    try { await update(req, 'Classes', cls.ROWID, { meeting_link: link }); }
    catch (e) { console.error('[share-link] save failed:', e.message); }

    // Recipients: whole roster, optionally narrowed to a selected subset.
    const roster = await resolveRoster(req, cls);
    let recipients = roster;
    if (Array.isArray(req.body.student_ids) && req.body.student_ids.length) {
      const sel = new Set(req.body.student_ids.map(String));
      recipients = roster.filter((id) => sel.has(String(id)));
    }
    if (!recipients.length) return res.status(400).json({ error: 'No recipients in this class' });

    // Names for personalisation (one org Students pull).
    const studentRows = await zcqlAll(req, `SELECT ROWID, name, parent_name FROM Students WHERE Students.org_id = ${Number(req.orgId)}`, 'Students').catch(() => []);
    const byId = new Map(unwrap(studentRows, 'Students').map((s) => [String(s.ROWID), s]));

    // Template + school identity.
    let tmpl = ONLINE_MEETING_DEFAULT;
    try { const t = await loadTemplates(req); if (t && t.online_meeting) tmpl = t.online_meeting; } catch { /* default */ }
    let school = 'Your Academy', signature = 'Your Academy';
    try {
      const s = await loadAppSettings(req);
      school = s['school.name'] || school;
      signature = s['school.signature'] || s['school.name'] || signature;
    } catch { /* defaults */ }

    const className = cls.name || 'your class';
    const timeStr = cls.start_time ? `at ${fmtTime(cls.start_time)}` : 'now';

    let notified = 0;
    for (const sid of recipients) {
      const s = byId.get(String(sid));
      const body = substituteTemplate(tmpl, {
        parent: (s && s.parent_name) || 'Parent',
        name: (s && s.name) || 'your child',
        class_name: className,
        time: timeStr,
        link,
        school,
        signature,
      });
      try {
        await createNotifications(req, {
          orgId: Number(req.orgId),
          studentIds: [String(sid)],
          type: 'class',
          title: 'Online class link',
          body,
          link: '/portal/dashboard',
          push: true,
        });
        notified++;
      } catch (e) { console.error('[share-link] notify failed', sid, e.message); }
    }

    res.json({ ok: true, meeting_link: link, recipients: recipients.length, notified });
  } catch (e) {
    res.status(500).json({ error: 'Failed to share meeting link', detail: e.message });
  }
});

module.exports = router;
