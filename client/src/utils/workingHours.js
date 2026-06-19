// Working-hours model shared by Settings (editor) and the Classes Timetable
// (grid bounds + shading).
//
// Stored in AppSettings under `schedule.working_hours` as a JSON string: an
// array of 7 entries, index 0 = Sunday … 6 = Saturday (matching the app's
// day_of_week convention). Each entry:
//   { open: boolean, start: "HH:MM", end: "HH:MM" }
//
// Empty/invalid → DEFAULT_WORKING_HOURS (every day open 08:00–20:00), which
// matches the timetable's historical default range so nothing changes until a
// teacher customises it.

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_ABBR  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

export const DEFAULT_WORKING_HOURS = Array.from({ length: 7 }, () => ({
  open: true,
  start: '08:00',
  end: '20:00',
}));

function normalizeDay(d) {
  if (!d || typeof d !== 'object') return { open: false, start: '08:00', end: '20:00' };
  const t = (v, fb) => (typeof v === 'string' && HHMM.test(v) ? padTime(v) : fb);
  const start = t(d.start, '08:00');
  let end = t(d.end, '20:00');
  // Guard against end <= start (would invert the window) — fall back to a sane
  // 1-hour-after-start so the editor/grid never produce negative bands.
  if (toMin(end) <= toMin(start)) end = start;
  return { open: !!d.open, start, end };
}

// "8:00" → "08:00" so <input type="time"> and string compares behave.
function padTime(v) {
  const [h, m] = v.split(':');
  return `${String(Number(h)).padStart(2, '0')}:${m}`;
}

function toMin(t) {
  const [h, m] = String(t || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Accepts a JSON string, an already-parsed array, or nullish. Always returns a
// fresh array of exactly 7 normalized day objects.
export function parseWorkingHours(raw) {
  let arr = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return DEFAULT_WORKING_HOURS.map((d) => ({ ...d }));
    try { arr = JSON.parse(trimmed); } catch { arr = null; }
  }
  if (!Array.isArray(arr) || arr.length !== 7) {
    return DEFAULT_WORKING_HOURS.map((d) => ({ ...d }));
  }
  return arr.map(normalizeDay);
}

// Normalize then stringify for persistence.
export function serializeWorkingHours(arr) {
  return JSON.stringify(parseWorkingHours(arr));
}
