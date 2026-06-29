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

// Per-feature plan map (key -> { core, complete }), generated from the feature
// catalog in config.master.js. Empty object if config not generated yet.
let FEATURE_PLANS = {};
try { FEATURE_PLANS = require('../config').FEATURE_PLANS || {}; } catch (e) { /* not generated */ }

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

// Is a single catalog feature available on the org's effective plan? The plan
// resolves to one of the two pricing columns: complete/trial read the
// `complete` flag; core/free/anything-else read the `core` flag. Unknown keys
// fail OPEN (treated as enabled) so a typo never hard-blocks a route.
function isFeatureEnabled(plan, key) {
  const f = FEATURE_PLANS[key];
  if (!f) return true;
  const p = normalizePlan(plan);
  const usesComplete = (p === 'complete' || p === 'trial');
  return usesComplete ? f.complete !== false : f.core !== false;
}

// Express guard for a single feature key. Mirrors requireModule: 402 when the
// plan does not include it, platform admin bypasses. Use at a route group
// (module-level) or on a single endpoint (a sub-feature like fees.upi_qr).
function requireFeature(featureKey) {
  return function featureGate(req, res, next) {
    if (req.isPlatformAdmin) return next();
    if (isFeatureEnabled(req.orgPlan, featureKey)) return next();
    return res.status(402).json({
      error: 'upgrade_required',
      feature: featureKey,
      plan: normalizePlan(req.orgPlan),
      message: 'This feature is not included in your current plan.',
    });
  };
}

module.exports = { requireModule, requireFeature, isFeatureEnabled };
