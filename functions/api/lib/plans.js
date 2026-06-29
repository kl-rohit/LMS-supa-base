// Plan / module entitlement definitions — the single source of truth for what
// each subscription plan unlocks. Used by:
//   - middleware/entitlement.js  → server-side paywall on premium routes
//   - middleware/org.js          → computes the effective plan (trial expiry)
//   - routes/settings.js         → tells the client plan/entitlements/limits
//   - routes/students.js         → enforces the active-student cap
//   - routes/platform.js         → platform admin sets an org's plan
//
// Model: an org has a `plan` (Organizations.plan). The plan decides which
// PREMIUM modules are unlocked AND how many active students it may have.
// CORE modules are always available on every plan. Within their entitlement,
// an academy can still toggle modules on/off for their own convenience
// (Settings → Modules) — but they can never enable a premium module their
// plan doesn't include.
//
// Four tiers:
//   trial    — full access (everything Complete unlocks), 14-day window, then
//              auto-downgrades to Free until the academy picks a paid plan.
//   free     — core modules only, capped at 2 active students.
//   core     — core modules only, unlimited students.
//   complete — everything, unlimited students.
//
// Backward compatibility: any UNRECOGNISED plan ('', null, legacy strings) is
// GRANDFATHERED to full access ('complete') so we never strip features from a
// live academy by accident. NOTE: the literal string 'free' is now a REAL
// restricted tier — orgs that were created with plan 'free' before this shipped
// must be moved to 'complete' (or another paid plan) by the platform admin.

// Premium modules — the paid "Complete" tier. Everything else is core.
// Quizzes & certificates ride on the Lessons module (no separate gate).
// Sourced from the generated config (functions/api/config.js), which
// gen-config.js derives from the feature catalog in config.master.js, so the
// pricing sheet and this server-side paywall always agree. The literal below
// is only a fallback when the generated value is absent (older build).
let PREMIUM_MODULES;
try { PREMIUM_MODULES = require('../config').PREMIUM_MODULES; } catch (e) { /* config not generated yet */ }
if (!Array.isArray(PREMIUM_MODULES) || PREMIUM_MODULES.length === 0) {
  PREMIUM_MODULES = ['lessons', 'assignments', 'question_papers'];
}

// How long a trial lasts from its start (org creation, or the moment the
// platform admin flips an org to 'trial').
const TRIAL_DURATION_DAYS = 14;

const PLANS = {
  trial:    { id: 'trial',    label: 'Trial',    premium: [...PREMIUM_MODULES], maxStudents: null },
  free:     { id: 'free',     label: 'Free',     premium: [],                   maxStudents: 2 },
  core:     { id: 'core',     label: 'Core',     premium: [],                   maxStudents: null },
  complete: { id: 'complete', label: 'Complete', premium: [...PREMIUM_MODULES], maxStudents: null },
};

// Normalise any stored plan value to a known plan id. Unknown / legacy values
// ('', null, anything unrecognised) grandfather to 'complete' (full access).
function normalizePlan(plan) {
  const p = String(plan || '').trim().toLowerCase();
  if (p === 'trial')    return 'trial';
  if (p === 'free')     return 'free';
  if (p === 'core')     return 'core';
  if (p === 'complete') return 'complete';
  return 'complete'; // grandfather genuinely-unknown/empty → full access
}

// Human-readable label for a plan.
function planLabel(plan) {
  return PLANS[normalizePlan(plan)].label;
}

// Max active students for a plan. null = unlimited.
function planMaxStudents(plan) {
  return PLANS[normalizePlan(plan)].maxStudents;
}

// Strip a leading 'modules.' prefix so callers can pass either form.
function moduleKey(m) {
  return String(m || '').replace(/^modules\./, '');
}

// The premium modules unlocked by a plan.
function premiumEntitlements(plan) {
  return PLANS[normalizePlan(plan)].premium;
}

// Is a given module available on this plan? Core modules are always true.
function isModuleEntitled(plan, m) {
  const key = moduleKey(m);
  if (!PREMIUM_MODULES.includes(key)) return true; // core module — always allowed
  return premiumEntitlements(plan).includes(key);
}

// ---- Trial expiry ---------------------------------------------------------
// A trial is "full access" until it expires, then it behaves like Free. We
// don't mutate the stored plan on expiry (no cron needed for correctness) —
// the EFFECTIVE plan is computed on every request from the stored plan + the
// trial's end date.

function msFrom(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

// Resolve when a trial ends. Prefer an explicit stored end date
// (plan.trial_ends_at, set when the admin flips an org to trial); otherwise
// fall back to the org's creation time + TRIAL_DURATION_DAYS.
function resolveTrialEndMs({ trialEndsAt, createdAt } = {}) {
  const explicit = msFrom(trialEndsAt);
  if (explicit !== null) return explicit;
  const created = msFrom(createdAt);
  if (created !== null) return created + TRIAL_DURATION_DAYS * 86400000;
  return null;
}

// The EFFECTIVE plan: same as the stored plan, except an EXPIRED trial drops
// to 'free'. Everything downstream (entitlements, student cap) keys off this.
function effectivePlan(rawPlan, opts = {}) {
  const raw = normalizePlan(rawPlan);
  if (raw !== 'trial') return raw;
  const endMs = resolveTrialEndMs(opts);
  if (endMs !== null && Date.now() > endMs) return 'free';
  return 'trial';
}

// Trial status for display (banners, platform list). null when not on trial.
function trialInfo(rawPlan, opts = {}) {
  if (normalizePlan(rawPlan) !== 'trial') return null;
  const endMs = resolveTrialEndMs(opts);
  if (endMs === null) return { endsAt: null, daysLeft: null, expired: false };
  const daysLeft = Math.ceil((endMs - Date.now()) / 86400000);
  return {
    endsAt: new Date(endMs).toISOString(),
    daysLeft,
    expired: Date.now() > endMs,
  };
}

module.exports = {
  PREMIUM_MODULES,
  TRIAL_DURATION_DAYS,
  PLANS,
  normalizePlan,
  planLabel,
  planMaxStudents,
  moduleKey,
  premiumEntitlements,
  isModuleEntitled,
  effectivePlan,
  trialInfo,
};
