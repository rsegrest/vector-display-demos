import { describe, expect, it } from "vitest";
import { DisplayList } from "@vector-display/core";
import type { DynamicGeometry } from "@vector-demos/demo-kit";
import { boggle, type BoggleState } from "../../../packages/table-games/src/games/boggle.js";
import type { BoardContext } from "../src/apps/tableGames/boards/BoardContext.js";
import { boggleGridRect, drawBoggle } from "../src/apps/tableGames/boards/boggleBoard.js";
import { Ui, type Rect } from "../src/apps/tableGames/Ui.js";

const AREA: Rect = { x: 40, y: 30, width: 560, height: 340 };

// A grid where "stone" runs along the top and down, and "quiet" starts at the Qu.
const GRID = [
  ["S", "T", "O", "X"],
  ["Z", "E", "N", "X"],
  ["Qu", "I", "T", "X"],
  ["X", "X", "X", "X"],
];

function tableOf(players: number): BoggleState {
  return { ...boggle.start(players, () => 0.5), grid: GRID };
}

interface Frame {
  readonly sent: unknown[];
  readonly points: [number, number][];
}

// One frame of the board with a real Ui, keeping every line end and every text position.
function draw(ui: Ui, state: BoggleState, local: Record<string, unknown>, seconds = 0, mySeat = 0): Frame {
  const sent: unknown[] = [];
  const points: [number, number][] = [];
  const pens = new Set<DynamicGeometry>();
  const originalPen = ui.pen.bind(ui);
  const originalText = ui.text.bind(ui);
  ui.pen = (color, intensity) => {
    const geometry = originalPen(color, intensity);
    pens.add(geometry);
    return geometry;
  };
  ui.text = (color, text, x, y, size, alignment = "left", intensity) => {
    const width = ui.textWidth(text, size);
    const left = alignment === "left" ? x : alignment === "center" ? x - width / 2 : x - width;
    points.push([left, y], [left + width, y + size]);
    originalText(color, text, x, y, size, alignment, intensity);
  };
  ui.begin(new DisplayList());
  const context: BoardContext = {
    ui,
    area: AREA,
    view: boggle.viewFor(state, mySeat),
    mySeat,
    toMove: boggle.toMove(state),
    names: ["Alice", "Bob", "Carol"],
    outcome: boggle.outcome(state),
    send: (move) => sent.push(move),
    local,
    seconds,
  };
  drawBoggle(context);
  for (const geometry of pens) {
    for (let segment = 0; segment < geometry.segmentCount; segment++) {
      const at = geometry.segmentCoordinates.subarray(segment * 4, segment * 4 + 4);
      points.push([at[0], at[1]], [at[2], at[3]]);
    }
  }
  ui.end();
  ui.pen = originalPen;
  ui.text = originalText;
  return { sent, points };
}

function cellCenter(row: number, column: number): [number, number] {
  const grid = boggleGridRect(AREA);
  const cell = grid.width / 4;
  return [grid.x + (column + 0.5) * cell, grid.y + (row + 0.5) * cell];
}

// Clicks the dice in order, redrawing between clicks, and returns what was sent. A click's
// move is sent through the frame it was drawn in.
function trace(ui: Ui, state: BoggleState, local: Record<string, unknown>, cells: [number, number][]): unknown[] {
  const sent: unknown[] = [];
  let frame = draw(ui, state, local);
  for (const [row, column] of cells) {
    ui.press(...cellCenter(row, column));
    sent.push(...frame.sent);
    frame = draw(ui, state, local);
  }
  return [...sent, ...frame.sent];
}

// Presses the button labeled `label`, found by scanning the panel beside the grid (each try on
// a copy of the board's state), and returns what it sent.
function pressButton(ui: Ui, state: BoggleState, local: Record<string, unknown>, label: string): unknown[] {
  const grid = boggleGridRect(AREA);
  const originalButton = ui.button.bind(ui);
  try {
    let pressedLabel: string | null = null;
    ui.button = (color, rect, text, onPress, size) => originalButton(color, rect, text, () => ((pressedLabel = text), onPress()), size);
    let copy = structuredClone(local);
    let frame = draw(ui, state, copy);
    for (let y = AREA.y; y < AREA.y + 120; y += 3) {
      for (let x = grid.x + grid.width; x < AREA.x + AREA.width; x += 3) {
        pressedLabel = null;
        ui.press(x, y);
        if (pressedLabel === label) {
          Object.assign(local, copy);
          return frame.sent;
        }
        if (pressedLabel !== null) {
          copy = structuredClone(local);
          frame = draw(ui, state, copy);
        }
      }
    }
  } finally {
    ui.button = originalButton;
  }
  throw new Error(`no ${label} button`);
}

describe("Boggle board", () => {
  it("sends a traced word when its last letter is clicked again", () => {
    const ui = new Ui();
    const local: Record<string, unknown> = {};
    const state = tableOf(2);
    const sent = trace(ui, state, local, [[0, 0], [0, 1], [0, 2], [1, 2], [1, 1], [1, 1]]);
    expect(sent).toEqual([{ kind: "word", word: "stone" }]);
    expect(boggle.play(state, 0, sent[0], Math.random).ok).toBe(true);
  });

  it("reads Qu as two letters, skips dice that are not neighbors, and backs up to an earlier die", () => {
    const ui = new Ui();
    const local: Record<string, unknown> = {};
    const state = tableOf(2);
    // O is not next to S, nor Qu next to O, so each starts the word again; X is not next to E.
    expect(trace(ui, state, local, [[0, 0], [0, 2], [2, 0], [2, 1], [1, 1], [3, 3]])).toEqual([]);
    expect((local.boggle as { path: unknown[] }).path).toEqual([[3, 3]]);
    const sent = trace(ui, state, local, [[2, 0], [2, 1], [1, 1], [0, 0], [1, 1], [0, 1], [0, 1]]);
    // Clicking E again went back to it, dropping S: Qu I E T.
    expect(sent).toEqual([{ kind: "word", word: "quiet" }]);
  });

  it("has Submit, Clear and Done buttons", () => {
    const ui = new Ui();
    const local: Record<string, unknown> = {};
    const state = tableOf(2);
    trace(ui, state, local, [[0, 1], [0, 2], [1, 2]]);
    expect(pressButton(ui, state, local, "Submit")).toEqual([{ kind: "word", word: "ton" }]);
    trace(ui, state, local, [[0, 1], [0, 2]]);
    pressButton(ui, state, local, "Clear");
    expect((local.boggle as { path: unknown[] }).path).toEqual([]);
    expect(pressButton(ui, state, local, "Done")).toEqual([{ kind: "done" }]);
  });

  it("sends done by itself when the three minutes run out", () => {
    const ui = new Ui();
    const local: Record<string, unknown> = {};
    const state = tableOf(2);
    expect(draw(ui, state, local, 5).sent).toEqual([]);
    expect(draw(ui, state, local, 184).sent).toEqual([]);
    expect(draw(ui, state, local, 185).sent).toEqual([{ kind: "done" }]);
    expect(draw(ui, state, local, 186).sent).toEqual([]);
  });

  it("stays inside its area, during the game and after it", () => {
    let state = tableOf(3);
    for (const [seat, word] of [[0, "stone"], [0, "quiet"], [1, "stone"], [2, "note"]] as const) {
      const result = boggle.play(state, seat, { kind: "word", word }, Math.random);
      if (!result.ok) throw new Error(result.error);
      state = result.state;
    }
    const ended = [0, 1, 2].reduce((current, seat) => {
      const result = boggle.play(current, seat, { kind: "done" }, Math.random);
      if (!result.ok) throw new Error(result.error);
      return result.state;
    }, state);
    for (const each of [state, ended]) {
      const { points } = draw(new Ui(), each, {});
      expect(points.length).toBeGreaterThan(50);
      for (const [x, y] of points) {
        expect(x).toBeGreaterThanOrEqual(AREA.x - 2);
        expect(x).toBeLessThanOrEqual(AREA.x + AREA.width + 2);
        expect(y).toBeGreaterThanOrEqual(AREA.y - 2);
        expect(y).toBeLessThanOrEqual(AREA.y + AREA.height + 2);
      }
    }
  });
});
