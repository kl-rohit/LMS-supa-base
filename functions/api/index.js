// Catalyst AdvancedIO monolith: mounts all Veena API routes.
// Express app exposed via module.exports = app.

const express = require('express');
const cors = require('cors');
const { requireAuth, requireAdmin } = require('./middleware/auth');
const { requireParent } = require('./middleware/parent');
const { resolveOrg, requireOrgId } = require('./middleware/org');
const { requireModule } = require('./middleware/entitlement');
const config = require('./config');

// Build version — written by deploy.sh at deploy time (git SHA + build time).
// Absent in dev / fresh checkouts; fall back to 'dev' so /api/health never errors.
let version = { commit: 'dev', builtAt: null };
try {
  version = require('./version.json');
} catch (_e) { /* no version.json — running locally */ }

const app = express();
app.use(cors());
app.use(express.json({ limit: config.JSON_BODY_LIMIT }));

// Health + landing
app.get('/', (_req, res) => {
  res.json({
    function: 'api',
    routes: [
      '/api/health',
      '/api/auth',
      '/api/students',
      '/api/groups',
      '/api/classes',
      '/api/attendance',
      '/api/fees',
      '/api/messages',
      '/api/reports',
      '/api/dashboard',
      '/api/import',
      '/api/migration (export + import for cross-project data migration)',
      '/api/camps',
      '/api/student-logins (admin)',
      '/api/courses (admin)',
      '/api/lessons (admin)',
      '/api/quizzes (admin)',
      '/api/enrollments (admin)',
      '/api/settings (admin)',
      '/api/platform (platform admin — multi-tenancy)',
      '/api/portal (parent)',
      '/api/internal (cron, shared-secret)',
    ],
  });
});
app.get('/api/health', (_req, res) => res.json({ ok: true, function: 'api', commit: version.commit, builtAt: version.builtAt }));

// /api/auth — public; /me returns 401 itself when logged out.
app.use('/api/auth', require('./routes/auth'));

// /api/verify — PUBLIC certificate verification (no session). Validates an
// HMAC code so it can't be used to enumerate students. Mounted before
// requireAuth on purpose.
app.use('/api/verify', require('./routes/verify'));

// /api/internal/* — unattended jobs (Catalyst cron). Protected by a shared
// secret header (X-Cron-Secret), NOT by the user-session middleware below.
// Must be mounted before requireAuth so the cron can reach it without a login.
app.use('/api/internal', require('./routes/internal'));

// /api/portal/* — any logged-in parent; scoped to their student_id.
app.use('/api/portal', requireAuth, requireParent, require('./routes/portal'));

// /api/platform/* — Catalyst App Administrators only (Rohit, the platform
// owner). Sees cross-org data. NO resolveOrg here — these endpoints
// operate above the tenant boundary.
app.use('/api/platform', requireAuth, requireAdmin, require('./routes/platform'));

// Tenant-scoped routes — any authenticated user with an active
// OrgMembership (or Catalyst App Administrator acting on a specific org).
// resolveOrg attaches req.orgId + req.orgRole; each route uses those to
// filter SELECTs and stamp INSERTs.
app.use('/api/students',       requireAuth, resolveOrg, requireOrgId, require('./routes/students'));
app.use('/api/groups',         requireAuth, resolveOrg, requireOrgId, require('./routes/groups'));
app.use('/api/classes',        requireAuth, resolveOrg, requireOrgId, require('./routes/classes'));
app.use('/api/attendance',     requireAuth, resolveOrg, requireOrgId, require('./routes/attendance'));
app.use('/api/fees',           requireAuth, resolveOrg, requireOrgId, require('./routes/fees'));
app.use('/api/messages',       requireAuth, resolveOrg, requireOrgId, require('./routes/messages'));
app.use('/api/reports',        requireAuth, resolveOrg, requireOrgId, require('./routes/reports'));
app.use('/api/dashboard',      requireAuth, resolveOrg, requireOrgId, require('./routes/dashboard'));
app.use('/api/import',         requireAuth, resolveOrg, requireOrgId, require('./routes/import'));
app.use('/api/migration',      requireAuth, resolveOrg, requireOrgId, require('./routes/migration'));
app.use('/api/camps',          requireAuth, resolveOrg, requireOrgId, require('./routes/camps'));
app.use('/api/student-logins', requireAuth, resolveOrg, requireOrgId, require('./routes/student-logins'));
// Premium routes (Complete plan) — gated by requireModule. quizzes, courses
// and enrollments all ride on the Lessons module entitlement.
app.use('/api/courses',        requireAuth, resolveOrg, requireOrgId, requireModule('lessons'),         require('./routes/courses'));
app.use('/api/lessons',        requireAuth, resolveOrg, requireOrgId, requireModule('lessons'),         require('./routes/lessons'));
app.use('/api/quizzes',        requireAuth, resolveOrg, requireOrgId, requireModule('lessons'),         require('./routes/quizzes'));
app.use('/api/enrollments',    requireAuth, resolveOrg, requireOrgId, requireModule('lessons'),         require('./routes/enrollments'));
app.use('/api/assignments',    requireAuth, resolveOrg, requireOrgId, requireModule('assignments'),     require('./routes/assignments'));
app.use('/api/question-papers',requireAuth, resolveOrg, requireOrgId, requireModule('question_papers'), require('./routes/questionpapers'));
app.use('/api/settings',       requireAuth, resolveOrg, requireOrgId, require('./routes/settings'));
app.use('/api/organization',   requireAuth, resolveOrg, requireOrgId, require('./routes/organization'));
app.use('/api/notifications',  requireAuth, resolveOrg, requireOrgId, require('./routes/notifications'));

module.exports = app;
