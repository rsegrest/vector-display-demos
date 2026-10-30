import { betSizes, chipsOutcome, freshDeck, shuffled, STARTING_CHIPS, type Card } from "../casino.js";
import { isRecord, refuse, type Choice, type MoveResult, type Outcome, type TableGame } from "../TableGame.js";

// Baccarat (punto banco) for one to six players against the bank. Each round, everyone with chips
// bets at once on the player's hand, the banker's hand or a tie. When the last bet is in, the
// coup is dealt by the fixed third-card rules (no one chooses anything), and paid: a player bet
// 1 to 1, a banker bet 0.95 to 1 (the house keeps 5%), a tie 8 to 1; on a tie, player and banker
// bets are returned.
//
// The rounds follow one another with no one having to deal: the coup is settled the moment the
// last bet is placed, the next round's betting opens at once, and the coup stays in `lastCoup`
// for everyone to see. A player with no chips left sits out; the game ends only when no one has
// any, or when the host closes the table and the most chips win.

export const BACCARAT_MIN_BET = 10;
export const BACCARAT_MAX_BET = 500;
const SHOE_DECKS = 8;
const RESHUFFLE_BELOW = 52;

export type BaccaratSide = "player" | "banker" | "tie";
export const BACCARAT_SIDES: readonly BaccaratSide[] = ["player", "banker", "tie"];

export interface BaccaratBet {
  readonly on: BaccaratSide;
  readonly amount: number;
}

export interface BaccaratSeat {
  readonly chips: number;
  // This round's bet, once placed; its chips are taken from `chips`.
  readonly bet: BaccaratBet | null;
  readonly isInRound: boolean;
}

export interface BaccaratCoup {
  readonly roundNumber: number;
  readonly playerCards: readonly Card[];
  readonly bankerCards: readonly Card[];
  readonly playerTotal: number;
  readonly bankerTotal: number;
  readonly winner: BaccaratSide;
  // Each seat's bet and what it won or lost (net); null for a seat that sat the round out.
  readonly results: readonly ({ readonly bet: BaccaratBet; readonly net: number } | null)[];
}

export interface BaccaratState {
  readonly roundNumber: number;
  readonly seats: readonly BaccaratSeat[];
  readonly shoe: readonly Card[];
  readonly lastCoup: BaccaratCoup | null;
  readonly outcome: Outcome | null;
}

// Nothing in baccarat is hidden but the order of the shoe, which a view leaves out.
export interface BaccaratView extends Omit<BaccaratState, "shoe"> {
  readonly shoeSize: number;
}

export type BaccaratMove = { readonly kind: "bet"; readonly on: BaccaratSide; readonly amount: number };

// ── The coup ───────────────────────────────────────────────────────────────

export function baccaratPoints(card: Card): number {
  if (card.rank === "A") return 1;
  if (card.rank === "10" || card.rank === "J" || card.rank === "Q" || card.rank === "K") return 0;
  return Number(card.rank);
}

// Only the last digit of the sum counts.
export function baccaratTotal(cards: readonly Card[]): number {
  return cards.reduce((sum, card) => sum + baccaratPoints(card), 0) % 10;
}

// Whether the banker draws a third card, from the banker's two-card total and the player's third
// card (null if the player stood).
export function bankerDraws(bankerTotal: number, playerThirdCard: Card | null): boolean {
  if (!playerThirdCard) return bankerTotal <= 5;
  const third = baccaratPoints(playerThirdCard);
  if (bankerTotal <= 2) return true;
  if (bankerTotal === 3) return third !== 8;
  if (bankerTotal === 4) return third >= 2 && third <= 7;
  if (bankerTotal === 5) return third >= 4 && third <= 7;
  if (bankerTotal === 6) return third === 6 || third === 7;
  return false;
}

// One coup from the top of the shoe: two cards each, player first, then the third cards. A
// natural (8 or 9 on either side's first two) ends it; otherwise the player draws on 0 to 5 and
// the banker by `bankerDraws`.
export function dealCoup(shoe: readonly Card[]): { playerCards: Card[]; bankerCards: Card[]; shoe: Card[] } {
  const remaining = [...shoe];
  const take = (): Card => remaining.shift()!;
  const playerCards = [take()];
  const bankerCards = [take()];
  playerCards.push(take());
  bankerCards.push(take());
  const isNatural = baccaratTotal(playerCards) >= 8 || baccaratTotal(bankerCards) >= 8;
  if (!isNatural) {
    let playerThirdCard: Card | null = null;
    if (baccaratTotal(playerCards) <= 5) {
      playerThirdCard = take();
      playerCards.push(playerThirdCard);
    }
    if (bankerDraws(baccaratTotal(bankerCards), playerThirdCard)) bankerCards.push(take());
  }
  return { playerCards, bankerCards, shoe: remaining };
}

// What a bet returns (stake included) when `winner` wins the coup.
export function baccaratReturn(bet: BaccaratBet, winner: BaccaratSide): number {
  if (winner === "tie") return bet.on === "tie" ? bet.amount * 9 : bet.amount;
  if (bet.on !== winner) return 0;
  return bet.on === "banker" ? bet.amount + Math.floor(bet.amount * 0.95) : bet.amount * 2;
}

// ── Rounds ─────────────────────────────────────────────────────────────────

function openBetting(state: BaccaratState): BaccaratState {
  const seats = state.seats.map((seat) => ({ chips: seat.chips, bet: null, isInRound: seat.chips > 0 }));
  const outcome = seats.some((seat) => seat.isInRound) ? null : { winners: [], summary: "Everyone is out of chips; the bank wins" };
  return { ...state, seats, outcome };
}

function settleCoup(state: BaccaratState, random: () => number): BaccaratState {
  const fullShoe = state.shoe.length < RESHUFFLE_BELOW ? shuffled(freshDeck(SHOE_DECKS), random) : state.shoe;
  const { playerCards, bankerCards, shoe } = dealCoup(fullShoe);
  const playerTotal = baccaratTotal(playerCards);
  const bankerTotal = baccaratTotal(bankerCards);
  const winner: BaccaratSide = playerTotal > bankerTotal ? "player" : bankerTotal > playerTotal ? "banker" : "tie";
  const returns = state.seats.map((seat) => (seat.bet ? baccaratReturn(seat.bet, winner) : 0));
  const roundNumber = state.roundNumber + 1;
  return openBetting({
    ...state,
    roundNumber,
    shoe,
    seats: state.seats.map((seat, index) => ({ ...seat, chips: seat.chips + returns[index] })),
    lastCoup: {
      roundNumber,
      playerCards,
      bankerCards,
      playerTotal,
      bankerTotal,
      winner,
      results: state.seats.map((seat, index) => (seat.bet ? { bet: seat.bet, net: returns[index] - seat.bet.amount } : null)),
    },
  });
}

function readMove(move: unknown): BaccaratMove | null {
  if (!isRecord(move) || move.kind !== "bet") return null;
  if (!BACCARAT_SIDES.includes(move.on as BaccaratSide) || !Number.isInteger(move.amount)) return null;
  return { kind: "bet", on: move.on as BaccaratSide, amount: move.amount as number };
}

function smallestBet(chips: number): number {
  return Math.min(BACCARAT_MIN_BET, chips);
}

export const baccarat: TableGame<BaccaratState, BaccaratView> = {
  id: "baccarat",
  title: "Baccarat",
  description: "Bet on the player, the banker or a tie; the hand nearer nine wins.",
  family: "cards",
  minPlayers: 1,
  maxPlayers: 6,
  strategy:
    "Win chips from the bank. Each round, bet on the player's hand, the banker's hand or a tie; the cards are then dealt by fixed rules, and the hand whose total is nearer 9 wins. The banker bet wins slightly more often (it pays 0.95 to 1) and is the best bet; the player bet is close behind; the tie pays 8 to 1 but loses far more often than that. Bet small compared with your chips.",

  start: (playerCount, random) =>
    openBetting({
      roundNumber: 0,
      seats: Array.from({ length: playerCount }, () => ({ chips: STARTING_CHIPS, bet: null, isInRound: true })),
      shoe: shuffled(freshDeck(SHOE_DECKS), random),
      lastCoup: null,
      outcome: null,
    }),

  play(state, seat, rawMove, random): MoveResult<BaccaratState> {
    if (state.outcome) return refuse("The game is over");
    const move = readMove(rawMove);
    if (!move) return refuse("That is not a baccarat bet");
    const player = state.seats[seat];
    if (!player.isInRound) return refuse("You have no chips left");
    if (player.bet) return refuse("Your bet is already in");
    const smallest = smallestBet(player.chips);
    const largest = Math.min(BACCARAT_MAX_BET, player.chips);
    if (move.amount < smallest || move.amount > largest) return refuse(`Bet from ${smallest} to ${largest}`);
    const seats = state.seats.map((each, index) => (index === seat ? { ...each, chips: each.chips - move.amount, bet: { on: move.on, amount: move.amount } } : each));
    const betted = { ...state, seats };
    const isEveryBetIn = seats.every((each) => !each.isInRound || each.bet);
    return { ok: true, state: isEveryBetIn ? settleCoup(betted, random) : betted };
  },

  viewFor(state): BaccaratView {
    const { shoe, ...rest } = state;
    return { ...rest, shoeSize: shoe.length };
  },

  toMove: (state) => (state.outcome ? [] : state.seats.flatMap((seat, index) => (seat.isInRound && !seat.bet ? [index] : []))),
  outcome: (state) => state.outcome,
  finish: (state) => chipsOutcome(state.seats.map((seat) => seat.chips + (seat.bet?.amount ?? 0))),

  choices(state, seat): Choice[] {
    const player = state.seats[seat];
    if (state.outcome || !player.isInRound || player.bet) return [];
    const sizes = [...new Set([smallestBet(player.chips), ...betSizes(player.chips, BACCARAT_MIN_BET, BACCARAT_MAX_BET)])];
    return BACCARAT_SIDES.flatMap((on) => sizes.map((amount) => ({ move: { kind: "bet", on, amount }, label: `bet ${amount} on ${on}` })));
  },

  // A small bet on the banker, the best odds at the table.
  simpleStrategy(view, seat, choices) {
    const target = Math.max(BACCARAT_MIN_BET, Math.floor(view.seats[seat].chips / 40));
    const onBanker = choices.filter((choice) => {
      const move = choice.move as BaccaratMove;
      return move.on === "banker" && move.amount <= target;
    });
    return onBanker.at(-1) ?? choices.find((choice) => (choice.move as BaccaratMove).on === "banker") ?? choices[0];
  },
};
