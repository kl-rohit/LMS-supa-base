// Fetches the org's module toggles once per page-load and exposes a simple
// boolean map. Both TeacherLayout and ParentLayout use this to filter nav
// items (and feature-gate parts of the UI).
//
// Default-true if the fetch fails — modules stay visible to avoid hiding
// features by accident on a transient network blip.

import { useEffect, useState } from 'react';
import api from '../utils/api';

const DEFAULTS = {
  // Admin modules
  'modules.lessons':        true,
  'modules.fees':           true,
  'modules.messages':       true,
  'modules.reports':        true,
  'modules.camps':          false, // off by default — opt-in
  'modules.groups':         true,
  'modules.student_photos': true,
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

export function useModuleFlags() {
  const [flags, setFlags] = useState(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { settings } = await api.get('/settings/app');
        if (cancelled) return;
        const next = { ...DEFAULTS };
        for (const k of Object.keys(DEFAULTS)) {
          next[k] = parseBool(settings?.[k], DEFAULTS[k]);
        }
        setFlags(next);
      } catch {
        // Use defaults — every module visible — so the app doesn't go dark.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { flags, loaded };
}
