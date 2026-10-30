import { describe, expect, it } from "vitest";
import { DisplayList } from "@vector-display/core";
import { baccarat, type BaccaratState } from "../../../packages/table-games/src/games/baccarat.js";
import type { BoardContext } from "../src/apps/tableGames/boards/BoardContext.js";
import { drawBaccarat } from "../src/apps/tableGames/boards/baccaratBoard.js";
import { Ui, type Rect } from "../src/apps/tableGames/Ui.js";

function seededRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

const AREA: Rect = { x: 20, y: 90, width: 600, height: 420 };
const NAMES = ["Ann", "Bob", "Cy", "Dee", "Eve", "Flo"];

function contextFor(ui: Ui, state: BaccaratState, seat: number | null, sent: unknown[], local: Record<string, unknown> = {}): BoardContext {
  return {
    ui,
    area: AREA,
    view: baccarat.viewFor(state, seat),
    mySeat: seat,
    toMove: baccarat.toMove(state),
    names: NAMES.slice(0, state.seats.length),
    outcome: baccarat.outcome(state),
    send: (move) => sent.push(move),
    local,
    seconds: 0,
  };
}

function drawFrame(ui: Ui, context: BoardContext): void {
  ui.begin(new DisplayList());
  drawBaccarat(context);
  ui.end();
}

// Every line and every line of text the frame drew stays inside the board's area.
function expectInsideArea(ui: Ui): void {
  const internals = ui as unknown as { batches: Map<string, { geometry: { segmentCount: number; segmentCoordinates: Float32Array } }>; texts: { y: number; size: number }[] };
  for (const { geometry } of internals.batches.values()) {
    for (let index = 0; index < geometry.segmentCount * 4; index += 2) {
      expect(geometry.segmentCoordinates[index]).toBeGreaterThanOrEqual(AREA.x - 1);
      expect(geometry.segmentCoordinates[index]).toBeLessThanOrEqual(AREA.x + AREA.width + 1);
      expect(geometry.segmentCoordinates[index + 1]).toBeGreaterThanOrEqual(AREA.y - 1);
      expect(geometry.segmentCoordinates[index + 1]).toBeLessThanOrEqual(AREA.y + AREA.height + 1);
    }
  }
  for (const text of internals.texts) {
    expect(text.y).toBeGreaterThanOrEqual(AREA.y);
    expect(text.y + text.size).toBeLessThanOrEqual(AREA.y + AREA.height);
  }
}

// Clicks across the bottom of the board, where the bets are, redrawing before each click.
function pressEverywhere(ui: Ui, makeContext: () => BoardContext): void {
  for (let y = AREA.y + AREA.height - 90; y < AREA.y + AREA.height; y += 4) {
    for (let x = AREA.x; x < AREA.x + AREA.width; x += 4) {
      drawFrame(ui, makeContext());
      ui.press(x, y);
    }
  }
}

// A table of `count` that has played one coup, everyone betting 25 on the banker.
function afterOneCoup(count: number): BaccaratState {
  const random = seededRandom(6);
  let state = baccarat.start(count, random);
  for (let seat = 0; seat < count; seat++) {
    const result = baccarat.play(state, seat, { kind: "bet", on: "banker", amount: 25 }, random);
    if (result.ok) state = result.state;
  }
  return state;
}

describe("the baccarat board", () => {
  it("draws six seats and the last coup inside its area", () => {
    const ui = new Ui();
    const state = afterOneCoup(6);
    expect(state.lastCoup).not.toBeNull();
    drawFrame(ui, contextFor(ui, state, 0, []));
    expectInsideArea(ui);
    drawFrame(ui, contextFor(ui, state, null, []));
    expectInsideArea(ui);
  });

  it("sends legal bets on every side, the side chosen first", () => {
    const ui = new Ui();
    const state = afterOneCoup(3);
    // Pressing across the side buttons chooses each in turn, the last (tie) last.
    const local: Record<string, unknown> = {};
    const sent: unknown[] = [];
    pressEverywhere(ui, () => contextFor(ui, state, 1, sent, local));
    expect(local.baccarat).toEqual({ side: "tie" });
    // With each side held chosen, the amount buttons bet on it.
    for (const side of ["player", "banker", "tie"]) {
      const held = { baccarat: { get side() { return side; }, set side(_: string) {} } };
      pressEverywhere(ui, () => contextFor(ui, state, 1, sent, held));
    }
    for (const move of sent) expect(baccarat.play(state, 1, move, seededRandom(1)).ok, JSON.stringify(move)).toBe(true);
    const sides = new Set(sent.map((move) => (move as { on: string }).on));
    expect([...sides].sort()).toEqual(["banker", "player", "tie"]);
    expect(sent).toContainEqual({ kind: "bet", on: "banker", amount: 10 });
    expect(sent).toContainEqual({ kind: "bet", on: "player", amount: 250 });
  });

  it("offers nothing to someone watching or whose bet is in", () => {
    const ui = new Ui();
    let state = baccarat.start(2, seededRandom(2));
    const placed = baccarat.play(state, 0, { kind: "bet", on: "player", amount: 50 }, seededRandom(2));
    if (placed.ok) state = placed.state;
    const sent: unknown[] = [];
    pressEverywhere(ui, () => contextFor(ui, state, 0, sent));
    pressEverywhere(ui, () => contextFor(ui, state, null, sent));
    expect(sent).toEqual([]);
  });
});
