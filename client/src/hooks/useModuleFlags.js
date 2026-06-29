// Fetches the org's module toggles once per page-load and exposes a simple
// boolean map. Both TeacherLayout and ParentLayout use this to filter nav
// items (and feature-gate parts of the UI).
//
// Default-true if the fetch fails — modules stay visible to avoid hiding
// features by accident on a transient network blip.

import { useEffect, useState } from 'react';
import api from '../utils/api';
import { PREMIUM_MODULES as GEN_PREMIUM, FEATURE_PLANS } from '../config';

const DEFAULTS = {
  // Admin modules
  'modules.lessons':        true,
  'modules.fees':           true,
  'modules.messages':       true,
  'modules.reports':        true,
  'modules.camps':          false, // off by default — opt-in
  'modules.groups':         true,
  'modules.student_photos': true,
  'modules.assignments':    false, // off by default — opt-in
  'modules.question_papers': false, // off by default — opt-in
  // Parent portal
  'portal.show_lessons':       true,
  'portal.show_fees':          true,
  'portal.allow_profile_edit': true,
};

function parseBool(v, fallback) {
  if (v === 'true' || v === true) return true;
  if (v === 'false' || v === false) return false;
  return fallback;
}

// Premium modules gated by the subscription plan (see functions/api/lib/plans.js).
// A module that isn't entitled is forced OFF regardless of the admin toggle.
// Sourced from the generated config (client/src/config.js), which gen-config.js
// derives from the feature catalog in config.master.js, so this matches the
// pricing sheet. Fallback keeps the historical set if the generated value is absent.
const PREMIUM = (Array.isArray(GEN_PREMIUM) && GEN_PREMIUM.length)
  ? GEN_PREMIUM
  : ['lessons', 'assignments', 'question_papers'];

export function useModuleFlags() {
  const [flags, setFlags] = useState(DEFAULTS);
  const [plan, setPlan] = useState('complete');           // grandfather default
  const [entitlements, setEntitlements] = useState({});   // { lessons: bool, ... }
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/settings/app');
        if (cancelled) return;
        const settings = res?.settings || {};
        const ent = res?.entitlements || {};
        const next = { ...DEFAULTS };
        for (const k of Object.keys(DEFAULTS)) {
          next[k] = parseBool(settings?.[k], DEFAULTS[k]);
        }
        // Effective state = entitled AND enabled. A plan that doesn't unlock a
        // premium module hides it even if the stored flag says 'true'.
        for (const mod of PREMIUM) {
          // entitlements omitted (older server) → treat as entitled (no regression).
          const entitled = ent[mod] === undefined ? true : !!ent[mod];
          if (!entitled) next[`modules.${mod}`] = false;
        }
        // Portal lessons depend on the Lessons module being unlocked.
        if (ent.lessons === false) next['portal.show_lessons'] = false;

        setFlags(next);
        setEntitlements(ent);
        if (res?.plan) setPlan(res.plan);
      } catch {
        // Use defaults — every module visible — so the app doesn't go dark.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Is a catalog feature available on this org's plan? Reads the generated
  // FEATURE_PLANS map so UI can hide a feature the plan does not include.
  // Unknown keys return true (never hide on a typo). complete/trial read the
  // `complete` flag; everything else reads `core`.
  const featureOn = (key) => {
    const f = FEATURE_PLANS && FEATURE_PLANS[key];
    if (!f) return true;
    return (plan === 'complete' || plan === 'trial') ? f.complete !== false : f.core !== false;
  };

  return { flags, plan, entitlements, loaded, featureOn };
}
