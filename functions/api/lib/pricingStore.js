// lib/pricingStore.js — platform-wide pricing & feature-plan overrides that the
// owner edits in the Platform Admin Plans tab. Stored as ONE JSON row in the
// PlatformConfig table (config_key 'pricing', config_json TEXT). This is the
// source the deploy sync script (scripts/sync-pricing.js) pulls to bake into
// config.master.js, so the public pricing page + in-app gating stay in sync.
//
// Shape of the saved blob:
//   { prices: { core: {...}, complete: {...} },
//     features: { '<feature key>': { core: bool, complete: bool }, ... } }
//
// Degrades safely: if the PlatformConfig table is absent (not added in the
// console yet) reads return {} and saves surface a clear message.

const { zcql, unwrap, insert, update } = require('../db/catalystDb');

const CONFIG_KEY = 'pricing';

async function readRow(req) {
  const rows = await zcql(req, `SELECT ROWID, config_json FROM PlatformConfig WHERE PlatformConfig.config_key = '${CONFIG_KEY}'`);
  return unwrap(rows, 'PlatformConfig')[0] || null;
}

// Current saved overrides, or {} when none / table missing.
async function getOverrides(req) {
  try {
    const row = await readRow(req);
    if (!row || !row.config_json) return {};
    return JSON.parse(row.config_json);
  } catch (e) {
    return {};
  }
}

// Upsert the single pricing row. Throws (so the caller can report) if the
// table does not exist yet.
async function saveOverrides(req, obj) {
  const json = JSON.stringify(obj || {});
  const row = await readRow(req);
  if (row) await update(req, 'PlatformConfig', row.ROWID, { config_json: json });
  else await insert(req, 'PlatformConfig', { config_key: CONFIG_KEY, config_json: json });
  return obj;
}

module.exports = { getOverrides, saveOverrides };
