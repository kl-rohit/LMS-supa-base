// Generic number roll-up: animates 0 → value on mount and renders format(n).
// Same easing + reduced-motion behaviour as CountUpAmount, but for plain
// stats (counts, percentages) rather than money. Under prefers-reduced-motion
// it shows the final value instantly.

import { useEffect, useRef, useState } from 'react';

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

export default function CountUp({ value, format = (n) => Number(n).toLocaleString('en-IN'), duration = 900 }) {
  const target = Number(value) || 0;
  const [display, setDisplay] = useState(prefersReducedMotion() ? target : 0);
  const rafRef = useRef(null);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setDisplay(target);
      return undefined;
    }
    let start = null;
    const step = (ts) => {
      if (start === null) start = ts;
      const t = Math.min(1, (ts - start) / duration);
      setDisplay(target * easeOut(t));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setDisplay(target);
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);

  return <span>{format(Math.round(display))}</span>;
}
