import { describe, expect, it } from "vitest";
import {
  battleship,
  checkers,
  connectFour,
  FLEET,
  legalCheckersMoves,
  shipCells,
  type BattleshipState,
  type CheckersState,
  type ConnectFourState,
  type MoveResult,
  type Seat,
} from "../src/index.js";

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

describe("Connect 4", () => {
  const random = seededRandom(1);
  const drop = (state: ConnectFourState, seat: Seat, column: number): ConnectFourState => accepted(connectFour.play(state, seat, { column }, random));

  it("drops a disc to the lowest empty row and passes the turn", () => {
    const state = drop(connectFour.start(random), 0, 3);
    expect(state.board[5][3]).toBe(0);
    expect(state.turn).toBe(1);
    expect(drop(state, 1, 3).board[4][3]).toBe(1);
  });

  it("refuses moves out of turn, off the board and into a full column", () => {
    let state = connectFour.start(random);
    expect(connectFour.play(state, 1, { column: 0 }, random)).toEqual({ ok: false, error: "Not your turn" });
    expect(connectFour.play(state, 0, { column: 7 }, random).ok).toBe(false);
    expect(connectFour.play(state, 0, { column: 2.5 }, random).ok).toBe(false);
    expect(connectFour.play(state, 0, "3", random).ok).toBe(false);
    for (let disc = 0; disc < 6; disc++) state = drop(state, state.turn, 0);
    expect(connectFour.play(state, state.turn, { column: 0 }, random)).toEqual({ ok: false, error: "That column is full" });
  });

  it("wins with four in a row, across and on a diagonal", () => {
    let state = connectFour.start(random);
    for (const column of [0, 0, 1, 1, 2, 2]) state = drop(state, state.turn, column);
    state = drop(state, 0, 3);
    expect(state.outcome).toEqual({ kind: "win", winner: 0 });
    expect(state.winningCells).toHaveLength(4);
    expect(connectFour.turn(state)).toBeNull();

    // Seat 1 builds the diagonal (5,0) (4,1) (3,2) (2,3).
    let diagonal = connectFour.start(random);
    for (const column of [1, 0, 2, 1, 2, 2, 3, 3, 3, 4]) diagonal = drop(diagonal, diagonal.turn, column);
    expect(diagonal.outcome).toBeNull();
    diagonal = drop(diagonal, 0, 6);
    diagonal = drop(diagonal, 1, 3);
    expect(diagonal.outcome).toEqual({ kind: "win", winner: 1 });
  });

  it("is a draw when the board fills with no line", () => {
    // A full board with no four in a row anywhere, but for the top of column 0.
    const rows = ["0110100", "0100101", "0011100", "1110010", "0011101", "0100111"];
    const board = rows.map((row) => [...row].map((cell) => Number(cell) as Seat));
    const nearlyFull: (Seat | null)[][] = board;
    nearlyFull[0][0] = null;
    const state = drop({ board: nearlyFull, turn: 0, outcome: null, winningCells: [], lastDrop: null }, 0, 0);
    expect(state.outcome).toEqual({ kind: "draw" });
  });
});

describe("Checkers", () => {
  const random = seededRandom(2);
  const move = (state: CheckersState, seat: Seat, from: [number, number], to: [number, number]): CheckersState =>
    accepted(checkers.play(state, seat, { from, to }, random));

  it("starts with twelve pieces each and seven opening moves", () => {
    const state = checkers.start(random);
    const count = (seat: Seat): number => state.board.flat().filter((piece) => piece?.seat === seat).length;
    expect([count(0), count(1)]).toEqual([12, 12]);
    expect(legalCheckersMoves(state, 0)).toHaveLength(7);
    expect(legalCheckersMoves(state, 1)).toHaveLength(0);
  });

  it("forces a capture, takes the jumped piece and refuses a step instead", () => {
    let state = checkers.start(random);
    state = move(state, 0, [2, 1], [3, 2]);
    state = move(state, 1, [5, 4], [4, 3]);
    expect(checkers.play(state, 0, { from: [2, 3], to: [3, 4] }, random)).toEqual({ ok: false, error: "You must jump" });
    state = move(state, 0, [3, 2], [5, 4]);
    expect(state.board[4][3]).toBeNull();
    expect(state.board[5][4]).toEqual({ seat: 0, isKing: false });
    expect(state.turn).toBe(1);
  });

  it("keeps the turn for a second jump, and crowns a piece that reaches the far row", () => {
    const empty = Array.from({ length: 8 }, () => Array(8).fill(null));
    const board = empty.map((row) => [...row]);
    board[2][1] = { seat: 0, isKing: false };
    board[3][2] = { seat: 1, isKing: false };
    board[5][4] = { seat: 1, isKing: false };
    board[7][0] = { seat: 1, isKing: false };
    let state: CheckersState = { board, turn: 0, jumpingFrom: null, outcome: null, lastMove: null };
    state = move(state, 0, [2, 1], [4, 3]);
    expect(state.turn).toBe(0);
    expect(state.jumpingFrom).toEqual([4, 3]);
    expect(legalCheckersMoves(state, 0)).toEqual([{ from: [4, 3], to: [6, 5] }]);
    state = move(state, 0, [4, 3], [6, 5]);
    expect(state.turn).toBe(1);

    const crowning = empty.map((row) => [...row]);
    crowning[6][1] = { seat: 0, isKing: false };
    crowning[0][7] = { seat: 1, isKing: false };
    const crowned = move({ board: crowning, turn: 0, jumpingFrom: null, outcome: null, lastMove: null }, 0, [6, 1], [7, 2]);
    expect(crowned.board[7][2]).toEqual({ seat: 0, isKing: true });
  });

  it("is won by taking the last piece", () => {
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));
    board[2][1] = { seat: 0, isKing: false };
    board[3][2] = { seat: 1, isKing: false };
    const state = move({ board, turn: 0, jumpingFrom: null, outcome: null, lastMove: null }, 0, [2, 1], [4, 3]);
    expect(state.outcome).toEqual({ kind: "win", winner: 0 });
    expect(checkers.turn(state)).toBeNull();
  });
});

describe("Battleship", () => {
  const random = seededRandom(3);
  const play = (state: BattleshipState, seat: Seat, move: unknown): BattleshipState => accepted(battleship.play(state, seat, move, random));

  function placedAndReady(): BattleshipState {
    let state = battleship.start(random);
    state = play(state, 0, { kind: "autoPlace" });
    // Seat 1's ships go one to a row, from column 0.
    FLEET.forEach((ship, row) => {
      state = play(state, 1, { kind: "place", ship: ship.id, row, column: 0, isAcross: true });
    });
    state = play(state, 0, { kind: "ready" });
    return play(state, 1, { kind: "ready" });
  }

  it("auto-places a whole fleet without overlaps", () => {
    const state = play(battleship.start(random), 0, { kind: "autoPlace" });
    const cells = state.fleets[0].ships.flatMap((ship) => shipCells(ship.size, ship.at!).map(([row, column]) => row * 10 + column));
    expect(cells).toHaveLength(17);
    expect(new Set(cells).size).toBe(17);
    expect(cells.every((cell) => cell >= 0 && cell < 100)).toBe(true);
  });

  it("finishes placing even when the random numbers never change", () => {
    const state = accepted(battleship.play(battleship.start(random), 0, { kind: "autoPlace" }, () => 0.5));
    expect(state.fleets[0].ships.every((ship) => ship.at !== null)).toBe(true);
  });

  it("refuses overlapping and off-board ships, and readiness before every ship is placed", () => {
    let state = battleship.start(random);
    expect(battleship.play(state, 0, { kind: "place", ship: "carrier", row: 0, column: 6, isAcross: true }, random).ok).toBe(false);
    state = play(state, 0, { kind: "place", ship: "carrier", row: 0, column: 0, isAcross: true });
    expect(battleship.play(state, 0, { kind: "place", ship: "destroyer", row: 0, column: 4, isAcross: false }, random).ok).toBe(false);
    expect(battleship.play(state, 0, { kind: "ready" }, random)).toEqual({ ok: false, error: "Place every ship first" });
    // Placing a ship again moves it.
    state = play(state, 0, { kind: "place", ship: "carrier", row: 5, column: 0, isAcross: true });
    expect(state.fleets[0].ships[0].at).toEqual({ row: 5, column: 0, isAcross: true });
  });

  it("starts firing when both are ready, hides the enemy's ships and reveals a sunk one", () => {
    let state = placedAndReady();
    expect(state.phase).toBe("firing");
    expect(battleship.turn(state)).toBe(0);
    const seenBySeatZero = battleship.viewFor(state, 0);
    expect(seenBySeatZero.fleets[1].ships.every((ship) => ship.at === null)).toBe(true);
    expect(seenBySeatZero.fleets[0].ships.every((ship) => ship.at !== null)).toBe(true);
    expect(battleship.viewFor(state, null).fleets.every((fleet) => fleet.ships.every((ship) => ship.at === null))).toBe(true);

    // The destroyer is in row 4, columns 0-1: a hit fires again, and two hits sink it.
    state = play(state, 0, { kind: "fire", row: 4, column: 0 });
    expect(state.turn).toBe(0);
    state = play(state, 0, { kind: "fire", row: 4, column: 1 });
    expect(state.lastShot?.sank).toBe("Destroyer");
    expect(battleship.viewFor(state, 0).fleets[1].ships[4].at).toEqual({ row: 4, column: 0, isAcross: true });
    expect(battleship.play(state, 0, { kind: "fire", row: 4, column: 1 }, random)).toEqual({ ok: false, error: "You have already fired there" });
    state = play(state, 0, { kind: "fire", row: 9, column: 9 });
    expect(state.turn).toBe(1);
  });

  it("is won by sinking the whole fleet", () => {
    let state = placedAndReady();
    FLEET.forEach((ship, row) => {
      for (let column = 0; column < ship.size; column++) state = play(state, 0, { kind: "fire", row, column });
    });
    expect(state.outcome).toEqual({ kind: "win", winner: 0 });
    expect(battleship.viewFor(state, null).fleets[0].ships.every((ship) => ship.at !== null)).toBe(true);
  });
});
