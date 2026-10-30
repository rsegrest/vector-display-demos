import { describe, expect, it } from "vitest";
import { keno, KENO_PAY_TABLE, kenoMultiplier, quickPicks, type KenoState } from "../src/games/keno.js";
import type { MoveResult, Seat } from "../src/TableGame.js";

function seededRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

function accepted<State>(result: MoveResult<State>): State {
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe("Keno", () => {
  const random = seededRandom(7);
  const move = (state: KenoState, seat: Seat, play: unknown, source = random): KenoState => accepted(keno.play(state, seat, play, source));

  it("has the original's pay table", () => {
    expect(Object.keys(KENO_PAY_TABLE)).toHaveLength(10);
    expect(kenoMultiplier(1, 1)).toBe(3);
    expect(kenoMultiplier(5, 3)).toBe(2);
    expect(kenoMultiplier(10, 10)).toBe(10000);
    expect(kenoMultiplier(10, 3)).toBe(0);
  });

  it("draws 20 different numbers once every seat is in, and pays each ticket", () => {
    let state = keno.start(2, random);
    expect(keno.toMove(state)).toEqual([0, 1]);
    state = move(state, 0, { kind: "bet", picks: [5, 1, 2, 3, 4], amount: 50 });
    expect(state.chips[0]).toBe(950);
    expect(state.tickets[0]).toEqual({ picks: [1, 2, 3, 4, 5], amount: 50 });
    expect(keno.toMove(state)).toEqual([1]);
    state = move(state, 1, { kind: "skip" });
    const draw = state.lastDraw!;
    expect(state.draws).toBe(1);
    expect(draw.numbers).toHaveLength(20);
    expect(new Set(draw.numbers).size).toBe(20);
    expect(draw.numbers.every((number) => number >= 1 && number <= 80)).toBe(true);
    expect(draw.tickets).toEqual([{ picks: [1, 2, 3, 4, 5], amount: 50 }, null]);
    const matches = [1, 2, 3, 4, 5].filter((number) => draw.numbers.includes(number)).length;
    expect(draw.matches).toEqual([matches, 0]);
    expect(draw.returned).toEqual([50 * kenoMultiplier(5, matches), 0]);
    expect(state.chips).toEqual([950 + draw.returned[0], 1000]);
    // The next round opens at once.
    expect(keno.toMove(state)).toEqual([0, 1]);
    expect(state.tickets).toEqual([null, null]);
  });

  it("refuses bad tickets", () => {
    const state = keno.start(1, random);
    const refused = (play: unknown): boolean => !keno.play(state, 0, play, random).ok;
    expect(refused({ kind: "bet", picks: [], amount: 10 })).toBe(true);
    expect(refused({ kind: "bet", picks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], amount: 10 })).toBe(true);
    expect(refused({ kind: "bet", picks: [0], amount: 10 })).toBe(true);
    expect(refused({ kind: "bet", picks: [81], amount: 10 })).toBe(true);
    expect(refused({ kind: "bet", picks: [4, 4], amount: 10 })).toBe(true);
    expect(refused({ kind: "bet", picks: [4.5], amount: 10 })).toBe(true);
    expect(refused({ kind: "bet", picks: [4], amount: 5 })).toBe(true);
    expect(refused({ kind: "bet", picks: [4], amount: 1001 })).toBe(true);
    expect(refused({ kind: "bet", picks: "4", amount: 10 })).toBe(true);
    expect(refused({ kind: "draw" })).toBe(true);
    const waiting = move(keno.start(2, random), 0, { kind: "skip" });
    expect(keno.play(waiting, 0, { kind: "bet", picks: [1], amount: 10 }, random)).toEqual({ ok: false, error: "You are in: wait for the draw" });
  });

  it("sits out a seat that has lost its chips, and ends when every seat has", () => {
    // Bet everything until the chips are gone (a seeded random, so this ends the same way each time).
    let state = keno.start(2, random);
    state = move(state, 1, { kind: "skip" });
    while (state.chips[0] >= 10 && state.draws < 200) {
      state = move(state, 0, { kind: "bet", picks: [80], amount: Math.min(state.chips[0], 1000) });
      state = move(state, 1, { kind: "skip" });
    }
    expect(state.chips[0]).toBeLessThan(10);
    expect(keno.toMove(state)).toEqual([1]);
    expect(keno.choices(state, 0)).toEqual([]);
    expect(keno.outcome(state)).toBeNull();
    expect(keno.finish!(state).winners).toEqual([1]);
  });

  it("offers unique, legal tickets and plays the same with the same seed", () => {
    const state = keno.start(1, random);
    const choices = keno.choices(state, 0);
    expect(new Set(choices.map((choice) => choice.label)).size).toBe(choices.length);
    expect(choices.map((choice) => choice.label)).toContain("pick 5 numbers and bet 10");
    for (const choice of choices) expect(keno.play(state, 0, choice.move, random).ok).toBe(true);
    expect(quickPicks(10, 3, 1)).toHaveLength(10);
    expect(new Set(quickPicks(10, 3, 1)).size).toBe(10);
    expect(keno.simpleStrategy!(state, 0, choices, random).label).toBe("pick 5 numbers and bet 10");

    const run = (): KenoState => {
      const source = seededRandom(21);
      let played = keno.start(3, source);
      for (let round = 0; round < 15; round++) {
        for (const seat of keno.toMove(played)) {
          const offered = keno.choices(played, seat);
          played = accepted(keno.play(played, seat, offered[Math.floor(source() * offered.length)].move, source));
        }
      }
      return played;
    };
    expect(run()).toEqual(run());
    expect(run().draws).toBe(15);
  });
});
