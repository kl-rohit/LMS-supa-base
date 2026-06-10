const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db/schema');
const { syncAttendanceBulkCreate } = require('../services/zohoSync');

// Configure multer for CSV file uploads
const uploadDir = path.join(__dirname, '..', 'data', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.csv') {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

/**
 * Parse a CSV string into an array of objects.
 * Handles quoted fields with commas and newlines.
 */
function parseCSV(csvText) {
  const lines = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];

    if (char === '"') {
      if (inQuotes && i + 1 < csvText.length && csvText[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((char === '\n' || (char === '\r' && csvText[i + 1] === '\n')) && !inQuotes) {
      lines.push(current);
      current = '';
      if (char === '\r') i++; // skip \n in \r\n
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    lines.push(current);
  }

  if (lines.length < 2) {
    return [];
  }

  const headers = parseCSVLine(lines[0]);
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0 || (values.length === 1 && values[0] === '')) continue;

    const record = {};
    headers.forEach((header, index) => {
      record[header.trim().toLowerCase().replace(/\s+/g, '_')] = values[index] !== undefined ? values[index].trim() : '';
    });
    records.push(record);
  }

  return records;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// POST /api/import/students - Bulk import students (JSON body or CSV file)
router.post('/students', upload.single('file'), (req, res) => {
  try {
    const db = getDb();
    let records = [];

    // If a file was uploaded, parse CSV
    if (req.file) {
      const csvContent = fs.readFileSync(req.file.path, 'utf-8');
      records = parseCSV(csvContent);

      // Clean up uploaded file
      fs.unlinkSync(req.file.path);

      if (records.length === 0) {
        return res.status(400).json({ error: 'CSV file is empty or has invalid format' });
      }
    } else if (req.body && Array.isArray(req.body.students)) {
      records = req.body.students;
    } else if (req.body && Array.isArray(req.body)) {
      records = req.body;
    } else {
      return res.status(400).json({
        error: 'Provide a CSV file (field name: "file") or JSON body with "students" array'
      });
    }

    const insertStmt = db.prepare(`
      INSERT INTO students (name, parent_name, mobile_number, fee_online, fee_offline, fee_offline_group, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const imported = [];
    const errors = [];

    const bulkImport = db.transaction(() => {
      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        const rowNum = i + 1;

        // Normalize field names (CSV headers may vary)
        const name = record.name || record.student_name || '';
        const parent_name = record.parent_name || record.parentname || record.parent || '';
        const mobile_number = record.mobile_number || record.mobile || record.phone || record.mobilenumber || '';

        if (!name || !parent_name || !mobile_number) {
          errors.push({
            row: rowNum,
            data: record,
            error: 'name, parent_name, and mobile_number are required'
          });
          continue;
        }

        try {
          const result = insertStmt.run(
            name,
            parent_name,
            mobile_number,
            parseFloat(record.fee_online || record.feeonline || 0) || 0,
            parseFloat(record.fee_offline || record.feeoffline || 0) || 0,
            parseFloat(record.fee_offline_group || record.feeofflinegroup || record.fee_group || 0) || 0,
            record.status || 'active',
            record.notes || ''
          );

          imported.push({
            row: rowNum,
            id: result.lastInsertRowid,
            name
          });
        } catch (err) {
          errors.push({
            row: rowNum,
            data: record,
            error: err.message
          });
        }
      }
    });

    bulkImport();

    res.status(201).json({
      message: `Imported ${imported.length} student(s) successfully`,
      total_processed: records.length,
      imported_count: imported.length,
      error_count: errors.length,
      imported,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    // Clean up file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Error importing students:', error);
    res.status(500).json({ error: 'Failed to import students' });
  }
});

// POST /api/import/attendance - Bulk import attendance records (JSON body or CSV file)
router.post('/attendance', upload.single('file'), (req, res) => {
  try {
    const db = getDb();
    let records = [];

    // If a file was uploaded, parse CSV
    if (req.file) {
      const csvContent = fs.readFileSync(req.file.path, 'utf-8');
      records = parseCSV(csvContent);

      // Clean up uploaded file
      fs.unlinkSync(req.file.path);

      if (records.length === 0) {
        return res.status(400).json({ error: 'CSV file is empty or has invalid format' });
      }
    } else if (req.body && Array.isArray(req.body.attendance)) {
      records = req.body.attendance;
    } else if (req.body && Array.isArray(req.body)) {
      records = req.body;
    } else {
      return res.status(400).json({
        error: 'Provide a CSV file (field name: "file") or JSON body with "attendance" array'
      });
    }

    const insertStmt = db.prepare(`
      INSERT INTO attendance (student_id, class_id, date, status, class_type, duration_hours, fee_charged, topic, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const imported = [];
    const errors = [];

    const bulkImport = db.transaction(() => {
      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        const rowNum = i + 1;

        const student_id = parseInt(record.student_id || record.studentid || 0);
        const class_id = parseInt(record.class_id || record.classid || 0);
        const date = record.date || '';
        const status = record.status || '';

        if (!student_id || !class_id || !date || !status) {
          errors.push({
            row: rowNum,
            data: record,
            error: 'student_id, class_id, date, and status are required'
          });
          continue;
        }

        if (!['present', 'absent', 'late'].includes(status)) {
          errors.push({
            row: rowNum,
            data: record,
            error: 'status must be present, absent, or late'
          });
          continue;
        }

        // Verify student exists
        const student = db.prepare('SELECT * FROM students WHERE id = ?').get(student_id);
        if (!student) {
          errors.push({ row: rowNum, data: record, error: `Student ID ${student_id} not found` });
          continue;
        }

        // Verify class exists
        const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(class_id);
        if (!cls) {
          errors.push({ row: rowNum, data: record, error: `Class ID ${class_id} not found` });
          continue;
        }

        // Check for duplicates
        const existing = db.prepare(
          'SELECT id FROM attendance WHERE student_id = ? AND class_id = ? AND date = ?'
        ).get(student_id, class_id, date);

        if (existing) {
          errors.push({
            row: rowNum,
            data: record,
            error: 'Duplicate attendance record exists'
          });
          continue;
        }

        // Calculate fee if not provided
        let fee_charged = parseFloat(record.fee_charged || record.feecharged || 0) || 0;
        const class_type = record.class_type || record.classtype || cls.class_type;
        const duration_hours = parseFloat(record.duration_hours || record.durationhours || cls.duration_hours || 1);

        if (fee_charged === 0 && (status === 'present' || status === 'late')) {
          let feePerHour = 0;
          switch (class_type) {
            case 'online': feePerHour = student.fee_online || 0; break;
            case 'offline': feePerHour = student.fee_offline || 0; break;
            case 'offline_group': case 'online_group': feePerHour = student.fee_offline_group || 0; break;
          }
          fee_charged = feePerHour * duration_hours;
        }

        try {
          const result = insertStmt.run(
            student_id,
            class_id,
            date,
            status,
            class_type,
            duration_hours,
            fee_charged,
            record.topic || '',
            record.notes || ''
          );

          imported.push({
            row: rowNum,
            id: result.lastInsertRowid,
            student_id,
            class_id,
            date,
            status
          });
        } catch (err) {
          errors.push({
            row: rowNum,
            data: record,
            error: err.message
          });
        }
      }
    });

    bulkImport();
    syncAttendanceBulkCreate(imported);

    res.status(201).json({
      message: `Imported ${imported.length} attendance record(s) successfully`,
      total_processed: records.length,
      imported_count: imported.length,
      error_count: errors.length,
      imported,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    // Clean up file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Error importing attendance:', error);
    res.status(500).json({ error: 'Failed to import attendance records' });
  }
});

module.exports = router;
