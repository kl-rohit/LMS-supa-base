// Platform Admin shell — a deliberately minimal frame that is completely
// separate from the academy app. No academy sidebar, no academy branding: this
// is the platform owner's cross-tenant console, reached at /platform behind the
// RequirePlatform guard (Catalyst App Administrator only). The matching server
// routes under /api/platform/* enforce the same rule independently.

import { lazy, Suspense, useEffect } from 'react';
import { Shield, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { BRAND_NAME } from '../config';
import Loader from '../components/Loader';

const Platform = lazy(() => import('../pages/Platform'));

export default function PlatformLayout() {
  const { user, signOut } = useAuth();

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.title = `Platform Admin — ${BRAND_NAME}`;
    }
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* The top bar is intentionally a dark slate in BOTH themes. The app's
          dark mode inverts the gray ramp (gray-900 turns near-white), so a
          `bg-gray-900` bar would flip to white-on-white and vanish. Pin the
          background to a fixed hex and use white-opacity tints for the muted
          text/hover so nothing depends on the themeable gray scale. */}
      <header className="h-16 bg-[#111827] text-white flex items-center px-4 lg:px-6 sticky top-0 z-20">
        <div className="flex items-center gap-2 min-w-0">
          <Shield className="w-5 h-5 text-indigo-300 flex-shrink-0" />
          <span className="text-lg font-semibold truncate">Platform Admin</span>
          <span className="hidden sm:inline text-sm text-white/50 truncate">· {BRAND_NAME}</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {user && (
            <span className="hidden sm:inline text-sm text-white/70 truncate max-w-[14rem]">
              {user.first_name || user.email}
            </span>
          )}
          <button
            onClick={signOut}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-white/80 hover:bg-white/10 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </header>

      <main className="flex-1 p-4 lg:p-6 overflow-auto">
        <Suspense fallback={<Loader text="Loading platform data..." />}>
          <Platform />
        </Suspense>
      </main>
    </div>
  );
}
