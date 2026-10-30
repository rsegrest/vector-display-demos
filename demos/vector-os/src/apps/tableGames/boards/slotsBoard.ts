import type { BeamColor } from "@vector-display/core";
import { SLOT_SYMBOLS, type SlotMachine, type SlotSymbol, type SlotsMove, type SlotsView } from "../../../../../../packages/table-games/src/games/slots.js";
import type { Rect, Ui } from "../Ui.js";
import { BOARD_COLORS, isMyMove, type BoardContext } from "./BoardContext.js";
import { animationStart, chipSizeOf, drawButtonRow, drawChipPicker, seatColor } from "./rouletteBoard.js";

// Slots: every seat's machine side by side, three reels in a window three symbols high with the
// payline across the middle. The viewer's machine has a lever (and a Spin button) that spins it
// for the picked bet; the reels run a moment and stop one after another, left to right.

const REEL_STOPS: readonly number[] = [0.7, 1.05, 1.4];
const LEVER_SECONDS = 0.35;

const SYMBOL_COLORS: Readonly<Record<SlotSymbol, BeamColor>> = {
  cherry: { red: 1, green: 0.3, blue: 0.35 },
  lemon: { red: 1, green: 0.95, blue: 0.35 },
  orange: { red: 1, green: 0.6, blue: 0.2 },
  plum: { red: 0.75, green: 0.45, blue: 1 },
  bell: { red: 1, green: 0.82, blue: 0.3 },
  bar: { red: 0.85, green: 0.9, blue: 1 },
  seven: { red: 1, green: 0.3, blue: 0.25 },
  diamond: { red: 0.4, green: 0.95, blue: 1 },
};
const STEM: BeamColor = { red: 0.4, green: 1, blue: 0.5 };

// An oval around (x, y), in sixteen lines.
function oval(ui: Ui, color: BeamColor, x: number, y: number, radiusX: number, radiusY: number): void {
  const pen = ui.pen(color, 1);
  const points = 16;
  pen.moveTo(x + radiusX, y);
  for (let point = 1; point < points; point++) {
    const angle = (point / points) * 2 * Math.PI;
    pen.lineTo(x + radiusX * Math.cos(angle), y + radiusY * Math.sin(angle));
  }
  pen.closePath();
}

// One symbol in a square of half-size `half` around (x, y), in lines.
export function drawSymbol(ui: Ui, symbol: SlotSymbol, x: number, y: number, half: number): void {
  const color = SYMBOL_COLORS[symbol];
  const pen = ui.pen(color, 1);
  const at = (dx: number, dy: number): [number, number] => [x + dx * half, y + dy * half];
  const line = (points: readonly (readonly [number, number])[], isClosed = false): void => {
    pen.moveTo(...at(...points[0]));
    for (const point of points.slice(1)) pen.lineTo(...at(...point));
    if (isClosed) pen.closePath();
  };
  switch (symbol) {
    case "cherry": {
      ui.circle(color, 1, ...at(-0.35, 0.4), half * 0.28);
      ui.circle(color, 1, ...at(0.32, 0.5), half * 0.28);
      const stem = ui.pen(STEM, 0.9);
      stem.moveTo(...at(-0.3, 0.13));
      stem.lineTo(...at(0.1, -0.65));
      stem.lineTo(...at(0.3, 0.22));
      stem.moveTo(...at(0.1, -0.65));
      stem.lineTo(...at(0.5, -0.55));
      stem.lineTo(...at(0.25, -0.4));
      break;
    }
    case "lemon":
      oval(ui, color, x, y, half * 0.72, half * 0.48);
      line([
        [0.72, 0],
        [0.85, -0.05],
      ]);
      line([
        [-0.72, 0],
        [-0.85, 0.05],
      ]);
      break;
    case "orange":
      ui.circle(color, 1, x, y + half * 0.08, half * 0.6);
      ui.pen(STEM, 0.9).addSegment(...at(0, -0.52), ...at(0.3, -0.75));
      ui.circle(color, 0.6, ...at(0, -0.4), half * 0.06);
      break;
    case "plum":
      oval(ui, color, x, y + half * 0.1, half * 0.5, half * 0.6);
      pen.addSegment(...at(0, -0.5), ...at(0, 0.7));
      ui.pen(STEM, 0.9).addSegment(...at(0, -0.5), ...at(-0.2, -0.8));
      break;
    case "bell":
      line([
        [-0.15, -0.6],
        [-0.35, -0.4],
        [-0.45, 0.1],
        [-0.7, 0.45],
        [0.7, 0.45],
        [0.45, 0.1],
        [0.35, -0.4],
        [0.15, -0.6],
      ], true);
      ui.circle(color, 1, ...at(0, -0.7), half * 0.1);
      ui.circle(color, 1, ...at(0, 0.6), half * 0.13);
      break;
    case "bar":
      ui.rect(color, 1, { x: x - half * 0.8, y: y - half * 0.38, width: half * 1.6, height: half * 0.76 });
      ui.text(color, "BAR", x, y - half * 0.22, half * 0.44, "center", 1);
      break;
    case "seven":
      line([
        [-0.5, -0.45],
        [-0.5, -0.65],
        [0.55, -0.65],
        [0.55, -0.45],
        [0, 0.7],
        [-0.25, 0.7],
        [0.3, -0.45],
      ], true);
      break;
    case "diamond":
      line([
        [-0.35, -0.6],
        [0.35, -0.6],
        [0.7, -0.2],
        [0, 0.7],
        [-0.7, -0.2],
      ], true);
      line([
        [-0.7, -0.2],
        [0.7, -0.2],
      ]);
      line([
        [-0.35, -0.6],
        [-0.15, -0.2],
        [0, 0.7],
        [0.15, -0.2],
        [0.35, -0.6],
      ]);
      break;
  }
}

export function drawSlots(context: BoardContext): void {
  const { ui, area, mySeat, local, seconds } = context;
  const state = context.view as SlotsView;
  const send = (move: SlotsMove): void => context.send(move);
  const canSpin = isMyMove(context) && mySeat !== null;
  const controlsHeight = canSpin ? 30 : 0;
  const count = state.machines.length;
  const gap = 10;
  const machineWidth = (area.width - gap * (count - 1)) / count;
  const amount = mySeat === null ? 0 : chipSizeOf(local, state.chips[mySeat]);
  const spin = (): void => send({ kind: "spin", amount });

  state.machines.forEach((machine, seat) => {
    const rect = { x: area.x + seat * (machineWidth + gap), y: area.y, width: machineWidth, height: area.height - controlsHeight };
    const start = animationStart(local, `slots${seat}`, machine.spins, seconds);
    drawMachine(context, rect, seat, machine, seconds - start, seat === mySeat && canSpin ? spin : null);
  });

  if (!canSpin) return;
  const rowY = area.y + area.height - controlsHeight + 6;
  const pickerEnd = drawChipPicker(ui, local, area.x, rowY, state.chips[mySeat]);
  drawButtonRow(ui, pickerEnd + 10, rowY, [{ label: `Spin for ${amount}`, color: BOARD_COLORS.accent, onPress: spin }]);
}

// One machine: its player and chips, the reels (spinning for `elapsed` seconds after the last
// spin), what it paid, and for the viewer a lever that spins it.
function drawMachine(context: BoardContext, rect: Rect, seat: number, machine: SlotMachine, elapsed: number, spin: (() => void) | null): void {
  const { ui, names } = context;
  const state = context.view as SlotsView;
  const color = seatColor(seat);
  const isMine = seat === context.mySeat;
  ui.text(color, ui.fitted(`${isMine ? "> " : ""}${names[seat]}: ${state.chips[seat]}`, 10, rect.width), rect.x, rect.y, 10, "left", context.toMove.includes(seat) ? 1.2 : 0.75);

  const leverRoom = spin ? Math.min(26, rect.width * 0.15) : 0;
  const cabinet = { x: rect.x, y: rect.y + 16, width: rect.width - leverRoom, height: rect.height - 16 - 30 };
  const cell = Math.max(10, Math.min((cabinet.width - 12) / 3, (cabinet.height - 12) / 3));
  const window = { x: cabinet.x + (cabinet.width - cell * 3) / 2, y: cabinet.y + (cabinet.height - cell * 3) / 2, width: cell * 3, height: cell * 3 };
  ui.rect(color, isMine ? 0.7 : 0.4, cabinet);
  ui.rect(BOARD_COLORS.grid, 0.5, window);
  const isSpinning = machine.reels !== null && elapsed < REEL_STOPS[2];
  for (let reel = 0; reel < 3; reel++) {
    if (reel > 0) ui.pen(BOARD_COLORS.grid, 0.35).addSegment(window.x + reel * cell, window.y, window.x + reel * cell, window.y + window.height);
    for (let row = 0; row < 3; row++) {
      const isStopped = machine.reels !== null && elapsed >= REEL_STOPS[reel];
      // A reel still turning shows the symbols running past.
      const symbol = isStopped ? machine.reels![reel][row] : machine.reels ? SLOT_SYMBOLS[(Math.floor(elapsed * 16) + row * 3 + reel * 5) % SLOT_SYMBOLS.length] : SLOT_SYMBOLS[(row + reel * 3) % SLOT_SYMBOLS.length];
      drawSymbol(ui, symbol, window.x + reel * cell + cell / 2, window.y + row * cell + cell / 2, cell * 0.4);
    }
  }
  // The payline.
  const payline = ui.pen(BOARD_COLORS.accent, 0.8);
  payline.addSegment(window.x - 6, window.y + cell * 1.5, window.x, window.y + cell * 1.5);
  payline.addSegment(window.x + window.width, window.y + cell * 1.5, window.x + window.width + 6, window.y + cell * 1.5);

  const resultY = cabinet.y + cabinet.height + 6;
  if (machine.reels && !isSpinning) {
    const text = machine.returned > 0 ? `${machine.win}: back ${machine.returned} on ${machine.bet}` : `No win on ${machine.bet}`;
    ui.text(machine.returned > 0 ? BOARD_COLORS.accent : BOARD_COLORS.dim, ui.fitted(text, 9, rect.width), rect.x, resultY, 9);
  } else if (!machine.reels) {
    ui.text(BOARD_COLORS.dim, "Not spun yet", rect.x, resultY, 9);
  }

  if (!spin) return;
  // The lever: a rod from the side of the cabinet with a knob, pulled down for a moment by a spin.
  const isPulled = machine.reels !== null && elapsed < LEVER_SECONDS;
  const leverX = cabinet.x + cabinet.width + leverRoom / 2;
  const pivotY = cabinet.y + cabinet.height * 0.55;
  const knobY = isPulled ? cabinet.y + cabinet.height * 0.85 : cabinet.y + cabinet.height * 0.15;
  const leverRect = { x: cabinet.x + cabinet.width, y: cabinet.y, width: leverRoom, height: cabinet.height };
  const isHovered = ui.isHovered(leverRect);
  ui.pen(BOARD_COLORS.text, 0.8).addSegment(cabinet.x + cabinet.width, pivotY, leverX, pivotY);
  ui.pen(BOARD_COLORS.text, 0.8).addSegment(leverX, pivotY, leverX, knobY);
  ui.circle(BOARD_COLORS.warn, isHovered ? 1.4 : 1, leverX, knobY, Math.max(3, leverRoom * 0.25));
  ui.region(leverRect, spin);
}
