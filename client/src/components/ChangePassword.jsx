// Self-service password change for the signed-in user. Client-only via Supabase
// Auth: it re-authenticates with the current password first (so an unattended
// open session can't be used to silently change the password), then updates to
// the new one. Used in the parent portal profile and admin Settings.

import { useState } from 'react';
import { KeyRound, Loader2, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../utils/supabaseClient';

export default function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    if (next.length < 8) { toast.error('New password must be at least 8 characters'); return; }
    if (next !== confirm) { toast.error('New passwords do not match'); return; }
    if (next === current) { toast.error('New password must be different from the current one'); return; }
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const email = user?.email;
      if (!email) { toast.error('Could not confirm your account. Please sign in again.'); return; }
      // Re-authenticate with the current password before allowing the change.
      const { error: reauthErr } = await supabase.auth.signInWithPassword({ email, password: current });
      if (reauthErr) { toast.error('Current password is incorrect'); return; }
      const { error: updErr } = await supabase.auth.updateUser({ password: next });
      if (updErr) { toast.error(updErr.message || 'Could not update password'); return; }
      toast.success('Password updated');
      setCurrent(''); setNext(''); setConfirm('');
    } catch (e2) {
      toast.error('Could not update password: ' + e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-4">
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-gray-400" /> Change password
        </h3>
        <p className="text-xs text-gray-500 mt-0.5">Update the password you use to sign in.</p>
      </div>
      <form onSubmit={submit} className="space-y-3 max-w-sm">
        <input
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          placeholder="Current password"
          className="input-field"
          required
        />
        <input
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder="New password (at least 8 characters)"
          className="input-field"
          required
        />
        <input
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm new password"
          className="input-field"
          required
        />
        <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer select-none">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
          {show ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />} Show new password
        </label>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Updating...</>
            : <><KeyRound className="w-4 h-4" /> Update password</>}
        </button>
      </form>
    </div>
  );
}
