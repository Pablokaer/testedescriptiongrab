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
