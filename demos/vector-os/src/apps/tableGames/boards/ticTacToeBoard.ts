import type { BeamColor } from "@vector-display/core";
import type { Seat } from "@vector-demos/table-games";
import type { TicTacToeState } from "../../../../../../packages/table-games/src/games/ticTacToe.js";
import type { Ui } from "../Ui.js";
import { BOARD_COLORS, isMyMove, type BoardContext, type BoardDrawer } from "./BoardContext.js";

const SIZE = 3;
// Seat 0 plays X, seat 1 plays O.
const MARK_COLORS: readonly [BeamColor, BeamColor] = [BOARD_COLORS.seats[0], BOARD_COLORS.seats[1]];

function drawMark(ui: Ui, seat: Seat, centerX: number, centerY: number, cell: number, intensity: number): void {
  if (seat === 0) ui.cross(MARK_COLORS[0], intensity, centerX, centerY, cell * 0.28);
  else ui.circle(MARK_COLORS[1], intensity, centerX, centerY, cell * 0.32);
}

// Tic-tac-toe: the two pairs of crossing lines, the marks, and a line through three in a row.
export const drawTicTacToe: BoardDrawer = (context: BoardContext) => {
  const { ui, area, mySeat, send } = context;
  const state = context.view as TicTacToeState;
  const side = Math.floor(Math.min(area.width, area.height));
  const cell = side / SIZE;
  const left = area.x + (area.width - side) / 2;
  const top = area.y + (area.height - side) / 2;
  const centerOf = (cellIndex: number): [x: number, y: number] => [left + (cellIndex % SIZE) * cell + cell / 2, top + Math.floor(cellIndex / SIZE) * cell + cell / 2];
  const myTurn = isMyMove(context);

  // The grid stops a little short of the edges, as when drawn by hand.
  const pen = ui.pen(BOARD_COLORS.grid, 0.7);
  const margin = cell * 0.08;
  for (let line = 1; line < SIZE; line++) {
    pen.addSegment(left + line * cell, top + margin, left + line * cell, top + side - margin);
    pen.addSegment(left + margin, top + line * cell, left + side - margin, top + line * cell);
  }

  state.board.forEach((mark, cellIndex) => {
    const [centerX, centerY] = centerOf(cellIndex);
    if (mark !== null) {
      drawMark(ui, mark, centerX, centerY, cell, cellIndex === state.lastMark ? 1.25 : 0.9);
      return;
    }
    if (!myTurn || mySeat === null) return;
    const rect = { x: left + (cellIndex % SIZE) * cell, y: top + Math.floor(cellIndex / SIZE) * cell, width: cell, height: cell };
    // The mark the player would make, shown faintly where the pointer is.
    if (ui.isHovered(rect)) drawMark(ui, mySeat, centerX, centerY, cell, 0.35);
    ui.region(rect, () => send({ cell: cellIndex }));
  });

  // A line through the three that won, reaching a little past the end marks.
  if (state.winningLine.length === SIZE) {
    const [startX, startY] = centerOf(state.winningLine[0]);
    const [endX, endY] = centerOf(state.winningLine[SIZE - 1]);
    const length = Math.hypot(endX - startX, endY - startY);
    const reach = (cell * 0.38) / length;
    const dx = (endX - startX) * reach;
    const dy = (endY - startY) * reach;
    ui.pen(BOARD_COLORS.accent, 1.2).addSegment(startX - dx, startY - dy, endX + dx, endY + dy);
  }
};
