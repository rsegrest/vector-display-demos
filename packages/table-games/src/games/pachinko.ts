import { betSizes, chipsOutcome, STARTING_CHIPS } from "../casino.js";
import { isRecord, refuse, type Choice, type MoveResult, type Outcome, type Seat, type TableGame } from "../TableGame.js";

// Pachinko, as game-clawtroller's: balls fall through rows of pegs into eleven bins, each with a
// multiplier, highest in the middle. game-clawtroller ran the fall as physics in the browser; here
// the rules decide it, so every window agrees: at each row of pegs a ball bounces left or right,
// even odds, with the game's random, and the number of rights is the bin (a fair binomial walk).
//
// How it goes: everyone plays their own board, side by side, so nobody waits for anyone. A drop is
// one move: the bet comes off the stack and buys five balls, each carrying a fifth of it; each ball
// pays its share times its bin's multiplier, and the total is paid at once. Each board keeps the
// last drop's paths on show (for the board to animate) until the next.

export const PACHINKO_MINIMUM_BET = 10;
export const PACHINKO_MAXIMUM_BET = 1000;
export const PACHINKO_BALLS = 5;
// game-clawtroller's multipliers, by bin from the left.
// The rare bins at the edges pay most, as on a Plinko board; a ball returns 0.98 of its share of
// the stake on average (the original's center-heavy table returned about five times the stake).
export const PACHINKO_MULTIPLIERS: readonly number[] = [20, 6, 3, 1.2, 0.5, 0.3, 0.5, 1.2, 3, 6, 20];
// One bounce a row, so one row fewer than there are bins.
export const PACHINKO_ROWS = PACHINKO_MULTIPLIERS.length - 1;

export interface PachinkoBall {
  // At each row of pegs from the top, whether the ball went right.
  readonly path: readonly boolean[];
  // The bin it fell into, 0 on the left: how many times it went right.
  readonly bin: number;
}

export interface PachinkoBoard {
  // Drops made on this board: the board's cue to animate the balls again.
  readonly drops: number;
  readonly balls: readonly PachinkoBall[];
  readonly bet: number;
  readonly returned: number;
}

export interface PachinkoState {
  readonly chips: readonly number[];
  readonly boards: readonly PachinkoBoard[];
}

export type PachinkoView = PachinkoState;

export interface PachinkoMove {
  readonly kind: "drop";
  readonly amount: number;
}

// What the balls of one drop pay on a bet: each carries a fifth of it.
export function pachinkoReturn(bins: readonly number[], amount: number): number {
  const multiples = bins.reduce((sum, bin) => sum + PACHINKO_MULTIPLIERS[bin], 0);
  return Math.floor((amount * multiples) / PACHINKO_BALLS);
}

function replaced<T>(items: readonly T[], index: number, item: T): T[] {
  const copy = [...items];
  copy[index] = item;
  return copy;
}

function dropBall(random: () => number): PachinkoBall {
  const path = Array.from({ length: PACHINKO_ROWS }, () => random() < 0.5);
  return { path, bin: path.filter((wentRight) => wentRight).length };
}

function isSittingOut(state: PachinkoState, seat: Seat): boolean {
  return state.chips[seat] < PACHINKO_MINIMUM_BET;
}

function outcomeOf(state: PachinkoState): Outcome | null {
  return state.chips.every((_, seat) => isSittingOut(state, seat)) ? { winners: [], summary: "Every player is out of chips" } : null;
}

export const pachinko: TableGame<PachinkoState, PachinkoView> = {
  id: "pachinko",
  title: "Pachinko",
  description: "Drop five balls through the pegs; the rare edge bins pay twenty times.",
  family: "casino",
  isPureChance: true,
  minPlayers: 1,
  // Played alone: nobody's play touches anyone else's, so there is no one to play with or against.
  maxPlayers: 1,
  strategy:
    "Finish with the most chips. Each drop sends five balls down the pegs, each carrying a fifth of the bet; a ball bounces left or right at every row by chance, so most land near the middle, where the bins pay 5 and 10 times, and few reach the edges, which pay a fifth. Nothing you choose changes where they fall: only the size of the bet.",

  start: (playerCount) => ({
    chips: Array<number>(playerCount).fill(STARTING_CHIPS),
    boards: Array<PachinkoBoard>(playerCount).fill({ drops: 0, balls: [], bet: 0, returned: 0 }),
  }),

  play(state, seat, move, random): MoveResult<PachinkoState> {
    if (outcomeOf(state)) return refuse("Every player is out of chips");
    if (seat < 0 || seat >= state.chips.length || isSittingOut(state, seat)) return refuse("You are out of chips");
    if (!isRecord(move) || move.kind !== "drop" || !Number.isInteger(move.amount)) return refuse("That is not a pachinko move");
    const amount = move.amount as number;
    if (amount < PACHINKO_MINIMUM_BET) return refuse(`The smallest bet is ${PACHINKO_MINIMUM_BET}`);
    if (amount > PACHINKO_MAXIMUM_BET) return refuse(`The largest bet is ${PACHINKO_MAXIMUM_BET}`);
    if (amount > state.chips[seat]) return refuse("You do not have that many chips");
    const balls = Array.from({ length: PACHINKO_BALLS }, () => dropBall(random));
    const returned = pachinkoReturn(
      balls.map((ball) => ball.bin),
      amount,
    );
    const board: PachinkoBoard = { drops: state.boards[seat].drops + 1, balls, bet: amount, returned };
    return { ok: true, state: { chips: replaced(state.chips, seat, state.chips[seat] - amount + returned), boards: replaced(state.boards, seat, board) } };
  },

  viewFor: (state) => state,
  toMove: (state) => state.chips.flatMap((_, seat) => (isSittingOut(state, seat) ? [] : [seat])),
  outcome: outcomeOf,
  finish: (state) => chipsOutcome(state.chips),

  // Always the smallest drop.
  simpleStrategy: (_view, _seat, choices) => choices[0],

  choices(state, seat): Choice[] {
    if (isSittingOut(state, seat)) return [];
    return betSizes(state.chips[seat], PACHINKO_MINIMUM_BET, PACHINKO_MAXIMUM_BET).map((amount) => ({
      move: { kind: "drop", amount },
      label: `drop ${PACHINKO_BALLS} balls for ${amount}`,
    }));
  },
};
