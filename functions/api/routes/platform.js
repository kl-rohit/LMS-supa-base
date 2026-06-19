// /api/platform/* — platform-level admin endpoints.
//
// Sits ABOVE the org-scope layer. Today it just hosts the one-off Phase A
// bootstrap that creates the first org + backfills org_id on existing data.
// Future siblings: list all orgs, suspend an org, impersonate, etc.
//
// Mounted in index.js under the standard requireAuth + requireAdmin chain,
// so only Catalyst "App Administrator" users (i.e. you) can reach these.

const router = require('express').Router();
const {
  insert, update, zcql, zcqlAll, unwrap, normalize, safeId, appFor,
} = require('../db/catalystDb');
const { normalizePlan, effectivePlan, trialInfo, planMaxStudents, TRIAL_DURATION_DAYS } = require('../lib/plans');

// Tables that need to be tagged with an org_id during migration. Same list
// the debug-tables probe uses — keep them in sync.
const TENANT_TABLES = [
  'Students', 'Groups', 'GroupStudents', 'Classes', 'ClassStudents',
  'Attendance', 'AdditionalFees', 'Payments',
  'Messages', 'MessageTemplates', 'AppSettings',
  'Courses', 'Lessons', 'LessonProgress', 'CourseEnrollments',
  'Camps', 'CampDays',
];

// =============================================================================
// GET /api/platform/status — quick health-check for the multi-tenancy layer
// =============================================================================
router.get('/status', async (req, res) => {
  try {
    // Count orgs + memberships. Empty + 0 means we haven't bootstrapped yet.
    let orgCount = 0, membershipCount = 0;
    try {
      const orgs = await zcql(req, 'SELECT ROWID FROM Organizations');
      orgCount = orgs.length;
    } catch (e) {
      return res.status(503).json({ error: 'Organizations table missing', detail: e.message });
    }
    try {
      const mems = await zcql(req, 'SELECT ROWID FROM OrgMemberships');
      membershipCount = mems.length;
    } catch (e) {
      return res.status(503).json({ error: 'OrgMemberships table missing', detail: e.message });
    }

    res.json({
      bootstrapped: orgCount > 0,
      orgs: orgCount,
      memberships: membershipCount,
      caller: {
        user_id: req.user?.user_id || null,
        email:   req.user?.email_id || req.user?.email || null,
        role:    req.user?.role_details?.role_name || req.user?.role || null,
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'Status check failed', detail: e.message });
  }
});

// =============================================================================
// POST /api/platform/bootstrap — one-off Phase A migration
//
// Behaviour:
//   1. If Organizations already has any rows → 409 (idempotent guard).
//   2. Create the default org (default name "Veena Dhwani Academy", or as
//      supplied by req.body.name) with the calling Catalyst user as owner.
//   3. Insert an OrgMembership(owner) for the caller.
//   4. For each tenant table, set org_id = <new org's ROWID> on every row
//      where org_id is currently NULL/empty. Existing rows that already
//      have an org_id (re-runs after partial failure) are left alone.
//   5. Return a per-table summary so the caller can audit what changed.
// =============================================================================
router.post('/bootstrap', async (req, res) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) return res.status(401).json({ error: 'No authenticated user on request' });

    // Idempotent guard — refuse to run if any org already exists.
    let existingOrgs;
    try {
      existingOrgs = await zcql(req, 'SELECT ROWID FROM Organizations');
    } catch (e) {
      return res.status(503).json({
        error: 'Organizations table missing',
        hint: 'Create the Organizations + OrgMemberships tables in the Catalyst console before bootstrapping.',
        detail: e.message,
      });
    }
    if (existingOrgs.length > 0) {
      return res.status(409).json({
        error: 'Already bootstrapped',
        hint: 'Organizations table is non-empty. To re-run, delete its rows in the console first.',
        existing_count: existingOrgs.length,
      });
    }

    // Create the default org.
    const name = (req.body?.name || 'Veena Dhwani Academy').toString().slice(0, 200);
    const slug = slugify(name) || 'default';
    const orgRow = await insert(req, 'Organizations', {
      name,
      slug,
      owner_user_id: String(userId),
      status: 'active',
      plan:   'free',
    });
    const orgId = orgRow?.ROWID;
    if (!orgId) return res.status(500).json({ error: 'Failed to create Organizations row' });

    // Owner membership.
    await insert(req, 'OrgMemberships', {
      user_id: String(userId),
      org_id:  Number(orgId),
      role:    'owner',
      status:  'active',
    });

    // Backfill every tenant table.
    const summary = {};
    for (const table of TENANT_TABLES) {
      try {
        // Pull every row's ROWID. We rely on row-by-row UPDATE because
        // ZCQL doesn't expose a single-statement bulk UPDATE that targets
        // multiple ROWIDs in one call.
        const rows = await zcqlAll(req, `SELECT * FROM ${table}`, table);
        const items = unwrap(rows, table);
        let toUpdate = 0;
        let updated  = 0;
        let alreadySet = 0;
        const errors = [];

        for (const r of items) {
          // Skip rows that already have an org_id (defensive — supports
          // re-runs after partial failure, even though the idempotent
          // guard above usually catches that).
          if (r.org_id !== null && r.org_id !== undefined && r.org_id !== '' && Number(r.org_id) !== 0) {
            alreadySet++;
            continue;
          }
          toUpdate++;
          try {
            await update(req, table, r.ROWID, { org_id: Number(orgId) });
            updated++;
          } catch (err) {
            errors.push({ ROWID: r.ROWID, msg: err.message });
          }
        }
        summary[table] = { total: items.length, to_update: toUpdate, updated, already_set: alreadySet };
        if (errors.length) summary[table].errors = errors.slice(0, 5);
      } catch (e) {
        summary[table] = { error: e.message };
      }
    }

    res.json({
      message: 'Bootstrap complete',
      org: { id: orgId, name, slug },
      owner_user_id: String(userId),
      backfill: summary,
    });
  } catch (e) {
    res.status(500).json({ error: 'Bootstrap failed', detail: e.message });
  }
});

// =============================================================================
// GET /api/platform/orgs — list every org (platform admin view)
// =============================================================================
router.get('/orgs', async (req, res) => {
  try {
    const rows = await zcqlAll(req, `SELECT * FROM Organizations`, 'Organizations');
    const orgs = unwrap(rows, 'Organizations').map(normalize);

    // Count memberships per org for the table view
    let memCounts = new Map();
    try {
      const mems = await zcqlAll(req, `SELECT * FROM OrgMemberships`, 'OrgMemberships');
      for (const m of unwrap(mems, 'OrgMemberships')) {
        const k = String(m.org_id);
        memCounts.set(k, (memCounts.get(k) || 0) + 1);
      }
    } catch {}

    // Count ACTIVE students per org (drives the plan student-cap display).
    let stuCounts = new Map();
    try {
      const stu = await zcqlAll(req, `SELECT org_id FROM Students WHERE Students.status = 'active'`, 'Students');
      for (const s of unwrap(stu, 'Students')) {
        const k = String(s.org_id);
        stuCounts.set(k, (stuCounts.get(k) || 0) + 1);
      }
    } catch {}

    // Trial end dates + per-org student-cap overrides (per org).
    let trialEnds = new Map();
    let overrides = new Map();
    try {
      const sr = await zcqlAll(
        req,
        `SELECT org_id, setting_key, setting_value FROM AppSettings WHERE AppSettings.setting_key IN ('plan.trial_ends_at', 'plan.max_students_override')`,
        'AppSettings'
      );
      for (const r of unwrap(sr, 'AppSettings')) {
        if (r.setting_key === 'plan.trial_ends_at')         trialEnds.set(String(r.org_id), r.setting_value);
        if (r.setting_key === 'plan.max_students_override') overrides.set(String(r.org_id), r.setting_value);
      }
    } catch {}

    const decorated = orgs.map((o) => {
      const opts = { trialEndsAt: trialEnds.get(String(o.id)), createdAt: o.created_at };
      const eff = effectivePlan(o.plan, opts);
      const planDefault = planMaxStudents(eff); // null = unlimited
      const rawOverride = overrides.get(String(o.id));
      let override = null;
      if (rawOverride != null && String(rawOverride).trim() !== '') {
        const n = parseInt(rawOverride, 10);
        if (Number.isFinite(n) && n >= 0) override = n;
      }
      return {
        ...o,
        member_count:          memCounts.get(String(o.id)) || 0,
        student_count:         stuCounts.get(String(o.id)) || 0,
        effective_plan:        eff,
        plan_max_students:     planDefault,                       // the plan's own cap
        max_students_override: override,                          // per-org override or null
        max_students:          override != null ? override : planDefault, // effective cap
        trial:                 trialInfo(o.plan, opts),
      };
    }).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    res.json({ orgs: decorated });
  } catch (e) {
    res.status(500).json({ error: 'Failed to list orgs', detail: e.message });
  }
});

// =============================================================================
// PUT /api/platform/orgs/:id — platform-admin only (Catalyst App Admin).
// Allowed Organizations patch: name, slug, status, plan.
// Also accepts system-managed extras (stored in AppSettings, not on the org):
//   trial_days   — when setting plan=trial, length of the trial window
//   max_students — per-org student cap override (number, or null/'' to clear)
// =============================================================================
router.put('/orgs/:id', async (req, res) => {
  try {
    const existing = await zcql(req, `SELECT * FROM Organizations WHERE ROWID = ${Number(req.params.id)}`);
    const org = unwrap(existing, 'Organizations')[0];
    if (!org) return res.status(404).json({ error: 'Org not found' });

    const patch = {};
    if (req.body.name   !== undefined) patch.name   = String(req.body.name).slice(0, 200);
    if (req.body.slug   !== undefined) patch.slug   = slugify(req.body.slug);
    if (req.body.status !== undefined) patch.status = String(req.body.status).slice(0, 20);
    if (req.body.plan   !== undefined) patch.plan   = String(req.body.plan).slice(0, 20);

    // When flipping an org TO trial, (re)start the clock from now by stamping
    // plan.trial_ends_at in that org's AppSettings. The length defaults to 14
    // days but the platform admin can pass `trial_days` to set a custom window.
    // This is a system-managed key (NOT in the Settings whitelist) so the
    // academy can't extend its own trial via PUT /settings/app.
    if (patch.plan !== undefined && normalizePlan(patch.plan) === 'trial') {
      let days = parseInt(req.body.trial_days, 10);
      if (!Number.isFinite(days) || days <= 0) days = TRIAL_DURATION_DAYS;
      if (days > 365) days = 365; // sane upper bound
      const endsAt = new Date(Date.now() + days * 86400000).toISOString();
      await upsertOrgSetting(req, Number(req.params.id), 'plan.trial_ends_at', endsAt);
    }

    // Per-org student cap override. '' or null clears it (back to plan default).
    if (req.body.max_students !== undefined) {
      const v = req.body.max_students;
      if (v === null || String(v).trim() === '') {
        await upsertOrgSetting(req, Number(req.params.id), 'plan.max_students_override', '');
      } else {
        let n = parseInt(v, 10);
        if (!Number.isFinite(n) || n < 0) n = 0;
        if (n > 100000) n = 100000; // sane upper bound
        await upsertOrgSetting(req, Number(req.params.id), 'plan.max_students_override', String(n));
      }
    }

    // Only touch the Organizations row if there's an actual column change —
    // a settings-only PUT (e.g. just max_students) leaves the org row alone.
    const updated = Object.keys(patch).length
      ? await update(req, 'Organizations', req.params.id, patch)
      : org;
    res.json({ org: normalize(updated) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update org', detail: e.message });
  }
});

// ----- helpers --------------------------------------------------------------

// Upsert a single AppSettings key for an arbitrary org (platform-admin scope).
// Used to stamp system-managed plan metadata (e.g. trial end date).
async function upsertOrgSetting(req, orgId, key, value) {
  try {
    const safeKey = String(key).replace(/'/g, "''");
    const rows = await zcql(
      req,
      `SELECT ROWID FROM AppSettings WHERE AppSettings.org_id = ${Number(orgId)} AND AppSettings.setting_key = '${safeKey}'`
    );
    const existing = unwrap(rows, 'AppSettings')[0];
    if (existing) {
      await update(req, 'AppSettings', existing.ROWID, { setting_value: value });
    } else {
      await insert(req, 'AppSettings', { setting_key: key, setting_value: value, org_id: Number(orgId) });
    }
  } catch (e) {
    console.error('upsertOrgSetting failed for', key, e.message); // non-fatal
  }
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

module.exports = router;
