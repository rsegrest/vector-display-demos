import { describe, expect, it } from "vitest";
import { simpleChoice } from "../src/choosers.js";
import { ticTacToe, type TicTacToeState } from "../src/games/ticTacToe.js";
import type { MoveResult, Seat } from "../src/TableGame.js";

function seededRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

function accepted<State>(result: MoveResult<State>): State {
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe("Tic-tac-toe", () => {
  const random = seededRandom(3);
  const mark = (state: TicTacToeState, seat: Seat, cell: number): TicTacToeState => accepted(ticTacToe.play(state, seat, { cell }, random));
  const markAll = (cells: readonly number[]): TicTacToeState => cells.reduce((state, cell) => mark(state, state.turn, cell), ticTacToe.start(2, random));

  it("places a mark and passes the turn", () => {
    const state = mark(ticTacToe.start(2, random), 0, 4);
    expect(state.board[4]).toBe(0);
    expect(state.turn).toBe(1);
    expect(state.lastMark).toBe(4);
    expect(ticTacToe.toMove(state)).toEqual([1]);
  });

  it("refuses moves out of turn, off the board, into a taken cell and after the end", () => {
    const start = ticTacToe.start(2, random);
    expect(ticTacToe.play(start, 1, { cell: 0 }, random)).toEqual({ ok: false, error: "Not your turn" });
    for (const bad of [{ cell: 9 }, { cell: -1 }, { cell: 1.5 }, { cell: "4" }, 4, null, {}]) expect(ticTacToe.play(start, 0, bad, random).ok).toBe(false);
    const taken = mark(start, 0, 4);
    expect(ticTacToe.play(taken, 1, { cell: 4 }, random)).toEqual({ ok: false, error: "That cell is taken" });
    const won = markAll([0, 3, 1, 4, 2]);
    expect(ticTacToe.play(won, 1, { cell: 8 }, random)).toEqual({ ok: false, error: "The game is over" });
    // The state played on is never changed.
    expect(start.board.every((cell) => cell === null)).toBe(true);
  });

  it("wins with three in a row across, down and on a diagonal", () => {
    const across = markAll([0, 3, 1, 4, 2]);
    expect(across.outcome).toEqual(expect.objectContaining({ winners: [0] }));
    expect(across.winningLine).toEqual([0, 1, 2]);
    expect(ticTacToe.toMove(across)).toEqual([]);

    const diagonal = markAll([1, 0, 2, 4, 3, 8]);
    expect(diagonal.outcome).toEqual(expect.objectContaining({ winners: [1] }));
    expect(diagonal.winningLine).toEqual([0, 4, 8]);
    expect(markAll([1, 0, 2, 3, 4, 6]).winningLine).toEqual([0, 3, 6]);
  });

  it("is a draw when the board fills with no line", () => {
    // X O X / X O O / O X X
    const state = markAll([0, 1, 2, 4, 3, 5, 7, 6, 8]);
    expect(state.outcome).toEqual(expect.objectContaining({ winners: [] }));
    expect(ticTacToe.choices(state, state.turn)).toEqual([]);
  });

  it("lists the empty cells as choices, with unique labels, only for the player to move", () => {
    const state = markAll([4, 0]);
    const choices = ticTacToe.choices(state, 0);
    expect(choices).toHaveLength(7);
    expect(new Set(choices.map((choice) => choice.label)).size).toBe(7);
    for (const choice of choices) expect(ticTacToe.play(state, 0, choice.move, random).ok).toBe(true);
    expect(ticTacToe.choices(state, 1)).toEqual([]);
    expect(choices.map((choice) => choice.label)).toContain("the top right cell");
  });

  it("has a computer player that takes a win, blocks a loss and prefers the center", () => {
    const input = (state: TicTacToeState, seat: Seat) => ({ game: ticTacToe, state, view: ticTacToe.viewFor(state, seat), seat, random });
    // X can finish the top row.
    expect(simpleChoice(input(markAll([0, 3, 1, 4]), 0))?.choice.move).toEqual({ cell: 2 });
    // O must block X's top row.
    expect(simpleChoice(input(markAll([0, 4, 1]), 1))?.choice.move).toEqual({ cell: 2 });
    expect(simpleChoice(input(ticTacToe.start(2, random), 0))?.choice.move).toEqual({ cell: 4 });
  });

  it("plays out whole games between computer players without a refused move", () => {
    for (let game = 0; game < 20; game++) {
      let state = ticTacToe.start(2, random);
      while (!ticTacToe.outcome(state)) {
        const seat = ticTacToe.toMove(state)[0];
        const decision = simpleChoice({ game: ticTacToe, state, view: state, seat, random })!;
        state = accepted(ticTacToe.play(state, seat, decision.choice.move, random));
      }
      expect(ticTacToe.outcome(state)).not.toBeNull();
    }
  });
});
