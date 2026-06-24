// API base URL.
// - Local dev (webpack-dev-server): '/api' (proxied to localhost:3001).
// - Catalyst deployment: set API_BASE='/server/api/api' at build time
//   (npm run build:catalyst handles this).
// `process.env.API_BASE` is replaced at build time by webpack.DefinePlugin.
const BASE_URL = process.env.API_BASE || '/api';

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

  const finalUrl = withActiveOrg(url);
  const response = await fetch(`${BASE_URL}${finalUrl}`, {
    credentials: 'include', // include Catalyst session cookies
    ...config,
  });

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

const api = {
  get: (url) => request(url, { method: 'GET' }),

  post: (url, data) => request(url, {
    method: 'POST',
    body: data,
  }),

  put: (url, data) => request(url, {
    method: 'PUT',
    body: data,
  }),

  delete: (url) => request(url, { method: 'DELETE' }),
};

export default api;
