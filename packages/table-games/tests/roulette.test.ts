import { describe, expect, it } from "vitest";
import { roulette, rouletteReturn, WHEEL_ORDER, type RouletteState } from "../src/games/roulette.js";
import type { MoveResult, Seat } from "../src/TableGame.js";

function seededRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

// A random source that makes the wheel stop on `number`.
const landsOn = (number: number) => () => (number + 0.5) / 37;

function accepted<State>(result: MoveResult<State>): State {
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe("Roulette", () => {
  const random = seededRandom(3);
  const move = (state: RouletteState, seat: Seat, play: unknown, source = random): RouletteState => accepted(roulette.play(state, seat, play, source));

  it("deals every seat 1000 chips and lets them all bet at once", () => {
    const state = roulette.start(3, random);
    expect(state.chips).toEqual([1000, 1000, 1000]);
    expect(roulette.toMove(state)).toEqual([0, 1, 2]);
    expect(roulette.outcome(state)).toBeNull();
    expect(WHEEL_ORDER).toHaveLength(37);
    expect(new Set(WHEEL_ORDER).size).toBe(37);
  });

  it("pays the original's odds: 35 to 1 straight, 2 to 1 dozens and columns, 1 to 1 outside, zero loses outside", () => {
    expect(rouletteReturn({ on: "straight", number: 17, amount: 10 }, 17)).toBe(360);
    expect(rouletteReturn({ on: "straight", number: 0, amount: 10 }, 0)).toBe(360);
    expect(rouletteReturn({ on: "red", amount: 10 }, 1)).toBe(20);
    expect(rouletteReturn({ on: "black", amount: 10 }, 1)).toBe(0);
    expect(rouletteReturn({ on: "even", amount: 10 }, 0)).toBe(0);
    expect(rouletteReturn({ on: "low", amount: 10 }, 18)).toBe(20);
    expect(rouletteReturn({ on: "high", amount: 10 }, 18)).toBe(0);
    expect(rouletteReturn({ on: "dozen2", amount: 10 }, 13)).toBe(30);
    expect(rouletteReturn({ on: "column1", amount: 10 }, 34)).toBe(30);
    expect(rouletteReturn({ on: "column3", amount: 10 }, 36)).toBe(30);
    expect(rouletteReturn({ on: "column3", amount: 10 }, 0)).toBe(0);
  });

  it("takes bets off the stack, merges them, spins when the last seat is ready and shows the result", () => {
    let state = roulette.start(2, random);
    state = move(state, 0, { kind: "bet", on: "red", amount: 10 });
    state = move(state, 0, { kind: "bet", on: "red", amount: 15 });
    state = move(state, 0, { kind: "bet", on: "straight", number: 3, amount: 10 });
    expect(state.chips[0]).toBe(965);
    expect(state.bets[0]).toEqual([
      { on: "red", amount: 25 },
      { on: "straight", number: 3, amount: 10 },
    ]);
    state = move(state, 0, { kind: "ready" });
    expect(roulette.toMove(state)).toEqual([1]);
    expect(state.spins).toBe(0);
    state = move(state, 1, { kind: "ready", bets: [{ on: "black", amount: 100 }] }, landsOn(3));
    expect(state.spins).toBe(1);
    expect(state.lastSpin).toEqual({ number: 3, staked: [35, 100], returned: [50 + 360, 0] });
    expect(state.chips).toEqual([965 + 410, 900]);
    expect(state.history).toEqual([3]);
    // The next round opens at once.
    expect(roulette.toMove(state)).toEqual([0, 1]);
    expect(state.bets).toEqual([[], []]);
  });

  it("takes bets back, and lets a seat sit a spin out", () => {
    let state = roulette.start(1, random);
    state = move(state, 0, { kind: "bet", on: "odd", amount: 50 });
    state = move(state, 0, { kind: "clear" });
    expect(state.chips[0]).toBe(1000);
    state = move(state, 0, { kind: "ready" }, landsOn(5));
    expect(state.lastSpin).toEqual({ number: 5, staked: [0], returned: [0] });
    expect(state.chips[0]).toBe(1000);
  });

  it("refuses bad moves", () => {
    const state = roulette.start(2, random);
    expect(roulette.play(state, 0, { kind: "bet", on: "red", amount: 5 }, random).ok).toBe(false);
    expect(roulette.play(state, 0, { kind: "bet", on: "red", amount: 1001 }, random).ok).toBe(false);
    expect(roulette.play(state, 0, { kind: "bet", on: "red", amount: 10.5 }, random).ok).toBe(false);
    expect(roulette.play(state, 0, { kind: "bet", on: "straight", number: 37, amount: 10 }, random).ok).toBe(false);
    expect(roulette.play(state, 0, { kind: "bet", on: "straight", amount: 10 }, random).ok).toBe(false);
    expect(roulette.play(state, 0, { kind: "bet", on: "purple", amount: 10 }, random).ok).toBe(false);
    expect(roulette.play(state, 0, "spin", random).ok).toBe(false);
    expect(roulette.play(state, 0, { kind: "ready", bets: [{ on: "red", amount: 2000 }] }, random).ok).toBe(false);
    const ready = move(state, 0, { kind: "ready" });
    expect(roulette.play(ready, 0, { kind: "bet", on: "red", amount: 10 }, random)).toEqual({ ok: false, error: "You are ready: wait for the spin" });
    // Nothing was changed by the refusals.
    expect(state.chips).toEqual([1000, 1000]);
  });

  it("sits out a seat with no chips, ends only when every seat is out, and scores by chips", () => {
    let state = roulette.start(2, random);
    state = move(state, 0, { kind: "ready", bets: [{ on: "red", amount: 1000 }] });
    state = move(state, 1, { kind: "ready" }, landsOn(2));
    expect(state.chips).toEqual([0, 1000]);
    expect(roulette.toMove(state)).toEqual([1]);
    expect(roulette.choices(state, 0)).toEqual([]);
    expect(roulette.play(state, 0, { kind: "ready" }, random).ok).toBe(false);
    // Seat 1 alone now: its ready spins the wheel.
    state = move(state, 1, { kind: "ready", bets: [{ on: "black", amount: 1000 }] }, landsOn(1));
    expect(roulette.outcome(state)).toEqual({ winners: [], summary: "Every player is out of chips" });
    expect(roulette.toMove(state)).toEqual([]);
    expect(roulette.finish!(roulette.start(2, random))).toEqual({ winners: [0, 1], summary: "Most chips: 1000" });
  });

  it("offers computer players a handful of single-move bets with unique labels, all legal", () => {
    const state = roulette.start(2, random);
    const choices = roulette.choices(state, 0);
    expect(choices.length).toBeLessThanOrEqual(40);
    expect(new Set(choices.map((choice) => choice.label)).size).toBe(choices.length);
    expect(choices.map((choice) => choice.label)).toContain("bet 25 on red");
    for (const choice of choices) expect(roulette.play(state, 0, choice.move, random).ok).toBe(true);
    const pick = roulette.simpleStrategy!(roulette.viewFor(state, 0), 0, choices, random);
    expect(pick.label).toMatch(/^bet 10 on (red|black|odd|even|low|high)/);
  });

  it("plays the same with the same seed", () => {
    const run = (): RouletteState => {
      const source = seededRandom(11);
      let state = roulette.start(3, source);
      for (let round = 0; round < 20; round++) {
        for (const seat of roulette.toMove(state)) {
          const choices = roulette.choices(state, seat);
          state = accepted(roulette.play(state, seat, roulette.simpleStrategy!(state, seat, choices, source).move, source));
        }
      }
      return state;
    };
    const first = run();
    expect(first.spins).toBe(20);
    expect(run()).toEqual(first);
  });
});
