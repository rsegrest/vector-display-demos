import { describe, expect, it } from "vitest";
import { slots, slotsPay, type SlotsState } from "../src/games/slots.js";
import type { MoveResult } from "../src/TableGame.js";

function seededRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

// A random source that stops every reel on the same symbol (index into the symbol list).
const always = (symbol: number) => () => (symbol + 0.5) / 8;

function accepted<State>(result: MoveResult<State>): State {
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe("Slots", () => {
  const random = seededRandom(13);

  it("has the original's pay table", () => {
    expect(slotsPay(["seven", "seven", "seven"])).toEqual({ multiple: 50, win: "three sevens" });
    expect(slotsPay(["diamond", "diamond", "diamond"]).multiple).toBe(25);
    expect(slotsPay(["bell", "bell", "bell"]).multiple).toBe(15);
    expect(slotsPay(["bar", "bar", "bar"]).multiple).toBe(10);
    expect(slotsPay(["cherry", "cherry", "cherry"]).multiple).toBe(5);
    expect(slotsPay(["plum", "plum", "plum"]).multiple).toBe(3);
    expect(slotsPay(["lemon", "lemon", "bell"]).multiple).toBe(1);
    expect(slotsPay(["lemon", "bell", "cherry"]).multiple).toBe(0.5);
    expect(slotsPay(["lemon", "bell", "lemon"])).toEqual({ multiple: 0, win: null });
  });

  it("spins one machine per move, paying at once, without waiting for the others", () => {
    const state = slots.start(2, random);
    expect(slots.toMove(state)).toEqual([0, 1]);
    // The seventh symbol is the seven.
    const won = accepted(slots.play(state, 1, { kind: "spin", amount: 10 }, always(6)));
    expect(won.chips).toEqual([1000, 1000 - 10 + 500]);
    expect(won.machines[1]).toEqual({ spins: 1, reels: Array(3).fill(Array(3).fill("seven")), bet: 10, returned: 500, win: "three sevens" });
    expect(won.machines[0].spins).toBe(0);
    expect(slots.toMove(won)).toEqual([0, 1]);
    const spun = accepted(slots.play(won, 0, { kind: "spin", amount: 25 }, random));
    expect(spun.chips[0]).toBe(1000 - 25 + spun.machines[0].returned);
    expect(spun.machines[0].reels!.flat()).toHaveLength(9);
  });

  it("refuses bad spins and sits out a seat with no chips", () => {
    const state = slots.start(2, random);
    expect(slots.play(state, 0, { kind: "spin", amount: 5 }, random).ok).toBe(false);
    expect(slots.play(state, 0, { kind: "spin", amount: 1001 }, random).ok).toBe(false);
    expect(slots.play(state, 0, { kind: "spin", amount: 12.5 }, random).ok).toBe(false);
    expect(slots.play(state, 0, { kind: "pull" }, random).ok).toBe(false);
    // Lemons on the first two reels and a bell on the third: the bet back.
    let symbol = 0;
    const lemonsThenBell = () => ([1, 1, 1, 1, 1, 1, 4, 4, 4][symbol++ % 9] + 0.5) / 8;
    const twoLemons = accepted(slots.play(state, 0, { kind: "spin", amount: 1000 }, lemonsThenBell));
    expect(twoLemons.machines[0].returned).toBe(1000);
    // Lemon, plum, bell: nothing back.
    const lemonPlum = () => ([1, 1, 1, 3, 3, 3, 4, 4, 4][symbol++ % 9] + 0.5) / 8;
    symbol = 0;
    const lost = accepted(slots.play(state, 0, { kind: "spin", amount: 1000 }, lemonPlum));
    expect(lost.chips).toEqual([0, 1000]);
    expect(slots.toMove(lost)).toEqual([1]);
    expect(slots.choices(lost, 0)).toEqual([]);
    expect(slots.play(lost, 0, { kind: "spin", amount: 10 }, random).ok).toBe(false);
    expect(slots.finish!(lost)).toEqual({ winners: [1], summary: "Most chips: 1000" });
    const allOut = accepted(slots.play(lost, 1, { kind: "spin", amount: 1000 }, lemonPlum));
    expect(slots.outcome(allOut)).toEqual({ winners: [], summary: "Every player is out of chips" });
  });

  it("offers a few spins and plays the same with the same seed", () => {
    const state = slots.start(1, random);
    expect(slots.choices(state, 0).map((choice) => choice.label)).toEqual(["spin for 10", "spin for 25", "spin for 50", "spin for 100", "spin for 250"]);
    expect(slots.simpleStrategy!(state, 0, slots.choices(state, 0), random).label).toBe("spin for 10");
    const run = (): SlotsState => {
      const source = seededRandom(4);
      let played = slots.start(2, source);
      for (let spin = 0; spin < 40; spin++) {
        const seat = spin % 2;
        if (slots.toMove(played).includes(seat)) played = accepted(slots.play(played, seat, slots.choices(played, seat)[0].move, source));
      }
      return played;
    };
    expect(run()).toEqual(run());
  });
});
