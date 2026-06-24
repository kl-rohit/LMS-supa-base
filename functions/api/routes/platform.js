// /api/platform/* — platform-level admin endpoints.
//
// Sits ABOVE the org-scope layer. Today it just hosts the one-off Phase A
// bootstrap that creates the first org + backfills org_id on existing data.
// Future siblings: list all orgs, suspend an org, impersonate, etc.
//
// Mounted in index.js under the standard requireAuth + requireAdmin chain,
// so only Catalyst "App Administrator" users (i.e. you) can reach these.

const router = require('express').Router();
const catalyst = require('zcatalyst-sdk-node');
const {
  insert, update, zcql, zcqlAll, unwrap, normalize, safeId, appFor, readCount, mapLimit,
} = require('../db/catalystDb');
const { normalizePlan, effectivePlan, trialInfo, planMaxStudents, TRIAL_DURATION_DAYS } = require('../lib/plans');
const { ADMIN_KEY: ONBOARDING_ADMIN_KEY, SETUP_KEY: ONBOARDING_SETUP_KEY } = require('../lib/onboarding');
const { MODULES } = require('../db/migrationRegistry');
const { writeAudit } = require('../lib/audit');
const { createAdminNotifications } = require('../lib/notify');

// Admin module toggles a platform admin may flip per org. Mirrors the DEFAULTS
// in client/src/hooks/useModuleFlags.js — keep the two in sync. Premium modules
// are also plan-gated client-side, but the stored flag is still settable here.
const MODULE_FLAGS = [
  { key: 'modules.groups',          label: 'Groups',          default: true,  premium: false },
  { key: 'modules.fees',            label: 'Fees',            default: true,  premium: false },
  { key: 'modules.messages',        label: 'Messages',        default: true,  premium: false },
  { key: 'modules.reports',         label: 'Reports',         default: true,  premium: false },
  { key: 'modules.camps',           label: 'Camps',           default: false, premium: false },
  { key: 'modules.student_photos',  label: 'Student photos',  default: true,  premium: false },
  { key: 'modules.lessons',         label: 'Lessons',         default: true,  premium: true  },
  { key: 'modules.assignments',     label: 'Assignments',     default: false, premium: true  },
  { key: 'modules.question_papers', label: 'Question papers', default: false, premium: true  },
];
const MODULE_FLAG_KEYS = new Set(MODULE_FLAGS.map((m) => m.key));

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
      // Child rows (memberships, students, AppSettings) tag org_id with the
      // ROUNDED Number(org_id), while o.id is the EXACT ROWID string. Look the
      // maps up by the same rounded key so 17-digit ROWIDs still match.
      const key = String(Number(o.id));
      const opts = { trialEndsAt: trialEnds.get(key), createdAt: o.created_at };
      const eff = effectivePlan(o.plan, opts);
      const planDefault = planMaxStudents(eff); // null = unlimited
      const rawOverride = overrides.get(key);
      let override = null;
      if (rawOverride != null && String(rawOverride).trim() !== '') {
        const n = parseInt(rawOverride, 10);
        if (Number.isFinite(n) && n >= 0) override = n;
      }
      return {
        ...o,
        member_count:          memCounts.get(key) || 0,
        student_count:         stuCounts.get(key) || 0,
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
    // ROWIDs are 17-digit numbers that exceed JS Number precision — use safeId
    // (exact digits-only string) for the WHERE ROWID lookup, never Number().
    const rowId = safeId(req.params.id);
    if (!rowId) return res.status(400).json({ error: 'Invalid org id' });
    const existing = await zcql(req, `SELECT * FROM Organizations WHERE ROWID = ${rowId}`);
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

    // Re-arm onboarding for an org so its owner sees the first-login walkthrough
    // again on next app load. This flag is otherwise only set at signup, and the
    // academy can clear it but cannot set it (Settings whitelist allows 'false'
    // only), so re-triggering lives here, at platform-admin scope.
    //   reset_onboarding: true        → replays the welcome TOUR
    //   reset_onboarding: 'setup'     → also replays the first-run SETUP WIZARD
    if (req.body.reset_onboarding) {
      await upsertOrgSetting(req, Number(req.params.id), ONBOARDING_ADMIN_KEY, 'true');
      if (req.body.reset_onboarding === 'setup') {
        await upsertOrgSetting(req, Number(req.params.id), ONBOARDING_SETUP_KEY, 'true');
      }
    }

    // Only touch the Organizations row if there's an actual column change —
    // a settings-only PUT (e.g. just max_students) leaves the org row alone.
    const updated = Object.keys(patch).length
      ? await update(req, 'Organizations', req.params.id, patch)
      : org;

    // Audit the meaningful actions (fail-safe — never blocks the response).
    const orgName = org.name || '';
    if (req.body.status !== undefined) {
      await writeAudit(req, { action: 'org.status_change', orgId: org.ROWID, orgName, detail: { from: org.status, to: patch.status } });
    }
    if (req.body.plan !== undefined) {
      await writeAudit(req, { action: 'org.plan_change', orgId: org.ROWID, orgName, detail: { from: org.plan, to: patch.plan, trial_days: req.body.trial_days } });
    }
    if (req.body.max_students !== undefined) {
      await writeAudit(req, { action: 'org.student_cap', orgId: org.ROWID, orgName, detail: { max_students: req.body.max_students } });
    }
    if (req.body.reset_onboarding) {
      await writeAudit(req, { action: 'org.reset_onboarding', orgId: org.ROWID, orgName, detail: { mode: req.body.reset_onboarding } });
    }

    res.json({ org: normalize(updated) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update org', detail: e.message });
  }
});

// =============================================================================
// GET /api/platform/orgs/:id/detail — platform-admin only.
// Deep view of a single org: basics + plan/trial decoration, module-wise
// record counts (how much data the academy has created), and its members.
// Counts come from the shared MODULES registry so this list stays in sync
// with the rest of the app as tables are added.
// =============================================================================
router.get('/orgs/:id/detail', async (req, res) => {
  try {
    // Organizations ROWID lookup needs the EXACT id (safeId) — Number() rounds
    // 17-digit ROWIDs and silently misses the row ("Org not found"). Child
    // tables tag org_id with the rounded Number(org_id), so keep that for them.
    const rowId = safeId(req.params.id);
    if (!rowId) return res.status(400).json({ error: 'Invalid org id' });
    const orgId = Number(req.params.id);
    const existing = await zcql(req, `SELECT * FROM Organizations WHERE ROWID = ${rowId}`);
    const org = normalize(unwrap(existing, 'Organizations')[0] || null);
    if (!org) return res.status(404).json({ error: 'Org not found' });

    // Plan + trial decoration (same shape as GET /orgs).
    let trialEndsAt = null;
    let rawOverride = null;
    try {
      const sr = await zcql(
        req,
        `SELECT setting_key, setting_value FROM AppSettings WHERE AppSettings.org_id = ${orgId} AND AppSettings.setting_key IN ('plan.trial_ends_at', 'plan.max_students_override')`
      );
      for (const r of unwrap(sr, 'AppSettings')) {
        if (r.setting_key === 'plan.trial_ends_at')         trialEndsAt = r.setting_value;
        if (r.setting_key === 'plan.max_students_override') rawOverride = r.setting_value;
      }
    } catch {}

    const opts = { trialEndsAt, createdAt: org.created_at };
    const eff = effectivePlan(org.plan, opts);
    const planDefault = planMaxStudents(eff);
    let override = null;
    if (rawOverride != null && String(rawOverride).trim() !== '') {
      const n = parseInt(rawOverride, 10);
      if (Number.isFinite(n) && n >= 0) override = n;
    }

    // Module-wise record counts. Bounded concurrency — a bare Promise.all over
    // every table trips Catalyst's in-flight-query cap. readCount() un-wraps the
    // ZCRecord aggregate (a raw `rows[0][table].c` reads back as a silent 0).
    const counts = await mapLimit(MODULES, async (m) => {
      try {
        const rows = await zcql(req, `SELECT COUNT(ROWID) AS c FROM ${m.table} WHERE ${m.table}.org_id = ${orgId}`);
        return { key: m.key, label: m.label, table: m.table, count: readCount(rows, m.table) };
      } catch (e) {
        // table may genuinely be absent, or the query errored — surface the
        // reason so the drawer can show why a module reads as unavailable.
        return { key: m.key, label: m.label, table: m.table, count: null, detail: e.message };
      }
    });

    // Members of this org.
    let members = [];
    try {
      const mr = await zcqlAll(req, `SELECT * FROM OrgMemberships WHERE OrgMemberships.org_id = ${orgId}`, 'OrgMemberships');
      members = unwrap(mr, 'OrgMemberships').map((m) => ({
        user_id:    m.user_id,
        role:       m.role,
        status:     m.status,
        created_at: m.created_at || m.CREATEDTIME || null,
      }));
    } catch {}

    // Module toggles — current stored value per flag (falling back to default).
    const stored = {};
    try {
      const keyList = MODULE_FLAGS.map((m) => `'${m.key}'`).join(', ');
      const fr = await zcql(
        req,
        `SELECT setting_key, setting_value FROM AppSettings WHERE AppSettings.org_id = ${orgId} AND AppSettings.setting_key IN (${keyList})`
      );
      for (const r of unwrap(fr, 'AppSettings')) stored[r.setting_key] = r.setting_value;
    } catch {}
    const module_flags = MODULE_FLAGS.map((m) => {
      const v = stored[m.key];
      const enabled = v === 'true' ? true : v === 'false' ? false : m.default;
      return { key: m.key, label: m.label, premium: m.premium, enabled };
    });

    res.json({
      org: {
        ...org,
        effective_plan:        eff,
        plan_max_students:     planDefault,
        max_students_override: override,
        max_students:          override != null ? override : planDefault,
        trial:                 trialInfo(org.plan, opts),
        member_count:          members.length,
      },
      counts,
      members,
      module_flags,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load org detail', detail: e.message });
  }
});

// =============================================================================
// GET /api/platform/orgs/:id/members — platform-admin only. Members of one
// academy enriched with the real name + email (the "Show PII" reveal). Kept
// out of the default /detail payload so the drawer loads fast and personal
// data is only fetched when the platform admin explicitly asks for it.
// Catalyst user details are resolved with bounded concurrency to stay under
// the in-flight request cap. A user whose details cannot be resolved still
// appears, with email/name left blank.
// =============================================================================
router.get('/orgs/:id/members', async (req, res) => {
  try {
    const rowId = safeId(req.params.id);
    if (!rowId) return res.status(400).json({ error: 'Invalid org id' });
    const orgId = Number(req.params.id);
    const existing = await zcql(req, `SELECT * FROM Organizations WHERE ROWID = ${rowId}`);
    const org = normalize(unwrap(existing, 'Organizations')[0] || null);
    if (!org) return res.status(404).json({ error: 'Org not found' });

    let rows = [];
    try {
      const mr = await zcqlAll(req, `SELECT * FROM OrgMemberships WHERE OrgMemberships.org_id = ${orgId}`, 'OrgMemberships');
      rows = unwrap(mr, 'OrgMemberships');
    } catch {}

    const um = catalyst.initialize(req, { scope: 'admin' }).userManagement();
    const members = await mapLimit(rows, async (m) => {
      let email = '', name = '';
      try {
        const d = await um.getUserDetails(String(m.user_id));
        const det = d?.user_details || d || {};
        email = det.email_id || '';
        name = [det.first_name, det.last_name].filter(Boolean).join(' ').trim();
      } catch { /* user details unavailable — leave blank */ }
      return {
        user_id:    m.user_id,
        role:       m.role,
        status:     m.status,
        created_at: m.created_at || m.CREATEDTIME || null,
        email,
        name,
      };
    });

    // Reveal of personal data is itself an auditable platform-admin action.
    await writeAudit(req, { action: 'org.view_members_pii', orgId, orgName: org.name || '', detail: { count: members.length } });
    res.json({ members });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load members', detail: e.message });
  }
});

// =============================================================================
// POST /api/platform/orgs/:id/resend-invite — platform-admin only.
// Re-send the owner's access email. Catalyst's forgot-password flow emails a
// link to set a new password, which works whether the owner never accepted
// their original invite OR has simply lost access. Best-effort: surfaces a
// clear error if the owner email cannot be resolved or the email send fails.
// =============================================================================
router.post('/orgs/:id/resend-invite', async (req, res) => {
  try {
    const rowId = safeId(req.params.id);
    if (!rowId) return res.status(400).json({ error: 'Invalid org id' });
    const orgId = Number(req.params.id);
    const existing = await zcql(req, `SELECT * FROM Organizations WHERE ROWID = ${rowId}`);
    const org = normalize(unwrap(existing, 'Organizations')[0] || null);
    if (!org) return res.status(404).json({ error: 'Org not found' });

    // Resolve the owner's user_id — prefer the org's owner_user_id, else fall
    // back to the OrgMembership row with role 'owner'.
    let ownerId = org.owner_user_id ? String(org.owner_user_id) : '';
    if (!ownerId) {
      try {
        const mr = await zcql(req, `SELECT user_id, role FROM OrgMemberships WHERE OrgMemberships.org_id = ${orgId}`);
        const owner = unwrap(mr, 'OrgMemberships').find((m) => m.role === 'owner');
        if (owner) ownerId = String(owner.user_id);
      } catch {}
    }
    if (!ownerId) return res.status(400).json({ error: 'No owner on file for this academy' });

    const adminApp = catalyst.initialize(req, { scope: 'admin' });
    const um = adminApp.userManagement();

    // Look up the owner's email from Catalyst user details.
    let email = '';
    try {
      const details = await um.getUserDetails(ownerId);
      email = details?.email_id || details?.user_details?.email_id || '';
    } catch (e) {
      return res.status(404).json({ error: 'Owner user not found in Catalyst', detail: e.message });
    }
    if (!email) return res.status(400).json({ error: 'Owner has no email on file' });

    // Send the reset / access email.
    try {
      await um.resetPassword(email, { platform_type: 'web' });
    } catch (e) {
      return res.status(502).json({ error: 'Could not send the access email', detail: e.message });
    }

    await writeAudit(req, { action: 'org.resend_invite', orgId: org.ROWID, orgName: org.name || '', detail: { email } });
    res.json({ message: 'Access email sent', email });
  } catch (e) {
    res.status(500).json({ error: 'Failed to resend invite', detail: e.message });
  }
});

// =============================================================================
// GET /api/platform/audit — platform-admin only. Recent audit-log entries,
// newest first. Optional ?limit=N (default 100, max 300) and ?org=<id> filter.
// Returns an empty list (not an error) if the AuditLog table is absent, so the
// UI degrades gracefully until the table is created in the console.
// =============================================================================
router.get('/audit', async (req, res) => {
  try {
    let limit = parseInt(req.query.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 100;
    if (limit > 300) limit = 300; // ZCQL hard cap

    const orgFilter = req.query.org ? Number(req.query.org) : null;
    const where = Number.isFinite(orgFilter) && orgFilter ? ` WHERE AuditLog.target_org_id = ${orgFilter}` : '';
    let entries = [];
    try {
      const rows = await zcql(
        req,
        `SELECT ROWID, actor_user_id, actor_email, action, target_org_id, target_org_name, detail, CREATEDTIME FROM AuditLog${where} ORDER BY CREATEDTIME DESC LIMIT ${limit}`
      );
      entries = unwrap(rows, 'AuditLog').map((r) => {
        let detail = null;
        if (r.detail) { try { detail = JSON.parse(r.detail); } catch { detail = r.detail; } }
        return {
          id:              r.ROWID,
          actor_user_id:   r.actor_user_id,
          actor_email:     r.actor_email,
          action:          r.action,
          target_org_id:   r.target_org_id,
          target_org_name: r.target_org_name,
          detail,
          created_at:      r.CREATEDTIME,
        };
      });
    } catch (e) {
      // Table not created yet — return empty + a flag so the UI can hint at setup.
      return res.json({ entries: [], available: false });
    }
    res.json({ entries, available: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load audit log', detail: e.message });
  }
});

// =============================================================================
// PUT /api/platform/orgs/:id/module-flag — platform-admin only.
// Flip one module toggle for a single academy. Body: { flag, enabled }.
// Only allowlisted module flags may be set (MODULE_FLAGS). Stored in the org's
// AppSettings as 'true'/'false', the same convention useModuleFlags reads.
// =============================================================================
router.put('/orgs/:id/module-flag', async (req, res) => {
  try {
    const rowId = safeId(req.params.id);
    if (!rowId) return res.status(400).json({ error: 'Invalid org id' });
    const orgId = Number(req.params.id);
    const flag = String(req.body.flag || '');
    if (!MODULE_FLAG_KEYS.has(flag)) {
      return res.status(400).json({ error: 'Unknown module flag', detail: flag });
    }
    const enabled = req.body.enabled === true || req.body.enabled === 'true';

    const existing = await zcql(req, `SELECT * FROM Organizations WHERE ROWID = ${rowId}`);
    const org = normalize(unwrap(existing, 'Organizations')[0] || null);
    if (!org) return res.status(404).json({ error: 'Org not found' });

    await upsertOrgSetting(req, orgId, flag, enabled ? 'true' : 'false');
    await writeAudit(req, { action: 'org.module_flag', orgId, orgName: org.name || '', detail: { flag, enabled } });

    res.json({ flag, enabled });
  } catch (e) {
    res.status(500).json({ error: 'Failed to set module flag', detail: e.message });
  }
});

// =============================================================================
// GET /api/platform/metrics — platform-admin only. Activation funnel across
// all orgs: how many signed up, finished first-run setup, added a first
// student, and marked first attendance. Uses GROUP BY so the row count equals
// the (small) number of distinct orgs, well under the ZCQL 300-row cap.
// =============================================================================
router.get('/metrics', async (req, res) => {
  try {
    // All org ids. Child tables (AppSettings, Students, Attendance) tag org_id
    // with the ROUNDED Number(org_id), so key the funnel comparison the same way
    // — String(o.ROWID) (exact) would never match the rounded child keys.
    const orgRows = await zcqlAll(req, `SELECT ROWID FROM Organizations`, 'Organizations');
    const orgIds = unwrap(orgRows, 'Organizations').map((o) => String(Number(o.ROWID)));
    const total = orgIds.length;

    // Orgs that have NOT finished setup still carry onboarding.setup_pending = 'true'.
    const setupPending = new Set();
    try {
      const sr = await zcqlAll(
        req,
        `SELECT org_id, setting_value FROM AppSettings WHERE AppSettings.setting_key = '${ONBOARDING_SETUP_KEY}'`,
        'AppSettings'
      );
      for (const r of unwrap(sr, 'AppSettings')) {
        if (r.setting_value === 'true') setupPending.add(String(r.org_id));
      }
    } catch {}
    const setupDone = orgIds.filter((id) => !setupPending.has(id)).length;

    // Orgs with at least one student / one attendance row (GROUP BY → one row/org).
    const orgsWith = async (table) => {
      const set = new Set();
      try {
        const rows = await zcqlAll(req, `SELECT org_id, COUNT(ROWID) AS c FROM ${table} GROUP BY org_id`, table);
        for (const r of unwrap(rows, table)) {
          if (Number(r.c) > 0) set.add(String(r.org_id));
        }
      } catch {}
      return set;
    };
    const [withStudents, withAttendance] = await Promise.all([
      orgsWith('Students'),
      orgsWith('Attendance'),
    ]);

    res.json({
      funnel: {
        signed_up:        total,
        finished_setup:   setupDone,
        added_student:    orgIds.filter((id) => withStudents.has(id)).length,
        marked_attendance: orgIds.filter((id) => withAttendance.has(id)).length,
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to compute metrics', detail: e.message });
  }
});

// =============================================================================
// GET /api/platform/orgs/:id/export — platform-admin only. Full JSON dump of
// every tenant table's rows for one org (support deep-dives / offboarding).
// Paginated reads via zcqlAll so large tables come through completely.
// =============================================================================
router.get('/orgs/:id/export', async (req, res) => {
  try {
    const rowId = safeId(req.params.id);
    if (!rowId) return res.status(400).json({ error: 'Invalid org id' });
    const orgId = Number(req.params.id);
    const existing = await zcql(req, `SELECT * FROM Organizations WHERE ROWID = ${rowId}`);
    const org = normalize(unwrap(existing, 'Organizations')[0] || null);
    if (!org) return res.status(404).json({ error: 'Org not found' });

    // Bounded concurrency — an unbounded Promise.all over every table (each
    // doing its own paginated reads) trips Catalyst's in-flight-query cap and
    // the over-cap reads reject, which is why the export came back empty.
    const tables = {};
    await mapLimit(MODULES, async (m) => {
      try {
        const rows = await zcqlAll(req, `SELECT * FROM ${m.table} WHERE ${m.table}.org_id = ${orgId}`, m.table);
        tables[m.table] = unwrap(rows, m.table).map(normalize);
      } catch (_e) {
        tables[m.table] = null; // table may not exist in this project
      }
    });

    res.json({
      org: { id: org.ROWID, name: org.name, slug: org.slug, plan: org.plan, status: org.status },
      exported_at: new Date().toISOString(),
      tables,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to export org', detail: e.message });
  }
});

// =============================================================================
// POST /api/platform/notifications/broadcast — platform-admin only.
// Send an in-app notification (with web push) to academy owners/teachers.
//   Body: { target: 'all' | '<orgId>', title, body, link }
//     target 'all'   → every academy receives it
//     target '<id>'  → only that one academy
// Each academy gets one admin-level Notifications row (recipient_role='admin'),
// so it lands in the owner's dashboard bell. Best-effort and bounded so a large
// fan-out stays within Catalyst's in-flight-query cap.
// =============================================================================
router.post('/notifications/broadcast', async (req, res) => {
  try {
    const title = String(req.body?.title || '').trim();
    if (!title) return res.status(400).json({ error: 'A title is required' });
    const body = String(req.body?.body || '').trim();
    const link = String(req.body?.link || '').trim();
    const type = 'announcement';

    const rawTarget = req.body?.target;
    const targetAll = rawTarget === 'all' || rawTarget == null || rawTarget === '';

    // Resolve the list of target org ids.
    let targets = [];
    let scopeLabel = 'all academies';
    if (targetAll) {
      const orgRows = await zcqlAll(req, `SELECT ROWID, name FROM Organizations`, 'Organizations');
      targets = unwrap(orgRows, 'Organizations').map((o) => ({ id: Number(o.ROWID), name: o.name || '' }));
    } else {
      const rowId = safeId(rawTarget);
      if (!rowId) return res.status(400).json({ error: 'Invalid target org id' });
      const existing = await zcql(req, `SELECT ROWID, name FROM Organizations WHERE ROWID = ${rowId}`);
      const org = unwrap(existing, 'Organizations')[0];
      if (!org) return res.status(404).json({ error: 'Org not found' });
      targets = [{ id: Number(org.ROWID), name: org.name || '' }];
      scopeLabel = org.name || `org ${org.ROWID}`;
    }

    if (!targets.length) return res.json({ message: 'No academies to notify', delivered: 0, push: 0, orgs: 0 });

    // Fan out with bounded concurrency. createAdminNotifications is best-effort
    // per org (a single failure never rejects the batch).
    const results = await mapLimit(targets, async (t) => {
      try {
        const r = await createAdminNotifications(req, { orgId: t.id, type, title, body, link });
        return { created: r.created || 0, pushed: r.pushed || 0 };
      } catch (e) {
        return { created: 0, pushed: 0, error: e.message };
      }
    });

    const delivered = results.reduce((n, r) => n + (r.created || 0), 0);
    const push = results.reduce((n, r) => n + (r.pushed || 0), 0);

    await writeAudit(req, {
      action: 'platform.broadcast',
      orgId: targetAll ? null : targets[0].id,
      orgName: scopeLabel,
      detail: { target: targetAll ? 'all' : String(targets[0].id), title, orgs: targets.length, delivered, push },
    });

    res.json({ message: `Sent to ${scopeLabel}`, orgs: targets.length, delivered, push });
  } catch (e) {
    res.status(500).json({ error: 'Failed to send broadcast', detail: e.message });
  }
});

// =============================================================================
// GET /api/platform/engagement — platform-admin only. Per-org "last active"
// signal so you can spot academies that have gone quiet and reach out before
// they lapse. For each org we take the most recent CREATEDTIME across the key
// activity tables (attendance marked, payments recorded, messages sent,
// students added) and report days since. GROUP BY org_id keeps every query at
// one row per org, well under the ZCQL 300-row cap. Best-effort per table.
// =============================================================================
router.get('/engagement', async (req, res) => {
  try {
    const orgRows = await zcqlAll(req, `SELECT ROWID, name, CREATEDTIME FROM Organizations`, 'Organizations');
    const orgs = unwrap(orgRows, 'Organizations');

    // Activity tables, in priority order, and the friendly label per signal.
    const ACTIVITY = [
      { table: 'Attendance', label: 'attendance' },
      { table: 'Payments',   label: 'payment' },
      { table: 'Messages',   label: 'message' },
      { table: 'Students',   label: 'student' },
    ];

    // rounded org id -> { ts, signals: { attendance: iso, ... } }
    const lastByOrg = new Map();
    for (const a of ACTIVITY) {
      try {
        const rows = await zcqlAll(
          req,
          `SELECT org_id, MAX(CREATEDTIME) AS last_at FROM ${a.table} GROUP BY org_id`,
          a.table
        );
        for (const r of unwrap(rows, a.table)) {
          if (!r.last_at) continue;
          const k = String(r.org_id);
          const ts = new Date(r.last_at).getTime();
          if (!Number.isFinite(ts)) continue;
          const cur = lastByOrg.get(k) || { ts: 0, signals: {} };
          cur.signals[a.label] = r.last_at;
          if (ts > cur.ts) cur.ts = ts;
          lastByOrg.set(k, cur);
        }
      } catch { /* table absent or aggregate unsupported — skip this signal */ }
    }

    const now = Date.now();
    const engagement = orgs.map((o) => {
      const key = String(Number(o.ROWID));
      const rec = lastByOrg.get(key);
      const lastTs = rec?.ts || 0;
      const createdTs = o.CREATEDTIME ? new Date(o.CREATEDTIME).getTime() : 0;
      const refTs = lastTs || createdTs; // fall back to signup date when never active
      const daysIdle = refTs ? Math.floor((now - refTs) / 86400000) : null;
      const ageDays = createdTs ? Math.floor((now - createdTs) / 86400000) : null;
      return {
        id:             o.ROWID,
        name:           o.name || '',
        last_active_at: lastTs ? new Date(lastTs).toISOString() : null,
        days_idle:      daysIdle,
        age_days:       ageDays,
        signals:        rec?.signals || {},
      };
    }).sort((a, b) => (b.days_idle ?? -1) - (a.days_idle ?? -1));

    res.json({ engagement });
  } catch (e) {
    res.status(500).json({ error: 'Failed to compute engagement', detail: e.message });
  }
});

// =============================================================================
// GET /api/platform/search?q=... — platform-admin only. One search box that
// spans every tenant: academies (by name or slug) and people (students plus
// their parent/contact, by name, parent name, or mobile). Each person result
// carries its org so you can jump to the right academy. Personal contact
// reveal still lives behind the audited per-org members endpoint; this only
// surfaces the already-stored student/parent record so a support request can
// be located fast. Min 2 chars; results are bounded.
// =============================================================================
router.get('/search', async (req, res) => {
  try {
    const raw = String(req.query.q || '').trim();
    if (raw.length < 2) return res.json({ query: raw, academies: [], people: [] });
    const term = raw.replace(/'/g, "''").slice(0, 80);
    const like = `'%${term}%'`;

    // Academies by name / slug.
    let academies = [];
    try {
      const rows = await zcql(
        req,
        `SELECT ROWID, name, slug, status, plan FROM Organizations WHERE Organizations.name LIKE ${like} OR Organizations.slug LIKE ${like} LIMIT 50`
      );
      academies = unwrap(rows, 'Organizations').map((o) => ({
        id: o.ROWID, name: o.name || '', slug: o.slug || '', status: o.status || 'active', plan: o.plan || '',
      }));
    } catch { /* Organizations missing — leave empty */ }

    // People: students and their parent/contact across all orgs.
    let people = [];
    try {
      const rows = await zcql(
        req,
        `SELECT ROWID, org_id, name, parent_name, mobile_number FROM Students WHERE Students.name LIKE ${like} OR Students.parent_name LIKE ${like} OR Students.mobile_number LIKE ${like} LIMIT 100`
      );
      people = unwrap(rows, 'Students').map((s) => ({
        id: s.ROWID, org_id: s.org_id, name: s.name || '', parent_name: s.parent_name || '', mobile_number: s.mobile_number || '',
      }));
    } catch { /* Students missing — leave empty */ }

    // Tag each person with their academy name (org_id on children is rounded).
    if (people.length) {
      const orgNames = new Map();
      try {
        const orgRows = await zcqlAll(req, `SELECT ROWID, name FROM Organizations`, 'Organizations');
        for (const o of unwrap(orgRows, 'Organizations')) orgNames.set(String(Number(o.ROWID)), o.name || '');
      } catch {}
      people = people.map((p) => ({ ...p, org_name: orgNames.get(String(p.org_id)) || `Org ${p.org_id}` }));
    }

    res.json({ query: raw, academies, people });
  } catch (e) {
    res.status(500).json({ error: 'Search failed', detail: e.message });
  }
});

// =============================================================================
// Billing & invoices — platform-admin only. A lightweight ledger to record
// what each academy owes and mark invoices paid, since charging is not wired
// to a payment processor yet. Backed by an Invoices table in the Catalyst
// console; if that table is absent every endpoint degrades gracefully
// (GET returns available:false, writes return 503 with a clear hint).
//
//   Invoices columns (Data Store):
//     org_id    bigint     the academy this invoice is for
//     amount    double     amount due (rupees)
//     period    varchar    free-form label, e.g. "Jun 2026"
//     status    varchar    pending | paid | void
//     due_date  varchar    YYYY-MM-DD (optional)
//     paid_at   varchar    ISO timestamp, stamped when marked paid
//     notes     varchar    optional memo
// =============================================================================
const INVOICE_STATUSES = ['pending', 'paid', 'void'];

router.get('/invoices', async (req, res) => {
  try {
    const orgFilter = req.query.org ? Number(req.query.org) : null;
    const where = Number.isFinite(orgFilter) && orgFilter ? ` WHERE Invoices.org_id = ${orgFilter}` : '';
    let invoices = [];
    try {
      const rows = await zcqlAll(req, `SELECT * FROM Invoices${where}`, 'Invoices');
      invoices = unwrap(rows, 'Invoices').map(normalize);
    } catch (e) {
      return res.json({ invoices: [], available: false });
    }

    // Decorate with the academy name so the ledger reads clearly.
    const orgNames = new Map();
    try {
      const orgRows = await zcqlAll(req, `SELECT ROWID, name FROM Organizations`, 'Organizations');
      for (const o of unwrap(orgRows, 'Organizations')) orgNames.set(String(Number(o.ROWID)), o.name || '');
    } catch {}

    invoices = invoices
      .map((inv) => ({ ...inv, org_name: orgNames.get(String(inv.org_id)) || `Org ${inv.org_id}` }))
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    res.json({ invoices, available: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load invoices', detail: e.message });
  }
});

router.post('/invoices', async (req, res) => {
  try {
    const orgId = safeId(req.body.org_id);
    if (!orgId) return res.status(400).json({ error: 'A valid org_id is required' });
    const existing = await zcql(req, `SELECT ROWID, name FROM Organizations WHERE ROWID = ${orgId}`);
    const org = unwrap(existing, 'Organizations')[0];
    if (!org) return res.status(404).json({ error: 'Org not found' });

    let amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount < 0) amount = 0;
    const period   = String(req.body.period || '').slice(0, 60);
    const due_date = String(req.body.due_date || '').slice(0, 40);
    const notes    = String(req.body.notes || '').slice(0, 500);
    const status   = INVOICE_STATUSES.includes(req.body.status) ? req.body.status : 'pending';

    let row;
    try {
      row = await insert(req, 'Invoices', {
        org_id:   Number(req.body.org_id),
        amount, period, due_date, notes, status,
        paid_at:  status === 'paid' ? new Date().toISOString() : '',
      });
    } catch (e) {
      return res.status(503).json({
        error: 'Invoices table not set up',
        hint: 'Create an Invoices table in the Catalyst console (Data Store) with columns org_id, amount, period, status, due_date, paid_at, notes.',
        detail: e.message,
      });
    }

    await writeAudit(req, { action: 'invoice.create', orgId: org.ROWID, orgName: org.name || '', detail: { amount, period, status } });
    res.json({ invoice: normalize(row) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create invoice', detail: e.message });
  }
});

router.put('/invoices/:id', async (req, res) => {
  try {
    const rowId = safeId(req.params.id);
    if (!rowId) return res.status(400).json({ error: 'Invalid invoice id' });
    const existing = await zcql(req, `SELECT * FROM Invoices WHERE ROWID = ${rowId}`);
    const inv = unwrap(existing, 'Invoices')[0];
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    const patch = {};
    if (req.body.status !== undefined) {
      const s = String(req.body.status);
      if (!INVOICE_STATUSES.includes(s)) return res.status(400).json({ error: 'Invalid status' });
      patch.status = s;
      patch.paid_at = s === 'paid' ? (inv.paid_at || new Date().toISOString()) : '';
    }
    if (req.body.amount !== undefined) {
      const a = Number(req.body.amount);
      if (Number.isFinite(a) && a >= 0) patch.amount = a;
    }
    if (req.body.period   !== undefined) patch.period   = String(req.body.period).slice(0, 60);
    if (req.body.due_date !== undefined) patch.due_date = String(req.body.due_date).slice(0, 40);
    if (req.body.notes    !== undefined) patch.notes    = String(req.body.notes).slice(0, 500);

    if (!Object.keys(patch).length) return res.json({ invoice: normalize(inv) });

    const updated = await update(req, 'Invoices', req.params.id, patch);
    await writeAudit(req, { action: 'invoice.update', orgId: Number(inv.org_id), orgName: '', detail: { status: patch.status, amount: patch.amount } });
    res.json({ invoice: normalize(updated) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update invoice', detail: e.message });
  }
});

// =============================================================================
// GET /api/platform/broadcasts — platform-admin only. Recent broadcasts you
// have sent, read back from the audit log (action 'platform.broadcast'). Lets
// the composer show a sent history without a separate table. Empty + available
// false when the AuditLog table is not set up yet.
// =============================================================================
router.get('/broadcasts', async (req, res) => {
  try {
    let broadcasts = [];
    try {
      const rows = await zcql(
        req,
        `SELECT ROWID, actor_email, target_org_name, detail, CREATEDTIME FROM AuditLog WHERE AuditLog.action = 'platform.broadcast' ORDER BY CREATEDTIME DESC LIMIT 50`
      );
      broadcasts = unwrap(rows, 'AuditLog').map((r) => {
        let detail = null;
        if (r.detail) { try { detail = JSON.parse(r.detail); } catch { detail = null; } }
        return {
          id:          r.ROWID,
          actor_email: r.actor_email,
          scope:       r.target_org_name,
          detail,
          created_at:  r.CREATEDTIME,
        };
      });
    } catch (e) {
      return res.json({ broadcasts: [], available: false });
    }
    res.json({ broadcasts, available: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load broadcast history', detail: e.message });
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
