import {
  PACHINKO_BALLS,
  PACHINKO_MULTIPLIERS,
  PACHINKO_ROWS,
  type PachinkoBall,
  type PachinkoBoard,
  type PachinkoMove,
  type PachinkoView,
} from "../../../../../../packages/table-games/src/games/pachinko.js";
import type { Rect } from "../Ui.js";
import { BOARD_COLORS, isMyMove, type BoardContext } from "./BoardContext.js";
import { animationStart, chipSizeOf, drawButtonRow, drawChipPicker, seatColor } from "./rouletteBoard.js";

// Pachinko: every seat's board side by side, a triangle of pegs over eleven bins. The rules
// decided each ball's path when it was dropped; the board plays that path back, the balls
// following one another down, bouncing from peg to peg into their bins.

const BINS = PACHINKO_MULTIPLIERS.length;
// When each ball of a drop sets off after the one before it, and how long it takes a row.
const BALL_GAP_SECONDS = 0.45;
const ROW_SECONDS = 0.14;
const DROP_SECONDS = (PACHINKO_BALLS - 1) * BALL_GAP_SECONDS + (PACHINKO_ROWS + 1) * ROW_SECONDS;

interface PegLayout {
  readonly centerX: number;
  readonly top: number;
  // Across between bins (and between the pegs of a row); down between rows.
  readonly spacing: number;
  readonly rowHeight: number;
  readonly binsTop: number;
  readonly bottom: number;
}

function pegAt(layout: PegLayout, row: number, index: number): [number, number] {
  return [layout.centerX + (index - row / 2) * layout.spacing, layout.top + row * layout.rowHeight];
}

// Where a ball is `elapsed` seconds after it set off: resting atop each peg in turn, hopping
// between them, and at last in its bin. null before it sets off.
function ballAt(layout: PegLayout, ball: PachinkoBall, elapsed: number, ballRadius: number): [number, number] | null {
  if (elapsed < 0) return null;
  const restingPoints: [number, number][] = [[layout.centerX, layout.top - layout.rowHeight]];
  let rights = 0;
  for (let row = 0; row < PACHINKO_ROWS; row++) {
    const [x, y] = pegAt(layout, row, rights);
    restingPoints.push([x, y - ballRadius - 1.5]);
    if (ball.path[row]) rights++;
  }
  restingPoints.push([layout.centerX + (ball.bin - (BINS - 1) / 2) * layout.spacing, layout.bottom - ballRadius - 1]);
  const step = elapsed / ROW_SECONDS;
  const index = Math.floor(step);
  if (index >= restingPoints.length - 1) return restingPoints[restingPoints.length - 1];
  const fraction = step - index;
  const [fromX, fromY] = restingPoints[index];
  const [toX, toY] = restingPoints[index + 1];
  // A little hop up off each peg on the way down.
  const hop = index > 0 ? Math.sin(Math.PI * fraction) * layout.rowHeight * 0.35 : 0;
  return [fromX + (toX - fromX) * fraction, fromY + (toY - fromY) * fraction - hop];
}

export function drawPachinko(context: BoardContext): void {
  const { ui, area, mySeat, local, seconds } = context;
  const state = context.view as PachinkoView;
  const send = (move: PachinkoMove): void => context.send(move);
  const canDrop = isMyMove(context) && mySeat !== null;
  const controlsHeight = canDrop ? 30 : 0;
  const count = state.boards.length;
  const gap = 10;
  const boardWidth = (area.width - gap * (count - 1)) / count;

  state.boards.forEach((board, seat) => {
    const rect = { x: area.x + seat * (boardWidth + gap), y: area.y, width: boardWidth, height: area.height - controlsHeight };
    const start = animationStart(local, `pachinko${seat}`, board.drops, seconds);
    drawPegBoard(context, rect, seat, board, seconds - start);
  });

  if (!canDrop) return;
  const amount = chipSizeOf(local, state.chips[mySeat]);
  const rowY = area.y + area.height - controlsHeight + 6;
  const pickerEnd = drawChipPicker(ui, local, area.x, rowY, state.chips[mySeat]);
  drawButtonRow(ui, pickerEnd + 10, rowY, [{ label: `Drop ${PACHINKO_BALLS} balls for ${amount}`, color: BOARD_COLORS.accent, onPress: () => send({ kind: "drop", amount }) }]);
}

function drawPegBoard(context: BoardContext, rect: Rect, seat: number, board: PachinkoBoard, elapsed: number): void {
  const { ui, names } = context;
  const state = context.view as PachinkoView;
  const color = seatColor(seat);
  ui.text(color, ui.fitted(`${seat === context.mySeat ? "> " : ""}${names[seat]}: ${state.chips[seat]}`, 10, rect.width), rect.x, rect.y, 10, "left", context.toMove.includes(seat) ? 1.2 : 0.75);

  const frame = { x: rect.x, y: rect.y + 16, width: rect.width, height: rect.height - 16 - 18 };
  const spacing = Math.min(frame.width / BINS, (frame.height * 0.9) / (PACHINKO_ROWS + 3));
  const binHeight = Math.max(18, spacing * 1.8);
  const rowHeight = (frame.height - binHeight - spacing * 1.5) / (PACHINKO_ROWS + 0.5);
  const layout: PegLayout = {
    centerX: frame.x + frame.width / 2,
    top: frame.y + spacing * 1.2,
    spacing,
    rowHeight,
    binsTop: frame.y + frame.height - binHeight,
    bottom: frame.y + frame.height,
  };
  ui.rect(color, seat === context.mySeat ? 0.6 : 0.35, frame);

  // The pegs, as small diamonds.
  const pegs = ui.pen(BOARD_COLORS.grid, 0.7);
  const pegSize = Math.max(1, spacing * 0.1);
  for (let row = 0; row < PACHINKO_ROWS; row++) {
    for (let index = 0; index <= row; index++) {
      const [x, y] = pegAt(layout, row, index);
      pegs.moveTo(x, y - pegSize);
      pegs.lineTo(x + pegSize, y);
      pegs.lineTo(x, y + pegSize);
      pegs.lineTo(x - pegSize, y);
      pegs.closePath();
    }
  }

  // The bins and their multipliers; the middle pays most, so it is brightest.
  const walls = ui.pen(BOARD_COLORS.grid, 0.45);
  const labelSize = Math.max(5, Math.min(9, spacing * 0.42));
  for (let bin = 0; bin <= BINS; bin++) {
    const x = layout.centerX + (bin - BINS / 2) * spacing;
    walls.addSegment(x, layout.binsTop, x, layout.bottom);
  }
  walls.addSegment(layout.centerX - (BINS / 2) * spacing, layout.bottom, layout.centerX + (BINS / 2) * spacing, layout.bottom);
  PACHINKO_MULTIPLIERS.forEach((multiplier, bin) => {
    const x = layout.centerX + (bin - (BINS - 1) / 2) * spacing;
    const label = multiplier < 1 ? `.${Math.round(multiplier * 10)}` : `${multiplier}`;
    ui.text(multiplier >= 5 ? BOARD_COLORS.accent : BOARD_COLORS.text, label, x, layout.binsTop + 2, labelSize, "center", 0.5 + multiplier / 10);
  });

  // The balls of the last drop, each set off a moment after the one before.
  const ballRadius = Math.max(1.5, spacing * 0.2);
  board.balls.forEach((ball, index) => {
    const position = ballAt(layout, ball, elapsed - index * BALL_GAP_SECONDS, ballRadius);
    if (!position) return;
    // Balls in the same bin stack up.
    const landedBefore = board.balls.slice(0, index).filter((other) => other.bin === ball.bin).length;
    const isLanded = elapsed - index * BALL_GAP_SECONDS >= (PACHINKO_ROWS + 1) * ROW_SECONDS;
    ui.circle(BOARD_COLORS.bright, 1.2, position[0], position[1] - (isLanded ? landedBefore * ballRadius * 2.1 : 0), ballRadius);
  });

  const resultY = frame.y + frame.height + 5;
  if (board.drops === 0) ui.text(BOARD_COLORS.dim, "No balls dropped yet", rect.x, resultY, 9);
  else if (elapsed < DROP_SECONDS) ui.text(BOARD_COLORS.dim, "Falling...", rect.x, resultY, 9);
  else ui.text(board.returned >= board.bet ? BOARD_COLORS.accent : BOARD_COLORS.dim, ui.fitted(`Back ${board.returned} on ${board.bet}`, 9, rect.width), rect.x, resultY, 9);
}
