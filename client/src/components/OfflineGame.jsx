import { useState, useEffect } from 'react';
import { WifiOff, X } from 'lucide-react';
import MemoryMatch from './offline-games/MemoryMatch';
import Echo from './offline-games/Echo';
import NoteCatch from './offline-games/NoteCatch';
import TicTacToe from './offline-games/TicTacToe';

// A small set of offline games shown when the device loses connection. The
// overlay closes itself the moment connectivity returns. A fresh game is
// chosen on each disconnect, and the player can switch games with the pills.
// Self-contained: no context, no network, no extra chunk (eagerly imported
// into the app shell so it is always available, including offline).
const GAMES = [
  { key: 'memory', label: 'Memory', Comp: MemoryMatch },
  { key: 'echo',   label: 'Echo',   Comp: Echo },
  { key: 'catch',  label: 'Catch',  Comp: NoteCatch },
  { key: 'ttt',    label: 'Tic-tac-toe', Comp: TicTacToe },
];

function randomKey() {
  return GAMES[Math.floor(Math.random() * GAMES.length)].key;
}

export default function OfflineGame() {
  // Surface the game only when the connection DROPS during use, keyed off the
  // 'offline' event — not the initial navigator.onLine. On a cold offline
  // launch we let the cached app render normally instead of slamming a
  // full-screen overlay over the UI the user is trying to reach.
  const [visible, setVisible] = useState(false);
  const [activeKey, setActiveKey] = useState(randomKey);

  useEffect(() => {
    const goOnline = () => setVisible(false);
    const goOffline = () => { setActiveKey(randomKey()); setVisible(true); };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  if (!visible) return null;

  const active = GAMES.find((g) => g.key === activeKey) || GAMES[0];
  const ActiveGame = active.Comp;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center">
            <WifiOff className="w-5 h-5 text-indigo-600" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">You're offline</h2>
            <p className="text-xs text-gray-500">Have a game while we reconnect you.</p>
          </div>
          <button
            type="button"
            onClick={() => setVisible(false)}
            aria-label="Back to app"
            title="Back to app"
            className="ml-auto p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Game switcher */}
        <div className="mt-4 flex flex-wrap gap-1.5">
          {GAMES.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setActiveKey(g.key)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                g.key === activeKey
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {/* key forces a fresh game instance when the player switches */}
          <ActiveGame key={activeKey} />
        </div>
      </div>
    </div>
  );
}
