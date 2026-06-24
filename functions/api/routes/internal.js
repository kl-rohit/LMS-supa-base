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
const { zcql, zcqlAll, unwrap, normalize, insert } = require('../db/catalystDb');
const { createNotifications, createAdminNotifications } = require('../lib/notify');

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
async function feeReminderHandler(req, res) {
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
}

router.get('/cron-fee-reminder', feeReminderHandler);
router.post('/cron-fee-reminder', feeReminderHandler);

// ---------- Class reminders ----------
// POST /api/internal/cron-class-reminder
// Schedule this to run every 15 minutes. For each active org it finds classes
// whose start time (IST) falls in the band [lead, lead+window) minutes from
// now and notifies that class's roster. The cron cadence == `window` so each
// class occurrence crosses the band exactly once (no duplicate reminders).
//   Query params (optional): lead (default 30), window (default 15).

function timeToMinInternal(t) {
  if (!t || typeof t !== 'string') return null;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// Resolve every student in a class (direct, group, or roster link), org-scoped.
async function classRoster(req, orgId, cls) {
  const ids = new Set();
  if (cls.student_id) ids.add(String(cls.student_id));
  if (cls.group_id) {
    try {
      const rows = await zcqlAll(
        req,
        `SELECT student_id FROM GroupStudents WHERE GroupStudents.group_id = ${Number(cls.group_id)} AND GroupStudents.org_id = ${Number(orgId)}`,
        'GroupStudents'
      );
      for (const r of unwrap(rows, 'GroupStudents')) if (r.student_id) ids.add(String(r.student_id));
    } catch { /* ignore */ }
  }
  try {
    const rows = await zcqlAll(
      req,
      `SELECT student_id FROM ClassStudents WHERE ClassStudents.class_id = ${Number(cls.ROWID)} AND ClassStudents.org_id = ${Number(orgId)}`,
      'ClassStudents'
    );
    for (const r of unwrap(rows, 'ClassStudents')) if (r.student_id) ids.add(String(r.student_id));
  } catch { /* ignore */ }
  return [...ids];
}

async function classReminderHandler(req, res) {
  try {
    const lead = Number(req.query.lead) || 30;
    const windowMin = Number(req.query.window) || 15;

    const now = new Date();
    const ist = new Date(now.getTime() + (5 * 60 + 30) * 60 * 1000);
    const dow = ist.getUTCDay();
    const nowMin = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const bandStart = nowMin + lead;
    const bandEnd = nowMin + lead + windowMin;

    let orgs = [];
    try {
      const orgRows = await zcql(req, `SELECT * FROM Organizations WHERE Organizations.status = 'active'`);
      orgs = unwrap(orgRows, 'Organizations').map(normalize);
    } catch (e) {
      return res.status(503).json({ error: 'Organizations table missing', detail: e.message });
    }

    const summary = [];
    for (const org of orgs) {
      const orgId = Number(org.id);
      let notified = 0;
      try {
        const rows = await zcqlAll(
          req,
          `SELECT * FROM Classes WHERE Classes.is_active = 1 AND Classes.day_of_week = ${dow} AND Classes.org_id = ${orgId}`,
          'Classes'
        );
        const classes = unwrap(rows, 'Classes');
        for (const c of classes) {
          const startMin = timeToMinInternal(c.start_time);
          if (startMin === null) continue;
          if (startMin < bandStart || startMin >= bandEnd) continue; // not in reminder band
          const roster = await classRoster(req, orgId, c);
          if (!roster.length) continue;
          await createNotifications(req, {
            orgId,
            studentIds: roster,
            type: 'class',
            title: 'Upcoming class',
            body: `“${c.name || 'Your class'}” starts at ${c.start_time}.`,
            link: '/portal',
          });
          notified += roster.length;
        }
        summary.push({ org_id: org.id, org_name: org.name, ok: true, notified });
      } catch (e) {
        summary.push({ org_id: org.id, org_name: org.name, ok: false, error: e.message });
      }
    }
    res.json({ ok: true, ist_time: `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`, lead, window: windowMin, orgs_processed: summary.length, summary });
  } catch (e) {
    res.status(500).json({ error: 'Cron class-reminder failed', detail: e.message });
  }
}

router.get('/cron-class-reminder', classReminderHandler);
router.post('/cron-class-reminder', classReminderHandler);

// ---------- Morning class digest (parents + admin) ----------
// POST /api/internal/cron-morning-digest
// Schedule ONCE each morning (IST, e.g. 8:00 AM). For every active org it
// builds the day's class list once and fans out two kinds of digest:
//   • Admin/teacher  — ONE digest listing ALL of today's classes (bell + push).
//   • Each parent    — a digest listing only THEIR student's classes today.
// Orgs with no classes today are skipped. Replaces the per-class
// `/cron-class-reminder` fan-out (that endpoint is left in place as an
// optional "30 min before" reminder but need not be scheduled).

// Returns true if at least one Notifications row matches the given WHERE
// clause. Used to make the morning digest idempotent: each digest carries a
// date-stamped link, so a repeat run on the same day finds the existing row
// and skips re-inserting. Best-effort — on any error we report "not sent" so
// the digest still goes out rather than being silently suppressed.
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

function minToTime(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h < 12 ? 'AM' : 'PM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// Accept GET and POST: Catalyst Job Scheduling fires webhooks as GET by
// default, but a manual curl / future config may POST. Same handler either way.
async function morningDigestHandler(req, res) {
  try {
    const now = new Date();
    const ist = new Date(now.getTime() + (5 * 60 + 30) * 60 * 1000);
    const dow = ist.getUTCDay();

    let orgs = [];
    try {
      const orgRows = await zcql(req, `SELECT * FROM Organizations WHERE Organizations.status = 'active'`);
      orgs = unwrap(orgRows, 'Organizations').map(normalize);
    } catch (e) {
      return res.status(503).json({ error: 'Organizations table missing', detail: e.message });
    }

    // IST calendar date (YYYY-MM-DD). Embedded in each digest's deep link so a
    // repeat run on the same day can detect "already sent" and skip — keeping
    // the bell to one digest per org (and per student) per day even if the
    // cron fires more than once.
    const istDate = ist.toISOString().slice(0, 10);
    const adminLink = `/dashboard?d=${istDate}`;
    const portalLink = `/portal?d=${istDate}`;

    const summary = [];
    for (const org of orgs) {
      const orgId = Number(org.id);
      try {
        const rows = await zcqlAll(
          req,
          `SELECT * FROM Classes WHERE Classes.is_active = 1 AND Classes.day_of_week = ${dow} AND Classes.org_id = ${orgId}`,
          'Classes'
        );
        const classes = unwrap(rows, 'Classes')
          .map((c) => ({ ...c, _min: timeToMinInternal(c.start_time) }))
          .filter((c) => c._min !== null)
          .sort((a, b) => a._min - b._min);

        if (!classes.length) {
          summary.push({ org_id: org.id, org_name: org.name, classes: 0, admin_sent: false, students_notified: 0 });
          continue;
        }

        // 1) Admin/teacher digest — all of today's classes. Skip if today's
        // digest is already in the bell (idempotent on repeat runs).
        let adminRes = { created: 0, pushed: 0 };
        if (await alreadySent(req, `Notifications.org_id = ${orgId} AND Notifications.recipient_role = 'admin' AND Notifications.link = '${adminLink}'`)) {
          adminRes = { created: 0, pushed: 0, skipped: true };
        } else {
          const adminLines = classes.map((c) => `${c.name || 'Class'} at ${minToTime(c._min)}`);
          adminRes = await createAdminNotifications(req, {
            orgId,
            type: 'class',
            title: `Today's classes (${classes.length})`,
            body: adminLines.join('\n'),
            link: adminLink,
          });
        }

        // 2) Per-student digests — each parent sees only their classes.
        const perStudent = new Map(); // studentId → [{ min, name }]
        for (const c of classes) {
          const roster = await classRoster(req, orgId, c);
          for (const sid of roster) {
            if (!perStudent.has(sid)) perStudent.set(sid, []);
            perStudent.get(sid).push({ min: c._min, name: c.name || 'Class' });
          }
        }
        let studentsNotified = 0;
        for (const [sid, list] of perStudent.entries()) {
          // Skip if this student already has today's digest in their bell.
          if (await alreadySent(req, `Notifications.student_id = ${Number(sid)} AND Notifications.recipient_role = 'parent' AND Notifications.link = '${portalLink}'`)) {
            continue;
          }
          list.sort((a, b) => a.min - b.min);
          const title = list.length === 1 ? 'Class today' : `${list.length} classes today`;
          const body = list.length === 1
            ? `“${list[0].name}” at ${minToTime(list[0].min)}.`
            : list.map((x) => `${x.name} at ${minToTime(x.min)}`).join('\n');
          await createNotifications(req, {
            orgId,
            studentIds: [sid],
            type: 'class',
            title,
            body,
            link: portalLink,
          });
          studentsNotified++;
        }

        summary.push({
          org_id: org.id,
          org_name: org.name,
          classes: classes.length,
          admin_sent: adminRes.created > 0,
          admin_pushed: adminRes.pushed,
          students_notified: studentsNotified,
        });
      } catch (e) {
        summary.push({ org_id: org.id, org_name: org.name, ok: false, error: e.message });
      }
    }
    res.json({ ok: true, ist_date: ist.toISOString().slice(0, 10), orgs_processed: summary.length, summary });
  } catch (e) {
    res.status(500).json({ error: 'Cron morning-digest failed', detail: e.message });
  }
}

router.get('/cron-morning-digest', morningDigestHandler);
router.post('/cron-morning-digest', morningDigestHandler);

// ---------- TEMPORARY: notifications diagnostics ----------
// GET /api/internal/debug-notifications?org_id=123
// Confirms (a) the Notifications table exists, (b) whether the
// `recipient_role` column exists, (c) writes a test admin row, and (d) reads
// back the admin inbox for that org. Cron-secret protected. REMOVE after the
// schema is verified.
async function debugNotificationsHandler(req, res) {
  const orgId = Number(req.query.org_id);
  const out = { org_id: orgId, steps: {} };

  if (!Number.isFinite(orgId)) {
    return res.status(400).json({ error: 'Pass ?org_id=<number>' });
  }

  // (a) Does the table exist at all?
  try {
    await zcqlAll(req, `SELECT ROWID FROM Notifications LIMIT 1`, 'Notifications');
    out.steps.table_exists = true;
  } catch (e) {
    out.steps.table_exists = false;
    out.steps.table_error = e.message;
    return res.json(out); // nothing else will work
  }

  // (b) Does the recipient_role column exist?
  try {
    await zcqlAll(req, `SELECT recipient_role FROM Notifications LIMIT 1`, 'Notifications');
    out.steps.recipient_role_column = true;
  } catch (e) {
    out.steps.recipient_role_column = false;
    out.steps.recipient_role_error = e.message;
  }

  // (c) Try a full insert (with recipient_role). Reports whether the column
  // accepts the value.
  try {
    const row = await insert(req, 'Notifications', {
      student_id: 0,
      org_id: orgId,
      recipient_role: 'admin',
      type: 'debug',
      title: 'Debug test notification',
      body: 'If you can see this in the admin bell, the inbox works. Safe to delete.',
      link: '/dashboard',
      is_read: false,
    });
    out.steps.insert_with_recipient_role = true;
    out.steps.inserted_rowid = row && row.ROWID;
  } catch (e) {
    out.steps.insert_with_recipient_role = false;
    out.steps.insert_error = e.message;
  }

  // (d) Read back the admin inbox exactly as the bell route does.
  try {
    const rows = await zcqlAll(
      req,
      `SELECT * FROM Notifications WHERE Notifications.org_id = ${orgId} AND Notifications.recipient_role = 'admin' ORDER BY Notifications.CREATEDTIME DESC`,
      'Notifications'
    );
    const items = unwrap(rows, 'Notifications').map(normalize);
    out.steps.admin_read_ok = true;
    out.steps.admin_row_count = items.length;
    out.steps.admin_sample = items.slice(0, 3).map((r) => ({ id: r.id, title: r.title, role: r.recipient_role }));
  } catch (e) {
    out.steps.admin_read_ok = false;
    out.steps.admin_read_error = e.message;
  }

  res.json(out);
}
router.get('/debug-notifications', debugNotificationsHandler);
router.post('/debug-notifications', debugNotificationsHandler);

module.exports = router;
