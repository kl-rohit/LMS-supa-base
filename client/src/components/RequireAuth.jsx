// Route guard. Wraps protected children:
//   <RequireAuth role="App Administrator"><App /></RequireAuth>
// - Not logged in → redirect to /login (preserving target via state.from)
// - Logged in but wrong role → redirect to that role's home (no "access denied" page)
// - Still loading session → spinner

import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Loader from './Loader';

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
