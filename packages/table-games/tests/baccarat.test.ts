import { describe, expect, it } from "vitest";
import { freshDeck, type Card, type Rank } from "../src/casino.js";
import { baccarat, baccaratReturn, baccaratTotal, bankerDraws, dealCoup, type BaccaratState } from "../src/games/baccarat.js";
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

function cards(ranks: string): Card[] {
  return ranks.split(" ").map((rank) => ({ rank: rank as Rank, suit: "clubs" }));
}

// A table whose shoe starts with these cards: player, banker, player, banker, then third cards.
function withShoe(playerCount: number, ranks: string): BaccaratState {
  const state = baccarat.start(playerCount, seededRandom(9));
  return { ...state, shoe: [...cards(ranks), ...freshDeck(2)] };
}

describe("Baccarat", () => {
  const random = seededRandom(4);

  it("counts only the last digit, tens and faces as nothing", () => {
    expect(baccaratTotal(cards("7 8"))).toBe(5);
    expect(baccaratTotal(cards("K Q"))).toBe(0);
    expect(baccaratTotal(cards("A 9 10"))).toBe(0);
    expect(baccaratTotal(cards("4 5"))).toBe(9);
  });

  it("draws third cards by the tableau", () => {
    expect(bankerDraws(5, null)).toBe(true);
    expect(bankerDraws(6, null)).toBe(false);
    const third = (rank: string): Card => cards(rank)[0];
    expect(bankerDraws(2, third("9"))).toBe(true);
    expect(bankerDraws(3, third("8"))).toBe(false);
    expect(bankerDraws(3, third("9"))).toBe(true);
    expect(bankerDraws(4, third("A"))).toBe(false);
    expect(bankerDraws(4, third("7"))).toBe(true);
    expect(bankerDraws(5, third("3"))).toBe(false);
    expect(bankerDraws(5, third("4"))).toBe(true);
    expect(bankerDraws(6, third("6"))).toBe(true);
    expect(bankerDraws(6, third("8"))).toBe(false);
    expect(bankerDraws(7, third("6"))).toBe(false);
  });

  it("deals a coup: naturals stand, the player draws on 5 or less, the banker by the tableau", () => {
    // Player 4 5 = natural 9: no third cards.
    expect(dealCoup(cards("4 3 5 3 2 2"))).toEqual(expect.objectContaining({ playerCards: cards("4 5"), bankerCards: cards("3 3") }));
    // Player 2 3 = 5 draws a 4 (9); banker 3 3 = 6 stands against a 4.
    expect(dealCoup(cards("2 3 3 3 4 9"))).toEqual(expect.objectContaining({ playerCards: cards("2 3 4"), bankerCards: cards("3 3") }));
    // Player 10 7 stands; banker 2 K = 2 draws.
    expect(dealCoup(cards("10 2 7 K 5"))).toEqual(expect.objectContaining({ playerCards: cards("10 7"), bankerCards: cards("2 K 5") }));
  });

  it("pays player 1 to 1, banker 0.95 to 1, tie 8 to 1, and returns player and banker bets on a tie", () => {
    expect(baccaratReturn({ on: "player", amount: 100 }, "player")).toBe(200);
    expect(baccaratReturn({ on: "banker", amount: 100 }, "banker")).toBe(195);
    expect(baccaratReturn({ on: "banker", amount: 25 }, "banker")).toBe(48);
    expect(baccaratReturn({ on: "tie", amount: 10 }, "tie")).toBe(90);
    expect(baccaratReturn({ on: "player", amount: 100 }, "tie")).toBe(100);
    expect(baccaratReturn({ on: "tie", amount: 100 }, "banker")).toBe(0);
    expect(baccaratReturn({ on: "player", amount: 100 }, "banker")).toBe(0);
  });

  it("takes everyone's bets at once and deals the coup when the last is in", () => {
    // Banker 3 6 = natural 9 beats player 2 4 = 6.
    let state = withShoe(3, "2 3 4 6");
    expect(baccarat.toMove(state)).toEqual([0, 1, 2]);
    expect(baccarat.play(state, 0, { kind: "bet", on: "dragon", amount: 10 }, random).ok).toBe(false);
    expect(baccarat.play(state, 0, { kind: "bet", on: "banker", amount: 9 }, random).ok).toBe(false);
    expect(baccarat.play(state, 0, { kind: "bet", on: "banker", amount: 501 }, random).ok).toBe(false);
    state = accepted(baccarat.play(state, 0, { kind: "bet", on: "banker", amount: 100 }, random));
    expect(baccarat.play(state, 0, { kind: "bet", on: "banker", amount: 100 }, random).ok).toBe(false);
    state = accepted(baccarat.play(state, 1, { kind: "bet", on: "player", amount: 50 }, random));
    expect(baccarat.toMove(state)).toEqual([2]);
    expect(state.lastCoup).toBeNull();
    state = accepted(baccarat.play(state, 2, { kind: "bet", on: "tie", amount: 10 }, random));
    expect(state.lastCoup).toEqual(expect.objectContaining({ winner: "banker", playerTotal: 6, bankerTotal: 9, roundNumber: 1 }));
    expect(state.lastCoup?.results.map((result) => result?.net)).toEqual([95, -50, -10]);
    expect(state.seats.map((seat) => seat.chips)).toEqual([1095, 950, 990]);
    // The next round's betting is open again.
    expect(baccarat.toMove(state)).toEqual([0, 1, 2]);
  });

  it("leaves the shoe out of views", () => {
    const state = baccarat.start(2, random);
    const view = baccarat.viewFor(state, 0);
    expect("shoe" in view).toBe(false);
    expect(view.shoeSize).toBe(state.shoe.length);
  });

  it("sits out a seat with no chips, ends when no one has any, and scores a closed table by chips", () => {
    let state = withShoe(2, "2 3 4 6");
    state = { ...state, seats: [{ chips: 0, bet: null, isInRound: false }, { chips: 10, bet: null, isInRound: true }] };
    expect(baccarat.toMove(state)).toEqual([1]);
    expect(baccarat.choices(state, 0)).toEqual([]);
    expect(baccarat.finish!(state)).toEqual({ winners: [1], summary: "Most chips: 10" });
    state = accepted(baccarat.play(state, 1, { kind: "bet", on: "player", amount: 10 }, random));
    expect(baccarat.outcome(state)).toEqual({ winners: [], summary: "Everyone is out of chips; the bank wins" });
    expect(baccarat.toMove(state)).toEqual([]);
  });

  it("offers a few bet sizes on each side, and the simple player bets small on the banker", () => {
    const state = baccarat.start(1, random);
    const labels = baccarat.choices(state, 0).map((choice) => choice.label);
    expect(labels).toContain("bet 50 on banker");
    expect(labels).toContain("bet 10 on tie");
    expect(new Set(labels).size).toBe(labels.length);
    const choice = baccarat.simpleStrategy!(baccarat.viewFor(state, 0), 0, baccarat.choices(state, 0), random);
    expect(choice.move).toEqual({ kind: "bet", on: "banker", amount: 25 });
  });

  it("plays many rounds with the simple strategy", () => {
    const gameRandom = seededRandom(12);
    let state = baccarat.start(3, gameRandom);
    for (let move = 0; move < 600 && !baccarat.outcome(state); move++) {
      const seat = baccarat.toMove(state)[0] as Seat;
      const choice = baccarat.simpleStrategy!(baccarat.viewFor(state, seat), seat, baccarat.choices(state, seat), gameRandom);
      state = accepted(baccarat.play(state, seat, choice.move, gameRandom));
    }
    expect(state.roundNumber).toBeGreaterThan(100);
  });
});
