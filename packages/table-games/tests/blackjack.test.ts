import { describe, expect, it } from "vitest";
import { freshDeck, type Card, type Rank } from "../src/casino.js";
import { basicStrategy, blackjack, handTotal, type BlackjackState } from "../src/games/blackjack.js";
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

// Ranks as cards, all hearts but the suit does not matter here.
function cards(ranks: string): Card[] {
  return ranks.split(" ").map((rank) => ({ rank: rank as Rank, suit: "hearts" }));
}

// A table whose shoe starts with these cards (dealt player by player, then the dealer, twice).
function withShoe(playerCount: number, ranks: string): BlackjackState {
  const state = blackjack.start(playerCount, seededRandom(3));
  return { ...state, shoe: [...cards(ranks), ...freshDeck(2)] };
}

describe("Blackjack", () => {
  const random = seededRandom(5);

  it("counts aces as 11 or 1", () => {
    expect(handTotal(cards("A 6"))).toEqual({ total: 17, isSoft: true });
    expect(handTotal(cards("A 6 10"))).toEqual({ total: 17, isSoft: false });
    expect(handTotal(cards("A A 9"))).toEqual({ total: 21, isSoft: true });
    expect(handTotal(cards("K Q 5"))).toEqual({ total: 25, isSoft: false });
  });

  it("takes everyone's bets at once, then plays the hands in seat order", () => {
    let state = blackjack.start(3, random);
    expect(blackjack.toMove(state)).toEqual([0, 1, 2]);
    expect(blackjack.play(state, 0, { kind: "bet", amount: 5 }, random).ok).toBe(false);
    expect(blackjack.play(state, 0, { kind: "bet", amount: 501 }, random).ok).toBe(false);
    expect(blackjack.play(state, 0, { kind: "hit" }, random).ok).toBe(false);
    state = accepted(blackjack.play(state, 1, { kind: "bet", amount: 50 }, random));
    expect(blackjack.toMove(state)).toEqual([0, 2]);
    expect(blackjack.play(state, 1, { kind: "bet", amount: 50 }, random).ok).toBe(false);
    state = accepted(blackjack.play(state, 0, { kind: "bet", amount: 10 }, random));
    state = accepted(blackjack.play(state, 2, { kind: "bet", amount: 25 }, random));
    expect(state.players.map((player) => player.chips)).toEqual([990, 950, 975]);
    // Unless a blackjack ended the round, the cards are out and someone is to play.
    if (state.phase === "playing") {
      expect(state.players.every((player) => player.cards.length === 2)).toBe(true);
      expect(state.dealerCards).toHaveLength(2);
      expect(blackjack.toMove(state)).toHaveLength(1);
    }
  });

  it("hides the dealer's hole card and the shoe until the players are done", () => {
    let state = withShoe(1, "10 9 7 8 5");
    state = accepted(blackjack.play(state, 0, { kind: "bet", amount: 100 }, random));
    const view = blackjack.viewFor(state, 0);
    expect(view.dealerCards).toEqual([cards("9")[0], null]);
    expect("shoe" in view).toBe(false);
    expect(view.shoeSize).toBe(state.shoe.length);
    state = accepted(blackjack.play(state, 0, { kind: "stand" }, random));
    // Player 17 against the dealer's 9 8 = 17: a push.
    expect(blackjack.viewFor(state, 0).lastRound?.dealerCards).toEqual(cards("9 8"));
    expect(state.lastRound?.hands[0]).toEqual(expect.objectContaining({ result: "push", net: 0 }));
    expect(state.players[0].chips).toBe(1000);
    expect(state.phase).toBe("betting");
  });

  it("pays a blackjack 3 to 2", () => {
    let state = withShoe(1, "A 9 K 7");
    state = accepted(blackjack.play(state, 0, { kind: "bet", amount: 100 }, random));
    expect(state.lastRound?.hands[0]).toEqual(expect.objectContaining({ result: "blackjack", net: 150 }));
    expect(state.players[0].chips).toBe(1150);
  });

  it("draws the dealer to 17 and stands on a soft 17", () => {
    // Dealer A 6 is a soft 17: it stands, and the player's 18 wins.
    let state = withShoe(1, "10 A 8 6 K");
    state = accepted(blackjack.play(state, 0, { kind: "bet", amount: 100 }, random));
    state = accepted(blackjack.play(state, 0, { kind: "stand" }, random));
    expect(state.lastRound?.dealerCards).toEqual(cards("A 6"));
    expect(state.players[0].chips).toBe(1100);
    // Dealer 10 2 draws 3 then 4 to reach 19, beating the player's 18.
    state = { ...state, shoe: [...cards("10 10 8 2 3 4"), ...freshDeck(2)] };
    state = accepted(blackjack.play(state, 0, { kind: "bet", amount: 100 }, random));
    state = accepted(blackjack.play(state, 0, { kind: "stand" }, random));
    expect(state.lastRound?.dealerCards).toEqual(cards("10 2 3 4"));
    expect(state.lastRound?.hands[0]).toEqual(expect.objectContaining({ result: "lose", net: -100 }));
    expect(state.players[0].chips).toBe(1000);
  });

  it("pays 1 to 1 when the dealer busts, and loses a busted hand whatever the dealer does", () => {
    let state = withShoe(2, "10 9 6 5 6 10 10");
    state = accepted(blackjack.play(state, 0, { kind: "bet", amount: 100 }, random));
    state = accepted(blackjack.play(state, 1, { kind: "bet", amount: 100 }, random));
    // Seat 0 has 10 5 = 15 and hits a 10: bust. Seat 1 stands on 9 6 = 15; the dealer's 6 10 then draws a king.
    state = accepted(blackjack.play(state, 0, { kind: "hit" }, random));
    expect(state.players[0].isDone).toBe(true);
    expect(blackjack.toMove(state)).toEqual([1]);
    state = { ...state, shoe: [...cards("K"), ...state.shoe] };
    state = accepted(blackjack.play(state, 1, { kind: "stand" }, random));
    expect(state.lastRound?.dealerTotal).toBe(26);
    expect(state.lastRound?.hands.map((hand) => hand?.result)).toEqual(["bust", "win"]);
    expect(state.players.map((player) => player.chips)).toEqual([900, 1100]);
  });

  it("doubles down: twice the bet and exactly one card", () => {
    let state = withShoe(1, "6 10 5 7 9");
    state = accepted(blackjack.play(state, 0, { kind: "bet", amount: 100 }, random));
    expect(blackjack.choices(state, 0).map((choice) => choice.label)).toEqual(["hit (hand 11)", "stand (hand 11)", "double down (hand 11)"]);
    state = accepted(blackjack.play(state, 0, { kind: "double" }, random));
    expect(state.lastRound?.hands[0]).toEqual(expect.objectContaining({ cards: cards("6 5 9"), bet: 200, result: "win", net: 200 }));
    expect(state.players[0].chips).toBe(1200);
  });

  it("ends the round at once on a dealer blackjack, pushing a player's blackjack", () => {
    let state = withShoe(2, "10 A A 9 K K");
    state = accepted(blackjack.play(state, 0, { kind: "bet", amount: 100 }, random));
    state = accepted(blackjack.play(state, 1, { kind: "bet", amount: 100 }, random));
    expect(state.phase).toBe("betting");
    expect(state.lastRound?.hands.map((hand) => hand?.result)).toEqual(["lose", "push"]);
    expect(state.players.map((player) => player.chips)).toEqual([900, 1000]);
  });

  it("sits out a seat with no chips, ends when no one has any, and scores a closed table by chips", () => {
    let state = withShoe(2, "10 10 6 9 10");
    state = { ...state, players: state.players.map((player, seat) => ({ ...player, chips: seat === 0 ? 0 : 10, isInRound: seat === 1 })) };
    expect(blackjack.toMove(state)).toEqual([1]);
    expect(blackjack.choices(state, 0)).toEqual([]);
    expect(blackjack.choices(state, 1).map((choice) => choice.label)).toEqual(["bet 10"]);
    state = accepted(blackjack.play(state, 1, { kind: "bet", amount: 10 }, random));
    expect(blackjack.finish!(state)).toEqual({ winners: [1], summary: "Most chips: 10" });
    state = accepted(blackjack.play(state, 1, { kind: "hit" }, random));
    expect(blackjack.outcome(state)).toEqual({ winners: [], summary: "Everyone is out of chips; the house wins" });
    expect(blackjack.toMove(state)).toEqual([]);
  });

  it("follows basic strategy", () => {
    const up = (rank: string): Card => cards(rank)[0];
    expect(basicStrategy(cards("10 6"), up("5"))).toBe("stand");
    expect(basicStrategy(cards("10 6"), up("10"))).toBe("hit");
    expect(basicStrategy(cards("6 5"), up("A"))).toBe("double");
    expect(basicStrategy(cards("A 7"), up("9"))).toBe("hit");
    expect(basicStrategy(cards("10 7"), up("A"))).toBe("stand");
  });

  it("plays many rounds with the simple strategy, every move legal", () => {
    const gameRandom = seededRandom(11);
    let state = blackjack.start(4, gameRandom);
    for (let move = 0; move < 2000 && !blackjack.outcome(state); move++) {
      const seat = blackjack.toMove(state)[0] as Seat;
      const choices = blackjack.choices(state, seat);
      expect(new Set(choices.map((choice) => choice.label)).size).toBe(choices.length);
      const choice = blackjack.simpleStrategy!(blackjack.viewFor(state, seat), seat, choices, gameRandom);
      state = accepted(blackjack.play(state, seat, choice.move, gameRandom));
    }
    expect(state.roundNumber).toBeGreaterThan(50);
  });
});
