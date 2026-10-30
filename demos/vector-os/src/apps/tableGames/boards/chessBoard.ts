import type { BeamColor } from "@vector-display/core";
import {
  CHESS_SIZE,
  checkedKingSquare,
  chessBoardOf,
  chessSquareName,
  legalChessMoves,
  type ChessMove,
  type ChessPieceKind,
  type ChessPromotion,
  type ChessSquare,
  type ChessState,
} from "../../../../../../packages/table-games/src/games/chess.js";
import type { Rect, Ui } from "../Ui.js";
import { BOARD_COLORS, isMyMove, type BoardContext, type BoardDrawer } from "./BoardContext.js";

// White's pieces (seat 0) are drawn pale, black's (seat 1) a warm orange, so the two sides
// never look alike on a display with no fill.
export const CHESS_PIECE_COLORS: readonly [BeamColor, BeamColor] = [
  { red: 0.9, green: 0.95, blue: 1 },
  { red: 1, green: 0.5, blue: 0.22 },
];

// ── The pieces, as line drawings ───────────────────────────────────────────
//
// Each piece is a few strokes on a grid from -10 to 10 across and down (y grows downward, as
// on screen), standing on a pedestal along the bottom. They are scaled to fit inside a square.

type Point = readonly [x: number, y: number];
type Stroke = { readonly line: readonly Point[]; readonly isClosed?: boolean } | { readonly circle: readonly [x: number, y: number, radius: number] };

const PEDESTAL: Stroke = {
  line: [
    [-7, 9],
    [7, 9],
    [7, 6.5],
    [-7, 6.5],
  ],
  isClosed: true,
};
// A band across the lower body of the queen and king.
const BAND: Stroke = {
  line: [
    [-5.6, 3],
    [5.6, 3],
  ],
};

const GLYPHS: Readonly<Record<ChessPieceKind, readonly Stroke[]>> = {
  pawn: [
    PEDESTAL,
    { line: [[-4.5, 6.5], [-2, -0.5]] },
    { line: [[4.5, 6.5], [2, -0.5]] },
    { line: [[-3.5, -0.5], [3.5, -0.5], [3.5, -1.8], [-3.5, -1.8]], isClosed: true },
    { circle: [0, -4.6, 2.8] },
  ],
  rook: [
    PEDESTAL,
    { line: [[-5, 6.5], [-4, -3]] },
    { line: [[5, 6.5], [4, -3]] },
    { line: [[-5.5, -3], [5.5, -3]] },
    // The battlements.
    {
      line: [[-5.5, -3], [-5.5, -9], [-3.2, -9], [-3.2, -7], [-1.1, -7], [-1.1, -9], [1.1, -9], [1.1, -7], [3.2, -7], [3.2, -9], [5.5, -9], [5.5, -3]],
    },
  ],
  knight: [
    PEDESTAL,
    // A horse's head facing left: neck, muzzle, forehead, ear and mane.
    { line: [[-5, 6.5], [-3.5, 1.5], [-6.5, -0.5], [-8, -3], [-4, -7], [-2.5, -9.5], [-1, -7.5], [2.5, -6.5], [5.5, -2], [5.5, 6.5]] },
    { circle: [-3.2, -4.6, 0.7] },
  ],
  bishop: [
    PEDESTAL,
    { line: [[-4.5, 6.5], [-2, 0.5]] },
    { line: [[4.5, 6.5], [2, 0.5]] },
    { line: [[-3.5, 0.5], [3.5, 0.5], [3.5, -1], [-3.5, -1]], isClosed: true },
    // The mitre, with its slit, and the ball on top.
    { line: [[-2.5, -1], [-4, -4.5], [0, -8.5], [4, -4.5], [2.5, -1]] },
    { line: [[1.6, -6], [-1, -3.4]] },
    { circle: [0, -9.6, 1] },
  ],
  queen: [
    PEDESTAL,
    // A crown of five points, each with a ball.
    { line: [[-5, 6.5], [-7, -5], [-5, -0.5], [-3.5, -6.5], [-1.75, -1], [0, -8], [1.75, -1], [3.5, -6.5], [5, -0.5], [7, -5], [5, 6.5]] },
    BAND,
    { circle: [-7, -5.9, 0.9] },
    { circle: [-3.5, -7.4, 0.9] },
    { circle: [0, -8.9, 0.9] },
    { circle: [3.5, -7.4, 0.9] },
    { circle: [7, -5.9, 0.9] },
  ],
  king: [
    PEDESTAL,
    { line: [[-5, 6.5], [-7, -1], [-4.5, -4], [-1.5, -3], [0, -4.5], [1.5, -3], [4.5, -4], [7, -1], [5, 6.5]] },
    BAND,
    // The cross on top.
    { line: [[0, -4.5], [0, -10]] },
    { line: [[-2.2, -8], [2.2, -8]] },
  ],
};

// Draws a piece centered at (centerX, centerY) to fit a square of side `cell`.
export function drawChessPiece(ui: Ui, kind: ChessPieceKind, color: BeamColor, intensity: number, centerX: number, centerY: number, cell: number): void {
  const pen = ui.pen(color, intensity);
  const scale = cell / 22;
  for (const stroke of GLYPHS[kind]) {
    if ("circle" in stroke) {
      const [x, y, radius] = stroke.circle;
      ui.circle(color, intensity, centerX + x * scale, centerY + y * scale, radius * scale);
      continue;
    }
    stroke.line.forEach(([x, y], index) => {
      if (index === 0) pen.moveTo(centerX + x * scale, centerY + y * scale);
      else pen.lineTo(centerX + x * scale, centerY + y * scale);
    });
    if (stroke.isClosed) pen.closePath();
  }
}

// ── The board ──────────────────────────────────────────────────────────────

// What the window remembers between clicks: the piece picked up, and a pawn's move waiting
// for the player to say what it becomes. Both belong to one position, and are dropped when
// the position changes.
interface ChessChoices {
  fen: string;
  from: ChessSquare | null;
  promotingMove: { readonly from: ChessSquare; readonly to: ChessSquare } | null;
}

function choicesOf(local: Record<string, unknown>, fen: string): ChessChoices {
  const kept = local.chess as ChessChoices | undefined;
  if (kept && kept.fen === fen) return kept;
  const fresh: ChessChoices = { fen, from: null, promotingMove: null };
  local.chess = fresh;
  return fresh;
}

const PROMOTION_CHOICES: readonly { readonly promotion: ChessPromotion; readonly label: string }[] = [
  { promotion: "q", label: "Q" },
  { promotion: "r", label: "R" },
  { promotion: "b", label: "B" },
  { promotion: "n", label: "N" },
];

// Where the board lies in the area: the largest square that fits, less a narrow margin on
// the left and below for the rank numbers and file letters.
function layoutIn(area: Rect): { readonly left: number; readonly top: number; readonly cell: number; readonly margin: number } {
  const side = Math.min(area.width, area.height);
  const margin = side * 0.05;
  const cell = Math.floor((side - margin) / CHESS_SIZE);
  const total = cell * CHESS_SIZE + margin;
  return { left: area.x + (area.width - total) / 2 + margin, top: area.y + (area.height - total) / 2, cell, margin };
}

// Chess: each player sees their own side at the bottom (watchers see it as white does). A
// click on one of the player's pieces picks it up and shows where it may go; a click on one
// of those squares moves it, and a pawn reaching the far rank asks what it becomes.
export const drawChess: BoardDrawer = (context: BoardContext) => {
  const { ui, area, mySeat } = context;
  const state = context.view as ChessState;
  const choices = choicesOf(context.local, state.fen);
  const { left, top, cell, margin } = layoutIn(area);
  const side = cell * CHESS_SIZE;
  const isWhiteBelow = mySeat !== 1;
  const legal: ChessMove[] = isMyMove(context) && mySeat !== null ? legalChessMoves(state, mySeat) : [];
  if (choices.from && !legal.some((move) => move.from === choices.from)) choices.from = null;
  const destinations = choices.from ? legal.filter((move) => move.from === choices.from) : [];
  const pieces = chessBoardOf(state);
  const checkedKing = checkedKingSquare(state);

  // Files a to h run left to right, and ranks 1 to 8 upward, for white; both turn round for black.
  const screenColumn = (file: number): number => (isWhiteBelow ? file : CHESS_SIZE - 1 - file);
  const screenRow = (rank: number): number => (isWhiteBelow ? CHESS_SIZE - 1 - rank : rank);
  const squareRect = (file: number, rank: number): Rect => ({ x: left + screenColumn(file) * cell, y: top + screenRow(rank) * cell, width: cell, height: cell });

  // While a promotion is asked, its box covers the middle of the board: screen rows 3 and 4,
  // columns 1 to 6. The squares under it are left out, as a display with no fill cannot hide them.
  const promotionBox: Rect | null = choices.promotingMove ? { x: left + cell, y: top + 3 * cell, width: 6 * cell, height: 2 * cell } : null;
  const isUnderBox = (file: number, rank: number): boolean => {
    if (!promotionBox) return false;
    const column = screenColumn(file);
    const row = screenRow(rank);
    return column >= 1 && column <= 6 && row >= 3 && row <= 4;
  };

  // A click anywhere else on the board puts down the piece picked up (and takes back a promotion).
  if (legal.length > 0) {
    ui.region({ x: left, y: top, width: side, height: side }, () => {
      choices.from = null;
      choices.promotingMove = null;
    });
  }

  // The squares: a light grid, with the dark squares outlined again a little inside, brighter.
  ui.rect(BOARD_COLORS.grid, 0.7, { x: left, y: top, width: side, height: side });
  const gridPen = ui.pen(BOARD_COLORS.grid, 0.18);
  for (let line = 1; line < CHESS_SIZE; line++) {
    gridPen.addSegment(left + line * cell, top, left + line * cell, top + side);
    gridPen.addSegment(left, top + line * cell, left + side, top + line * cell);
  }

  for (let rank = 0; rank < CHESS_SIZE; rank++) {
    for (let file = 0; file < CHESS_SIZE; file++) {
      if (isUnderBox(file, rank)) continue;
      const square = chessSquareName(file, rank);
      const rect = squareRect(file, rank);
      const centerX = rect.x + cell / 2;
      const centerY = rect.y + cell / 2;
      // a1 is a dark square.
      if ((file + rank) % 2 === 0) ui.rect(BOARD_COLORS.grid, 0.42, rect, cell * 0.08);
      if (state.lastMove && (state.lastMove.from === square || state.lastMove.to === square)) ui.rect(BOARD_COLORS.accent, 0.55, rect, cell * 0.03);
      if (checkedKing === square) ui.circle(BOARD_COLORS.warn, 1.15, centerX, centerY, cell * 0.47);

      const piece = pieces[rank][file];
      const isPicked = choices.from === square;
      if (isPicked) ui.rect(BOARD_COLORS.accent, 1, rect, cell * 0.06);
      if (piece) drawChessPiece(ui, piece.kind, CHESS_PIECE_COLORS[piece.seat], isPicked ? 1.3 : 0.95, centerX, centerY, cell);

      // While a promotion is asked, the only clicks are on its buttons, or off the box to take it back.
      if (promotionBox) continue;
      const movesHere = destinations.filter((move) => move.to === square);
      if (movesHere.length > 0) {
        const intensity = ui.isHovered(rect) ? 1.1 : 0.5;
        // An empty square gets a dot; a piece that would be taken, a ring around it.
        if (piece) ui.circle(BOARD_COLORS.accent, intensity, centerX, centerY, cell * 0.44);
        else ui.circle(BOARD_COLORS.accent, intensity, centerX, centerY, cell * 0.1);
        ui.region(rect, () => {
          if (movesHere.some((move) => move.promotion)) {
            choices.promotingMove = { from: movesHere[0].from, to: square };
            return;
          }
          choices.from = null;
          context.send({ from: movesHere[0].from, to: square });
        });
      } else if (legal.some((move) => move.from === square)) {
        if (ui.isHovered(rect) && !isPicked) ui.rect(BOARD_COLORS.accent, 0.5, rect, cell * 0.06);
        ui.region(rect, () => {
          choices.from = isPicked ? null : square;
        });
      }
    }
  }

  // The rank numbers on the left and the file letters below, from the viewer's side.
  const labelSize = margin * 0.5;
  for (let index = 0; index < CHESS_SIZE; index++) {
    const rank = isWhiteBelow ? CHESS_SIZE - 1 - index : index;
    const file = isWhiteBelow ? index : CHESS_SIZE - 1 - index;
    ui.text(BOARD_COLORS.dim, String(rank + 1), left - margin / 2, top + index * cell + (cell - labelSize) / 2, labelSize, "center");
    ui.text(BOARD_COLORS.dim, "abcdefgh"[file], left + index * cell + cell / 2, top + side + margin * 0.15, labelSize, "center");
  }

  if (promotionBox && choices.promotingMove) drawPromotionBox(context, promotionBox, cell, choices);
};

// Four buttons for what a pawn reaching the far rank becomes: queen, rook, bishop or knight.
function drawPromotionBox(context: BoardContext, box: Rect, cell: number, choices: ChessChoices): void {
  const { ui } = context;
  const promotingMove = choices.promotingMove!;
  // A click inside the box, but on no button, does nothing.
  ui.region(box, () => {});
  ui.rect(BOARD_COLORS.accent, 0.8, box);
  const titleSize = cell * 0.24;
  ui.text(BOARD_COLORS.text, "Promote the pawn to", box.x + box.width / 2, box.y + cell * 0.14, titleSize, "center");
  const buttonWidth = cell * 1.2;
  const gap = cell * 0.2;
  const rowWidth = PROMOTION_CHOICES.length * buttonWidth + (PROMOTION_CHOICES.length - 1) * gap;
  PROMOTION_CHOICES.forEach(({ promotion, label }, index) => {
    const rect = { x: box.x + (box.width - rowWidth) / 2 + index * (buttonWidth + gap), y: box.y + cell * 0.6, width: buttonWidth, height: cell * 1.1 };
    ui.button(BOARD_COLORS.accent, rect, label, () => {
      choices.from = null;
      choices.promotingMove = null;
      context.send({ from: promotingMove.from, to: promotingMove.to, promotion });
    }, cell * 0.45);
  });
}
