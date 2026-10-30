import { isIndex, isRecord, otherSeat, refuse, type MoveResult, type Outcome, type Seat, type TableGame } from "../TableGame.js";

export const CONNECT_FOUR_ROWS = 6;
export const CONNECT_FOUR_COLUMNS = 7;

export type Cell = readonly [row: number, column: number];

export interface ConnectFourState {
  // [row][column], row 0 at the top; each cell holds the seat whose disc is there.
  readonly board: readonly (readonly (Seat | null)[])[];
  readonly turn: Seat;
  readonly outcome: Outcome | null;
  // The four (or more) in a row that won.
  readonly winningCells: readonly Cell[];
  readonly lastDrop: Cell | null;
}

export interface ConnectFourMove {
  readonly column: number;
}

// The row a disc dropped in this column comes to rest in; -1 if the column is full.
export function landingRow(board: ConnectFourState["board"], column: number): number {
  for (let row = CONNECT_FOUR_ROWS - 1; row >= 0; row--) {
    if (board[row][column] === null) return row;
  }
  return -1;
}

const DIRECTIONS: readonly Cell[] = [
  [0, 1], // across
  [1, 0], // down
  [1, 1], // down to the right
  [1, -1], // down to the left
];

// The line of four or more through the disc just dropped, if it made one.
function lineThrough(board: ConnectFourState["board"], row: number, column: number): Cell[] {
  const seat = board[row][column];
  for (const [rowStep, columnStep] of DIRECTIONS) {
    const cells: Cell[] = [[row, column]];
    for (const sign of [1, -1]) {
      let r = row + sign * rowStep;
      let c = column + sign * columnStep;
      while (isIndex(r, CONNECT_FOUR_ROWS) && isIndex(c, CONNECT_FOUR_COLUMNS) && board[r][c] === seat) {
        cells.push([r, c]);
        r += sign * rowStep;
        c += sign * columnStep;
      }
    }
    if (cells.length >= 4) return cells;
  }
  return [];
}

export const connectFour: TableGame<ConnectFourState, ConnectFourState> = {
  id: "connect4",
  title: "Connect 4",

  start: () => ({
    board: Array.from({ length: CONNECT_FOUR_ROWS }, () => Array<Seat | null>(CONNECT_FOUR_COLUMNS).fill(null)),
    turn: 0,
    outcome: null,
    winningCells: [],
    lastDrop: null,
  }),

  play(state, seat, move): MoveResult<ConnectFourState> {
    if (state.outcome) return refuse("The game is over");
    if (seat !== state.turn) return refuse("Not your turn");
    if (!isRecord(move) || !isIndex(move.column, CONNECT_FOUR_COLUMNS)) return refuse("Choose a column from 0 to 6");
    const column = move.column;
    const row = landingRow(state.board, column);
    if (row < 0) return refuse("That column is full");

    const board = state.board.map((cells) => [...cells]);
    board[row][column] = seat;
    const winningCells = lineThrough(board, row, column);
    const isFull = board[0].every((cell) => cell !== null);
    const outcome: Outcome | null = winningCells.length > 0 ? { kind: "win", winner: seat } : isFull ? { kind: "draw" } : null;
    return { ok: true, state: { board, turn: outcome ? state.turn : otherSeat(seat), outcome, winningCells, lastDrop: [row, column] } };
  },

  // Nothing is hidden in Connect 4.
  viewFor: (state) => state,
  turn: (state) => (state.outcome ? null : state.turn),
  outcome: (state) => state.outcome,
};
