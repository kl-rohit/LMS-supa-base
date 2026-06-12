// /api/internal/* — unattended endpoints called by Catalyst Job Scheduling.
//
// These bypass the App Administrator auth that protects /api/* because
// scheduled jobs can't log in. Instead they're protected by a shared secret
// header (X-Cron-Secret). The secret lives in catalyst-config.json under
// env_variables.CRON_SECRET and is also configured in the cron's Webhook
// target header in the Catalyst console.
//
// IMPORTANT: this router is mounted BEFORE requireAuth in index.js. Don't
// add routes here that mutate sensitive data unless they validate the
// secret first.

const router = require('express').Router();
const { generateFeeReminders } = require('../lib/feeReminder');

// Shared-secret middleware. Returns 401 unless the X-Cron-Secret header
// matches the CRON_SECRET env var. If CRON_SECRET is unset (e.g. local
// dev before the env var is wired up), every request is rejected — fail
// closed.
function requireCronSecret(req, res, next) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return res.status(503).json({ error: 'CRON_SECRET not configured on server' });
  }
  const got = req.header('x-cron-secret') || req.header('X-Cron-Secret');
  if (!got || got !== expected) {
    return res.status(401).json({ error: 'Invalid or missing X-Cron-Secret' });
  }
  return next();
}

router.use(requireCronSecret);

// Returns true when `date` is the last calendar day of its month.
// Used by the monthly-cron to early-return on days 28-30 (so the cron
// can be scheduled to fire daily across 28-31 without needing fancy
// "last day of month" expressions, which standard 5-field cron doesn't
// support directly).
function isLastDayOfMonth(date) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + 1);
  return next.getMonth() !== date.getMonth();
}

// POST /api/internal/cron-fee-reminder
// Called daily on days 28-31 by the Catalyst Job Scheduling cron.
// No-ops unless today is the actual last day of the month, then runs the
// shared fee-reminder generator for the current month/year.
router.post('/cron-fee-reminder', async (req, res) => {
  try {
    const now = new Date();
    // Cron is scheduled in IST (Asia/Kolkata) — the function runs in UTC
    // so we explicitly convert to compare last-day-of-month against IST.
    // IST = UTC + 5:30, so add 5.5 hours' worth of ms to UTC.
    const ist = new Date(now.getTime() + (5 * 60 + 30) * 60 * 1000);
    if (!isLastDayOfMonth(ist)) {
      return res.json({
        skipped: true,
        reason: 'Not the last day of the month',
        ist_date: ist.toISOString().slice(0, 10),
      });
    }
    const month = ist.getMonth() + 1;
    const year = ist.getFullYear();
    const result = await generateFeeReminders(req, { month, year });
    res.json({ skipped: false, ...result });
  } catch (e) {
    res.status(500).json({ error: 'Cron fee-reminder failed', detail: e.message });
  }
});

module.exports = router;
