const { isZohoEnabled, getSpreadsheetId, setSetting } = require('./zohoAuth');
const { addRows, updateRow, deleteRow, clearSheet } = require('./zohoSheets');
const { SHEET_MAPPINGS } = require('./zohoConfig');
const { getDb } = require('../db/schema');

// ── Helper ──────────────────────────────────────────────
function canSync() {
  return isZohoEnabled() && getSpreadsheetId();
}

function logError(context, err) {
  console.error(`[ZohoSync] ${context}:`, err.message || err);
}

async function pushInBatches(spreadsheetId, sheetName, rows, batchSize = 200) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    await addRows(spreadsheetId, sheetName, batch);
    if (i + batchSize < rows.length) {
      await new Promise((r) => setTimeout(r, 1000)); // Rate limit
    }
  }
}

// ── Students ────────────────────────────────────────────
function syncStudentCreate(student) {
  if (!canSync()) return;
  (async () => {
    const sid = getSpreadsheetId();
    const row = SHEET_MAPPINGS.Students.mapRow(student);
    await addRows(sid, 'Students', [row]);
  })().catch((e) => logError('Student create', e));
}

function syncStudentUpdate(student) {
  if (!canSync()) return;
  (async () => {
    const sid = getSpreadsheetId();
    const row = SHEET_MAPPINGS.Students.mapRow(student);
    await updateRow(sid, 'Students', `"id"=${student.id}`, row);
  })().catch((e) => logError('Student update', e));
}

function syncStudentDelete(studentId) {
  if (!canSync()) return;
  (async () => {
    const sid = getSpreadsheetId();
    // Soft delete - update status to inactive
    const db = getDb();
    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
    if (student) {
      const row = SHEET_MAPPINGS.Students.mapRow(student);
      await updateRow(sid, 'Students', `"id"=${studentId}`, row);
    }
  })().catch((e) => logError('Student delete', e));
}

// ── Groups ──────────────────────────────────────────────
function getGroupMembers(groupId) {
  const db = getDb();
  return db.prepare(`
    SELECT s.name FROM students s
    JOIN group_students gs ON s.id = gs.student_id
    WHERE gs.group_id = ?
  `).all(groupId);
}

function syncGroupCreate(group) {
  if (!canSync()) return;
  (async () => {
    const sid = getSpreadsheetId();
    const members = getGroupMembers(group.id);
    const row = SHEET_MAPPINGS.Groups.mapRow(group, members);
    await addRows(sid, 'Groups', [row]);
  })().catch((e) => logError('Group create', e));
}

function syncGroupUpdate(group) {
  if (!canSync()) return;
  (async () => {
    const sid = getSpreadsheetId();
    const members = getGroupMembers(group.id);
    const row = SHEET_MAPPINGS.Groups.mapRow(group, members);
    await updateRow(sid, 'Groups', `"id"=${group.id}`, row);
  })().catch((e) => logError('Group update', e));
}

function syncGroupDelete(groupId) {
  if (!canSync()) return;
  (async () => {
    const sid = getSpreadsheetId();
    await deleteRow(sid, 'Groups', `"id"=${groupId}`);
  })().catch((e) => logError('Group delete', e));
}

function syncGroupMemberChange(groupId) {
  if (!canSync()) return;
  (async () => {
    const sid = getSpreadsheetId();
    const db = getDb();
    const group = db.prepare('SELECT * FROM groups_table WHERE id = ?').get(groupId);
    if (group) {
      const members = getGroupMembers(groupId);
      const row = SHEET_MAPPINGS.Groups.mapRow(group, members);
      await updateRow(sid, 'Groups', `"id"=${groupId}`, row);
    }
  })().catch((e) => logError('Group member change', e));
}

// ── Classes ─────────────────────────────────────────────
function getClassWithNames(classId) {
  const db = getDb();
  return db.prepare(`
    SELECT c.*, s.name as student_name, g.name as group_name
    FROM classes c
    LEFT JOIN students s ON c.student_id = s.id
    LEFT JOIN groups_table g ON c.group_id = g.id
    WHERE c.id = ?
  `).get(classId);
}

function syncClassCreate(cls) {
  if (!canSync()) return;
  (async () => {
    const sid = getSpreadsheetId();
    const full = getClassWithNames(cls.id) || cls;
    const row = SHEET_MAPPINGS.Classes.mapRow(full);
    await addRows(sid, 'Classes', [row]);
  })().catch((e) => logError('Class create', e));
}

function syncClassUpdate(cls) {
  if (!canSync()) return;
  (async () => {
    const sid = getSpreadsheetId();
    const full = getClassWithNames(cls.id) || cls;
    const row = SHEET_MAPPINGS.Classes.mapRow(full);
    await updateRow(sid, 'Classes', `"id"=${cls.id}`, row);
  })().catch((e) => logError('Class update', e));
}

function syncClassDelete(classId) {
  if (!canSync()) return;
  (async () => {
    const sid = getSpreadsheetId();
    await deleteRow(sid, 'Classes', `"id"=${classId}`);
  })().catch((e) => logError('Class delete', e));
}

// ── Attendance ──────────────────────────────────────────
function getAttendanceWithNames(recordId) {
  const db = getDb();
  return db.prepare(`
    SELECT a.*, s.name as student_name, c.name as class_name
    FROM attendance a
    JOIN students s ON a.student_id = s.id
    JOIN classes c ON a.class_id = c.id
    WHERE a.id = ?
  `).get(recordId);
}

function syncAttendanceCreate(record) {
  if (!canSync()) return;
  (async () => {
    const sid = getSpreadsheetId();
    const full = getAttendanceWithNames(record.id) || record;
    const row = SHEET_MAPPINGS.Attendance.mapRow(full);
    await addRows(sid, 'Attendance', [row]);
  })().catch((e) => logError('Attendance create', e));
}

function syncAttendanceBulkCreate(records) {
  if (!canSync() || !records || records.length === 0) return;
  (async () => {
    const sid = getSpreadsheetId();
    const db = getDb();
    const rows = [];
    for (const rec of records) {
      const id = rec.id || rec;
      const full = getAttendanceWithNames(id);
      if (full) rows.push(SHEET_MAPPINGS.Attendance.mapRow(full));
    }
    if (rows.length > 0) {
      await pushInBatches(sid, 'Attendance', rows);
    }
  })().catch((e) => logError('Attendance bulk create', e));
}

function syncAttendanceUpdate(record) {
  if (!canSync()) return;
  (async () => {
    const sid = getSpreadsheetId();
    const full = getAttendanceWithNames(record.id) || record;
    const row = SHEET_MAPPINGS.Attendance.mapRow(full);
    await updateRow(sid, 'Attendance', `"id"=${record.id}`, row);
  })().catch((e) => logError('Attendance update', e));
}

function syncAttendanceDelete(recordId) {
  if (!canSync()) return;
  (async () => {
    const sid = getSpreadsheetId();
    await deleteRow(sid, 'Attendance', `"id"=${recordId}`);
  })().catch((e) => logError('Attendance delete', e));
}

// ── Fees ────────────────────────────────────────────────
function getFeeWithName(feeId) {
  const db = getDb();
  return db.prepare(`
    SELECT af.*, s.name as student_name
    FROM additional_fees af
    JOIN students s ON af.student_id = s.id
    WHERE af.id = ?
  `).get(feeId);
}

function syncFeeCreate(fee) {
  if (!canSync()) return;
  (async () => {
    const sid = getSpreadsheetId();
    const full = getFeeWithName(fee.id) || fee;
    const row = SHEET_MAPPINGS.Fees.mapRow(full);
    await addRows(sid, 'Fees', [row]);
  })().catch((e) => logError('Fee create', e));
}

function syncFeeUpdate(fee) {
  if (!canSync()) return;
  (async () => {
    const sid = getSpreadsheetId();
    const full = getFeeWithName(fee.id) || fee;
    const row = SHEET_MAPPINGS.Fees.mapRow(full);
    await updateRow(sid, 'Fees', `"id"=${fee.id}`, row);
  })().catch((e) => logError('Fee update', e));
}

function syncFeeDelete(feeId) {
  if (!canSync()) return;
  (async () => {
    const sid = getSpreadsheetId();
    await deleteRow(sid, 'Fees', `"id"=${feeId}`);
  })().catch((e) => logError('Fee delete', e));
}

// ── Messages ────────────────────────────────────────────
function syncMessageCreate(msg) {
  if (!canSync()) return;
  (async () => {
    const sid = getSpreadsheetId();
    const row = SHEET_MAPPINGS.Messages.mapRow(msg);
    await addRows(sid, 'Messages', [row]);
  })().catch((e) => logError('Message create', e));
}

function syncMessageUpdate(msg) {
  if (!canSync()) return;
  (async () => {
    const sid = getSpreadsheetId();
    const row = SHEET_MAPPINGS.Messages.mapRow(msg);
    await updateRow(sid, 'Messages', `"id"=${msg.id}`, row);
  })().catch((e) => logError('Message update', e));
}

function syncMessageDelete(messageId) {
  if (!canSync()) return;
  (async () => {
    const sid = getSpreadsheetId();
    await deleteRow(sid, 'Messages', `"id"=${messageId}`);
  })().catch((e) => logError('Message delete', e));
}

function syncMessageBulkCreate(messages) {
  if (!canSync() || !messages || messages.length === 0) return;
  (async () => {
    const sid = getSpreadsheetId();
    const rows = messages.map((m) => SHEET_MAPPINGS.Messages.mapRow(m));
    await pushInBatches(sid, 'Messages', rows);
  })().catch((e) => logError('Message bulk create', e));
}

// ── Full Sync ───────────────────────────────────────────
async function syncAllData() {
  const sid = getSpreadsheetId();
  if (!sid) throw new Error('No spreadsheet configured');

  const db = getDb();
  const results = {};

  // Students
  try {
    const students = db.prepare('SELECT * FROM students').all();
    await clearSheet(sid, 'Students');
    if (students.length > 0) {
      await pushInBatches(sid, 'Students', students.map((s) => SHEET_MAPPINGS.Students.mapRow(s)));
    }
    results.Students = `${students.length} rows`;
  } catch (e) {
    results.Students = `ERROR: ${e.message}`;
  }

  // Groups (with denormalized members)
  try {
    const groups = db.prepare('SELECT * FROM groups_table').all();
    await clearSheet(sid, 'Groups');
    if (groups.length > 0) {
      const rows = groups.map((g) => {
        const members = getGroupMembers(g.id);
        return SHEET_MAPPINGS.Groups.mapRow(g, members);
      });
      await pushInBatches(sid, 'Groups', rows);
    }
    results.Groups = `${groups.length} rows`;
  } catch (e) {
    results.Groups = `ERROR: ${e.message}`;
  }

  // Classes (with joined names)
  try {
    const classes = db.prepare(`
      SELECT c.*, s.name as student_name, g.name as group_name
      FROM classes c
      LEFT JOIN students s ON c.student_id = s.id
      LEFT JOIN groups_table g ON c.group_id = g.id
    `).all();
    await clearSheet(sid, 'Classes');
    if (classes.length > 0) {
      await pushInBatches(sid, 'Classes', classes.map((c) => SHEET_MAPPINGS.Classes.mapRow(c)));
    }
    results.Classes = `${classes.length} rows`;
  } catch (e) {
    results.Classes = `ERROR: ${e.message}`;
  }

  // Attendance (with joined names)
  try {
    const attendance = db.prepare(`
      SELECT a.*, s.name as student_name, c.name as class_name
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      JOIN classes c ON a.class_id = c.id
    `).all();
    await clearSheet(sid, 'Attendance');
    if (attendance.length > 0) {
      await pushInBatches(sid, 'Attendance', attendance.map((a) => SHEET_MAPPINGS.Attendance.mapRow(a)));
    }
    results.Attendance = `${attendance.length} rows`;
  } catch (e) {
    results.Attendance = `ERROR: ${e.message}`;
  }

  // Fees (additional_fees with student name)
  try {
    const fees = db.prepare(`
      SELECT af.*, s.name as student_name
      FROM additional_fees af
      JOIN students s ON af.student_id = s.id
    `).all();
    await clearSheet(sid, 'Fees');
    if (fees.length > 0) {
      await pushInBatches(sid, 'Fees', fees.map((f) => SHEET_MAPPINGS.Fees.mapRow(f)));
    }
    results.Fees = `${fees.length} rows`;
  } catch (e) {
    results.Fees = `ERROR: ${e.message}`;
  }

  // Messages
  try {
    const messages = db.prepare(`
      SELECT m.*, s.name as student_name
      FROM messages m
      LEFT JOIN students s ON m.student_id = s.id
    `).all();
    await clearSheet(sid, 'Messages');
    if (messages.length > 0) {
      await pushInBatches(sid, 'Messages', messages.map((m) => SHEET_MAPPINGS.Messages.mapRow(m)));
    }
    results.Messages = `${messages.length} rows`;
  } catch (e) {
    results.Messages = `ERROR: ${e.message}`;
  }

  setSetting('zoho_last_full_sync', new Date().toISOString());
  return results;
}

module.exports = {
  // Students
  syncStudentCreate,
  syncStudentUpdate,
  syncStudentDelete,
  // Groups
  syncGroupCreate,
  syncGroupUpdate,
  syncGroupDelete,
  syncGroupMemberChange,
  // Classes
  syncClassCreate,
  syncClassUpdate,
  syncClassDelete,
  // Attendance
  syncAttendanceCreate,
  syncAttendanceBulkCreate,
  syncAttendanceUpdate,
  syncAttendanceDelete,
  // Fees
  syncFeeCreate,
  syncFeeUpdate,
  syncFeeDelete,
  // Messages
  syncMessageCreate,
  syncMessageUpdate,
  syncMessageDelete,
  syncMessageBulkCreate,
  // Full sync
  syncAllData,
};
