import { describe, expect, it } from "vitest";
import { simpleChoice, type MoveResult } from "../src/index.js";
import type { AnyTableGame } from "../src/registry.js";
import {
  CATEGORIES,
  openCategories,
  pointsFor,
  scorecardTotal,
  yahtzee,
  type Category,
  type Scorecard,
  type YahtzeeState,
} from "../src/games/yahtzee.js";

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

const NONE = [false, false, false, false, false];

function card(filled: Partial<Record<Category, number>> = {}, yahtzeeBonuses = 0): Scorecard {
  const boxes = Object.fromEntries(CATEGORIES.map((category) => [category, filled[category] ?? null])) as Record<Category, number | null>;
  return { boxes, yahtzeeBonuses };
}

// A state with these dice already rolled once for seat 0.
function rolled(dice: number[], scorecard = card(), players = 1): YahtzeeState {
  return { ...yahtzee.start(players, seededRandom(1)), dice, rollsLeft: 2, scorecards: [scorecard, ...Array.from({ length: players - 1 }, () => card())] };
}

describe("Yahtzee scoring", () => {
  it("scores each box as the standard rules do", () => {
    const empty = card();
    expect(pointsFor([3, 3, 3, 2, 2], "threes", empty)).toBe(9);
    expect(pointsFor([3, 3, 3, 2, 2], "threeOfAKind", empty)).toBe(13);
    expect(pointsFor([3, 3, 3, 2, 2], "fourOfAKind", empty)).toBe(0);
    expect(pointsFor([3, 3, 3, 2, 2], "fullHouse", empty)).toBe(25);
    expect(pointsFor([1, 2, 3, 4, 6], "smallStraight", empty)).toBe(30);
    expect(pointsFor([1, 2, 3, 4, 6], "largeStraight", empty)).toBe(0);
    expect(pointsFor([2, 3, 4, 5, 6], "largeStraight", empty)).toBe(40);
    expect(pointsFor([4, 4, 4, 4, 4], "yahtzee", empty)).toBe(50);
    expect(pointsFor([4, 4, 4, 4, 4], "fullHouse", empty)).toBe(0);
    expect(pointsFor([1, 2, 5, 6, 6], "chance", empty)).toBe(20);
  });

  it("adds the 35 upper bonus at 63 and 100 for each extra Yahtzee", () => {
    const upper = { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 };
    expect(scorecardTotal(card(upper))).toBe(63 + 35);
    expect(scorecardTotal(card({ ...upper, sixes: 12 }))).toBe(57);
    expect(scorecardTotal(card({ yahtzee: 50 }, 2))).toBe(250);
  });

  it("plays a second Yahtzee as a joker, with its bonus", () => {
    const scored = card({ yahtzee: 50 });
    // Its own upper box is open: that is the only place it may go.
    expect(openCategories([5, 5, 5, 5, 5], scored)).toEqual(["fives"]);
    const state = rolled([5, 5, 5, 5, 5], scored);
    expect(yahtzee.play(state, 0, { kind: "score", category: "chance" }, Math.random).ok).toBe(false);
    const after = accepted(yahtzee.play(state, 0, { kind: "score", category: "fives" }, Math.random));
    expect(after.scorecards[0].yahtzeeBonuses).toBe(1);
    expect(after.scorecards[0].boxes.fives).toBe(25);
    // With the upper box used, a lower box counts in full.
    const fivesUsed = card({ yahtzee: 50, fives: 10 });
    expect(openCategories([5, 5, 5, 5, 5], fivesUsed)).not.toContain("ones");
    expect(pointsFor([5, 5, 5, 5, 5], "largeStraight", fivesUsed)).toBe(40);
    // A Yahtzee box scored at 0 gives no bonus, but the joker rule still holds.
    const zeroed = accepted(yahtzee.play(rolled([2, 2, 2, 2, 2], card({ yahtzee: 0 })), 0, { kind: "score", category: "twos" }, Math.random));
    expect(zeroed.scorecards[0].yahtzeeBonuses).toBe(0);
  });
});

describe("Yahtzee turns", () => {
  it("rolls up to three times, keeping dice, then scores and passes the turn", () => {
    const random = seededRandom(7);
    let state = yahtzee.start(2, random);
    expect(yahtzee.play(state, 0, { kind: "score", category: "chance" }, random)).toEqual({ ok: false, error: "Roll the dice first" });
    expect(yahtzee.play(state, 0, { kind: "roll", keep: [true, false, false, false, false] }, random).ok).toBe(false);
    expect(yahtzee.play(state, 1, { kind: "roll", keep: NONE }, random)).toEqual({ ok: false, error: "Not your turn" });
    state = accepted(yahtzee.play(state, 0, { kind: "roll", keep: NONE }, random));
    expect(state.rollsLeft).toBe(2);
    const keep = [true, true, false, false, false];
    const before = state.dice;
    state = accepted(yahtzee.play(state, 0, { kind: "roll", keep }, random));
    expect(state.dice.slice(0, 2)).toEqual(before.slice(0, 2));
    expect(yahtzee.play(state, 0, { kind: "roll", keep: [true, true, true, true, true] }, random).ok).toBe(false);
    state = accepted(yahtzee.play(state, 0, { kind: "roll", keep: NONE }, random));
    expect(yahtzee.play(state, 0, { kind: "roll", keep: NONE }, random).ok).toBe(false);
    state = accepted(yahtzee.play(state, 0, { kind: "score", category: "chance" }, random));
    expect(state.turn).toBe(1);
    expect(state.rollsLeft).toBe(3);
    expect(yahtzee.toMove(state)).toEqual([1]);
  });

  it("refuses malformed moves and boxes already used", () => {
    const state = rolled([1, 2, 3, 4, 5], card({ chance: 15 }));
    for (const move of [null, "roll", { kind: "roll" }, { kind: "roll", keep: [true] }, { kind: "roll", keep: [1, 0, 0, 0, 0] }, { kind: "score", category: "bonus" }]) {
      expect(yahtzee.play(state, 0, move, Math.random).ok).toBe(false);
    }
    expect(yahtzee.play(state, 0, { kind: "score", category: "chance" }, Math.random)).toEqual({ ok: false, error: "That box is already scored" });
  });

  it("offers keep patterns and every open box with its points", () => {
    const labels = yahtzee.choices(rolled([3, 3, 3, 2, 2]), 0).map((choice) => choice.label);
    expect(labels).toContain("roll all five dice again");
    expect(labels).toContain("roll again keeping 3 3 3");
    expect(labels).toContain("score 25 in full house");
    expect(labels).toContain("score 0 in Yahtzee");
    expect(new Set(labels).size).toBe(labels.length);
    expect(yahtzee.choices(rolled([3, 3, 3, 2, 2]), 1)).toEqual([]);
    const straight = yahtzee.choices(rolled([1, 2, 3, 4, 6]), 0).map((choice) => choice.label);
    expect(straight).toContain("roll again keeping 1 2 3 4");
  });

  it("plays whole games with the simple strategy, ending when every card is full", () => {
    for (const players of [1, 3]) {
      const random = seededRandom(players * 11);
      let state = yahtzee.start(players, random);
      let moves = 0;
      while (!state.outcome) {
        const seat = yahtzee.toMove(state)[0];
        const decision = simpleChoice({ game: yahtzee as unknown as AnyTableGame, state, view: yahtzee.viewFor(state, seat), seat, random })!;
        state = accepted(yahtzee.play(state, seat, decision.choice.move, random));
        expect(++moves).toBeLessThan(13 * 4 * players + 1);
      }
      expect(state.scorecards.every((scorecard) => CATEGORIES.every((category) => scorecard.boxes[category] !== null))).toBe(true);
      const totals = state.scorecards.map(scorecardTotal);
      expect(state.outcome.winners.every((seat) => totals[seat] === Math.max(...totals))).toBe(true);
      // A greedy player should do better than chance alone.
      expect(Math.max(...totals)).toBeGreaterThan(100);
      expect(yahtzee.toMove(state)).toEqual([]);
    }
  });
});
