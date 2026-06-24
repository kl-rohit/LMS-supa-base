// Animated money counter — rolls from 0 up to the target when it mounts.
//
// Used for the bank-style "Show amounts" reveal: the moment a figure is
// unmasked it counts up so the number feels alive instead of just appearing.
// Mount it fresh each reveal (e.g. with a `key` tied to the reveal state) so
// the roll restarts every time.
//
// Respects prefers-reduced-motion: those users get the final value instantly,
// no animation. Formatting matches the rest of the app (en-IN grouping, a ₹
// prefix by default, and an optional minus sign for negative balances).

import { useEffect, useRef, useState } from 'react';

// cubic ease-out — fast start, gentle settle (mirrors the landing page roll)
function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export default function CountUpAmount({
  value,
  prefix = '₹',
  signedNegative = false,
  duration = 900,
}) {
  const target = Number(value) || 0;
  const [display, setDisplay] = useState(prefersReducedMotion() ? target : 0);
  const rafRef = useRef(null);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setDisplay(target);
      return undefined;
    }

    let start = null;
    const from = 0;

    const step = (ts) => {
      if (start === null) start = ts;
      const elapsed = ts - start;
      const t = Math.min(1, elapsed / duration);
      setDisplay(from + (target - from) * easeOut(t));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setDisplay(target);
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  const rounded = Math.round(display);
  const abs = Math.abs(rounded).toLocaleString('en-IN');
  const sign = signedNegative && rounded < 0 ? '−' : '';

  return (
    <span>
      {sign}
      {prefix}
      {abs}
    </span>
  );
}
