// Shared notification helper. Inserts in-app Notifications rows AND fires
// web-push to each recipient's registered devices.
//
// Used by event triggers across the codebase (new lesson/quiz, enrollment,
// assignment assigned, fee/in-app messages, class reminders). Designed to be
// fully best-effort: a missing table, a dead subscription, or a misconfigured
// VAPID keypair must NEVER break the parent action that triggered it.
//
//   Tables (create in Catalyst console — see HANDOFF):
//     Notifications      — student_id, org_id, type, title, body, link, is_read
//     PushSubscriptions  — student_id, org_id, endpoint, p256dh, auth

const webpush = require('web-push');
const { insert, zcqlAll, unwrap, remove, q, safeId } = require('../db/catalystDb');

// Configure VAPID once at module load. If keys are absent (e.g. local dev
// before they're set), in-app rows still get written; only push is skipped.
let pushReady = false;
try {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:support@veena.app';
  if (pub && priv) {
    webpush.setVapidDetails(subject, pub, priv);
    pushReady = true;
  } else {
    console.warn('[notify] VAPID keys not set — web push disabled');
  }
} catch (err) {
  console.error('[notify] VAPID config failed:', err.message);
}

function publicVapidKey() {
  return process.env.VAPID_PUBLIC_KEY || '';
}

// Insert a Notifications row, tolerant of an older table schema that lacks the
// `recipient_role` column. Catalyst rejects the whole row if you pass a column
// that doesn't exist, so on failure we retry without `recipient_role`. This
// keeps the in-app bell working even before the column is added in the console
// (the column is only needed to distinguish admin vs parent inboxes).
async function insertNotificationRow(req, row) {
  try {
    return await insert(req, 'Notifications', row);
  } catch (err) {
    if (row.recipient_role !== undefined) {
      const { recipient_role, ...rest } = row;
      console.warn('[notify] insert with recipient_role failed (' + err.message + ') — retrying without it; add the recipient_role column to Notifications');
      return await insert(req, 'Notifications', rest);
    }
    throw err;
  }
}

// Load every push subscription for one org (best-effort).
async function loadOrgSubscriptions(req, orgId) {
  try {
    const rows = await zcqlAll(
      req,
      `SELECT * FROM PushSubscriptions WHERE PushSubscriptions.org_id = ${Number(orgId)}`,
      'PushSubscriptions'
    );
    return unwrap(rows, 'PushSubscriptions');
  } catch {
    return []; // table missing → no push, in-app still works
  }
}

// Parent/student subscriptions matching a set of student IDs.
async function loadSubscriptions(req, orgId, studentIds) {
  if (!studentIds.length) return [];
  const subs = await loadOrgSubscriptions(req, orgId);
  const wanted = new Set(studentIds.map((s) => String(s)));
  // Exclude admin-role device subscriptions from the parent fan-out.
  return subs.filter((s) => s.recipient_role !== 'admin' && wanted.has(String(s.student_id)));
}

// Admin (teacher) device subscriptions for an org.
async function loadAdminSubscriptions(req, orgId) {
  const subs = await loadOrgSubscriptions(req, orgId);
  return subs.filter((s) => s.recipient_role === 'admin');
}

// Push a payload to a list of subscriptions; prune any that come back dead.
async function pushToSubscriptions(req, subs, payload) {
  let pushed = 0;
  const dead = [];
  await Promise.all(
    subs.map(async (sub) => {
      const isDead = await sendOne(sub, payload);
      if (isDead) dead.push(sub);
      else pushed++;
    })
  );
  for (const d of dead) {
    try { if (safeId(d.ROWID)) await remove(req, 'PushSubscriptions', d.ROWID); } catch { /* ignore */ }
  }
  return pushed;
}

// Send a push payload to a single subscription. Returns true if the
// subscription is dead (404/410) and should be pruned.
async function sendOne(sub, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
    return false;
  } catch (err) {
    const code = err && err.statusCode;
    if (code === 404 || code === 410) return true; // gone — prune
    console.error('[notify] push send failed:', code || err.message);
    return false;
  }
}

/**
 * Create notifications for a set of students.
 *
 * @param {Object} req               — Express request (Catalyst SDK init)
 * @param {Object} opts
 * @param {number} opts.orgId        — org scope (required)
 * @param {Array<string|number>} opts.studentIds — recipient student ROWIDs
 * @param {string} opts.type         — e.g. 'lesson','quiz','enrollment','assignment','fee','class','message'
 * @param {string} opts.title
 * @param {string} opts.body
 * @param {string} [opts.link]       — in-app deep link (portal-relative, e.g. '/portal/assignments')
 * @returns {Promise<{created:number, pushed:number}>}
 */
async function createNotifications(req, { orgId, studentIds, type, title, body, link }) {
  const org = Number(orgId);
  const ids = [...new Set((studentIds || []).map((s) => String(s)).filter(Boolean))];
  if (!Number.isFinite(org) || !ids.length || !title) return { created: 0, pushed: 0 };

  // 1) In-app rows (best-effort per row; never throw).
  let created = 0;
  for (const sid of ids) {
    try {
      await insertNotificationRow(req, {
        student_id: sid,
        org_id: org,
        recipient_role: 'parent',
        type: type || 'general',
        title: String(title).slice(0, 250),
        body: body ? String(body).slice(0, 1000) : '',
        link: link || '',
        is_read: false,
      });
      created++;
    } catch (err) {
      console.error('[notify] insert failed for', sid, err.message);
    }
  }

  // 2) Web push (skipped silently if VAPID unconfigured).
  let pushed = 0;
  if (pushReady) {
    try {
      const subs = await loadSubscriptions(req, org, ids);
      const payload = {
        title: String(title),
        body: body ? String(body) : '',
        // SW prefixes with /app basename for the in-app route.
        url: link || '/portal',
        type: type || 'general',
      };
      pushed = await pushToSubscriptions(req, subs, payload);
    } catch (err) {
      console.error('[notify] push phase failed:', err.message);
    }
  }

  return { created, pushed };
}

/**
 * Create a single org-level notification for the academy's admin/teacher
 * (the parent bell is per-student; this is per-org, recipient_role='admin').
 * Used by the morning class-digest cron and any future admin alerts.
 */
async function createAdminNotifications(req, { orgId, type, title, body, link }) {
  const org = Number(orgId);
  if (!Number.isFinite(org) || !title) return { created: 0, pushed: 0 };

  let created = 0;
  try {
    await insertNotificationRow(req, {
      student_id: 0,             // org-level — not tied to a student. Must be a
                                 // number: the student_id column is bigint, so
                                 // '' is rejected. 0 never matches a real
                                 // student ROWID, and admin reads filter by
                                 // recipient_role (not student_id) anyway.
      org_id: org,
      recipient_role: 'admin',
      type: type || 'general',
      title: String(title).slice(0, 250),
      body: body ? String(body).slice(0, 1000) : '',
      link: link || '',
      is_read: false,
    });
    created = 1;
  } catch (err) {
    console.error('[notify] admin insert failed:', err.message);
  }

  let pushed = 0;
  if (pushReady) {
    try {
      const subs = await loadAdminSubscriptions(req, org);
      const payload = { title: String(title), body: body ? String(body) : '', url: link || '/dashboard', type: type || 'general' };
      pushed = await pushToSubscriptions(req, subs, payload);
    } catch (err) {
      console.error('[notify] admin push phase failed:', err.message);
    }
  }
  return { created, pushed };
}

module.exports = {
  createNotifications,
  createAdminNotifications,
  publicVapidKey,
  loadSubscriptions,
  loadAdminSubscriptions,
};
