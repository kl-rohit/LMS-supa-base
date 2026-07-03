// Shows just-created sign-in details (email + one-time temp password) with
// "Copy details" and "Send on WhatsApp" actions. Used after creating a parent
// login, a teacher invite, or a new academy owner — the admin shares the
// credentials out-of-band (WhatsApp / in person) instead of email.
//
// Props:
//   email      — the login email
//   password   — the temp password (null when reusing an existing account)
//   waLink     — prefilled WhatsApp deep link (wa.me/... or api.whatsapp.com)
//   copyText   — the full message to copy to clipboard
//   note       — optional caption (e.g. "shown only once")

import { useState } from 'react';
import { Copy, Check, MessageSquare } from 'lucide-react';

export default function CredentialShare({ email, password, waLink, copyText, note }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — the details are still visible to copy manually */ }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-gray-500">Email</span>
          <span className="font-medium text-gray-800 break-all text-right">{email}</span>
        </div>
        {password ? (
          <div className="flex items-center justify-between gap-2 mt-1.5">
            <span className="text-gray-500">Temporary password</span>
            <span className="font-mono font-semibold text-gray-900 select-all">{password}</span>
          </div>
        ) : (
          <div className="mt-1.5 text-gray-600">
            This person already has an account — they sign in with their current password.
          </div>
        )}
      </div>

      {note ? <p className="text-xs text-amber-600">{note}</p> : null}

      <div className="flex gap-2">
        <button type="button" onClick={copy} className="btn-secondary btn-sm flex-1 justify-center">
          {copied ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy details</>}
        </button>
        {waLink ? (
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-sm flex-1 justify-center inline-flex items-center gap-1.5 rounded-md bg-green-600 hover:bg-green-700 text-white font-medium"
          >
            <MessageSquare className="w-4 h-4" /> Send on WhatsApp
          </a>
        ) : null}
      </div>
    </div>
  );
}
