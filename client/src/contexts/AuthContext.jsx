// Auth state for the app: tracks the logged-in Catalyst user.
//
// On mount, fetches /api/auth/me. If 401, user stays null and RequireAuth
// will route to /login. On signOut, clears cookies via Catalyst SDK and
// nulls the state so the next render redirects.

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../utils/api';

const AuthContext = createContext(null);

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
      const resp = await api.get('/auth/me');
      setUser(resp?.user || null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Logout. Catalyst has NO hosted logout endpoint (only /__catalyst/auth/login
  // is hosted) — clearing the session must go through the Web SDK's
  // catalyst.auth.signOut(redirectURL), which wipes the cookies and then sends
  // the browser to redirectURL. We lazy-load the SDK only on click so the rest
  // of the app stays SDK-free (see Login.jsx). If the SDK can't load (offline,
  // CDN blocked) we still hard-navigate to /login as a best effort.
  const signOut = useCallback(async () => {
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
    <AuthContext.Provider value={{ user, loading, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
