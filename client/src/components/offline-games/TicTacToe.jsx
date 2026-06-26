import { useState } from 'react';
import { RotateCcw } from 'lucide-react';

// Tic-tac-toe against a simple AI. Player is ✖, computer is ⭕. The AI wins
// when it can, blocks when it must, otherwise takes centre/corner/any.
const WINS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];
const WINS_KEY = 'veena_og_ttt_wins'; // games won vs the computer

function winner(b) {
  for (const [a, c, d] of WINS) {
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
  }
  return b.every(Boolean) ? 'draw' : null;
}

function findLine(b, mark) {
  for (const line of WINS) {
    const cells = line.map((i) => b[i]);
    if (cells.filter((c) => c === mark).length === 2 && cells.includes('')) {
      return line[cells.indexOf('')];
    }
  }
  return -1;
}

function aiMove(b) {
  let m = findLine(b, 'O'); if (m >= 0) return m;       // win
  m = findLine(b, 'X'); if (m >= 0) return m;            // block
  if (!b[4]) return 4;                                   // centre
  const corners = [0, 2, 6, 8].filter((i) => !b[i]);
  if (corners.length) return corners[Math.floor(Math.random() * corners.length)];
  const free = b.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
  return free[Math.floor(Math.random() * free.length)];
}

function readWins() {
  const n = parseInt(localStorage.getItem(WINS_KEY) || '', 10);
  return Number.isFinite(n) ? n : 0;
}

export default function TicTacToe() {
  const [board, setBoard] = useState(Array(9).fill(''));
  const [result, setResult] = useState(null); // 'X' | 'O' | 'draw' | null
  const [wins, setWins] = useState(readWins);

  const reset = () => { setBoard(Array(9).fill('')); setResult(null); };

  const play = (i) => {
    if (board[i] || result) return;
    const afterX = board.slice();
    afterX[i] = 'X';
    let w = winner(afterX);
    if (w) { finish(afterX, w); return; }
    const m = aiMove(afterX);
    if (m >= 0) afterX[m] = 'O';
    w = winner(afterX);
    setBoard(afterX);
    if (w) finish(afterX, w);
  };

  const finish = (b, w) => {
    setBoard(b);
    setResult(w);
    if (w === 'X') {
      const next = readWins() + 1;
      localStorage.setItem(WINS_KEY, String(next));
      setWins(next);
    }
  };

  const status = result === 'X' ? 'You win 🎉' : result === 'O' ? 'Computer wins' : result === 'draw' ? 'A draw' : 'Your move (✖)';

  return (
    <div>
      <div className="text-center mb-3">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{status}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">You are ✖, computer is ⭕.</p>
      </div>

      <div className="grid grid-cols-3 gap-2 max-w-[240px] mx-auto">
        {board.map((cell, i) => (
          <button
            key={i}
            type="button"
            onClick={() => play(i)}
            disabled={!!cell || !!result}
            aria-label={`Cell ${i + 1}`}
            className={`aspect-square rounded-xl text-3xl font-bold flex items-center justify-center transition-colors ${
              cell ? 'bg-white dark:bg-gray-700' : 'bg-indigo-50 dark:bg-gray-700 hover:bg-indigo-100 dark:hover:bg-gray-600 active:scale-95'
            }`}
          >
            {cell === 'X' ? '✖' : cell === 'O' ? '⭕' : ''}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          Wins: <span className="font-semibold text-gray-700 dark:text-gray-200">{wins}</span>
        </span>
        <button
          type="button"
          onClick={reset}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          <RotateCcw className="w-4 h-4" />
          New game
        </button>
      </div>
    </div>
  );
}
