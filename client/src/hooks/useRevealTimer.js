// Bank-style reveal/auto-hide for sensitive UI.
//
// Usage:
//   const { revealed, toggle } = useRevealTimer(20000);
//   ...
//   <button onClick={toggle}>{revealed ? <Eye/> : <EyeOff/>}</button>
//   {revealed ? raw : masked}
//
// Calling reveal() opens, then auto-hides after `timeoutMs`.
// Calling reveal() again while open resets the timer.
// toggle() opens if hidden, hides immediately if open.

import { useState, useRef, useEffect, useCallback } from 'react';

export function useRevealTimer(timeoutMs = 20000) {
  const [revealed, setRevealed] = useState(false);
  const timerRef = useRef(null);

  const hide = useCallback(() => {
    setRevealed(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reveal = useCallback(() => {
    setRevealed(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setRevealed(false);
      timerRef.current = null;
    }, timeoutMs);
  }, [timeoutMs]);

  const toggle = useCallback(() => {
    if (revealed) hide();
    else reveal();
  }, [revealed, hide, reveal]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { revealed, reveal, hide, toggle };
}
