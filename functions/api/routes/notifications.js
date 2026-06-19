// /api/notifications — admin/teacher notification inbox + push registration.
//
// Mirrors the parent endpoints in portal.js but scoped to the ORG (not a
// student): rows carry recipient_role='admin' and student_id=''. Any admin of
// the org sees the same inbox. Mounted with requireAuth + resolveOrg +
// requireOrgId (admin chain).

const router = require('express').Router();
const { getById, zcqlAll, unwrap, normalize, insert, update, remove, safeId } = require('../db/catalystDb');
const { publicVapidKey } = require('../lib/notify');

// GET /api/notifications — org admin inbox, newest first + unread count.
router.get('/', async (req, res) => {
  try {
    let rows = [];
    try {
      rows = await zcqlAll(
        req,
        `SELECT * FROM Notifications WHERE Notifications.org_id = ${Number(req.orgId)} AND Notifications.recipient_role = 'admin' ORDER BY Notifications.CREATEDTIME DESC`,
        'Notifications'
      );
    } catch { rows = []; }
    const items = unwrap(rows, 'Notifications').map((r) => {
      const n = normalize(r);
      return {
        id: n.id,
        type: n.type || 'general',
        title: n.title || '',
        body: n.body || '',
        link: n.link || '',
        read: Number(n.is_read) === 1,
        created_at: n.CREATEDTIME || n.created_at,
      };
    });
    const unread = items.filter((i) => !i.read).length;
    res.json({ notifications: items, unread });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch notifications', detail: e.message });
  }
});

// POST /api/notifications/:id/read
router.post('/:id/read', async (req, res) => {
  try {
    const id = safeId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid request' });
    const row = await getById(req, 'Notifications', id);
    if (!row || Number(row.org_id) !== Number(req.orgId) || row.recipient_role !== 'admin') {
      return res.status(404).json({ error: 'Not found' });
    }
    await update(req, 'Notifications', id, { is_read: true });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update', detail: e.message });
  }
});

// POST /api/notifications/read-all
router.post('/read-all', async (req, res) => {
  try {
    let rows = [];
    try {
      rows = await zcqlAll(
        req,
        `SELECT ROWID, is_read FROM Notifications WHERE Notifications.org_id = ${Number(req.orgId)} AND Notifications.recipient_role = 'admin'`,
        'Notifications'
      );
    } catch { rows = []; }
    const unread = unwrap(rows, 'Notifications').filter((r) => Number(r.is_read) !== 1);
    await Promise.all(unread.map((r) => update(req, 'Notifications', r.ROWID, { is_read: true }).catch(() => {})));
    res.json({ ok: true, updated: unread.length });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update', detail: e.message });
  }
});

// ---------- Admin web push ----------

// GET /api/notifications/push/vapid-key
router.get('/push/vapid-key', (req, res) => {
  res.json({ key: publicVapidKey() });
});

// POST /api/notifications/push/subscribe — register this admin device.
router.post('/push/subscribe', async (req, res) => {
  try {
    const sub = req.body && req.body.subscription ? req.body.subscription : req.body;
    const endpoint = sub && sub.endpoint;
    const p256dh = sub && sub.keys && sub.keys.p256dh;
    const auth = sub && sub.keys && sub.keys.auth;
    if (!endpoint || !p256dh || !auth) return res.status(400).json({ error: 'Invalid subscription' });
    // Identify the admin device by the Catalyst user id (for future per-admin use).
    const adminId = String(req.user?.user_id || req.user?.id || req.user?.email || 'admin');

    let existing = [];
    try {
      existing = await zcqlAll(
        req,
        `SELECT ROWID, endpoint FROM PushSubscriptions WHERE PushSubscriptions.org_id = ${Number(req.orgId)}`,
        'PushSubscriptions'
      );
    } catch { existing = []; }
    const match = unwrap(existing, 'PushSubscriptions').find((r) => r.endpoint === endpoint);
    if (match) {
      await update(req, 'PushSubscriptions', match.ROWID, { student_id: adminId, recipient_role: 'admin', p256dh, auth }).catch(() => {});
      return res.json({ ok: true, id: match.ROWID });
    }
    const inserted = await insert(req, 'PushSubscriptions', {
      student_id: adminId,
      org_id: Number(req.orgId),
      recipient_role: 'admin',
      endpoint,
      p256dh,
      auth,
    });
    res.json({ ok: true, id: inserted?.ROWID });
  } catch (e) {
    res.status(500).json({ error: 'Failed to subscribe', detail: e.message });
  }
});

// POST /api/notifications/push/unsubscribe
router.post('/push/unsubscribe', async (req, res) => {
  try {
    const endpoint = req.body && req.body.endpoint;
    if (!endpoint) return res.status(400).json({ error: 'Invalid request' });
    let existing = [];
    try {
      existing = await zcqlAll(
        req,
        `SELECT ROWID, endpoint FROM PushSubscriptions WHERE PushSubscriptions.org_id = ${Number(req.orgId)}`,
        'PushSubscriptions'
      );
    } catch { existing = []; }
    const matches = unwrap(existing, 'PushSubscriptions').filter((r) => r.endpoint === endpoint);
    await Promise.all(matches.map((m) => remove(req, 'PushSubscriptions', m.ROWID).catch(() => {})));
    res.json({ ok: true, removed: matches.length });
  } catch (e) {
    res.status(500).json({ error: 'Failed to unsubscribe', detail: e.message });
  }
});

module.exports = router;
