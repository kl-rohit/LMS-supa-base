// Photo-URL cache backed by localStorage.
//
// Why: every /students page load runs POST /students/photo-urls to sign all
// avatar URLs. Signed URLs expire after 1 hour. We cache them by student id
// with a TTL slightly shorter than that (50 min) so a navigation back to
// the Students page within the hour skips the round-trip entirely.
//
// Schema: localStorage['veena_photo_url_cache'] = {
//   '<student-id>': { url: '...', exp: <unix-ms> },
// }
// Bad/expired/missing entries are silently ignored — worst case is one extra
// signing round-trip. We never crash on malformed cache data.

const KEY = 'veena_photo_url_cache';
const TTL_MS = 50 * 60 * 1000; // 50 minutes (signed URLs live 60 min)

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch {
    return {};
  }
}

function save(obj) {
  try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch {}
}

// Returns { fresh: { id: url }, stale: [id, ...] } — fresh hits come straight
// from cache, stale ids need a server sign.
export function readPhotoCache(ids) {
  const now = Date.now();
  const cache = load();
  const fresh = {};
  const stale = [];
  for (const id of ids.map(String)) {
    const entry = cache[id];
    if (entry && entry.exp > now && typeof entry.url === 'string' && entry.url) {
      fresh[id] = entry.url;
    } else {
      stale.push(id);
    }
  }
  return { fresh, stale };
}

// Merge new id→url pairs into the cache with a fresh TTL.
export function writePhotoCache(urls) {
  if (!urls || typeof urls !== 'object') return;
  const cache = load();
  const exp = Date.now() + TTL_MS;
  for (const [id, url] of Object.entries(urls)) {
    if (url) cache[String(id)] = { url, exp };
  }
  save(cache);
}

// Drop one student's cache entry — call after a fresh upload so the next
// page load fetches the new signed URL instead of serving the stale one
// (the underlying object key is stable but Stratus invalidates the old
// signature when the object is overwritten).
export function invalidatePhotoCache(id) {
  if (!id) return;
  const cache = load();
  delete cache[String(id)];
  save(cache);
}

export function clearPhotoCache() {
  try { localStorage.removeItem(KEY); } catch {}
}
