import { describe, expect, it } from "vitest";
import { pachinko, PACHINKO_BALLS, PACHINKO_MULTIPLIERS, PACHINKO_ROWS, pachinkoReturn, type PachinkoState } from "../src/games/pachinko.js";
import type { MoveResult } from "../src/TableGame.js";

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

describe("Pachinko", () => {
  const random = seededRandom(17);

  it("has eleven bins, the edges paying most, one bounce a row above them", () => {
    expect(PACHINKO_MULTIPLIERS).toEqual([20, 6, 3, 1.2, 0.5, 0.3, 0.5, 1.2, 3, 6, 20]);
    // A fair bounce at every row: the expected return of a ball is a little under its stake.
    const binomial = (k: number): number => { let value = 1; for (let i = 0; i < k; i++) value = (value * (PACHINKO_ROWS - i)) / (i + 1); return value; };
    const expected = PACHINKO_MULTIPLIERS.reduce((sum, multiplier, bin) => sum + (multiplier * binomial(bin)) / 2 ** PACHINKO_ROWS, 0);
    expect(expected).toBeGreaterThan(0.9);
    expect(expected).toBeLessThan(1);
    expect(PACHINKO_ROWS).toBe(10);
    // Five balls of a fifth of the bet each.
    expect(pachinkoReturn([5, 5, 5, 5, 5], 100)).toBe(30);
    expect(pachinkoReturn([0, 10, 1, 9, 2], 100)).toBe(Math.floor((100 * (20 + 20 + 6 + 6 + 3)) / 5));
  });

  it("drops five balls whose paths decide their bins, and pays at once", () => {
    const state = pachinko.start(2, random);
    expect(pachinko.toMove(state)).toEqual([0, 1]);
    const dropped = accepted(pachinko.play(state, 0, { kind: "drop", amount: 50 }, random));
    const board = dropped.boards[0];
    expect(board.drops).toBe(1);
    expect(board.balls).toHaveLength(PACHINKO_BALLS);
    for (const ball of board.balls) {
      expect(ball.path).toHaveLength(PACHINKO_ROWS);
      expect(ball.bin).toBe(ball.path.filter((right) => right).length);
    }
    expect(board.returned).toBe(pachinkoReturn(board.balls.map((ball) => ball.bin), 50));
    expect(dropped.chips).toEqual([1000 - 50 + board.returned, 1000]);
    expect(dropped.boards[1].drops).toBe(0);
    // Always right (a random number under one half): every ball in the last bin.
    const edge = accepted(pachinko.play(state, 1, { kind: "drop", amount: 100 }, () => 0.1));
    expect(edge.boards[1].balls.every((ball) => ball.bin === 10)).toBe(true);
    expect(edge.chips[1]).toBe(1000 - 100 + 2000);
  });

  it("spreads balls as a fair binomial walk: most near the middle", () => {
    const source = seededRandom(99);
    const counts = Array<number>(11).fill(0);
    let state = pachinko.start(1, source);
    for (let drop = 0; drop < 200; drop++) {
      state = accepted(pachinko.play({ ...state, chips: [1000] }, 0, { kind: "drop", amount: 10 }, source));
      for (const ball of state.boards[0].balls) counts[ball.bin]++;
    }
    expect(counts[4] + counts[5] + counts[6]).toBeGreaterThan(500);
    expect(counts[0] + counts[10]).toBeLessThan(10);
  });

  it("refuses bad drops and sits out a seat with no chips", () => {
    const state = pachinko.start(2, random);
    expect(pachinko.play(state, 0, { kind: "drop", amount: 9 }, random).ok).toBe(false);
    expect(pachinko.play(state, 0, { kind: "drop", amount: 1001 }, random).ok).toBe(false);
    expect(pachinko.play(state, 0, { kind: "drop" }, random).ok).toBe(false);
    expect(pachinko.play(state, 0, { kind: "spin", amount: 10 }, random).ok).toBe(false);
    const broke: PachinkoState = { ...state, chips: [5, 1000] };
    expect(pachinko.toMove(broke)).toEqual([1]);
    expect(pachinko.choices(broke, 0)).toEqual([]);
    expect(pachinko.play(broke, 0, { kind: "drop", amount: 10 }, random).ok).toBe(false);
    expect(pachinko.finish!(broke).winners).toEqual([1]);
    expect(pachinko.outcome({ ...state, chips: [0, 9] })).toEqual({ winners: [], summary: "Every player is out of chips" });
  });

  it("offers a few drops and plays the same with the same seed", () => {
    const state = pachinko.start(1, random);
    const choices = pachinko.choices(state, 0);
    expect(choices[0].label).toBe("drop 5 balls for 10");
    expect(new Set(choices.map((choice) => choice.label)).size).toBe(choices.length);
    const run = (): PachinkoState => {
      const source = seededRandom(8);
      let played = pachinko.start(3, source);
      for (let drop = 0; drop < 30; drop++) {
        const seat = drop % 3;
        if (pachinko.toMove(played).includes(seat)) played = accepted(pachinko.play(played, seat, pachinko.choices(played, seat)[1].move, source));
      }
      return played;
    };
    expect(run()).toEqual(run());
  });
});
