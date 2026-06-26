import { useState } from 'react';
import { RotateCcw, Music, PartyPopper } from 'lucide-react';

// Music-themed memory match: flip cards to find the 6 matching pairs.
const EMOJIS = ['🎵', '🎸', '🎹', '🥁', '🎺', '🎻'];
const BEST_KEY = 'veena_og_memory_best'; // fewest moves (lower is better)

function freshDeck() {
  const deck = [...EMOJIS, ...EMOJIS].map((emoji, i) => ({ key: i, emoji }));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function readBest() {
  const n = parseInt(localStorage.getItem(BEST_KEY) || '', 10);
  return Number.isFinite(n) ? n : null;
}

export default function MemoryMatch() {
  const [deck, setDeck] = useState(freshDeck);
  const [flipped, setFlipped] = useState([]);
  const [matched, setMatched] = useState([]);
  const [moves, setMoves] = useState(0);
  const [busy, setBusy] = useState(false);
  const [best, setBest] = useState(readBest);

  const reset = () => {
    setDeck(freshDeck());
    setFlipped([]);
    setMatched([]);
    setMoves(0);
    setBusy(false);
  };

  const pick = (idx) => {
    if (busy || flipped.includes(idx) || matched.includes(idx)) return;
    const next = [...flipped, idx];
    setFlipped(next);
    if (next.length === 2) {
      const moveCount = moves + 1;
      setMoves(moveCount);
      const [a, b] = next;
      if (deck[a].emoji === deck[b].emoji) {
        const nowMatched = [...matched, a, b];
        setMatched(nowMatched);
        setFlipped([]);
        if (nowMatched.length === deck.length) {
          if (best == null || moveCount < best) {
            localStorage.setItem(BEST_KEY, String(moveCount));
            setBest(moveCount);
          }
        }
      } else {
        setBusy(true);
        setTimeout(() => { setFlipped([]); setBusy(false); }, 800);
      }
    }
  };

  const won = matched.length === deck.length;

  return (
    <div>
      {won ? (
        <div className="mt-2 mb-2 text-center">
          <PartyPopper className="w-10 h-10 mx-auto text-indigo-600 dark:text-indigo-300" />
          <p className="mt-3 text-lg font-semibold text-gray-900 dark:text-white">Cleared in {moves} moves</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Well played.</p>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {deck.map((card, idx) => {
            const faceUp = flipped.includes(idx) || matched.includes(idx);
            const isMatched = matched.includes(idx);
            return (
              <button
                key={card.key}
                type="button"
                onClick={() => pick(idx)}
                aria-label={faceUp ? 'Card revealed' : 'Hidden card'}
                className={`aspect-square rounded-xl text-2xl flex items-center justify-center transition-all duration-150 select-none ${
                  faceUp
                    ? `bg-white dark:bg-gray-700 ring-2 ring-indigo-500 ${isMatched ? 'opacity-60' : ''}`
                    : 'bg-indigo-50 dark:bg-gray-700 hover:bg-indigo-100 dark:hover:bg-gray-600 active:scale-95'
                }`}
              >
                {faceUp ? card.emoji : <Music className="w-5 h-5 text-indigo-300 dark:text-gray-500" />}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          Moves: <span className="font-semibold text-gray-700 dark:text-gray-200">{moves}</span>
          {best != null && <span className="ml-2">Best: <span className="font-semibold text-gray-700 dark:text-gray-200">{best}</span></span>}
        </span>
        <button
          type="button"
          onClick={reset}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          <RotateCcw className="w-4 h-4" />
          {won ? 'Play again' : 'New game'}
        </button>
      </div>
    </div>
  );
}
