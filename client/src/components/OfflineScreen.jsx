import { useEffect } from 'react';
import { Wifi } from 'lucide-react';
import { BRAND_NAME } from '../config';

// Shown when the app can't reach the server because the connection is down and
// there's no cached session to fall through to. Branded like the boot splash
// (logo + name), with a reconnect prompt. It watches for the connection to
// return and reloads on its own, so the user usually doesn't even need Retry.
const BASE = (process.env.PUBLIC_URL || '/').replace(/\/$/, '');

export default function OfflineScreen() {
  useEffect(() => {
    const onOnline = () => window.location.reload();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-5 px-6 text-center">
      <img
        src={`${BASE}/logo.png`}
        alt=""
        className="w-14 h-14 rounded-2xl shadow-sm splash-logo"
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />
      <p className="text-lg font-semibold text-gray-900">{BRAND_NAME}</p>
      <div className="flex items-center gap-2 text-gray-500">
        <Wifi className="w-4 h-4" />
        <span className="text-sm">Waiting for your connection…</span>
      </div>
      <p className="text-sm text-gray-400 max-w-xs">
        Connect to the internet to continue. This screen refreshes on its own once you are back online. Your data is safe.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="btn-primary btn-sm"
      >
        Try again
      </button>
    </div>
  );
}
