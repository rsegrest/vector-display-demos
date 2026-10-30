import { betSizes, chipsOutcome, shuffled, STARTING_CHIPS } from "../casino.js";
import { isRecord, refuse, type Choice, type MoveResult, type Outcome, type Seat, type TableGame } from "../TableGame.js";

// Keno, as game-clawtroller's: each player marks 1 to 10 of the numbers 1 to 80 and bets; 20
// numbers are drawn, and the ticket pays by how many of its numbers came up.
//
// How a round goes: every seat with chips fills in a ticket at once (its numbers and its bet, in
// one move), or skips the draw. When the last seat is in, the 20 numbers are drawn with the game's
// random, every ticket is paid, and the next round opens at once. The last draw, each seat's
// ticket and what came back to it stay in the state until the next draw.

export const KENO_NUMBERS = 80;
export const KENO_DRAWN = 20;
export const KENO_MOST_PICKS = 10;
export const KENO_MINIMUM_BET = 10;
export const KENO_MAXIMUM_BET = 1000;

// What a ticket pays, as a multiple of its bet (the stake is not returned besides): by how many
// numbers it marked, then by how many of them were drawn. game-clawtroller's table.
export const KENO_PAY_TABLE: Readonly<Record<number, Readonly<Record<number, number>>>> = {
  1: { 1: 3 },
  2: { 2: 9 },
  3: { 2: 2, 3: 25 },
  4: { 2: 1, 3: 5, 4: 50 },
  5: { 3: 2, 4: 15, 5: 200 },
  6: { 3: 1, 4: 5, 5: 50, 6: 500 },
  7: { 3: 1, 4: 2, 5: 15, 6: 100, 7: 1000 },
  8: { 4: 2, 5: 10, 6: 50, 7: 500, 8: 2000 },
  9: { 4: 1, 5: 5, 6: 25, 7: 200, 8: 1000, 9: 5000 },
  10: { 4: 1, 5: 3, 6: 15, 7: 100, 8: 500, 9: 2500, 10: 10000 },
};

export function kenoMultiplier(picks: number, matches: number): number {
  return KENO_PAY_TABLE[picks]?.[matches] ?? 0;
}

export interface KenoTicket {
  // The numbers marked, in order.
  readonly picks: readonly number[];
  readonly amount: number;
}

export interface KenoDraw {
  // The 20 numbers drawn, in order.
  readonly numbers: readonly number[];
  // Each seat's ticket in this draw (null if it sat out), how many of its numbers came up, and
  // what it paid.
  readonly tickets: readonly (KenoTicket | null)[];
  readonly matches: readonly number[];
  readonly returned: readonly number[];
}

export interface KenoState {
  readonly chips: readonly number[];
  // This round's tickets, by seat; a ticket's bet is already off the stack. null is not in yet.
  readonly tickets: readonly (KenoTicket | null)[];
  // Seats that skip this draw.
  readonly isSkipping: readonly boolean[];
  // Draws made so far.
  readonly draws: number;
  readonly lastDraw: KenoDraw | null;
}

export type KenoView = KenoState;

export type KenoMove = { readonly kind: "bet"; readonly picks: readonly number[]; readonly amount: number } | { readonly kind: "skip" };

function replaced<T>(items: readonly T[], index: number, item: T): T[] {
  const copy = [...items];
  copy[index] = item;
  return copy;
}

function readMove(move: unknown): KenoMove | null {
  if (!isRecord(move)) return null;
  if (move.kind === "skip") return { kind: "skip" };
  if (move.kind !== "bet" || !Array.isArray(move.picks) || !Number.isInteger(move.amount)) return null;
  if (!move.picks.every((pick) => Number.isInteger(pick))) return null;
  return { kind: "bet", picks: move.picks as number[], amount: move.amount as number };
}

function isSittingOut(state: KenoState, seat: Seat): boolean {
  return state.chips[seat] < KENO_MINIMUM_BET && state.tickets[seat] === null;
}

function isIn(state: KenoState, seat: Seat): boolean {
  return state.tickets[seat] !== null || state.isSkipping[seat] || isSittingOut(state, seat);
}

function draw(state: KenoState, random: () => number): KenoState {
  const pool = Array.from({ length: KENO_NUMBERS }, (_, index) => index + 1);
  const numbers = shuffled(pool, random)
    .slice(0, KENO_DRAWN)
    .sort((a, b) => a - b);
  const drawn = new Set(numbers);
  const matches = state.tickets.map((ticket) => (ticket ? ticket.picks.filter((pick) => drawn.has(pick)).length : 0));
  const returned = state.tickets.map((ticket, seat) => (ticket ? Math.floor(ticket.amount * kenoMultiplier(ticket.picks.length, matches[seat])) : 0));
  return {
    chips: state.chips.map((chips, seat) => chips + returned[seat]),
    tickets: state.tickets.map(() => null),
    isSkipping: state.isSkipping.map(() => false),
    draws: state.draws + 1,
    lastDraw: { numbers, tickets: state.tickets, matches, returned },
  };
}

function outcomeOf(state: KenoState): Outcome | null {
  return state.chips.every((_, seat) => isSittingOut(state, seat)) ? { winners: [], summary: "Every player is out of chips" } : null;
}

// A computer player's numbers for a ticket of `count`: spread over the card, different each round,
// with no random source (choices are worked out from the state alone).
export function quickPicks(count: number, round: number, seat: Seat): number[] {
  let value = (round * 7919 + seat * 104729 + count * 31) % 2147483647;
  const picks = new Set<number>();
  while (picks.size < count) {
    value = (value * 48271) % 2147483647;
    picks.add((value % KENO_NUMBERS) + 1);
  }
  return [...picks].sort((a, b) => a - b);
}

// The ticket sizes a computer player is offered.
const OFFERED_PICKS: readonly number[] = [1, 3, 5, 7, 10];

export const keno: TableGame<KenoState, KenoView> = {
  id: "keno",
  title: "Keno",
  description: "Mark up to ten of 80 numbers; twenty are drawn.",
  family: "casino",
  minPlayers: 1,
  maxPlayers: 6,
  strategy:
    "Finish with the most chips. Mark 1 to 10 numbers and bet; 20 of the 80 are drawn and the ticket pays by how many of its numbers came up. Few numbers win more often for less; ten numbers rarely pay much but can pay 10000 times the bet. Keno loses on average, so keep the bets small.",

  start: (playerCount) => ({
    chips: Array<number>(playerCount).fill(STARTING_CHIPS),
    tickets: Array<KenoTicket | null>(playerCount).fill(null),
    isSkipping: Array<boolean>(playerCount).fill(false),
    draws: 0,
    lastDraw: null,
  }),

  play(state, seat, rawMove, random): MoveResult<KenoState> {
    if (outcomeOf(state)) return refuse("Every player is out of chips");
    if (seat < 0 || seat >= state.chips.length || isSittingOut(state, seat)) return refuse("You are out of chips");
    if (isIn(state, seat)) return refuse("You are in: wait for the draw");
    const move = readMove(rawMove);
    if (!move) return refuse("That is not a keno move");
    let next: KenoState;
    if (move.kind === "skip") {
      next = { ...state, isSkipping: replaced(state.isSkipping, seat, true) };
    } else {
      const picks = [...move.picks].sort((a, b) => a - b);
      if (picks.length < 1 || picks.length > KENO_MOST_PICKS) return refuse(`Mark 1 to ${KENO_MOST_PICKS} numbers`);
      if (picks.some((pick) => pick < 1 || pick > KENO_NUMBERS)) return refuse(`The numbers run from 1 to ${KENO_NUMBERS}`);
      if (new Set(picks).size !== picks.length) return refuse("Mark each number once");
      if (move.amount < KENO_MINIMUM_BET) return refuse(`The smallest bet is ${KENO_MINIMUM_BET}`);
      if (move.amount > KENO_MAXIMUM_BET) return refuse(`The largest bet is ${KENO_MAXIMUM_BET}`);
      if (move.amount > state.chips[seat]) return refuse("You do not have that many chips");
      next = {
        ...state,
        chips: replaced(state.chips, seat, state.chips[seat] - move.amount),
        tickets: replaced(state.tickets, seat, { picks, amount: move.amount }),
      };
    }
    const isEveryoneIn = next.chips.every((_, each) => isIn(next, each));
    return { ok: true, state: isEveryoneIn ? draw(next, random) : next };
  },

  viewFor: (state) => state,
  toMove: (state) => (outcomeOf(state) ? [] : state.chips.flatMap((_, seat) => (isIn(state, seat) ? [] : [seat]))),
  outcome: outcomeOf,
  finish: (state) => chipsOutcome(state.chips.map((chips, seat) => chips + (state.tickets[seat]?.amount ?? 0))),

  // A five-number ticket for the smallest bet: it pays on three or more.
  simpleStrategy(_view, _seat, choices) {
    return choices.find((choice) => choice.label.startsWith("pick 5 numbers")) ?? choices[0];
  },

  choices(state, seat): Choice[] {
    if (!keno.toMove(state).includes(seat)) return [];
    const sizes = betSizes(state.chips[seat], KENO_MINIMUM_BET, KENO_MAXIMUM_BET).slice(0, 3);
    const choices: Choice[] = OFFERED_PICKS.flatMap((count) =>
      sizes.map((amount) => ({
        move: { kind: "bet", picks: quickPicks(count, state.draws, seat), amount },
        label: `pick ${count} number${count === 1 ? "" : "s"} and bet ${amount}`,
      })),
    );
    return [...choices, { move: { kind: "skip" }, label: "skip this draw" }];
  },
};
