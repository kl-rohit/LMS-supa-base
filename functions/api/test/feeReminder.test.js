// Unit tests for the fee-reminder template helpers.
// Runs with zero dependencies:  npm test   (node --test)
//
// These guard the "₹3.245678944343434e+23" class of bug — a large or fractional
// fee amount must render as grouped digits in a parent-facing message, never as
// JavaScript scientific notation, and non-money tokens (year, name) must be left
// exactly as typed.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { substituteTemplate, formatMoney, applyFeeReminderConditionalBlock } = require('../lib/feeReminder');

test('formatMoney groups with Indian digits and no scientific notation', () => {
  assert.equal(formatMoney(0), '0');
  assert.equal(formatMoney(1250), '1,250');
  assert.equal(formatMoney(100000), '1,00,000');
  assert.equal(formatMoney(2500.5), '2,500.5');
  // The exact value from the bug report must not contain an exponent.
  const huge = formatMoney(3.245678944343434e23);
  assert.ok(!/e\+?\d+/i.test(huge), `still scientific: ${huge}`);
  assert.ok(huge.includes(','), 'expected grouped digits');
});

test('formatMoney passes non-numeric values through untouched', () => {
  assert.equal(formatMoney('n/a'), 'n/a');
});

test('substituteTemplate formats money placeholders, not scientific notation', () => {
  const tpl = 'Fees for {name} — {month} {year}: ₹{amount}\n  • Class fees: ₹{class_fees}\n  • Additional: ₹{additional_fees}';
  const out = substituteTemplate(tpl, {
    name: '343', month: 'July', year: 2026,
    amount: 3.245678944343434e23, class_fees: 0, additional_fees: 3.245678944343434e23,
  });
  assert.ok(!/e\+?\d+/i.test(out), `message leaked scientific notation:\n${out}`);
  assert.match(out, /Fees for 343 — July 2026:/); // name/month untouched
});

test('substituteTemplate leaves the year unformatted (not "2,026")', () => {
  const out = substituteTemplate('Year {year}', { year: 2026 });
  assert.equal(out, 'Year 2026');
});

test('substituteTemplate keeps unknown placeholders literal', () => {
  assert.equal(substituteTemplate('Hi {parent}', {}), 'Hi {parent}');
});

test('applyFeeReminderConditionalBlock drops the bullet lines when no additional fee', () => {
  const text = 'Total: ₹100\n  • Class fees: ₹100\n  • Additional: ₹0\nThanks';
  const out = applyFeeReminderConditionalBlock(text, 0);
  assert.ok(!out.includes('• Class fees'));
  assert.ok(!out.includes('• Additional'));
  // A non-zero additional fee keeps the breakdown.
  assert.ok(applyFeeReminderConditionalBlock(text, 250).includes('• Additional'));
});
