// Fetches the current org's name + logo signed URL.
// Used by TeacherLayout + ParentLayout to render the sidebar branding.
//
// Lightweight caching: reads last-known values from localStorage immediately
// (so the sidebar doesn't flash a wrong name on first paint), then refreshes
// from the API in the background.

import { useEffect, useState } from 'react';
import api from '../utils/api';

const CACHE_KEY = 'veena_org_branding';

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : null;
  } catch {
    return null;
  }
}
function saveCache(obj) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(obj)); } catch {}
}

export function useOrgBranding() {
  const [branding, setBranding] = useState(() => loadCache() || { name: '', logoUrl: '' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [orgRes, logoRes] = await Promise.all([
          api.get('/organization').catch(() => null),
          api.get('/organization/logo-url').catch(() => null),
        ]);
        if (cancelled) return;
        const next = {
          name:    orgRes?.org?.name || '',
          logoUrl: logoRes?.logo_url || '',
        };
        setBranding(next);
        saveCache(next);
      } catch {
        // Keep cached value — never blank the sidebar over a transient failure.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return branding;
}

// Bust the cache after the owner updates name/logo, so the next render
// pulls the new values right away (rather than waiting for cache expiry).
export function invalidateOrgBranding() {
  try { localStorage.removeItem(CACHE_KEY); } catch {}
}
