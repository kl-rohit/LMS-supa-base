// Onboarding "pending" flags — controls when the first-login welcome tour
// (client/src/components/OnboardingTour.jsx) is allowed to appear.
//
// The tour used to show once per *device* (localStorage only), so it nagged
// every admin/teacher and every parent the first time they opened the app on
// any device — even on long-established orgs. Now it is gated on a SERVER
// flag that is set ONLY when:
//   - a brand-new org is created  (auth.js signup → admin flag)
//   - a parent login is activated (student-logins.js POST → parent flag)
// and cleared the moment the user dismisses the tour. Existing accounts have
// no flag → they never see it.
//
// Stored in the generic AppSettings key/value table (org-scoped) so no
// Catalyst schema change is needed:
//   - admin:  one row per org   → key 'onboarding.admin_pending'
//   - parent: one row per login → key 'onboarding.parent_pending.<studentId>'

const { zcql, unwrap, insert, update } = require('../db/catalystDb');

const ADMIN_KEY = 'onboarding.admin_pending';
// First-run SETUP WIZARD flag — distinct from the welcome tour. Set at signup,
// cleared when the owner finishes or skips the wizard. The wizard collects
// org config (class modes, fee model, portal toggles); the tour is just a
// feature walkthrough. Both are gated the same way (server flag, set at signup).
const SETUP_KEY = 'onboarding.setup_pending';
function parentKey(studentId) {
  return `onboarding.parent_pending.${Number(studentId)}`;
}

async function getRow(req, orgId, key) {
  const safeKey = String(key).replace(/'/g, "''");
  const rows = await zcql(
    req,
    `SELECT ROWID, setting_value FROM AppSettings WHERE AppSettings.org_id = ${Number(orgId)} AND AppSettings.setting_key = '${safeKey}'`
  );
  return unwrap(rows, 'AppSettings')[0] || null;
}

// Upsert a flag. Non-fatal on failure — onboarding is cosmetic, never block
// the real operation (signup, login activation) on it.
async function setFlag(req, orgId, key, value) {
  try {
    const existing = await getRow(req, orgId, key);
    if (existing) {
      if (existing.setting_value !== value) {
        await update(req, 'AppSettings', existing.ROWID, { setting_value: value });
      }
    } else {
      await insert(req, 'AppSettings', { setting_key: key, setting_value: value, org_id: Number(orgId) });
    }
  } catch (e) {
    console.error('onboarding setFlag failed for', key, e.message);
  }
}

async function isPending(req, orgId, key) {
  try {
    const row = await getRow(req, orgId, key);
    return !!row && row.setting_value === 'true';
  } catch {
    return false; // fail closed — don't pop the tour on a read hiccup
  }
}

module.exports = { ADMIN_KEY, SETUP_KEY, parentKey, setFlag, isPending };
