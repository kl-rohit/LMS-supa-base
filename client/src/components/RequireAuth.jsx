// Route guard. Wraps protected children:
//   <RequireAuth role="App Administrator"><App /></RequireAuth>
// - Not logged in → redirect to /login (preserving target via state.from)
// - Logged in but wrong role → redirect to that role's home (no "access denied" page)
// - Still loading session → spinner

import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Splash from './Splash';
import OfflineScreen from './OfflineScreen';

// Where each role should land by default. `app_role` is resolved server-side
// from app data (OrgMembership / Students link), NOT the Catalyst role — so a
// new academy owner (Catalyst "App User" + owner membership) correctly lands
// in the admin app instead of the parent portal. 'unlinked' falls through to
// the portal, whose dashboard shows a friendly "not set up yet" screen.
export function roleHome(appRole) {
  return appRole === 'admin' ? '/dashboard' : '/portal/dashboard';
}

export default function RequireAuth({ children, role }) {
  const { user, loading, offline } = useAuth();

  if (loading) {
    return <Splash />;
  }

  if (!user) {
    // Couldn't verify the session because we're offline / the server is
    // unreachable (NOT necessarily logged out). Show the branded reconnect
    // screen instead of redirecting to the landing page — which lives outside
    // the service-worker cache scope and so just errors while offline.
    if (offline || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      return <OfflineScreen />;
    }
    // Genuinely no session (online) → send to the public marketing/landing page
    // (a static file outside the SPA router). Its "Sign in" button points at
    // /app/login, so there's no redirect loop.
    const base = (process.env.PUBLIC_URL || '/').replace(/\/$/, '');
    window.location.replace(`${base}/landing.html`);
    return <Splash />;
  }

  // Wrong role for this branch — send them to their own home.
  if (role && user.app_role !== role) {
    return <Navigate to={roleHome(user.app_role)} replace />;
  }

  return children;
}
