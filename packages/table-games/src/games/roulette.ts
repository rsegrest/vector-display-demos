import { betSizes, chipsOutcome, STARTING_CHIPS } from "../casino.js";
import { isRecord, refuse, type Choice, type MoveResult, type Outcome, type Seat, type TableGame } from "../TableGame.js";

// European roulette (one zero, 37 pockets), as game-clawtroller's: straight up on a number,
// red or black, odd or even, low or high, the three dozens and the three columns.
//
// How a round goes: every seat with chips bets at once. A seat lays bets one at a time (the chips
// leave its stack as each is laid), may take them all back, and says it is ready; ready with no
// bets sits this spin out. When the last seat is ready the wheel is spun with the game's random,
// every bet is paid, and the next round of betting opens at once. The last spin's number and
// what each seat staked and got back stay in the state until the next spin.

export const ROULETTE_MINIMUM_BET = 10;
export const ROULETTE_MAXIMUM_BET = 1000;
// Bets of one kind are merged, so a seat has at most this many on the layout at once.
export const ROULETTE_MOST_BETS = 24;

export const RED_NUMBERS: readonly number[] = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
// The pockets in the order they lie around a European wheel, clockwise from zero.
export const WHEEL_ORDER: readonly number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

export type RouletteBetKind = "straight" | "red" | "black" | "odd" | "even" | "low" | "high" | "dozen1" | "dozen2" | "dozen3" | "column1" | "column2" | "column3";

export const ROULETTE_BET_KINDS: readonly RouletteBetKind[] = ["straight", "red", "black", "odd", "even", "low", "high", "dozen1", "dozen2", "dozen3", "column1", "column2", "column3"];

// How many to one each bet pays; the stake comes back as well.
export const ROULETTE_PAYS: Readonly<Record<RouletteBetKind, number>> = {
  straight: 35,
  red: 1,
  black: 1,
  odd: 1,
  even: 1,
  low: 1,
  high: 1,
  dozen1: 2,
  dozen2: 2,
  dozen3: 2,
  column1: 2,
  column2: 2,
  column3: 2,
};

export interface RouletteBet {
  readonly on: RouletteBetKind;
  // The number, for a straight bet only.
  readonly number?: number;
  readonly amount: number;
}

export interface RouletteSpin {
  readonly number: number;
  // What each seat had on the layout, and what came back to it (stakes included).
  readonly staked: readonly number[];
  readonly returned: readonly number[];
}

export interface RouletteState {
  readonly chips: readonly number[];
  // This spin's bets, by seat; their chips are already off the stacks.
  readonly bets: readonly (readonly RouletteBet[])[];
  readonly isReady: readonly boolean[];
  // Spins made so far: the board's cue to spin the wheel again.
  readonly spins: number;
  readonly lastSpin: RouletteSpin | null;
  // The numbers spun, newest first, at most 12.
  readonly history: readonly number[];
}

// Nothing is hidden at a roulette table.
export type RouletteView = RouletteState;

export type RouletteMove =
  | ({ readonly kind: "bet" } & RouletteBet)
  | { readonly kind: "clear" }
  // Lays `bets` (if any) and says the seat is ready for the spin.
  | { readonly kind: "ready"; readonly bets?: readonly RouletteBet[] };

export function rouletteColor(number: number): "red" | "black" | "green" {
  if (number === 0) return "green";
  return RED_NUMBERS.includes(number) ? "red" : "black";
}

export function isRouletteWinner(bet: Pick<RouletteBet, "on" | "number">, result: number): boolean {
  if (bet.on === "straight") return bet.number === result;
  // Zero loses every outside bet.
  if (result === 0) return false;
  switch (bet.on) {
    case "red":
      return rouletteColor(result) === "red";
    case "black":
      return rouletteColor(result) === "black";
    case "odd":
      return result % 2 === 1;
    case "even":
      return result % 2 === 0;
    case "low":
      return result <= 18;
    case "high":
      return result >= 19;
    case "dozen1":
    case "dozen2":
    case "dozen3":
      return Math.ceil(result / 12) === Number(bet.on.slice(-1));
    case "column1":
    case "column2":
    case "column3":
      // Column 1 is 1, 4, 7...; column 3 is 3, 6, 9...
      return ((result - 1) % 3) + 1 === Number(bet.on.slice(-1));
  }
}

// What comes back for one bet on `result`: the stake and the winnings, or nothing.
export function rouletteReturn(bet: RouletteBet, result: number): number {
  return isRouletteWinner(bet, result) ? bet.amount * (ROULETTE_PAYS[bet.on] + 1) : 0;
}

// A bet's short name for people and computer players: "17", "red", "the first dozen".
export function rouletteBetName(bet: Pick<RouletteBet, "on" | "number">): string {
  const ordinals = ["first", "second", "third"];
  if (bet.on === "straight") return `${bet.number}`;
  if (bet.on.startsWith("dozen")) return `the ${ordinals[Number(bet.on.slice(-1)) - 1]} dozen`;
  if (bet.on.startsWith("column")) return `the ${ordinals[Number(bet.on.slice(-1)) - 1]} column`;
  if (bet.on === "low") return "low (1 to 18)";
  if (bet.on === "high") return "high (19 to 36)";
  return bet.on;
}

function isSameSpot(a: Pick<RouletteBet, "on" | "number">, b: Pick<RouletteBet, "on" | "number">): boolean {
  return a.on === b.on && a.number === b.number;
}

function replaced<T>(items: readonly T[], index: number, item: T): T[] {
  const copy = [...items];
  copy[index] = item;
  return copy;
}

function readBet(value: unknown): RouletteBet | null {
  if (!isRecord(value) || !ROULETTE_BET_KINDS.includes(value.on as RouletteBetKind) || !Number.isInteger(value.amount)) return null;
  const on = value.on as RouletteBetKind;
  if (on === "straight") {
    if (!Number.isInteger(value.number) || (value.number as number) < 0 || (value.number as number) > 36) return null;
    return { on, number: value.number as number, amount: value.amount as number };
  }
  return { on, amount: value.amount as number };
}

function readMove(move: unknown): RouletteMove | null {
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
      if (!Array.isArray(move.bets) || move.bets.length > ROULETTE_MOST_BETS) return null;
      const bets = move.bets.map(readBet);
      return bets.every((bet) => bet !== null) ? { kind: "ready", bets: bets as RouletteBet[] } : null;
    }
    default:
      return null;
  }
}

// A seat with too few chips for a bet and nothing on the layout sits the spins out.
function isSittingOut(state: RouletteState, seat: Seat): boolean {
  return state.chips[seat] < ROULETTE_MINIMUM_BET && state.bets[seat].length === 0;
}

// Lays one bet for `seat`, merged with any bet already on the same spot.
function layBet(state: RouletteState, seat: Seat, bet: RouletteBet): MoveResult<RouletteState> {
  if (bet.amount < ROULETTE_MINIMUM_BET) return refuse(`The smallest bet is ${ROULETTE_MINIMUM_BET}`);
  if (bet.amount > state.chips[seat]) return refuse("You do not have that many chips");
  const mine = state.bets[seat];
  const existing = mine.find((each) => isSameSpot(each, bet));
  if ((existing?.amount ?? 0) + bet.amount > ROULETTE_MAXIMUM_BET) return refuse(`The most on one spot is ${ROULETTE_MAXIMUM_BET}`);
  if (!existing && mine.length >= ROULETTE_MOST_BETS) return refuse(`At most ${ROULETTE_MOST_BETS} bets a spin`);
  const bets = existing ? mine.map((each) => (each === existing ? { ...each, amount: each.amount + bet.amount } : each)) : [...mine, bet];
  return { ok: true, state: { ...state, chips: replaced(state.chips, seat, state.chips[seat] - bet.amount), bets: replaced(state.bets, seat, bets) } };
}

// The wheel turns: every bet is paid or lost, and the next round of betting opens.
function spin(state: RouletteState, random: () => number): RouletteState {
  const number = Math.floor(random() * 37);
  const staked = state.bets.map((bets) => bets.reduce((sum, bet) => sum + bet.amount, 0));
  const returned = state.bets.map((bets) => bets.reduce((sum, bet) => sum + rouletteReturn(bet, number), 0));
  return {
    chips: state.chips.map((chips, seat) => chips + returned[seat]),
    bets: state.bets.map(() => []),
    isReady: state.isReady.map(() => false),
    spins: state.spins + 1,
    lastSpin: { number, staked, returned },
    history: [number, ...state.history].slice(0, 12),
  };
}

function chipsAtTable(state: RouletteState): number[] {
  return state.chips.map((chips, seat) => chips + state.bets[seat].reduce((sum, bet) => sum + bet.amount, 0));
}

function outcomeOf(state: RouletteState): Outcome | null {
  return state.chips.every((_, seat) => isSittingOut(state, seat)) ? { winners: [], summary: "Every player is out of chips" } : null;
}

// The spots a computer player is offered: the even-money bets, the dozens and a few numbers.
const OFFERED_SPOTS: readonly Pick<RouletteBet, "on" | "number">[] = [
  { on: "red" },
  { on: "black" },
  { on: "odd" },
  { on: "even" },
  { on: "low" },
  { on: "high" },
  { on: "dozen1" },
  { on: "dozen2" },
  { on: "dozen3" },
  { on: "column1" },
  { on: "straight", number: 0 },
  { on: "straight", number: 17 },
];

export const roulette: TableGame<RouletteState, RouletteView> = {
  id: "roulette",
  title: "Roulette",
  description: "Bet on a number, a color or a dozen; the wheel decides.",
  family: "casino",
  minPlayers: 1,
  maxPlayers: 6,
  strategy:
    "Finish with the most chips. Every bet loses a little on average (the green zero), so bet small and often: even-money bets (red, black, odd, even, low, high) win almost half the time and pay 1 to 1, dozens and columns pay 2 to 1, a single number pays 35 to 1 but rarely comes up.",

  start: (playerCount) => ({
    chips: Array<number>(playerCount).fill(STARTING_CHIPS),
    bets: Array.from({ length: playerCount }, () => []),
    isReady: Array<boolean>(playerCount).fill(false),
    spins: 0,
    lastSpin: null,
    history: [],
  }),

  play(state, seat, rawMove, random): MoveResult<RouletteState> {
    if (outcomeOf(state)) return refuse("Every player is out of chips");
    if (seat < 0 || seat >= state.chips.length || isSittingOut(state, seat)) return refuse("You are out of chips");
    if (state.isReady[seat]) return refuse("You are ready: wait for the spin");
    const move = readMove(rawMove);
    if (!move) return refuse("That is not a roulette move");
    switch (move.kind) {
      case "bet": {
        const { kind: _kind, ...bet } = move;
        return layBet(state, seat, bet);
      }
      case "clear": {
        const back = state.bets[seat].reduce((sum, bet) => sum + bet.amount, 0);
        return { ok: true, state: { ...state, chips: replaced(state.chips, seat, state.chips[seat] + back), bets: replaced(state.bets, seat, []) } };
      }
      case "ready": {
        let next = state;
        for (const bet of move.bets ?? []) {
          const laid = layBet(next, seat, bet);
          if (!laid.ok) return laid;
          next = laid.state;
        }
        next = { ...next, isReady: replaced(next.isReady, seat, true) };
        const isEveryoneIn = next.chips.every((_, each) => next.isReady[each] || isSittingOut(next, each));
        return { ok: true, state: isEveryoneIn ? spin(next, random) : next };
      }
    }
  },

  viewFor: (state) => state,
  toMove: (state) => (outcomeOf(state) ? [] : state.chips.flatMap((_, seat) => (state.isReady[seat] || isSittingOut(state, seat) ? [] : [seat]))),
  outcome: outcomeOf,
  finish: (state) => chipsOutcome(chipsAtTable(state)),

  // The smallest even-money bet offered, on a spot picked at random.
  simpleStrategy(_view, _seat, choices, random) {
    const firstBet = (choice: Choice): RouletteBet | undefined => (choice.move as { bets?: readonly RouletteBet[] }).bets?.[0];
    const smallest = Math.min(...choices.map((choice) => firstBet(choice)?.amount ?? Infinity));
    const evenMoney = choices.filter((choice) => {
      const bet = firstBet(choice);
      return bet !== undefined && bet.amount === smallest && ROULETTE_PAYS[bet.on] === 1;
    });
    const pool = evenMoney.length > 0 ? evenMoney : choices;
    return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  },

  choices(state, seat): Choice[] {
    if (!roulette.toMove(state).includes(seat)) return [];
    if (state.bets[seat].length > 0) {
      return [
        { move: { kind: "ready" }, label: "spin with the bets laid" },
        { move: { kind: "clear" }, label: "take the bets back" },
      ];
    }
    const sizes = betSizes(state.chips[seat], ROULETTE_MINIMUM_BET, ROULETTE_MAXIMUM_BET).slice(0, 3);
    const choices: Choice[] = OFFERED_SPOTS.flatMap((spot) =>
      sizes.map((amount) => ({ move: { kind: "ready", bets: [{ ...spot, amount }] }, label: `bet ${amount} on ${rouletteBetName(spot)}` })),
    );
    return [...choices, { move: { kind: "ready" }, label: "sit out this spin" }];
  },
};
