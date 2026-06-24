// Public certificate verification page (no login).
//
// Reached via /app/verify/CERT-<org>-<course>-<student>?c=<code> — the link a
// certificate's QR encodes. Calls the public /api/verify endpoint, which only
// returns details when the HMAC code matches, so the page can't be used to
// enumerate students. Renders a clean genuine / could-not-verify state.

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { BadgeCheck, ShieldAlert, Loader2 } from 'lucide-react';
import api from '../utils/api';
import { BRAND_NAME } from '../config';

export default function VerifyCertificate() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const code = params.get('c') || '';

  const [state, setState] = useState({ loading: true, result: null, error: '' });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get(`/verify/${encodeURIComponent(id)}?c=${encodeURIComponent(code)}`);
        if (alive) setState({ loading: false, result: res, error: '' });
      } catch (e) {
        if (alive) setState({ loading: false, result: null, error: e.message || 'Verification failed' });
      }
    })();
    return () => { alive = false; };
  }, [id, code]);

  const { loading, result, error } = state;
  const valid = !!result?.valid;

  let dateStr = '';
  try {
    if (result?.completed_at) {
      dateStr = new Date(result.completed_at).toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric',
      });
    }
  } catch { dateStr = ''; }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100">
          <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-300">{BRAND_NAME}</p>
          <h1 className="text-lg font-bold text-gray-900">Certificate verification</h1>
        </div>

        <div className="px-6 py-8">
          {loading && (
            <div className="flex flex-col items-center gap-3 text-gray-500">
              <Loader2 className="w-8 h-8 animate-spin" />
              <p>Checking this certificate…</p>
            </div>
          )}

          {!loading && valid && (
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                <BadgeCheck className="w-9 h-9 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-emerald-700 dark:text-emerald-400 font-semibold">This certificate is genuine</p>
                <p className="text-sm text-gray-500 mt-1">Issued by {result.academy_name}</p>
              </div>
              <dl className="w-full text-left mt-2 divide-y divide-gray-100">
                <Row label="Awarded to" value={result.student_name} />
                <Row label="Course" value={result.course_name} />
                <Row label="Academy" value={result.academy_name} />
                {dateStr && <Row label="Completed on" value={dateStr} />}
                <Row label="Certificate ID" value={result.certificate_id} mono />
              </dl>
            </div>
          )}

          {!loading && !valid && (
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                <ShieldAlert className="w-9 h-9 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-gray-900 font-semibold">We could not verify this certificate</p>
                <p className="text-sm text-gray-500 mt-1">
                  The link may be incomplete or the certificate may not have been issued. Please check the full link from the certificate and try again.
                </p>
                {error && <p className="text-xs text-gray-400 mt-2">{error}</p>}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 text-center">
          <p className="text-xs text-gray-400">Verified securely by {BRAND_NAME}</p>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="text-sm text-gray-500 shrink-0">{label}</dt>
      <dd className={`text-sm font-medium text-gray-900 text-right ${mono ? 'font-mono text-xs break-all' : ''}`}>
        {value || '-'}
      </dd>
    </div>
  );
}
