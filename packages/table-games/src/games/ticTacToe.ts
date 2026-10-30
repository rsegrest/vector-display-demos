import { isIndex, isRecord, otherSeat, refuse, type Choice, type MoveResult, type Outcome, type Seat, type TableGame } from "../TableGame.js";

export const TIC_TAC_TOE_SIZE = 3;
const CELL_COUNT = TIC_TAC_TOE_SIZE * TIC_TAC_TOE_SIZE;

export interface TicTacToeState {
  // The nine cells, read across from the top left: cell 0 is the top left, 4 the center,
  // 8 the bottom right. Each holds the seat whose mark is there; seat 0 plays X, seat 1 plays O.
  readonly board: readonly (Seat | null)[];
  readonly turn: Seat;
  readonly outcome: Outcome | null;
  // The three cells of the line that won.
  readonly winningLine: readonly number[];
  readonly lastMark: number | null;
}

export interface TicTacToeMove {
  readonly cell: number;
}

// Every line of three: the rows, the columns and the two diagonals.
export const TIC_TAC_TOE_LINES: readonly (readonly number[])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

const CELL_NAMES = ["top left", "top middle", "top right", "middle left", "center", "middle right", "bottom left", "bottom middle", "bottom right"];

// The line of three the mark just made, if it made one.
function lineThrough(board: TicTacToeState["board"], cell: number): readonly number[] {
  const seat = board[cell];
  return TIC_TAC_TOE_LINES.find((line) => line.includes(cell) && line.every((each) => board[each] === seat)) ?? [];
}

export const ticTacToe: TableGame<TicTacToeState, TicTacToeState> = {
  id: "tictactoe",
  title: "Tic-tac-toe",
  description: "X and O take turns; three in a row wins.",
  family: "board",
  minPlayers: 2,
  maxPlayers: 2,
  canLookAhead: true,
  strategy:
    "Get three of your marks in a line across, down or diagonally. Take a winning cell at once; otherwise block the other player's line of two. The center is in four lines and the corners in three, so they are worth more than the edges; try to make two threats at once.",

  start: () => ({ board: Array<Seat | null>(CELL_COUNT).fill(null), turn: 0, outcome: null, winningLine: [], lastMark: null }),

  play(state, seat, move): MoveResult<TicTacToeState> {
    if (state.outcome) return refuse("The game is over");
    if (seat !== state.turn) return refuse("Not your turn");
    if (!isRecord(move) || !isIndex(move.cell, CELL_COUNT)) return refuse("Choose a cell from 0 to 8");
    const cell = move.cell;
    if (state.board[cell] !== null) return refuse("That cell is taken");

    const board = [...state.board];
    board[cell] = seat;
    const winningLine = lineThrough(board, cell);
    const isFull = board.every((each) => each !== null);
    const outcome: Outcome | null = winningLine.length > 0 ? { winners: [seat], summary: "Three in a row" } : isFull ? { winners: [], summary: "The board is full" } : null;
    return { ok: true, state: { board, turn: outcome ? state.turn : otherSeat(seat), outcome, winningLine, lastMark: cell } };
  },

  // Nothing is hidden in tic-tac-toe.
  viewFor: (state) => state,
  toMove: (state) => (state.outcome ? [] : [state.turn]),
  outcome: (state) => state.outcome,

  // The center first, then a corner, then an edge (the cells in the most lines first),
  // with chance choosing among cells worth the same.
  simpleStrategy(_view, _seat, choices, random) {
    const worth = (choice: Choice): number => {
      const cell = (choice.move as TicTacToeMove).cell;
      const linesThrough = TIC_TAC_TOE_LINES.filter((line) => line.includes(cell)).length;
      return linesThrough + random() * 0.9;
    };
    const scored = choices.map((choice) => ({ choice, worth: worth(choice) }));
    return scored.reduce((best, each) => (each.worth > best.worth ? each : best)).choice;
  },

  choices(state, seat): Choice[] {
    if (state.outcome || seat !== state.turn) return [];
    return state.board.flatMap((mark, cell) => (mark === null ? [{ move: { cell }, label: `the ${CELL_NAMES[cell]} cell` }] : []));
  },
};
