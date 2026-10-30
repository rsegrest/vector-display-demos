import { Chess, type Move, type PieceSymbol, type Square as ChessJsSquare } from "chess.js";
import { isRecord, refuse, type Choice, type MoveResult, type Outcome, type Seat, type TableGame } from "../TableGame.js";

// Chess, with the rules kept by chess.js. The state holds the position as FEN text, so it
// stays plain data; each function builds a Chess from it as it needs one. Seat 0 plays
// white, seat 1 black.

export const CHESS_SIZE = 8;

export type ChessPieceKind = "pawn" | "knight" | "bishop" | "rook" | "queen" | "king";
export type ChessPromotion = "q" | "r" | "b" | "n";

export interface ChessPiece {
  readonly seat: Seat;
  readonly kind: ChessPieceKind;
}

// A square by name, file then rank: "e4".
export type ChessSquare = string;

export interface ChessMove {
  readonly from: ChessSquare;
  readonly to: ChessSquare;
  // The piece a pawn reaching the far rank becomes; needed then, and only then.
  readonly promotion?: ChessPromotion;
}

export interface ChessState {
  readonly fen: string;
  // Every move so far, in standard algebraic notation (SAN).
  readonly history: readonly string[];
  readonly lastMove: { readonly from: ChessSquare; readonly to: ChessSquare; readonly san: string } | null;
  // Each position so far (the first four fields of its FEN: pieces, side to move, castling
  // and en passant), for the draw by threefold repetition, which a FEN alone cannot show.
  readonly positions: readonly string[];
  readonly outcome: Outcome | null;
}

const KIND_OF: Readonly<Record<PieceSymbol, ChessPieceKind>> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
// The usual rough worth of each piece, in pawns; the king is beyond price, so it counts for none.
const VALUE_OF: Readonly<Record<PieceSymbol, number>> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PROMOTIONS: readonly ChessPromotion[] = ["q", "r", "b", "n"];
const SQUARE_NAME = /^[a-h][1-8]$/;
const CENTER: readonly string[] = ["d4", "e4", "d5", "e5"];

const seatOfColor = (color: "w" | "b"): Seat => (color === "w" ? 0 : 1);

// The seat to move, read from the FEN's second field without building a Chess.
function sideToMove(state: ChessState): Seat {
  return seatOfColor(state.fen.split(" ")[1] === "b" ? "b" : "w");
}

// A position for repetition: the FEN's pieces, side to move, castling and en passant fields.
function positionKey(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

export function chessSquareName(fileIndex: number, rankIndex: number): ChessSquare {
  return `${"abcdefgh"[fileIndex]}${rankIndex + 1}`;
}

// The pieces on the board, [rank][file] with rank 0 the first rank (white's back rank) and
// file 0 the a-file.
export function chessBoardOf(state: ChessState): (ChessPiece | null)[][] {
  // chess.js lists the eighth rank first.
  const rows = new Chess(state.fen).board().reverse();
  return rows.map((row) => row.map((piece) => (piece ? { seat: seatOfColor(piece.color), kind: KIND_OF[piece.type] } : null)));
}

// The legal moves in a position, as chess.js describes them (with SAN and the FEN after each),
// kept for the positions seen lately. A computer player looking a move ahead asks for the
// same positions many times over, and working the moves out is most of what chess costs.
const MOST_POSITIONS_KEPT = 2000;
const movesByPosition = new Map<string, readonly Move[]>();

function movesInPosition(fen: string): readonly Move[] {
  let moves = movesByPosition.get(fen);
  if (!moves) {
    if (movesByPosition.size >= MOST_POSITIONS_KEPT) movesByPosition.clear();
    moves = new Chess(fen).moves({ verbose: true });
    movesByPosition.set(fen, moves);
  }
  return moves;
}

function verboseMoves(state: ChessState, seat: Seat): readonly Move[] {
  if (state.outcome || sideToMove(state) !== seat) return [];
  return movesInPosition(state.fen);
}

function moveOf(verbose: Move): ChessMove {
  return verbose.promotion ? { from: verbose.from, to: verbose.to, promotion: verbose.promotion as ChessPromotion } : { from: verbose.from, to: verbose.to };
}

// Every move the player in `seat` may make now: one for each piece a promoting pawn may become.
export function legalChessMoves(state: ChessState, seat: Seat): ChessMove[] {
  return verboseMoves(state, seat).map(moveOf);
}

// The square of the king in check, if the side to move is in check.
export function checkedKingSquare(state: ChessState): ChessSquare | null {
  const chess = new Chess(state.fen);
  if (!chess.inCheck()) return null;
  return chess.findPiece({ type: "k", color: chess.turn() })[0] ?? null;
}

// How the game stands after `played`, a move by `seat`: won, drawn, or going on. The move's
// SAN already says whether it gave checkmate (#) or check (+).
function outcomeAfter(played: Move, positions: readonly string[], seat: Seat): Outcome | null {
  if (played.san.endsWith("#")) return { winners: [seat], summary: "Checkmate" };
  const chess = new Chess(played.after);
  if (!played.san.endsWith("+") && chess.isStalemate()) return { winners: [], summary: "Stalemate: no legal move, but not in check" };
  if (chess.isInsufficientMaterial()) return { winners: [], summary: "Neither side has enough pieces left to checkmate" };
  if (chess.isDrawByFiftyMoves()) return { winners: [], summary: "Fifty moves each without a capture or a pawn move" };
  const current = positions[positions.length - 1];
  if (positions.filter((position) => position === current).length >= 3) return { winners: [], summary: "The same position three times" };
  return null;
}

// A move read in a few plain words, after its SAN: "Nf3: knight from g1 to f3".
function describe(verbose: Move): string {
  if (verbose.isKingsideCastle()) return `${verbose.san}: castle on the king's side`;
  if (verbose.isQueensideCastle()) return `${verbose.san}: castle on the queen's side`;
  const piece = KIND_OF[verbose.piece];
  const action = verbose.captured ? `takes the ${KIND_OF[verbose.captured]} on ${verbose.to}${verbose.isEnPassant() ? " in passing" : ""}` : `to ${verbose.to}`;
  const promotion = verbose.promotion ? `, becoming a ${KIND_OF[verbose.promotion]}` : "";
  const check = verbose.san.endsWith("#") ? ", checkmate" : verbose.san.endsWith("+") ? ", check" : "";
  return `${verbose.san}: ${piece} from ${verbose.from} ${action}${promotion}${check}`;
}

// How much a simple player likes a move: winning material, giving check, castling and
// bringing pieces out toward the center, less what it stands to lose on its new square.
function worthOf(verbose: Move, movesPlayed: number): number {
  let worth = 0;
  if (verbose.captured) worth += VALUE_OF[verbose.captured] * 10;
  if (verbose.promotion) worth += (VALUE_OF[verbose.promotion] - 1) * 10;
  if (verbose.san.endsWith("+")) worth += 4;
  if (verbose.isKingsideCastle() || verbose.isQueensideCastle()) worth += 6;
  else if (verbose.piece === "k") worth -= 3;

  const isOpening = movesPlayed < 20;
  const backRank = verbose.color === "w" ? "1" : "8";
  if (isOpening && (verbose.piece === "n" || verbose.piece === "b") && verbose.from[1] === backRank) worth += 3;
  if (isOpening && verbose.piece === "q") worth -= 1;
  if (CENTER.includes(verbose.to)) worth += 2;

  // What the piece may lose where it lands: all of it if it is attacked and not defended,
  // the difference if a cheaper piece attacks it.
  const after = new Chess(verbose.after);
  const opponent = verbose.color === "w" ? "b" : "w";
  const attackers = after.attackers(verbose.to as ChessJsSquare, opponent);
  if (attackers.length > 0) {
    const movedValue = VALUE_OF[verbose.promotion ?? verbose.piece];
    const cheapestAttacker = Math.min(...attackers.map((square) => VALUE_OF[after.get(square)!.type]));
    const isDefended = after.attackers(verbose.to as ChessJsSquare, verbose.color).length > 0;
    worth -= (isDefended ? Math.max(0, movedValue - cheapestAttacker) : movedValue) * 10;
  }
  return worth;
}

function readMove(move: unknown): ChessMove | null {
  if (!isRecord(move)) return null;
  const { from, to, promotion } = move;
  if (typeof from !== "string" || typeof to !== "string" || !SQUARE_NAME.test(from) || !SQUARE_NAME.test(to)) return null;
  if (promotion === undefined) return { from, to };
  if (typeof promotion !== "string" || !PROMOTIONS.includes(promotion as ChessPromotion)) return null;
  return { from, to, promotion: promotion as ChessPromotion };
}

function startingState(): ChessState {
  const fen = new Chess().fen();
  return { fen, history: [], lastMove: null, positions: [positionKey(fen)], outcome: null };
}

export const chess: TableGame<ChessState, ChessState> = {
  id: "chess",
  title: "Chess",
  description: "Checkmate the other king.",
  family: "board",
  minPlayers: 2,
  maxPlayers: 2,
  canLookAhead: true,
  strategy:
    "Win by checkmating the other king: attacking it so that no move saves it. Take pieces worth more than the one you risk (queen 9, rook 5, bishop and knight 3, pawn 1), and do not leave your own pieces where they can be taken for free. Early on, bring knights and bishops out toward the center, castle to keep the king safe, and hold the queen back.",

  start: () => startingState(),

  play(state, seat, move): MoveResult<ChessState> {
    if (state.outcome) return refuse("The game is over");
    if (sideToMove(state) !== seat) return refuse("Not your turn");
    const wanted = readMove(move);
    if (!wanted) return refuse("A move needs a from square and a to square, like e2 and e4, and a promotion of q, r, b or n if any");
    const candidates = movesInPosition(state.fen).filter((each) => each.from === wanted.from && each.to === wanted.to);
    if (candidates.length === 0) return refuse(new Chess(state.fen).inCheck() ? "That move is not allowed: you are in check" : "That move is not allowed");
    const isPromotion = candidates.some((each) => each.promotion);
    if (isPromotion && !wanted.promotion) return refuse("Choose what the pawn becomes: q, r, b or n");
    if (!isPromotion && wanted.promotion) return refuse("Only a pawn reaching the far rank is promoted");

    const played = candidates.find((each) => each.promotion === wanted.promotion)!;
    const positions = [...state.positions, positionKey(played.after)];
    return {
      ok: true,
      state: {
        fen: played.after,
        history: [...state.history, played.san],
        lastMove: { from: played.from, to: played.to, san: played.san },
        positions,
        outcome: outcomeAfter(played, positions, seat),
      },
    };
  },

  // Nothing is hidden in chess.
  viewFor: (state) => state,
  toMove: (state) => (state.outcome ? [] : [sideToMove(state)]),
  outcome: (state) => state.outcome,

  choices(state, seat): Choice[] {
    return verboseMoves(state, seat).map((verbose) => ({ move: moveOf(verbose), label: describe(verbose) }));
  },

  simpleStrategy(view, seat, choices, random) {
    const byKey = new Map(verboseMoves(view, seat).map((verbose) => [`${verbose.from}${verbose.to}${verbose.promotion ?? ""}`, verbose]));
    const worth = (choice: Choice): number => {
      const move = choice.move as ChessMove;
      const verbose = byKey.get(`${move.from}${move.to}${move.promotion ?? ""}`);
      return (verbose ? worthOf(verbose, view.history.length) : 0) + random() * 3;
    };
    const scored = choices.map((choice) => ({ choice, worth: worth(choice) }));
    return scored.reduce((best, each) => (each.worth > best.worth ? each : best)).choice;
  },
};
