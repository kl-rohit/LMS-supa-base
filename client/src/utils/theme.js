// Appearance theming — accent colour + light/dark mode.
//
// How it works: tailwind.config.js maps the indigo / gray palettes to CSS
// variables holding SPACE-SEPARATED RGB channels (e.g. --c-indigo-600: 79 70 229),
// wrapped as rgb(var(...) / <alpha-value>) so opacity modifiers still work. So:
//   - accent: we set --c-indigo-* inline on <html> to a ramp generated from the
//     chosen colour. 'default' clears them → app reverts to stock indigo.
//   - mode: we toggle the `.dark` class on <html>; index.css remaps the gray
//     vars to a dark palette and darkens white surfaces under .dark.
//
// Preference is stored per-device in localStorage (applied at boot, before
// React renders, so there's no flash) and also round-tripped to the backend
// AppSettings so it follows the academy when Settings is opened elsewhere.

const STORAGE_KEY = 'veena.theme';
const INDIGO_SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

// Preset accent colours. `base` is treated as the 500 weight; the rest of the
// ramp is generated. 'default' is special — it clears the vars so the app uses
// stock Tailwind indigo (pixel-identical to the original look).
export const PRESETS = [
  { id: 'default', label: 'Indigo',  swatch: '#4f46e5', base: null },
  { id: 'violet',  label: 'Violet',  swatch: '#8b5cf6', base: '#8b5cf6' },
  { id: 'sky',     label: 'Sky',     swatch: '#0ea5e9', base: '#0ea5e9' },
  { id: 'emerald', label: 'Emerald', swatch: '#10b981', base: '#10b981' },
  { id: 'teal',    label: 'Teal',    swatch: '#14b8a6', base: '#14b8a6' },
  { id: 'rose',    label: 'Rose',    swatch: '#f43f5e', base: '#f43f5e' },
  { id: 'amber',   label: 'Amber',   swatch: '#f59e0b', base: '#f59e0b' },
  { id: 'slate',   label: 'Slate',   swatch: '#64748b', base: '#64748b' },
];

function clamp(n) { return Math.max(0, Math.min(255, Math.round(n))); }

function parseHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function toHex({ r, g, b }) {
  return '#' + [r, g, b].map((c) => clamp(c).toString(16).padStart(2, '0')).join('');
}

// Space-separated RGB channels for the `rgb(var(--c-x) / <alpha-value>)` form.
function toRgbTriplet({ r, g, b }) {
  return `${clamp(r)} ${clamp(g)} ${clamp(b)}`;
}

// Linear blend of `c` toward `target` by `amt` (0..1).
function mix(c, target, amt) {
  return {
    r: c.r + (target.r - c.r) * amt,
    g: c.g + (target.g - c.g) * amt,
    b: c.b + (target.b - c.b) * amt,
  };
}

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

// Blend ratios per weight (mapped at 500); negative = toward black.
const RAMP_STEPS = {
  50: 0.92, 100: 0.84, 200: 0.68, 300: 0.48, 400: 0.24,
  500: 0, 600: -0.16, 700: -0.32, 800: -0.46, 900: -0.58,
};

// Build a 50..900 ramp of RGB triplets from a single base colour (mapped at
// 500). Lighter weights blend toward white, darker toward black. Approximate,
// but produces a coherent, readable accent across buttons / links / active
// states / tints. Returns { 50: "r g b", ... } or null for a bad hex.
export function rampFromBase(hex) {
  const base = parseHex(hex);
  if (!base) return null;
  const out = {};
  for (const [weight, amt] of Object.entries(RAMP_STEPS)) {
    const c = amt === 0 ? base : mix(base, amt > 0 ? WHITE : BLACK, Math.abs(amt));
    out[weight] = toRgbTriplet(c);
  }
  return out;
}

// Resolve a stored accent value ('default' | preset id | '#hex') to a ramp or
// null (meaning: use stock indigo).
function resolveAccentRamp(accent) {
  if (!accent || accent === 'default') return null;
  const preset = PRESETS.find((p) => p.id === accent);
  if (preset) return preset.base ? rampFromBase(preset.base) : null;
  return rampFromBase(accent); // custom hex
}

function applyAccent(accent) {
  const root = document.documentElement;
  const ramp = resolveAccentRamp(accent);
  if (!ramp) {
    INDIGO_SHADES.forEach((s) => root.style.removeProperty(`--c-indigo-${s}`));
    return;
  }
  INDIGO_SHADES.forEach((s) => root.style.setProperty(`--c-indigo-${s}`, ramp[s]));
}

function applyMode(mode) {
  document.documentElement.classList.toggle('dark', mode === 'dark');
}

function tripletToHex(triplet) {
  const [r, g, b] = String(triplet).trim().split(/\s+/).map(Number);
  return toHex({ r, g, b });
}

// Keep the PWA / browser-chrome colour in step with the theme.
function applyMetaThemeColor(accent, mode) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  if (mode === 'dark') { meta.setAttribute('content', '#1e2126'); return; }
  const ramp = resolveAccentRamp(accent);
  meta.setAttribute('content', ramp ? tripletToHex(ramp[600]) : '#4f46e5');
}

export function applyTheme({ accent, mode }) {
  applyAccent(accent);
  applyMode(mode);
  applyMetaThemeColor(accent, mode);
}

export function loadTheme() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        accent: parsed.accent || 'default',
        mode: parsed.mode === 'dark' ? 'dark' : 'light',
      };
    }
  } catch (_e) { /* ignore */ }
  return { accent: 'default', mode: 'light' };
}

export function saveTheme(theme) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(theme)); } catch (_e) { /* ignore */ }
}

// Apply the persisted theme. Call once at boot (index.js) before React renders.
export function bootTheme() {
  applyTheme(loadTheme());
}
