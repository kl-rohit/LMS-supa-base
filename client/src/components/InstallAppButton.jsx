// "Add to Home Screen" button — shown on phones only, hidden once installed.
//
// Two install paths:
//   • Android / Chromium: the browser fires `beforeinstallprompt`. We stash the
//     event and replay it via prompt() on tap — a native install dialog.
//   • iOS Safari: there is NO beforeinstallprompt and no programmatic install,
//     so the button opens a tiny instruction sheet (Share → Add to Home Screen).
//
// Visibility rules:
//   • `lg:hidden` keeps it off desktop layouts (phones/tablets only).
//   • Hidden entirely when the app is already running standalone (installed).
//   • On Android it only appears once the browser deems the app installable
//     (beforeinstallprompt fired); on iOS it always shows (until installed).

import { useEffect, useState } from 'react';
import { Download, Share, Plus, X } from 'lucide-react';

const IS_IOS =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports as Mac but is touch-capable
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

// Already installed / launched from the home screen?
function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator.standalone === true // iOS Safari
  );
}

export default function InstallAppButton() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    if (isStandalone()) return; // already installed — nothing to offer

    // Android / Chromium: capture the install event and reveal the button.
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    // Once installed, hide the button (covers the Android accept flow).
    const onInstalled = () => {
      setVisible(false);
      setDeferredPrompt(null);
    };
    window.addEventListener('appinstalled', onInstalled);

    // iOS never fires beforeinstallprompt — show the button so we can surface
    // the manual Share-sheet instructions.
    if (IS_IOS) setVisible(true);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!visible) return null;

  const handleClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try {
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') setVisible(false);
      } catch {}
      setDeferredPrompt(null);
      return;
    }
    if (IS_IOS) setShowIosHelp(true);
  };

  return (
    <>
      {/* lg:hidden → phones/tablets only, never on desktop */}
      <div className="lg:hidden">
        <button
          onClick={handleClick}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 px-4 py-2.5 text-sm font-medium hover:bg-indigo-100 transition-colors"
        >
          <Download className="w-4 h-4" />
          Add to Home Screen
        </button>
      </div>

      {/* iOS instructions sheet */}
      {showIosHelp && (
        <div
          className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/40 lg:hidden"
          onClick={() => setShowIosHelp(false)}
        >
          <div
            className="w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-5 m-0 sm:m-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-gray-900">Add to Home Screen</h3>
              <button
                onClick={() => setShowIosHelp(false)}
                className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <ol className="space-y-3 text-sm text-gray-700">
              <li className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-semibold">1</span>
                <span className="flex items-center gap-1.5">
                  Tap the <Share className="w-4 h-4 inline text-indigo-600" /> <b>Share</b> button in the Safari toolbar.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-semibold">2</span>
                <span className="flex items-center gap-1.5">
                  Choose <Plus className="w-4 h-4 inline text-indigo-600" /> <b>Add to Home Screen</b>.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-semibold">3</span>
                <span>Tap <b>Add</b> — the app icon appears on your home screen.</span>
              </li>
            </ol>
          </div>
        </div>
      )}
    </>
  );
}
