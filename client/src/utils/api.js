// API base URL.
// - Local dev (webpack-dev-server): '/api' (proxied to localhost:3001).
// - Catalyst deployment: set API_BASE='/server/api/api' at build time
//   (npm run build:catalyst handles this).
// `process.env.API_BASE` is replaced at build time by webpack.DefinePlugin.
const BASE_URL = process.env.API_BASE || '/api';

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

  const response = await fetch(`${BASE_URL}${url}`, {
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
      errorMessage = errorData.error || errorData.message || errorMessage;
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
