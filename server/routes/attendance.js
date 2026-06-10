const express = require('express');
const router = express.Router();
const { getDb } = require('../db/schema');
const { syncAttendanceCreate, syncAttendanceBulkCreate, syncAttendanceUpdate, syncAttendanceDelete } = require('../services/zohoSync');

/**
 * Calculate fee charged based on student's fee settings, class type, and duration.
 * Fee rates are per hour (stored in student record).
 * fee_charged = fee_rate_per_hour * duration_hours
 */
function calculateFee(student, classType, durationHours) {
  let feePerHour = 0;
  switch (classType) {
    case 'online':
      feePerHour = student.fee_online || 0;
      break;
    case 'offline':
      feePerHour = student.fee_offline || 0;
      break;
    case 'offline_group':
    case 'online_group':
      feePerHour = student.fee_offline_group || 0;
      break;
  }
  return feePerHour * (durationHours || 1);
}

// POST /api/attendance - Mark attendance
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const { student_id, class_id, date, status, topic, notes } = req.body;

    // Validation
    if (!student_id || !class_id || !date || !status) {
      return res.status(400).json({
        error: 'student_id, class_id, date, and status are required'
      });
    }

    if (!['present', 'absent', 'late'].includes(status)) {
      return res.status(400).json({ error: 'status must be present, absent, or late' });
    }

    // Fetch class details
    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(class_id);
    if (!cls) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // Fetch student details for fee calculation
    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(student_id);
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Auto-calculate fee only when present or late
    let fee_charged = 0;
    if (status === 'present' || status === 'late') {
      fee_charged = calculateFee(student, cls.class_type, cls.duration_hours);
    }

    // Check for duplicate attendance record
    const existing = db.prepare(
      'SELECT id FROM attendance WHERE student_id = ? AND class_id = ? AND date = ?'
    ).get(student_id, class_id, date);

    if (existing) {
      return res.status(409).json({
        error: 'Attendance already marked for this student, class, and date',
        existing_id: existing.id
      });
    }

    const result = db.prepare(`
      INSERT INTO attendance (student_id, class_id, date, status, class_type, duration_hours, fee_charged, topic, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      student_id,
      class_id,
      date,
      status,
      cls.class_type,
      cls.duration_hours,
      fee_charged,
      topic || '',
      notes || ''
    );

    const record = db.prepare(`
      SELECT a.*, s.name as student_name, c.name as class_name
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      JOIN classes c ON a.class_id = c.id
      WHERE a.id = ?
    `).get(result.lastInsertRowid);

    syncAttendanceCreate(record);
    res.status(201).json({ attendance: record });
  } catch (error) {
    console.error('Error marking attendance:', error);
    res.status(500).json({ error: 'Failed to mark attendance' });
  }
});

// POST /api/attendance/bulk - Mark attendance for multiple students (e.g., a group class)
router.post('/bulk', (req, res) => {
  try {
    const db = getDb();
    const { class_id, date, records, topic, notes } = req.body;
    // records: [{ student_id, status }]

    if (!class_id || !date || !records || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({
        error: 'class_id, date, and records array are required'
      });
    }

    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(class_id);
    if (!cls) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const insertStmt = db.prepare(`
      INSERT INTO attendance (student_id, class_id, date, status, class_type, duration_hours, fee_charged, topic, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const results = [];
    const errors = [];

    const bulkInsert = db.transaction(() => {
      for (const record of records) {
        const { student_id, status: recordStatus } = record;

        if (!student_id || !recordStatus) {
          errors.push({ student_id, error: 'student_id and status are required' });
          continue;
        }

        if (!['present', 'absent', 'late'].includes(recordStatus)) {
          errors.push({ student_id, error: 'Invalid status' });
          continue;
        }

        // Check duplicate
        const existingRecord = db.prepare(
          'SELECT id FROM attendance WHERE student_id = ? AND class_id = ? AND date = ?'
        ).get(student_id, class_id, date);

        if (existingRecord) {
          errors.push({ student_id, error: 'Attendance already marked', existing_id: existingRecord.id });
          continue;
        }

        const student = db.prepare('SELECT * FROM students WHERE id = ?').get(student_id);
        if (!student) {
          errors.push({ student_id, error: 'Student not found' });
          continue;
        }

        let fee_charged = 0;
        if (recordStatus === 'present' || recordStatus === 'late') {
          fee_charged = calculateFee(student, cls.class_type, cls.duration_hours);
        }

        const insertResult = insertStmt.run(
          student_id, class_id, date, recordStatus,
          cls.class_type, cls.duration_hours, fee_charged,
          record.topic || topic || '',
          record.notes || notes || ''
        );

        results.push({
          id: insertResult.lastInsertRowid,
          student_id,
          student_name: student.name,
          status: recordStatus,
          fee_charged
        });
      }
    });

    bulkInsert();

    syncAttendanceBulkCreate(results);
    res.status(201).json({
      message: `Marked attendance for ${results.length} students`,
      attendance: results,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Error bulk marking attendance:', error);
    res.status(500).json({ error: 'Failed to mark bulk attendance' });
  }
});

// POST /api/attendance/adhoc - Mark attendance for an ad-hoc session (no
// pre-existing class). Creates a hidden class (is_active=0) on the fly so
// the existing schema's NOT NULL class_id is satisfied, then bulk inserts
// attendance rows for the provided students.
router.post('/adhoc', (req, res) => {
  try {
    const db = getDb();
    const {
      date, class_type, start_time, end_time, duration_hours,
      records, name,
    } = req.body;

    if (!date || !class_type || !records || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({
        error: 'date, class_type, and records[] are required'
      });
    }

    if (!['online', 'offline', 'offline_group', 'online_group'].includes(class_type)) {
      return res.status(400).json({ error: 'Invalid class_type' });
    }

    // Compute duration
    let dur = duration_hours;
    if ((!dur || dur <= 0) && start_time && end_time) {
      const [sh, sm] = start_time.split(':').map(Number);
      const [eh, em] = end_time.split(':').map(Number);
      const diff = (eh * 60 + em) - (sh * 60 + sm);
      dur = diff > 0 ? diff / 60 : 1;
    }
    if (!dur || dur <= 0) dur = 1;

    const day = new Date(date + 'T00:00:00').getDay();
    const stTime = start_time || '00:00';
    const enTime = end_time || '00:00';
    const className = name || `Ad-hoc ${date}${start_time ? ' ' + start_time : ''}`;

    // Class table CHECK constraint allows: online, offline, offline_group.
    // online_group attendance is permitted but the class row falls back to
    // offline_group to satisfy the CHECK while preserving correct fees on
    // attendance rows (we set attendance.class_type to the real value below).
    const classTypeForRow = class_type === 'online_group' ? 'offline_group' : class_type;

    const insertClass = db.prepare(`
      INSERT INTO classes (name, group_id, student_id, class_type, day_of_week, start_time, end_time, duration_hours, is_active)
      VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, 0)
    `);
    const insertAtt = db.prepare(`
      INSERT INTO attendance (student_id, class_id, date, status, class_type, duration_hours, fee_charged, topic, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const results = [];
    const errors = [];
    let classId;

    const tx = db.transaction(() => {
      const cr = insertClass.run(
        className, classTypeForRow, day, stTime, enTime, dur
      );
      classId = cr.lastInsertRowid;

      for (const r of records) {
        const sid = Number(r.student_id);
        const rs = r.status;
        if (!sid || !['present', 'absent', 'late'].includes(rs)) {
          errors.push({ student_id: sid, error: 'Invalid student_id or status' });
          continue;
        }
        const student = db.prepare('SELECT * FROM students WHERE id = ?').get(sid);
        if (!student) {
          errors.push({ student_id: sid, error: 'Student not found' });
          continue;
        }
        let fee = 0;
        if (rs === 'present' || rs === 'late') {
          if (r.fee_charged !== undefined && r.fee_charged !== null) {
            fee = Number(r.fee_charged) || 0;
          } else {
            fee = calculateFee(student, class_type, dur);
          }
        }
        const ar = insertAtt.run(
          sid, classId, date, rs, class_type, dur, fee,
          r.topic || '', r.notes || ''
        );
        results.push({
          id: ar.lastInsertRowid,
          student_id: sid,
          student_name: student.name,
          status: rs,
          fee_charged: fee,
        });
      }
    });
    tx();

    syncAttendanceBulkCreate(results);
    res.status(201).json({
      message: `Marked attendance for ${results.length} student(s)`,
      class_id: classId,
      attendance: results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Error marking ad-hoc attendance:', error);
    res.status(500).json({ error: 'Failed to mark ad-hoc attendance' });
  }
});

// GET /api/attendance - Get attendance records with filters
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const { date, student_id, class_id, status, from, to, page, limit } = req.query;

    let query = `
      SELECT a.*, s.name as student_name, c.name as class_name
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      JOIN classes c ON a.class_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (date) {
      query += ' AND a.date = ?';
      params.push(date);
    }

    if (student_id) {
      query += ' AND a.student_id = ?';
      params.push(parseInt(student_id));
    }

    if (class_id) {
      query += ' AND a.class_id = ?';
      params.push(parseInt(class_id));
    }

    if (status) {
      query += ' AND a.status = ?';
      params.push(status);
    }

    if (from) {
      query += ' AND a.date >= ?';
      params.push(from);
    }

    if (to) {
      query += ' AND a.date <= ?';
      params.push(to);
    }

    query += ' ORDER BY a.date DESC, a.created_at DESC';

    // Pagination
    if (limit) {
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit);
      const offset = (pageNum - 1) * limitNum;

      const countQuery = query.replace(
        /SELECT a\.\*, s\.name as student_name, c\.name as class_name/,
        'SELECT COUNT(*) as total'
      );
      const { total } = db.prepare(countQuery).get(...params);

      query += ' LIMIT ? OFFSET ?';
      params.push(limitNum, offset);

      const attendance = db.prepare(query).all(...params);
      return res.json({
        attendance,
        pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) }
      });
    }

    const attendance = db.prepare(query).all(...params);
    res.json({ attendance });
  } catch (error) {
    console.error('Error fetching attendance:', error);
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

// GET /api/attendance/by-date/:date - Get all attendance for a specific date
router.get('/by-date/:date', (req, res) => {
  try {
    const db = getDb();
    const { date } = req.params;

    const attendance = db.prepare(`
      SELECT a.*, s.name as student_name, s.parent_name, c.name as class_name, c.class_type as class_class_type
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      JOIN classes c ON a.class_id = c.id
      WHERE a.date = ?
      ORDER BY c.start_time ASC, s.name ASC
    `).all(date);

    res.json({ date, attendance });
  } catch (error) {
    console.error('Error fetching attendance by date:', error);
    res.status(500).json({ error: 'Failed to fetch attendance by date' });
  }
});

// GET /api/attendance/by-student/:studentId - Get all attendance for a student
router.get('/by-student/:studentId', (req, res) => {
  try {
    const db = getDb();
    const { studentId } = req.params;
    const { from, to, month, year } = req.query;

    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    let query = `
      SELECT a.*, c.name as class_name
      FROM attendance a
      JOIN classes c ON a.class_id = c.id
      WHERE a.student_id = ?
    `;
    const params = [parseInt(studentId)];

    if (from) {
      query += ' AND a.date >= ?';
      params.push(from);
    }

    if (to) {
      query += ' AND a.date <= ?';
      params.push(to);
    }

    if (month && year) {
      const monthStr = String(month).padStart(2, '0');
      query += ' AND a.date >= ? AND a.date <= ?';
      params.push(`${year}-${monthStr}-01`);
      params.push(`${year}-${monthStr}-31`);
    }

    query += ' ORDER BY a.date DESC';

    const attendance = db.prepare(query).all(...params);

    // Summary stats
    const totalClasses = attendance.length;
    const presentCount = attendance.filter(a => a.status === 'present').length;
    const absentCount = attendance.filter(a => a.status === 'absent').length;
    const lateCount = attendance.filter(a => a.status === 'late').length;
    const totalFees = attendance.reduce((sum, a) => sum + a.fee_charged, 0);
    const attendanceRate = totalClasses > 0 ? ((presentCount + lateCount) / totalClasses * 100).toFixed(1) : 0;

    res.json({
      student,
      attendance,
      summary: {
        total_classes: totalClasses,
        present: presentCount,
        absent: absentCount,
        late: lateCount,
        attendance_rate: parseFloat(attendanceRate),
        total_fees: totalFees
      }
    });
  } catch (error) {
    console.error('Error fetching student attendance:', error);
    res.status(500).json({ error: 'Failed to fetch student attendance' });
  }
});

// GET /api/attendance/:id - Get a single attendance record
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const record = db.prepare(`
      SELECT a.*, s.name as student_name, c.name as class_name
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      JOIN classes c ON a.class_id = c.id
      WHERE a.id = ?
    `).get(req.params.id);

    if (!record) {
      return res.status(404).json({ error: 'Attendance record not found' });
    }

    res.json({ attendance: record });
  } catch (error) {
    console.error('Error fetching attendance record:', error);
    res.status(500).json({ error: 'Failed to fetch attendance record' });
  }
});

// PUT /api/attendance/:id - Update an attendance record
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM attendance WHERE id = ?').get(req.params.id);

    if (!existing) {
      return res.status(404).json({ error: 'Attendance record not found' });
    }

    const { status, fee_charged, topic, notes } = req.body;
    const newStatus = status ?? existing.status;

    // If status changed, recalculate fee unless fee_charged is explicitly provided
    let newFee = existing.fee_charged;
    if (fee_charged !== undefined) {
      newFee = fee_charged;
    } else if (status && status !== existing.status) {
      if (newStatus === 'absent') {
        newFee = 0;
      } else if (newStatus === 'present' || newStatus === 'late') {
        // Recalculate from student fee settings
        const student = db.prepare('SELECT * FROM students WHERE id = ?').get(existing.student_id);
        if (student) {
          newFee = calculateFee(student, existing.class_type, existing.duration_hours);
        }
      }
    }

    db.prepare(`
      UPDATE attendance SET status = ?, fee_charged = ?, topic = ?, notes = ? WHERE id = ?
    `).run(
      newStatus,
      newFee,
      topic ?? existing.topic,
      notes ?? existing.notes,
      req.params.id
    );

    const record = db.prepare(`
      SELECT a.*, s.name as student_name, c.name as class_name
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      JOIN classes c ON a.class_id = c.id
      WHERE a.id = ?
    `).get(req.params.id);

    syncAttendanceUpdate(record);
    res.json({ attendance: record });
  } catch (error) {
    console.error('Error updating attendance:', error);
    res.status(500).json({ error: 'Failed to update attendance' });
  }
});

// DELETE /api/attendance/:id - Delete an attendance record
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM attendance WHERE id = ?').get(req.params.id);

    if (!existing) {
      return res.status(404).json({ error: 'Attendance record not found' });
    }

    db.prepare('DELETE FROM attendance WHERE id = ?').run(req.params.id);
    syncAttendanceDelete(req.params.id);
    res.json({ message: 'Attendance record deleted successfully' });
  } catch (error) {
    console.error('Error deleting attendance:', error);
    res.status(500).json({ error: 'Failed to delete attendance record' });
  }
});

// GET /api/attendance/absent-streaks/all - Check absent streaks for all students
router.get('/absent-streaks/all', (req, res) => {
  try {
    const db = getDb();
    const threshold = parseInt(req.query.threshold) || 3;

    // Get all active students
    const students = db.prepare("SELECT * FROM students WHERE status = 'active'").all();
    const alerts = [];

    for (const student of students) {
      // Get the student's classes
      const studentClasses = db.prepare(`
        SELECT DISTINCT c.id
        FROM classes c
        LEFT JOIN group_students gs ON c.group_id = gs.group_id
        WHERE c.is_active = 1 AND (c.student_id = ? OR gs.student_id = ?)
      `).all(student.id, student.id);

      for (const cls of studentClasses) {
        // Get recent attendance for this student and class, ordered by date desc
        const recentAttendance = db.prepare(`
          SELECT status, date FROM attendance
          WHERE student_id = ? AND class_id = ?
          ORDER BY date DESC
          LIMIT ?
        `).all(student.id, cls.id, threshold + 5);

        // Count consecutive absences from the most recent
        let consecutiveAbsences = 0;
        for (const record of recentAttendance) {
          if (record.status === 'absent') {
            consecutiveAbsences++;
          } else {
            break;
          }
        }

        if (consecutiveAbsences >= threshold) {
          const classInfo = db.prepare('SELECT name FROM classes WHERE id = ?').get(cls.id);
          alerts.push({
            student_id: student.id,
            student_name: student.name,
            parent_name: student.parent_name,
            mobile_number: student.mobile_number,
            class_id: cls.id,
            class_name: classInfo ? classInfo.name : 'Unknown',
            consecutive_absences: consecutiveAbsences,
            last_absent_date: recentAttendance[0]?.date
          });
        }
      }
    }

    res.json({ alerts, threshold });
  } catch (error) {
    console.error('Error checking absent streaks:', error);
    res.status(500).json({ error: 'Failed to check absent streaks' });
  }
});

module.exports = router;
