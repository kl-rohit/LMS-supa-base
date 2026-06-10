const express = require('express');
const router = express.Router();
const { getDb } = require('../db/schema');

// GET /api/dashboard - Dashboard stats
router.get('/', (req, res) => {
  try {
    const db = getDb();

    const now = new Date();
    const today = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const dayOfWeek = now.getDay(); // 0 = Sunday, 6 = Saturday

    // Current month boundaries
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // 1-12
    const monthStr = String(month).padStart(2, '0');
    const monthStart = `${year}-${monthStr}-01`;
    const monthEnd = `${year}-${monthStr}-31`;

    // Current week boundaries (Monday to Sunday)
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - daysSinceMonday);
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const weekEndStr = weekEnd.toISOString().split('T')[0];

    // 1. Total active students
    const activeStudents = db.prepare(
      "SELECT COUNT(*) as count FROM students WHERE status = 'active'"
    ).get();

    // 2. Total classes this week (scheduled, based on day_of_week for active classes)
    const classesThisWeek = db.prepare(
      'SELECT COUNT(*) as count FROM classes WHERE is_active = 1'
    ).get();

    // 3. Attendance rate this month
    const monthlyAttendance = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present,
        SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late,
        SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent
      FROM attendance
      WHERE date >= ? AND date <= ?
    `).get(monthStart, monthEnd);

    const attendanceRate = monthlyAttendance.total > 0
      ? parseFloat(((monthlyAttendance.present + monthlyAttendance.late) / monthlyAttendance.total * 100).toFixed(1))
      : 0;

    // 4. Total fee collected this month (class fees + additional fees)
    const monthlyClassFees = db.prepare(`
      SELECT COALESCE(SUM(fee_charged), 0) as total
      FROM attendance
      WHERE date >= ? AND date <= ?
    `).get(monthStart, monthEnd);

    const monthlyAdditionalFees = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM additional_fees
      WHERE month = ? AND year = ?
    `).get(month, year);

    const totalFeeThisMonth = monthlyClassFees.total + monthlyAdditionalFees.total;

    // 5. Recent attendance entries (last 10)
    const recentAttendance = db.prepare(`
      SELECT a.*, s.name as student_name, c.name as class_name
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      JOIN classes c ON a.class_id = c.id
      ORDER BY a.date DESC, a.created_at DESC
      LIMIT 10
    `).all();

    // 6. Upcoming classes today
    const todayClasses = db.prepare(`
      SELECT c.*,
        s.name as student_name,
        g.name as group_name
      FROM classes c
      LEFT JOIN students s ON c.student_id = s.id
      LEFT JOIN groups_table g ON c.group_id = g.id
      WHERE c.day_of_week = ? AND c.is_active = 1
      ORDER BY c.start_time ASC
    `).all(dayOfWeek);

    // Check which of today's classes already have attendance marked
    const todayClassesWithStatus = todayClasses.map(cls => {
      const attendanceCount = db.prepare(`
        SELECT COUNT(*) as count FROM attendance WHERE class_id = ? AND date = ?
      `).get(cls.id, today);

      let groupMembers = null;
      if (cls.group_id) {
        groupMembers = db.prepare(`
          SELECT s.id, s.name
          FROM students s
          JOIN group_students gs ON s.id = gs.student_id
          WHERE gs.group_id = ? AND s.status = 'active'
          ORDER BY s.name ASC
        `).all(cls.group_id);
      }

      return {
        ...cls,
        attendance_marked: attendanceCount.count > 0,
        attendance_count: attendanceCount.count,
        group_members: groupMembers
      };
    });

    // 7. Absent alerts - students absent 3+ consecutive classes
    const absentAlerts = [];
    const activeStudentsList = db.prepare("SELECT * FROM students WHERE status = 'active'").all();

    for (const student of activeStudentsList) {
      // Get student's active classes (direct and via groups)
      const studentClasses = db.prepare(`
        SELECT DISTINCT c.id, c.name
        FROM classes c
        LEFT JOIN group_students gs ON c.group_id = gs.group_id
        WHERE c.is_active = 1 AND (c.student_id = ? OR gs.student_id = ?)
      `).all(student.id, student.id);

      for (const cls of studentClasses) {
        const recentRecords = db.prepare(`
          SELECT status, date FROM attendance
          WHERE student_id = ? AND class_id = ?
          ORDER BY date DESC
          LIMIT 10
        `).all(student.id, cls.id);

        let consecutiveAbsences = 0;
        for (const record of recentRecords) {
          if (record.status === 'absent') {
            consecutiveAbsences++;
          } else {
            break;
          }
        }

        if (consecutiveAbsences >= 3) {
          absentAlerts.push({
            student_id: student.id,
            student_name: student.name,
            parent_name: student.parent_name,
            mobile_number: student.mobile_number,
            class_id: cls.id,
            class_name: cls.name,
            consecutive_absences: consecutiveAbsences,
            last_absent_date: recentRecords[0]?.date
          });
        }
      }
    }

    // 8. This week's attendance summary
    const weeklyAttendance = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present,
        SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late,
        SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent
      FROM attendance
      WHERE date >= ? AND date <= ?
    `).get(weekStartStr, weekEndStr);

    // 9. Unsent messages count
    const unsentMessages = db.prepare(
      'SELECT COUNT(*) as count FROM messages WHERE is_sent = 0'
    ).get();

    res.json({
      today: today,
      day_of_week: dayOfWeek,
      stats: {
        total_active_students: activeStudents.count,
        total_classes_weekly: classesThisWeek.count,
        attendance_rate_this_month: attendanceRate,
        total_fee_this_month: totalFeeThisMonth,
        class_fees_this_month: monthlyClassFees.total,
        additional_fees_this_month: monthlyAdditionalFees.total,
        unsent_messages: unsentMessages.count
      },
      monthly_attendance: {
        total: monthlyAttendance.total,
        present: monthlyAttendance.present,
        late: monthlyAttendance.late,
        absent: monthlyAttendance.absent,
        rate: attendanceRate
      },
      weekly_attendance: {
        total: weeklyAttendance.total,
        present: weeklyAttendance.present,
        late: weeklyAttendance.late,
        absent: weeklyAttendance.absent,
        week_start: weekStartStr,
        week_end: weekEndStr
      },
      recent_attendance: recentAttendance,
      upcoming_classes_today: todayClassesWithStatus,
      absent_alerts: absentAlerts
    });
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

module.exports = router;
