// Route guard. Wraps protected children:
//   <RequireAuth role="App Administrator"><App /></RequireAuth>
// - Not logged in → redirect to /login (preserving target via state.from)
// - Logged in but wrong role → redirect to that role's home (no "access denied" page)
// - Still loading session → spinner

import { Navigate } from 'react-router-dom';
import { WifiOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import Loader from './Loader';

// Shown when we can't verify the session because the device is offline. We must
// NOT redirect here: the service worker serves the cached app shell for any
// offline navigation, so bouncing to the landing page just loops (the "disco"
// flicker). A calm screen with Retry breaks the loop; reconnecting + Retry
// re-runs the auth check.
function OfflineNotice() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <div className="w-full max-w-sm text-center bg-white rounded-2xl shadow-xl p-6">
        <div className="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center mx-auto">
          <WifiOff className="w-6 h-6 text-indigo-600" />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-gray-900">You're offline</h1>
        <p className="mt-2 text-sm text-gray-500">
          Reconnect to sign in and load your academy. Your data is safe.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-5 w-full px-4 py-2.5 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

// Where each role should land by default. `app_role` is resolved server-side
// from app data (OrgMembership / Students link), NOT the Catalyst role — so a
// new academy owner (Catalyst "App User" + owner membership) correctly lands
// in the admin app instead of the parent portal. 'unlinked' falls through to
// the portal, whose dashboard shows a friendly "not set up yet" screen.
export function roleHome(appRole) {
  return appRole === 'admin' ? '/dashboard' : '/portal/dashboard';
}

export default function RequireAuth({ children, role }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader />
      </div>
    );
  }

  if (!user) {
    // Offline → we couldn't verify the session (not necessarily logged out).
    // Show a calm reconnect screen instead of redirecting, which would loop
    // against the cached app shell.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return <OfflineNotice />;
    }
    // No session → send to the public marketing/landing page (a static file
    // outside the SPA router). The landing page's "Sign in" button points at
    // /app/login, so there's no redirect loop. Logged-in users never reach
    // here — they fall through to their dashboard/portal home below.
    const base = (process.env.PUBLIC_URL || '/').replace(/\/$/, '');
    window.location.replace(`${base}/landing.html`);
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader />
      </div>
    );
  }

  // Wrong role for this branch — send them to their own home.
  if (role && user.app_role !== role) {
    return <Navigate to={roleHome(user.app_role)} replace />;
  }

  return children;
}
