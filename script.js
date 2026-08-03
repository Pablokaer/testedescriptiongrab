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
// Pressing "=" again with nothing pending repeats the last operator and
// operand against what is displayed: 5 + 3 = -> 8, = -> 11, = -> 14.
// Backspace, pressed right after choosing an operator (before any digit of
// the second operand is typed), cancels that pending operator instead of
// deleting digits, putting the accumulator back on the display as the value
// to continue from.

const display = document.getElementById('calculator-display');
const calculatorGrid = document.querySelector('.calculator-grid');

const calculatorState = {
  current: '0', // string currently shown/being typed for the active operand
  previous: null, // number, the running accumulator
  operator: null, // pending operator: '+', '-', '*', '/'
  overwrite: true, // next digit press should start a fresh operand
  error: false, // true when the display is showing an error state
  lastOperator: null, // operator applied by the most recent "=", for repeat-on-equals
  lastOperand: null, // number applied by the most recent "=", for repeat-on-equals
};

function formatNumber(num) {
  if (!Number.isFinite(num)) {
    return 'Error';
  }
  // Any value that is already an exact integer double has no fractional part
  // left to carry float noise, no matter its magnitude, so it needs no
  // cleanup at all: return it verbatim rather than let toPrecision(15) below
  // round away real digits beyond its 15 significant digits. (This used to be
  // gated at MAX_SAFE_INTEGER, which clipped the fast path one ULP short of
  // every exact integer double actually representable above it.) toString()
  // already renders -0 as "0", so no separate normalisation is needed here.
  if (Number.isInteger(num)) {
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
  calculatorState.lastOperator = null;
  calculatorState.lastOperand = null;
  updateDisplay();
}

// Cap how long a typed operand can grow so it stays reasonably readable and
// so users can't type well past double precision (the display can still
// scroll horizontally to reveal the digits being typed). This only limits
// manual typing; computed results are never truncated.
//
// The cap is a budget of significant digits (see countDigits() below), not of
// raw `current.length` characters: the sign and the decimal point are
// separators, not digits, and never consume a slot. A negative operand is
// therefore entitled to exactly the same 16 digits as a positive one, and a
// 17-character display like "-1234567890123456" is correct under this rule,
// not a bug -- do not "fix" it back to counting characters. One direct
// consequence: prepending '-' can never change how many digits `current`
// holds, so negate() below cannot push an operand over the cap and needs no
// length check of its own.
const MAX_OPERAND_LENGTH = 16;

// Count only significant digit characters, so a separator like the decimal
// point (and the leading '-' the sign-toggle button can produce) never
// eats into the digit budget above -- an integer and a decimal operand then
// accept the same number of significant digits. The placeholder "0" that
// inputDecimal() seeds before a leading '.' (e.g. "0.") is not significant
// either -- the integer path already treats it the same way, replacing
// rather than appending to a lone "0" -- so it is stripped before counting.
function countDigits(str) {
  return (str.replace(/^-?0(?=\.)/, '').match(/\d/g) || []).length;
}

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
  } else if (countDigits(calculatorState.current) < MAX_OPERAND_LENGTH) {
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

  if (calculatorState.current.includes('.') || countDigits(calculatorState.current) >= MAX_OPERAND_LENGTH) {
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

  // `overwrite` alone conflates three different situations: (1) an operator
  // is pending and no digit of the second operand is currently entered (none
  // typed yet, or all of them backspaced away), (2) a result was just
  // computed by "=", and (3) the state is fresh after "AC".
  // Only (1) has a concrete last action worth undoing -- the just-chosen
  // operator -- so cancel it and put the accumulator back on the display as
  // the value in hand. `overwrite` deliberately stays true: the restored
  // accumulator is a value to continue from, not a fresh entry to edit, so a
  // further backspace is a no-op and the next digit replaces it -- the same
  // stance as after "=".
  // (2) and (3) leave `operator` null and must stay a no-op: a computed
  // result (or a blank slate) is not something backspace can meaningfully
  // peel a digit off of, matching the non-editable stance in negate() below.
  if (calculatorState.overwrite) {
    if (calculatorState.operator === null) {
      return;
    }
    // Defensive: chooseOperator always sets `previous` alongside `operator`,
    // so this is never null here (same shape as the guard in equals()).
    if (calculatorState.previous !== null) {
      calculatorState.current = formatNumber(calculatorState.previous);
    }
    calculatorState.previous = null;
    calculatorState.operator = null;
    // `lastOperator`/`lastOperand` are intentionally left alone: cancelling
    // an operator should be indistinguishable from never having pressed it,
    // so a later "=" still replays the remembered operation: "5 + 3 = 2 *"
    // then backspace then "=" gives the same 5 as "5 + 3 = 2 =".
    updateDisplay();
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

  // Prepending/stripping '-' never changes the digit count, only the sign,
  // so this toggle cannot breach MAX_OPERAND_LENGTH (see the comment above
  // that constant) and needs no length check of its own.
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
    // Recover like the other keys (see inputDigit/backspace above) instead of
    // silently dropping the press: reset to a well-defined baseline operand
    // before the pressed operator is applied below.
    calculatorState.error = false;
    calculatorState.current = '0';
    calculatorState.previous = 0;
    calculatorState.operator = null;
    calculatorState.overwrite = true;
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
      // Wipe the remembered operation too: an error state must never leave a
      // stale operation for a later "=" to replay (see equals() below).
      calculatorState.lastOperator = null;
      calculatorState.lastOperand = null;
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

  if (calculatorState.operator !== null) {
    if (calculatorState.previous === null) {
      return;
    }

    const currentValue = parseFloat(calculatorState.current);
    const result = applyOperator(calculatorState.previous, calculatorState.operator, currentValue);

    // Remember the operator and second operand just applied *before* the
    // pending operation is torn down below, so a later "=" with nothing
    // pending (see the repeat-on-equals branch further down) can replay it
    // instead of becoming a no-op.
    calculatorState.lastOperator = calculatorState.operator;
    calculatorState.lastOperand = currentValue;

    if (!Number.isFinite(result)) {
      calculatorState.error = true;
      calculatorState.current = 'Error';
      calculatorState.previous = null;
      calculatorState.operator = null;
      calculatorState.lastOperator = null;
      calculatorState.lastOperand = null;
      calculatorState.overwrite = true;
      updateDisplay();
      return;
    }

    calculatorState.current = formatNumber(result);
    calculatorState.previous = null;
    calculatorState.operator = null;
    calculatorState.overwrite = true;
    updateDisplay();
    return;
  }

  // Repeat-on-equals: no operator is pending, either because "=" was just
  // pressed (the case above) or because none has ever been chosen. Replay
  // the remembered operator/operand against whatever is currently
  // displayed -- which may be a fresh operand the user just typed -- rather
  // than the original first operand. If nothing has been computed yet,
  // stay a no-op instead of inventing an operation.
  if (calculatorState.lastOperator === null) {
    return;
  }

  const currentValue = parseFloat(calculatorState.current);
  const result = applyOperator(currentValue, calculatorState.lastOperator, calculatorState.lastOperand);

  if (!Number.isFinite(result)) {
    calculatorState.error = true;
    calculatorState.current = 'Error';
    calculatorState.lastOperator = null;
    calculatorState.lastOperand = null;
    calculatorState.overwrite = true;
    updateDisplay();
    return;
  }

  calculatorState.current = formatNumber(result);
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

  // Accept ',' as an alias for '.': on non-US keyboard layouts (German,
  // Brazilian, French, Spanish, Nordic, ...) the physical decimal key types
  // ',' rather than '.'. Some browsers also report the numpad separator key
  // itself as 'Decimal' or 'Separator'. All of these funnel through the same
  // inputDecimal() call so there is a single code path -- and thus a single
  // "only one decimal point" / "leading 0." rule -- and the internal state
  // and display keep rendering '.', never ','.
  if (key === '.' || key === ',' || key === 'Decimal' || key === 'Separator') {
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
