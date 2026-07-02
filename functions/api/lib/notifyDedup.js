// lib/notifyDedup.js — shared idempotency helpers for any notification that
// might get generated more than once for the same event (a Catalyst cron
// retry, or the same event fired from two different routes — e.g. the fee
// reminder cron and the admin's manual "Generate Fee Reminders" button both
// call generateFeeReminders, and both must be able to notify without ever
// double-notifying). Give the notification a stable, event-scoped `link`
// (e.g. a date or month stamped into it) and use these two helpers around it.
//
// Originally lived inline in routes/internal.js (the morning class digest);
// pulled out so routes/lib/feeReminder.js can share the same de-dup logic.

const { zcqlAll, unwrap, remove } = require('../db/catalystDb');

// True if at least one Notifications row matches the given WHERE clause.
// Best-effort — on any error we report "not sent" so the caller still sends
// rather than being silently suppressed.
async function alreadySent(req, whereClause) {
  try {
    const rows = await zcqlAll(
      req,
      `SELECT ROWID FROM Notifications WHERE ${whereClause} LIMIT 1`,
      'Notifications'
    );
    return unwrap(rows, 'Notifications').length > 0;
  } catch {
    return false;
  }
}

// Keeps only the earliest Notifications row matching the WHERE clause,
// deleting any later duplicates (e.g. from two near-simultaneous triggers of
// the same event). Returns the surviving row's ROWID (as a string), or null
// on error — callers use this to decide whether THEY were the row that
// survived before sending a push, so only one trigger ever pushes.
async function pruneDuplicateDigests(req, whereClause) {
  try {
    const rows = await zcqlAll(
      req,
      `SELECT ROWID FROM Notifications WHERE ${whereClause} ORDER BY Notifications.ROWID ASC`,
      'Notifications'
    );
    const ids = unwrap(rows, 'Notifications').map((r) => r.ROWID).filter(Boolean);
    for (const id of ids.slice(1)) {
      await remove(req, 'Notifications', id).catch(() => {});
    }
    return ids.length ? String(ids[0]) : null;
  } catch {
    return null; // best-effort — caller skips push on null
  }
}

module.exports = { alreadySent, pruneDuplicateDigests };
