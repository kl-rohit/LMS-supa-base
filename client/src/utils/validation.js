// Shared form validation for the admin app.
//
// Two pieces:
//   • V.*  — small validator factories. Each returns a function (value, allValues)
//            that gives back a human-readable message string when the value is
//            wrong, or null when it is fine.
//   • validate(values, rules) — runs a { field: validator | validator[] } map
//            and returns an { field: message } object of the FIRST failure per
//            field (empty object means the form is clean).
//
// Messages are phrased to be clear and gentle ("That email address doesn't look
// right", "Description is too long"), never harsh. Keep new messages in the same
// voice.
//
// Usage in a page:
//   import { V, validate, firstErrorField, focusField } from '../utils/validation';
//   const errs = validate(form, {
//     name: V.name('Student name'),
//     email: V.email(),
//     mobile_number: V.phone10({ required: true }),
//     fee_online: V.nonNegative('Online fee'),
//     notes: V.maxLen('Notes', 500),
//   });
//   if (Object.keys(errs).length) { setErrors(errs); focusField(firstErrorField(errs)); return; }
//
// In JSX, mark the input and show the message:
//   <input className={fieldCls('input-field', errors.name)} data-field="name" ... />
//   <FieldError msg={errors.name} />
// and clear a field's error as the user edits it (see clearError below).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Letters (any script), spaces, and a few name punctuation marks. Must start
// with a letter so "123" / "@#" are rejected.
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}\s.'\-]*$/u;

function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

function digitsOnly(v) {
  return String(v == null ? '' : v).replace(/\D/g, '');
}

// Normalize an Indian mobile: strip a leading 91 country code if the result is
// 12 digits, so "+91 98765 43210" and "9876543210" compare equal.
export function normalizeMobile(v) {
  const d = digitsOnly(v);
  return d.startsWith('91') && d.length === 12 ? d.slice(2) : d;
}

export const V = {
  // Generic "must not be empty".
  required: (label = 'This field') => (v) =>
    isBlank(v) ? `${label} is required` : null,

  // A person / thing name. required by default; pass { required:false } to allow blank.
  name: (label = 'Name', opts = {}) => (v) => {
    const req = opts.required !== false;
    if (isBlank(v)) return req ? `${label} is required` : null;
    const s = String(v).trim();
    if (s.length < 2) return `${label} looks too short`;
    if (s.length > (opts.max || 80)) return `${label} is too long`;
    if (!NAME_RE.test(s)) return `That ${label.toLowerCase()} doesn't look right`;
    return null;
  },

  // Free text with a length cap. Blank allowed unless { required:true }.
  text: (label = 'This field', opts = {}) => (v) => {
    if (isBlank(v)) return opts.required ? `${label} is required` : null;
    const s = String(v);
    if (opts.min && s.trim().length < opts.min) return `${label} looks too short`;
    if (opts.max && s.length > opts.max) return `${label} is too long (max ${opts.max} characters)`;
    return null;
  },

  // Length-capped description. Blank allowed unless { required:true }.
  maxLen: (label = 'This field', max = 500, opts = {}) => (v) => {
    if (isBlank(v)) return opts.required ? `${label} is required` : null;
    return String(v).length > max ? `${label} is too long (max ${max} characters)` : null;
  },

  email: (opts = {}) => (v) => {
    if (isBlank(v)) return opts.required ? 'Email is required' : null;
    return EMAIL_RE.test(String(v).trim()) ? null : "That email address doesn't look right";
  },

  // 10-digit Indian mobile (optionally with a +91 prefix). Blank allowed unless
  // { required:true }.
  phone10: (opts = {}) => (v) => {
    if (isBlank(v)) return opts.required ? 'Mobile number is required' : null;
    const bare = normalizeMobile(v);
    if (bare.length !== 10) return 'Enter a 10-digit mobile number';
    if (!/^[6-9]/.test(bare)) return "That mobile number doesn't look right";
    return null;
  },

  // Numbers. All allow blank unless { required:true }.
  nonNegative: (label = 'This value', opts = {}) => (v) => {
    if (isBlank(v)) return opts.required ? `${label} is required` : null;
    const n = Number(v);
    if (!Number.isFinite(n)) return `${label} should be a number`;
    if (n < 0) return `${label} should be 0 or more`;
    return null;
  },

  positive: (label = 'This value', opts = {}) => (v) => {
    if (isBlank(v)) return opts.required ? `${label} is required` : null;
    const n = Number(v);
    if (!Number.isFinite(n)) return `${label} should be a number`;
    if (n <= 0) return `${label} should be more than 0`;
    return null;
  },

  intInRange: (label = 'This value', min = 0, max = Infinity, opts = {}) => (v) => {
    if (isBlank(v)) return opts.required ? `${label} is required` : null;
    const n = Number(v);
    if (!Number.isInteger(n)) return `${label} should be a whole number`;
    if (n < min) return `${label} should be ${min} or more`;
    if (n > max) return `${label} should be ${max} or less`;
    return null;
  },

  // http(s) URL. Blank allowed unless { required:true }.
  url: (opts = {}) => (v) => {
    if (isBlank(v)) return opts.required ? 'Link is required' : null;
    const s = String(v).trim();
    try {
      const u = new URL(s);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return "That link doesn't look right";
      return null;
    } catch {
      return "That link doesn't look right";
    }
  },

  // A date string (yyyy-mm-dd). Optionally reject future dates.
  date: (label = 'Date', opts = {}) => (v) => {
    if (isBlank(v)) return opts.required ? `${label} is required` : null;
    const t = Date.parse(v);
    if (Number.isNaN(t)) return `That ${label.toLowerCase()} doesn't look right`;
    if (opts.noFuture && t > Date.now()) return `${label} can't be in the future`;
    return null;
  },
};

// Run a rules map against values. rules[field] is a validator or an array of
// validators (checked in order; first failure wins). Returns { field: message }.
export function validate(values, rules) {
  const errors = {};
  for (const field of Object.keys(rules)) {
    const list = Array.isArray(rules[field]) ? rules[field] : [rules[field]];
    for (const fn of list) {
      if (typeof fn !== 'function') continue;
      const msg = fn(values ? values[field] : undefined, values);
      if (msg) { errors[field] = msg; break; }
    }
  }
  return errors;
}

// The first field (in the order the rules object was written) that has an error.
export function firstErrorField(errors) {
  const keys = Object.keys(errors || {});
  return keys.length ? keys[0] : null;
}

// Move focus (and scroll) to an input marked with data-field="<field>". Safe to
// call with null. Deferred a tick so it runs after React commits the error UI.
export function focusField(field, root) {
  if (!field) return;
  setTimeout(() => {
    const scope = root || document;
    const el = scope.querySelector('[data-field="' + field + '"]');
    if (el && typeof el.focus === 'function') {
      try { el.focus({ preventScroll: false }); } catch { el.focus(); }
      if (typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }, 0);
}

// className helper: append the error style to a base class when the field errs.
export function fieldCls(base, err) {
  return err ? base + ' input-error' : base;
}

// Immutably drop one field's error (call from an input's onChange so the red
// state clears as the user fixes it).
export function clearError(errors, field) {
  if (!errors || !errors[field]) return errors;
  const next = { ...errors };
  delete next[field];
  return next;
}
