import { describe, expect, it } from "vitest";
import type { Card, Rank, Suit } from "../src/casino.js";
import { BIG_BLIND, isStillIn, poker, potTotal, SMALL_BLIND, splitPots, type PokerPlayer, type PokerState } from "../src/games/poker.js";
import { bestHand, compareScores } from "../src/games/pokerHands.js";
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

// "As Kd 10h" as cards.
function cards(text: string): Card[] {
  const suits: Record<string, Suit> = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" };
  return text.split(" ").map((name) => ({ rank: name.slice(0, -1) as Rank, suit: suits[name.slice(-1)] }));
}

function totalChips(state: PokerState): number {
  return state.players.reduce((sum, player) => sum + player.chips + player.handBet, 0);
}

describe("poker hands", () => {
  const value = (text: string) => bestHand(cards(text));
  const beats = (better: string, worse: string): void => {
    expect(compareScores(value(better).score, value(worse).score), `${better} over ${worse}`).toBeGreaterThan(0);
  };

  it("names each category", () => {
    expect(value("As Ks Qs Js 10s").name).toBe("royal flush");
    expect(value("9h 8h 7h 6h 5h").category).toBe("straight flush");
    expect(value("Kc Kd Kh Ks 2c").name).toBe("four kings");
    expect(value("Kc Kd Kh 7s 7c").name).toBe("full house, kings over sevens");
    expect(value("2h 9h Jh 4h Kh").category).toBe("flush");
    expect(value("6c 7d 8h 9s 10c").name).toBe("straight, ten high");
    expect(value("Ac 2d 3h 4s 5c").name).toBe("straight, five high");
    expect(value("6c 6d 6h Ks 2c").name).toBe("three sixes");
    expect(value("Jc Jd 4h 4s 2c").category).toBe("two pair");
    expect(value("Qc Qd 9h 4s 2c").name).toBe("pair of queens");
    expect(value("Ac Jd 9h 4s 2c").name).toBe("ace high");
  });

  it("ranks the categories in order", () => {
    const ladder = ["9h 8h 7h 6h 5h", "Kc Kd Kh Ks 2c", "Kc Kd Kh 7s 7c", "2h 9h Jh 4h Kh", "6c 7d 8h 9s 10c", "6c 6d 6h Ks 2c", "Jc Jd 4h 4s 2c", "Qc Qd 9h 4s 2c", "Ac Jd 9h 4s 2c"];
    for (let index = 0; index + 1 < ladder.length; index++) beats(ladder[index], ladder[index + 1]);
  });

  it("plays the ace low only in the wheel, the lowest straight", () => {
    beats("2c 3d 4h 5s 6c", "Ac 2d 3h 4s 5c");
    beats("10c Jd Qh Ks Ac", "9c 10d Jh Qs Kc");
    expect(value("Qc Kd Ah 2s 3c").category).toBe("high card");
  });

  it("breaks ties by kickers", () => {
    beats("Ac Ad Kh 4s 2c", "As Ah Qh 4c 3c");
    beats("Jc Jd 4h 4s Ac", "Js Jh 4c 4d Kc");
    beats("Jc Jd 5h 5s 2c", "Js Jh 4c 4d Ac");
    beats("Kc Kd Kh 2s 2c", "Qs Qh Qc Ad Ac");
    beats("Ah 9h 7h 4h 3h", "Ad 9d 7d 4d 2d");
    expect(compareScores(value("Ac Kd Qh Js 9c").score, value("Ad Kc Qs Jh 9d").score)).toBe(0);
  });

  it("finds the best five of seven", () => {
    expect(value("As Ks 2s 7s 9d 9c Js").category).toBe("flush");
    expect(value("9c 9d 9h 4s 4c 4d 2c").name).toBe("full house, nines over fours");
    expect(value("Ac 2d 3h 4s 5c 6d Kh").name).toBe("straight, six high");
    expect(value("2c 2d Ah Ks Qd Jc 3h").score).toEqual([1, 2, 14, 13, 12]);
  });
});

describe("Texas hold'em", () => {
  const random = seededRandom(7);

  // A hand set up by the test: these hole cards, this board to come, these chips (blinds included).
  function rigged(playerCount: number, holes: string[], board: string, stacks: number[]): PokerState {
    const state = poker.start(playerCount, random);
    const [flop1, flop2, flop3, turn, river] = cards(board);
    const burn = cards("2c")[0];
    return {
      ...state,
      players: state.players.map((player, seat): PokerPlayer => ({ ...player, holeCards: cards(holes[seat]), chips: stacks[seat] - player.streetBet })),
      deck: [burn, flop1, flop2, flop3, burn, turn, burn, river, ...cards("3d 4d 5d 6d 7d 8d")],
    };
  }

  it("deals two cards each and posts the blinds left of the button", () => {
    const state = poker.start(4, random);
    expect(state.players.every((player) => player.holeCards.length === 2)).toBe(true);
    expect(state.deck).toHaveLength(52 - 8);
    expect([state.dealer, state.smallBlindSeat, state.bigBlindSeat]).toEqual([0, 1, 2]);
    expect(state.players[1].streetBet).toBe(SMALL_BLIND);
    expect(state.players[2].streetBet).toBe(BIG_BLIND);
    expect(poker.toMove(state)).toEqual([3]);
    expect(totalChips(state)).toBe(4000);
  });

  it("heads-up, the button posts the small blind and acts first", () => {
    const state = poker.start(2, random);
    expect([state.dealer, state.smallBlindSeat, state.bigBlindSeat]).toEqual([0, 0, 1]);
    expect(poker.toMove(state)).toEqual([0]);
  });

  it("hides the other players' cards and the deck", () => {
    const state = poker.start(3, random);
    const view = poker.viewFor(state, 1);
    expect(view.players[1].holeCards).toEqual(state.players[1].holeCards);
    expect(view.players[0].holeCards).toBeNull();
    expect(view.players[2].holeCards).toBeNull();
    expect("deck" in view).toBe(false);
    expect(poker.viewFor(state, null).players.every((player) => player.holeCards === null)).toBe(true);
    for (const card of [...state.players[0].holeCards, ...state.players[2].holeCards]) expect(JSON.stringify(view)).not.toContain(JSON.stringify(card));
  });

  it("checks moves and bet sizes", () => {
    const state = poker.start(3, random);
    // Seat 0 is first to act, facing the big blind of 10.
    expect(poker.play(state, 1, { kind: "call" }, random)).toEqual({ ok: false, error: "Not your turn" });
    expect(poker.play(state, 0, { kind: "check" }, random).ok).toBe(false);
    expect(poker.play(state, 0, { kind: "raise", to: 15 }, random).ok).toBe(false);
    expect(poker.play(state, 0, { kind: "raise", to: 1001 }, random).ok).toBe(false);
    expect(poker.play(state, 0, { kind: "raise", to: 20.5 }, random).ok).toBe(false);
    expect(poker.play(state, 0, "fold", random).ok).toBe(false);
    const raised = accepted(poker.play(state, 0, { kind: "raise", to: 37 }, random));
    expect(raised.currentBet).toBe(37);
    expect(raised.minimumRaise).toBe(27);
    expect(poker.play(raised, 1, { kind: "raise", to: 60 }, random).ok).toBe(false);
    expect(accepted(poker.play(raised, 1, { kind: "raise", to: 64 }, random)).currentBet).toBe(64);
  });

  it("offers the minimum raise, a pot-sized raise and all in, with unique labels", () => {
    const state = poker.start(3, random);
    const labels = poker.choices(state, 0).map((choice) => choice.label);
    expect(labels).toEqual(["fold", "call 10", "raise to 20", "raise to 35", "all in (raise to 1000)"]);
    expect(poker.choices(state, 1)).toEqual([]);
  });

  it("gives the pot to the last player in when the others fold, and moves the button", () => {
    let state = poker.start(3, random);
    state = accepted(poker.play(state, 0, { kind: "fold" }, random));
    state = accepted(poker.play(state, 1, { kind: "fold" }, random));
    expect(state.lastHand?.won).toEqual([0, 0, 15]);
    expect(state.lastHand?.shown).toEqual([]);
    expect(state.handNumber).toBe(2);
    expect([state.dealer, state.smallBlindSeat, state.bigBlindSeat]).toEqual([1, 2, 0]);
    expect(state.players.map((player) => player.chips + player.handBet)).toEqual([1000, 995, 1005]);
  });

  it("deals the flop, turn and river, with the first player left of the button acting after the flop", () => {
    let state = poker.start(3, random);
    state = accepted(poker.play(state, 0, { kind: "call" }, random));
    state = accepted(poker.play(state, 1, { kind: "call" }, random));
    // The big blind may still raise: its option.
    expect(poker.toMove(state)).toEqual([2]);
    state = accepted(poker.play(state, 2, { kind: "check" }, random));
    expect(state.street).toBe("flop");
    expect(state.community).toHaveLength(3);
    expect(poker.toMove(state)).toEqual([1]);
    for (const street of ["turn", "river"]) {
      for (const seat of [1, 2, 0]) state = accepted(poker.play(state, seat, { kind: "check" }, random));
      expect(state.street).toBe(street);
    }
    expect(state.community).toHaveLength(5);
    for (const seat of [1, 2, 0]) state = accepted(poker.play(state, seat, { kind: "check" }, random));
    expect(state.lastHand?.shown).toHaveLength(3);
    expect(state.handNumber).toBe(2);
    expect(totalChips(state)).toBe(3000);
  });

  it("splits side pots: a short all-in wins only what each other player matched", () => {
    // Seat 0 (100 chips) has aces, seat 1 kings, seat 2 queens; no help on the board.
    let state = rigged(3, ["Ac Ad", "Kc Kd", "Qc Qd"], "2s 7d 9h Js 3c", [100, 300, 300]);
    expect(totalChips(state)).toBe(700);
    state = accepted(poker.play(state, 0, { kind: "raise", to: 100 }, random));
    state = accepted(poker.play(state, 1, { kind: "raise", to: 200 }, random));
    state = accepted(poker.play(state, 2, { kind: "call" }, random));
    for (let street = 0; street < 3; street++) for (const seat of [1, 2]) state = accepted(poker.play(state, seat, { kind: "check" }, random));
    expect(state.lastHand?.pots.map((pot) => [pot.amount, pot.winners])).toEqual([
      [300, [0]],
      [200, [1]],
    ]);
    expect(state.lastHand?.won).toEqual([300, 200, 0]);
    expect(state.lastHand?.shown.map((hand) => hand.handName)).toEqual(["pair of aces", "pair of kings", "pair of queens"]);
    expect(totalChips(state)).toBe(700);
    expect(state.players.map((player) => player.chips + player.handBet)).toEqual([300, 300, 100]);
  });

  it("runs out the board when everyone is all in, and returns an uncalled bet", () => {
    let state = rigged(3, ["Ac Ad", "Kc Kd", "Qc Qd"], "2s 7d 9h Js 3c", [100, 300, 500]);
    state = accepted(poker.play(state, 0, { kind: "raise", to: 100 }, random));
    state = accepted(poker.play(state, 1, { kind: "raise", to: 300 }, random));
    state = accepted(poker.play(state, 2, { kind: "raise", to: 500 }, random));
    // Seat 2's last 200 is unmatched and comes back to it.
    expect(state.lastHand?.pots.map((pot) => [pot.amount, pot.winners])).toEqual([
      [300, [0]],
      [400, [1]],
      [200, [2]],
    ]);
    expect(state.lastHand?.community).toHaveLength(5);
  });

  it("splits a tied pot, odd chips to the left of the button", () => {
    const players = [
      { chips: 0, handBet: 5, streetBet: 0, isInHand: true, hasFolded: false, hasActed: true },
      { chips: 0, handBet: 50, streetBet: 0, isInHand: true, hasFolded: true, hasActed: true },
      { chips: 0, handBet: 50, streetBet: 0, isInHand: true, hasFolded: false, hasActed: true },
      { chips: 0, handBet: 50, streetBet: 0, isInHand: true, hasFolded: false, hasActed: true },
    ];
    expect(splitPots(players)).toEqual([
      { amount: 20, eligible: [0, 2, 3] },
      { amount: 135, eligible: [2, 3] },
    ]);
    let state = rigged(3, ["Ac Kd", "As Kh", "2d 3h"], "Qs Jd 10h 5s 4c", [1000, 1000, 1000]);
    state = accepted(poker.play(state, 0, { kind: "raise", to: 51 }, random));
    state = accepted(poker.play(state, 1, { kind: "call" }, random));
    state = accepted(poker.play(state, 2, { kind: "fold" }, random));
    for (let street = 0; street < 3; street++) for (const seat of [1, 0]) state = accepted(poker.play(state, seat, { kind: "check" }, random));
    expect(state.lastHand?.pots).toEqual([{ amount: 112, winners: [0, 1], handName: "straight, ace high" }]);
    expect(state.lastHand?.won).toEqual([56, 56, 0]);
    expect(state.lastHand?.summary).toBe("Player 1 and Player 2 split with straight, ace high");
  });

  it("ends when one player has all the chips, and scores a closed table by chips", () => {
    let state = rigged(2, ["2c 7d", "Ac Ad"], "Ks Qd 9h 5s 4c", [50, 950]);
    expect(poker.finish!(state)).toEqual({ winners: [1], summary: "Most chips: 950" });
    state = accepted(poker.play(state, 0, { kind: "raise", to: 50 }, random));
    state = accepted(poker.play(state, 1, { kind: "call" }, random));
    expect(poker.outcome(state)).toEqual({ winners: [1], summary: "Player 2 has all the chips" });
    expect(poker.toMove(state)).toEqual([]);
    expect(poker.choices(state, 1)).toEqual([]);
    expect(poker.play(state, 1, { kind: "check" }, random).ok).toBe(false);
  });

  it("plays whole games with the simple strategy, keeping every chip and every move legal", () => {
    for (const playerCount of [2, 4, 6]) {
      const gameRandom = seededRandom(playerCount * 31);
      let state = poker.start(playerCount, gameRandom);
      for (let move = 0; move < 3000 && !poker.outcome(state); move++) {
        const [seat] = poker.toMove(state) as Seat[];
        const choices = poker.choices(state, seat);
        expect(new Set(choices.map((choice) => choice.label)).size).toBe(choices.length);
        const choice = poker.simpleStrategy!(poker.viewFor(state, seat), seat, choices, gameRandom);
        state = accepted(poker.play(state, seat, choice.move, gameRandom));
        expect(totalChips(state)).toBe(playerCount * 1000);
        if (poker.outcome(state)) break;
        expect(potTotal(state.players)).toBeGreaterThan(0);
        expect(state.players.filter(isStillIn).length).toBeGreaterThan(1);
      }
      expect(state.handNumber).toBeGreaterThan(5);
    }
  });
});
