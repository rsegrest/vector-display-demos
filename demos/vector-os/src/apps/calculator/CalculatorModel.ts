import { CalculatorError, evaluate, formatNumber, type AngleMode } from "./expression.js";

// What a key does. "insert" adds a piece to the expression: a digit, an operator, a constant,
// or a function with its opening parenthesis ("sin(").
export type KeyAction =
  | { readonly kind: "insert"; readonly piece: string }
  | { readonly kind: "equals" | "clear" | "delete" | "angle" | "square" | "reciprocal" };

export interface TapeLine {
  readonly expression: string;
  readonly result: string;
}

export const MAXIMUM_PIECES = 60;
export const MAXIMUM_TAPE_LINES = 50;

// After a result, these carry on from it (ANS + ...); anything else starts a new expression.
const CONTINUES_FROM_RESULT: ReadonlySet<string> = new Set(["+", "-", "*", "/", "^", "!", "%"]);

const SHOWN_AS: Readonly<Record<string, string>> = { "*": "×", "/": "÷", pi: "π" };

const KEYBOARD: Readonly<Record<string, KeyAction>> = {
  Enter: { kind: "equals" },
  "=": { kind: "equals" },
  Backspace: { kind: "delete" },
  Delete: { kind: "clear" },
  x: { kind: "insert", piece: "*" },
  s: { kind: "insert", piece: "sin(" },
  c: { kind: "insert", piece: "cos(" },
  t: { kind: "insert", piece: "tan(" },
  l: { kind: "insert", piece: "ln(" },
  g: { kind: "insert", piece: "log(" },
  r: { kind: "insert", piece: "sqrt(" },
  p: { kind: "insert", piece: "pi" },
  e: { kind: "insert", piece: "e" },
  a: { kind: "insert", piece: "ans" },
  d: { kind: "angle" },
};

function isDigitPiece(piece: string): boolean {
  return /^[0-9.]$/.test(piece);
}

// The calculator itself, without its keys or its screen: an expression being entered,
// the last result, and a paper tape of what has been worked out so far.
export class CalculatorModel {
  public angleMode: AngleMode = "DEG";
  public ans = 0;
  public readonly tape: TapeLine[] = [];
  // The message on the display after a mistake, until the next key.
  public error: string | null = null;
  // The result on the display after "=", until the next key.
  public result: string | null = null;
  private pieces: string[] = [];

  // What the display shows.
  public get display(): string {
    if (this.error !== null) return this.error;
    if (this.result !== null) return this.result;
    return this.pieces.length === 0 ? "0" : this.entry;
  }

  // The expression being entered, as shown: × and ÷ for the operators, π for pi.
  public get entry(): string {
    return this.pieces.map((piece) => SHOWN_AS[piece] ?? piece.toUpperCase()).join("");
  }

  public press(action: KeyAction): void {
    const hadError = this.error !== null;
    this.error = null;
    switch (action.kind) {
      case "insert": this.insert(action.piece); break;
      case "equals": this.equals(); break;
      case "delete": this.delete(); break;
      case "clear": this.clear(hadError); break;
      case "angle": this.angleMode = this.angleMode === "DEG" ? "RAD" : "DEG"; break;
      case "square": this.insert("^"); this.insert("2"); break;
      case "reciprocal": this.reciprocal(); break;
    }
  }

  // A key typed on the keyboard; false if the calculator has no use for it.
  public type(key: string): boolean {
    const action: KeyAction | undefined =
      /^[0-9.+\-*/^()!%]$/.test(key) ? { kind: "insert", piece: key } : (KEYBOARD[key] ?? KEYBOARD[key.toLowerCase()]);
    if (!action) return false;
    this.press(action);
    return true;
  }

  private insert(piece: string): void {
    if (this.result !== null) {
      this.pieces = CONTINUES_FROM_RESULT.has(piece) ? ["ans"] : [];
      this.result = null;
    }
    if (this.pieces.length < MAXIMUM_PIECES) this.pieces.push(piece);
  }

  private delete(): void {
    if (this.result !== null) this.result = null;
    else this.pieces.pop();
  }

  // Clears the entry; with nothing entered, clears the tape as well.
  private clear(hadError: boolean): void {
    if (this.pieces.length === 0 && this.result === null && !hadError) {
      this.tape.length = 0;
      this.ans = 0;
    }
    this.pieces = [];
    this.result = null;
  }

  private reciprocal(): void {
    if (this.result !== null) this.pieces = ["1", "/", "ans"];
    else if (this.pieces.length === 0) this.pieces = ["1", "/"];
    else this.pieces = ["1", "/", "(", ...this.pieces, ")"];
    this.result = null;
  }

  private equals(): void {
    if (this.result !== null || this.pieces.length === 0) return;
    // Parentheses left open are closed, as a pocket calculator does.
    let open = 0;
    for (const piece of this.pieces) open += piece.endsWith("(") ? 1 : piece === ")" ? -1 : 0;
    for (; open > 0; open--) this.pieces.push(")");
    try {
      const value = evaluate(this.source(), { angleMode: this.angleMode, ans: this.ans });
      this.result = formatNumber(value);
      this.tape.push({ expression: this.entry, result: this.result });
      if (this.tape.length > MAXIMUM_TAPE_LINES) this.tape.shift();
      this.ans = value;
      this.pieces = [];
    } catch (error) {
      if (!(error instanceof CalculatorError)) throw error;
      this.error = error.message;
    }
  }

  // The pieces as text for the evaluator. Digits run together into numbers; everything
  // else is kept apart, so that "pi" then "e" is not read as one unknown name.
  private source(): string {
    let text = "";
    this.pieces.forEach((piece, index) => {
      const joinsPrevious = index > 0 && isDigitPiece(piece) && isDigitPiece(this.pieces[index - 1]);
      text += joinsPrevious ? piece : ` ${piece}`;
    });
    return text;
  }
}
