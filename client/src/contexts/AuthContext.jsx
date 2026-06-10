// Auth state for the app: tracks the logged-in Catalyst user.
//
// On mount, fetches /api/auth/me. If 401, user stays null and RequireAuth
// will route to /login. On signOut, clears cookies via Catalyst SDK and
// nulls the state so the next render redirects.

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../utils/api';

const AuthContext = createContext(null);

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

  // Logout: redirect to Catalyst's hosted signout endpoint, which clears the
  // session cookies and then bounces back to our /login page.
  const signOut = useCallback(async () => {
    try { await api.post('/auth/logout', {}); } catch {}
    setUser(null);
    const base = (process.env.PUBLIC_URL || '/').replace(/\/$/, '');
    const back = encodeURIComponent(`${base}/login`);
    window.location.href = `/__catalyst/auth/logout?signout_to=${back}`;
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
