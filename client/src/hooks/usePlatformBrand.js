// Live platform brand (name / logo / tagline / support), read from the public
// /api/branding endpoint. Fetched once and cached module-wide, so login, the
// app, and any consumer share one request. Falls back to sensible defaults.
import { useState, useEffect } from 'react';
import api from '../utils/api';

const DEFAULTS = {
  brand_name: 'VidyaSetu',
  tagline: 'Bridging teachers and learners',
  logo_url: '',
  support_email: '',
  support_phone_tel: '',
  support_phone_display: '',
  offer_name: '',
};

let _cache = null;
let _inflight = null;

export function usePlatformBrand() {
  const [brand, setBrand] = useState(_cache || DEFAULTS);

  useEffect(() => {
    if (_cache) { setBrand(_cache); return; }
    if (!_inflight) {
      _inflight = api.get('/branding')
        .then((d) => { _cache = { ...DEFAULTS, ...(d || {}) }; try { document.title = _cache.brand_name; } catch {} return _cache; })
        .catch(() => { _cache = DEFAULTS; return _cache; });
    }
    let alive = true;
    _inflight.then((d) => { if (alive) setBrand(d); });
    return () => { alive = false; };
  }, []);

  return brand;
}
