import { describe, expect, it } from "vitest";
import { DisplayList } from "@vector-display/core";
import { BASIC_KEYS, Calculator, SCIENTIFIC_KEYS, SCIENTIFIC_MINIMUM_WIDTH, layoutCalculator } from "../src/apps/calculator/Calculator.js";
import { CalculatorModel, MAXIMUM_TAPE_LINES } from "../src/apps/calculator/CalculatorModel.js";
import { CalculatorError, evaluate, formatNumber } from "../src/apps/calculator/expression.js";

const DEGREES = { angleMode: "DEG", ans: 0 } as const;
const RADIANS = { angleMode: "RAD", ans: 0 } as const;

describe("evaluate", () => {
  it.each([
    ["1+2*3", 7],
    ["(1+2)*3", 9],
    ["10-4-3", 3],
    ["2^3^2", 512],
    ["-2^2", -4],
    ["2^-1", 0.5],
    ["8/4/2", 1],
    ["5!", 120],
    ["0!", 1],
    ["50%", 0.5],
    ["200*15%", 30],
    ["2pi", 2 * Math.PI],
    ["3(4+1)", 15],
    ["(2)(3)", 6],
    ["2sqrt(16)", 8],
    ["sqrt(2)^2", 2],
    ["abs(-3.5)", 3.5],
    ["log(1000)", 3],
    ["ln(e)", 1],
    ["exp(0)", 1],
    [".5+.25", 0.75],
    ["  7 ", 7],
  ])("%s", (expression, expected) => {
    expect(evaluate(expression, DEGREES)).toBeCloseTo(expected, 10);
  });

  it("works in degrees or radians", () => {
    expect(evaluate("sin(30)", DEGREES)).toBeCloseTo(0.5, 12);
    expect(evaluate("sin(pi/6)", RADIANS)).toBeCloseTo(0.5, 12);
    expect(evaluate("atan(1)", DEGREES)).toBeCloseTo(45, 10);
    expect(evaluate("acos(0)", RADIANS)).toBeCloseTo(Math.PI / 2, 12);
  });

  it("gives exactly zero where rounding would leave a speck", () => {
    expect(evaluate("sin(180)", DEGREES)).toBe(0);
    expect(evaluate("cos(90)", DEGREES)).toBe(0);
    expect(evaluate("sin(pi)", RADIANS)).toBe(0);
  });

  it("uses the last result for ans", () => {
    expect(evaluate("ans*2", { angleMode: "DEG", ans: 21 })).toBe(42);
    expect(evaluate("2ans", { angleMode: "DEG", ans: 21 })).toBe(42);
  });

  it.each([
    ["1/0", "DIVIDE BY ZERO"],
    ["tan(90)", "DIVIDE BY ZERO"],
    ["sqrt(-1)", "NOT A NUMBER"],
    ["asin(2)", "NOT A NUMBER"],
    ["2.5!", "NOT A NUMBER"],
    ["171!", "OUT OF RANGE"],
    ["10^400", "OUT OF RANGE"],
    ["ln(0)", "OUT OF RANGE"],
    ["1+", "SYNTAX ERROR"],
    ["(1+2", "SYNTAX ERROR"],
    ["1+2)", "SYNTAX ERROR"],
    ["sin 30", "SYNTAX ERROR"],
    ["foo(1)", "SYNTAX ERROR"],
    ["2 $ 3", "SYNTAX ERROR"],
    ["", "SYNTAX ERROR"],
  ])("%s is refused: %s", (expression, message) => {
    expect(() => evaluate(expression, DEGREES)).toThrow(new CalculatorError(message));
  });
});

describe("formatNumber", () => {
  it.each([
    [0, "0"],
    [0.1 + 0.2, "0.3"],
    [1 / 3, "0.3333333333"],
    [-12.5, "-12.5"],
    [1234567890, "1234567890"],
    [12345678901, "1.234568E10"],
    [1e21, "1E21"],
    [0.000001, "0.000001"],
    [0.00000012, "1.2E-7"],
  ])("%s", (value, text) => {
    expect(formatNumber(value)).toBe(text);
  });
});

function typed(keys: string, model = new CalculatorModel()): CalculatorModel {
  for (const key of keys.split(" ")) expect(model.type(key), key).toBe(true);
  return model;
}

describe("CalculatorModel", () => {
  it("shows zero, then what is typed, then the result", () => {
    const model = new CalculatorModel();
    expect(model.display).toBe("0");
    typed("1 2 + 3 * 4", model);
    expect(model.display).toBe("12+3×4");
    typed("Enter", model);
    expect(model.display).toBe("24");
    expect(model.tape).toEqual([{ expression: "12+3×4", result: "24" }]);
  });

  it("carries on from a result with an operator, and starts afresh with a digit", () => {
    const model = typed("6 * 7 = + 8");
    expect(model.display).toBe("ANS+8");
    typed("=", model);
    expect(model.display).toBe("50");
    typed("9", model);
    expect(model.display).toBe("9");
  });

  it("closes parentheses left open", () => {
    const model = typed("2 * ( 3 + 4 =");
    expect(model.display).toBe("14");
    expect(model.tape[0].expression).toBe("2×(3+4)");
  });

  it("keeps pi and e apart", () => {
    const model = typed("p e =");
    expect(Number(model.display)).toBeCloseTo(Math.PI * Math.E, 8);
    expect(model.tape[0].expression).toBe("πE");
  });

  it("deletes a whole function at once", () => {
    const model = typed("2 s 3");
    expect(model.display).toBe("2SIN(3");
    typed("Backspace Backspace", model);
    expect(model.display).toBe("2");
  });

  it("shows a mistake and keeps the entry so it can be put right", () => {
    const model = typed("5 / 0 =");
    expect(model.display).toBe("DIVIDE BY ZERO");
    expect(model.tape).toHaveLength(0);
    typed("Backspace", model);
    expect(model.display).toBe("5÷");
    typed("2 =", model);
    expect(model.display).toBe("2.5");
  });

  it("clears the entry first and the tape on the next press", () => {
    const model = typed("1 + 1 = 7");
    model.press({ kind: "clear" });
    expect(model.display).toBe("0");
    expect(model.tape).toHaveLength(1);
    model.press({ kind: "clear" });
    expect(model.tape).toHaveLength(0);
  });

  it("squares, takes reciprocals and switches between degrees and radians", () => {
    const model = typed("1 2");
    model.press({ kind: "square" });
    typed("=", model);
    expect(model.display).toBe("144");
    model.press({ kind: "reciprocal" });
    expect(model.display).toBe("1÷ANS");
    typed("=", model);
    expect(Number(model.display)).toBeCloseTo(1 / 144, 10);
    typed("3 + 1", model);
    model.press({ kind: "reciprocal" });
    typed("=", model);
    expect(model.display).toBe("0.25");
    typed("d s p =", model);
    expect(model.angleMode).toBe("RAD");
    expect(model.display).toBe("0");
  });

  it("ignores keys it has no use for", () => {
    const model = new CalculatorModel();
    expect(model.type("q")).toBe(false);
    expect(model.type("ArrowUp")).toBe(false);
    expect(model.display).toBe("0");
  });

  it("keeps only the most recent tape lines", () => {
    const model = new CalculatorModel();
    for (let sum = 0; sum < MAXIMUM_TAPE_LINES + 5; sum++) typed("1 + 1 =", model);
    expect(model.tape).toHaveLength(MAXIMUM_TAPE_LINES);
  });
});

describe("Calculator", () => {
  it("shows the scientific keys only when the window is wide enough", () => {
    expect(layoutCalculator(SCIENTIFIC_MINIMUM_WIDTH - 1, 400).keys).toHaveLength(BASIC_KEYS.flat().length);
    expect(layoutCalculator(SCIENTIFIC_MINIMUM_WIDTH, 400).keys).toHaveLength(BASIC_KEYS.flat().length + SCIENTIFIC_KEYS.flat().length);
  });

  it.each([[260, 300], [500, 430], [900, 700]])("fits its keys inside a %i by %i window without overlap", (width, height) => {
    const { keys, keysTop } = layoutCalculator(width, height);
    keys.forEach(({ rect }, index) => {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(keysTop);
      expect(rect.x + rect.width).toBeLessThanOrEqual(width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(height);
      for (const other of keys.slice(index + 1)) {
        const apart = rect.x + rect.width <= other.rect.x || other.rect.x + other.rect.width <= rect.x || rect.y + rect.height <= other.rect.y || other.rect.y + other.rect.height <= rect.y;
        expect(apart).toBe(true);
      }
    });
  });

  it("is worked by clicking its keys, wherever they are", () => {
    for (const [width, height] of [[300, 320], [640, 520]]) {
      const calculator = new Calculator();
      calculator.draw(new DisplayList(), { width, height, seconds: 0 });
      const click = (id: string): void => {
        const hit = layoutCalculator(width, height).keys.find(({ key }) => key.id === id);
        if (!hit) throw new Error(`no key ${id}`);
        calculator.pointer("hover", hit.rect.x + 2, hit.rect.y + 2);
        calculator.pointer("down", hit.rect.x + hit.rect.width / 2, hit.rect.y + hit.rect.height / 2);
        calculator.pointer("up", hit.rect.x + hit.rect.width / 2, hit.rect.y + hit.rect.height / 2);
      };
      for (const id of ["7", "*", "(", "2", "+", "4", ")", "equals"]) click(id);
      expect(calculator.model.display).toBe("42");
      // Hovering and clicking between the keys does nothing.
      calculator.pointer("down", 1, 1);
      expect(calculator.model.display).toBe("42");
    }
  });

  it("draws every key with a label the font can draw", () => {
    const calculator = new Calculator();
    const bare = new DisplayList();
    calculator.draw(bare, { width: 600, height: 480, seconds: 0 });
    // Forty outlines of four strokes, plus labels, the display and the rule.
    expect(bare.segmentCount).toBeGreaterThan(40 * 4 + 40);
    calculator.key("9");
    calculator.key("Enter");
    const withTape = new DisplayList();
    calculator.draw(withTape, { width: 600, height: 480, seconds: 0 });
    expect(withTape.segmentCount).toBeGreaterThan(bare.segmentCount);
  });
});
