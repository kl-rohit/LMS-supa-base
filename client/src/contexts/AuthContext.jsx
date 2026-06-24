// Auth state for the app: tracks the logged-in Catalyst user.
//
// On mount, fetches /api/auth/me. If 401, user stays null and RequireAuth
// will route to /login. On signOut, clears cookies via Catalyst SDK and
// nulls the state so the next render redirects.

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../utils/api';

const AuthContext = createContext(null);

// localStorage key the api client reads to scope every call to the academy the
// user is currently viewing (see utils/api.js). A user who belongs to several
// academies picks one in the org switcher; we persist that choice here so it
// survives reloads and rides along on every request as ?org=<id>.
const ACTIVE_ORG_KEY = 'veena_active_org_id';

// Inject the Catalyst Web SDK (CDN core + project init) once, on demand.
// Resolves when window.catalyst.auth is ready. Scripts must load in order:
// the init.js wires the CDN SDK to THIS project's auth config.
let sdkPromise = null;
function loadCatalystSDK() {
  if (window.catalyst?.auth) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  const loadScript = (src) =>
    new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });
  sdkPromise = loadScript('https://static.zohocdn.com/catalyst/sdk/js/4.4.0/catalystWebSDK.js')
    .then(() => loadScript('/__catalyst/sdk/init.js'))
    .catch((err) => { sdkPromise = null; throw err; });
  return sdkPromise;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      // Pass the persisted active academy so the server resolves app_role for
      // THAT academy (a user can be staff in one and a parent in another).
      let url = '/auth/me';
      try {
        const pinned = localStorage.getItem(ACTIVE_ORG_KEY);
        if (pinned) url += `?org=${encodeURIComponent(pinned)}`;
      } catch { /* localStorage unavailable — fall back to server default */ }
      const resp = await api.get(url);
      const u = resp?.user || null;
      setUser(u);
      // Keep the stored pick in sync with what the server actually resolved.
      // If our pin was stale (e.g. membership removed) the server falls back to
      // the user's first academy and reports it here; mirror that so the next
      // request and the switcher agree on the active academy.
      try {
        if (u && u.active_org_id != null) {
          localStorage.setItem(ACTIVE_ORG_KEY, String(u.active_org_id));
        } else {
          localStorage.removeItem(ACTIVE_ORG_KEY);
        }
      } catch { /* ignore */ }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Switch the active academy. Persists the choice, then hard-reloads to the
  // app root so EVERYTHING re-resolves cleanly for the new academy: app_role
  // (staff vs parent decides admin shell vs portal), module flags, branding,
  // and all cached queries. A full reload is deliberate — it sidesteps the
  // many in-memory caches that would otherwise show the previous academy.
  const switchOrg = useCallback((orgId) => {
    try { localStorage.setItem(ACTIVE_ORG_KEY, String(orgId)); } catch { /* ignore */ }
    const base = (process.env.PUBLIC_URL || '/').replace(/\/$/, '');
    window.location.href = `${base}/`;
  }, []);

  // Logout. Catalyst has NO hosted logout endpoint (only /__catalyst/auth/login
  // is hosted) — clearing the session must go through the Web SDK's
  // catalyst.auth.signOut(redirectURL), which wipes the cookies and then sends
  // the browser to redirectURL. We lazy-load the SDK only on click so the rest
  // of the app stays SDK-free (see Login.jsx). If the SDK can't load (offline,
  // CDN blocked) we still hard-navigate to /login as a best effort.
  const signOut = useCallback(async () => {
    // Drop the active-academy pin so it doesn't carry over to the next person
    // who signs in on this device.
    try { localStorage.removeItem(ACTIVE_ORG_KEY); } catch { /* ignore */ }
    const base = (process.env.PUBLIC_URL || '/').replace(/\/$/, '');
    const redirectURL = `${window.location.origin}${base}/login`;
    // IMPORTANT: do NOT setUser(null) before the SDK call. Nulling the user
    // re-renders RequireAuth, which hard-navigates to landing.html and aborts
    // the in-flight cookie-clearing signOut — leaving the session alive (the
    // classic "sign out didn't work" bug). Let the SDK wipe cookies and do the
    // redirect; only fall back to a manual redirect if the SDK can't load.
    try {
      await loadCatalystSDK();
      window.catalyst.auth.signOut(redirectURL);
    } catch {
      setUser(null);
      window.location.href = `${base}/login`;
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        refresh,
        signOut,
        switchOrg,
        orgs: user?.orgs || [],
        activeOrgId: user?.active_org_id ?? null,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
