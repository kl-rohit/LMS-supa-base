// Public Signup page — creates a new academy (Organization) on submit.
//
// Flow:
//   1. User fills the form (academy name + their name + email)
//   2. POST /api/auth/signup → backend creates Catalyst user + Org + Owner membership
//   3. We show a "check your email" success state
//   4. User clicks the email invite → sets password on Catalyst's hosted page
//   5. They come back to /login, sign in, land in their fresh empty academy

import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Music2, ArrowRight, Loader2, Mail, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Signup() {
  const { user, loading } = useAuth();

  const [form, setForm] = useState({
    academy_name: '',
    first_name:   '',
    last_name:    '',
    owner_email:  '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null);   // { org, owner_email } on success
  const [error, setError] = useState('');

  // If already signed in, bounce home — signup is for fresh accounts.
  if (!loading && user) return <Navigate to="/" replace />;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.academy_name.trim()) return setError('Academy name is required.');
    if (!form.first_name.trim())   return setError('Your first name is required.');
    if (!form.owner_email.trim())  return setError('Email is required.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.owner_email)) {
      return setError('Please enter a valid email address.');
    }
    try {
      setSubmitting(true);
      // Hit the API directly (no auth required for /signup).
      const resp = await fetch('/server/api/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data?.error || data?.detail || 'Signup failed');
        return;
      }
      setSuccess({ org: data.org, email: form.owner_email });
    } catch (err) {
      setError(err.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  // ----- Success state -----------------------------------------------------
  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-md border border-gray-100 p-6 text-center">
            <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-7 h-7 text-green-600" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">Academy created!</h1>
            <p className="text-sm text-gray-600 mt-2">
              <span className="font-medium text-indigo-700">{success.org.name}</span> is ready.
            </p>
            <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 mt-4 text-left text-sm">
              <p className="flex items-start gap-2 text-indigo-900">
                <Mail className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>
                  We sent an invite to <span className="font-medium">{success.email}</span>. Click the link
                  in the email to set your password — then sign in to start adding students.
                </span>
              </p>
            </div>
            <Link
              to="/login"
              className="mt-5 inline-flex items-center justify-center gap-2 w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 rounded-lg transition-colors"
            >
              Go to sign in <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <p className="text-center text-xs text-gray-400 mt-6">
            Didn't get the email? Check spam, or contact support.
          </p>
        </div>
      </div>
    );
  }

  // ----- Form state --------------------------------------------------------
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg mb-3">
            <Music2 className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Create your academy</h1>
          <p className="text-sm text-gray-500 mt-1 text-center">
            Spin up your own students, classes, fees, and parent portal in a few clicks.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-md border border-gray-100 p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Academy name</label>
            <input
              type="text"
              value={form.academy_name}
              onChange={set('academy_name')}
              className="input-field"
              placeholder="e.g. Sangeet Sadhana"
              autoFocus
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">First name</label>
              <input
                type="text"
                value={form.first_name}
                onChange={set('first_name')}
                className="input-field"
                placeholder="Your first name"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Last name</label>
              <input
                type="text"
                value={form.last_name}
                onChange={set('last_name')}
                className="input-field"
                placeholder="Optional"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={form.owner_email}
              onChange={set('owner_email')}
              className="input-field"
              placeholder="you@example.com"
              required
            />
            <p className="text-xs text-gray-400 mt-1">
              We'll send a password-setup link here.
            </p>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 rounded-lg transition-colors disabled:opacity-50"
          >
            {submitting ? (
              <><Loader2 className="w-5 h-5 animate-spin" /> Creating...</>
            ) : (
              <>Create academy <ArrowRight className="w-5 h-5" /></>
            )}
          </button>

          <p className="text-xs text-gray-400 text-center pt-2">
            By creating an academy you agree to use the platform reasonably.
          </p>
        </form>

        <p className="text-center text-sm text-gray-600 mt-6">
          Already have an academy?{' '}
          <Link to="/login" className="text-indigo-600 hover:text-indigo-700 font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
