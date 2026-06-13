// /api/organization/* — org-level admin endpoints (current org's settings,
// members, invites). Mounted under the standard tenant-scope chain
// (requireAuth + resolveOrg + requireOrgId) so the caller's req.orgId is
// always the org they're managing.
//
// Role gating happens per-route — owner can do anything destructive
// (rename org, invite, remove members, transfer); teachers can read but
// not mutate.

const router = require('express').Router();
const catalyst = require('zcatalyst-sdk-node');
const { insert, getById, update, remove, zcql, unwrap, normalize, q } = require('../db/catalystDb');

// Helper — refuse mutations from anyone except the owner (or platform admin
// impersonating the owner).
function requireOwner(req, res, next) {
  if (req.orgRole !== 'owner' && req.orgRole !== 'platform_admin') {
    return res.status(403).json({ error: 'Owner-only action' });
  }
  next();
}

// =============================================================================
// GET /api/organization — current org details + role + member list
// =============================================================================
router.get('/', async (req, res) => {
  try {
    const orgRow = await getById(req, 'Organizations', req.orgId);
    if (!orgRow) return res.status(404).json({ error: 'Org not found' });

    // Membership list
    const memRows = await zcql(req,
      `SELECT * FROM OrgMemberships WHERE OrgMemberships.org_id = ${Number(req.orgId)} ORDER BY OrgMemberships.CREATEDTIME ASC`
    );
    const memberships = unwrap(memRows, 'OrgMemberships').map(normalize);

    // Decorate with the Catalyst user's email/name (best-effort; if the
    // call fails we just return the user_id).
    const adminApp = catalyst.initialize(req, { scope: 'admin' });
    const decorated = await Promise.all(memberships.map(async (m) => {
      let email = '', display = '';
      try {
        const u = await adminApp.userManagement().getUserDetails(m.user_id);
        email   = u?.email_id || u?.email || '';
        display = [u?.first_name, u?.last_name].filter(Boolean).join(' ').trim();
      } catch {}
      return { ...m, email, display };
    }));

    res.json({
      org: normalize(orgRow),
      role: req.orgRole,
      members: decorated,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load org', detail: e.message });
  }
});

// =============================================================================
// PUT /api/organization — rename the org (owner only)
// =============================================================================
router.put('/', requireOwner, async (req, res) => {
  try {
    const patch = {};
    if (req.body.name !== undefined) patch.name = String(req.body.name).slice(0, 200);
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'nothing to update' });
    const updated = await update(req, 'Organizations', req.orgId, patch);
    res.json({ org: normalize(updated) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update org', detail: e.message });
  }
});

// =============================================================================
// POST /api/organization/invite — invite a teacher (owner only)
// Body: { email, first_name?, last_name?, role? }  (role defaults to 'teacher')
// =============================================================================
router.post('/invite', requireOwner, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const first_name = String(req.body?.first_name || 'Teacher').trim();
    const last_name = String(req.body?.last_name || '').trim();
    const role = (req.body?.role === 'owner') ? 'teacher' : (req.body?.role || 'teacher');
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email required' });
    }
    if (!['teacher'].includes(role)) {
      return res.status(400).json({ error: 'role must be "teacher" (owners are set via /transfer-ownership)' });
    }

    // 1. Find or create the Catalyst user.
    const adminApp = catalyst.initialize(req, { scope: 'admin' });
    let userId = null;
    try {
      const created = await adminApp.userManagement().registerUser({
        email_id: email, first_name, last_name,
      });
      userId = created?.user_id || created?.user_details?.user_id || created?.userId;
    } catch (e1) {
      // Likely already exists — try the fallback signature.
      try {
        const created = await adminApp.userManagement().registerUser({ platform_type: 'web' }, {
          email_id: email, first_name, last_name,
        });
        userId = created?.user_id || created?.user_details?.user_id || created?.userId;
      } catch (e2) {
        // Final fallback: search Catalyst users by email
        try {
          const userList = await adminApp.userManagement().getAllUsers();
          const list = Array.isArray(userList) ? userList : (userList?.data || []);
          const found = list.find((u) =>
            String(u?.email_id || u?.email || '').toLowerCase() === email
          );
          if (found) userId = found.user_id || found.userId;
        } catch {}
        if (!userId) {
          return res.status(500).json({
            error: 'Could not invite — Catalyst user lookup/create failed',
            detail: `${e1.message} / fallback: ${e2.message}`,
          });
        }
      }
    }

    // 2. Already a member of this org? Don't duplicate.
    const existingRows = await zcql(req,
      `SELECT ROWID FROM OrgMemberships WHERE OrgMemberships.user_id = ${q(String(userId))} AND OrgMemberships.org_id = ${Number(req.orgId)}`
    );
    if (unwrap(existingRows, 'OrgMemberships').length > 0) {
      return res.status(409).json({ error: 'Already a member of this academy' });
    }

    // 3. Create OrgMembership (status: invited — flips to active on their first /me).
    const m = await insert(req, 'OrgMemberships', {
      user_id: String(userId),
      org_id: Number(req.orgId),
      role,
      status: 'invited',
    });

    res.status(201).json({ message: 'Invite sent', membership: normalize(m), user_id: String(userId) });
  } catch (e) {
    res.status(500).json({ error: 'Invite failed', detail: e.message });
  }
});

// =============================================================================
// DELETE /api/organization/members/:id — remove a member (owner only)
//   :id is OrgMemberships.ROWID. Refuses to remove the org owner.
// =============================================================================
router.delete('/members/:id', requireOwner, async (req, res) => {
  try {
    const existing = await getById(req, 'OrgMemberships', req.params.id);
    if (!existing || Number(existing.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Member not found' });
    }
    if (existing.role === 'owner') {
      return res.status(400).json({
        error: 'Cannot remove the owner. Use POST /organization/transfer-ownership first.',
      });
    }
    await remove(req, 'OrgMemberships', req.params.id);
    res.json({ message: 'Member removed' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to remove member', detail: e.message });
  }
});

// =============================================================================
// POST /api/organization/transfer-ownership — owner hands over to another
// active teacher. Body: { membership_id }.
// =============================================================================
router.post('/transfer-ownership', requireOwner, async (req, res) => {
  try {
    const newOwnerMemberId = String(req.body?.membership_id || '');
    if (!newOwnerMemberId) return res.status(400).json({ error: 'membership_id required' });

    const targetMembership = await getById(req, 'OrgMemberships', newOwnerMemberId);
    if (!targetMembership || Number(targetMembership.org_id) !== Number(req.orgId)) {
      return res.status(404).json({ error: 'Target membership not found' });
    }
    if (targetMembership.status !== 'active') {
      return res.status(400).json({ error: 'New owner must be an active member (not invited/removed)' });
    }

    // Find the current owner row.
    const curOwnerRows = await zcql(req,
      `SELECT * FROM OrgMemberships WHERE OrgMemberships.org_id = ${Number(req.orgId)} AND OrgMemberships.role = 'owner'`
    );
    const ownerRow = unwrap(curOwnerRows, 'OrgMemberships')[0];

    // Flip target → owner, current owner → teacher (don't lose them).
    await update(req, 'OrgMemberships', newOwnerMemberId, { role: 'owner' });
    if (ownerRow) {
      await update(req, 'OrgMemberships', ownerRow.ROWID, { role: 'teacher' });
    }
    // Also stamp Organizations.owner_user_id so the platform admin view stays accurate.
    await update(req, 'Organizations', req.orgId, { owner_user_id: String(targetMembership.user_id) });

    res.json({ message: 'Ownership transferred' });
  } catch (e) {
    res.status(500).json({ error: 'Transfer failed', detail: e.message });
  }
});

module.exports = router;
