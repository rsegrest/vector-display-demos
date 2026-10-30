// A two-player game played at a table: the rules alone, with no drawing, no network and
// no clock, so the room server and the window that shows the board run the same code.
//
// The players are seats 0 and 1, not people: the room decides who sits where. Seat 0
// moves first. A state is plain data (it is stored between messages and sent as JSON),
// and is never changed in place; a move gives a new one.
//
// The rules of Connect 4, Checkers and Battleship follow game-clawtroller's
// (apps/web/lib/*.ts, MIT licensed, by the same owner), rewritten around seats.

export type Seat = 0 | 1;

export type GameId = "connect4" | "checkers" | "battleship";

export type Outcome = { readonly kind: "win"; readonly winner: Seat } | { readonly kind: "draw" };

export type MoveResult<State> = { readonly ok: true; readonly state: State } | { readonly ok: false; readonly error: string };

export interface TableGame<State, View> {
  readonly id: GameId;
  readonly title: string;
  // A new game. `random` gives numbers in [0, 1), for games that deal or place anything.
  start(random: () => number): State;
  // A move by the player in `seat`, as it arrived from the network: anything at all, so each
  // game checks its shape. Refused moves leave the state as it was and say why.
  play(state: State, seat: Seat, move: unknown, random: () => number): MoveResult<State>;
  // What the player in `seat` may see; null is someone watching. Hidden things (the other
  // player's ships) are left out here, on the server, never just not drawn.
  viewFor(state: State, seat: Seat | null): View;
  // Whose move it is; null when both may move (placing ships) or the game is over.
  turn(state: State): Seat | null;
  outcome(state: State): Outcome | null;
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
