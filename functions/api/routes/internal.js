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
const { zcql, zcqlAll, unwrap, normalize, remove, appFor } = require('../db/catalystDb');
const { createNotifications, createAdminNotifications, pushToStudents, pushToAdmins } = require('../lib/notify');
const config = require('../config');

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

// ---------- Class reminders (retired) ----------
// The every-15-minutes per-class reminder has been retired in favour of the
// once-a-day morning digest below: one notification per day instead of a cron
// firing 96×/day (each run scanning every org's classes). The
// `/cron-class-reminder` path is kept as an ALIAS to the morning-digest handler
// so any existing Catalyst schedule still pointed at it simply runs the
// idempotent daily digest. ACTION: in the Catalyst console, change that
// schedule to fire ONCE per day (~8:00 AM IST), not every 15 minutes.
//
// timeToMinInternal + classRoster below are still used by the morning digest.

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

// Alias: any schedule still hitting /cron-class-reminder now runs the
// once-a-day morning digest (defined below; hoisted). Idempotent, so even if
// the old 15-minute cadence is still configured it sends at most one digest
// per day until the console schedule is changed to daily.
router.get('/cron-class-reminder', (req, res) => morningDigestHandler(req, res));
router.post('/cron-class-reminder', (req, res) => morningDigestHandler(req, res));

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

// Self-healing dedup + push-ownership for digests. The morning-digest cron can
// be delivered more than once in quick succession (webhook retry on a slow or
// timed-out run, where the original invocation is still executing when the
// retry starts). When that happens the check-then-insert `alreadySent` guard
// races: two runs both read "not sent" before either commits, so both insert.
//
// After building a digest we prune any extras matching the same link, keeping
// only the earliest ROWID. Every concurrent run agrees to keep the min ROWID,
// so the bell converges to one row even under overlapping fires — and a later
// run cleans up duplicates a prior run already left behind.
//
// Returns the surviving (earliest) ROWID as a string, or null. Callers fire the
// web push ONLY when this survivor matches the row they just inserted: that
// makes exactly one invocation the push owner, so the parent/admin sees a
// single pop-up no matter how many times the cron is delivered. Best-effort:
// on any error we return null and leave rows untouched (the caller then skips
// the push rather than risk a duplicate).
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
        // Pull all active classes (not just this weekday) so timetable
        // exceptions can be applied: a class MOVED to today is included with its
        // moved time, and one CANCELLED / MOVED AWAY today is excluded.
        const rows = await zcqlAll(
          req,
          `SELECT * FROM Classes WHERE Classes.is_active = 1 AND Classes.org_id = ${orgId}`,
          'Classes'
        );
        const parseEx = (raw) => {
          if (!raw) return [];
          if (Array.isArray(raw)) return raw;
          try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return []; }
        };
        const todays = [];
        for (const c of unwrap(rows, 'Classes')) {
          const exs = parseEx(c.exceptions);
          const movedIn = exs.find((e) => e.status === 'moved' && e.new_date === istDate);
          if (movedIn) {
            todays.push({ ...c, start_time: movedIn.new_start_time || c.start_time, end_time: movedIn.new_end_time || c.end_time });
            continue;
          }
          if (Number(c.day_of_week) === dow) {
            const ex = exs.find((e) => e.date === istDate);
            if (ex && (ex.status === 'cancelled' || ex.status === 'moved')) continue;
            todays.push(c);
          }
        }
        const classes = todays
          .map((c) => ({ ...c, _min: timeToMinInternal(c.start_time) }))
          .filter((c) => c._min !== null)
          .sort((a, b) => a._min - b._min);

        if (!classes.length) {
          summary.push({ org_id: org.id, org_name: org.name, classes: 0, admin_sent: false, students_notified: 0 });
          continue;
        }

        // 1) Admin/teacher digest — all of today's classes. Idempotent on
        // repeat/overlapping cron deliveries: if today's digest is already in
        // the bell we neither re-insert nor re-push (its owner handled the
        // push). Otherwise we insert WITHOUT pushing, prune to the earliest
        // row, then push only if that survivor is the row we just wrote — so a
        // racing twin that also inserted defers the push to the single owner.
        const adminWhere = `Notifications.org_id = ${orgId} AND Notifications.recipient_role = 'admin' AND Notifications.link = '${adminLink}'`;
        let adminRes = { created: 0, pushed: 0 };
        if (await alreadySent(req, adminWhere)) {
          await pruneDuplicateDigests(req, adminWhere);
          adminRes = { created: 0, pushed: 0, skipped: true };
        } else {
          const adminLines = classes.map((c) => `${c.name || 'Class'} at ${minToTime(c._min)}`);
          const adminTitle = `Today's classes (${classes.length})`;
          const adminBody = adminLines.join('\n');
          const ins = await createAdminNotifications(req, {
            orgId,
            type: 'class',
            title: adminTitle,
            body: adminBody,
            link: adminLink,
            push: false,
          });
          const survivor = await pruneDuplicateDigests(req, adminWhere);
          let adminPushed = 0;
          if (ins.rowid && survivor && String(survivor) === String(ins.rowid)) {
            adminPushed = await pushToAdmins(req, orgId, {
              type: 'class',
              title: adminTitle,
              body: adminBody,
              link: adminLink,
            });
          }
          adminRes = { created: ins.created, pushed: adminPushed };
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
          const studentWhere = `Notifications.student_id = ${Number(sid)} AND Notifications.recipient_role = 'parent' AND Notifications.link = '${portalLink}'`;
          // Same insert-first / push-by-ownership rule as the admin digest, so
          // each parent gets exactly one pop-up even if the cron is delivered
          // more than once.
          if (await alreadySent(req, studentWhere)) {
            await pruneDuplicateDigests(req, studentWhere);
            continue;
          }
          list.sort((a, b) => a.min - b.min);
          const title = list.length === 1 ? 'Class today' : `${list.length} classes today`;
          const body = list.length === 1
            ? `“${list[0].name}” at ${minToTime(list[0].min)}.`
            : list.map((x) => `${x.name} at ${minToTime(x.min)}`).join('\n');
          const ins = await createNotifications(req, {
            orgId,
            studentIds: [sid],
            type: 'class',
            title,
            body,
            link: portalLink,
            push: false,
          });
          studentsNotified++;
          const myRowid = ins.rowids && ins.rowids[0];
          const survivor = await pruneDuplicateDigests(req, studentWhere);
          if (myRowid && survivor && String(survivor) === String(myRowid)) {
            await pushToStudents(req, orgId, [sid], { type: 'class', title, body, link: portalLink });
          }
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

// ---------- Weekly parent digest ----------
// A once-a-week engagement nudge to parents: how many classes their child
// attended this week, plus any new lessons added. Idempotent per student per
// week via a week-stamped link (same insert-first / push-by-ownership rule as
// the morning digest). Schedule this once a week in the Catalyst console
// pointed at /api/internal/cron-weekly-digest with the X-Cron-Secret header.
async function weeklyDigestHandler(req, res) {
  try {
    const now = new Date();
    const ist = new Date(now.getTime() + (5 * 60 + 30) * 60 * 1000);
    const istDate = ist.toISOString().slice(0, 10);
    const since = new Date(ist.getTime() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const link = `/portal?w=${istDate}`;

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
      try {
        // Present-attendance counts for the last 7 days, grouped per student.
        const attRows = await zcqlAll(req, `SELECT student_id, status, class_date FROM Attendance WHERE Attendance.status = 'present' AND Attendance.org_id = ${orgId}`, 'Attendance');
        const byStudent = new Map();
        for (const a of unwrap(attRows, 'Attendance')) {
          const d = a.class_date || a.date;
          if (d && String(d).slice(0, 10) >= since) {
            const k = String(a.student_id);
            byStudent.set(k, (byStudent.get(k) || 0) + 1);
          }
        }

        // New lessons added this week (org-wide count).
        let newLessons = 0;
        try {
          const lr = await zcqlAll(req, `SELECT ROWID, CREATEDTIME FROM Lessons WHERE Lessons.org_id = ${orgId}`, 'Lessons');
          newLessons = unwrap(lr, 'Lessons').filter((l) => String(l.CREATEDTIME || '').slice(0, 10) >= since).length;
        } catch { /* Lessons table may not exist for this org */ }

        let notified = 0;
        for (const [sid, count] of byStudent.entries()) {
          const where = `Notifications.student_id = ${Number(sid)} AND Notifications.recipient_role = 'parent' AND Notifications.link = '${link}'`;
          if (await alreadySent(req, where)) { await pruneDuplicateDigests(req, where); continue; }
          const title = 'Your weekly update';
          const parts = [`${count} ${count === 1 ? 'class' : 'classes'} attended this week`];
          if (newLessons > 0) parts.push(`${newLessons} new ${newLessons === 1 ? 'lesson' : 'lessons'} added`);
          const body = `${parts.join(' · ')}.`;
          const ins = await createNotifications(req, { orgId, studentIds: [sid], type: 'digest', title, body, link, push: false });
          notified++;
          const myRowid = ins.rowids && ins.rowids[0];
          const survivor = await pruneDuplicateDigests(req, where);
          if (myRowid && survivor && String(survivor) === String(myRowid)) {
            await pushToStudents(req, orgId, [sid], { type: 'digest', title, body, link });
          }
        }
        summary.push({ org_id: org.id, org_name: org.name, students_notified: notified, new_lessons: newLessons });
      } catch (e) {
        summary.push({ org_id: org.id, org_name: org.name, ok: false, error: e.message });
      }
    }
    res.json({ ok: true, ist_date: istDate, since, orgs_processed: summary.length, summary });
  } catch (e) {
    res.status(500).json({ error: 'Cron weekly-digest failed', detail: e.message });
  }
}

router.get('/cron-weekly-digest', weeklyDigestHandler);
router.post('/cron-weekly-digest', weeklyDigestHandler);

// ---------- Per-org data backup to Stratus ----------
// Dumps each active org's core tables to a JSON object in the existing Stratus
// bucket under backups/org-<id>-<YYYY-MM-DD>.json. Schedule in the Catalyst
// console pointed at /api/internal/cron-backup with the X-Cron-Secret header.
//
// COST NOTE: this scans full tables (incl. Attendance + LessonProgress) per
// run. On the free Data Store SELECT tier prefer a WEEKLY cadence; nightly is
// best once on a paid plan. The cron schedule decides cadence; the code is the
// same either way.
const BACKUP_TABLES = ['Students', 'Classes', 'Attendance', 'Groups', 'GroupStudents', 'ClassStudents', 'CourseEnrollments', 'LessonProgress', 'Fees', 'AppSettings'];
async function backupHandler(req, res) {
  try {
    const now = new Date();
    const ist = new Date(now.getTime() + (5 * 60 + 30) * 60 * 1000);
    const dateStr = ist.toISOString().slice(0, 10);

    let orgs = [];
    try {
      const orgRows = await zcql(req, `SELECT * FROM Organizations WHERE Organizations.status = 'active'`);
      orgs = unwrap(orgRows, 'Organizations').map(normalize);
    } catch (e) {
      return res.status(503).json({ error: 'Organizations table missing', detail: e.message });
    }

    let bucket;
    try {
      bucket = appFor(req).stratus().bucket(config.PHOTO_BUCKET);
    } catch (e) {
      return res.status(503).json({ error: 'Stratus bucket unavailable', detail: e.message });
    }

    const summary = [];
    for (const org of orgs) {
      const orgId = Number(org.id);
      const dump = { org_id: orgId, org_name: org.name, exported_at: new Date().toISOString(), tables: {} };
      for (const t of BACKUP_TABLES) {
        try {
          const rows = await zcqlAll(req, `SELECT * FROM ${t} WHERE ${t}.org_id = ${orgId}`, t);
          dump.tables[t] = unwrap(rows, t).map(normalize);
        } catch { dump.tables[t] = []; }
      }
      const key = `backups/org-${orgId}-${dateStr}.json`;
      try {
        await bucket.putObject(key, Buffer.from(JSON.stringify(dump)), { contentType: 'application/json', overwrite: true });
        summary.push({ org_id: orgId, ok: true, key, tables: Object.keys(dump.tables).length });
      } catch (e) {
        summary.push({ org_id: orgId, ok: false, error: e.message });
      }
    }
    res.json({ ok: true, date: dateStr, orgs_processed: summary.length, summary });
  } catch (e) {
    res.status(500).json({ error: 'Cron backup failed', detail: e.message });
  }
}

router.get('/cron-backup', backupHandler);
router.post('/cron-backup', backupHandler);

module.exports = router;
