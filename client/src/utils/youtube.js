// Extract a YouTube video ID from any common URL format:
//   https://www.youtube.com/watch?v=ABCDEFG1234
//   https://youtu.be/ABCDEFG1234
//   https://www.youtube.com/embed/ABCDEFG1234
//   https://www.youtube.com/shorts/ABCDEFG1234
// Returns null if not a recognizable YouTube URL.

export function extractYouTubeId(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  // youtu.be short link
  let m = trimmed.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  // youtube.com/watch?v=
  m = trimmed.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  // youtube.com/embed/  or  /shorts/
  m = trimmed.match(/youtube\.com\/(?:embed|shorts|v)\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  // 11-char raw id by itself
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  return null;
}

// Thumbnail URL for a YouTube video. quality: default | mqdefault | hqdefault | sddefault | maxresdefault
export function ytThumbnail(videoId, quality = 'mqdefault') {
  if (!videoId) return null;
  return `https://i.ytimg.com/vi/${videoId}/${quality}.jpg`;
}

// Parse YouTube-style chapter timestamps from a lesson description.
// Recognizes lines like:
//   "0:00 Introduction"
//   "02:30 - Vocal warm-up"
//   "1:05:20 — Practice section"
//   "[0:00] Intro" (brackets/parens allowed)
// Lines without a leading timestamp are ignored.
// Returns: [{ start: seconds, title }], sorted by start time.
export function parseChapters(description) {
  if (!description || typeof description !== 'string') return [];
  const chapters = [];
  const lines = description.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    // Strip optional brackets/parens around the timestamp
    const cleaned = line.replace(/^[\[\(]\s*/, '').replace(/\s*[\]\)]/, '');
    // Optional hours, mandatory minutes:seconds, optional separator (- — :), title
    const m = cleaned.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})\s*[-—:|·\s]\s*(.+?)\s*$/);
    if (!m) continue;
    const h = m[1] ? parseInt(m[1], 10) : 0;
    const min = parseInt(m[2], 10);
    const sec = parseInt(m[3], 10);
    if (sec >= 60 || min >= 60) continue;
    const start = h * 3600 + min * 60 + sec;
    const title = m[4].trim();
    if (!title) continue;
    chapters.push({ start, title });
  }
  chapters.sort((a, b) => a.start - b.start);
  // Dedupe by start time (keep first)
  const seen = new Set();
  return chapters.filter((c) => {
    if (seen.has(c.start)) return false;
    seen.add(c.start);
    return true;
  });
}

// Find which chapter contains a given playback time.
// Returns the index, or -1 if no chapter applies.
export function currentChapterIndex(chapters, timeSeconds) {
  if (!Array.isArray(chapters) || chapters.length === 0) return -1;
  let idx = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].start <= timeSeconds) idx = i;
    else break;
  }
  return idx;
}

// Format seconds as "m:ss" or "h:mm:ss"
export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
