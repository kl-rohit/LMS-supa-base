// Platform-admin audit trail.
//
// Records significant cross-org actions the platform owner performs (suspend,
// plan change, trial extend, resend access, create academy, re-arm onboarding,
// impersonate). Writes are ALWAYS fail-safe: if the AuditLog table is missing
// or a write errors, we log and move on so the underlying action never breaks.
//
// Table spec (create once in the Catalyst console — Data Store → New Table):
//   AuditLog
//     actor_user_id    Text (255)        who performed the action
//     actor_email      Text (255)        their email, for readability
//     action           Text (100)        e.g. 'org.suspend', 'org.plan_change'
//     target_org_id    BigInt            the org acted on (nullable)
//     target_org_name  Text (255)        org name snapshot, for readability
//     detail           Text (max / 2000) JSON string of extra context
//   (ROWID / CREATEDTIME / CREATORID are system columns — no need to add.)

const { insert } = require('../db/catalystDb');

// Write one audit entry. Never throws — best-effort by design.
async function writeAudit(req, { action, orgId = null, orgName = '', detail = null }) {
  try {
    const actor = req.user || {};
    const row = {
      actor_user_id:   String(actor.user_id || ''),
      actor_email:     String(actor.email_id || actor.email || ''),
      action:          String(action || '').slice(0, 100),
      target_org_id:   orgId != null ? Number(orgId) : null,
      target_org_name: String(orgName || '').slice(0, 255),
      detail:          detail != null ? JSON.stringify(detail).slice(0, 2000) : '',
    };
    await insert(req, 'AuditLog', row);
  } catch (e) {
    // Table may not exist yet, or a transient write failure. Either way the
    // primary action has already succeeded — just note it and carry on.
    console.error('writeAudit failed for', action, e.message);
  }
}

module.exports = { writeAudit };
