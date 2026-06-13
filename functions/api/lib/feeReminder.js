// Shared fee-reminder generator. Called by:
//   • POST /api/messages/generate-fee-reminder       (admin, manual)
//   • POST /api/internal/cron-fee-reminder           (monthly cron)
//
// Generates one draft Messages row per active student with a positive
// monthly total (class fees + additional fees − discount). The template
// body comes from MessageTemplates (with hard-coded fallback).

const { insert, zcql, unwrap, q } = require('../db/catalystDb');
const { loadTemplates, DEFAULT_TEMPLATES, loadAppSettings } = require('../routes/settings');

// Build the {school} + {signature} ctx pieces from AppSettings, falling
// back to the same hard-coded values the templates used pre-Settings
// module so a never-configured install still produces correct messages.
async function loadSchoolCtx(req) {
  try {
    const s = await loadAppSettings(req);
    return {
      school:    s['school.name']      || 'Veena Dhwani Academy',
      signature: s['school.signature'] || s['school.name'] || 'Veena Dhwani Academy',
    };
  } catch {
    return { school: 'Veena Dhwani Academy', signature: 'Veena Dhwani Academy' };
  }
}

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

// Replace {placeholder} tokens. Mirror of the helper in messages.js — they
// must stay identical so manual + cron generate the same wording.
function substituteTemplate(text, ctx) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/\{(\w+)\}/g, (match, key) =>
    (ctx && Object.prototype.hasOwnProperty.call(ctx, key) && ctx[key] !== undefined && ctx[key] !== null)
      ? String(ctx[key])
      : match
  );
}

function pickTemplate(templates, type) {
  return (templates && templates[type]) || DEFAULT_TEMPLATES[type] || '';
}

// Strip the "Class fees / Additional" bullet lines when additional_fees is 0
// — matches the pre-templates behaviour.
function applyFeeReminderConditionalBlock(text, additionalFees) {
  if (Number(additionalFees) > 0) return text;
  return text
    .split('\n')
    .filter((ln) => {
      const t = ln.trim();
      return !(t.startsWith('• Class fees:') || t.startsWith('• Additional:'));
    })
    .join('\n');
}

/**
 * Generate fee-reminder drafts for the given month/year.
 * @param {Object} req  — Express request (used for Catalyst SDK init)
 * @param {Object} opts — { month: 1-12, year: 4-digit }
 * @returns {Object} { created, reminders[], month, year, month_name }
 */
async function generateFeeReminders(req, { month, year }) {
  const monthStr = String(month).padStart(2, '0');
  const dateFrom = `${year}-${monthStr}-01`;
  const dateTo   = `${year}-${monthStr}-31`;
  const monthName = MONTH_NAMES[month - 1];

  const [templates, schoolCtx] = await Promise.all([
    loadTemplates(req).catch(() => DEFAULT_TEMPLATES),
    loadSchoolCtx(req),
  ]);

  const studentRows = await zcql(req, `SELECT * FROM Students WHERE Students.status = 'active'`);
  const students = unwrap(studentRows, 'Students');
  const reminders = [];

  for (const s of students) {
    try {
      // Sum class fees for the month
      const aRows = await zcql(
        req,
        `SELECT * FROM Attendance WHERE Attendance.student_id = ${s.ROWID} AND Attendance.class_date >= ${q(dateFrom)} AND Attendance.class_date <= ${q(dateTo)}`
      );
      const attendance = unwrap(aRows, 'Attendance');
      const classFees = attendance.reduce((sum, a) => sum + (Number(a.fee_charged) || 0), 0);
      const classesAttended = attendance.filter((a) => a.status === 'present' || a.status === 'late').length;

      // Sum additional fees + discount for the month
      const afRows = await zcql(
        req,
        `SELECT * FROM AdditionalFees WHERE AdditionalFees.student_id = ${s.ROWID} AND AdditionalFees.fee_month = ${month} AND AdditionalFees.fee_year = ${year}`
      );
      const additional = unwrap(afRows, 'AdditionalFees');
      const positiveAdditional = additional.reduce(
        (sum, a) => sum + Math.max(0, Number(a.amount) || 0), 0);
      const discountTotal = additional.reduce(
        (sum, a) => sum + Math.min(0, Number(a.amount) || 0), 0);
      const additionalTotal = positiveAdditional + discountTotal;
      const total = classFees + additionalTotal;

      if (total > 0) {
        const positiveAdditionalRounded = positiveAdditional.toFixed(0);
        let text = substituteTemplate(pickTemplate(templates, 'fee_reminder'), {
          name: s.name,
          parent: s.parent_name,
          amount: total.toFixed(0),
          class_fees: classFees.toFixed(0),
          // Discount is internal — only positive additional fees go to the parent.
          additional_fees: positiveAdditionalRounded,
          month: monthName,
          year,
          ...schoolCtx,
        });
        text = applyFeeReminderConditionalBlock(text, positiveAdditionalRounded);

        const inserted = await insert(req, 'Messages', {
          student_id: String(s.ROWID),
          parent_name: s.parent_name || '',
          mobile_number: s.mobile_number || '',
          message: text,
          message_type: 'fee_reminder',
          is_sent: 0,
        });
        reminders.push({
          student_id: s.ROWID,
          student_name: s.name,
          classes_attended: classesAttended,
          class_fees: classFees,
          additional_fees: additionalTotal,
          total,
          message_id: inserted?.ROWID,
        });
      }
    } catch (err) {
      console.error('fee reminder for student failed', s.ROWID, err.message);
    }
  }

  return {
    created: reminders.length,
    reminders,
    month,
    year,
    month_name: monthName,
  };
}

module.exports = {
  generateFeeReminders,
  substituteTemplate,
  pickTemplate,
  applyFeeReminderConditionalBlock,
};
