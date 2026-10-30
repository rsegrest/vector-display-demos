import { isIndex, isRecord, otherSeat, refuse, type Choice, type MoveResult, type Outcome, type Seat, type TableGame } from "../TableGame.js";

export const CHECKERS_SIZE = 8;

export type Square = readonly [row: number, column: number];

export interface CheckersPiece {
  readonly seat: Seat;
  readonly isKing: boolean;
}

export interface CheckersState {
  // [row][column]. Seat 0 starts on rows 0-2 and moves toward row 7; seat 1 starts on
  // rows 5-7 and moves toward row 0. Pieces stand on the dark squares, where row + column is odd.
  readonly board: readonly (readonly (CheckersPiece | null)[])[];
  readonly turn: Seat;
  // Set in the middle of a run of jumps: the piece that jumped must jump again.
  readonly jumpingFrom: Square | null;
  readonly outcome: Outcome | null;
  readonly lastMove: CheckersMove | null;
}

export interface CheckersMove {
  readonly from: Square;
  readonly to: Square;
}

type Board = CheckersState["board"];

function forwardOf(seat: Seat): number {
  return seat === 0 ? 1 : -1;
}

function directionsOf(piece: CheckersPiece): Square[] {
  const forward = forwardOf(piece.seat);
  const directions: Square[] = [
    [forward, -1],
    [forward, 1],
  ];
  if (piece.isKing) directions.push([-forward, -1], [-forward, 1]);
  return directions;
}

function isOnBoard(row: number, column: number): boolean {
  return isIndex(row, CHECKERS_SIZE) && isIndex(column, CHECKERS_SIZE);
}

function jumpsFrom(board: Board, [row, column]: Square): CheckersMove[] {
  const piece = board[row][column];
  if (!piece) return [];
  const jumps: CheckersMove[] = [];
  for (const [rowStep, columnStep] of directionsOf(piece)) {
    const to: Square = [row + 2 * rowStep, column + 2 * columnStep];
    if (!isOnBoard(...to) || board[to[0]][to[1]] !== null) continue;
    const jumped = board[row + rowStep][column + columnStep];
    if (jumped && jumped.seat !== piece.seat) jumps.push({ from: [row, column], to });
  }
  return jumps;
}

function stepsFrom(board: Board, [row, column]: Square): CheckersMove[] {
  const piece = board[row][column];
  if (!piece) return [];
  const steps: CheckersMove[] = [];
  for (const [rowStep, columnStep] of directionsOf(piece)) {
    const to: Square = [row + rowStep, column + columnStep];
    if (isOnBoard(...to) && board[to[0]][to[1]] === null) steps.push({ from: [row, column], to });
  }
  return steps;
}

function squaresOf(board: Board, seat: Seat): Square[] {
  const squares: Square[] = [];
  for (let row = 0; row < CHECKERS_SIZE; row++) {
    for (let column = 0; column < CHECKERS_SIZE; column++) {
      if (board[row][column]?.seat === seat) squares.push([row, column]);
    }
  }
  return squares;
}

// Every move the player in `seat` may make now. A capture must be taken when there is one,
// and in the middle of a run of jumps only the jumping piece may move, and only by jumping.
export function legalCheckersMoves(state: CheckersState, seat: Seat): CheckersMove[] {
  if (state.outcome || seat !== state.turn) return [];
  if (state.jumpingFrom) return jumpsFrom(state.board, state.jumpingFrom);
  const squares = squaresOf(state.board, seat);
  const jumps = squares.flatMap((square) => jumpsFrom(state.board, square));
  return jumps.length > 0 ? jumps : squares.flatMap((square) => stepsFrom(state.board, square));
}

function startingBoard(): (CheckersPiece | null)[][] {
  return Array.from({ length: CHECKERS_SIZE }, (_, row) =>
    Array.from({ length: CHECKERS_SIZE }, (_, column): CheckersPiece | null => {
      if ((row + column) % 2 === 0) return null;
      if (row < 3) return { seat: 0, isKing: false };
      if (row >= CHECKERS_SIZE - 3) return { seat: 1, isKing: false };
      return null;
    }),
  );
}

function readSquare(value: unknown): Square | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [row, column] = value;
  return isOnBoard(row, column) ? [row, column] : null;
}

export const checkers: TableGame<CheckersState, CheckersState> = {
  id: "checkers",
  title: "Checkers",
  description: "Jump to capture, and you must when you can.",
  family: "board",
  minPlayers: 2,
  maxPlayers: 2,
  canLookAhead: true,
  strategy:
    "Win by taking every piece of the other side or leaving it no move. Captures are compulsory. Keep pieces together and the back row guarded; avoid moves that leave a piece where it can be jumped; reach the far row to make a king.",

  start: () => ({ board: startingBoard(), turn: 0, jumpingFrom: null, outcome: null, lastMove: null }),

  play(state, seat, move): MoveResult<CheckersState> {
    if (state.outcome) return refuse("The game is over");
    if (seat !== state.turn) return refuse("Not your turn");
    const from = isRecord(move) ? readSquare(move.from) : null;
    const to = isRecord(move) ? readSquare(move.to) : null;
    if (!from || !to) return refuse("A move needs a from square and a to square");
    const legal = legalCheckersMoves(state, seat);
    const isLegal = legal.some((candidate) => candidate.from[0] === from[0] && candidate.from[1] === from[1] && candidate.to[0] === to[0] && candidate.to[1] === to[1]);
    if (!isLegal) return refuse(legal.some((candidate) => Math.abs(candidate.to[0] - candidate.from[0]) === 2) ? "You must jump" : "That move is not allowed");

    const board = state.board.map((cells) => [...cells]);
    const piece = board[from[0]][from[1]]!;
    board[from[0]][from[1]] = null;
    const isJump = Math.abs(to[0] - from[0]) === 2;
    if (isJump) board[(from[0] + to[0]) / 2][(from[1] + to[1]) / 2] = null;
    const farRow = piece.seat === 0 ? CHECKERS_SIZE - 1 : 0;
    const isCrowned = !piece.isKing && to[0] === farRow;
    board[to[0]][to[1]] = isCrowned ? { ...piece, isKing: true } : piece;

    // A jump that could jump again goes on; being crowned ends the move, as in American checkers.
    const jumpsOn = isJump && !isCrowned && jumpsFrom(board, to).length > 0;
    const next: CheckersState = {
      board,
      turn: jumpsOn ? seat : otherSeat(seat),
      jumpingFrom: jumpsOn ? to : null,
      outcome: null,
      lastMove: { from, to },
    };
    // The player who cannot move, having no pieces or all of them blocked, has lost.
    if (!jumpsOn && legalCheckersMoves(next, next.turn).length === 0) {
      return { ok: true, state: { ...next, turn: seat, outcome: { winners: [seat], summary: "The other side cannot move" } } };
    }
    return { ok: true, state: next };
  },

  // Nothing is hidden in checkers.
  viewFor: (state) => state,
  toMove: (state) => (state.outcome ? [] : [state.turn]),
  outcome: (state) => state.outcome,

  choices(state, seat): Choice[] {
    const name = ([row, column]: Square): string => `${"abcdefgh"[column]}${row + 1}`;
    return legalCheckersMoves(state, seat).map((move) => ({
      move,
      label: `${name(move.from)} to ${name(move.to)}${Math.abs(move.to[0] - move.from[0]) === 2 ? " (a capture)" : ""}`,
    }));
  },
};
