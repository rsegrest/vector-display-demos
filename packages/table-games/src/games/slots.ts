import { betSizes, chipsOutcome, STARTING_CHIPS } from "../casino.js";
import { isRecord, refuse, type Choice, type MoveResult, type Outcome, type Seat, type TableGame } from "../TableGame.js";

// Three-reel slots, as game-clawtroller's: eight symbols, a window three symbols high on each reel,
// and one payline across the middle.
//
// How it goes: everyone plays their own machine, side by side, so nobody waits for anyone. A spin
// is one move: the bet comes off the stack, the reels stop where the game's random puts them, and
// the win (if any) is paid at once. Each machine keeps its last spin on show until the next.

export const SLOTS_MINIMUM_BET = 10;
export const SLOTS_MAXIMUM_BET = 1000;

export type SlotSymbol = "cherry" | "lemon" | "orange" | "plum" | "bell" | "bar" | "seven" | "diamond";

export const SLOT_SYMBOLS: readonly SlotSymbol[] = ["cherry", "lemon", "orange", "plum", "bell", "bar", "seven", "diamond"];

// Three of a kind on the payline pays this many times the bet; three of any other symbol pays 3.
export const TRIPLE_PAYS: Readonly<Partial<Record<SlotSymbol, number>>> = { seven: 50, diamond: 25, bell: 15, bar: 10, cherry: 5 };
const OTHER_TRIPLE_PAYS = 3;

export interface SlotMachine {
  // Spins made on this machine: the board's cue to spin its reels again.
  readonly spins: number;
  // The last spin's window, [reel][row], row 1 on the payline; null before the first spin.
  readonly reels: readonly (readonly SlotSymbol[])[] | null;
  readonly bet: number;
  // What the last spin paid (0 if nothing), and why.
  readonly returned: number;
  readonly win: string | null;
}

export interface SlotsState {
  readonly chips: readonly number[];
  readonly machines: readonly SlotMachine[];
}

export type SlotsView = SlotsState;

export interface SlotsMove {
  readonly kind: "spin";
  readonly amount: number;
}

// What a payline pays, as a multiple of the bet, and the name of the win.
export function slotsPay(payline: readonly SlotSymbol[]): { readonly multiple: number; readonly win: string | null } {
  const [left, middle, right] = payline;
  if (left === middle && middle === right) return { multiple: TRIPLE_PAYS[left] ?? OTHER_TRIPLE_PAYS, win: `three ${left}s` };
  // Two alike from the left gives the bet back.
  if (left === middle) return { multiple: 1, win: `two ${left}s` };
  if (payline.includes("cherry")) return { multiple: 0.5, win: "a cherry" };
  return { multiple: 0, win: null };
}

function replaced<T>(items: readonly T[], index: number, item: T): T[] {
  const copy = [...items];
  copy[index] = item;
  return copy;
}

function spinReels(random: () => number): SlotSymbol[][] {
  return Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => SLOT_SYMBOLS[Math.floor(random() * SLOT_SYMBOLS.length)]));
}

function isSittingOut(state: SlotsState, seat: Seat): boolean {
  return state.chips[seat] < SLOTS_MINIMUM_BET;
}

function outcomeOf(state: SlotsState): Outcome | null {
  return state.chips.every((_, seat) => isSittingOut(state, seat)) ? { winners: [], summary: "Every player is out of chips" } : null;
}

export const slots: TableGame<SlotsState, SlotsView> = {
  id: "slots",
  title: "Slots",
  description: "Three reels and one payline; sevens pay fifty to one.",
  family: "casino",
  isPureChance: true,
  minPlayers: 1,
  maxPlayers: 6,
  strategy:
    "Finish with the most chips. Every spin is pure chance and the machine keeps a little on average, so spin for small bets. Three sevens pay 50 times the bet, three diamonds 25, bells 15, bars 10, cherries 5, any other three 3; two alike from the left give the bet back, and a cherry anywhere on the line pays half.",

  start: (playerCount) => ({
    chips: Array<number>(playerCount).fill(STARTING_CHIPS),
    machines: Array<SlotMachine>(playerCount).fill({ spins: 0, reels: null, bet: 0, returned: 0, win: null }),
  }),

  play(state, seat, move, random): MoveResult<SlotsState> {
    if (outcomeOf(state)) return refuse("Every player is out of chips");
    if (seat < 0 || seat >= state.chips.length || isSittingOut(state, seat)) return refuse("You are out of chips");
    if (!isRecord(move) || move.kind !== "spin" || !Number.isInteger(move.amount)) return refuse("That is not a slots move");
    const amount = move.amount as number;
    if (amount < SLOTS_MINIMUM_BET) return refuse(`The smallest bet is ${SLOTS_MINIMUM_BET}`);
    if (amount > SLOTS_MAXIMUM_BET) return refuse(`The largest bet is ${SLOTS_MAXIMUM_BET}`);
    if (amount > state.chips[seat]) return refuse("You do not have that many chips");
    const reels = spinReels(random);
    const { multiple, win } = slotsPay(reels.map((reel) => reel[1]));
    const returned = Math.floor(amount * multiple);
    const machine: SlotMachine = { spins: state.machines[seat].spins + 1, reels, bet: amount, returned, win };
    return { ok: true, state: { chips: replaced(state.chips, seat, state.chips[seat] - amount + returned), machines: replaced(state.machines, seat, machine) } };
  },

  viewFor: (state) => state,
  toMove: (state) => state.chips.flatMap((_, seat) => (isSittingOut(state, seat) ? [] : [seat])),
  outcome: outcomeOf,
  finish: (state) => chipsOutcome(state.chips),

  // Always the smallest spin.
  simpleStrategy: (_view, _seat, choices) => choices[0],

  choices(state, seat): Choice[] {
    if (isSittingOut(state, seat)) return [];
    return betSizes(state.chips[seat], SLOTS_MINIMUM_BET, SLOTS_MAXIMUM_BET).map((amount) => ({ move: { kind: "spin", amount }, label: `spin for ${amount}` }));
  },
};
