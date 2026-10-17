// Parent-portal theme switcher — Light / Dark / Match device.
// Saved per device (localStorage, separate from the admin theme) so each person
// on a shared browser can pick their own without affecting anyone else.

import { useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { loadPortalMode, setPortalMode } from '../utils/theme';

const OPTS = [
  { v: 'light',  Icon: Sun,     label: 'Light' },
  { v: 'dark',   Icon: Moon,    label: 'Dark' },
  { v: 'system', Icon: Monitor, label: 'Match device' },
];

export default function PortalThemeToggle() {
  const [mode, setMode] = useState(loadPortalMode());
  const pick = (v) => { setMode(v); setPortalMode(v); };
  return (
    <div
      className="inline-flex items-center rounded-lg border border-gray-200 p-0.5"
      role="group"
      aria-label="Theme mode"
    >
      {OPTS.map(({ v, Icon, label }) => (
        <button
          key={v}
          type="button"
          onClick={() => pick(v)}
          title={label}
          aria-label={label}
          aria-pressed={mode === v}
          className={`p-1.5 rounded-md transition-colors ${
            mode === v ? 'bg-indigo-50 text-indigo-600' : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          <Icon className="w-4 h-4" />
        </button>
      ))}
    </div>
  );
}
