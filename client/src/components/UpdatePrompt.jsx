import { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';

// Shows a small banner when a new build has been downloaded and is waiting.
// Tapping Refresh tells the waiting service worker to take over; index.js then
// reloads on controllerchange. Removes the old habit of users sitting on a
// stale build until they happen to fully close the app.
export default function UpdatePrompt() {
  const [reg, setReg] = useState(null);

  useEffect(() => {
    const onWaiting = (e) => setReg(e.detail || null);
    window.addEventListener('veena:sw-waiting', onWaiting);
    return () => window.removeEventListener('veena:sw-waiting', onWaiting);
  }, []);

  if (!reg) return null;

  const refresh = () => {
    const waiting = reg.waiting;
    if (waiting) waiting.postMessage('SKIP_WAITING');
    // If for some reason there is no waiting worker, a plain reload still helps.
    else window.location.reload();
  };

  return (
    <div className="fixed bottom-4 inset-x-0 z-[55] flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 bg-gray-900 text-white rounded-xl shadow-lg px-4 py-3 max-w-sm w-full">
        <RefreshCw className="w-5 h-5 flex-shrink-0 text-indigo-300" />
        <span className="text-sm flex-1">A new version is ready.</span>
        <button
          type="button"
          onClick={refresh}
          className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
