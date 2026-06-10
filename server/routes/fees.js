const express = require('express');
const router = express.Router();
const { getDb } = require('../db/schema');
const { syncFeeCreate, syncFeeUpdate, syncFeeDelete } = require('../services/zohoSync');

// GET /api/fees/monthly/:year/:month - Monthly fee summary for all students
router.get('/monthly/:year/:month', (req, res) => {
  try {
    const db = getDb();
    const { year, month } = req.params;
    const monthStr = String(month).padStart(2, '0');
    const dateFrom = `${year}-${monthStr}-01`;
    const dateTo = `${year}-${monthStr}-31`;

    // Get all active students
    const students = db.prepare(
      "SELECT * FROM students WHERE status = 'active' ORDER BY name ASC"
    ).all();

    const summary = students.map(student => {
      // Class fees from attendance (present + late)
      const classFees = db.prepare(`
        SELECT
          COALESCE(SUM(fee_charged), 0) as total_class_fees,
          COUNT(*) as total_classes,
          SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present_count,
          SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent_count,
          SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late_count
        FROM attendance
        WHERE student_id = ? AND date >= ? AND date <= ?
      `).get(student.id, dateFrom, dateTo);

      // Breakdown by class type
      const classFeesByType = db.prepare(`
        SELECT
          class_type,
          COALESCE(SUM(fee_charged), 0) as fee_total,
          COUNT(*) as class_count,
          COALESCE(SUM(duration_hours), 0) as total_hours
        FROM attendance
        WHERE student_id = ? AND date >= ? AND date <= ? AND (status = 'present' OR status = 'late')
        GROUP BY class_type
      `).all(student.id, dateFrom, dateTo);

      // Additional fees
      const additionalFees = db.prepare(`
        SELECT * FROM additional_fees
        WHERE student_id = ? AND month = ? AND year = ?
        ORDER BY fee_date ASC
      `).all(student.id, parseInt(month), parseInt(year));

      const totalAdditionalFees = additionalFees.reduce((sum, f) => sum + f.amount, 0);

      return {
        student_id: student.id,
        student_name: student.name,
        parent_name: student.parent_name,
        mobile_number: student.mobile_number,
        class_fees: {
          total: classFees.total_class_fees,
          total_classes: classFees.total_classes,
          present: classFees.present_count,
          absent: classFees.absent_count,
          late: classFees.late_count,
          by_type: classFeesByType
        },
        additional_fees: {
          total: totalAdditionalFees,
          items: additionalFees
        },
        grand_total: classFees.total_class_fees + totalAdditionalFees
      };
    });

    // Overall totals
    const totalClassFees = summary.reduce((sum, s) => sum + s.class_fees.total, 0);
    const totalAdditionalFees = summary.reduce((sum, s) => sum + s.additional_fees.total, 0);

    res.json({
      year: parseInt(year),
      month: parseInt(month),
      students: summary,
      totals: {
        class_fees: totalClassFees,
        additional_fees: totalAdditionalFees,
        grand_total: totalClassFees + totalAdditionalFees
      }
    });
  } catch (error) {
    console.error('Error fetching monthly fees:', error);
    res.status(500).json({ error: 'Failed to fetch monthly fee summary' });
  }
});

// GET /api/fees/student/:studentId - Fee summary for a specific student
router.get('/student/:studentId', (req, res) => {
  try {
    const db = getDb();
    const { studentId } = req.params;
    const { year, month } = req.query;

    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    let dateFilter = '';
    const params = [parseInt(studentId)];

    if (year && month) {
      const monthStr = String(month).padStart(2, '0');
      dateFilter = ' AND date >= ? AND date <= ?';
      params.push(`${year}-${monthStr}-01`, `${year}-${monthStr}-31`);
    }

    // Class fees
    const classFees = db.prepare(`
      SELECT
        COALESCE(SUM(fee_charged), 0) as total,
        COUNT(*) as total_classes,
        SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present_count,
        SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent_count,
        SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late_count
      FROM attendance
      WHERE student_id = ?${dateFilter}
    `).get(...params);

    // Fee breakdown by class type
    const feesByType = db.prepare(`
      SELECT
        class_type,
        COALESCE(SUM(fee_charged), 0) as fee_total,
        COUNT(*) as class_count,
        COALESCE(SUM(duration_hours), 0) as total_hours
      FROM attendance
      WHERE student_id = ?${dateFilter} AND (status = 'present' OR status = 'late')
      GROUP BY class_type
    `).all(...params);

    // Additional fees
    let addFeeQuery = 'SELECT * FROM additional_fees WHERE student_id = ?';
    const addFeeParams = [parseInt(studentId)];
    if (year && month) {
      addFeeQuery += ' AND month = ? AND year = ?';
      addFeeParams.push(parseInt(month), parseInt(year));
    }
    addFeeQuery += ' ORDER BY fee_date DESC';
    const additionalFees = db.prepare(addFeeQuery).all(...addFeeParams);
    const totalAdditionalFees = additionalFees.reduce((sum, f) => sum + f.amount, 0);

    res.json({
      student,
      class_fees: {
        total: classFees.total,
        total_classes: classFees.total_classes,
        present: classFees.present_count,
        absent: classFees.absent_count,
        late: classFees.late_count,
        by_type: feesByType
      },
      additional_fees: {
        total: totalAdditionalFees,
        items: additionalFees
      },
      grand_total: classFees.total + totalAdditionalFees
    });
  } catch (error) {
    console.error('Error fetching student fees:', error);
    res.status(500).json({ error: 'Failed to fetch student fee summary' });
  }
});

// --- Additional Fees CRUD ---

// GET /api/fees/additional - Get all additional fees with optional filters
router.get('/additional', (req, res) => {
  try {
    const db = getDb();
    const { student_id, month, year } = req.query;

    let query = `
      SELECT af.*, s.name as student_name
      FROM additional_fees af
      JOIN students s ON af.student_id = s.id
      WHERE 1=1
    `;
    const params = [];

    if (student_id) {
      query += ' AND af.student_id = ?';
      params.push(parseInt(student_id));
    }

    if (month) {
      query += ' AND af.month = ?';
      params.push(parseInt(month));
    }

    if (year) {
      query += ' AND af.year = ?';
      params.push(parseInt(year));
    }

    query += ' ORDER BY af.fee_date DESC';

    const fees = db.prepare(query).all(...params);
    res.json({ additional_fees: fees });
  } catch (error) {
    console.error('Error fetching additional fees:', error);
    res.status(500).json({ error: 'Failed to fetch additional fees' });
  }
});

// GET /api/fees/additional/:id - Get a single additional fee
router.get('/additional/:id', (req, res) => {
  try {
    const db = getDb();
    const fee = db.prepare(`
      SELECT af.*, s.name as student_name
      FROM additional_fees af
      JOIN students s ON af.student_id = s.id
      WHERE af.id = ?
    `).get(req.params.id);

    if (!fee) {
      return res.status(404).json({ error: 'Additional fee not found' });
    }

    res.json({ additional_fee: fee });
  } catch (error) {
    console.error('Error fetching additional fee:', error);
    res.status(500).json({ error: 'Failed to fetch additional fee' });
  }
});

// POST /api/fees/additional - Create additional fee(s) for one or multiple students
router.post('/additional', (req, res) => {
  try {
    const db = getDb();
    const { student_id, student_ids, description, amount, fee_date, month, year } = req.body;

    // Support both single student_id and array of student_ids
    const ids = student_ids && Array.isArray(student_ids) ? student_ids : student_id ? [student_id] : [];

    if (ids.length === 0 || !description || amount === undefined || !fee_date || !month || !year) {
      return res.status(400).json({
        error: 'student_id (or student_ids[]), description, amount, fee_date, month, and year are required'
      });
    }

    const insertStmt = db.prepare(`
      INSERT INTO additional_fees (student_id, description, amount, fee_date, month, year)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const created = [];
    const errors = [];

    const bulkInsert = db.transaction(() => {
      for (const sid of ids) {
        const student = db.prepare('SELECT * FROM students WHERE id = ?').get(sid);
        if (!student) {
          errors.push({ student_id: sid, error: 'Student not found' });
          continue;
        }
        const result = insertStmt.run(sid, description, amount, fee_date, parseInt(month), parseInt(year));
        const fee = db.prepare('SELECT * FROM additional_fees WHERE id = ?').get(result.lastInsertRowid);
        syncFeeCreate(fee);
        created.push(fee);
      }
    });

    bulkInsert();

    if (ids.length === 1 && created.length === 1) {
      return res.status(201).json({ additional_fee: created[0] });
    }

    res.status(201).json({
      message: `Created ${created.length} additional fee(s)`,
      additional_fees: created,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Error creating additional fee:', error);
    res.status(500).json({ error: 'Failed to create additional fee' });
  }
});

// PUT /api/fees/additional/:id - Update an additional fee
router.put('/additional/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM additional_fees WHERE id = ?').get(req.params.id);

    if (!existing) {
      return res.status(404).json({ error: 'Additional fee not found' });
    }

    const { student_id, description, amount, fee_date, month, year } = req.body;

    db.prepare(`
      UPDATE additional_fees SET
        student_id = ?, description = ?, amount = ?, fee_date = ?, month = ?, year = ?
      WHERE id = ?
    `).run(
      student_id ?? existing.student_id,
      description ?? existing.description,
      amount ?? existing.amount,
      fee_date ?? existing.fee_date,
      month ?? existing.month,
      year ?? existing.year,
      req.params.id
    );

    const fee = db.prepare('SELECT * FROM additional_fees WHERE id = ?').get(req.params.id);
    syncFeeUpdate(fee);
    res.json({ additional_fee: fee });
  } catch (error) {
    console.error('Error updating additional fee:', error);
    res.status(500).json({ error: 'Failed to update additional fee' });
  }
});

// DELETE /api/fees/additional/:id - Delete an additional fee
router.delete('/additional/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM additional_fees WHERE id = ?').get(req.params.id);

    if (!existing) {
      return res.status(404).json({ error: 'Additional fee not found' });
    }

    db.prepare('DELETE FROM additional_fees WHERE id = ?').run(req.params.id);
    syncFeeDelete(req.params.id);
    res.json({ message: 'Additional fee deleted successfully' });
  } catch (error) {
    console.error('Error deleting additional fee:', error);
    res.status(500).json({ error: 'Failed to delete additional fee' });
  }
});

module.exports = router;
