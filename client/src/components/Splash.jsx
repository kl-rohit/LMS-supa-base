import { BRAND_NAME } from '../config';

// Branded first-boot screen, shown while the app resolves auth/org on load.
// Replaces the bare centred spinner so the very first thing users see feels
// like the product. The logo breathes and a thin indeterminate bar slides;
// both still under prefers-reduced-motion (global guard in index.css).
const BASE = (process.env.PUBLIC_URL || '/').replace(/\/$/, '');

export default function Splash() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-5 px-6">
      <img
        src={`${BASE}/logo.png`}
        alt=""
        className="w-14 h-14 rounded-2xl shadow-sm splash-logo"
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />
      <p className="text-lg font-semibold text-gray-900">{BRAND_NAME}</p>
      <div className="h-1 w-40 rounded-full bg-gray-200 overflow-hidden">
        <div className="splash-bar h-full w-1/3 rounded-full bg-indigo-500" />
      </div>
    </div>
  );
}
