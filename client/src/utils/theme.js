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

// Preset accent themes. `base` (the theme's Primary) is treated as the 500
// weight; the rest of the ramp is generated and recolours the whole app.
//
// Each theme also carries `secondary` + `accent` + `darkBg` from the brand
// spec. Today only `base` (Primary) is wired into the UI — it drives buttons,
// links, the active sidebar item, and the browser/PWA theme colour. The gold
// `secondary` and `accent` are stored for the richer multi-token pass (badges,
// secondary buttons, highlights) and are shown in the picker swatch so each
// theme reads as a distinct brand.
//
// 'default' is special — `base: null` clears the vars so the app uses stock
// Tailwind indigo (pixel-identical to the original look).
export const PRESETS = [
  // — VidyaSetu's recommended top 5 (Hamsa is the brand default) —
  { id: 'hamsa',   label: 'Hamsa',   emoji: '🦢', base: '#1E3A8A', secondary: '#D4A017', accent: '#F59E0B', darkBg: '#0F172A', desc: 'Premium classical · Blue + Gold' },
  { id: 'banyan',  label: 'Banyan',  emoji: '🌳', base: '#2E7D32', secondary: '#D4A017', accent: '#84CC16', darkBg: '#102A13', desc: 'Growth & knowledge · Green + Gold' },
  { id: 'lotus',   label: 'Lotus',   emoji: '🪷', base: '#BE185D', secondary: '#D4A017', accent: '#F9A8D4', darkBg: '#4A044E', desc: 'Arts & dance · Pink + Gold' },
  { id: 'deepam',  label: 'Deepam',  emoji: '🪔', base: '#8B4513', secondary: '#F59E0B', accent: '#DC2626', darkBg: '#3B1F0F', desc: 'Traditional & spiritual · Brown + Gold' },
  { id: 'mayura',  label: 'Mayura',  emoji: '🦚', base: '#0F766E', secondary: '#D4A017', accent: '#06B6D4', darkBg: '#042F2E', desc: 'Peacock · Teal + Gold' },
  // — the rest —
  { id: 'modern',   label: 'Modern',   emoji: '📚', base: '#2563EB', secondary: '#0EA5E9', accent: '#F97316', darkBg: '#111827', desc: 'Coaching & tuition · Blue + Sky' },
  { id: 'veena',    label: 'Veena',    emoji: '🎻', base: '#6B21A8', secondary: '#D4A017', accent: '#C084FC', darkBg: '#2E1065', desc: 'Music academies · Purple + Gold' },
  { id: 'surya',    label: 'Surya',    emoji: '☀️', base: '#EA580C', secondary: '#D4A017', accent: '#FACC15', darkBg: '#7C2D12', desc: 'Energy & excellence · Orange + Gold' },
  { id: 'gurukul',  label: 'Gurukul',  emoji: '🕉️', base: '#7C2D12', secondary: '#D4A017', accent: '#FB923C', darkBg: '#431407', desc: 'Ancient knowledge · Maroon + Gold' },
  { id: 'sanskrit', label: 'Sanskrit', emoji: '📜', base: '#92400E', secondary: '#FBBF24', accent: '#F59E0B', darkBg: '#422006', desc: 'Manuscript inspired · Amber' },
  // — classic stock look —
  { id: 'default',  label: 'Classic',  emoji: '🎨', base: null,      secondary: '#818cf8', accent: '#6366f1', darkBg: '#1e2126', desc: 'Stock indigo (original)' },
];

// Convenience: the Primary swatch for a preset (falls back to indigo for stock).
export function presetSwatch(p) { return p.base || '#4f46e5'; }

// Resolve a stored accent value ('default' | preset id | '#rrggbb') to a single
// brand hex. 'default' (and anything unrecognised) maps to stock indigo #4f46e5.
// Used outside the live theme — e.g. the certificate PDF border + title colour.
export function accentToHex(accent) {
  if (!accent || accent === 'default') return '#4f46e5';
  const preset = PRESETS.find((p) => p.id === accent);
  if (preset) return preset.base || '#4f46e5';
  return parseHex(accent) ? (accent.startsWith('#') ? accent : `#${accent}`) : '#4f46e5';
}

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

// Valid stored modes. 'system' follows the OS light/dark preference live.
export const MODES = ['light', 'dark', 'system'];

function systemPrefersDark() {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch (_e) { return false; }
}

// Resolve a stored mode ('light' | 'dark' | 'system') to the mode we actually
// paint. 'system' (the default) reads the OS preference at call time.
export function resolveMode(mode) {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return systemPrefersDark() ? 'dark' : 'light';
}

function applyMode(mode) {
  document.documentElement.classList.toggle('dark', resolveMode(mode) === 'dark');
}

function tripletToHex(triplet) {
  const [r, g, b] = String(triplet).trim().split(/\s+/).map(Number);
  return toHex({ r, g, b });
}

// Keep the PWA / browser-chrome colour in step with the theme.
function applyMetaThemeColor(accent, mode) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  if (resolveMode(mode) === 'dark') { meta.setAttribute('content', '#1e2126'); return; }
  const ramp = resolveAccentRamp(accent);
  meta.setAttribute('content', ramp ? tripletToHex(ramp[600]) : '#4f46e5');
}

// The theme we last applied — used by the OS-preference listener to re-resolve
// 'system' mode without the caller having to re-supply it.
let current = { accent: 'default', mode: 'system' };

export function applyTheme({ accent, mode }) {
  current = { accent, mode };
  applyAccent(accent);
  applyMode(mode);
  applyMetaThemeColor(accent, mode);
}

// When the mode is 'system', repaint the moment the OS flips light/dark. Wired
// once (idempotent) from bootTheme so it covers the whole app lifetime.
let systemWatchAttached = false;
function watchSystemPreference() {
  if (systemWatchAttached) return;
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { if (current.mode === 'system' || !MODES.includes(current.mode)) applyTheme(current); };
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else if (mq.addListener) mq.addListener(handler); // older Safari
    systemWatchAttached = true;
  } catch (_e) { /* matchMedia unavailable — static resolve is fine */ }
}

export function loadTheme() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        accent: parsed.accent || 'default',
        mode: MODES.includes(parsed.mode) ? parsed.mode : 'system',
      };
    }
  } catch (_e) { /* ignore */ }
  // No stored preference → follow the OS by default.
  return { accent: 'default', mode: 'system' };
}

export function saveTheme(theme) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(theme)); } catch (_e) { /* ignore */ }
}

// Apply the persisted theme. Call once at boot (index.js) before React renders.
export function bootTheme() {
  applyTheme(loadTheme());
  watchSystemPreference();
}

// The parent portal always follows the OS light/dark preference, regardless of
// any admin device preference stored on this browser. Accent is left untouched
// (whatever is already applied). Returns a restore fn so the caller can put the
// device preference back when leaving the portal (shared-device safety).
export function applyPortalMode() {
  const restore = { ...current };
  current = { ...current, mode: 'system' };
  applyMode('system');
  applyMetaThemeColor(current.accent, 'system');
  watchSystemPreference();
  return () => applyTheme(restore);
}
