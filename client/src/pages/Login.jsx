// Login page — Supabase email/password auth (replaces Catalyst hosted login).
//
// Three modes:
//   • signin        — email + password (default)
//   • set-password  — shown when the user arrives via an invite / password-reset
//                     link (URL hash has type=invite|recovery). supabase-js has
//                     already established a session from the link; they just set
//                     their password here.
//   • sent          — after a "forgot password" request (check-your-email note)

import { useEffect, useState } from 'react';
import { LogIn, Mail, Lock, KeyRound } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabaseClient';
import { useNavigate, useLocation } from 'react-router-dom';
import { roleHome } from '../components/RequireAuth';

function detectLinkMode() {
  try {
    const h = window.location.hash || '';
    if (/type=recovery/.test(h) || /type=invite/.test(h)) return 'set-password';
  } catch { /* ignore */ }
  return 'signin';
}

// Pull a human-readable message out of a Supabase/auth error. Guards against
// the case where the error's message is empty or a stringified object like
// "{}" (happens when the response body can't be parsed) — never show that to
// the user; fall back to our own copy instead.
function messageFromError(err, fallback) {
  if (!err) return fallback;
  if (typeof err === 'string') return err.trim() || fallback;
  const raw = err.message || err.error_description || err.msg || err.error;
  const msg = typeof raw === 'string' ? raw.trim() : '';
  if (!msg || msg === '{}' || msg === '[]' || msg === 'null') return fallback;
  return msg;
}

export default function Login() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [mode, setMode] = useState(detectLinkMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Already logged in → bounce home. Suppressed in set-password mode so an
  // invited user finishes setting their password before we route them away.
  useEffect(() => {
    if (mode === 'set-password') return;
    if (!loading && user) {
      const dest = location.state?.from || roleHome(user.app_role);
      navigate(dest, { replace: true });
    }
  }, [user, loading, navigate, location.state, mode]);

  const signIn = async (e) => {
    e?.preventDefault();
    setError(''); setBusy(true);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (err) throw err;
      // onAuthStateChange in AuthContext refreshes the user; the effect above
      // then redirects to the right home.
    } catch (err) {
      console.error('[login] sign-in failed:', err);
      setError(messageFromError(err, 'Could not sign in. Please check your details.'));
    } finally {
      setBusy(false);
    }
  };

  const forgotPassword = async () => {
    setError(''); setNotice('');
    if (!email.trim()) { setError('Enter your email first, then tap "Forgot password".'); return; }
    setBusy(true);
    try {
      const base = (process.env.PUBLIC_URL || '/').replace(/\/$/, '');
      const redirectTo = `${window.location.origin}${base}/login`;
      const { error: err } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(), { redirectTo }
      );
      if (err) throw err;
      setMode('sent');
    } catch (err) {
      console.error('[login] reset-email failed:', err);
      setError(messageFromError(err, 'Could not send the reset email. Please try again in a minute.'));
    } finally {
      setBusy(false);
    }
  };

  const setNewPassword = async (e) => {
    e?.preventDefault();
    setError('');
    if (password.length < 8) { setError('Please use at least 8 characters.'); return; }
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw err;
      // Clear the link hash and hand off to the app.
      try { window.history.replaceState(null, '', window.location.pathname); } catch {}
      const dest = user ? roleHome(user.app_role) : '/dashboard';
      navigate(dest, { replace: true });
    } catch (err) {
      console.error('[login] set-password failed:', err);
      setError(messageFromError(err, 'Could not set your password. The link may have expired.'));
    } finally {
      setBusy(false);
    }
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
          {error ? (
            <div className="mb-4 text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{error}</div>
          ) : null}

          {mode === 'sent' ? (
            <div className="text-center">
              <Mail className="w-10 h-10 text-indigo-500 mx-auto mb-3" />
              <p className="text-gray-700 font-medium">Check your email</p>
              <p className="text-sm text-gray-500 mt-1">
                We sent a link to reset your password. Open it on this device to continue.
              </p>
              <button onClick={() => { setMode('signin'); setNotice(''); }} className="mt-4 text-sm text-indigo-600 hover:underline">
                Back to sign in
              </button>
            </div>
          ) : mode === 'set-password' ? (
            <form onSubmit={setNewPassword}>
              <p className="text-sm text-gray-600 mb-4">Welcome. Set a password to finish setting up your account.</p>
              <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
              <div className="relative mb-4">
                <Lock className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password" minLength={8} required
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                  placeholder="At least 8 characters"
                />
              </div>
              <button type="submit" disabled={busy}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 rounded-lg transition-colors disabled:opacity-50">
                <KeyRound className="w-5 h-5" /> {busy ? 'Saving…' : 'Set password & continue'}
              </button>
            </form>
          ) : (
            <form onSubmit={signIn}>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <div className="relative mb-4">
                <Mail className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email" required
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                  placeholder="you@example.com"
                />
              </div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <div className="relative mb-2">
                <Lock className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password" required
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                  placeholder="Your password"
                />
              </div>
              <div className="flex justify-end mb-4">
                <button type="button" onClick={forgotPassword} disabled={busy} className="text-xs text-indigo-600 hover:underline disabled:opacity-50">
                  Forgot password?
                </button>
              </div>
              <button type="submit" disabled={busy}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 rounded-lg transition-colors disabled:opacity-50">
                <LogIn className="w-5 h-5" /> {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}
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
