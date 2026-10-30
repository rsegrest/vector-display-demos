import { betSizes, chipsOutcome, freshDeck, shuffled, STARTING_CHIPS, type Card } from "../casino.js";
import { isRecord, refuse, type Choice, type MoveResult, type Outcome, type Seat, type TableGame } from "../TableGame.js";

// Blackjack for one to six players against the house. Each round, everyone with chips bets at
// once; then two cards each and two for the dealer, one face down. The players play their hands
// in seat order (hit, stand, or double down on the first two cards; no splitting), then the
// dealer turns the hole card over and draws to 17, standing on a soft 17. Blackjack pays 3 to 2,
// other wins 1 to 1, ties push. A dealer showing an ace or a ten-card looks at the hole card
// first, and a dealer blackjack ends the round at once.
//
// The rounds follow one another with no one having to deal: as soon as a round is settled, the
// next one's betting opens, and the settled round stays in `lastRound` for everyone to see. A
// player with no chips left sits out; the game ends only when no one has any (the house won),
// or when the host closes the table and the most chips win.

export const BLACKJACK_MIN_BET = 10;
export const BLACKJACK_MAX_BET = 500;
const SHOE_DECKS = 4;
// The shoe is shuffled afresh when fewer cards than this are left at the start of a round.
const RESHUFFLE_BELOW = 60;

export interface BlackjackPlayer {
  // Chips in front of the player; a bet is taken from them when it is placed.
  readonly chips: number;
  readonly bet: number;
  readonly cards: readonly Card[];
  // Playing this round: had chips when the betting opened.
  readonly isInRound: boolean;
  readonly hasBet: boolean;
  // Has stood, busted, doubled or made 21: no more moves this round.
  readonly isDone: boolean;
  readonly isDoubled: boolean;
}

export type BlackjackResult = "blackjack" | "win" | "push" | "lose" | "bust";

export interface BlackjackRound {
  readonly roundNumber: number;
  readonly dealerCards: readonly Card[];
  readonly dealerTotal: number;
  // Each seat's hand and how it went; null for a seat that sat the round out.
  readonly hands: readonly ({ readonly cards: readonly Card[]; readonly total: number; readonly bet: number; readonly result: BlackjackResult; readonly net: number } | null)[];
}

export interface BlackjackState {
  readonly phase: "betting" | "playing";
  readonly roundNumber: number;
  readonly players: readonly BlackjackPlayer[];
  readonly dealerCards: readonly Card[];
  readonly shoe: readonly Card[];
  // Whose hand is being played; null while betting.
  readonly turn: Seat | null;
  readonly lastRound: BlackjackRound | null;
  readonly outcome: Outcome | null;
}

// In a view the shoe is left out (only its size is told), and while the players play, the
// dealer's hole card is null.
export interface BlackjackView extends Omit<BlackjackState, "shoe" | "dealerCards"> {
  readonly dealerCards: readonly (Card | null)[];
  readonly shoeSize: number;
}

export type BlackjackMove =
  | { readonly kind: "bet"; readonly amount: number }
  | { readonly kind: "hit" }
  | { readonly kind: "stand" }
  | { readonly kind: "double" };

// ── Hands ──────────────────────────────────────────────────────────────────

export function cardPoints(card: Card): number {
  if (card.rank === "A") return 11;
  if (card.rank === "J" || card.rank === "Q" || card.rank === "K") return 10;
  return Number(card.rank);
}

// A hand's total, counting aces as 11 while that does not bust it; soft when an ace still counts 11.
export function handTotal(cards: readonly Card[]): { readonly total: number; readonly isSoft: boolean } {
  let total = cards.reduce((sum, card) => sum + cardPoints(card), 0);
  let elevens = cards.filter((card) => card.rank === "A").length;
  while (total > 21 && elevens > 0) {
    total -= 10;
    elevens--;
  }
  return { total, isSoft: elevens > 0 };
}

export function isBlackjack(cards: readonly Card[]): boolean {
  return cards.length === 2 && handTotal(cards).total === 21;
}

// The smallest bet a stack may make: the table minimum, or every chip if fewer are left.
function smallestBet(chips: number): number {
  return Math.min(BLACKJACK_MIN_BET, chips);
}

// ── Rounds ─────────────────────────────────────────────────────────────────

// The next round's betting, from the chips each seat has now; the end if no one has any.
function openBetting(state: BlackjackState): BlackjackState {
  const players = state.players.map((player): BlackjackPlayer => ({
    chips: player.chips,
    bet: 0,
    cards: [],
    isInRound: player.chips > 0,
    hasBet: false,
    isDone: false,
    isDoubled: false,
  }));
  const outcome = players.some((player) => player.isInRound) ? null : { winners: [], summary: "Everyone is out of chips; the house wins" };
  return { ...state, phase: "betting", players, dealerCards: [], turn: null, outcome };
}

function draw(shoe: readonly Card[]): { card: Card; shoe: Card[] } {
  return { card: shoe[0], shoe: shoe.slice(1) };
}

// The first seat from `from` on whose hand is still being played, or null.
function firstUnfinished(players: readonly BlackjackPlayer[], from: Seat): Seat | null {
  for (let seat = from; seat < players.length; seat++) {
    if (players[seat].isInRound && !players[seat].isDone) return seat;
  }
  return null;
}

// Once every bet is in: two cards each, the dealer's second face down.
function deal(state: BlackjackState, random: () => number): BlackjackState {
  let shoe = state.shoe.length < RESHUFFLE_BELOW ? shuffled(freshDeck(SHOE_DECKS), random) : [...state.shoe];
  const cards: Card[][] = state.players.map(() => []);
  const dealerCards: Card[] = [];
  for (let round = 0; round < 2; round++) {
    state.players.forEach((player, seat) => {
      if (!player.isInRound) return;
      cards[seat].push(shoe[0]);
      shoe = shoe.slice(1);
    });
    dealerCards.push(shoe[0]);
    shoe = shoe.slice(1);
  }
  // A blackjack needs no more play.
  const players = state.players.map((player, seat) => ({ ...player, cards: cards[seat], isDone: !player.isInRound || isBlackjack(cards[seat]) }));
  const dealt: BlackjackState = { ...state, phase: "playing", roundNumber: state.roundNumber + 1, players, dealerCards, shoe, turn: null };
  // The dealer peeks under an ace or a ten-card: a blackjack there ends the round now.
  const upcardPoints = cardPoints(dealerCards[0]);
  if (upcardPoints >= 10 && isBlackjack(dealerCards)) return settle(dealt);
  const turn = firstUnfinished(players, 0);
  return turn === null ? settle(dealt) : { ...dealt, turn };
}

function resultOf(player: BlackjackPlayer, dealerCards: readonly Card[]): { result: BlackjackResult; returned: number } {
  const total = handTotal(player.cards).total;
  const dealer = handTotal(dealerCards).total;
  const dealerHasBlackjack = isBlackjack(dealerCards);
  if (total > 21) return { result: "bust", returned: 0 };
  if (isBlackjack(player.cards) && !dealerHasBlackjack) return { result: "blackjack", returned: player.bet + Math.floor((player.bet * 3) / 2) };
  if (dealerHasBlackjack) return isBlackjack(player.cards) ? { result: "push", returned: player.bet } : { result: "lose", returned: 0 };
  if (dealer > 21 || total > dealer) return { result: "win", returned: player.bet * 2 };
  if (total === dealer) return { result: "push", returned: player.bet };
  return { result: "lose", returned: 0 };
}

// The dealer's turn and the payouts, then the next round's betting.
function settle(state: BlackjackState): BlackjackState {
  let shoe = state.shoe;
  const dealerCards = [...state.dealerCards];
  // The dealer draws only if some hand still stands against it (not busted, not a blackjack
  // already paid), and not at all after a dealer blackjack.
  const handsStanding = state.players.some((player) => player.isInRound && handTotal(player.cards).total <= 21 && !isBlackjack(player.cards));
  if (handsStanding && !isBlackjack(dealerCards)) {
    while (handTotal(dealerCards).total < 17) {
      const drawn = draw(shoe);
      dealerCards.push(drawn.card);
      shoe = drawn.shoe;
    }
  }
  const hands = state.players.map((player) => {
    if (!player.isInRound) return null;
    const { result, returned } = resultOf(player, dealerCards);
    return { cards: player.cards, total: handTotal(player.cards).total, bet: player.bet, result, returned };
  });
  const players = state.players.map((player, seat) => ({ ...player, chips: player.chips + (hands[seat]?.returned ?? 0) }));
  const lastRound: BlackjackRound = {
    roundNumber: state.roundNumber,
    dealerCards,
    dealerTotal: handTotal(dealerCards).total,
    hands: hands.map((hand) => (hand ? { cards: hand.cards, total: hand.total, bet: hand.bet, result: hand.result, net: hand.returned - hand.bet } : null)),
  };
  return openBetting({ ...state, players, dealerCards, shoe, lastRound });
}

// After a hand is finished: the next player's turn, or the dealer's.
function passTurn(state: BlackjackState, seat: Seat): BlackjackState {
  const next = firstUnfinished(state.players, seat + 1);
  return next === null ? settle(state) : { ...state, turn: next };
}

function readMove(move: unknown): BlackjackMove | null {
  if (!isRecord(move)) return null;
  switch (move.kind) {
    case "bet":
      return Number.isInteger(move.amount) ? { kind: "bet", amount: move.amount as number } : null;
    case "hit":
    case "stand":
    case "double":
      return { kind: move.kind };
    default:
      return null;
  }
}

function withPlayer(state: BlackjackState, seat: Seat, change: Partial<BlackjackPlayer>): BlackjackState {
  return { ...state, players: state.players.map((player, index) => (index === seat ? { ...player, ...change } : player)) };
}

function placeBet(state: BlackjackState, seat: Seat, amount: number, random: () => number): MoveResult<BlackjackState> {
  const player = state.players[seat];
  if (!player.isInRound) return refuse("You have no chips left");
  if (player.hasBet) return refuse("Your bet is already in");
  const smallest = smallestBet(player.chips);
  const largest = Math.min(BLACKJACK_MAX_BET, player.chips);
  if (amount < smallest || amount > largest) return refuse(`Bet from ${smallest} to ${largest}`);
  const betted = withPlayer(state, seat, { chips: player.chips - amount, bet: amount, hasBet: true });
  const isEveryBetIn = betted.players.every((each) => !each.isInRound || each.hasBet);
  return { ok: true, state: isEveryBetIn ? deal(betted, random) : betted };
}

function playHand(state: BlackjackState, seat: Seat, move: BlackjackMove): MoveResult<BlackjackState> {
  if (seat !== state.turn) return refuse("Not your turn");
  const player = state.players[seat];
  switch (move.kind) {
    case "stand":
      return { ok: true, state: passTurn(withPlayer(state, seat, { isDone: true }), seat) };
    case "hit":
    case "double": {
      const isDouble = move.kind === "double";
      if (isDouble && player.cards.length !== 2) return refuse("You can double only on your first two cards");
      if (isDouble && player.chips < player.bet) return refuse("You have too few chips to double");
      const { card, shoe } = draw(state.shoe);
      const cards = [...player.cards, card];
      // A doubled hand takes exactly one card; any hand is finished at 21 or over.
      const isDone = isDouble || handTotal(cards).total >= 21;
      const change: Partial<BlackjackPlayer> = isDouble
        ? { cards, isDone, isDoubled: true, chips: player.chips - player.bet, bet: player.bet * 2 }
        : { cards, isDone };
      const next = withPlayer({ ...state, shoe }, seat, change);
      return { ok: true, state: isDone ? passTurn(next, seat) : next };
    }
    case "bet":
      return refuse("The betting is over for this round");
  }
}

// The hard and soft totals at which basic strategy hits, stands or doubles, against the dealer's
// face-up card (2 to 11, an ace counting 11). Splitting is not offered at this table.
export function basicStrategy(cards: readonly Card[], dealerUpcard: Card): "hit" | "stand" | "double" {
  const { total, isSoft } = handTotal(cards);
  const dealer = cardPoints(dealerUpcard);
  const canDouble = cards.length === 2;
  const dealerIsWeak = dealer >= 2 && dealer <= 6;
  if (isSoft) {
    if (total >= 19) return "stand";
    if (total === 18) return canDouble && dealer >= 3 && dealer <= 6 ? "double" : dealer <= 8 ? "stand" : "hit";
    return canDouble && dealer >= 4 && dealer <= 6 && total >= 15 ? "double" : "hit";
  }
  if (total >= 17) return "stand";
  if (total >= 13) return dealerIsWeak ? "stand" : "hit";
  if (total === 12) return dealer >= 4 && dealer <= 6 ? "stand" : "hit";
  if (total === 11) return canDouble ? "double" : "hit";
  if (total === 10) return canDouble && dealer <= 9 ? "double" : "hit";
  if (total === 9) return canDouble && dealer >= 3 && dealer <= 6 ? "double" : "hit";
  return "hit";
}

export const blackjack: TableGame<BlackjackState, BlackjackView> = {
  id: "blackjack",
  title: "Blackjack",
  description: "Beat the dealer to 21 without going over; blackjack pays 3 to 2.",
  family: "cards",
  minPlayers: 1,
  maxPlayers: 6,
  strategy:
    "Win chips from the house. Bet, then take cards (hit) to get closer to 21 than the dealer without going over, or stop (stand). Basic strategy: stand on hard 17 or more; stand on 13 to 16 when the dealer shows 2 to 6, otherwise hit; double down on 11, and on 10 against a dealer 9 or lower; hit soft 17 or less. The dealer must draw to 17. Keep bets small compared with your chips.",

  start(playerCount, random) {
    const players = Array.from({ length: playerCount }, (): BlackjackPlayer => ({ chips: STARTING_CHIPS, bet: 0, cards: [], isInRound: true, hasBet: false, isDone: false, isDoubled: false }));
    return openBetting({ phase: "betting", roundNumber: 0, players, dealerCards: [], shoe: shuffled(freshDeck(SHOE_DECKS), random), turn: null, lastRound: null, outcome: null });
  },

  play(state, seat, rawMove, random): MoveResult<BlackjackState> {
    if (state.outcome) return refuse("The game is over");
    const move = readMove(rawMove);
    if (!move) return refuse("That is not a blackjack move");
    if (state.phase === "betting") return move.kind === "bet" ? placeBet(state, seat, move.amount, random) : refuse("Place your bet first");
    return playHand(state, seat, move);
  },

  viewFor(state, _seat): BlackjackView {
    const { shoe, dealerCards, ...rest } = state;
    const isHoleHidden = state.phase === "playing";
    return { ...rest, shoeSize: shoe.length, dealerCards: dealerCards.map((card, index) => (isHoleHidden && index === 1 ? null : card)) };
  },

  toMove(state) {
    if (state.outcome) return [];
    if (state.phase === "betting") return state.players.flatMap((player, seat) => (player.isInRound && !player.hasBet ? [seat] : []));
    return state.turn === null ? [] : [state.turn];
  },
  outcome: (state) => state.outcome,
  // A bet still on the table counts as the player's: the round is called off.
  finish: (state) => chipsOutcome(state.players.map((player) => player.chips + player.bet)),

  choices(state, seat): Choice[] {
    if (state.outcome) return [];
    const player = state.players[seat];
    if (state.phase === "betting") {
      if (!player.isInRound || player.hasBet) return [];
      const sizes = [smallestBet(player.chips), ...betSizes(player.chips, BLACKJACK_MIN_BET, BLACKJACK_MAX_BET)];
      return [...new Set(sizes)].map((amount) => ({ move: { kind: "bet", amount }, label: `bet ${amount}` }));
    }
    if (seat !== state.turn) return [];
    const total = handTotal(player.cards).total;
    const choices: Choice[] = [
      { move: { kind: "hit" }, label: `hit (hand ${total})` },
      { move: { kind: "stand" }, label: `stand (hand ${total})` },
    ];
    if (player.cards.length === 2 && player.chips >= player.bet) choices.push({ move: { kind: "double" }, label: `double down (hand ${total})` });
    return choices;
  },

  // Bets a small part of the stack, then plays basic strategy.
  simpleStrategy(view, seat, choices) {
    if (view.phase === "betting") {
      const target = Math.max(BLACKJACK_MIN_BET, Math.floor(view.players[seat].chips / 40));
      const bets = choices.filter((choice) => (choice.move as { amount: number }).amount <= target);
      return bets.at(-1) ?? choices[0];
    }
    const upcard = view.dealerCards[0];
    const wanted = upcard ? basicStrategy(view.players[seat].cards, upcard) : "stand";
    const kind = wanted === "double" && !choices.some((choice) => (choice.move as BlackjackMove).kind === "double") ? "hit" : wanted;
    return choices.find((choice) => (choice.move as BlackjackMove).kind === kind) ?? choices[0];
  },
};
