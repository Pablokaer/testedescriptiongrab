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

// Counts significant digits the way script.js's countDigits() does -- the
// leading "0" placeholder of a bare ".x" operand is not significant, and
// neither a sign nor a decimal point ever inflates the count. Used to assert
// the actual MAX_OPERAND_LENGTH invariant (digits), not the display string's
// raw length.
function digitCount(str) {
  return (str.replace(/^-?0(?=\.)/, '').match(/\d/g) || []).length;
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

test('1000000000000000 x 1000000 = displays 1000000000000000000000, not scientific notation (AID-21 repro 1)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '1000000000000000');
  click(dom, 'button[data-action="operator"][data-operator="*"]');
  clickDigits(dom, '1000000');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '1000000000000000000000');
});

test('99999999999 x 99999999999 = displays 9999999999800000000000, not scientific notation (AID-21 repro 2)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '99999999999');
  click(dom, 'button[data-action="operator"][data-operator="*"]');
  clickDigits(dom, '99999999999');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '9999999999800000000000');
});

test('1000000000000000 x 100000 = displays 100000000000000000000, just below the 1e21 boundary (AID-21 control)', async (t) => {
  const dom = await loadCalculator(t);
  click(dom, 'button[data-action="clear"]');
  clickDigits(dom, '1000000000000000');
  click(dom, 'button[data-action="operator"][data-operator="*"]');
  clickDigits(dom, '100000');
  click(dom, 'button[data-action="equals"]');
  assert.equal(displayText(dom), '100000000000000000000');
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
