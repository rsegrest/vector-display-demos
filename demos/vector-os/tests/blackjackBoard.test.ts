import { describe, expect, it } from "vitest";
import { DisplayList } from "@vector-display/core";
import { blackjack, type BlackjackState } from "../../../packages/table-games/src/games/blackjack.js";
import type { BoardContext } from "../src/apps/tableGames/boards/BoardContext.js";
import { drawBlackjack } from "../src/apps/tableGames/boards/blackjackBoard.js";
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

function contextFor(ui: Ui, state: BlackjackState, seat: number | null, sent: unknown[]): BoardContext {
  return {
    ui,
    area: AREA,
    view: blackjack.viewFor(state, seat),
    mySeat: seat,
    toMove: blackjack.toMove(state),
    names: NAMES.slice(0, state.players.length),
    outcome: blackjack.outcome(state),
    send: (move) => sent.push(move),
    local: {},
    seconds: 0,
  };
}

function drawFrame(ui: Ui, context: BoardContext): void {
  ui.begin(new DisplayList());
  drawBlackjack(context);
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

// Clicks across the bottom of the board, where the actions are, redrawing before each click.
function pressEverywhere(ui: Ui, makeContext: () => BoardContext): void {
  for (let y = AREA.y + AREA.height - 90; y < AREA.y + AREA.height; y += 4) {
    for (let x = AREA.x; x < AREA.x + AREA.width; x += 4) {
      drawFrame(ui, makeContext());
      ui.press(x, y);
    }
  }
}

// A table of `count` where everyone has bet and seat 0's hand is being played (no blackjacks).
function playingTable(count: number): BlackjackState {
  for (let seed = 1; ; seed++) {
    const random = seededRandom(seed);
    let state = blackjack.start(count, random);
    for (let seat = 0; seat < count; seat++) {
      const result = blackjack.play(state, seat, { kind: "bet", amount: 50 }, random);
      if (result.ok) state = result.state;
    }
    if (state.phase === "playing" && state.turn === 0) return state;
  }
}

describe("the blackjack board", () => {
  it("draws six seats inside its area, betting and playing", () => {
    const ui = new Ui();
    const playing = playingTable(6);
    drawFrame(ui, contextFor(ui, playing, 0, []));
    expectInsideArea(ui);
    drawFrame(ui, contextFor(ui, blackjack.start(6, seededRandom(3)), 2, []));
    expectInsideArea(ui);
  });

  it("does not draw the dealer's hole card while the players play", () => {
    const state = playingTable(2);
    const view = contextFor(new Ui(), state, 0, []).view as { dealerCards: unknown[] };
    expect(view.dealerCards[1]).toBeNull();
  });

  it("sends legal bets while betting, and hit, stand or double while playing", () => {
    const ui = new Ui();
    const betting = blackjack.start(2, seededRandom(5));
    const bets: unknown[] = [];
    pressEverywhere(ui, () => contextFor(ui, betting, 1, bets));
    expect(bets).toContainEqual({ kind: "bet", amount: 10 });
    expect(bets).toContainEqual({ kind: "bet", amount: 250 });
    for (const move of bets) expect(blackjack.play(betting, 1, move, seededRandom(1)).ok).toBe(true);

    const playing = playingTable(3);
    const moves: unknown[] = [];
    pressEverywhere(ui, () => contextFor(ui, playing, 0, moves));
    expect(moves).toContainEqual({ kind: "hit" });
    expect(moves).toContainEqual({ kind: "stand" });
    expect(moves).toContainEqual({ kind: "double" });
    for (const move of moves) expect(blackjack.play(playing, 0, move, seededRandom(1)).ok).toBe(true);
  });

  it("offers nothing to a player waiting their turn, or to someone watching", () => {
    const ui = new Ui();
    const playing = playingTable(3);
    const sent: unknown[] = [];
    pressEverywhere(ui, () => contextFor(ui, playing, 1, sent));
    pressEverywhere(ui, () => contextFor(ui, playing, null, sent));
    expect(sent).toEqual([]);
  });
});
