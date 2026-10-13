import { SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList } from "@vector-display/core";
import { DynamicGeometry, getDemoFont, type Demo, type DemoFrame } from "@vector-demos/demo-kit";
import type { OsApp, PointerKind } from "../OsApp.js";
import { CalculatorModel, type KeyAction } from "./CalculatorModel.js";

type KeyStyle = "digit" | "operator" | "function" | "equals" | "clear";

export interface CalculatorKey {
  readonly id: string;
  readonly label: string;
  readonly action: KeyAction;
  readonly style: KeyStyle;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function insert(label: string, piece: string, style: KeyStyle): CalculatorKey {
  return { id: piece, label, action: { kind: "insert", piece }, style };
}

function digit(piece: string): CalculatorKey {
  return insert(piece, piece, "digit");
}

// Five rows of four: the keys of an ordinary calculator.
export const BASIC_KEYS: readonly (readonly CalculatorKey[])[] = [
  [{ id: "clear", label: "C", action: { kind: "clear" }, style: "clear" }, insert("(", "(", "operator"), insert(")", ")", "operator"), insert("÷", "/", "operator")],
  [digit("7"), digit("8"), digit("9"), insert("×", "*", "operator")],
  [digit("4"), digit("5"), digit("6"), insert("-", "-", "operator")],
  [digit("1"), digit("2"), digit("3"), insert("+", "+", "operator")],
  [digit("0"), digit("."), { id: "delete", label: "DEL", action: { kind: "delete" }, style: "clear" }, { id: "equals", label: "=", action: { kind: "equals" }, style: "equals" }],
];

// Five rows of four more, shown to their left when the window is wide enough.
export const SCIENTIFIC_KEYS: readonly (readonly CalculatorKey[])[] = [
  [{ id: "angle", label: "DEG", action: { kind: "angle" }, style: "clear" }, insert("SIN", "sin(", "function"), insert("COS", "cos(", "function"), insert("TAN", "tan(", "function")],
  [insert("X^Y", "^", "function"), insert("ASIN", "asin(", "function"), insert("ACOS", "acos(", "function"), insert("ATAN", "atan(", "function")],
  [{ id: "square", label: "X^2", action: { kind: "square" }, style: "function" }, insert("LN", "ln(", "function"), insert("LOG", "log(", "function"), insert("EXP", "exp(", "function")],
  [insert("SQRT", "sqrt(", "function"), { id: "reciprocal", label: "1/X", action: { kind: "reciprocal" }, style: "function" }, insert("N!", "!", "function"), insert("%", "%", "function")],
  [insert("ABS", "abs(", "function"), insert("π", "pi", "function"), insert("E", "e", "function"), insert("ANS", "ans", "function")],
];

// The scientific keys need this much room; a narrower window shows the basic keys alone.
export const SCIENTIFIC_MINIMUM_WIDTH = 430;

const PADDING = 10;
const KEY_GAP = 6;
// The share of the window's height given to the keys; the tape and display have the rest.
const KEYS_SHARE = 0.62;
const TAPE_SIZE = 11;
const TAPE_PITCH = 19;
const STATUS_SIZE = 10;
const MINIMUM_ENTRY_SIZE = 11;
const FLASH_SECONDS = 0.16;

const COLORS: Readonly<Record<KeyStyle, BeamColor>> = {
  digit: { red: 0.6, green: 0.85, blue: 1 },
  operator: { red: 1, green: 0.8, blue: 0.35 },
  function: { red: 0.45, green: 0.95, blue: 0.75 },
  equals: { red: 1, green: 0.95, blue: 0.8 },
  clear: { red: 1, green: 0.5, blue: 0.4 },
};
const DISPLAY_COLOR: BeamColor = { red: 0.85, green: 1, blue: 0.9 };
const TAPE_COLOR: BeamColor = { red: 0.5, green: 0.75, blue: 1 };
const ERROR_COLOR: BeamColor = { red: 1, green: 0.45, blue: 0.35 };

export interface CalculatorLayout {
  readonly isScientific: boolean;
  readonly keys: readonly { readonly key: CalculatorKey; readonly rect: Rect }[];
  // The top of the keys: the tape and the display are above this line.
  readonly keysTop: number;
  readonly entrySize: number;
  // How many lines of tape fit above the display.
  readonly tapeLines: number;
}

// Where everything goes in a window of this size. The keys share out whatever room there is,
// so the calculator can be made as large or as small as its window.
export function layoutCalculator(width: number, height: number): CalculatorLayout {
  const isScientific = width >= SCIENTIFIC_MINIMUM_WIDTH;
  const rows = BASIC_KEYS.map((row, index) => (isScientific ? [...SCIENTIFIC_KEYS[index], ...row] : [...row]));
  const columns = rows[0].length;
  const keysTop = Math.round(height * (1 - KEYS_SHARE));
  const keyWidth = (width - 2 * PADDING - (columns - 1) * KEY_GAP) / columns;
  const keyHeight = (height - keysTop - PADDING - (rows.length - 1) * KEY_GAP) / rows.length;
  const keys = rows.flatMap((row, rowIndex) =>
    row.map((key, columnIndex) => ({
      key,
      rect: { x: PADDING + columnIndex * (keyWidth + KEY_GAP), y: keysTop + rowIndex * (keyHeight + KEY_GAP), width: keyWidth, height: keyHeight },
    })),
  );
  const entrySize = Math.max(16, Math.min(34, height * 0.075));
  const tapeRoom = keysTop - PADDING - STATUS_SIZE - 8 - entrySize - 20;
  return { isScientific, keys, keysTop, entrySize, tapeLines: Math.max(0, Math.floor(tapeRoom / TAPE_PITCH)) };
}

// A calculator: expressions with parentheses and scientific functions, worked by its own keys or
// the keyboard, with a paper tape of past results above the display.
export class Calculator implements Demo {
  public readonly model = new CalculatorModel();
  private readonly outlines = new DynamicGeometry(256);
  private readonly rule = new DynamicGeometry(4);
  private layout = layoutCalculator(500, 420);
  private hovered: string | null = null;
  // The key just pressed, lit for a moment.
  private flashed: string | null = null;
  private flashSeconds = 0;

  public update(deltaSeconds: number): void {
    this.flashSeconds = Math.max(0, this.flashSeconds - deltaSeconds);
  }

  public resize(width: number, height: number): void {
    this.layout = layoutCalculator(width, height);
  }

  public key(key: string): void {
    this.model.type(key);
  }

  public pointer(kind: PointerKind, x: number, y: number): void {
    const hit = this.layout.keys.find(({ rect }) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height);
    this.hovered = hit?.key.id ?? null;
    if (kind !== "down" || !hit) return;
    this.model.press(hit.key.action);
    this.flashed = hit.key.id;
    this.flashSeconds = FLASH_SECONDS;
  }

  public draw(displayList: DisplayList, frame: DemoFrame): void {
    this.layout = layoutCalculator(frame.width, frame.height);
    this.drawDisplay(displayList, frame.width);
    this.drawKeys(displayList);
  }

  private drawDisplay(displayList: DisplayList, width: number): void {
    const font = getDemoFont();
    const { keysTop, entrySize, tapeLines } = this.layout;
    const right = width - PADDING - 4;
    const room = right - PADDING - 4;

    displayList.setColor(TAPE_COLOR);
    font.addText(displayList, { text: this.model.angleMode, x: PADDING + 2, y: PADDING, size: STATUS_SIZE, intensity: 0.8 });

    // The display line: shrunk to fit, then cut at the left, so what was typed last stays in view.
    const isError = this.model.error !== null;
    let text = this.model.display;
    let size = entrySize;
    const widthOf = (candidate: string, candidateSize: number): number => font.measureText(candidate, candidateSize).width;
    if (widthOf(text, size) > room) size = Math.max(MINIMUM_ENTRY_SIZE, (size * room) / widthOf(text, size));
    while (text.length > 2 && widthOf(text, size) > room) text = `<${text.slice(2)}`;
    const entryTop = keysTop - 14 - entrySize + (entrySize - size) / 2;
    displayList.setColor(isError ? ERROR_COLOR : DISPLAY_COLOR);
    font.addText(displayList, { text, x: right, y: entryTop, size, alignment: "right", intensity: 1.15 });

    // The tape: the most recent line nearest the display, older ones fainter above it.
    displayList.setColor(TAPE_COLOR);
    const tape = this.model.tape;
    const shown = Math.min(tapeLines, tape.length);
    for (let line = 0; line < shown; line++) {
      const { expression, result } = tape[tape.length - 1 - line];
      let tapeText = `${expression} = ${result}`;
      while (tapeText.length > result.length + 4 && widthOf(tapeText, TAPE_SIZE) > room) tapeText = `<${tapeText.slice(2)}`;
      const y = keysTop - 14 - entrySize - 12 - (line + 1) * TAPE_PITCH + (TAPE_PITCH - TAPE_SIZE);
      font.addText(displayList, { text: tapeText, x: right, y, size: TAPE_SIZE, alignment: "right", intensity: Math.max(0.3, 0.8 - line * 0.12) });
    }

    this.rule.clear();
    this.rule.addSegment(PADDING, keysTop - 8, width - PADDING, keysTop - 8);
    displayList.addShape(this.rule, { ...SCREEN_SPACE_PLACEMENT, intensity: 0.5 });
  }

  private drawKeys(displayList: DisplayList): void {
    const font = getDemoFont();
    // One pass for each color, so each outline batch is drawn in its own.
    for (const style of Object.keys(COLORS) as KeyStyle[]) {
      displayList.setColor(COLORS[style]);
      for (const lit of [false, true]) {
        this.outlines.clear();
        for (const { key, rect } of this.layout.keys) {
          if (key.style !== style) continue;
          const isFlashed = key.id === this.flashed && this.flashSeconds > 0;
          const isLit = isFlashed || key.id === this.hovered;
          if (isLit !== lit) continue;
          this.addOutline(rect, 0);
          // A pressed key is drawn twice, the second outline just inside the first.
          if (isFlashed) this.addOutline(rect, 3);
          const label = key.id === "angle" ? this.model.angleMode : key.label;
          const size = Math.min(20, rect.height * 0.36, ((rect.width - 10) * 6) / (label.length * 6 - 2));
          font.addText(displayList, {
            text: label,
            x: rect.x + rect.width / 2,
            y: rect.y + (rect.height - size) / 2,
            size,
            alignment: "center",
            intensity: isLit ? 1.3 : 0.95,
          });
        }
        if (this.outlines.segmentCount > 0) displayList.addShape(this.outlines, { ...SCREEN_SPACE_PLACEMENT, intensity: lit ? 1.1 : 0.5 });
      }
    }
  }

  private addOutline(rect: Rect, inset: number): void {
    const left = rect.x + inset;
    const top = rect.y + inset;
    const right = rect.x + rect.width - inset;
    const bottom = rect.y + rect.height - inset;
    this.outlines.moveTo(left, top);
    this.outlines.lineTo(right, top);
    this.outlines.lineTo(right, bottom);
    this.outlines.lineTo(left, bottom);
    this.outlines.closePath();
  }
}

export function createCalculator(): OsApp {
  const calculator = new Calculator();
  return {
    demo: calculator,
    worldHeight: null,
    onKey: (key) => calculator.key(key),
    onPointer: (kind, x, y) => calculator.pointer(kind, x, y),
  };
}
