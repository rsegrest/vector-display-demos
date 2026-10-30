import { chipsOutcome, freshDeck, shuffled, STARTING_CHIPS, type Card } from "../casino.js";
import { isRecord, refuse, type Choice, type MoveResult, type Outcome, type Seat, type TableGame } from "../TableGame.js";
import { bestHand, compareScores, RANK_VALUES, type HandValue } from "./pokerHands.js";

// No-limit Texas hold'em for two to six players, with blinds of 5 and 10 and a dealer button
// that moves one seat to the left each hand. The hands follow one another with no one having to
// deal: as soon as one is settled (all but one player folded, or the showdown), the next is dealt
// and its blinds posted, and the settled hand is kept in `lastHand` so everyone can still see
// who won and with what. A player with no chips left sits out; the game ends when one player
// has every chip, or the host closes the table and the most chips win.
//
// Bets are counted in two ways for each player: `streetBet`, what they have put in during this
// betting round (to match the round's `currentBet`), and `handBet`, everything they have put in
// this hand. The pot is the sum of the hand bets, and side pots are cut from them at the
// showdown, so a player all in for less can win only what each other player matched.

export const SMALL_BLIND = 5;
export const BIG_BLIND = 10;
export const POKER_MIN_PLAYERS = 2;
export const POKER_MAX_PLAYERS = 6;
// Hands dealt in a row without anyone choosing a move (everyone all in from the blinds) before
// the table is called; it keeps a table of tiny stacks splitting pot after pot from never ending.
const MOST_HANDS_WITHOUT_A_DECISION = 200;

export type Street = "preflop" | "flop" | "turn" | "river";
const STREETS: readonly Street[] = ["preflop", "flop", "turn", "river"];

export interface PokerPlayer {
  // Chips in front of the player, not yet bet.
  readonly chips: number;
  readonly holeCards: readonly Card[];
  readonly streetBet: number;
  readonly handBet: number;
  // Dealt into this hand: had chips when it was dealt.
  readonly isInHand: boolean;
  readonly hasFolded: boolean;
  // Has acted since the betting was last raised, in this round.
  readonly hasActed: boolean;
}

export interface PokerPot {
  readonly amount: number;
  readonly winners: readonly Seat[];
  // The winning hand's name, or null when everyone else folded (or no one matched the bet).
  readonly handName: string | null;
}

// A settled hand, shown until the next one is settled.
export interface PokerHandResult {
  readonly handNumber: number;
  readonly community: readonly Card[];
  // The hands turned over at the showdown (none when the hand ended with folds).
  readonly shown: readonly { readonly seat: Seat; readonly cards: readonly Card[]; readonly handName: string }[];
  readonly pots: readonly PokerPot[];
  // What each seat took from the pots.
  readonly won: readonly number[];
  readonly summary: string;
}

export interface PokerState {
  readonly handNumber: number;
  readonly dealer: Seat;
  readonly smallBlindSeat: Seat;
  readonly bigBlindSeat: Seat;
  readonly street: Street;
  readonly community: readonly Card[];
  readonly deck: readonly Card[];
  readonly players: readonly PokerPlayer[];
  // Whose move it is; null only once the game is over.
  readonly turn: Seat | null;
  // The street bet everyone still in must match.
  readonly currentBet: number;
  // The smallest raise allowed now: the big blind, or the last full raise if larger.
  readonly minimumRaise: number;
  readonly lastAction: { readonly seat: Seat; readonly text: string } | null;
  readonly lastHand: PokerHandResult | null;
  readonly outcome: Outcome | null;
}

// In a view, another player's hole cards are null (face down) and the deck is left out.
export interface PokerPlayerView extends Omit<PokerPlayer, "holeCards"> {
  readonly holeCards: readonly Card[] | null;
}
export interface PokerView extends Omit<PokerState, "deck" | "players"> {
  readonly players: readonly PokerPlayerView[];
}

export type PokerMove =
  | { readonly kind: "fold" }
  | { readonly kind: "check" }
  | { readonly kind: "call" }
  // `to` is the player's whole bet for this round after the raise (a first bet is a raise from 0).
  | { readonly kind: "raise"; readonly to: number };

// ── Reading the table ──────────────────────────────────────────────────────

type AnyPlayer = Omit<PokerPlayer, "holeCards">;

export function isStillIn(player: AnyPlayer): boolean {
  return player.isInHand && !player.hasFolded;
}

export function isAllIn(player: AnyPlayer): boolean {
  return isStillIn(player) && player.chips === 0;
}

// Still in the hand with chips to bet.
function canBet(player: AnyPlayer): boolean {
  return isStillIn(player) && player.chips > 0;
}

export function potTotal(players: readonly AnyPlayer[]): number {
  return players.reduce((sum, player) => sum + player.handBet, 0);
}

// The first seat after `from`, going around the table, that passes `test` (`from` itself last).
function seatAfter(count: number, from: Seat, test: (seat: Seat) => boolean): Seat | null {
  for (let step = 1; step <= count; step++) {
    const seat = (from + step) % count;
    if (test(seat)) return seat;
  }
  return null;
}

// What a seat must add to stay in, and the most its round's bet could be (all in).
export function amountToCall(state: Pick<PokerState, "currentBet">, player: AnyPlayer): number {
  return Math.min(player.chips, Math.max(0, state.currentBet - player.streetBet));
}

function withPlayer(players: readonly PokerPlayer[], seat: Seat, change: Partial<PokerPlayer>): PokerPlayer[] {
  return players.map((player, index) => (index === seat ? { ...player, ...change } : player));
}

// Who must still act this round: a player with chips who has not acted since the last raise,
// or has not matched it. When only one player could still bet and has matched, no one must:
// there is nobody left to bet against.
function nextToAct(state: PokerState, after: Seat): Seat | null {
  const { players, currentBet } = state;
  const bettors = players.filter(canBet);
  if (bettors.length === 0) return null;
  if (bettors.length === 1 && bettors[0].streetBet >= currentBet) return null;
  return seatAfter(players.length, after, (seat) => canBet(players[seat]) && (!players[seat].hasActed || players[seat].streetBet < currentBet));
}

// ── Dealing and settling hands ─────────────────────────────────────────────

function emptyPlayer(chips: number): PokerPlayer {
  return { chips, holeCards: [], streetBet: 0, handBet: 0, isInHand: false, hasFolded: false, hasActed: false };
}

function postBlind(players: PokerPlayer[], seat: Seat, blind: number): void {
  const amount = Math.min(blind, players[seat].chips);
  players[seat] = { ...players[seat], chips: players[seat].chips - amount, streetBet: amount, handBet: amount };
}

// A new hand from the chips each seat has now, or the end of the game if fewer than two have any.
function dealHand(previous: PokerState, random: () => number): PokerState {
  const count = previous.players.length;
  const seated = previous.players.map((player) => player.chips > 0);
  const seatedCount = seated.filter(Boolean).length;
  if (seatedCount < 2) {
    const winner = seated.indexOf(true);
    return {
      ...previous,
      turn: null,
      outcome: winner >= 0 ? { winners: [winner], summary: `Player ${winner + 1} has all the chips` } : { winners: [], summary: "No chips are left" },
    };
  }
  const isFirstHand = previous.handNumber === 0;
  const dealer = isFirstHand && seated[0] ? 0 : seatAfter(count, previous.dealer, (seat) => seated[seat])!;
  // Heads-up, the dealer posts the small blind and acts first before the flop.
  const smallBlindSeat = seatedCount === 2 ? dealer : seatAfter(count, dealer, (seat) => seated[seat])!;
  const bigBlindSeat = seatAfter(count, smallBlindSeat, (seat) => seated[seat])!;

  let deck = shuffled(freshDeck(), random);
  const holeCards: Card[][] = previous.players.map(() => []);
  // Two rounds of one card each, starting left of the dealer.
  for (let round = 0; round < 2; round++) {
    for (let step = 1; step <= count; step++) {
      const seat = (dealer + step) % count;
      if (!seated[seat]) continue;
      holeCards[seat].push(deck[0]);
      deck = deck.slice(1);
    }
  }
  const players = previous.players.map((player, seat): PokerPlayer => ({ ...emptyPlayer(player.chips), holeCards: holeCards[seat], isInHand: seated[seat] }));
  postBlind(players, smallBlindSeat, SMALL_BLIND);
  postBlind(players, bigBlindSeat, BIG_BLIND);

  const dealt: PokerState = {
    ...previous,
    handNumber: previous.handNumber + 1,
    dealer,
    smallBlindSeat,
    bigBlindSeat,
    street: "preflop",
    community: [],
    deck,
    players,
    turn: null,
    currentBet: Math.max(...players.map((player) => player.streetBet)),
    minimumRaise: BIG_BLIND,
    lastAction: null,
    outcome: null,
  };
  // The first to act is left of the big blind (heads-up, that is the dealer).
  return { ...dealt, turn: nextToAct(dealt, bigBlindSeat) };
}

// Pots cut from the hand bets: one for each level a player still in went all in at, each won by
// the best hand among the players who put in that much. Folded players' chips go into the pots
// they reached, but they cannot win them.
export function splitPots(players: readonly AnyPlayer[]): { amount: number; eligible: Seat[] }[] {
  const levels = [...new Set(players.filter(isStillIn).map((player) => player.handBet))].sort((a, b) => a - b);
  const pots: { amount: number; eligible: Seat[] }[] = [];
  let below = 0;
  for (const level of levels) {
    const amount = players.reduce((sum, player) => sum + Math.max(0, Math.min(player.handBet, level) - below), 0);
    const eligible = players.flatMap((player, seat) => (isStillIn(player) && player.handBet >= level ? [seat] : []));
    if (amount > 0) pots.push({ amount, eligible });
    below = level;
  }
  // Anything a folded player put in above every live player's bet (it cannot happen in a hand
  // played by these rules, but the chips must go somewhere) joins the last pot.
  const counted = pots.reduce((sum, pot) => sum + pot.amount, 0);
  if (pots.length > 0) pots[pots.length - 1].amount += potTotal(players) - counted;
  return pots;
}

// Shares a pot among its winners; odd chips go one by one to the winners nearest the dealer's left.
function share(amount: number, winners: readonly Seat[], dealer: Seat, count: number): number[] {
  const won = Array<number>(count).fill(0);
  const ordered = [...winners].sort((a, b) => ((a - dealer - 1 + count) % count) - ((b - dealer - 1 + count) % count));
  ordered.forEach((seat, index) => {
    won[seat] = Math.floor(amount / ordered.length) + (index < amount % ordered.length ? 1 : 0);
  });
  return won;
}

function settle(state: PokerState): PokerState {
  const { players, dealer, community } = state;
  const count = players.length;
  const live = players.flatMap((player, seat) => (isStillIn(player) ? [seat] : []));
  const isShowdown = live.length > 1;
  const values = new Map<Seat, HandValue>(isShowdown ? live.map((seat) => [seat, bestHand([...players[seat].holeCards, ...community])]) : []);
  const won = Array<number>(count).fill(0);
  const pots: PokerPot[] = splitPots(players).map(({ amount, eligible }) => {
    let winners = eligible;
    if (eligible.length > 1) {
      const best = eligible.reduce((top, seat) => (compareScores(values.get(seat)!.score, values.get(top)!.score) > 0 ? seat : top));
      winners = eligible.filter((seat) => compareScores(values.get(seat)!.score, values.get(best)!.score) === 0);
    }
    share(amount, winners, dealer, count).forEach((chips, seat) => (won[seat] += chips));
    return { amount, winners, handName: eligible.length > 1 ? values.get(winners[0])!.name : null };
  });
  const main = pots[0];
  const winnersText = main.winners.map((seat) => `Player ${seat + 1}`).join(" and ");
  const summary = main.handName ? `${winnersText} ${main.winners.length > 1 ? "split" : "wins"} with ${main.handName}` : `${winnersText} wins ${main.amount}`;
  return {
    ...state,
    players: players.map((player, seat) => ({ ...player, chips: player.chips + won[seat], streetBet: 0, handBet: 0 })),
    turn: null,
    lastHand: {
      handNumber: state.handNumber,
      community,
      shown: isShowdown ? live.map((seat) => ({ seat, cards: players[seat].holeCards, handName: values.get(seat)!.name })) : [],
      pots,
      won,
      summary,
    },
  };
}

// Deals the next street's cards (after a burn card), or settles at the end of the river.
function nextStreet(state: PokerState): PokerState {
  const players = state.players.map((player) => ({ ...player, streetBet: 0, hasActed: false }));
  const street = STREETS[STREETS.indexOf(state.street) + 1];
  const cardsDealt = state.street === "preflop" ? 3 : 1;
  return {
    ...state,
    street,
    players,
    community: [...state.community, ...state.deck.slice(1, 1 + cardsDealt)],
    deck: state.deck.slice(1 + cardsDealt),
    currentBet: 0,
    minimumRaise: BIG_BLIND,
  };
}

// After a move: the next player to act, or the next street, or the end of the hand and the
// deal of the next one, until someone must choose a move or the game is over.
function proceed(state: PokerState, actor: Seat, random: () => number): PokerState {
  let current = state;
  let after = actor;
  for (let handsDealt = 0; handsDealt < MOST_HANDS_WITHOUT_A_DECISION; ) {
    if (current.outcome) return current;
    const isSettled = current.players.filter(isStillIn).length <= 1;
    const next = isSettled ? null : nextToAct(current, after);
    if (next !== null) return { ...current, turn: next };
    if (isSettled || current.street === "river") {
      current = dealHand(settle(current), random);
      handsDealt++;
      if (current.turn !== null || current.outcome) return current;
      after = current.bigBlindSeat;
      continue;
    }
    current = nextStreet(current);
    // After the flop, the first to act is the first still in left of the dealer.
    after = current.dealer;
  }
  return { ...current, turn: null, outcome: chipsOutcome(current.players.map((player) => player.chips + player.handBet)) };
}

// ── Moves ──────────────────────────────────────────────────────────────────

function readMove(move: unknown): PokerMove | null {
  if (!isRecord(move)) return null;
  switch (move.kind) {
    case "fold":
    case "check":
    case "call":
      return { kind: move.kind };
    case "raise":
      return Number.isInteger(move.to) ? { kind: "raise", to: move.to as number } : null;
    default:
      return null;
  }
}

function applyMove(state: PokerState, seat: Seat, move: PokerMove): MoveResult<PokerState> {
  const player = state.players[seat];
  const owed = amountToCall(state, player);
  const pay = (amount: number, change: Partial<PokerPlayer> = {}): PokerPlayer[] =>
    withPlayer(state.players, seat, { chips: player.chips - amount, streetBet: player.streetBet + amount, handBet: player.handBet + amount, hasActed: true, ...change });
  switch (move.kind) {
    case "fold":
      return { ok: true, state: { ...state, players: withPlayer(state.players, seat, { hasFolded: true, hasActed: true }), lastAction: { seat, text: "folds" } } };
    case "check":
      if (owed > 0) return refuse(`You must call ${owed} or fold`);
      return { ok: true, state: { ...state, players: pay(0), lastAction: { seat, text: "checks" } } };
    case "call":
      if (owed === 0) return refuse("There is nothing to call; check instead");
      return { ok: true, state: { ...state, players: pay(owed), lastAction: { seat, text: owed === player.chips ? `calls ${owed}, all in` : `calls ${owed}` } } };
    case "raise": {
      const allInTo = player.streetBet + player.chips;
      if (allInTo <= state.currentBet) return refuse("You have only enough to call");
      if (move.to <= state.currentBet) return refuse(`Raise to more than ${state.currentBet}`);
      if (move.to > allInTo) return refuse(`You can bet at most ${allInTo}`);
      const raisedBy = move.to - state.currentBet;
      const isFullRaise = raisedBy >= state.minimumRaise;
      if (!isFullRaise && move.to !== allInTo) return refuse(`The smallest raise is to ${state.currentBet + state.minimumRaise}`);
      // Everyone else must answer the raise. (A short all-in raise reopens the betting here too,
      // a small simplification of the casino rule.)
      const players = pay(move.to - player.streetBet).map((other, index) => (index === seat ? other : { ...other, hasActed: false }));
      const verb = state.currentBet === 0 ? "bets" : "raises to";
      return {
        ok: true,
        state: {
          ...state,
          players,
          currentBet: move.to,
          minimumRaise: isFullRaise ? raisedBy : state.minimumRaise,
          lastAction: { seat, text: move.to === allInTo ? `${verb} ${move.to}, all in` : `${verb} ${move.to}` },
        },
      };
    }
  }
}

// Whether `seat` may usefully raise: pointless when no one else could answer it.
export function canBeRaised(players: readonly AnyPlayer[], seat: Seat): boolean {
  return players.some((other, index) => index !== seat && canBet(other));
}

// The raises offered as quick choices: the smallest, the size of the pot, and all in.
export function raiseSizes(state: { readonly currentBet: number; readonly minimumRaise: number; readonly players: readonly AnyPlayer[] }, seat: Seat): { to: number; label: string }[] {
  const player = state.players[seat];
  const allInTo = player.streetBet + player.chips;
  if (allInTo <= state.currentBet) return [];
  const owed = amountToCall(state, player);
  const verb = state.currentBet === 0 ? "bet" : "raise to";
  const sizes = [state.currentBet + state.minimumRaise, state.currentBet + potTotal(state.players) + owed].map((to) => Math.min(to, allInTo));
  const offered = [...new Set(sizes)].filter((to) => to < allInTo).map((to) => ({ to, label: `${verb} ${to}` }));
  return [...offered, { to: allInTo, label: `all in (${verb} ${allInTo})` }];
}

// How good a hand is, from 0 to 1, for the simple computer player: before the flop from the two
// hole cards, after it from the best hand made with the board.
export function handStrength(holeCards: readonly Card[], community: readonly Card[]): number {
  if (holeCards.length < 2) return 0;
  const [high, low] = holeCards.map((card) => RANK_VALUES[card.rank]).sort((a, b) => b - a);
  if (community.length === 0) {
    if (high === low) return 0.55 + (high / 14) * 0.45;
    const isSuited = holeCards[0].suit === holeCards[1].suit;
    const isConnected = high - low === 1;
    return ((high + low) / 28) * 0.7 + (isSuited ? 0.06 : 0) + (isConnected ? 0.04 : 0);
  }
  const value = bestHand([...holeCards, ...community]);
  const board = community.length >= 5 ? bestHand(community) : null;
  // A hand that is only the board's own (a pair on the board, say) is worth little more.
  if (board && compareScores(value.score, board.score) === 0) return 0.25;
  const byCategory = [0.15, 0.45, 0.65, 0.75, 0.85, 0.88, 0.93, 0.97, 1];
  const category = value.score[0];
  // Within high card and pair, the higher the ranks the better.
  const lift = category <= 1 ? (value.score[1] / 14) * 0.15 : 0;
  return byCategory[category] + lift;
}

export const poker: TableGame<PokerState, PokerView> = {
  id: "poker",
  title: "Texas Hold'em",
  description: "No-limit hold'em: two cards each, five shared, the best five-card hand wins.",
  family: "cards",
  minPlayers: POKER_MIN_PLAYERS,
  maxPlayers: POKER_MAX_PLAYERS,
  strategy:
    "Win chips. Each player has two hidden cards and shares five on the board; the best five-card hand of the seven wins the pot at the showdown, or the last player left wins it when everyone else folds. Raise with strong hands (high pairs, ace-king; after the flop two pair or better), call when the price is small compared with the pot, and fold weak hands facing a bet rather than chasing. Going all in risks every chip.",

  start(playerCount, random) {
    const before: PokerState = {
      handNumber: 0,
      dealer: 0,
      smallBlindSeat: 0,
      bigBlindSeat: 0,
      street: "preflop",
      community: [],
      deck: [],
      players: Array.from({ length: playerCount }, () => emptyPlayer(STARTING_CHIPS)),
      turn: null,
      currentBet: 0,
      minimumRaise: BIG_BLIND,
      lastAction: null,
      lastHand: null,
      outcome: null,
    };
    const dealt = dealHand(before, random);
    // Blinds alone can never settle a hand at 1000 chips each, so someone is to act.
    return dealt.turn === null && !dealt.outcome ? proceed(dealt, dealt.bigBlindSeat, random) : dealt;
  },

  play(state, seat, rawMove, random): MoveResult<PokerState> {
    if (state.outcome) return refuse("The game is over");
    const move = readMove(rawMove);
    if (!move) return refuse("That is not a poker move");
    if (seat !== state.turn) return refuse("Not your turn");
    const result = applyMove(state, seat, move);
    return result.ok ? { ok: true, state: proceed(result.state, seat, random) } : result;
  },

  // Each player sees their own hole cards; the others are face down. The showdown's hands are in
  // `lastHand`. Folded cards are never shown.
  viewFor(state, seat): PokerView {
    const { deck: _deck, players, ...rest } = state;
    return { ...rest, players: players.map((player, index) => ({ ...player, holeCards: index === seat ? player.holeCards : null })) };
  },

  toMove: (state) => (state.outcome || state.turn === null ? [] : [state.turn]),
  outcome: (state) => state.outcome,
  finish: (state) => chipsOutcome(state.players.map((player) => player.chips + player.handBet)),

  choices(state, seat): Choice[] {
    if (state.outcome || seat !== state.turn) return [];
    const player = state.players[seat];
    const owed = amountToCall(state, player);
    const choices: Choice[] = owed > 0
      ? [
          { move: { kind: "fold" }, label: "fold" },
          { move: { kind: "call" }, label: owed === player.chips ? `call ${owed} (all in)` : `call ${owed}` },
        ]
      : [{ move: { kind: "check" }, label: "check" }];
    if (canBeRaised(state.players, seat)) for (const { to, label } of raiseSizes(state, seat)) choices.push({ move: { kind: "raise", to }, label });
    return choices;
  },

  // Plays by hand strength: raises the strong hands (all in only with the very strongest), calls
  // when the hand is worth more than the price, and otherwise checks or folds.
  simpleStrategy(view, seat, choices, random) {
    const player = view.players[seat];
    const strength = handStrength(player.holeCards ?? [], view.community) + (random() - 0.5) * 0.1;
    const owed = amountToCall(view, player);
    const priceOfPot = owed / (potTotal(view.players) + owed);
    const find = (kind: PokerMove["kind"]): Choice | undefined => choices.find((choice) => (choice.move as PokerMove).kind === kind);
    const raises = choices.filter((choice) => (choice.move as PokerMove).kind === "raise");
    const allIn = raises.at(-1);
    const safeRaises = raises.filter((choice) => choice !== allIn);
    if (strength > 0.92 && allIn && random() < 0.5) return allIn;
    if (strength > 0.72 && safeRaises.length > 0) return safeRaises[strength > 0.85 ? safeRaises.length - 1 : 0];
    const stayIn = find("check") ?? find("call");
    if (find("check") || strength > priceOfPot + 0.2) return stayIn ?? choices[0];
    return find("fold") ?? choices[0];
  },
};

