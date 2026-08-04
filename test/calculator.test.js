// Drives the real index.html + script.js through jsdom, clicking the actual
// calculator buttons (by their data-action/data-digit/data-operator
// attributes, exactly as index.html defines them) rather than calling
// formatNumber() in isolation. This is what actually exercises the click
// handlers wired up in script.js, so a regression there (e.g. AID-18) would
// make these tests fail the same way a real user click would.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const indexPath = path.join(__dirname, '..', 'index.html');
const indexUrl = `file://${indexPath.replace(/\\/g, '/')}`;

// Builds a fresh calculator DOM for each test so state never leaks between
// them, then waits for script.js (loaded with `defer`, per index.html) to
// have attached its listeners and run its initial updateDisplay(). The window
// is closed when the test ends so its timers and listeners do not outlive it.
async function loadCalculator(t) {
  const dom = new JSDOM(fs.readFileSync(indexPath, 'utf8'), {
    url: indexUrl,
    runScripts: 'dangerously',
    resources: 'usable',
  });
  t.after(() => dom.window.close());

  await new Promise((resolve, reject) => {
    dom.window.addEventListener('load', resolve);
    dom.window.addEventListener('error', (event) => reject(event.error || event.message));
  });

  return dom;
}

function click(dom, selector) {
  const button = dom.window.document.querySelector(selector);
  assert.ok(button, `button not found for selector: ${selector}`);
  button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

function clickDigits(dom, digits) {
  for (const digit of digits) {
    click(dom, `button[data-action="digit"][data-digit="${digit}"]`);
  }
}

function displayText(dom) {
  return dom.window.document.getElementById('calculator-display').textContent;
}

// Mirrors script.js's countDigits() (AID-22): the whole leading run of
// zeros -- the placeholder integer "0", the decimal point, and any zeros
// immediately after it -- is stripped before counting, since none of it
// carries double-precision significance; neither a sign nor a decimal point
// ever inflates the count either. The decimal point is optional in the match,
// so a bare "0" counts as 0 significant digits too. Used to assert the actual
// MAX_OPERAND_LENGTH invariant (significant digits), not the display
// string's raw length.
function digitCount(str) {
  return (str.replace(/^-?0*\.?0*/, '').match(/\d/g) || []).length;
}

test('4503599627370496 x 2 = displays 9007199254740992 (AID-18 repro 1)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '4503599627370496');
  click(dom, 'button[data-action="operator"][data-operator="*"]');
  clickDigits(dom, '2');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '9007199254740992');
});

test('9007199254740995 + 0 = displays 9007199254740996 (AID-18 repro 2)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '9007199254740995');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  clickDigits(dom, '0');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '9007199254740996');
});

test('9007199254740991 round-trips unchanged (old MAX_SAFE_INTEGER boundary)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '9007199254740991');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  clickDigits(dom, '0');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '9007199254740991');
});

test('0.1 + 0.2 = displays 0.3 (float noise cleanup preserved)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '0');
  click(dom, 'button[data-action="decimal"]');
  clickDigits(dom, '1');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  clickDigits(dom, '0');
  click(dom, 'button[data-action="decimal"]');
  clickDigits(dom, '2');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '0.3');
});

test('1 / 3 = displays 0.333333333333333 (float noise cleanup preserved)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '1');
  click(dom, 'button[data-action="operator"][data-operator="/"]');
  clickDigits(dom, '3');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '0.333333333333333');
});

test('1 / 0 = displays Error (non-finite result)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '1');
  click(dom, 'button[data-action="operator"][data-operator="/"]');
  clickDigits(dom, '0');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), 'Error');
});

test('0 x -5 = displays 0 (negative zero normalises to 0)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '0');
  click(dom, 'button[data-action="operator"][data-operator="*"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="negate"]');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '0');
});

test('2 + 3 = displays 5 (ordinary small-number sanity check)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '2');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  clickDigits(dom, '3');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '5');
});

test('12 x 12 = displays 144 (ordinary small-number sanity check)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '12');
  click(dom, 'button[data-action="operator"][data-operator="*"]');
  clickDigits(dom, '12');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '144');
});

test('16 digits then negate displays -1234567890123456, still 16 digits (AID-19 repro)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '1234567890123456');
  click(dom, 'button[data-action="negate"]');
  const shown = displayText(dom);
  assert.equal(shown, '-1234567890123456');
  assert.equal(digitCount(shown), 16);
});

test('a 17th digit is still ignored after negating a 16-digit operand', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '1234567890123456');
  click(dom, 'button[data-action="negate"]');
  clickDigits(dom, '7');
  const shown = displayText(dom);
  assert.equal(shown, '-1234567890123456');
  assert.equal(digitCount(shown), 16);
});

test('negating early then typing still reaches a full 16-digit budget (-1111111111111111)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '1');
  click(dom, 'button[data-action="negate"]');
  clickDigits(dom, '111111111111111');
  const shown = displayText(dom);
  assert.equal(shown, '-1111111111111111');
  assert.equal(digitCount(shown), 16);
});

// The AID-16 (decimal point) and AID-19 (sign) cases meet here: neither the
// '.' nor the '-' nor the leading "0" placeholder is charged against the
// 16-digit budget, so this operand is at the cap with 19 characters shown.
test('a negated 0.x operand gets the full 16-digit budget and no more', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '0');
  click(dom, 'button[data-action="decimal"]');
  clickDigits(dom, '1234567890123456');
  click(dom, 'button[data-action="negate"]');
  let shown = displayText(dom);
  assert.equal(shown, '-0.1234567890123456');
  assert.equal(digitCount(shown), 16);

  clickDigits(dom, '7');
  shown = displayText(dom);
  assert.equal(shown, '-0.1234567890123456');
  assert.equal(digitCount(shown), 16);
});

test('negate twice returns the exact original 16-digit string', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '1234567890123456');
  click(dom, 'button[data-action="negate"]');
  click(dom, 'button[data-action="negate"]');
  assert.equal(displayText(dom), '1234567890123456');
});

test('5 + +/- 2 = displays 3, not -47 (AID-20 repro A)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  click(dom, 'button[data-action="negate"]');
  clickDigits(dom, '2');
  // Intermediate check from the issue: the digit must replace the
  // accumulator copy ("-2"), not append to it ("-52").
  assert.equal(displayText(dom), '-2');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '3');
});

test('5 + +/- Backspace displays 5 and cancels the pending operator (AID-20 repro B)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  click(dom, 'button[data-action="negate"]');
  click(dom, 'button[data-action="backspace"]');
  assert.equal(displayText(dom), '5');

  // The cancelled operator must not linger: a bare "=" (nothing pending) is
  // a no-op just like "5" Backspace "=" would be.
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '5');
});

test('8 - +/- 3 = displays 11 and 2 * +/- 3 = displays -6 (sign carries for every operator)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '8');
  click(dom, 'button[data-action="operator"][data-operator="-"]');
  click(dom, 'button[data-action="negate"]');
  clickDigits(dom, '3');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '11');

  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '2');
  click(dom, 'button[data-action="operator"][data-operator="*"]');
  click(dom, 'button[data-action="negate"]');
  clickDigits(dom, '3');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '-6');
});

test('5 + +/- +/- 2 = displays 7 (second +/- cancels the pending sign)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  click(dom, 'button[data-action="negate"]');
  click(dom, 'button[data-action="negate"]');
  clickDigits(dom, '2');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '7');
});

test('5 + +/- = still displays 0 (negated accumulator usable with no digit typed)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  click(dom, 'button[data-action="negate"]');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '0');
});

test('5 + +/- . 5 = displays 4.5 (a decimal after +/- follows the same sign-carrying rule)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  click(dom, 'button[data-action="negate"]');
  click(dom, 'button[data-action="decimal"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '4.5');
});

test('5 + +/- 0 . 5 = displays 4.5 (a leading "0" digit before "." still carries the pending sign)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  click(dom, 'button[data-action="negate"]');
  clickDigits(dom, '0');
  click(dom, 'button[data-action="decimal"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '4.5');
});

test('5 + +/- 0 +/- 2 = displays 7 (a pending sign survives a "0" digit and a later +/- can still cancel it)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  click(dom, 'button[data-action="negate"]');
  clickDigits(dom, '0');
  click(dom, 'button[data-action="negate"]');
  clickDigits(dom, '2');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '7');
});

test('5 + +/- . 0 0 displays -0.00, and +/- on it displays 0.00 (a "-0." sign can be undone)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  click(dom, 'button[data-action="negate"]');
  click(dom, 'button[data-action="decimal"]');
  clickDigits(dom, '00');
  assert.equal(displayText(dom), '-0.00');

  click(dom, 'button[data-action="negate"]');
  assert.equal(displayText(dom), '0.00');
});

test('5 + +/- 0 Backspace 2 = displays 7 (backspacing the "0" drops the pending sign)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  click(dom, 'button[data-action="negate"]');
  clickDigits(dom, '0');
  click(dom, 'button[data-action="backspace"]');
  clickDigits(dom, '2');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '7');
});

test('5 + +/- + 2 = displays 7, and 5 + +/- * 2 = displays 10 (an operator swap after +/- discards the pending sign)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  click(dom, 'button[data-action="negate"]');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  clickDigits(dom, '2');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '7');

  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  click(dom, 'button[data-action="negate"]');
  click(dom, 'button[data-action="operator"][data-operator="*"]');
  clickDigits(dom, '2');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '10');
});

test('5 + +/- - = displays 0, 5 + +/- + = displays 10, 5 + +/- * = displays 25 (AID-27 repro, operator swap with no digit typed)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  click(dom, 'button[data-action="negate"]');
  click(dom, 'button[data-action="operator"][data-operator="-"]');
  // The swap must discard the pending sign from the accumulator itself, not
  // just from the arithmetic: the display has to read "5", not "-5".
  assert.equal(displayText(dom), '5');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '0');

  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  click(dom, 'button[data-action="negate"]');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '10');

  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  click(dom, 'button[data-action="negate"]');
  click(dom, 'button[data-action="operator"][data-operator="*"]');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '25');
});

test('5 + +/- - 3 = still displays 2 (AID-27 control, a digit typed after the swap already masked this bug)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  click(dom, 'button[data-action="negate"]');
  click(dom, 'button[data-action="operator"][data-operator="-"]');
  clickDigits(dom, '3');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '2');
});

test('1.234567890123456 * still displays 1.234567890123456 (AID-27 regression, an operator press must not reformat a typed operand)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '1');
  click(dom, 'button[data-action="decimal"]');
  clickDigits(dom, '234567890123456');
  click(dom, 'button[data-action="operator"][data-operator="*"]');
  assert.equal(displayText(dom), '1.234567890123456');
});

test('999999999999999.5 * = displays 999999999999999000000000000000 (AID-27 regression, the typed operand is not rounded before the operator swap path runs)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '999999999999999');
  click(dom, 'button[data-action="decimal"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="operator"][data-operator="*"]');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '999999999999999000000000000000');
});

test('0 + +/- * = does not display Error (AID-27, the sign-strip guard on a bare "0" accumulator)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '0');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  click(dom, 'button[data-action="negate"]');
  click(dom, 'button[data-action="operator"][data-operator="*"]');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '0');
});

test('1 - 5 - +/- * displays -4, and = displays 16 (AID-27, the sign undo is a toggle, not a one-way strip, on a negative accumulator)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '1');
  click(dom, 'button[data-action="operator"][data-operator="-"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="operator"][data-operator="-"]');
  click(dom, 'button[data-action="negate"]');
  click(dom, 'button[data-action="operator"][data-operator="*"]');
  // negate() removed the "-" here (the accumulator was already negative), so
  // the swap must restore it rather than leaving the display's sign stale.
  assert.equal(displayText(dom), '-4');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '16');
});

test('5 + 2 +/- = still displays 3 (negate on an already-typed operand toggles in place)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  clickDigits(dom, '2');
  click(dom, 'button[data-action="negate"]');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '3');
});

test('5 + 3 = = still displays 11, and Backspace-cancel still lets a later = replay', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  clickDigits(dom, '3');
  click(dom, 'button[data-action="equals"]');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '11');

  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  clickDigits(dom, '3');
  click(dom, 'button[data-action="equals"]');
  click(dom, 'button[data-action="operator"][data-operator="*"]');
  click(dom, 'button[data-action="backspace"]');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '11');
});

test('2 + 3 * 4 = still displays 20 (chained left-to-right arithmetic unaffected)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '2');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  clickDigits(dom, '3');
  click(dom, 'button[data-action="operator"][data-operator="*"]');
  clickDigits(dom, '4');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '20');
});

test('+/- on a computed result after = still leaves it non-editable', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  clickDigits(dom, '3');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '8');

  click(dom, 'button[data-action="negate"]');
  assert.equal(displayText(dom), '-8');
  // Non-editable: the next digit replaces the negated result wholesale
  // rather than extending it (would be "-82" if it were still editable).
  clickDigits(dom, '2');
  assert.equal(displayText(dom), '2');
});

test('1000000000000000 x 1000000 = displays 1000000000000000000000, no exponent (AID-21 repro 1)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '1000000000000000');
  click(dom, 'button[data-action="operator"][data-operator="*"]');
  clickDigits(dom, '1000000');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '1000000000000000000000');

  // The sign is preserved too: negating the same result must not reintroduce
  // an exponent either.
  click(dom, 'button[data-action="negate"]');
  assert.equal(displayText(dom), '-1000000000000000000000');
});

test('99999999999 x 99999999999 = displays 9999999999800000000000, no exponent (AID-21 repro 2)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '99999999999');
  click(dom, 'button[data-action="operator"][data-operator="*"]');
  clickDigits(dom, '99999999999');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '9999999999800000000000');
});

test('1000000000000000 x 100000 = still displays 100000000000000000000 (just below the 1e21 boundary)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '1000000000000000');
  click(dom, 'button[data-action="operator"][data-operator="*"]');
  clickDigits(dom, '100000');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '100000000000000000000');
});

test('9999999999999999 x 9999999999999999 = displays a plain decimal, not 1e+32 (AID-23 repro 1)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '9999999999999999');
  click(dom, 'button[data-action="operator"][data-operator="*"]');
  clickDigits(dom, '9999999999999999');
  click(dom, 'button[data-action="equals"]');
  const shown = displayText(dom);
  assert.doesNotMatch(shown, /e[+-]/);
  assert.equal(Number(shown), 9999999999999999 * 9999999999999999);
});

test('1 / 10000000 = displays 0.0000001, not 1e-7 (AID-23 repro 2)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '1');
  click(dom, 'button[data-action="operator"][data-operator="/"]');
  clickDigits(dom, '10000000');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '0.0000001');
});

test('1 / 100000000 = displays 0.00000001, not 1e-8 (AID-26 repro 1)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '1');
  click(dom, 'button[data-action="operator"][data-operator="/"]');
  clickDigits(dom, '100000000');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '0.00000001');
});

test('1 / 3000000 = displays a plain decimal, no exponent (AID-26 repro 2)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '1');
  click(dom, 'button[data-action="operator"][data-operator="/"]');
  clickDigits(dom, '3000000');
  click(dom, 'button[data-action="equals"]');
  const shown = displayText(dom);
  assert.doesNotMatch(shown, /e[+-]/i);
  assert.equal(Number(shown), Number((1 / 3000000).toPrecision(15)));
});

// A `maximumFractionDigits`-based renderer (an earlier version of this fix)
// caps out at 20-100 fraction digits, so chaining divisions down to 1e-21
// silently rounds the value to zero instead of just misformatting it --
// corrupting the value itself, since equals()/chooseOperator() read the
// operand back with parseFloat(calculatorState.current). The plain-digit
// renderer above never rounds, so the exact non-zero value must survive.
test('-1 / 10000000 / 10000000 / 10000000 = displays -1e-21 as a plain decimal, not -0 (AID-23 regression)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '1');
  click(dom, 'button[data-action="negate"]');
  click(dom, 'button[data-action="operator"][data-operator="/"]');
  clickDigits(dom, '10000000');
  click(dom, 'button[data-action="equals"]');
  click(dom, 'button[data-action="operator"][data-operator="/"]');
  clickDigits(dom, '10000000');
  click(dom, 'button[data-action="equals"]');
  click(dom, 'button[data-action="operator"][data-operator="/"]');
  clickDigits(dom, '10000000');
  click(dom, 'button[data-action="equals"]');
  const shown = displayText(dom);
  assert.notEqual(shown, '-0');
  assert.notEqual(shown, '0');
  assert.doesNotMatch(shown, /e/);
  assert.equal(Number(shown), -1e-21);
});

test('1 / 3 / 1000000 = keeps all 15 significant digits at a small magnitude (AID-23 regression)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '1');
  click(dom, 'button[data-action="operator"][data-operator="/"]');
  clickDigits(dom, '3');
  click(dom, 'button[data-action="equals"]');
  click(dom, 'button[data-action="operator"][data-operator="/"]');
  clickDigits(dom, '1000000');
  click(dom, 'button[data-action="equals"]');
  const shown = displayText(dom);
  assert.equal(Number(shown), Number((1 / 3 / 1000000).toPrecision(15)));
});

test('1 / 10000000 = = = keeps chaining (repeat-on-equals) to a non-zero value (AID-23 regression)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '1');
  click(dom, 'button[data-action="operator"][data-operator="/"]');
  clickDigits(dom, '10000000');
  click(dom, 'button[data-action="equals"]');
  click(dom, 'button[data-action="equals"]');
  click(dom, 'button[data-action="equals"]');
  const shown = displayText(dom);
  assert.notEqual(shown, '0');
  assert.doesNotMatch(shown, /e/);
  assert.equal(Number(shown), 1e-21);
});

test('zero in any typed form stays 0 under negate', async (t) => {
  const dom = await loadCalculator(t);

  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '0');
  click(dom, 'button[data-action="negate"]');
  assert.equal(displayText(dom), '0');

  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '0');
  click(dom, 'button[data-action="decimal"]');
  click(dom, 'button[data-action="negate"]');
  assert.equal(displayText(dom), '0.');

  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '0');
  click(dom, 'button[data-action="decimal"]');
  clickDigits(dom, '00');
  click(dom, 'button[data-action="negate"]');
  assert.equal(displayText(dom), '0.00');
});

// AID-22: leading zeros after the decimal point are not significant digits
// and must not consume the MAX_OPERAND_LENGTH budget -- see countDigits() and
// isOperandFull() in script.js for the decided rationale.

test('C . then twenty 0s then 1 displays 0.0000000000000000000001, keeping the significant digit (AID-22 repro)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  click(dom, 'button[data-action="decimal"]');
  clickDigits(dom, '0'.repeat(20));
  clickDigits(dom, '1');
  const shown = displayText(dom);
  assert.equal(shown, '0.' + '0'.repeat(20) + '1');
  assert.equal(digitCount(shown), 1);
});

test('after the AID-22 repro, a further 15 digits are accepted for a full 16-digit budget, and the 17th is refused', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  click(dom, 'button[data-action="decimal"]');
  clickDigits(dom, '0'.repeat(20));
  clickDigits(dom, '1');
  clickDigits(dom, '234567890123456');
  let shown = displayText(dom);
  assert.equal(shown, '0.' + '0'.repeat(20) + '1234567890123456');
  assert.equal(digitCount(shown), 16);

  clickDigits(dom, '7');
  shown = displayText(dom);
  assert.equal(shown, '0.' + '0'.repeat(20) + '1234567890123456');
  assert.equal(digitCount(shown), 16);
});

test('1 . then 23456789012345678 stops at 1.234567890123456 (AID-22 criterion 2, ordinary decimals keep today\'s cap)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '1');
  click(dom, 'button[data-action="decimal"]');
  clickDigits(dom, '23456789012345678');
  assert.equal(displayText(dom), '1.234567890123456');
});

test('16 digits then a 17th is refused for a plain integer operand (AID-22 criterion 3, integer cap unchanged)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '1234567890123456');
  clickDigits(dom, '7');
  assert.equal(displayText(dom), '1234567890123456');
});

test('MAX_OPERAND_CHARS caps a long leading-zero run that costs no significant digits (AID-22)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  click(dom, 'button[data-action="decimal"]');
  // "0." already occupies 2 of the 64 non-sign characters the raw string is
  // capped at (see MAX_OPERAND_CHARS in script.js). Click well past that so
  // the cap, not the click count, decides where the string stops.
  clickDigits(dom, '0'.repeat(80));
  const shown = displayText(dom);
  // Read the real constant out of script.js's top-level scope rather than
  // duplicating the literal here: script.js declares it with top-level
  // `const`, which never becomes a `window` property, but `dom.window.eval`
  // runs in that same global scope and can still see it.
  const maxOperandChars = dom.window.eval('MAX_OPERAND_CHARS');
  const expected = '0.' + '0'.repeat(maxOperandChars - '0.'.length);
  assert.equal(shown, expected);
  assert.equal(shown.length, maxOperandChars);
  assert.equal(digitCount(shown), 0);
});

test('the sign does not consume MAX_OPERAND_CHARS either (AID-22, cf. AID-19)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  click(dom, 'button[data-action="decimal"]');
  clickDigits(dom, '0'.repeat(50));
  clickDigits(dom, '1');
  click(dom, 'button[data-action="negate"]');
  const tail = '2345678901234'; // more than the char cap can still take
  clickDigits(dom, tail);
  const shown = displayText(dom);
  // Read the real constant, as the test above does, instead of duplicating 64.
  const maxOperandChars = dom.window.eval('MAX_OPERAND_CHARS');
  // The operand held "0." + 50 zeros + "1" (53 non-sign characters) when the
  // sign went on, so only the first `maxOperandChars - 53` characters of the
  // tail can still land -- 13 are typed, so the cap, not the click count, is
  // what stops it. At most 14 significant digits are ever attempted (12 end up
  // in the operand), well under MAX_OPERAND_LENGTH, so what this pins is the
  // character cap specifically.
  const kept = '0.' + '0'.repeat(50) + '1';
  assert.equal(shown, `-${kept}${tail.slice(0, maxOperandChars - kept.length)}`);
  // Sign excluded: the same budget of characters a positive operand gets.
  assert.equal(shown.slice(1).length, maxOperandChars);
  assert.equal(shown.startsWith('-'), true);
});

// AID-24: backspace() must normalise a post-slice operand by value, not by a
// literal allowlist, so every decimal spelling of negative zero (not just
// '-0') loses its sign instead of reaching the display.

test('0 . 5 +/- Backspace displays 0.5 typed digit by digit ends 0. rather than -0. (AID-24 repro)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '0');
  click(dom, 'button[data-action="decimal"]');
  clickDigits(dom, '5');
  assert.equal(displayText(dom), '0.5');

  click(dom, 'button[data-action="negate"]');
  assert.equal(displayText(dom), '-0.5');

  click(dom, 'button[data-action="backspace"]');
  const shown = displayText(dom);
  assert.equal(shown, '0.');
  assert.equal(shown.startsWith('-'), false);

  // '0.' is not exactly '0', so overwrite must not be re-armed: the next
  // digit appends rather than replacing the operand.
  clickDigits(dom, '5');
  assert.equal(displayText(dom), '0.5');
});

test('-0.00 Backspace displays 0.0, never a leading "-" (AID-24, longer trailing-zero form)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  click(dom, 'button[data-action="negate"]');
  click(dom, 'button[data-action="decimal"]');
  clickDigits(dom, '00');
  assert.equal(displayText(dom), '-0.00');

  click(dom, 'button[data-action="backspace"]');
  const shown = displayText(dom);
  assert.equal(shown, '0.0');
  assert.equal(shown.startsWith('-'), false);
});

test('-1 Backspace displays 0 with overwrite re-armed (AID-24, exact "0" result still re-arms)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '1');
  click(dom, 'button[data-action="negate"]');
  assert.equal(displayText(dom), '-1');

  click(dom, 'button[data-action="backspace"]');
  assert.equal(displayText(dom), '0');

  // Overwrite re-armed: the next digit replaces the "0" rather than
  // appending to it (would be "05" if it were still editable).
  clickDigits(dom, '5');
  assert.equal(displayText(dom), '5');
});

test('-123 backspaced twice still displays -1 (AID-24, a genuine negative operand is unaffected)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '123');
  click(dom, 'button[data-action="negate"]');
  assert.equal(displayText(dom), '-123');

  click(dom, 'button[data-action="backspace"]');
  assert.equal(displayText(dom), '-12');

  click(dom, 'button[data-action="backspace"]');
  assert.equal(displayText(dom), '-1');
});

// AID-25: a zero-valued accumulator ("0") was previously indistinguishable,
// inside negate()'s zero-guard, from a zero the user actually typed, so
// "+/-" pressed right after an operator was a no-op whenever the running
// total was exactly 0 -- the pending sign never made it to `pendingNegative`.

test('0 + +/- 5 = displays -5 (AID-25 repro 1, +/- on a zero accumulator)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '0');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  click(dom, 'button[data-action="negate"]');
  // The accumulator itself must stay "0", never "-0", while the sign is
  // only pending.
  assert.equal(displayText(dom), '0');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '-5');
});

test('5 - 5 + +/- 3 = displays -3 (AID-25 repro 2, +/- on an accumulator that computed down to zero)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="operator"][data-operator="-"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  click(dom, 'button[data-action="negate"]');
  assert.equal(displayText(dom), '0');
  clickDigits(dom, '3');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '-3');
});

test('0 + +/- 0 +/- 5 = displays 5 (AID-25, a typed zero in between still cancels the pending sign)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '0');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  click(dom, 'button[data-action="negate"]');
  // A typed "0" between two "+/-" presses cancels the pending sign, exactly
  // as it does on a non-zero accumulator (see the AID-20 test above).
  clickDigits(dom, '0');
  click(dom, 'button[data-action="negate"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '5');
});

test('0 + +/- 0 Backspace 5 = displays 5 (AID-25, backspace parity on a zero accumulator unaffected)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '0');
  click(dom, 'button[data-action="operator"][data-operator="+"]');
  click(dom, 'button[data-action="negate"]');
  clickDigits(dom, '0');
  click(dom, 'button[data-action="backspace"]');
  clickDigits(dom, '5');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '5');
});
