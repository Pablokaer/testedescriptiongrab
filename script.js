// --- Click counter -------------------------------------------------------

const counterValue = document.getElementById('counter-value');
const counterButton = document.getElementById('counter-button');

let count = 0;

let bumpTimeoutId = null;

counterButton.addEventListener('click', () => {
  count += 1;
  counterValue.textContent = count;

  // Subtle micro interaction on every change. Cleared both by
  // `transitionend` and by a timeout fallback, since under
  // `prefers-reduced-motion` there is no transition to fire the event.
  counterValue.classList.remove('bump');
  window.clearTimeout(bumpTimeoutId);
  // Force reflow so the animation can restart if triggered in quick succession.
  void counterValue.offsetWidth;
  counterValue.classList.add('bump');
  bumpTimeoutId = window.setTimeout(() => {
    counterValue.classList.remove('bump');
  }, 250);
});

counterValue.addEventListener('transitionend', () => {
  counterValue.classList.remove('bump');
});

// --- Calculator ------------------------------------------------------------
//
// Input model: a simple "immediate / chained" calculator, like a physical
// four-function calculator. It keeps a running accumulator (`previous`) and
// applies the pending operator as soon as a new operator (or "=") is
// pressed, evaluating strictly left-to-right with no operator precedence.
// Example: 2 + 3 × 4 = -> ((2 + 3) * 4) = 20.
// This is the model most people expect from a "basic calculator" and is
// simple to reason about and keep correct (no expression parsing needed).

const display = document.getElementById('calculator-display');
const calculatorGrid = document.querySelector('.calculator-grid');

const calculatorState = {
  current: '0', // string currently shown/being typed for the active operand
  previous: null, // number, the running accumulator
  operator: null, // pending operator: '+', '-', '*', '/'
  overwrite: true, // next digit press should start a fresh operand
  error: false, // true when the display is showing an error state
};

function formatNumber(num) {
  if (!Number.isFinite(num)) {
    return 'Error';
  }
  // Doubles represent integers exactly up to MAX_SAFE_INTEGER (16 digits), so
  // those results need no float-noise cleanup: return them verbatim rather than
  // let toPrecision(15) below round away their real 16th digit.
  if (Number.isInteger(num) && Math.abs(num) <= Number.MAX_SAFE_INTEGER) {
    return num.toString();
  }
  // Normalise to 15 significant digits to remove float noise (e.g.
  // 0.1 + 0.2) without collapsing very small results to 0 or overflowing
  // very large ones to Infinity, as a fixed-decimal rounding would.
  const rounded = Number(num.toPrecision(15));
  if (!Number.isFinite(rounded)) {
    // Rounding up can tip the handful of doubles just below MAX_VALUE over
    // the edge; keep the original finite value rather than print Infinity.
    return num.toString();
  }
  if (Object.is(rounded, -0)) {
    return '0';
  }
  return rounded.toString();
}

function updateDisplay() {
  display.textContent = calculatorState.error ? 'Error' : calculatorState.current;
  // Keep the digits being typed in view: with a right-aligned, scrollable
  // display, the start (not the end) is visible by default.
  display.scrollLeft = display.scrollWidth;
}

function resetCalculator() {
  calculatorState.current = '0';
  calculatorState.previous = null;
  calculatorState.operator = null;
  calculatorState.overwrite = true;
  calculatorState.error = false;
  updateDisplay();
}

// Cap how long a typed operand can grow so it stays reasonably readable and
// so users can't type well past double precision (the display can still
// scroll horizontally to reveal the digits being typed). This only limits
// manual typing; computed results are never truncated.
const MAX_OPERAND_LENGTH = 16;

function inputDigit(digit) {
  if (calculatorState.error) {
    calculatorState.error = false;
    calculatorState.current = digit;
    calculatorState.overwrite = false;
    updateDisplay();
    return;
  }

  if (calculatorState.overwrite) {
    calculatorState.current = digit === '0' ? '0' : digit;
    calculatorState.overwrite = false;
  } else if (calculatorState.current === '0') {
    calculatorState.current = digit;
  } else if (calculatorState.current.length < MAX_OPERAND_LENGTH) {
    calculatorState.current += digit;
  } else {
    return;
  }
  updateDisplay();
}

function inputDecimal() {
  if (calculatorState.error) {
    calculatorState.error = false;
    calculatorState.current = '0.';
    calculatorState.overwrite = false;
    updateDisplay();
    return;
  }

  if (calculatorState.overwrite) {
    calculatorState.current = '0.';
    calculatorState.overwrite = false;
    updateDisplay();
    return;
  }

  if (calculatorState.current.includes('.') || calculatorState.current.length >= MAX_OPERAND_LENGTH) {
    return;
  }

  calculatorState.current += '.';
  updateDisplay();
}

function backspace() {
  if (calculatorState.error) {
    resetCalculator();
    return;
  }

  if (calculatorState.overwrite) {
    return;
  }

  const next = calculatorState.current.slice(0, -1);
  calculatorState.current = next === '' || next === '-' || next === '-0' ? '0' : next;
  if (calculatorState.current === '0') {
    calculatorState.overwrite = true;
  }
  updateDisplay();
}

function negate() {
  if (calculatorState.error) {
    return;
  }

  // Zero (in any typed form, e.g. "0", "0.", "0.00") must stay zero rather
  // than turn into a "-0" that would be confusing on the display.
  if (parseFloat(calculatorState.current) === 0) {
    return;
  }

  calculatorState.current = calculatorState.current.startsWith('-')
    ? calculatorState.current.slice(1)
    : `-${calculatorState.current}`;

  // Only when an operator is pending does `current` still hold a copy of the
  // accumulator with `overwrite` true (see chooseOperator); clearing the flag
  // there makes the negated value the next operand. After "=" the display
  // holds a computed result, which must stay non-editable.
  if (calculatorState.operator !== null) {
    calculatorState.overwrite = false;
  }
  updateDisplay();
}

function applyOperator(a, operator, b) {
  switch (operator) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      if (b === 0) {
        return NaN;
      }
      return a / b;
    default:
      return b;
  }
}

function chooseOperator(operator) {
  if (calculatorState.error) {
    return;
  }

  const currentValue = parseFloat(calculatorState.current);

  if (calculatorState.operator !== null && !calculatorState.overwrite) {
    const result = applyOperator(calculatorState.previous, calculatorState.operator, currentValue);
    if (!Number.isFinite(result)) {
      calculatorState.error = true;
      calculatorState.current = 'Error';
      calculatorState.previous = null;
      calculatorState.operator = null;
      calculatorState.overwrite = true;
      updateDisplay();
      return;
    }
    calculatorState.previous = result;
    calculatorState.current = formatNumber(result);
  } else {
    calculatorState.previous = currentValue;
  }

  calculatorState.operator = operator;
  calculatorState.overwrite = true;
  updateDisplay();
}

function equals() {
  if (calculatorState.error) {
    return;
  }

  if (calculatorState.operator === null || calculatorState.previous === null) {
    return;
  }

  const currentValue = parseFloat(calculatorState.current);
  const result = applyOperator(calculatorState.previous, calculatorState.operator, currentValue);

  if (!Number.isFinite(result)) {
    calculatorState.error = true;
    calculatorState.current = 'Error';
    calculatorState.previous = null;
    calculatorState.operator = null;
    calculatorState.overwrite = true;
    updateDisplay();
    return;
  }

  calculatorState.current = formatNumber(result);
  calculatorState.previous = null;
  calculatorState.operator = null;
  calculatorState.overwrite = true;
  updateDisplay();
}

function handleCalculatorAction(target) {
  const { action } = target.dataset;

  switch (action) {
    case 'digit':
      inputDigit(target.dataset.digit);
      break;
    case 'decimal':
      inputDecimal();
      break;
    case 'operator':
      chooseOperator(target.dataset.operator);
      break;
    case 'equals':
      equals();
      break;
    case 'clear':
      resetCalculator();
      break;
    case 'backspace':
      backspace();
      break;
    case 'negate':
      negate();
      break;
    default:
      break;
  }
}

calculatorGrid.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    return;
  }
  handleCalculatorAction(button);
});

const OPERATOR_KEYS = {
  '+': '+',
  '-': '-',
  '*': '*',
  '/': '/',
};

document.addEventListener('keydown', (event) => {
  const { key } = event;

  // Ignore modifier combinations (Ctrl/Cmd/Alt) so browser shortcuts like
  // zoom (Ctrl+-/Ctrl+0), quick-find (Ctrl+/) or tab switching (Cmd+1..9)
  // keep working and don't leak into the calculator's state. Shift is
  // intentionally allowed since '+' and '*' are typed as Shift combinations.
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  if (key >= '0' && key <= '9') {
    inputDigit(key);
    return;
  }

  if (key === '.') {
    inputDecimal();
    return;
  }

  if (key in OPERATOR_KEYS) {
    // Prevent default too: '/' in particular would otherwise open the
    // browser's quick-find bar (e.g. Firefox) and steal the keystroke.
    event.preventDefault();
    chooseOperator(OPERATOR_KEYS[key]);
    return;
  }

  if (key === 'Enter') {
    if (event.target instanceof Element && event.target.closest('button')) {
      // Let the browser activate the focused button natively (it already
      // has its own click handler wired up) instead of hijacking Enter for
      // "equals" and breaking keyboard activation of every button.
      return;
    }
    event.preventDefault();
    equals();
    return;
  }

  if (key === '=') {
    event.preventDefault();
    equals();
    return;
  }

  if (key === 'Escape') {
    resetCalculator();
    return;
  }

  if (key === 'Backspace') {
    event.preventDefault();
    backspace();
  }
});

updateDisplay();
