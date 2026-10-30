import { describe, expect, it } from "vitest";
import { DisplayList } from "@vector-display/core";
import { poker, type PokerState } from "../../../packages/table-games/src/games/poker.js";
import type { BoardContext } from "../src/apps/tableGames/boards/BoardContext.js";
import { drawPoker } from "../src/apps/tableGames/boards/pokerBoard.js";
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

function contextFor(ui: Ui, state: PokerState, seat: number | null, sent: unknown[], local: Record<string, unknown> = {}): BoardContext {
  return {
    ui,
    area: AREA,
    view: poker.viewFor(state, seat),
    mySeat: seat,
    toMove: poker.toMove(state),
    names: NAMES.slice(0, state.players.length),
    outcome: poker.outcome(state),
    send: (move) => sent.push(move),
    local,
    seconds: 0,
  };
}

function drawFrame(ui: Ui, context: BoardContext): void {
  ui.begin(new DisplayList());
  drawPoker(context);
  ui.end();
}

// Every line and every line of text the frame drew stays inside the board's area.
function expectInsideArea(ui: Ui): void {
  const internals = ui as unknown as { batches: Map<string, { geometry: { segmentCount: number; segmentCoordinates: Float32Array } }>; texts: { y: number; size: number }[] };
  for (const { geometry } of internals.batches.values()) {
    for (let index = 0; index < geometry.segmentCount * 4; index += 2) {
      const [x, y] = [geometry.segmentCoordinates[index], geometry.segmentCoordinates[index + 1]];
      expect(x).toBeGreaterThanOrEqual(AREA.x - 1);
      expect(x).toBeLessThanOrEqual(AREA.x + AREA.width + 1);
      expect(y).toBeGreaterThanOrEqual(AREA.y - 1);
      expect(y).toBeLessThanOrEqual(AREA.y + AREA.height + 1);
    }
  }
  for (const text of internals.texts) {
    expect(text.y).toBeGreaterThanOrEqual(AREA.y);
    expect(text.y + text.size).toBeLessThanOrEqual(AREA.y + AREA.height);
  }
}

// Clicks across the bottom of the board, where the actions are, redrawing before each click.
function pressEverywhere(ui: Ui, makeContext: () => BoardContext): void {
  for (let y = AREA.y + AREA.height - 90; y < AREA.y + AREA.height; y += 4) {
    for (let x = AREA.x; x < AREA.x + AREA.width; x += 4) {
      drawFrame(ui, makeContext());
      ui.press(x, y);
    }
  }
}

describe("the poker board", () => {
  it("draws a full table of six inside its area", () => {
    const random = seededRandom(2);
    let state = poker.start(6, random);
    // A few moves in, so there are bets, a folded seat and a settled hand to show.
    for (let move = 0; move < 12; move++) {
      const seat = poker.toMove(state)[0];
      const choice = poker.simpleStrategy!(poker.viewFor(state, seat), seat, poker.choices(state, seat), random);
      const result = poker.play(state, seat, choice.move, random);
      if (result.ok) state = result.state;
    }
    const ui = new Ui();
    drawFrame(ui, contextFor(ui, state, poker.toMove(state)[0], []));
    expectInsideArea(ui);
    drawFrame(ui, contextFor(ui, state, null, []));
    expectInsideArea(ui);
  });

  it("sends only legal moves from its buttons, including every preset raise", () => {
    const state = poker.start(3, seededRandom(4));
    const seat = poker.toMove(state)[0];
    const ui = new Ui();
    const sent: unknown[] = [];
    const local = {};
    pressEverywhere(ui, () => contextFor(ui, state, seat, sent, local));
    expect(sent.length).toBeGreaterThan(0);
    for (const move of sent) expect(poker.play(state, seat, move, seededRandom(1)).ok, JSON.stringify(move)).toBe(true);
    const kinds = new Set(sent.map((move) => JSON.stringify(move)));
    expect(kinds).toContain(JSON.stringify({ kind: "fold" }));
    expect(kinds).toContain(JSON.stringify({ kind: "call" }));
    expect(kinds).toContain(JSON.stringify({ kind: "raise", to: 20 }));
    expect(kinds).toContain(JSON.stringify({ kind: "raise", to: 35 }));
    expect(kinds).toContain(JSON.stringify({ kind: "raise", to: 1000 }));
    // The stepped raise moved off the smallest raise as + was pressed.
    const presets = [20, 35, 1000].map((to) => JSON.stringify({ kind: "raise", to }));
    expect([...kinds].some((move) => move.includes('"raise"') && !presets.includes(move))).toBe(true);
  });

  it("offers no actions to a player waiting their turn, or to someone watching", () => {
    const state = poker.start(3, seededRandom(4));
    const ui = new Ui();
    const sent: unknown[] = [];
    pressEverywhere(ui, () => contextFor(ui, state, 1, sent));
    pressEverywhere(ui, () => contextFor(ui, state, null, sent));
    expect(sent).toEqual([]);
  });
});
