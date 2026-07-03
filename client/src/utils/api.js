// API base URL.
// - Local dev (webpack-dev-server): '/api' (proxied to localhost:3001).
// - Catalyst deployment: set API_BASE='/server/api/api' at build time
//   (npm run build:catalyst handles this).
// `process.env.API_BASE` is replaced at build time by webpack.DefinePlugin.
const BASE_URL = process.env.API_BASE || '/api';

// Attach the Supabase access token as `Authorization: Bearer <jwt>` on every
// request (replaces Catalyst session cookies). supabase-js keeps it fresh.
import { getAccessToken } from './supabaseClient';

// Active-academy selection: every API call gets `?org=<id>` appended so the
// backend's resolveOrg / requireParent scope to the academy the user is
// currently viewing. Two sources, in priority order:
//   1. veena_impersonate_org_id — platform admin "view as this org" override.
//   2. veena_active_org_id       — the academy a multi-academy user picked in
//                                  the org switcher (their own membership).
// Skips /auth/* (the /me call passes ?org= itself) and /platform (cross-org).
// Leaves URLs that already carry ?org= untouched.
const IMPERSONATE_KEY = 'veena_impersonate_org_id';
const ACTIVE_ORG_KEY = 'veena_active_org_id';

function withActiveOrg(url) {
  try {
    if (typeof window === 'undefined') return url;
    if (url.startsWith('/auth/') || url.startsWith('/platform')) return url;
    if (url.includes('?org=') || url.includes('&org=')) return url;
    const orgId = localStorage.getItem(IMPERSONATE_KEY) || localStorage.getItem(ACTIVE_ORG_KEY);
    if (!orgId) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}org=${encodeURIComponent(orgId)}`;
  } catch {
    return url;
  }
}

async function request(url, options = {}) {
  const config = {
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  };

  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }

  // Supabase access token from the current session (null when signed out).
  // Sent as X-Auth-Token, NOT Authorization: Catalyst reserves Authorization
  // for its own OAuth and rejects a non-Catalyst Bearer token before it reaches
  // the app. The backend reads X-Auth-Token (see middleware/auth.js).
  try {
    const token = await getAccessToken();
    if (token) config.headers['X-Auth-Token'] = token;
  } catch { /* no session — request goes out unauthenticated, backend 401s */ }

  const finalUrl = withActiveOrg(url);

  // Offline-aware: if the device reports no connection, fail fast with a
  // friendly message rather than a raw network error. Callers already toast
  // the thrown message, so this surfaces a clear "you're offline" notice.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error("You're offline. We'll retry once your connection returns.");
  }

  let response;
  try {
    response = await fetch(`${BASE_URL}${finalUrl}`, {
      // Auth travels in the Authorization header (Bearer), not cookies, so this
      // works cross-origin (Netlify frontend -> Cloud Run backend) with CORS.
      ...config,
    });
  } catch (networkErr) {
    // A rejected fetch is almost always a dropped/again-offline connection.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error("You're offline. We'll retry once your connection returns.");
    }
    throw new Error('Network trouble reaching the server. Please try again.');
  }

  if (response.status === 401) {
    // Session expired or never existed. Bounce to login unless we're already
    // on /login or fetching /auth/me (which legitimately returns 401 when out).
    const isAuthMe = url === '/auth/me';
    const onLogin = typeof window !== 'undefined' && window.location.pathname.endsWith('/login');
    if (!isAuthMe && !onLogin && typeof window !== 'undefined') {
      const base = (process.env.PUBLIC_URL || '/').replace(/\/$/, '');
      window.location.href = `${base}/login`;
    }
    // Still throw so callers don't proceed.
    throw new Error('Not authenticated');
  }

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    try {
      const errorData = await response.json();
      // Prefer a human-readable `message` when present (e.g. plan-limit 402s
      // carry a machine code in `error` + friendly copy in `message`); fall
      // back to `error` for endpoints that only set that.
      errorMessage = errorData.message || errorData.error || errorMessage;
    } catch {
      // Could not parse error response
    }
    throw new Error(errorMessage);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return null;
  }

  return response.json();
}

// Offline read-cache for the parent portal. Stores the last successful GET for
// a screen in localStorage so the parent can still glance at their child's
// summary with no signal. Keyed by the active org so a multi-academy parent on
// one device never sees another academy's cached data, and cleared on sign-out
// (api.clearCache) so nothing lingers on a shared phone. This is a deliberate,
// scoped trade-off: only the small portal summaries opt in via getCached.
const CACHE_PREFIX = 'veena_cache_';

function cacheKeyFor(name) {
  let org = '0';
  try { org = localStorage.getItem(IMPERSONATE_KEY) || localStorage.getItem(ACTIVE_ORG_KEY) || '0'; } catch {}
  return `${CACHE_PREFIX}${org}_${name}`;
}

const api = {
  get: (url) => request(url, { method: 'GET' }),

  // GET that falls back to the last cached response when the network is down.
  getCached: async (url, name) => {
    const key = cacheKeyFor(name || url);
    try {
      const data = await request(url, { method: 'GET' });
      try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
      return data;
    } catch (err) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) return JSON.parse(raw);
      } catch {}
      throw err;
    }
  },

  // Drop every cached portal response. Call on sign-out.
  clearCache: () => {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
    } catch {}
  },

  post: (url, data) => request(url, {
    method: 'POST',
    body: data,
  }),

  put: (url, data) => request(url, {
    method: 'PUT',
    body: data,
  }),

  patch: (url, data) => request(url, {
    method: 'PATCH',
    body: data,
  }),

  delete: (url) => request(url, { method: 'DELETE' }),
};

export default api;
