// Auth state for the app: tracks the logged-in Supabase user.
//
// The Supabase client (utils/supabaseClient) manages the session (localStorage
// + token refresh). On mount and on every auth change we call /api/auth/me
// (which the api client authenticates with the Bearer token) to resolve the
// app-level user: app_role, active academy, and the academies they belong to.
// If /me 401s, user stays null and RequireAuth routes to /login.

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../utils/api';
import { supabase } from '../utils/supabaseClient';
import ForcePasswordSet from '../components/ForcePasswordSet';

const AuthContext = createContext(null);

// localStorage key the api client reads to scope every call to the academy the
// user is currently viewing (see utils/api.js).
const ACTIVE_ORG_KEY = 'veena_active_org_id';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // True when the signed-in user still has an admin-issued temp password
  // (user_metadata.must_set_password). Forces the set-password screen.
  const [needsPasswordSet, setNeedsPasswordSet] = useState(false);

  const readPasswordFlag = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getUser();
      setNeedsPasswordSet(!!data?.user?.user_metadata?.must_set_password);
    } catch {
      setNeedsPasswordSet(false);
    }
  }, []);

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

  // Resolve on mount, and re-resolve whenever the Supabase auth state changes
  // (sign-in, token refresh, sign-out, or arriving via an invite/recovery link).
  useEffect(() => {
    let active = true;
    refresh();
    readPasswordFlag();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'SIGNED_OUT') {
        setUser(null);
        setNeedsPasswordSet(false);
        setLoading(false);
      } else {
        // SIGNED_IN, TOKEN_REFRESHED, USER_UPDATED, INITIAL_SESSION, PASSWORD_RECOVERY
        setNeedsPasswordSet(!!session?.user?.user_metadata?.must_set_password);
        refresh();
      }
    });
    return () => {
      active = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, [refresh, readPasswordFlag]);

  // Set the user's own password and clear the must_set_password flag.
  const completePasswordSet = useCallback(async (newPassword) => {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
      data: { must_set_password: false },
    });
    if (error) throw new Error(error.message);
    setNeedsPasswordSet(false);
    await refresh();
  }, [refresh]);

  // Switch the active academy. Persists the choice, then hard-reloads to the
  // app root so EVERYTHING re-resolves cleanly for the new academy.
  const switchOrg = useCallback((orgId) => {
    try { localStorage.setItem(ACTIVE_ORG_KEY, String(orgId)); } catch { /* ignore */ }
    const base = (process.env.PUBLIC_URL || '/').replace(/\/$/, '');
    window.location.href = `${base}/`;
  }, []);

  // Logout: end the Supabase session, drop the active-academy pin and the
  // offline portal read-cache, then send the browser to /login.
  const signOut = useCallback(async () => {
    try { localStorage.removeItem(ACTIVE_ORG_KEY); } catch { /* ignore */ }
    try { api.clearCache(); } catch { /* ignore */ }
    try { await supabase.auth.signOut(); } catch { /* ignore */ }
    setUser(null);
    const base = (process.env.PUBLIC_URL || '/').replace(/\/$/, '');
    window.location.href = `${base}/login`;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        refresh,
        signOut,
        switchOrg,
        needsPasswordSet,
        completePasswordSet,
        orgs: user?.orgs || [],
        activeOrgId: user?.active_org_id ?? null,
      }}
    >
      {children}
      {/* Force a password change when signed in with a temp password. */}
      {user && needsPasswordSet ? <ForcePasswordSet /> : null}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
