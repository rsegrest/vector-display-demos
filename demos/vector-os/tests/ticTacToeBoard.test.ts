import { describe, expect, it } from "vitest";
import { DisplayList, FLOATS_PER_BEAM_SEGMENT } from "@vector-display/core";
import type { Seat } from "@vector-demos/table-games";
import { ticTacToe, type TicTacToeState } from "../../../packages/table-games/src/games/ticTacToe.js";
import type { BoardContext } from "../src/apps/tableGames/boards/BoardContext.js";
import { drawTicTacToe } from "../src/apps/tableGames/boards/ticTacToeBoard.js";
import { Ui, type Rect } from "../src/apps/tableGames/Ui.js";

const AREA: Rect = { x: 100, y: 40, width: 420, height: 300 };
const random = () => 0.5;

function marked(cells: readonly number[]): TicTacToeState {
  return cells.reduce((state, cell) => {
    const result = ticTacToe.play(state, state.turn, { cell }, random);
    if (!result.ok) throw new Error(result.error);
    return result.state;
  }, ticTacToe.start(2, random));
}

// Draws the board with the real Ui, as the window does each frame; returns what was sent by
// a click at (x, y) made after drawing, and the lines drawn.
function drawAndClick(view: TicTacToeState, mySeat: Seat | null, area: Rect, click?: [number, number]): { sent: unknown[]; lines: DisplayList } {
  const ui = new Ui();
  const sent: unknown[] = [];
  const lines = new DisplayList();
  ui.begin(lines);
  const context: BoardContext = {
    ui,
    area,
    view,
    mySeat,
    toMove: ticTacToe.toMove(view),
    names: ["X", "O"],
    outcome: ticTacToe.outcome(view),
    send: (move) => sent.push(move),
    local: {},
    seconds: 0,
  };
  drawTicTacToe(context);
  ui.end();
  if (click) ui.press(...click);
  return { sent, lines };
}

function gridOver(area: Rect, steps = 15): [number, number][] {
  const points: [number, number][] = [];
  for (let row = 0; row < steps; row++) {
    for (let column = 0; column < steps; column++) points.push([area.x + ((column + 0.5) * area.width) / steps, area.y + ((row + 0.5) * area.height) / steps]);
  }
  return points;
}

function expectInside(area: Rect, list: DisplayList): void {
  const data = list.getSegmentData();
  for (let offset = 0; offset < list.segmentCount * FLOATS_PER_BEAM_SEGMENT; offset += FLOATS_PER_BEAM_SEGMENT) {
    for (const [x, y] of [
      [data[offset], data[offset + 1]],
      [data[offset + 2], data[offset + 3]],
    ]) {
      expect(x).toBeGreaterThanOrEqual(area.x - 0.5);
      expect(x).toBeLessThanOrEqual(area.x + area.width + 0.5);
      expect(y).toBeGreaterThanOrEqual(area.y - 0.5);
      expect(y).toBeLessThanOrEqual(area.y + area.height + 0.5);
    }
  }
}

describe("Tic-tac-toe board", () => {
  it("sends a legal move for a click on any empty cell, and can reach all of them", () => {
    const view = marked([4, 0]);
    const sent = gridOver(AREA).flatMap((point) => drawAndClick(view, 0, AREA, point).sent);
    expect(sent.length).toBeGreaterThan(0);
    for (const move of sent) expect(ticTacToe.play(view, 0, move, random).ok).toBe(true);
    expect(new Set(sent.map((move) => JSON.stringify(move))).size).toBe(7);
  });

  it("lets a watcher, the player not to move, or anyone after the end, click nothing", () => {
    const start = ticTacToe.start(2, random);
    const won = marked([0, 3, 1, 4, 2]);
    for (const [view, seat] of [
      [start, null],
      [start, 1],
      [won, 1],
    ] as const) {
      expect(gridOver(AREA).flatMap((point) => drawAndClick(view, seat, AREA, point).sent)).toEqual([]);
    }
  });

  it("draws the grid, the marks and the winning line inside its area at any size", () => {
    const won = marked([0, 3, 1, 4, 2]);
    const draw = marked([0, 1, 2, 4, 3, 5, 7, 6, 8]);
    for (const area of [AREA, { x: 0, y: 0, width: 90, height: 400 }, { x: 300, y: 200, width: 800, height: 120 }]) {
      for (const view of [ticTacToe.start(2, random), won, draw]) {
        const { lines } = drawAndClick(view, 0, area);
        expect(lines.segmentCount).toBeGreaterThanOrEqual(4);
        expectInside(area, lines);
      }
    }
    // The winning line adds a segment to the marks and grid.
    const before = drawAndClick(marked([0, 3, 1, 4]), 0, AREA).lines.segmentCount;
    expect(drawAndClick(won, 0, AREA).lines.segmentCount).toBeGreaterThan(before);
  });
});
