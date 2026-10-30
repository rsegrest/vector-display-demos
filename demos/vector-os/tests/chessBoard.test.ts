import { describe, expect, it } from "vitest";
import { DisplayList, FLOATS_PER_BEAM_SEGMENT } from "@vector-display/core";
import type { Seat } from "@vector-demos/table-games";
import { chess, type ChessState } from "../../../packages/table-games/src/games/chess.js";
import type { BoardContext } from "../src/apps/tableGames/boards/BoardContext.js";
import { drawChess } from "../src/apps/tableGames/boards/chessBoard.js";
import { Ui, type Rect } from "../src/apps/tableGames/Ui.js";

const AREA: Rect = { x: 120, y: 60, width: 520, height: 430 };
const random = () => 0.5;

function fromPosition(fen: string): ChessState {
  return { fen, history: [], lastMove: null, positions: [fen.split(" ").slice(0, 4).join(" ")], outcome: null };
}

function play(state: ChessState, ...moves: string[]): ChessState {
  return moves.reduce((each, move) => {
    const result = chess.play(each, chess.toMove(each)[0], { from: move.slice(0, 2), to: move.slice(2, 4) }, random);
    if (!result.ok) throw new Error(result.error);
    return result.state;
  }, state);
}

// One window's board: the real Ui, drawn afresh before every click as the window does.
class TestBoard {
  public readonly ui = new Ui();
  public readonly sent: unknown[] = [];
  public local: Record<string, unknown> = {};

  public constructor(
    public view: ChessState,
    public mySeat: Seat | null,
    public area: Rect = AREA,
  ) {}

  public draw(): { lines: DisplayList; text: DisplayList } {
    const lines = new DisplayList();
    this.ui.begin(lines);
    const context: BoardContext = {
      ui: this.ui,
      area: this.area,
      view: this.view,
      mySeat: this.mySeat,
      toMove: chess.toMove(this.view),
      names: ["White", "Black"],
      outcome: chess.outcome(this.view),
      send: (move) => this.sent.push(move),
      local: this.local,
      seconds: 0,
    };
    drawChess(context);
    this.ui.end();
    const text = new DisplayList();
    this.ui.drawText(text);
    return { lines, text };
  }

  public click(x: number, y: number): void {
    this.draw();
    this.ui.press(x, y);
  }
}

// Points across the area, close enough together to land in every square.
function gridOver(area: Rect, steps = 18): [number, number][] {
  const points: [number, number][] = [];
  for (let row = 0; row < steps; row++) {
    for (let column = 0; column < steps; column++) points.push([area.x + ((column + 0.5) * area.width) / steps, area.y + ((row + 0.5) * area.height) / steps]);
  }
  return points;
}

// Tries clicks from the board's starting memory, then from each memory a click leads to (a
// piece picked up, a promotion asked), up to `depth` clicks deep: every move sent on the way.
function explore(view: ChessState, mySeat: Seat, depth: number): unknown[] {
  const sent: unknown[] = [];
  const seen = new Set<string>();
  let frontier: Record<string, unknown>[] = [{}];
  for (let level = 0; level < depth; level++) {
    const next: Record<string, unknown>[] = [];
    for (const memory of frontier) {
      for (const [x, y] of gridOver(AREA)) {
        const board = new TestBoard(view, mySeat);
        board.local = structuredClone(memory);
        board.click(x, y);
        sent.push(...board.sent);
        const key = JSON.stringify(board.local);
        if (board.sent.length === 0 && !seen.has(key)) {
          seen.add(key);
          next.push(board.local);
        }
      }
    }
    frontier = next;
  }
  return sent;
}

function expectLegal(view: ChessState, seat: Seat, moves: readonly unknown[]): void {
  for (const move of moves) expect(chess.play(view, seat, move, random).ok, JSON.stringify(move)).toBe(true);
}

// Every line end and every stroke of text drawn, within `area` (a hair's tolerance).
function expectInside(area: Rect, ...lists: DisplayList[]): void {
  for (const list of lists) {
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
}

describe("Chess board", () => {
  it("picks up a piece with one click and moves it with another, sending only legal moves", () => {
    const start = chess.start(2, random);
    const sent = explore(start, 0, 2);
    expect(sent.length).toBeGreaterThan(0);
    expectLegal(start, 0, sent);
    // Every one of white's twenty opening moves can be made by clicking.
    const distinct = new Set(sent.map((move) => JSON.stringify(move)));
    expect(distinct.size).toBe(20);
  });

  it("puts black at the bottom for black, and lets black move", () => {
    const afterE4 = play(chess.start(2, random), "e2e4");
    const sent = explore(afterE4, 1, 2);
    expect(new Set(sent.map((move) => JSON.stringify(move))).size).toBe(20);
    expectLegal(afterE4, 1, sent);

    // A click in the bottom quarter picks up one of the viewer's own pieces.
    const lowPoints = gridOver(AREA).filter(([, y]) => y > AREA.y + AREA.height * 0.8);
    for (const seat of [0, 1] as const) {
      const view = seat === 0 ? chess.start(2, random) : afterE4;
      const picked = lowPoints.some(([x, y]) => {
        const board = new TestBoard(view, seat);
        board.click(x, y);
        return JSON.stringify(board.local).includes('"from":"');
      });
      expect(picked).toBe(true);
    }
  });

  it("asks what a promoting pawn becomes, with four buttons", () => {
    const view = fromPosition("8/4P3/8/8/8/8/k7/4K3 w - - 0 1");
    const sent = explore(view, 0, 3);
    expectLegal(view, 0, sent);
    const promotions = sent.filter((move) => (move as { from: string }).from === "e7").map((move) => (move as { promotion?: string }).promotion);
    expect(new Set(promotions)).toEqual(new Set(["q", "r", "b", "n"]));
  });

  it("lets a watcher, or the player not to move, click nothing", () => {
    const start = chess.start(2, random);
    for (const seat of [null, 1] as const) {
      const board = new TestBoard(start, seat);
      for (const [x, y] of gridOver(AREA)) board.click(x, y);
      expect(board.sent).toEqual([]);
    }
  });

  it("draws everything inside its area, at any size and in every state", () => {
    const checked = play(chess.start(2, random), "e2e4", "e7e5", "d1h5", "b8c6", "h5f7");
    const promoting = fromPosition("8/4P3/8/8/8/8/k7/4K3 w - - 0 1");
    const areas: Rect[] = [AREA, { x: 0, y: 0, width: 300, height: 700 }, { x: 40, y: 300, width: 900, height: 160 }, { x: 5, y: 5, width: 120, height: 120 }];
    for (const area of areas) {
      for (const view of [chess.start(2, random), checked]) {
        for (const seat of [0, 1, null] as const) {
          const board = new TestBoard(view, seat, area);
          const { lines, text } = board.draw();
          expect(lines.segmentCount).toBeGreaterThan(100);
          expect(text.segmentCount).toBeGreaterThan(0);
          expectInside(area, lines, text);
        }
      }
      // With the promotion box open: pick up the pawn, then click e8.
      const board = new TestBoard(promoting, 0, area);
      board.local = { chess: { fen: promoting.fen, from: "e7", promotingMove: { from: "e7", to: "e8" } } };
      const { lines, text } = board.draw();
      expectInside(area, lines, text);
    }
  });
});
