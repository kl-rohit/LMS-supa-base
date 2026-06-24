// Login page — redirects to Catalyst's Hosted Authentication page.
// No SDK script tag, no iframe, no custom form. After successful login,
// Catalyst sets session cookies on *.catalystserverless.in and redirects
// back to the path given by `signin_to`.

import { useEffect } from 'react';
import { LogIn } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { roleHome } from '../components/RequireAuth';

function hostedLoginUrl(target) {
  // signin_to is an absolute path on the same Catalyst domain.
  // PUBLIC_URL = '/app/' in production, '/' in dev.
  const base = (process.env.PUBLIC_URL || '/').replace(/\/$/, '');
  const dest = encodeURIComponent(`${base}${target || '/dashboard'}`);
  return `/__catalyst/auth/login?signin_to=${dest}`;
}

export default function Login() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Already logged in → bounce to the user's home (admin vs parent).
  useEffect(() => {
    if (!loading && user) {
      const dest = location.state?.from || roleHome(user.app_role);
      navigate(dest, { replace: true });
    }
  }, [user, loading, navigate, location.state]);

  const handleSignIn = () => {
    window.location.href = hostedLoginUrl(location.state?.from);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl shadow-lg mb-3 overflow-hidden">
            <img
              src={`${process.env.PUBLIC_URL || '/'}logo.png`}
              alt="VidyaSetu"
              className="w-full h-full object-cover"
            />
          </div>
          <h1 className="text-2xl font-bold">
            <span className="text-gray-900">Vidya</span><span className="text-amber-500">Setu</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">Bridging teachers and learners</p>
        </div>

        <div className="bg-white rounded-2xl shadow-md border border-gray-100 p-6">
          <button
            onClick={handleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 rounded-lg transition-colors disabled:opacity-50"
          >
            <LogIn className="w-5 h-5" />
            Continue with email
          </button>
          <p className="text-xs text-gray-400 text-center mt-4">
            You'll be redirected to a secure sign-in page.
          </p>
        </div>

        <p className="text-center text-sm text-gray-600 mt-6">
          Want to start an academy? It's invite-only — reach out to get set up.
        </p>
        <p className="text-center text-xs text-gray-400 mt-2">
          Parents: contact your teacher for access.
        </p>
      </div>
    </div>
  );
}
