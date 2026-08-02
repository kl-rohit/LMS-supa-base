/* pricing-live.js — single source of truth for prices on every marketing page.
 *
 * WHY: prices used to be hardcoded in each landing/pricing page, so a price
 * change meant editing many files (and they went stale). Now every page marks
 * its price spots with  data-price="<plan>:<field>"  and includes this script.
 * The script fills those spans from config: baked DEFAULTS below (the offline
 * fallback, kept in sync with config.master.js by scripts/gen-config.js), then
 * LIVE overrides fetched from the public /api/pricing endpoint, which reflect
 * whatever the owner set in Platform Admin -> Plans. So changing a price in the
 * admin updates the whole site with no rebuild.
 *
 * <plan>  = core | complete
 * <field> = base | perStudent | included | baseRegular | perStudentRegular
 *   base/perStudent -> formatted amount (₹1,250)
 *   included        -> plain number (15)
 *   baseRegular / perStudentRegular -> struck-through "regular" anchor; the span
 *     is HIDDEN automatically when the anchor is not higher than the live price.
 *
 * Do NOT hardcode a rupee figure in page HTML any more; use a data-price span.
 */
(function () {
  /* GEN:PRICES:START — generated from config.master.js, do not edit by hand */
  var CURRENCY = '₹';
  var DEFAULTS = {
    core:     { base: 1250, baseRegular: 1500, included: 15, perStudent: 50, perStudentRegular: 75 },
    complete: { base: 2100, baseRegular: 2999, included: 15, perStudent: 90, perStudentRegular: 130 },
  };
  /* GEN:PRICES:END */

  // If a templated page already carries a LANDING_CONFIG.PRICES object, use it
  // as the live store and MUTATE IT IN PLACE so that page's estimator (which
  // closed over the same object) sees updated numbers. Otherwise use DEFAULTS.
  var LC = window.LANDING_CONFIG;
  var sym = (LC && LC.CURRENCY) || CURRENCY;
  var PRICES = (LC && LC.PRICES) || { core: shallow(DEFAULTS.core), complete: shallow(DEFAULTS.complete) };

  function shallow(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }
  function fmt(n) { return sym + Number(n).toLocaleString('en-IN'); }
  function planOf(key) { return PRICES[key] || { base: 0, baseRegular: null, included: 0, perStudent: 0, perStudentRegular: null }; }

  // Fill every [data-price] span on the page from the current PRICES.
  function paint() {
    document.querySelectorAll('[data-price]').forEach(function (el) {
      var parts = String(el.getAttribute('data-price')).split(':');
      var pl = planOf(parts[0]), field = parts[1];
      if (field === 'base') el.textContent = fmt(pl.base);
      else if (field === 'perStudent') el.textContent = fmt(pl.perStudent);
      else if (field === 'included') el.textContent = String(pl.included);
      else if (field === 'baseRegular') {
        if (pl.baseRegular && pl.baseRegular > pl.base) { el.textContent = fmt(pl.baseRegular); el.style.display = ''; }
        else { el.style.display = 'none'; }
      } else if (field === 'perStudentRegular') {
        if (pl.perStudentRegular && pl.perStudentRegular > pl.perStudent) { el.textContent = fmt(pl.perStudentRegular); el.style.display = ''; }
        else { el.style.display = 'none'; }
      }
    });
    // Let any page-local estimator recompute from the (now-updated) numbers.
    var est = document.getElementById('est-count');
    if (est) est.dispatchEvent(new Event('input'));
    try { window.dispatchEvent(new CustomEvent('pricing:ready', { detail: PRICES })); } catch (e) {}
  }

  // Merge the owner's saved overrides over the current PRICES, in place.
  function applyOverrides(ov) {
    if (!ov || !ov.prices) return false;
    var changed = false;
    ['core', 'complete'].forEach(function (plan) {
      var src = ov.prices[plan];
      if (!src || typeof src !== 'object') return;
      if (!PRICES[plan]) PRICES[plan] = {};
      ['base', 'baseRegular', 'included', 'perStudent', 'perStudentRegular'].forEach(function (f) {
        var n = Number(src[f]);
        if (src[f] !== undefined && src[f] !== null && src[f] !== '' && isFinite(n) && n >= 0) {
          PRICES[plan][f] = n; changed = true;
        }
      });
    });
    return changed;
  }

  // Paint once with baked/LANDING_CONFIG values so there is never a blank price
  // or a wrong-price flash, then refresh live from the admin-editable store.
  function start() {
    paint();
    // Host-aware API base, mirroring the landing lead form: on Catalyst the page
    // is under /app/ and the API is at /server/api/api; on Netlify (served at the
    // domain root) the API is proxied at /api. Picking the wrong one 404s.
    var API_BASE = location.pathname.indexOf('/app/') === 0 ? '/server/api/api' : '/api';
    fetch(API_BASE + '/pricing', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && applyOverrides(d.overrides)) paint(); })
      .catch(function () { /* offline / API down: keep baked defaults */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.PRICING = { get prices() { return PRICES; }, currency: sym, fmt: fmt, refresh: start };
})();
