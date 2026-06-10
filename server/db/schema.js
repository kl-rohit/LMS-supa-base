const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'veena.db');

let db;

function getDb() {
  if (!db) {
    const fs = require('fs');
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initializeSchema();
    fixClassDurations();
    backfillClassStudents();
  }
  return db;
}

function initializeSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_name TEXT NOT NULL,
      mobile_number TEXT NOT NULL,
      fee_online REAL NOT NULL DEFAULT 0,
      fee_offline REAL NOT NULL DEFAULT 0,
      fee_offline_group REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS groups_table (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS group_students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      FOREIGN KEY (group_id) REFERENCES groups_table(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
      UNIQUE(group_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      group_id INTEGER,
      student_id INTEGER,
      class_type TEXT NOT NULL CHECK(class_type IN ('online', 'offline', 'offline_group', 'online_group')),
      day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration_hours REAL NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES groups_table(id) ON DELETE SET NULL,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS class_students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
      UNIQUE(class_id, student_id)
    );

    CREATE INDEX IF NOT EXISTS idx_class_students_class ON class_students(class_id);
    CREATE INDEX IF NOT EXISTS idx_class_students_student ON class_students(student_id);

    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      class_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('present', 'absent', 'late')),
      class_type TEXT NOT NULL,
      duration_hours REAL NOT NULL DEFAULT 1,
      fee_charged REAL NOT NULL DEFAULT 0,
      topic TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS additional_fees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      fee_date TEXT NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER,
      parent_name TEXT,
      mobile_number TEXT,
      message TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'custom',
      is_sent INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
    CREATE INDEX IF NOT EXISTS idx_attendance_class ON attendance(class_id);
    CREATE INDEX IF NOT EXISTS idx_classes_day ON classes(day_of_week);
    CREATE INDEX IF NOT EXISTS idx_additional_fees_student ON additional_fees(student_id);
    CREATE INDEX IF NOT EXISTS idx_additional_fees_month_year ON additional_fees(month, year);
    CREATE INDEX IF NOT EXISTS idx_messages_student ON messages(student_id);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// Fix duration_hours for all classes based on start_time and end_time
// Also reconcile ALL attendance records to match their class durations and recalculate fees
function fixClassDurations() {
  const classes = db.prepare('SELECT id, start_time, end_time, duration_hours FROM classes').all();
  const updateClass = db.prepare('UPDATE classes SET duration_hours = ? WHERE id = ?');

  // Step 1: Fix class durations from start/end times
  for (const cls of classes) {
    if (cls.start_time && cls.end_time) {
      const [sh, sm] = cls.start_time.split(':').map(Number);
      const [eh, em] = cls.end_time.split(':').map(Number);
      const diffMinutes = (eh * 60 + em) - (sh * 60 + sm);
      const correctDuration = diffMinutes > 0 ? diffMinutes / 60 : 1;
      if (Math.abs(cls.duration_hours - correctDuration) > 0.01) {
        updateClass.run(correctDuration, cls.id);
        console.log(`Fixed class ${cls.id}: duration ${cls.duration_hours}h -> ${correctDuration}h (${cls.start_time}-${cls.end_time})`);
      }
    }
  }

  // Step 2: Reconcile ALL attendance records with their class durations and recalculate fees
  const attendanceRecords = db.prepare(`
    SELECT a.id, a.student_id, a.class_id, a.class_type, a.status, a.duration_hours, a.fee_charged,
           c.duration_hours as class_duration
    FROM attendance a
    JOIN classes c ON a.class_id = c.id
    WHERE a.status IN ('present', 'late')
  `).all();

  const updateAttendance = db.prepare('UPDATE attendance SET duration_hours = ?, fee_charged = ? WHERE id = ?');

  for (const att of attendanceRecords) {
    const correctDuration = att.class_duration || 1;
    const student = db.prepare('SELECT fee_online, fee_offline, fee_offline_group FROM students WHERE id = ?').get(att.student_id);
    if (student) {
      let feePerHour = 0;
      if (att.class_type === 'online') feePerHour = student.fee_online || 0;
      else if (att.class_type === 'offline') feePerHour = student.fee_offline || 0;
      else if (att.class_type === 'offline_group' || att.class_type === 'online_group') feePerHour = student.fee_offline_group || 0;
      const correctFee = feePerHour * correctDuration;
      if (Math.abs(att.duration_hours - correctDuration) > 0.01 || Math.abs(att.fee_charged - correctFee) > 0.01) {
        updateAttendance.run(correctDuration, correctFee, att.id);
        console.log(`Fixed attendance ${att.id}: ${att.duration_hours}h/${att.fee_charged} -> ${correctDuration}h/${correctFee} (${feePerHour}/hr x ${correctDuration}h)`);
      }
    }
  }
}

// Populate class_students from legacy classes.student_id values
function backfillClassStudents() {
  const rows = db.prepare(
    "SELECT id, student_id FROM classes WHERE student_id IS NOT NULL"
  ).all();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO class_students (class_id, student_id) VALUES (?, ?)'
  );
  const tx = db.transaction(() => {
    for (const row of rows) insert.run(row.id, row.student_id);
  });
  tx();
}

module.exports = { getDb };
