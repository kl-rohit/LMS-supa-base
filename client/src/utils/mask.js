// Helpers to render masked / hidden versions of sensitive values.

// Mask a phone number, keeping only the last 4 digits visible.
// "9876543210" → "•••••• 3210"
// Returns '' for empty input.
export function maskPhone(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 0) return '••••';
  if (digits.length <= 4) return '•'.repeat(digits.length);
  const last4 = digits.slice(-4);
  return `${'•'.repeat(digits.length - 4)} ${last4}`;
}

// Mask an email — keep first + last letter of local part, full domain.
// "rohitkl@gmail.com" → "r•••l@gmail.com"
export function maskEmail(raw) {
  if (!raw) return '';
  const s = String(raw);
  const at = s.indexOf('@');
  if (at < 0) return '•'.repeat(Math.max(4, s.length));
  const user = s.slice(0, at);
  const domain = s.slice(at);
  if (user.length <= 1) return `•${domain}`;
  if (user.length === 2) return `${user[0]}•${domain}`;
  return `${user[0]}${'•'.repeat(Math.max(3, user.length - 2))}${user[user.length - 1]}${domain}`;
}

// Mask any amount/number with a fixed-width row of dots.
// Currency symbols are kept so the layout doesn't shift.
export function maskAmount() {
  return '••••';
}
