import { describe, expect, it } from "vitest";
import { DisplayList } from "@vector-display/core";
import type { DynamicGeometry } from "@vector-demos/demo-kit";
import { yahtzee, type YahtzeeState } from "../../../packages/table-games/src/games/yahtzee.js";
import type { BoardContext } from "../src/apps/tableGames/boards/BoardContext.js";
import { drawYahtzee } from "../src/apps/tableGames/boards/yahtzeeBoard.js";
import { Ui, type Rect } from "../src/apps/tableGames/Ui.js";

const AREA: Rect = { x: 40, y: 30, width: 560, height: 360 };

function seededRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

interface Drawn {
  readonly sent: unknown[];
  readonly points: [number, number][];
}

// Draws one frame of the board with a real Ui, keeping every line end and every text position.
function draw(ui: Ui, state: YahtzeeState, local: Record<string, unknown>, mySeat = 0): Drawn {
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
    view: yahtzee.viewFor(state, mySeat),
    mySeat,
    toMove: yahtzee.toMove(state),
    names: ["Alice", "Bob", "Carol"],
    outcome: yahtzee.outcome(state),
    send: (move) => sent.push(move),
    local,
    seconds: 0,
  };
  drawYahtzee(context);
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

// Every move a click somewhere on the board sends. A frame is drawn on a copy of the board's
// state and clicked until a click changes that state or sends a move; then a fresh copy is drawn.
function movesFromClicks(state: YahtzeeState, local: Record<string, unknown>): unknown[] {
  const ui = new Ui();
  const moves: unknown[] = [];
  let copy = structuredClone(local);
  let frame = draw(ui, state, copy);
  for (let y = AREA.y; y <= AREA.y + AREA.height; y += 6) {
    for (let x = AREA.x; x <= AREA.x + AREA.width; x += 6) {
      const before = JSON.stringify(copy);
      ui.press(x, y);
      if (frame.sent.length === 0 && JSON.stringify(copy) === before) continue;
      moves.push(...frame.sent);
      copy = structuredClone(local);
      frame = draw(ui, state, copy);
    }
  }
  return moves;
}

const distinct = (moves: unknown[]): unknown[] => [...new Map(moves.map((move) => [JSON.stringify(move), move])).values()];

describe("Yahtzee board", () => {
  it("stays inside its area", () => {
    const random = seededRandom(3);
    let state = yahtzee.start(3, random);
    state = { ...state, rollsLeft: 2, dice: [6, 5, 4, 3, 1] };
    const { points } = draw(new Ui(), state, {});
    expect(points.length).toBeGreaterThan(100);
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(AREA.x - 2);
      expect(x).toBeLessThanOrEqual(AREA.x + AREA.width + 2);
      expect(y).toBeGreaterThanOrEqual(AREA.y - 2);
      expect(y).toBeLessThanOrEqual(AREA.y + AREA.height + 2);
    }
  });

  it("rolls all five dice at the start of a turn, and nothing else", () => {
    const state = yahtzee.start(2, seededRandom(1));
    expect(distinct(movesFromClicks(state, {}))).toEqual([{ kind: "roll", keep: [false, false, false, false, false] }]);
    // Not this seat's turn: no clicks do anything.
    const ui = new Ui();
    draw(ui, state, {}, 1);
    for (let x = AREA.x; x < AREA.x + AREA.width; x += 10) ui.press(x, AREA.y + 10);
    expect(draw(ui, state, {}, 1).sent).toEqual([]);
  });

  it("keeps clicked dice for the next roll, and scores a clicked box", () => {
    const random = seededRandom(9);
    let state = yahtzee.start(2, random);
    const first = yahtzee.play(state, 0, { kind: "roll", keep: [false, false, false, false, false] }, random);
    if (!first.ok) throw new Error(first.error);
    state = { ...first.state, dice: [2, 2, 2, 5, 5] };
    const ui = new Ui();
    const local: Record<string, unknown> = {};
    draw(ui, state, local);
    // Find the first die: the first point near the top whose click changes what is kept.
    let found = false;
    for (let x = AREA.x; x < AREA.x + 60 && !found; x += 2) {
      const before = JSON.stringify(local);
      ui.press(x, AREA.y + 10);
      found = JSON.stringify(local) !== before;
      draw(ui, state, local);
    }
    expect(found).toBe(true);
    const moves = distinct(movesFromClicks(state, local));
    expect(moves).toContainEqual({ kind: "roll", keep: [true, false, false, false, false] });
    expect(moves).toContainEqual({ kind: "score", category: "fullHouse" });
    // Every move the board sends is one the rules take; all thirteen boxes are open.
    const scores = moves.filter((move) => (move as { kind: string }).kind === "score");
    expect(scores).toHaveLength(13);
    for (const move of moves) expect(yahtzee.play(state, 0, move, random).ok).toBe(true);
  });
});
