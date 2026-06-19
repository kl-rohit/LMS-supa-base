// requireModule — server-side paywall for premium modules.
//
// Mount AFTER resolveOrg (which attaches req.orgPlan) on a premium route group:
//
//   app.use('/api/lessons', requireAuth, resolveOrg, requireOrgId,
//           requireModule('lessons'), require('./routes/lessons'));
//
// When the calling org's plan doesn't include the module it returns 402
// (Payment Required) with a machine-readable body the client can act on
// (show an "Upgrade to Complete" prompt). The platform admin always bypasses
// so support/impersonation can reach any org's data.

const { isModuleEntitled, normalizePlan } = require('../lib/plans');

function requireModule(moduleKey) {
  return function entitlementGate(req, res, next) {
    if (req.isPlatformAdmin) return next(); // platform owner bypass
    if (isModuleEntitled(req.orgPlan, moduleKey)) return next();
    return res.status(402).json({
      error: 'upgrade_required',
      module: moduleKey,
      plan: normalizePlan(req.orgPlan),
      message: `Your plan does not include the "${moduleKey}" module. Upgrade to Complete to enable it.`,
    });
  };
}

module.exports = { requireModule };
