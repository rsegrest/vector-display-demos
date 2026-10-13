export type AngleMode = "DEG" | "RAD";

export interface EvaluationContext {
  readonly angleMode: AngleMode;
  // The value of ANS: the last result.
  readonly ans: number;
}

// Something the calculator cannot work out; the message is what its display shows.
export class CalculatorError extends Error {}

const SYNTAX = "SYNTAX ERROR";
const DIVIDE_BY_ZERO = "DIVIDE BY ZERO";
const NOT_A_NUMBER = "NOT A NUMBER";
const OUT_OF_RANGE = "OUT OF RANGE";

// Below this, a trigonometric result is rounding error around zero: sin of 180 degrees should be 0.
const TRIG_EPSILON = 1e-14;
// 171! is more than a double can hold.
const LARGEST_FACTORIAL = 170;

type Token = { readonly kind: "number"; readonly value: number } | { readonly kind: "name" | "symbol"; readonly text: string };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\s*(?:(\d+\.?\d*|\.\d+)|([a-z]+)|([-+*/^()!%]))/gy;
  let position = 0;
  while (position < expression.length) {
    pattern.lastIndex = position;
    const match = pattern.exec(expression);
    if (!match) {
      if (expression.slice(position).trim() === "") break;
      throw new CalculatorError(SYNTAX);
    }
    if (match[1] !== undefined) tokens.push({ kind: "number", value: Number.parseFloat(match[1]) });
    else if (match[2] !== undefined) tokens.push({ kind: "name", text: match[2] });
    else tokens.push({ kind: "symbol", text: match[3] });
    position = pattern.lastIndex;
  }
  return tokens;
}

function snap(value: number): number {
  return Math.abs(value) < TRIG_EPSILON ? 0 : value;
}

function factorial(value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new CalculatorError(NOT_A_NUMBER);
  if (value > LARGEST_FACTORIAL) throw new CalculatorError(OUT_OF_RANGE);
  let product = 1;
  for (let factor = 2; factor <= value; factor++) product *= factor;
  return product;
}

function functions(angleMode: AngleMode): Readonly<Record<string, (value: number) => number>> {
  const toRadians = angleMode === "DEG" ? Math.PI / 180 : 1;
  const sine = (value: number): number => snap(Math.sin(value * toRadians));
  const cosine = (value: number): number => snap(Math.cos(value * toRadians));
  return {
    sin: sine,
    cos: cosine,
    tan: (value) => {
      if (cosine(value) === 0) throw new CalculatorError(DIVIDE_BY_ZERO);
      return sine(value) / cosine(value);
    },
    asin: (value) => Math.asin(value) / toRadians,
    acos: (value) => Math.acos(value) / toRadians,
    atan: (value) => Math.atan(value) / toRadians,
    sqrt: Math.sqrt,
    ln: Math.log,
    log: Math.log10,
    exp: Math.exp,
    abs: Math.abs,
  };
}

// Works out an expression such as "2+3*sin(30)^2". Besides the four operations it knows powers (^),
// parentheses, postfix ! and %, the functions above, the constants pi and e, and ans. A number, a
// name or a parenthesis that follows a value multiplies it: 2pi, 3(4+1), 2sin(30).
export function evaluate(expression: string, context: EvaluationContext): number {
  const tokens = tokenize(expression);
  const known = functions(context.angleMode);
  const constants: Readonly<Record<string, number>> = { pi: Math.PI, e: Math.E, ans: context.ans };
  let index = 0;

  const isSymbol = (text: string): boolean => {
    const token = tokens[index];
    return token !== undefined && token.kind === "symbol" && token.text === text;
  };
  const take = (text: string): boolean => {
    if (!isSymbol(text)) return false;
    index++;
    return true;
  };
  const expect = (text: string): void => {
    if (!take(text)) throw new CalculatorError(SYNTAX);
  };

  const sum = (): number => {
    let value = product();
    for (;;) {
      if (take("+")) value += product();
      else if (take("-")) value -= product();
      else return value;
    }
  };

  const product = (): number => {
    let value = signed();
    for (;;) {
      const token = tokens[index];
      if (take("*")) value *= signed();
      else if (take("/")) {
        const divisor = signed();
        if (divisor === 0) throw new CalculatorError(DIVIDE_BY_ZERO);
        value /= divisor;
      } else if (token !== undefined && (token.kind !== "symbol" || token.text === "(")) value *= power();
      else return value;
    }
  };

  // A sign binds less tightly than a power, so -2^2 is -4.
  const signed = (): number => {
    if (take("-")) return -signed();
    if (take("+")) return signed();
    return power();
  };

  const power = (): number => {
    const base = postfix();
    return take("^") ? Math.pow(base, signed()) : base;
  };

  const postfix = (): number => {
    let value = primary();
    for (;;) {
      if (take("!")) value = factorial(value);
      else if (take("%")) value /= 100;
      else return value;
    }
  };

  const primary = (): number => {
    const token = tokens[index++];
    if (token === undefined) throw new CalculatorError(SYNTAX);
    if (token.kind === "number") return token.value;
    if (token.kind === "name") {
      if (token.text in constants) return constants[token.text];
      const apply = known[token.text];
      if (!apply) throw new CalculatorError(SYNTAX);
      expect("(");
      const argument = sum();
      expect(")");
      return apply(argument);
    }
    if (token.text !== "(") throw new CalculatorError(SYNTAX);
    const value = sum();
    expect(")");
    return value;
  };

  const result = sum();
  if (index < tokens.length) throw new CalculatorError(SYNTAX);
  if (Number.isNaN(result)) throw new CalculatorError(NOT_A_NUMBER);
  if (!Number.isFinite(result)) throw new CalculatorError(OUT_OF_RANGE);
  return result;
}

const SIGNIFICANT_DIGITS = 10;

// A result as the display shows it: ten significant digits, which also hides the rounding error
// of sums like 0.1 + 0.2, and an exponent for the very large and very small.
export function formatNumber(value: number): string {
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  if (magnitude >= 1e10 || magnitude < 1e-6) {
    const [mantissa, exponent] = value.toExponential(SIGNIFICANT_DIGITS - 4).split("e");
    return `${Number.parseFloat(mantissa)}E${Number.parseInt(exponent, 10)}`;
  }
  return String(Number.parseFloat(value.toPrecision(SIGNIFICANT_DIGITS)));
}
