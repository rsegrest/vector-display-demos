import { describe, expect, it } from "vitest";
import { craps, NO_CRAPS_BETS, type CrapsState } from "../src/games/craps.js";
import type { MoveResult, Seat } from "../src/TableGame.js";

function seededRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

// A random source that rolls these two dice (again and again).
function dice(first: number, second: number): () => number {
  let count = 0;
  return () => ((count++ % 2 === 0 ? first : second) - 0.5) / 6;
}

function accepted<State>(result: MoveResult<State>): State {
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe("Craps", () => {
  const random = seededRandom(5);
  const move = (state: CrapsState, seat: Seat, play: unknown, source = random): CrapsState => accepted(craps.play(state, seat, play, source));
  // One round with one player: lays `bets` and rolls.
  const rollWith = (state: CrapsState, source: () => number, bets: { on: string; amount: number }[] = []): CrapsState =>
    move(state, 0, { kind: "ready", bets }, source);

  it("wins the pass line on a natural and loses don't pass", () => {
    const state = rollWith(craps.start(1, random), dice(3, 4), [
      { on: "pass", amount: 100 },
      { on: "dontPass", amount: 50 },
    ]);
    expect(state.lastRoll).toEqual({ dice: [3, 4], total: 7, call: "Natural 7", returned: [200] });
    expect(state.chips).toEqual([1050]);
    expect(state.bets).toEqual([NO_CRAPS_BETS]);
    expect(state.point).toBeNull();
    expect(state.rolls).toBe(1);
  });

  it("pays don't pass on craps 2 or 3 and pushes it on 12", () => {
    const three = rollWith(craps.start(1, random), dice(1, 2), [{ on: "dontPass", amount: 100 }]);
    expect(three.lastRoll!.call).toBe("Craps 3");
    expect(three.chips).toEqual([1100]);
    const twelve = rollWith(craps.start(1, random), dice(6, 6), [
      { on: "dontPass", amount: 100 },
      { on: "pass", amount: 100 },
    ]);
    expect(twelve.chips).toEqual([900]);
  });

  it("sets a point, keeps the line bets, pays odds at true odds when the point is made", () => {
    let state = rollWith(craps.start(1, random), dice(2, 2), [{ on: "pass", amount: 100 }]);
    expect(state.point).toBe(4);
    expect(state.lastRoll!.call).toBe("Point is 4");
    expect(state.bets[0].pass).toBe(100);
    // Line bets are locked while the point is on; odds go behind, up to twice the pass bet.
    expect(craps.play(state, 0, { kind: "bet", on: "pass", amount: 10 }, random).ok).toBe(false);
    expect(craps.play(state, 0, { kind: "bet", on: "odds", amount: 250 }, random).ok).toBe(false);
    state = move(state, 0, { kind: "bet", on: "odds", amount: 200 });
    state = move(state, 0, { kind: "clear" });
    expect(state.bets[0]).toEqual({ ...NO_CRAPS_BETS, pass: 100 });
    state = rollWith(state, dice(5, 4), [{ on: "odds", amount: 200 }]);
    expect(state.lastRoll!.call).toBe("Rolled 9");
    expect(state.point).toBe(4);
    state = rollWith(state, dice(1, 3));
    expect(state.lastRoll!.call).toBe("Hit the point 4");
    // 200 for the pass bet back with even money, 200 odds back with 2 to 1.
    expect(state.lastRoll!.returned).toEqual([200 + 600]);
    expect(state.chips).toEqual([1500]);
    expect(state.point).toBeNull();
  });

  it("sevens out: pass and odds lose, don't pass wins, the dice move on", () => {
    let state = craps.start(2, random);
    state = move(state, 0, { kind: "ready", bets: [{ on: "pass", amount: 50 }] });
    state = move(state, 1, { kind: "ready", bets: [{ on: "dontPass", amount: 50 }] }, dice(5, 5));
    expect(state.point).toBe(10);
    state = move(state, 0, { kind: "ready", bets: [{ on: "odds", amount: 100 }] });
    state = move(state, 1, { kind: "ready" }, dice(6, 1));
    expect(state.lastRoll!.call).toBe("Seven out");
    expect(state.chips).toEqual([850, 1050]);
    expect(state.shooter).toBe(1);
    expect(state.point).toBeNull();
  });

  it("pays the field 1 to 1, 2 to 1 on a 2 and 3 to 1 on a 12, and loses it on 5 to 8", () => {
    expect(rollWith(craps.start(1, random), dice(4, 5), [{ on: "field", amount: 10 }]).chips).toEqual([1010]);
    expect(rollWith(craps.start(1, random), dice(1, 1), [{ on: "field", amount: 10 }]).chips).toEqual([1020]);
    expect(rollWith(craps.start(1, random), dice(6, 6), [{ on: "field", amount: 10 }]).chips).toEqual([1030]);
    const lost = rollWith(craps.start(1, random), dice(3, 3), [{ on: "field", amount: 10 }]);
    expect(lost.chips).toEqual([990]);
    expect(lost.bets[0].field).toBe(0);
  });

  it("waits for every seat, refuses bad moves", () => {
    const state = craps.start(2, random);
    expect(craps.toMove(state)).toEqual([0, 1]);
    const ready = move(state, 0, { kind: "ready", bets: [{ on: "pass", amount: 10 }] });
    expect(craps.toMove(ready)).toEqual([1]);
    expect(ready.rolls).toBe(0);
    expect(craps.play(ready, 0, { kind: "ready" }, random).ok).toBe(false);
    expect(craps.play(state, 0, { kind: "bet", on: "odds", amount: 10 }, random).ok).toBe(false);
    expect(craps.play(state, 0, { kind: "bet", on: "pass", amount: 9 }, random).ok).toBe(false);
    expect(craps.play(state, 0, { kind: "bet", on: "pass", amount: 1001 }, random).ok).toBe(false);
    expect(craps.play(state, 0, { kind: "bet", on: "come", amount: 10 }, random).ok).toBe(false);
    expect(craps.play(state, 0, null, random).ok).toBe(false);
  });

  it("keeps a seat with no chips but a bet standing in the game until it is decided", () => {
    let state = rollWith(craps.start(1, random), dice(3, 3), [{ on: "pass", amount: 1000 }]);
    expect(state.chips).toEqual([0]);
    expect(craps.toMove(state)).toEqual([0]);
    expect(craps.choices(state, 0).map((choice) => choice.label)).toEqual(["roll with the bets as they are"]);
    expect(craps.finish!(state)).toEqual({ winners: [0], summary: "Most chips: 1000" });
    state = rollWith(state, dice(4, 3));
    expect(craps.outcome(state)).toEqual({ winners: [], summary: "Every player is out of chips" });
    expect(craps.toMove(state)).toEqual([]);
  });

  it("offers unique, legal choices and a simple strategy of small pass bets", () => {
    const state = craps.start(2, random);
    const choices = craps.choices(state, 0);
    expect(new Set(choices.map((choice) => choice.label)).size).toBe(choices.length);
    for (const choice of choices) expect(craps.play(state, 0, choice.move, random).ok).toBe(true);
    expect(craps.simpleStrategy!(state, 0, choices, random).label).toBe("bet 10 on the pass line");
  });

  it("plays the same with the same seed", () => {
    const run = (): CrapsState => {
      const source = seededRandom(9);
      let state = craps.start(3, source);
      for (let round = 0; round < 30; round++) {
        for (const seat of craps.toMove(state)) {
          const choices = craps.choices(state, seat);
          state = accepted(craps.play(state, seat, choices[Math.floor(source() * choices.length)].move, source));
        }
      }
      return state;
    };
    const first = run();
    expect(first.rolls).toBeGreaterThan(10);
    expect(run()).toEqual(first);
  });
});
