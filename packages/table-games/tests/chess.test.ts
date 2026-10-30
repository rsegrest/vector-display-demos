import { describe, expect, it } from "vitest";
import { simpleChoice } from "../src/choosers.js";
import { checkedKingSquare, chess, chessBoardOf, legalChessMoves, type ChessState } from "../src/games/chess.js";
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

// A game set up from a position, as if it had just begun there.
function fromPosition(fen: string): ChessState {
  return { fen, history: [], lastMove: null, positions: [fen.split(" ").slice(0, 4).join(" ")], outcome: null };
}

describe("Chess", () => {
  const random = seededRandom(4);
  const move = (state: ChessState, from: string, to: string, promotion?: string): ChessState =>
    accepted(chess.play(state, chess.toMove(state)[0], promotion ? { from, to, promotion } : { from, to }, random));
  const moves = (state: ChessState, pairs: readonly string[]): ChessState => pairs.reduce((each, pair) => move(each, pair.slice(0, 2), pair.slice(2, 4)), state);

  it("starts with white (seat 0) to move and the pieces in place", () => {
    const state = chess.start(2, random);
    expect(chess.toMove(state)).toEqual([0]);
    const board = chessBoardOf(state);
    expect(board[0][4]).toEqual({ seat: 0, kind: "king" });
    expect(board[7][3]).toEqual({ seat: 1, kind: "queen" });
    expect(board[1][0]).toEqual({ seat: 0, kind: "pawn" });
    expect(board[3][4]).toBeNull();
    expect(legalChessMoves(state, 0)).toHaveLength(20);
    expect(legalChessMoves(state, 1)).toEqual([]);
  });

  it("plays a legal move, records it and passes the turn", () => {
    const start = chess.start(2, random);
    const state = move(start, "e2", "e4");
    expect(state.lastMove).toEqual({ from: "e2", to: "e4", san: "e4" });
    expect(state.history).toEqual(["e4"]);
    expect(chess.toMove(state)).toEqual([1]);
    expect(chessBoardOf(state)[3][4]).toEqual({ seat: 0, kind: "pawn" });
    // The state played on is never changed.
    expect(start.history).toEqual([]);
  });

  it("refuses moves out of turn, malformed, illegal and after the end", () => {
    const start = chess.start(2, random);
    expect(chess.play(start, 1, { from: "e7", to: "e5" }, random)).toEqual({ ok: false, error: "Not your turn" });
    for (const bad of [null, "e2e4", { from: "e2" }, { from: "e9", to: "e4" }, { from: "E2", to: "E4" }, { from: "e2", to: "e4", promotion: "k" }, { from: 12, to: 28 }]) {
      expect(chess.play(start, 0, bad, random).ok).toBe(false);
    }
    expect(chess.play(start, 0, { from: "e2", to: "e5" }, random)).toEqual({ ok: false, error: "That move is not allowed" });
    expect(chess.play(start, 0, { from: "e7", to: "e5" }, random).ok).toBe(false);
    expect(chess.play(start, 0, { from: "e2", to: "e4", promotion: "q" }, random).ok).toBe(false);
    const mated = moves(start, ["f2f3", "e7e5", "g2g4", "d8h4"]);
    expect(chess.play(mated, 0, { from: "a2", to: "a3" }, random)).toEqual({ ok: false, error: "The game is over" });
  });

  it("ends with fool's mate: black wins by checkmate", () => {
    const state = moves(chess.start(2, random), ["f2f3", "e7e5", "g2g4", "d8h4"]);
    expect(chess.outcome(state)).toEqual({ winners: [1], summary: "Checkmate" });
    expect(chess.toMove(state)).toEqual([]);
    expect(checkedKingSquare(state)).toBe("e1");
    expect(chess.choices(state, 0)).toEqual([]);
    expect(state.history.at(-1)).toBe("Qh4#");
  });

  it("refuses a move that leaves the king in check", () => {
    // After 1. e4 e5 2. Qh5 Nc6 3. Qxf7+, black's king is in check and must deal with it.
    const state = moves(chess.start(2, random), ["e2e4", "e7e5", "d1h5", "b8c6", "h5f7"]);
    expect(checkedKingSquare(state)).toBe("e8");
    expect(chess.play(state, 1, { from: "a7", to: "a6" }, random)).toEqual({ ok: false, error: "That move is not allowed: you are in check" });
    expect(legalChessMoves(state, 1)).toEqual([{ from: "e8", to: "f7" }]);
  });

  it("promotes a pawn reaching the far rank to the piece chosen, and only when chosen", () => {
    const state = fromPosition("8/4P3/8/8/8/8/k7/4K3 w - - 0 1");
    expect(chess.play(state, 0, { from: "e7", to: "e8" }, random)).toEqual({ ok: false, error: "Choose what the pawn becomes: q, r, b or n" });
    const promotions = legalChessMoves(state, 0).filter((each) => each.from === "e7");
    expect(promotions.map((each) => each.promotion).sort()).toEqual(["b", "n", "q", "r"]);
    expect(chessBoardOf(move(state, "e7", "e8", "q"))[7][4]).toEqual({ seat: 0, kind: "queen" });
    expect(chessBoardOf(move(state, "e7", "e8", "n"))[7][4]).toEqual({ seat: 0, kind: "knight" });
    expect(move(state, "e7", "e8", "r").history).toEqual(["e8=R"]);
  });

  it("is a draw by stalemate", () => {
    // White's queen to f7 leaves black's king on h8 no move, but not in check.
    const state = move(fromPosition("7k/8/6K1/8/8/8/8/5Q2 w - - 0 1"), "f1", "f7");
    expect(chess.outcome(state)).toEqual(expect.objectContaining({ winners: [] }));
    expect(chess.outcome(state)?.summary).toMatch(/Stalemate/);
    expect(checkedKingSquare(state)).toBeNull();
  });

  it("is a draw by threefold repetition, too few pieces, and the fifty-move rule", () => {
    const shuffle = ["g1f3", "g8f6", "f3g1", "f6g8"];
    const twice = moves(chess.start(2, random), shuffle);
    expect(chess.outcome(twice)).toBeNull();
    const thrice = moves(twice, shuffle);
    expect(chess.outcome(thrice)).toEqual({ winners: [], summary: "The same position three times" });

    const bareKings = move(fromPosition("1k6/8/8/8/8/8/6p1/4K2B w - - 0 1"), "h1", "g2");
    expect(chess.outcome(bareKings)?.winners).toEqual([]);
    expect(chess.outcome(bareKings)?.summary).toMatch(/enough pieces/);

    const fiftyMoves = move(fromPosition("4k3/8/8/8/8/8/8/R3K3 w - - 99 80"), "a1", "a2");
    expect(chess.outcome(fiftyMoves)?.summary).toMatch(/Fifty moves/);
  });

  it("lists every legal move as a choice, in SAN with plain words, with unique labels", () => {
    const positions = [
      chess.start(2, random),
      moves(chess.start(2, random), ["e2e4", "d7d5"]),
      fromPosition("r3k2r/pPpp1ppp/8/4pP2/8/8/PPPP1PPP/R3K2R w KQkq e6 0 1"),
    ];
    for (const state of positions) {
      const seat: Seat = chess.toMove(state)[0];
      const choices = chess.choices(state, seat);
      expect(choices.length).toBe(legalChessMoves(state, seat).length);
      expect(new Set(choices.map((choice) => choice.label)).size).toBe(choices.length);
      for (const choice of choices) expect(chess.play(state, seat, choice.move, random).ok).toBe(true);
      expect(chess.choices(state, 1 - seat)).toEqual([]);
    }
    const labels = (state: ChessState) => chess.choices(state, chess.toMove(state)[0]).map((choice) => choice.label);
    expect(labels(positions[0])).toContain("Nf3: knight from g1 to f3");
    expect(labels(positions[1])).toContain("exd5: pawn from e4 takes the pawn on d5");
    const tricky = labels(positions[2]);
    expect(tricky).toContain("O-O: castle on the king's side");
    expect(tricky).toContain("O-O-O: castle on the queen's side");
    expect(tricky).toContain("fxe6: pawn from f5 takes the pawn on e6 in passing");
    expect(tricky).toContain("bxa8=Q+: pawn from b7 takes the rook on a8, becoming a queen, check");
  });

  it("has a simple computer player that takes the most valuable piece and avoids losing its own", () => {
    // The rook may take the queen on d5 or the bishop on g2.
    const state = fromPosition("4k3/8/8/3q4/8/8/3R2bp/4K3 w - - 0 1");
    for (let tries = 0; tries < 8; tries++) {
      const decision = simpleChoice({ game: chess, state, view: state, seat: 0, random })!;
      expect(decision.choice.move).toEqual({ from: "d2", to: "d5" });
    }
    // Checkmate in one is taken at once.
    const nearlyMated = moves(chess.start(2, random), ["f2f3", "e7e5", "g2g4"]);
    expect(simpleChoice({ game: chess, state: nearlyMated, view: nearlyMated, seat: 1, random })!.choice.move).toEqual({ from: "d8", to: "h4" });
  });

  it("plays computer against computer for a while without a refused move", () => {
    let state = chess.start(2, random);
    for (let ply = 0; ply < 16 && !chess.outcome(state); ply++) {
      const seat = chess.toMove(state)[0];
      const decision = simpleChoice({ game: chess, state, view: chess.viewFor(state, seat), seat, random })!;
      state = accepted(chess.play(state, seat, decision.choice.move, random));
    }
    expect(state.history.length).toBeGreaterThan(0);
    // The state is plain data that survives being sent as JSON.
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});
