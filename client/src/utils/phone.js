// Normalize a stored mobile number for WhatsApp deep-links.
// Veena's existing dataset has mixed formats:
//   "8939612739"     → 10 digits, no country code  → prepend 91
//   "919500006881"   → 12 digits, already prefixed → use as-is
//   "+91 98765 43210" → has spaces/+              → strip non-digits, then check
//   "Gurubaran"       → junk                       → returns null (not messageable)
//   "-"               → placeholder                → returns null
//
// Returns a digits-only E.164-ish string (no +) ready to drop into
// `https://wa.me/<digits>` — or null if the input can't be made into a
// plausible phone number.
export function normalizeMobileForWhatsApp(raw, defaultCountryCode = '91') {
  if (!raw) return null;
  // Strip everything that isn't a digit.
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 10) return null; // not a usable number
  // 10 digits → assume Indian mobile, prepend 91
  if (digits.length === 10) return defaultCountryCode + digits;
  // 11–15 digits with leading country code already present
  return digits;
}

// Pretty display for the UI: "+91 98765 43210" style.
export function formatMobileDisplay(raw) {
  const normalized = normalizeMobileForWhatsApp(raw);
  if (!normalized) return raw || '';
  // Split into +<cc> <first half> <second half> when 12 digits (10-digit + 91)
  if (normalized.length === 12 && normalized.startsWith('91')) {
    return `+91 ${normalized.slice(2, 7)} ${normalized.slice(7)}`;
  }
  return `+${normalized}`;
}
