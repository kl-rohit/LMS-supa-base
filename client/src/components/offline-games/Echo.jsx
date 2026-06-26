import { useState, useRef, useEffect } from 'react';
import { Play, RotateCcw } from 'lucide-react';

// Echo: a Simon-style melody memory game. The pads flash a growing sequence;
// the player repeats it by tapping. Each cleared round adds one note.
const PADS = [
  { note: '🎵', on: 'bg-indigo-500',  off: 'bg-indigo-100' },
  { note: '🎶', on: 'bg-emerald-500', off: 'bg-emerald-100' },
  { note: '🎼', on: 'bg-amber-500',   off: 'bg-amber-100' },
  { note: '🎹', on: 'bg-rose-500',    off: 'bg-rose-100' },
];
const BEST_KEY = 'veena_og_echo_best'; // highest round reached (higher is better)

function readBest() {
  const n = parseInt(localStorage.getItem(BEST_KEY) || '', 10);
  return Number.isFinite(n) ? n : 0;
}

export default function Echo() {
  const [sequence, setSequence] = useState([]);
  const [phase, setPhase] = useState('idle'); // idle | showing | input | over
  const [activePad, setActivePad] = useState(-1);
  const [userIdx, setUserIdx] = useState(0);
  const [best, setBest] = useState(readBest);
  const timers = useRef([]);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => () => clearTimers(), []);

  const playSequence = (seq) => {
    setPhase('showing');
    setUserIdx(0);
    clearTimers();
    seq.forEach((pad, i) => {
      timers.current.push(setTimeout(() => setActivePad(pad), 600 * i + 300));
      timers.current.push(setTimeout(() => setActivePad(-1), 600 * i + 650));
    });
    timers.current.push(setTimeout(() => setPhase('input'), 600 * seq.length + 350));
  };

  const start = () => {
    const seq = [Math.floor(Math.random() * PADS.length)];
    setSequence(seq);
    playSequence(seq);
  };

  const tap = (padIdx) => {
    if (phase !== 'input') return;
    setActivePad(padIdx);
    timers.current.push(setTimeout(() => setActivePad(-1), 180));
    if (padIdx !== sequence[userIdx]) {
      const reached = sequence.length - 1; // rounds fully cleared
      if (reached > best) { localStorage.setItem(BEST_KEY, String(reached)); setBest(reached); }
      setPhase('over');
      return;
    }
    const nextIdx = userIdx + 1;
    if (nextIdx === sequence.length) {
      // round cleared → grow the sequence
      const grown = [...sequence, Math.floor(Math.random() * PADS.length)];
      setSequence(grown);
      timers.current.push(setTimeout(() => playSequence(grown), 600));
    } else {
      setUserIdx(nextIdx);
    }
  };

  const label = phase === 'showing' ? 'Watch the tune' : phase === 'input' ? 'Your turn' : phase === 'over' ? 'Out of tune' : 'Repeat the melody';

  return (
    <div>
      <div className="text-center mb-3">
        <p className="text-sm font-medium text-gray-700">{label}</p>
        <p className="text-xs text-gray-500">
          {phase === 'idle' ? 'Tap start, then echo the notes.' : phase === 'over' ? `Reached round ${sequence.length - 1}.` : `Round ${sequence.length}`}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {PADS.map((pad, idx) => (
          <button
            key={idx}
            type="button"
            disabled={phase !== 'input'}
            onClick={() => tap(idx)}
            aria-label={`Pad ${idx + 1}`}
            className={`aspect-square rounded-2xl text-3xl flex items-center justify-center transition-all duration-150 ${
              activePad === idx ? `${pad.on} scale-95 ring-4 ring-white/40` : pad.off
            } ${phase === 'input' ? 'active:scale-95 cursor-pointer' : 'cursor-default'}`}
          >
            {pad.note}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs text-gray-500">
          Best: <span className="font-semibold text-gray-700">{best}</span>
        </span>
        {phase === 'idle' || phase === 'over' ? (
          <button
            type="button"
            onClick={start}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700"
          >
            {phase === 'over' ? <RotateCcw className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {phase === 'over' ? 'Try again' : 'Start'}
          </button>
        ) : (
          <span className="text-xs text-gray-400">Listening…</span>
        )}
      </div>
    </div>
  );
}
