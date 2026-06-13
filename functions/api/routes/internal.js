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
const { zcql, unwrap, normalize } = require('../db/catalystDb');

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
// On the actual last day of the month (IST), iterates over every active
// Organization and runs the fee-reminder generator for each. Each org's
// own AppSettings (school name + signature) flow through automatically.
router.post('/cron-fee-reminder', async (req, res) => {
  try {
    const now = new Date();
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

    // Loop every active org.
    let orgs = [];
    try {
      const orgRows = await zcql(req, `SELECT * FROM Organizations WHERE Organizations.status = 'active'`);
      orgs = unwrap(orgRows, 'Organizations').map(normalize);
    } catch (e) {
      return res.status(503).json({ error: 'Organizations table missing', detail: e.message });
    }

    const summary = [];
    for (const org of orgs) {
      try {
        // generateFeeReminders sets req.orgId internally from the orgId arg.
        const r = await generateFeeReminders(req, { month, year, orgId: Number(org.id) });
        summary.push({ org_id: org.id, org_name: org.name, ok: true, created: r.created });
      } catch (e) {
        summary.push({ org_id: org.id, org_name: org.name, ok: false, error: e.message });
      }
    }
    res.json({ skipped: false, month, year, orgs_processed: summary.length, summary });
  } catch (e) {
    res.status(500).json({ error: 'Cron fee-reminder failed', detail: e.message });
  }
});

module.exports = router;
