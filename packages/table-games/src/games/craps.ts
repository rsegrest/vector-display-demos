import { betSizes, chipsOutcome, rollDie, STARTING_CHIPS } from "../casino.js";
import { isRecord, refuse, type Choice, type MoveResult, type Outcome, type Seat, type TableGame } from "../TableGame.js";

// Craps, as game-clawtroller's: the pass line and don't pass, the field, and (an addition) odds
// behind the pass line once a point is set.
//
// How a round goes: one roll of the dice a round. Every seat with chips (or with bets standing on
// the table) bets at once, lays what it likes, may take back what is not locked, and says it is
// ready (ready with nothing new lets the standing bets ride). When the last seat is ready the
// shooter rolls with the game's random, and the next round of betting opens at once:
//
//   come-out roll (no point): 7 or 11 wins the pass line, 2, 3 or 12 loses it ("craps"); don't
//            pass is the other way round, except that 12 is a push. Any other number becomes the point.
//   point on: the point again wins the pass line; a 7 ("seven out") loses it, and the dice pass to
//            the next shooter. Anything else rolls again next round, the line bets standing.
//
// Pass and don't pass go down only on a come-out roll, and stay until the point is decided. The
// field is one roll: 3, 4, 9, 10 and 11 pay 1 to 1, 2 pays 2 to 1, 12 pays 3 to 1; 5 to 8 lose.
// Odds go behind a pass bet while a point is on, up to twice it, and pay true odds when the point
// is made. The last roll, and what each seat got back from it, stay in the state until the next.

export const CRAPS_MINIMUM_BET = 10;
export const CRAPS_MAXIMUM_BET = 1000;
// Odds behind the pass line: at most this many times the pass bet.
export const CRAPS_MOST_ODDS = 2;

export type CrapsBetKind = "pass" | "dontPass" | "field" | "odds";
export const CRAPS_BET_KINDS: readonly CrapsBetKind[] = ["pass", "dontPass", "field", "odds"];

// A seat's chips on the table, by bet.
export type CrapsBets = Readonly<Record<CrapsBetKind, number>>;

export const NO_CRAPS_BETS: CrapsBets = { pass: 0, dontPass: 0, field: 0, odds: 0 };

export interface CrapsRoll {
  readonly dice: readonly [number, number];
  readonly total: number;
  // What the table calls it: "Natural 7", "Craps 3", "Point is 6", "Seven out", "Rolled 9"...
  readonly call: string;
  // What came back to each seat from this roll, stakes included.
  readonly returned: readonly number[];
}

export interface CrapsState {
  readonly chips: readonly number[];
  readonly bets: readonly CrapsBets[];
  readonly isReady: readonly boolean[];
  // The point, once a come-out roll sets one.
  readonly point: number | null;
  // Who throws the dice: cosmetic, since the dice are the game's random, but it moves on a seven out.
  readonly shooter: Seat;
  // Rolls made so far: the board's cue to tumble the dice again.
  readonly rolls: number;
  readonly lastRoll: CrapsRoll | null;
  // Totals rolled, newest first, at most 12.
  readonly history: readonly number[];
}

export type CrapsView = CrapsState;

export type CrapsMove =
  | { readonly kind: "bet"; readonly on: CrapsBetKind; readonly amount: number }
  // Takes back whatever may come down: the field, the odds, and the line bets before a point.
  | { readonly kind: "clear" }
  // Lays `bets` (if any) and says the seat is ready for the roll.
  | { readonly kind: "ready"; readonly bets?: readonly { readonly on: CrapsBetKind; readonly amount: number }[] };

// What true odds pay on the point, to one: 2 to 1 on 4 and 10, 3 to 2 on 5 and 9, 6 to 5 on 6 and 8.
export const TRUE_ODDS: Readonly<Record<number, number>> = { 4: 2, 10: 2, 5: 3 / 2, 9: 3 / 2, 6: 6 / 5, 8: 6 / 5 };

const FIELD_NUMBERS: readonly number[] = [2, 3, 4, 9, 10, 11, 12];

export function crapsBetName(on: CrapsBetKind): string {
  return { pass: "the pass line", dontPass: "don't pass", field: "the field", odds: "the odds" }[on];
}

function replaced<T>(items: readonly T[], index: number, item: T): T[] {
  const copy = [...items];
  copy[index] = item;
  return copy;
}

function onTable(bets: CrapsBets): number {
  return bets.pass + bets.dontPass + bets.field + bets.odds;
}

// A seat with too few chips for a bet and nothing on the table sits the rounds out.
function isSittingOut(state: CrapsState, seat: Seat): boolean {
  return state.chips[seat] < CRAPS_MINIMUM_BET && onTable(state.bets[seat]) === 0;
}

function readBet(value: unknown): { on: CrapsBetKind; amount: number } | null {
  if (!isRecord(value) || !CRAPS_BET_KINDS.includes(value.on as CrapsBetKind) || !Number.isInteger(value.amount)) return null;
  return { on: value.on as CrapsBetKind, amount: value.amount as number };
}

function readMove(move: unknown): CrapsMove | null {
  if (!isRecord(move)) return null;
  switch (move.kind) {
    case "bet": {
      const bet = readBet(move);
      return bet ? { kind: "bet", ...bet } : null;
    }
    case "clear":
      return { kind: "clear" };
    case "ready": {
      if (move.bets === undefined) return { kind: "ready" };
      if (!Array.isArray(move.bets) || move.bets.length > CRAPS_BET_KINDS.length) return null;
      const bets = move.bets.map(readBet);
      return bets.every((bet) => bet !== null) ? { kind: "ready", bets: bets as { on: CrapsBetKind; amount: number }[] } : null;
    }
    default:
      return null;
  }
}

// Why a bet may not go down now, or null if it may.
function betRefusal(state: CrapsState, seat: Seat, on: CrapsBetKind, amount: number): string | null {
  const bets = state.bets[seat];
  if (amount < CRAPS_MINIMUM_BET) return `The smallest bet is ${CRAPS_MINIMUM_BET}`;
  if (amount > state.chips[seat]) return "You do not have that many chips";
  if ((on === "pass" || on === "dontPass") && state.point !== null) return "Line bets go down on the come-out roll, before a point";
  if (on === "odds") {
    if (state.point === null) return "Odds go down once a point is set";
    if (bets.pass === 0) return "Odds go behind a pass line bet";
    if (bets.odds + amount > CRAPS_MOST_ODDS * bets.pass) return `Odds are at most ${CRAPS_MOST_ODDS} times the pass bet`;
  }
  if (bets[on] + amount > CRAPS_MAXIMUM_BET) return `The most on one bet is ${CRAPS_MAXIMUM_BET}`;
  return null;
}

function layBet(state: CrapsState, seat: Seat, on: CrapsBetKind, amount: number): MoveResult<CrapsState> {
  const refusal = betRefusal(state, seat, on, amount);
  if (refusal) return refuse(refusal);
  const bets = { ...state.bets[seat], [on]: state.bets[seat][on] + amount };
  return { ok: true, state: { ...state, chips: replaced(state.chips, seat, state.chips[seat] - amount), bets: replaced(state.bets, seat, bets) } };
}

// What one seat's bets come to on a roll: what comes back now, and what stays on the table.
function settle(bets: CrapsBets, total: number, point: number | null): { returned: number; standing: CrapsBets } {
  let returned = 0;
  // The field is decided on every roll.
  if (bets.field > 0 && FIELD_NUMBERS.includes(total)) returned += bets.field * (total === 2 ? 3 : total === 12 ? 4 : 2);
  const standing = { ...bets, field: 0 };
  if (point === null) {
    if (total === 7 || total === 11) return { returned: returned + 2 * bets.pass, standing: NO_CRAPS_BETS };
    if (total === 2 || total === 3) return { returned: returned + 2 * bets.dontPass, standing: NO_CRAPS_BETS };
    // Twelve is craps for the pass line and a push ("bar 12") for don't pass.
    if (total === 12) return { returned: returned + bets.dontPass, standing: NO_CRAPS_BETS };
    return { returned, standing };
  }
  if (total === point) {
    const oddsWin = Math.floor(bets.odds * TRUE_ODDS[point]);
    return { returned: returned + 2 * bets.pass + bets.odds + oddsWin, standing: NO_CRAPS_BETS };
  }
  if (total === 7) return { returned: returned + 2 * bets.dontPass, standing: NO_CRAPS_BETS };
  return { returned, standing };
}

function callFor(total: number, point: number | null): string {
  if (point === null) {
    if (total === 7 || total === 11) return `Natural ${total}`;
    if (total === 2 || total === 3 || total === 12) return `Craps ${total}`;
    return `Point is ${total}`;
  }
  if (total === point) return `Hit the point ${point}`;
  if (total === 7) return "Seven out";
  return `Rolled ${total}`;
}

// The next seat after `seat` still at the table, to take the dice.
function nextShooter(state: CrapsState, seat: Seat): Seat {
  for (let step = 1; step <= state.chips.length; step++) {
    const candidate = (seat + step) % state.chips.length;
    if (!isSittingOut(state, candidate)) return candidate;
  }
  return seat;
}

function roll(state: CrapsState, random: () => number): CrapsState {
  const dice: [number, number] = [rollDie(random), rollDie(random)];
  const total = dice[0] + dice[1];
  const settled = state.bets.map((bets) => settle(bets, total, state.point));
  const returned = settled.map((each) => each.returned);
  const isComeOut = state.point === null;
  const point = isComeOut ? ([4, 5, 6, 8, 9, 10].includes(total) ? total : null) : total === state.point || total === 7 ? null : state.point;
  const next: CrapsState = {
    chips: state.chips.map((chips, seat) => chips + returned[seat]),
    bets: settled.map((each) => each.standing),
    isReady: state.isReady.map(() => false),
    point,
    shooter: state.shooter,
    rolls: state.rolls + 1,
    lastRoll: { dice, total, call: callFor(total, state.point), returned },
    history: [total, ...state.history].slice(0, 12),
  };
  const isSevenOut = !isComeOut && total === 7;
  return isSevenOut || isSittingOut(next, next.shooter) ? { ...next, shooter: nextShooter(next, next.shooter) } : next;
}

function outcomeOf(state: CrapsState): Outcome | null {
  return state.chips.every((_, seat) => isSittingOut(state, seat)) ? { winners: [], summary: "Every player is out of chips" } : null;
}

// What a seat may take back now.
function removable(state: CrapsState, bets: CrapsBets): CrapsBets {
  return state.point === null ? bets : { ...bets, pass: 0, dontPass: 0 };
}

export const craps: TableGame<CrapsState, CrapsView> = {
  id: "craps",
  title: "Craps",
  description: "Bet the pass line or against it; one roll of the dice a round.",
  family: "casino",
  minPlayers: 1,
  maxPlayers: 6,
  strategy:
    "Finish with the most chips. The pass line and don't pass are the best bets (both lose only about 1.4% on average): lay a small one on the come-out roll and let it ride until the point is decided. Odds behind the pass line pay true odds and cost nothing on average. The field is a one-roll bet that loses a little more.",

  start: (playerCount) => ({
    chips: Array<number>(playerCount).fill(STARTING_CHIPS),
    bets: Array<CrapsBets>(playerCount).fill(NO_CRAPS_BETS),
    isReady: Array<boolean>(playerCount).fill(false),
    point: null,
    shooter: 0,
    rolls: 0,
    lastRoll: null,
    history: [],
  }),

  play(state, seat, rawMove, random): MoveResult<CrapsState> {
    if (outcomeOf(state)) return refuse("Every player is out of chips");
    if (seat < 0 || seat >= state.chips.length || isSittingOut(state, seat)) return refuse("You are out of chips");
    if (state.isReady[seat]) return refuse("You are ready: wait for the roll");
    const move = readMove(rawMove);
    if (!move) return refuse("That is not a craps move");
    switch (move.kind) {
      case "bet":
        return layBet(state, seat, move.on, move.amount);
      case "clear": {
        const back = removable(state, state.bets[seat]);
        const bets = state.point === null ? NO_CRAPS_BETS : { ...state.bets[seat], field: 0, odds: 0 };
        return { ok: true, state: { ...state, chips: replaced(state.chips, seat, state.chips[seat] + onTable(back)), bets: replaced(state.bets, seat, bets) } };
      }
      case "ready": {
        let next = state;
        for (const bet of move.bets ?? []) {
          const laid = layBet(next, seat, bet.on, bet.amount);
          if (!laid.ok) return laid;
          next = laid.state;
        }
        next = { ...next, isReady: replaced(next.isReady, seat, true) };
        const isEveryoneIn = next.chips.every((_, each) => next.isReady[each] || isSittingOut(next, each));
        return { ok: true, state: isEveryoneIn ? roll(next, random) : next };
      }
    }
  },

  viewFor: (state) => state,
  toMove: (state) => (outcomeOf(state) ? [] : state.chips.flatMap((_, seat) => (state.isReady[seat] || isSittingOut(state, seat) ? [] : [seat]))),
  outcome: outcomeOf,
  finish: (state) => chipsOutcome(state.chips.map((chips, seat) => chips + onTable(state.bets[seat]))),

  // The smallest pass line bet on a come-out roll, then let it ride (or wait for the next
  // come-out, if a point is on and the seat has nothing down).
  simpleStrategy(view, seat, choices) {
    const standPat = choices.find((choice) => {
      const move = choice.move as CrapsMove;
      return move.kind === "ready" && move.bets === undefined;
    });
    if (view.point !== null || onTable(view.bets[seat]) > 0) return standPat ?? choices[0];
    return choices.find((choice) => choice.label.endsWith("on the pass line")) ?? choices[0];
  },

  choices(state, seat): Choice[] {
    if (!craps.toMove(state).includes(seat)) return [];
    const bets = state.bets[seat];
    const sizes = betSizes(state.chips[seat], CRAPS_MINIMUM_BET, CRAPS_MAXIMUM_BET).slice(0, 3);
    const offered: CrapsBetKind[] = CRAPS_BET_KINDS.filter((on) => on !== "odds" || (state.point !== null && bets.pass > 0));
    const choices: Choice[] = offered.flatMap((on) =>
      sizes.filter((amount) => betRefusal(state, seat, on, amount) === null).map((amount) => ({ move: { kind: "ready", bets: [{ on, amount }] }, label: `bet ${amount} on ${crapsBetName(on)}` })),
    );
    const hasBets = onTable(bets) > 0;
    choices.push({ move: { kind: "ready" }, label: hasBets ? "roll with the bets as they are" : "sit out this roll" });
    if (onTable(removable(state, bets)) > 0) choices.push({ move: { kind: "clear" }, label: "take back what may come down" });
    return choices;
  },
};
