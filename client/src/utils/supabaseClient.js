// Client-side Supabase instance — used ONLY for auth (login, session,
// password reset). All data access still goes through utils/api.js to the
// backend, which is where multi-tenant scoping and business logic live.
//
// The URL + anon key are injected at build time by webpack DefinePlugin
// (see webpack.config.js). They are public by design.

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,        // keep the session across reloads (localStorage)
    autoRefreshToken: true,      // refresh the access token before it expires
    detectSessionInUrl: true,    // pick up invite / recovery links (#access_token=...)
    storageKey: 'veena_auth',
  },
});

// The current access token (JWT) to send as `Authorization: Bearer <token>`.
// Returns null when signed out. supabase-js refreshes it under the hood.
export async function getAccessToken() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  } catch {
    return null;
  }
}
