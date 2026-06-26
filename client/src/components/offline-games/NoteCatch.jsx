import { useState, useRef, useEffect } from 'react';
import { Play, RotateCcw } from 'lucide-react';

// Note Catch: musical notes fall down 3 lanes. Move the basket to the lane a
// note lands in to catch it. Miss three and the round ends. Lane-based (no
// pixel physics) so it stays simple and touch-friendly.
const LANES = 3;
const ROWS = 5;          // vertical steps a note travels
const NOTES = ['🎵', '🎶', '🎼', '🎷'];
const BEST_KEY = 'veena_og_catch_best'; // highest score (higher is better)
const TICK_MS = 650;

function readBest() {
  const n = parseInt(localStorage.getItem(BEST_KEY) || '', 10);
  return Number.isFinite(n) ? n : 0;
}

export default function NoteCatch() {
  const [notes, setNotes] = useState([]); // { id, lane, row, glyph }
  const [basket, setBasket] = useState(1);
  const [score, setScore] = useState(0);
  const [misses, setMisses] = useState(0);
  const [running, setRunning] = useState(false);
  const [best, setBest] = useState(readBest);
  const timer = useRef(null);
  const nextId = useRef(1);
  const basketRef = useRef(1);

  useEffect(() => { basketRef.current = basket; }, [basket]);
  useEffect(() => () => clearInterval(timer.current), []);

  const stop = (finalScore) => {
    clearInterval(timer.current);
    timer.current = null;
    setRunning(false);
    if (finalScore > best) { localStorage.setItem(BEST_KEY, String(finalScore)); setBest(finalScore); }
  };

  const start = () => {
    setNotes([]);
    setScore(0);
    setMisses(0);
    setBasket(1);
    basketRef.current = 1;
    nextId.current = 1;
    setRunning(true);
    clearInterval(timer.current);
    timer.current = setInterval(tick, TICK_MS);
  };

  const tick = () => {
    setNotes((prev) => {
      let landedCatch = 0;
      let landedMiss = 0;
      const advanced = [];
      for (const n of prev) {
        const row = n.row + 1;
        if (row >= ROWS) {
          if (n.lane === basketRef.current) landedCatch++; else landedMiss++;
        } else {
          advanced.push({ ...n, row });
        }
      }
      // Spawn a new note most ticks.
      if (Math.random() < 0.85) {
        advanced.push({ id: nextId.current++, lane: Math.floor(Math.random() * LANES), row: 0, glyph: NOTES[Math.floor(Math.random() * NOTES.length)] });
      }
      if (landedCatch) setScore((s) => s + landedCatch);
      if (landedMiss) {
        setMisses((m) => {
          const total = m + landedMiss;
          if (total >= 3) {
            // Read the latest score after this catch was applied.
            setScore((s) => { stop(s); return s; });
          }
          return total;
        });
      }
      return advanced;
    });
  };

  // Build a grid view: rows top→bottom, with the basket row appended at bottom.
  const cellNote = (lane, row) => notes.find((n) => n.lane === lane && n.row === row);

  return (
    <div>
      <div className="text-center mb-3">
        <p className="text-sm font-medium text-gray-700">
          {running ? 'Catch the notes' : misses >= 3 ? 'Round over' : 'Note Catch'}
        </p>
        <p className="text-xs text-gray-500">
          {running ? `Misses ${misses}/3` : 'Tap a lane to move the basket. Miss three and the round ends.'}
        </p>
      </div>

      <div className="rounded-xl bg-indigo-50/60 p-2">
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${LANES}, minmax(0, 1fr))` }}>
          {Array.from({ length: ROWS }).map((_, row) =>
            Array.from({ length: LANES }).map((__, lane) => {
              const note = cellNote(lane, row);
              return (
                <div key={`${row}-${lane}`} className="aspect-square rounded-lg flex items-center justify-center text-xl">
                  {note ? note.glyph : ''}
                </div>
              );
            })
          )}
        </div>
        {/* Basket row */}
        <div className="grid gap-1 mt-1" style={{ gridTemplateColumns: `repeat(${LANES}, minmax(0, 1fr))` }}>
          {Array.from({ length: LANES }).map((_, lane) => (
            <button
              key={lane}
              type="button"
              onClick={() => setBasket(lane)}
              aria-label={`Lane ${lane + 1}`}
              className={`aspect-square rounded-lg text-xl flex items-center justify-center transition-colors ${
                basket === lane ? 'bg-indigo-600 text-white' : 'bg-white hover:bg-indigo-100'
              }`}
            >
              🧺
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs text-gray-500">
          Score: <span className="font-semibold text-gray-700">{score}</span>
          <span className="ml-2">Best: <span className="font-semibold text-gray-700">{best}</span></span>
        </span>
        {!running && (
          <button
            type="button"
            onClick={start}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700"
          >
            {misses >= 3 ? <RotateCcw className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {misses >= 3 ? 'Play again' : 'Start'}
          </button>
        )}
      </div>
    </div>
  );
}
