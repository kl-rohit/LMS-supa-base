// Full-screen prompt shown right after a user signs in with an admin-issued
// temporary password (user_metadata.must_set_password === true). They must
// choose their own password before using the app. Rendered by AuthProvider.

import { useState } from 'react';
import { KeyRound, Lock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function ForcePasswordSet() {
  const { completePasswordSet, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('Please use at least 8 characters.');
    if (password !== confirm) return setError('The two passwords do not match.');
    setBusy(true);
    try {
      await completePasswordSet(password);
    } catch (err) {
      setError(err?.message || 'Could not set your password. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-md border border-gray-100 p-6">
        <div className="flex items-center gap-2 mb-1">
          <KeyRound className="w-5 h-5 text-indigo-600" />
          <h1 className="text-lg font-semibold text-gray-900">Set your password</h1>
        </div>
        <p className="text-sm text-gray-500 mb-5">
          You signed in with a temporary password. Choose your own password to continue.
        </p>

        {error ? (
          <div className="mb-4 text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{error}</div>
        ) : null}

        <form onSubmit={submit}>
          <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
          <div className="relative mb-4">
            <Lock className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password" minLength={8} required autoFocus
              className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
              placeholder="At least 8 characters"
            />
          </div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Confirm password</label>
          <div className="relative mb-5">
            <Lock className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password" minLength={8} required
              className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
              placeholder="Re-enter the password"
            />
          </div>
          <button type="submit" disabled={busy}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 rounded-lg transition-colors disabled:opacity-50">
            {busy ? 'Saving…' : 'Save & continue'}
          </button>
        </form>

        <button onClick={signOut} className="w-full text-center text-xs text-gray-400 hover:text-gray-600 mt-4">
          Sign out instead
        </button>
      </div>
    </div>
  );
}
