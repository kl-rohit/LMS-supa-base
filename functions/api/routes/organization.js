// /api/organization/* — org-level admin endpoints (current org's settings,
// members, invites). Mounted under the standard tenant-scope chain
// (requireAuth + resolveOrg + requireOrgId) so the caller's req.orgId is
// always the org they're managing.
//
// Role gating happens per-route — owner can do anything destructive
// (rename org, invite, remove members, transfer); teachers can read but
// not mutate.

const router = require('express').Router();
const { insert, getById, update, remove, zcql, unwrap, normalize, q } = require('../db/catalystDb');
const { createLogin, getUserById } = require('../lib/supabaseAuth');

// Catalyst ROWIDs are 17-digit numbers — beyond JS Number.MAX_SAFE_INTEGER.
// req.orgId is the lossy JS Number version (set by resolveOrg), so it can't
// be passed directly to getById('Organizations', ...) which uses Catalyst's
// own precise-string lookup. Instead, fetch all orgs and match by rounded
// Number value — both sides lose precision the same way, so the comparison
// is reliable.
async function findOrgByLossyId(req, lossyOrgId) {
  const rows = await zcql(req, `SELECT * FROM Organizations`);
  return unwrap(rows, 'Organizations').find(
    (o) => Number(o.ROWID) === Number(lossyOrgId)
  );
}

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
    const orgRow = await findOrgByLossyId(req, req.orgId);
    if (!orgRow) return res.status(404).json({ error: 'Org not found' });

    // Membership list
    const memRows = await zcql(req,
      `SELECT * FROM OrgMemberships WHERE OrgMemberships.org_id = ${Number(req.orgId)} ORDER BY OrgMemberships.CREATEDTIME ASC`
    );
    const memberships = unwrap(memRows, 'OrgMemberships').map(normalize);

    // Decorate with the Catalyst user's email/name (best-effort; if the
    // call fails we just return the user_id).
    const decorated = await Promise.all(memberships.map(async (m) => {
      let email = '', display = '';
      try {
        const u = await getUserById(m.user_id);
        email   = u?.email || '';
        display = [u?.user_metadata?.first_name, u?.user_metadata?.last_name].filter(Boolean).join(' ').trim();
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
    if (req.body.name !== undefined)       patch.name       = String(req.body.name).slice(0, 200);
    if (req.body.logo_url !== undefined)   patch.logo_url   = String(req.body.logo_url).slice(0, 500);
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'nothing to update' });

    // Resolve the precise ROWID — see findOrgByLossyId comment for the
    // ROWID precision gotcha.
    const orgRow = await findOrgByLossyId(req, req.orgId);
    if (!orgRow) return res.status(404).json({ error: 'Org not found' });
    const updated = await update(req, 'Organizations', orgRow.ROWID, patch);
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

    // 1. Create the Supabase login with a temp password (no email), or reuse an
    //    existing account if the email is already known.
    let userId = null;
    let tempPassword = null;
    try {
      const r = await createLogin({ email, first_name, last_name });
      userId = r.userId;
      tempPassword = r.tempPassword;
    } catch (e) {
      return res.status(500).json({ error: 'Could not invite — user lookup/create failed', detail: e.message });
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

    res.status(201).json({
      message: tempPassword
        ? 'Teacher login created. Share these sign-in details with them (e.g. on WhatsApp).'
        : 'Linked their existing account. They sign in with their current password.',
      membership: normalize(m),
      user_id: String(userId),
      email,
      temp_password: tempPassword, // null when reusing an existing account
    });
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
    // (Use the precise ROWID — see findOrgByLossyId comment.)
    const orgRowPrecise = await findOrgByLossyId(req, req.orgId);
    if (orgRowPrecise) {
      await update(req, 'Organizations', orgRowPrecise.ROWID, { owner_user_id: String(targetMembership.user_id) });
    }

    res.json({ message: 'Ownership transferred' });
  } catch (e) {
    res.status(500).json({ error: 'Transfer failed', detail: e.message });
  }
});

// =============================================================================
// POST /api/organization/logo — upload + persist a logo for this org.
// Body: { data: 'data:image/png;base64,...' }
// Reuses the existing photo Stratus bucket — logos live alongside student
// photos under a distinct key (`org-<id>-logo.jpg`). Resized to ≤800px JPEG.
// =============================================================================
const { appFor } = require('../db/catalystDb');
const { resizeAndCompress } = require('../lib/image');
const { PHOTO_BUCKET, signStoredPhoto } = require('../lib/photoUpload');

router.post('/logo', requireOwner, async (req, res) => {
  try {
    const { data } = req.body || {};
    if (!data || typeof data !== 'string') {
      return res.status(400).json({ error: 'data (base64 image) is required' });
    }
    const m = data.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    const b64 = m ? m[2] : data;
    let buffer;
    try { buffer = Buffer.from(b64, 'base64'); }
    catch { return res.status(400).json({ error: 'Invalid base64 payload' }); }
    if (buffer.length === 0) return res.status(400).json({ error: 'Empty image payload' });
    if (buffer.length > 8 * 1024 * 1024) {
      return res.status(413).json({ error: 'Image must be 8MB or smaller' });
    }

    // Resize to a sensible logo size + compress.
    let processed;
    try { processed = await resizeAndCompress(buffer); }
    catch (e) { return res.status(422).json({ error: 'Could not process image', detail: e.message }); }

    const objectKey = `org-${Number(req.orgId)}-logo.jpg`;
    const bucket = appFor(req).stratus().bucket(PHOTO_BUCKET);
    await bucket.putObject(objectKey, processed, { contentType: 'image/jpeg', overwrite: true });

    // Write the object key to Organizations.logo_url (we sign on read for display).
    const orgRow = await findOrgByLossyId(req, req.orgId);
    if (!orgRow) return res.status(404).json({ error: 'Org not found' });
    await update(req, 'Organizations', orgRow.ROWID, { logo_url: objectKey });

    // Return a fresh signed URL for instant preview.
    const signed = await signStoredPhoto(req, objectKey);
    res.json({ logo_url: signed, object_key: objectKey });
  } catch (e) {
    res.status(500).json({ error: 'Failed to upload logo', detail: e.message });
  }
});

// GET /api/organization/logo-url — fresh signed URL for the current logo.
router.get('/logo-url', async (req, res) => {
  try {
    const orgRow = await findOrgByLossyId(req, req.orgId);
    if (!orgRow) return res.status(404).json({ error: 'Org not found' });
    const signed = await signStoredPhoto(req, orgRow.logo_url);
    res.json({ logo_url: signed });
  } catch (e) {
    res.status(500).json({ error: 'Failed to sign logo URL', detail: e.message });
  }
});

module.exports = router;
