// Custom <Select> — a fully-styled dropdown replacement for native <select>.
//
// Why: native <select> popups can't be themed (Chrome shows a dark high-
// contrast list on macOS), so this gives us a consistent indigo-themed
// menu across the app.
//
// API matches native select where possible:
//   <Select
//     value={value}
//     onChange={(newValue) => ...}
//     options={[{ value, label }, ...]}
//     placeholder="Pick one"
//   />
//
// Keyboard support:
//   • Click / Space / Enter / ArrowDown — open
//   • ArrowUp / ArrowDown — move highlight
//   • Enter — pick the highlighted option, close
//   • Esc — close without changes

import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export default function Select({
  value,
  onChange,
  options = [],
  placeholder = 'Select...',
  className = '',
  buttonClassName = '',
  disabled = false,
  ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);

  // Normalize options — accept either strings or {value,label} objects
  const normOptions = options.map((o) =>
    typeof o === 'object' && o !== null ? { value: o.value, label: o.label ?? String(o.value), disabled: o.disabled } : { value: o, label: String(o) }
  );
  const selected = normOptions.find((o) => String(o.value) === String(value));

  const close = useCallback(() => { setOpen(false); setHighlight(-1); }, []);
  const toggle = useCallback(() => {
    if (disabled) return;
    setOpen((v) => {
      if (!v) {
        // Highlight the current value when opening
        const idx = normOptions.findIndex((o) => String(o.value) === String(value));
        setHighlight(idx >= 0 ? idx : 0);
      }
      return !v;
    });
  }, [disabled, normOptions, value]);

  const pick = useCallback((opt) => {
    if (opt?.disabled) return;
    onChange?.(opt.value);
    close();
  }, [onChange, close]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (popoverRef.current?.contains(e.target)) return;
      close();
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open, close]);

  // Keyboard nav
  const onKeyDown = (e) => {
    if (disabled) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, normOptions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlight >= 0) pick(normOptions[highlight]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setHighlight(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setHighlight(normOptions.length - 1);
    }
  };

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        onKeyDown={onKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={`flex items-center justify-between gap-2 w-full px-3 py-2 text-left bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-colors hover:border-gray-400 disabled:bg-gray-50 disabled:cursor-not-allowed ${buttonClassName}`}
      >
        <span className={selected ? 'text-gray-900' : 'text-gray-400'}>
          {selected?.label || placeholder}
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="listbox"
          className="absolute z-50 mt-1 w-full min-w-max bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-y-auto py-1"
        >
          {normOptions.length === 0 ? (
            <p className="text-sm text-gray-400 px-3 py-2">No options</p>
          ) : (
            normOptions.map((opt, idx) => {
              const isSelected = String(opt.value) === String(value);
              const isHighlighted = idx === highlight;
              return (
                <button
                  key={`${opt.value}-${idx}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={opt.disabled}
                  onMouseEnter={() => setHighlight(idx)}
                  onClick={() => pick(opt)}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 transition-colors ${
                    opt.disabled
                      ? 'text-gray-300 cursor-not-allowed'
                      : isHighlighted
                        ? 'bg-indigo-50 text-indigo-700'
                        : isSelected
                          ? 'text-indigo-700 font-medium'
                          : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <span className="truncate">{opt.label}</span>
                  {isSelected && <Check className="w-4 h-4 text-indigo-600 flex-shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
