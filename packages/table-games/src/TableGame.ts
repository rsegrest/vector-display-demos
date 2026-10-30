// A game played at a table: the rules alone, with no drawing, no network and no clock, so
// the room server and the window that shows the board run the same code.
//
// The players are seats 0, 1, 2..., not people: the room decides who sits where (a member,
// or a computer player). A state is plain data (it is stored between messages and sent as
// JSON), and is never changed in place; a move gives a new one.
//
// The rules follow game-clawtroller's (apps/web/lib/*.ts, MIT licensed, by the same owner),
// rewritten around seats.

export type Seat = number;

export type GameId =
  | "connect4"
  | "checkers"
  | "battleship"
  | "tictactoe"
  | "chess"
  | "yahtzee"
  | "boggle"
  | "poker"
  | "blackjack"
  | "baccarat"
  | "craps"
  | "roulette"
  | "keno"
  | "slots"
  | "pachinko";

// How a game ended: who won (more than one is a tie, none a draw), and a line saying why.
export interface Outcome {
  readonly winners: readonly Seat[];
  readonly summary?: string;
}

export type MoveResult<State> = { readonly ok: true; readonly state: State } | { readonly ok: false; readonly error: string };

// A move a computer player may make, with a short plain description of it: what a decision
// model is shown to choose between. Labels are unique within one list.
export interface Choice {
  readonly move: unknown;
  readonly label: string;
}

export type GameFamily = "board" | "dice and words" | "cards" | "casino";

export interface TableGame<State, View> {
  readonly id: GameId;
  readonly title: string;
  // One line for the game's card.
  readonly description: string;
  readonly family: GameFamily;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  // A few sentences for a computer player: the goal and what good play looks like.
  readonly strategy: string;
  // A new game for this many players. `random` gives numbers in [0, 1), for dealing or placing.
  start(playerCount: number, random: () => number): State;
  // A move by the player in `seat`, as it arrived from the network: anything at all, so each
  // game checks its shape. Refused moves leave the state as it was and say why.
  play(state: State, seat: Seat, move: unknown, random: () => number): MoveResult<State>;
  // What the player in `seat` may see; null is someone watching. Hidden things (another
  // player's ships or cards) are left out here, on the server, never just not drawn.
  viewFor(state: State, seat: Seat | null): View;
  // The seats that may move now: one in turn-based games, several when all move at once
  // (placing ships, betting), none once the game is over.
  toMove(state: State): readonly Seat[];
  outcome(state: State): Outcome | null;
  // The moves `seat` may make now, for a computer player. A game whose moves are too many to
  // list (bets of any size, any word) offers a sensible handful.
  choices(state: State, seat: Seat): Choice[];
  // Whether a computer player may look a move ahead with the real state: only in games with
  // nothing hidden and no dice, where that tells it nothing a person in its seat could not know.
  readonly canLookAhead?: boolean;
  // How long a computer player waits before each move, in seconds, where the usual pause
  // (under a second) would be too quick: Boggle's words come one every few seconds.
  readonly computerPauseSeconds?: number;
  // A game of pure chance, where a decision model has nothing to decide (slots, pachinko):
  // computer players there always play the simple strategy, and cost no calls.
  readonly isPureChance?: boolean;
  // A simple player's strategy, from what its seat may see: which of the (safe) choices to make.
  // Without one, the simple computer player chooses at random.
  simpleStrategy?(view: View, seat: Seat, choices: readonly Choice[], random: () => number): Choice;
  // For games with no natural end (the casino games, played until the players stop): the
  // result when the table is closed. Without it, closing a game in progress ends it undecided.
  finish?(state: State): Outcome;
}

export function otherSeat(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isIndex(value: unknown, size: number): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < size;
}

export function refuse<State>(error: string): MoveResult<State> {
  return { ok: false, error };
}

// The seats with the most of something (chips, points): the winners of a game decided by a count.
export function seatsWithMost(counts: readonly number[]): Seat[] {
  const best = Math.max(...counts);
  return counts.flatMap((count, seat) => (count === best ? [seat] : []));
}
