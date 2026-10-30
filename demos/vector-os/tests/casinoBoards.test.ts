import { describe, expect, it } from "vitest";
import { DisplayList } from "@vector-display/core";
import type { TableGame } from "../../../packages/table-games/src/TableGame.js";
import { craps } from "../../../packages/table-games/src/games/craps.js";
import { keno } from "../../../packages/table-games/src/games/keno.js";
import { pachinko } from "../../../packages/table-games/src/games/pachinko.js";
import { roulette } from "../../../packages/table-games/src/games/roulette.js";
import { slots } from "../../../packages/table-games/src/games/slots.js";
import type { BoardContext, BoardDrawer } from "../src/apps/tableGames/boards/BoardContext.js";
import { drawCraps } from "../src/apps/tableGames/boards/crapsBoard.js";
import { drawKeno } from "../src/apps/tableGames/boards/kenoBoard.js";
import { drawPachinko } from "../src/apps/tableGames/boards/pachinkoBoard.js";
import { drawRoulette } from "../src/apps/tableGames/boards/rouletteBoard.js";
import { drawSlots } from "../src/apps/tableGames/boards/slotsBoard.js";
import { Ui, type Rect } from "../src/apps/tableGames/Ui.js";

function seededRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

const AREA: Rect = { x: 20, y: 90, width: 640, height: 420 };
const NAMES = ["Ann", "Bob", "Cy", "Dee", "Eve", "Flo"];

// A board for one game, its rules, and a state to draw.
interface Table<State> {
  readonly game: TableGame<State, unknown>;
  readonly draw: BoardDrawer;
  readonly state: State;
}

function contextFor<State>(table: Table<State>, ui: Ui, seat: number | null, sent: unknown[], local: Record<string, unknown>, seconds: number): BoardContext {
  return {
    ui,
    area: AREA,
    view: table.game.viewFor(table.state, seat),
    mySeat: seat,
    toMove: table.game.toMove(table.state),
    names: NAMES.slice(0, (table.state as { chips: readonly number[] }).chips.length),
    outcome: table.game.outcome(table.state),
    send: (move) => sent.push(move),
    local,
    seconds,
  };
}

function drawFrame<State>(table: Table<State>, ui: Ui, context: BoardContext): void {
  ui.begin(new DisplayList());
  table.draw(context);
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

// Clicks all over the board, redrawing after every click that pressed something (a click may
// change the board's own choices: a bet size, a number marked). Returns the moves sent, each of
// which must be legal for `seat` in the state drawn.
function pressEverywhere<State>(table: Table<State>, seat: number, seconds = 100): unknown[] {
  const ui = new Ui();
  const sent: unknown[] = [];
  const local: Record<string, unknown> = {};
  const redraw = (): void => drawFrame(table, ui, contextFor(table, ui, seat, sent, local, seconds));
  redraw();
  expectInsideArea(ui);
  for (let y = AREA.y; y < AREA.y + AREA.height; y += 5) {
    for (let x = AREA.x; x < AREA.x + AREA.width; x += 5) {
      if (ui.press(x, y)) redraw();
    }
  }
  for (const move of sent) {
    const result = table.game.play(table.state, seat, move, seededRandom(1));
    expect(result.ok, `${JSON.stringify(move)}: ${result.ok ? "" : result.error}`).toBe(true);
  }
  return sent;
}

// A watcher's frame (and one mid-animation) draws inside the area and offers nothing to click.
function expectWatcherCannotPress<State>(table: Table<State>): void {
  for (const seconds of [0, 0.5, 1.5, 100]) {
    const ui = new Ui();
    const sent: unknown[] = [];
    const local: Record<string, unknown> = {};
    drawFrame(table, ui, contextFor(table, ui, null, sent, local, 0));
    drawFrame(table, ui, contextFor(table, ui, null, sent, local, seconds));
    expectInsideArea(ui);
    for (let y = AREA.y; y < AREA.y + AREA.height; y += 9) for (let x = AREA.x; x < AREA.x + AREA.width; x += 9) ui.press(x, y);
    expect(sent).toEqual([]);
  }
}

function accepted<State>(result: { ok: true; state: State } | { ok: false; error: string }): State {
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe("casino boards", () => {
  it("roulette: the layout, chip sizes and buttons send legal bets; the wheel spins to the result", () => {
    const random = seededRandom(2);
    let state = roulette.start(3, random);
    state = accepted(roulette.play(state, 1, { kind: "bet", on: "red", amount: 50 }, random));
    const sent = pressEverywhere({ game: roulette, draw: drawRoulette, state }, 0) as { kind: string; on?: string }[];
    expect(sent.some((move) => move.kind === "bet" && move.on === "straight")).toBe(true);
    expect(sent.some((move) => move.kind === "bet" && move.on === "column1")).toBe(true);
    expect(sent.some((move) => move.kind === "ready")).toBe(true);
    // After a spin, with bets laid this round.
    for (const seat of [1, 2]) state = accepted(roulette.play(state, seat, { kind: "ready" }, random));
    state = accepted(roulette.play(state, 0, { kind: "ready", bets: [{ on: "black", amount: 10 }] }, random));
    expect(state.spins).toBe(1);
    state = accepted(roulette.play(state, 2, { kind: "bet", on: "straight", number: 7, amount: 25 }, random));
    const afterSpin = pressEverywhere({ game: roulette, draw: drawRoulette, state }, 2) as { kind: string }[];
    expect(afterSpin.some((move) => move.kind === "clear")).toBe(true);
    expectWatcherCannotPress({ game: roulette, draw: drawRoulette, state });
  });

  it("craps: the pass line, don't pass, field and odds send legal bets", () => {
    const random = seededRandom(3);
    let state = craps.start(2, random);
    const comeOut = pressEverywhere({ game: craps, draw: drawCraps, state }, 0) as { kind: string; on?: string }[];
    expect(new Set(comeOut.filter((move) => move.kind === "bet").map((move) => move.on))).toEqual(new Set(["pass", "dontPass", "field"]));
    // Roll until a point is set, with a pass bet down for seat 0.
    state = accepted(craps.play(state, 0, { kind: "ready", bets: [{ on: "pass", amount: 50 }] }, random));
    while (state.point === null) {
      state = accepted(craps.play(state, 1, { kind: "ready" }, random));
      if (state.point === null && state.bets[0].pass === 0) state = accepted(craps.play(state, 0, { kind: "ready", bets: [{ on: "pass", amount: 50 }] }, random));
      else if (state.point === null) state = accepted(craps.play(state, 0, { kind: "ready" }, random));
    }
    expect(state.bets[0].pass).toBe(50);
    const withPoint = pressEverywhere({ game: craps, draw: drawCraps, state }, 0) as { kind: string; on?: string }[];
    expect(withPoint.some((move) => move.on === "odds")).toBe(true);
    expect(withPoint.some((move) => move.on === "pass")).toBe(false);
    expectWatcherCannotPress({ game: craps, draw: drawCraps, state });
  });

  it("keno: numbers clicked make a ticket that is legal to play; skipping is offered", () => {
    const random = seededRandom(4);
    let state = keno.start(2, random);
    const sent = pressEverywhere({ game: keno, draw: drawKeno, state }, 0) as { kind: string; picks?: number[] }[];
    expect(sent.some((move) => move.kind === "bet" && move.picks!.length >= 1)).toBe(true);
    expect(sent.some((move) => move.kind === "skip")).toBe(true);
    state = accepted(keno.play(state, 0, { kind: "bet", picks: [1, 2, 3], amount: 10 }, random));
    state = accepted(keno.play(state, 1, { kind: "skip" }, random));
    expect(state.draws).toBe(1);
    pressEverywhere({ game: keno, draw: drawKeno, state }, 1);
    expectWatcherCannotPress({ game: keno, draw: drawKeno, state });
  });

  it("slots: the lever and the Spin button spin the viewer's machine", () => {
    const random = seededRandom(5);
    let state = slots.start(4, random);
    state = accepted(slots.play(state, 2, { kind: "spin", amount: 25 }, random));
    for (const seat of [0, 2]) {
      const sent = pressEverywhere({ game: slots, draw: drawSlots, state }, seat) as { kind: string }[];
      expect(sent.length).toBeGreaterThan(0);
      expect(sent.every((move) => move.kind === "spin")).toBe(true);
    }
    expectWatcherCannotPress({ game: slots, draw: drawSlots, state });
  });

  it("pachinko: the drop button drops the viewer's balls; boards draw with balls mid-fall", () => {
    const random = seededRandom(6);
    let state = pachinko.start(6, random);
    state = accepted(pachinko.play(state, 0, { kind: "drop", amount: 50 }, random));
    const sent = pressEverywhere({ game: pachinko, draw: drawPachinko, state }, 3) as { kind: string; amount: number }[];
    expect(sent.some((move) => move.kind === "drop")).toBe(true);
    expectWatcherCannotPress({ game: pachinko, draw: drawPachinko, state });
  });
});
