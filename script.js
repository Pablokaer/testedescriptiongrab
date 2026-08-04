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
// "+/-", pressed in that same window (an operator pending, no digit of the
// second operand typed yet), flips the sign shown on the accumulator without
// turning it into an editable entry: the accumulator itself stays intact (so
// a further "+/-" simply flips it back, and Backspace still cancels the
// operator per above) while the sign is remembered as a pending flag that the
// first digit or "." of the second operand then carries onto that fresh
// operand -- see `pendingNegative` below and negate()/inputDigit()/
// inputDecimal(). Pressing another operator instead of a digit in that same
// window is a plain operator swap, same as pressing two operators back to
// back with no "+/-" involved (5 + * leaves the accumulator at 5): it
// discards the pending sign rather than folding it into the accumulator --
// see the `else` branch of chooseOperator() below.

const display = document.getElementById('calculator-display');
const calculatorGrid = document.querySelector('.calculator-grid');

const calculatorState = {
  current: '0', // string currently shown/being typed for the active operand
  previous: null, // number, the running accumulator
  operator: null, // pending operator: '+', '-', '*', '/'
  overwrite: true, // next digit press should start a fresh operand
  // Set by negate() only while `overwrite` is true and an operator is
  // pending, i.e. `current` is still just a rendering of the accumulator
  // and no digit of the second operand has been typed yet. `overwrite`
  // alone says "the next digit replaces rather than extends `current`";
  // this flag additionally says "and it should carry this sign", so the two
  // together keep the accumulator copy non-editable while still letting the
  // user see and apply a sign before typing anything. Consumed by the first
  // inputDigit()/inputDecimal() call that starts the fresh operand.
  pendingNegative: false,
  error: false, // true when the display is showing an error state
  lastOperator: null, // operator applied by the most recent "=", for repeat-on-equals
  lastOperand: null, // number applied by the most recent "=", for repeat-on-equals
};

// Renders a finite double as a plain, non-exponential decimal string. This is
// the single renderer every formatNumber() return path below goes through, so
// they can no longer drift apart on notation (AID-23): Number.prototype.
// toString() switches to exponential form ("1e+32", "1e-7") once |value| >=
// 1e21 or < 1e-6, which every one of those paths used to call. toFixed() is
// not a substitute -- toFixed(0) still returns exponential notation above
// 1e21, and rounds/truncates below it. `num.toLocaleString(..., {
// maximumFractionDigits: 20 })` is not a substitute either, despite looking
// like one: the option is capped at 20 fraction digits (100 in newer
// engines), but a denormal down near Number.MIN_VALUE needs up to 324 of them
// to survive the round trip -- past that cap it silently rounds small
// non-zero values down to "0"/"-0", corrupting the value rather than just
// misformatting it (parseFloat() later reads that back as exact zero). So
// instead this only ever reformats -- never rounds -- the exact digits
// Number.prototype.toString() already produced: toString() itself is always
// digit-perfect (Number(str) === num always holds for its output, at any
// magnitude down to 5e-324), the only thing wrong with its output is that it
// sometimes chooses exponential notation. Splitting that exponential form
// into sign/integer-digits/fraction-digits/exponent and re-assembling it as
// plain digits (shifting the decimal point by `exponent` places, right-padded
// or left-padded with zeros as needed) therefore keeps that same round-trip
// guarantee at every magnitude, matching AID-21's "never invent digits" rule.
// toString() already renders -0 as "0", so a non-exponential `str` needs no
// separate -0 handling; the regex only matches the exponential form.
function toPlainDecimalString(num) {
  const str = num.toString();
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-])(\d+)$/.exec(str);
  if (match === null) {
    return str; // already plain -- toString() only used exponential notation above 1e21 or below 1e-6.
  }
  const [, sign, intDigits, fractionDigits = '', expSign, expDigits] = match;
  const exponent = Number(expDigits);
  if (expSign === '+') {
    return sign + intDigits + fractionDigits + '0'.repeat(exponent - fractionDigits.length);
  }
  return `${sign}0.${'0'.repeat(exponent - intDigits.length)}${intDigits}${fractionDigits}`;
}

function formatNumber(num) {
  if (!Number.isFinite(num)) {
    return 'Error';
  }
  // Any value that is already an exact integer double has no fractional part
  // left to carry float noise, no matter its magnitude, so it needs no
  // cleanup at all: hand it to toPlainDecimalString() verbatim rather than
  // let toPrecision(15) below round away real digits beyond its 15
  // significant digits. (This used to be gated at MAX_SAFE_INTEGER, which
  // clipped the fast path one ULP short of every exact integer double
  // actually representable above it.) toPlainDecimalString() renders -0 as
  // "0", same as toString() (see its own comment above), so no separate
  // normalisation is needed here.
  if (Number.isInteger(num)) {
    return toPlainDecimalString(num);
  }
  // Normalise to 15 significant digits to remove float noise (e.g.
  // 0.1 + 0.2) without collapsing very small results to 0 or overflowing
  // very large ones to Infinity, as a fixed-decimal rounding would.
  const rounded = Number(num.toPrecision(15));
  if (!Number.isFinite(rounded)) {
    // Rounding up can tip the handful of doubles just below MAX_VALUE over
    // the edge; keep the original finite value rather than print Infinity.
    return toPlainDecimalString(num);
  }
  return toPlainDecimalString(rounded);
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
  calculatorState.pendingNegative = false;
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
// not a bug -- do not "fix" it back to counting characters (a separate
// raw-length safety ceiling does exist -- see MAX_OPERAND_CHARS below -- but
// it is a distinct concern from this significant-digit budget). One direct
// consequence: prepending '-' can never change how many digits `current`
// holds, so negate() below cannot push an operand over the cap and needs no
// length check of its own.
const MAX_OPERAND_LENGTH = 16;

// AID-22 decision: a whole leading run of zeros -- the placeholder integer
// "0", the decimal point, and any zeros immediately after it -- costs no
// double-precision significance (double precision is mantissa-relative), so
// none of it may consume the MAX_OPERAND_LENGTH budget above. Left
// unchecked, that would let the raw typed string ("0.000...000<digits>")
// grow without bound, so this is a separate ceiling on the raw string length
// itself, not on significant digits. Like MAX_OPERAND_LENGTH, the sign is a
// separator and is excluded from the count (see isOperandFull() below) --
// negating an operand must never be what pushes it over this cap either.
// 64 is a deliberate safety bound, not a product rule: it sits far clear of
// anything typed deliberately, e.g. "0." + 46 leading zeros + a full
// 16-significant-digit operand is exactly 64 characters.
const MAX_OPERAND_CHARS = 64;

// Count only significant digit characters against MAX_OPERAND_LENGTH, so a
// separator like the decimal point (and the leading '-' the sign-toggle
// button can produce) never eats into that budget -- an integer and a
// decimal operand then accept the same number of significant digits. Per the
// AID-22 decision, this also strips the *entire* leading run of zeros before
// counting, not just the single placeholder "0" that inputDecimal() seeds
// before a leading '.' (e.g. "0." or "0.000"): leading zeros carry no
// precision, so "0.0000000000000000000001" counts as 1 significant digit,
// not 21. The '.' in the pattern is optional, so this also now counts a bare
// "0" (no decimal point at all) as 0 significant digits rather than 1 -- a
// real behaviour change from before, but a harmless one: inputDigit() never
// asks (its `current === '0'` branch short-circuits first), and inputDecimal()
// does ask, via isOperandFull(), but 0 and 1 are both far below
// MAX_OPERAND_LENGTH, so the answer cannot change what it does.
function countDigits(str) {
  return (str.replace(/^-?0*\.?0*/, '').match(/\d/g) || []).length;
}

// AID-22 decision: an operand is "full" -- and further digits/decimal points
// must be silently refused, exactly as before -- when either cap above is
// reached: the significant-digit budget (MAX_OPERAND_LENGTH), or, for the
// leading-zero runs that budget deliberately no longer charges for, the raw
// character ceiling (MAX_OPERAND_CHARS). Shared by inputDigit() and
// inputDecimal() so the two call sites can never drift apart on what "full"
// means. The sign is excluded from the character count for the same reason
// it is excluded from MAX_OPERAND_LENGTH above: it is a separator, not part
// of the value, and must never consume a slot in either cap.
function isOperandFull(str) {
  const unsigned = str.startsWith('-') ? str.slice(1) : str;
  return countDigits(str) >= MAX_OPERAND_LENGTH || unsigned.length >= MAX_OPERAND_CHARS;
}

// Carries a pending sign (see `pendingNegative` above) onto the first
// significant digit of a fresh operand, and consumes it once applied. A bare
// "0" never takes the sign -- it is only a placeholder digit, not a value of
// its own (inputDigit() below still special-cases and replaces it), and a
// standalone "-0" would violate the same "never show -0" rule negate() and
// formatNumber() already enforce -- so the pending sign survives a leading
// "0" for the next digit to pick up instead.
function consumeSign(digit) {
  if (!calculatorState.pendingNegative || digit === '0') {
    return digit;
  }
  calculatorState.pendingNegative = false;
  return `-${digit}`;
}

function inputDigit(digit) {
  if (calculatorState.error) {
    calculatorState.error = false;
    calculatorState.current = digit;
    calculatorState.overwrite = false;
    calculatorState.pendingNegative = false;
    updateDisplay();
    return;
  }

  if (calculatorState.overwrite) {
    calculatorState.current = consumeSign(digit);
    calculatorState.overwrite = false;
  } else if (calculatorState.current === '0') {
    calculatorState.current = consumeSign(digit);
  } else if (!isOperandFull(calculatorState.current)) {
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
    calculatorState.pendingNegative = false;
    updateDisplay();
    return;
  }

  if (calculatorState.overwrite) {
    // Unlike a lone "0" in inputDigit() above, "0." is already a value in
    // progress (e.g. on its way to "0.5"), so a pending sign is meaningful
    // here and applies immediately instead of waiting for a later digit.
    calculatorState.current = calculatorState.pendingNegative ? '-0.' : '0.';
    calculatorState.pendingNegative = false;
    calculatorState.overwrite = false;
    updateDisplay();
    return;
  }

  if (calculatorState.current.includes('.') || isOperandFull(calculatorState.current)) {
    return;
  }

  // The only reachable non-overwrite state with a pending sign is
  // `current === "0"`: consumeSign() deliberately leaves a lone "0"
  // placeholder digit unsigned (see its comment) so the sign survives to be
  // picked up here, once the "0" turns out to be the start of a decimal
  // rather than the whole operand.
  if (calculatorState.pendingNegative) {
    calculatorState.current = `-${calculatorState.current}`; // "0" -> "-0."
    calculatorState.pendingNegative = false;
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
    // Cancelling the operator also cancels any sign the user asked for with
    // "+/-" while it was pending (see `pendingNegative` above): it never
    // applied to a real digit, so nothing to restore or carry forward.
    calculatorState.pendingNegative = false;
    // `lastOperator`/`lastOperand` are intentionally left alone: cancelling
    // an operator should be indistinguishable from never having pressed it,
    // so a later "=" still replays the remembered operation: "5 + 3 = 2 *"
    // then backspace then "=" gives the same 5 as "5 + 3 = 2 =".
    updateDisplay();
    return;
  }

  const next = calculatorState.current.slice(0, -1);
  // AID-24 decision: normalise by value, not by spelling. The old allowlist
  // (''/'-'/'-0' -> '0') missed every decimal form of negative zero
  // ('-0.', '-0.0', '-0.00', ...), which then reached the display verbatim
  // -- exactly the "-0" state negate() below refuses to ever produce. Once
  // the empty-operand cases are handled, any remainder that still parses to
  // zero and carries a leading '-' just has that sign stripped, which maps
  // '-0' -> '0' and '-0.' -> '0.' (and any number of trailing zeros) from a
  // single rule instead of one literal per spelling.
  if (next === '' || next === '-') {
    calculatorState.current = '0';
  } else if (next.startsWith('-') && parseFloat(next) === 0) {
    calculatorState.current = next.slice(1);
  } else {
    calculatorState.current = next;
  }
  if (calculatorState.current === '0') {
    calculatorState.overwrite = true;
  }
  // Deleting into this entry also discards any sign still pending on it (see
  // `pendingNegative` above and consumeSign()): a lone "0" digit deliberately
  // leaves the sign uncommitted, so backspacing that "0" away must drop the
  // sign too, restoring parity with the un-negated sequence ("5 + 0
  // Backspace 2" shows "2", so "5 + +/- 0 Backspace 2" must too).
  calculatorState.pendingNegative = false;
  updateDisplay();
}

function negate() {
  if (calculatorState.error) {
    return;
  }

  // "+/-" on a zero (in any typed form, e.g. "0", "0.", "0.00") must never
  // produce a displayed "-0" -- but it must still be able to undo a sign
  // already on the display (the "-0." that inputDecimal() above seeds for a
  // pending sign) and to cancel a sign that is still only pending (so a "0"
  // typed in between two "+/-" presses doesn't make the second one a
  // no-op). So zero can always *lose* a sign here, it just can never *gain*
  // one.
  if (parseFloat(calculatorState.current) === 0) {
    // AID-25 decision: the rule above is about the operand being entered, so
    // it must not swallow the sign when the zero on the display is merely the
    // accumulator rendered into `current` (see chooseOperator) while an
    // operator is pending. The digit string must still never become "-0", but
    // the sign itself belongs to the operand about to be typed, so it has to
    // keep toggling exactly like the general case below would -- otherwise
    // "+/-" after an operator is a no-op whenever the running total is 0.
    if (calculatorState.overwrite && calculatorState.operator !== null) {
      calculatorState.pendingNegative = !calculatorState.pendingNegative;
      return;
    }
    if (calculatorState.current.startsWith('-')) {
      calculatorState.current = calculatorState.current.slice(1);
      updateDisplay();
    }
    calculatorState.pendingNegative = false;
    return;
  }

  // Prepending/stripping '-' never changes the digit count, only the sign,
  // so this toggle cannot breach either cap on operand size -- not
  // MAX_OPERAND_LENGTH (see the comment above that constant), and not
  // MAX_OPERAND_CHARS either, since that cap also excludes the sign (see
  // isOperandFull()) -- and needs no length check of its own.
  calculatorState.current = calculatorState.current.startsWith('-')
    ? calculatorState.current.slice(1)
    : `-${calculatorState.current}`;

  // Only when an operator is pending does `current` still hold a copy of the
  // accumulator with `overwrite` true (see chooseOperator). `overwrite` must
  // stay true rather than be cleared: `current` is a *rendering* of the
  // accumulator, not an in-progress entry, so the next digit should replace
  // it wholesale (see inputDigit/inputDecimal) and Backspace should still
  // treat this as "nothing typed yet" and cancel the operator (see above).
  // The sign the user asked for is instead recorded in `pendingNegative` for
  // those to consume; toggling it (rather than setting it) lets a second
  // "+/-" here cancel the first. After "=" the display holds a computed
  // result, which must stay non-editable and has no pending sign to track.
  if (calculatorState.overwrite && calculatorState.operator !== null) {
    calculatorState.pendingNegative = !calculatorState.pendingNegative;
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
    calculatorState.pendingNegative = false;
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
      calculatorState.pendingNegative = false;
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
    // `current` may be carrying a display-only sign from "+/-" (see
    // `pendingNegative`): it belongs to the operand the user was about to
    // type, not to the accumulator, so an operator swap must not fold it in
    // -- undo it here the same way the sign was applied, by re-negating.
    calculatorState.previous = calculatorState.pendingNegative ? -currentValue : currentValue;
  }

  // A pending sign only ever applies to the operand that was in hand for
  // *this* operator; whether it was just used above (folded into
  // `currentValue`/`previous`) or is being dropped in favour of a straight
  // operator swap, the next operand starts clean -- otherwise a stray digit
  // typed after this point would still pick up a now-stale sign.
  calculatorState.pendingNegative = false;
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
      calculatorState.pendingNegative = false;
      updateDisplay();
      return;
    }

    calculatorState.current = formatNumber(result);
    calculatorState.previous = null;
    calculatorState.operator = null;
    calculatorState.overwrite = true;
    calculatorState.pendingNegative = false;
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
