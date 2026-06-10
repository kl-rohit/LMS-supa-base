const express = require('express');
const router = express.Router();
const { getDb } = require('../db/schema');
const { syncMessageCreate, syncMessageUpdate, syncMessageDelete, syncMessageBulkCreate } = require('../services/zohoSync');

// GET /api/messages - Get all messages with optional filters
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const { student_id, message_type, is_sent, page, limit } = req.query;

    let query = `
      SELECT m.*, s.name as student_name
      FROM messages m
      LEFT JOIN students s ON m.student_id = s.id
      WHERE 1=1
    `;
    const params = [];

    if (student_id) {
      query += ' AND m.student_id = ?';
      params.push(parseInt(student_id));
    }

    if (message_type) {
      query += ' AND m.message_type = ?';
      params.push(message_type);
    }

    if (is_sent !== undefined) {
      query += ' AND m.is_sent = ?';
      params.push(parseInt(is_sent));
    }

    query += ' ORDER BY m.created_at DESC';

    // Pagination
    if (limit) {
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit);
      const offset = (pageNum - 1) * limitNum;

      const countQuery = query.replace(
        /SELECT m\.\*, s\.name as student_name/,
        'SELECT COUNT(*) as total'
      );
      const { total } = db.prepare(countQuery).get(...params);

      query += ' LIMIT ? OFFSET ?';
      params.push(limitNum, offset);

      const messages = db.prepare(query).all(...params);
      return res.json({
        messages,
        pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) }
      });
    }

    const messages = db.prepare(query).all(...params);
    res.json({ messages });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// GET /api/messages/:id - Get a single message
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const message = db.prepare(`
      SELECT m.*, s.name as student_name
      FROM messages m
      LEFT JOIN students s ON m.student_id = s.id
      WHERE m.id = ?
    `).get(req.params.id);

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json({ message });
  } catch (error) {
    console.error('Error fetching message:', error);
    res.status(500).json({ error: 'Failed to fetch message' });
  }
});

// POST /api/messages - Create a message
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const { student_id, parent_name, mobile_number, message, message_type, is_sent } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    // If student_id provided, auto-fill parent details
    let finalParentName = parent_name;
    let finalMobileNumber = mobile_number;

    if (student_id) {
      const student = db.prepare('SELECT * FROM students WHERE id = ?').get(student_id);
      if (!student) {
        return res.status(404).json({ error: 'Student not found' });
      }
      finalParentName = finalParentName || student.parent_name;
      finalMobileNumber = finalMobileNumber || student.mobile_number;
    }

    const result = db.prepare(`
      INSERT INTO messages (student_id, parent_name, mobile_number, message, message_type, is_sent)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      student_id || null,
      finalParentName || null,
      finalMobileNumber || null,
      message,
      message_type || 'custom',
      is_sent ? 1 : 0
    );

    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid);
    syncMessageCreate(msg);
    res.status(201).json({ message: msg });
  } catch (error) {
    console.error('Error creating message:', error);
    res.status(500).json({ error: 'Failed to create message' });
  }
});

// PUT /api/messages/:id - Update a message (e.g., mark as sent)
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);

    if (!existing) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const { parent_name, mobile_number, message, message_type, is_sent } = req.body;

    db.prepare(`
      UPDATE messages SET parent_name = ?, mobile_number = ?, message = ?, message_type = ?, is_sent = ?
      WHERE id = ?
    `).run(
      parent_name ?? existing.parent_name,
      mobile_number ?? existing.mobile_number,
      message ?? existing.message,
      message_type ?? existing.message_type,
      is_sent !== undefined ? (is_sent ? 1 : 0) : existing.is_sent,
      req.params.id
    );

    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
    syncMessageUpdate(msg);
    res.json({ message: msg });
  } catch (error) {
    console.error('Error updating message:', error);
    res.status(500).json({ error: 'Failed to update message' });
  }
});

// DELETE /api/messages/:id - Delete a message
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);

    if (!existing) {
      return res.status(404).json({ error: 'Message not found' });
    }

    db.prepare('DELETE FROM messages WHERE id = ?').run(req.params.id);
    syncMessageDelete(req.params.id);
    res.json({ message: 'Message deleted successfully' });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// POST /api/messages/generate-absence-alert - Generate absence alert messages
router.post('/generate-absence-alert', (req, res) => {
  try {
    const db = getDb();
    const threshold = parseInt(req.body.threshold) || 3;

    // Find students with consecutive absences >= threshold
    const students = db.prepare("SELECT * FROM students WHERE status = 'active'").all();
    const generatedMessages = [];

    const insertMsg = db.prepare(`
      INSERT INTO messages (student_id, parent_name, mobile_number, message, message_type, is_sent)
      VALUES (?, ?, ?, ?, ?, 0)
    `);

    const generateAlerts = db.transaction(() => {
      for (const student of students) {
        // Get student's classes (both direct and via groups)
        const studentClasses = db.prepare(`
          SELECT DISTINCT c.id, c.name
          FROM classes c
          LEFT JOIN group_students gs ON c.group_id = gs.group_id
          WHERE c.is_active = 1 AND (c.student_id = ? OR gs.student_id = ?)
        `).all(student.id, student.id);

        for (const cls of studentClasses) {
          const recentAttendance = db.prepare(`
            SELECT status, date FROM attendance
            WHERE student_id = ? AND class_id = ?
            ORDER BY date DESC
            LIMIT ?
          `).all(student.id, cls.id, threshold + 5);

          let consecutiveAbsences = 0;
          for (const record of recentAttendance) {
            if (record.status === 'absent') {
              consecutiveAbsences++;
            } else {
              break;
            }
          }

          if (consecutiveAbsences >= threshold) {
            const messageText = `Dear ${student.parent_name},\n\n` +
              `This is to inform you that your ward ${student.name} has been absent for ${consecutiveAbsences} consecutive classes in "${cls.name}". ` +
              `Regular attendance is important for maintaining progress in music education.\n\n` +
              `Please let us know if there are any concerns or if you would like to discuss the class schedule.\n\n` +
              `Thank you,\nVeena Music Academy`;

            const result = insertMsg.run(
              student.id,
              student.parent_name,
              student.mobile_number,
              messageText,
              'absence_alert'
            );

            generatedMessages.push({
              id: result.lastInsertRowid,
              student_id: student.id,
              student_name: student.name,
              parent_name: student.parent_name,
              mobile_number: student.mobile_number,
              class_name: cls.name,
              consecutive_absences: consecutiveAbsences,
              message: messageText
            });
          }
        }
      }
    });

    generateAlerts();

    syncMessageBulkCreate(generatedMessages);
    res.status(201).json({
      message: `Generated ${generatedMessages.length} absence alert(s)`,
      alerts: generatedMessages
    });
  } catch (error) {
    console.error('Error generating absence alerts:', error);
    res.status(500).json({ error: 'Failed to generate absence alerts' });
  }
});

// POST /api/messages/generate-fee-reminder - Generate fee reminder messages
router.post('/generate-fee-reminder', (req, res) => {
  try {
    const db = getDb();
    const { year, month } = req.body;

    if (!year || !month) {
      return res.status(400).json({ error: 'year and month are required' });
    }

    const monthStr = String(month).padStart(2, '0');
    const dateFrom = `${year}-${monthStr}-01`;
    const dateTo = `${year}-${monthStr}-31`;

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthName = monthNames[parseInt(month) - 1] || 'Unknown';

    const students = db.prepare("SELECT * FROM students WHERE status = 'active'").all();
    const generatedMessages = [];

    const insertMsg = db.prepare(`
      INSERT INTO messages (student_id, parent_name, mobile_number, message, message_type, is_sent)
      VALUES (?, ?, ?, ?, ?, 0)
    `);

    const generateReminders = db.transaction(() => {
      for (const student of students) {
        // Calculate class fees for the month
        const classFees = db.prepare(`
          SELECT COALESCE(SUM(fee_charged), 0) as total
          FROM attendance
          WHERE student_id = ? AND date >= ? AND date <= ?
        `).get(student.id, dateFrom, dateTo);

        // Calculate additional fees for the month
        const additionalFees = db.prepare(`
          SELECT COALESCE(SUM(amount), 0) as total
          FROM additional_fees
          WHERE student_id = ? AND month = ? AND year = ?
        `).get(student.id, parseInt(month), parseInt(year));

        const totalFee = classFees.total + additionalFees.total;

        if (totalFee > 0) {
          // Get class-wise breakdown
          const breakdown = db.prepare(`
            SELECT class_type, COUNT(*) as classes, COALESCE(SUM(fee_charged), 0) as fee
            FROM attendance
            WHERE student_id = ? AND date >= ? AND date <= ? AND (status = 'present' OR status = 'late')
            GROUP BY class_type
          `).all(student.id, dateFrom, dateTo);

          let breakdownText = '';
          for (const item of breakdown) {
            const typeLabel = item.class_type === 'online' ? 'Online' :
              item.class_type === 'offline' ? 'Offline (Individual)' : 'Offline (Group)';
            breakdownText += `  - ${typeLabel}: ${item.classes} class(es) = Rs. ${item.fee.toFixed(2)}\n`;
          }

          if (additionalFees.total > 0) {
            breakdownText += `  - Additional charges: Rs. ${additionalFees.total.toFixed(2)}\n`;
          }

          const messageText = `Dear ${student.parent_name},\n\n` +
            `This is the fee summary for ${student.name} for ${monthName} ${year}:\n\n` +
            `${breakdownText}\n` +
            `Total Amount Due: Rs. ${totalFee.toFixed(2)}\n\n` +
            `Please arrange for the payment at your earliest convenience.\n\n` +
            `Thank you,\nVeena Music Academy`;

          const result = insertMsg.run(
            student.id,
            student.parent_name,
            student.mobile_number,
            messageText,
            'fee_reminder'
          );

          generatedMessages.push({
            id: result.lastInsertRowid,
            student_id: student.id,
            student_name: student.name,
            parent_name: student.parent_name,
            mobile_number: student.mobile_number,
            total_fee: totalFee,
            message: messageText
          });
        }
      }
    });

    generateReminders();

    syncMessageBulkCreate(generatedMessages);
    res.status(201).json({
      message: `Generated ${generatedMessages.length} fee reminder(s) for ${monthName} ${year}`,
      reminders: generatedMessages
    });
  } catch (error) {
    console.error('Error generating fee reminders:', error);
    res.status(500).json({ error: 'Failed to generate fee reminders' });
  }
});

module.exports = router;
