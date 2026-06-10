const express = require('express');
const router = express.Router();
const { getDb } = require('../db/schema');

// GET /api/reports/student/:id - Detailed student report
router.get('/student/:id', (req, res) => {
  try {
    const db = getDb();
    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Groups
    const groups = db.prepare(`
      SELECT g.id, g.name
      FROM groups_table g
      JOIN group_students gs ON g.id = gs.group_id
      WHERE gs.student_id = ?
    `).all(req.params.id);

    // All-time attendance summary
    const attendanceSummary = db.prepare(`
      SELECT
        COUNT(*) as total_classes,
        SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present,
        SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent,
        SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late,
        COALESCE(SUM(fee_charged), 0) as total_fees,
        COALESCE(SUM(duration_hours), 0) as total_hours
      FROM attendance
      WHERE student_id = ?
    `).get(req.params.id);

    const attendanceRate = attendanceSummary.total_classes > 0
      ? (((attendanceSummary.present + attendanceSummary.late) / attendanceSummary.total_classes) * 100).toFixed(1)
      : 0;

    // Monthly breakdown (attendance and fees)
    const monthlyBreakdown = db.prepare(`
      SELECT
        strftime('%Y', date) as year,
        strftime('%m', date) as month,
        COUNT(*) as total_classes,
        SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present,
        SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent,
        SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late,
        COALESCE(SUM(fee_charged), 0) as class_fees,
        COALESCE(SUM(duration_hours), 0) as total_hours
      FROM attendance
      WHERE student_id = ?
      GROUP BY strftime('%Y', date), strftime('%m', date)
      ORDER BY year DESC, month DESC
    `).all(req.params.id);

    // Add additional fees to monthly breakdown
    const monthlyData = monthlyBreakdown.map(m => {
      const addFees = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM additional_fees
        WHERE student_id = ? AND month = ? AND year = ?
      `).get(req.params.id, parseInt(m.month), parseInt(m.year));

      return {
        ...m,
        additional_fees: addFees.total,
        total_fees: m.class_fees + addFees.total,
        attendance_rate: m.total_classes > 0
          ? parseFloat(((m.present + m.late) / m.total_classes * 100).toFixed(1))
          : 0
      };
    });

    // Fee summary by class type
    const feesByClassType = db.prepare(`
      SELECT
        class_type,
        COUNT(*) as class_count,
        COALESCE(SUM(fee_charged), 0) as total_fee,
        COALESCE(SUM(duration_hours), 0) as total_hours
      FROM attendance
      WHERE student_id = ? AND (status = 'present' OR status = 'late')
      GROUP BY class_type
    `).all(req.params.id);

    // Total additional fees all-time
    const totalAdditionalFees = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM additional_fees WHERE student_id = ?
    `).get(req.params.id);

    // Classes assigned to this student
    const assignedClasses = db.prepare(`
      SELECT c.*, g.name as group_name
      FROM classes c
      LEFT JOIN groups_table g ON c.group_id = g.id
      WHERE c.student_id = ?
        OR c.group_id IN (SELECT group_id FROM group_students WHERE student_id = ?)
      ORDER BY c.day_of_week, c.start_time
    `).all(req.params.id, req.params.id);

    // Recent topics taught
    const recentTopics = db.prepare(`
      SELECT a.date, a.topic, a.class_type, c.name as class_name
      FROM attendance a
      JOIN classes c ON a.class_id = c.id
      WHERE a.student_id = ? AND a.topic != '' AND (a.status = 'present' OR a.status = 'late')
      ORDER BY a.date DESC
      LIMIT 20
    `).all(req.params.id);

    res.json({
      student,
      groups,
      attendance_summary: {
        ...attendanceSummary,
        attendance_rate: parseFloat(attendanceRate)
      },
      fee_summary: {
        class_fees: attendanceSummary.total_fees,
        additional_fees: totalAdditionalFees.total,
        grand_total: attendanceSummary.total_fees + totalAdditionalFees.total,
        by_class_type: feesByClassType
      },
      monthly_breakdown: monthlyData,
      assigned_classes: assignedClasses,
      recent_topics: recentTopics
    });
  } catch (error) {
    console.error('Error generating student report:', error);
    res.status(500).json({ error: 'Failed to generate student report' });
  }
});

// GET /api/reports/monthly/:year/:month - Monthly overview of all students
router.get('/monthly/:year/:month', (req, res) => {
  try {
    const db = getDb();
    const { year, month } = req.params;
    const monthStr = String(month).padStart(2, '0');
    const dateFrom = `${year}-${monthStr}-01`;
    const dateTo = `${year}-${monthStr}-31`;

    // Overall attendance stats for the month
    const overallAttendance = db.prepare(`
      SELECT
        COUNT(*) as total_records,
        SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present,
        SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent,
        SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late,
        COALESCE(SUM(fee_charged), 0) as total_class_fees,
        COUNT(DISTINCT student_id) as unique_students,
        COUNT(DISTINCT class_id) as unique_classes
      FROM attendance
      WHERE date >= ? AND date <= ?
    `).get(dateFrom, dateTo);

    const overallAttendanceRate = overallAttendance.total_records > 0
      ? (((overallAttendance.present + overallAttendance.late) / overallAttendance.total_records) * 100).toFixed(1)
      : 0;

    // Total additional fees for the month
    const totalAdditionalFees = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM additional_fees WHERE month = ? AND year = ?
    `).get(parseInt(month), parseInt(year));

    // Per-student breakdown
    const students = db.prepare("SELECT * FROM students WHERE status = 'active' ORDER BY name ASC").all();

    const studentReports = students.map(student => {
      const attendance = db.prepare(`
        SELECT
          COUNT(*) as total_classes,
          SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present,
          SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent,
          SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late,
          COALESCE(SUM(fee_charged), 0) as class_fees,
          COALESCE(SUM(duration_hours), 0) as total_hours
        FROM attendance
        WHERE student_id = ? AND date >= ? AND date <= ?
      `).get(student.id, dateFrom, dateTo);

      const addFees = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM additional_fees
        WHERE student_id = ? AND month = ? AND year = ?
      `).get(student.id, parseInt(month), parseInt(year));

      const rate = attendance.total_classes > 0
        ? parseFloat(((attendance.present + attendance.late) / attendance.total_classes * 100).toFixed(1))
        : 0;

      return {
        student_id: student.id,
        student_name: student.name,
        parent_name: student.parent_name,
        total_classes: attendance.total_classes,
        present: attendance.present,
        absent: attendance.absent,
        late: attendance.late,
        attendance_rate: rate,
        total_hours: attendance.total_hours,
        class_fees: attendance.class_fees,
        additional_fees: addFees.total,
        total_fees: attendance.class_fees + addFees.total
      };
    });

    // Fee breakdown by class type for the month
    const feesByType = db.prepare(`
      SELECT
        class_type,
        COUNT(*) as class_count,
        COALESCE(SUM(fee_charged), 0) as total_fee
      FROM attendance
      WHERE date >= ? AND date <= ? AND (status = 'present' OR status = 'late')
      GROUP BY class_type
    `).all(dateFrom, dateTo);

    res.json({
      year: parseInt(year),
      month: parseInt(month),
      overview: {
        ...overallAttendance,
        attendance_rate: parseFloat(overallAttendanceRate),
        total_additional_fees: totalAdditionalFees.total,
        grand_total_fees: overallAttendance.total_class_fees + totalAdditionalFees.total,
        fees_by_type: feesByType
      },
      students: studentReports
    });
  } catch (error) {
    console.error('Error generating monthly report:', error);
    res.status(500).json({ error: 'Failed to generate monthly report' });
  }
});

// GET /api/reports/overall - Overall dashboard data
router.get('/overall', (req, res) => {
  try {
    const db = getDb();

    // Student counts
    const studentCounts = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) as inactive
      FROM students
    `).get();

    // Group counts
    const groupCount = db.prepare('SELECT COUNT(*) as total FROM groups_table').get();

    // Class counts
    const classCounts = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN class_type = 'online' AND is_active = 1 THEN 1 ELSE 0 END) as online,
        SUM(CASE WHEN class_type = 'offline' AND is_active = 1 THEN 1 ELSE 0 END) as offline,
        SUM(CASE WHEN class_type = 'offline_group' AND is_active = 1 THEN 1 ELSE 0 END) as offline_group
      FROM classes
    `).get();

    // All-time attendance
    const allTimeAttendance = db.prepare(`
      SELECT
        COUNT(*) as total_records,
        SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present,
        SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent,
        SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late
      FROM attendance
    `).get();

    const overallAttendanceRate = allTimeAttendance.total_records > 0
      ? parseFloat(((allTimeAttendance.present + allTimeAttendance.late) / allTimeAttendance.total_records * 100).toFixed(1))
      : 0;

    // All-time fee totals
    const allTimeClassFees = db.prepare(`
      SELECT COALESCE(SUM(fee_charged), 0) as total FROM attendance
    `).get();

    const allTimeAdditionalFees = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM additional_fees
    `).get();

    // Monthly revenue trend (last 12 months)
    const monthlyRevenue = db.prepare(`
      SELECT
        strftime('%Y', date) as year,
        strftime('%m', date) as month,
        COALESCE(SUM(fee_charged), 0) as class_fees,
        COUNT(*) as total_records,
        SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present,
        SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent
      FROM attendance
      GROUP BY strftime('%Y', date), strftime('%m', date)
      ORDER BY year DESC, month DESC
      LIMIT 12
    `).all();

    // Add additional fees to monthly revenue
    const monthlyRevenueWithAdditional = monthlyRevenue.map(m => {
      const addFees = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM additional_fees
        WHERE month = ? AND year = ?
      `).get(parseInt(m.month), parseInt(m.year));

      return {
        ...m,
        additional_fees: addFees.total,
        total_revenue: m.class_fees + addFees.total
      };
    });

    // Top students by attendance rate (minimum 5 classes)
    const topStudentsByAttendance = db.prepare(`
      SELECT
        s.id, s.name,
        COUNT(*) as total_classes,
        SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) as present,
        SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) as late,
        ROUND(CAST(SUM(CASE WHEN a.status IN ('present', 'late') THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) * 100, 1) as attendance_rate
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      WHERE s.status = 'active'
      GROUP BY s.id
      HAVING total_classes >= 5
      ORDER BY attendance_rate DESC
      LIMIT 10
    `).all();

    res.json({
      students: studentCounts,
      groups: { total: groupCount.total },
      classes: classCounts,
      attendance: {
        ...allTimeAttendance,
        overall_rate: overallAttendanceRate
      },
      fees: {
        total_class_fees: allTimeClassFees.total,
        total_additional_fees: allTimeAdditionalFees.total,
        grand_total: allTimeClassFees.total + allTimeAdditionalFees.total
      },
      monthly_revenue: monthlyRevenueWithAdditional,
      top_students_by_attendance: topStudentsByAttendance
    });
  } catch (error) {
    console.error('Error generating overall report:', error);
    res.status(500).json({ error: 'Failed to generate overall report' });
  }
});

module.exports = router;
