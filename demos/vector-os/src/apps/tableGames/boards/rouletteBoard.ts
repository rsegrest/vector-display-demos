import type { BeamColor } from "@vector-display/core";
import type { Seat } from "@vector-demos/table-games";
import {
  ROULETTE_MAXIMUM_BET,
  ROULETTE_MOST_BETS,
  rouletteColor,
  WHEEL_ORDER,
  type RouletteBet,
  type RouletteBetKind,
  type RouletteMove,
  type RouletteView,
} from "../../../../../../packages/table-games/src/games/roulette.js";
import type { Rect, Ui } from "../Ui.js";
import { BOARD_COLORS, isMyMove, type BoardContext } from "./BoardContext.js";

// ── What every casino board shares ─────────────────────────────────────────

// The bet sizes a person picks between; the picked one is what a click on the table lays.
export const CHIP_SIZES: readonly number[] = [10, 25, 50, 100];

export function seatColor(seat: Seat): BeamColor {
  return BOARD_COLORS.seats[seat % BOARD_COLORS.seats.length];
}

// The bet size picked, kept in the board's `local`: the largest the seat can afford, if the
// one picked has grown too large for its stack.
export function chipSizeOf(local: Record<string, unknown>, chips: number): number {
  local.chipSize ??= CHIP_SIZES[0];
  const picked = local.chipSize as number;
  return picked <= chips ? picked : ([...CHIP_SIZES].reverse().find((size) => size <= chips) ?? CHIP_SIZES[0]);
}

// The bet size buttons, from `x` along a row at `y`; a size the seat cannot afford is left dim
// and does nothing. Returns where the row ends.
export function drawChipPicker(ui: Ui, local: Record<string, unknown>, x: number, y: number, chips: number, height = 20): number {
  const picked = chipSizeOf(local, chips);
  ui.text(BOARD_COLORS.dim, "Bet", x, y + (height - 10) / 2, 10);
  let left = x + ui.textWidth("Bet", 10) + 6;
  for (const size of CHIP_SIZES) {
    const rect = { x: left, y, width: ui.textWidth(`${size}`, 10) + 12, height };
    if (size > chips) ui.rect(BOARD_COLORS.dim, 0.25, rect);
    else ui.button(size === picked ? BOARD_COLORS.accent : BOARD_COLORS.text, rect, `${size}`, () => (local.chipSize = size), 10);
    if (size === picked) ui.rect(BOARD_COLORS.accent, 0.8, rect, 2);
    left += rect.width + 4;
  }
  return left;
}

// A row of buttons from `x` at `y`; returns where the row ends.
export function drawButtonRow(ui: Ui, x: number, y: number, buttons: readonly { label: string; color: BeamColor; onPress: () => void }[], height = 20): number {
  let left = x;
  for (const { label, color, onPress } of buttons) {
    const width = ui.textWidth(label, 10) + 16;
    ui.button(color, { x: left, y, width, height }, label, onPress, 10);
    left += width + 6;
  }
  return left;
}

// Every seat's name and chips, with a line of detail under each (its bets, or what it won), in
// as many columns as fit. Returns the height used.
export function drawSeatStrip(context: BoardContext, area: Rect, chips: readonly number[], detail: (seat: Seat) => string): number {
  const { ui, names, toMove, mySeat } = context;
  const perRow = Math.max(1, Math.min(names.length, Math.floor(area.width / 130)));
  const columnWidth = area.width / perRow;
  const rowHeight = 26;
  names.forEach((name, seat) => {
    const x = area.x + (seat % perRow) * columnWidth;
    const y = area.y + Math.floor(seat / perRow) * rowHeight;
    const isMoving = toMove.includes(seat);
    const title = `${seat === mySeat ? "> " : ""}${name}: ${chips[seat]}`;
    ui.text(seatColor(seat), ui.fitted(title, 10, columnWidth - 6), x, y, 10, "left", isMoving ? 1.2 : 0.75);
    ui.text(BOARD_COLORS.dim, ui.fitted(detail(seat), 8, columnWidth - 6), x, y + 13, 8, "left", 0.8);
  });
  return Math.ceil(names.length / perRow) * rowHeight;
}

// How far along an animation that began at `start` is, from 0 to 1, eased to slow at the end.
export function easedProgress(seconds: number, start: number, duration: number): number {
  const progress = Math.max(0, Math.min(1, (seconds - start) / duration));
  return 1 - (1 - progress) ** 3;
}

// When the animation for the count `count` (spins, rolls, draws) began: now, the first frame the
// board sees that count; long ago for the count the board first opened on, so it is not replayed.
export function animationStart(local: Record<string, unknown>, key: string, count: number, seconds: number): number {
  const starts = (local.animationStarts ??= {}) as Record<string, { count: number; start: number }>;
  const known = starts[key];
  if (!known) starts[key] = { count, start: -Infinity };
  else if (known.count !== count) starts[key] = { count, start: seconds };
  return starts[key].start;
}

// ── Roulette ───────────────────────────────────────────────────────────────

const SPIN_SECONDS = 3.5;
const RED: BeamColor = { red: 1, green: 0.35, blue: 0.3 };
const GREEN: BeamColor = { red: 0.4, green: 1, blue: 0.55 };

function pocketColor(number: number): BeamColor {
  const color = rouletteColor(number);
  return color === "red" ? RED : color === "green" ? GREEN : BOARD_COLORS.text;
}

type Spot = Pick<RouletteBet, "on" | "number">;

function spotName(spot: Spot): string {
  if (spot.on === "straight") return `${spot.number}`;
  const names: Partial<Record<RouletteBetKind, string>> = {
    red: "Red",
    black: "Black",
    odd: "Odd",
    even: "Even",
    low: "1-18",
    high: "19-36",
    dozen1: "1st 12",
    dozen2: "2nd 12",
    dozen3: "3rd 12",
    column1: "2:1",
    column2: "2:1",
    column3: "2:1",
  };
  return names[spot.on]!;
}

// The table drawn from the top, in a grid 14 cells across (zero, twelve columns of numbers, the
// column bets) and 5 down (three rows of numbers, the dozens, the even-money bets).
function layoutSpots(): { spot: Spot; column: number; row: number; columns: number; rows: number }[] {
  const spots: { spot: Spot; column: number; row: number; columns: number; rows: number }[] = [{ spot: { on: "straight", number: 0 }, column: 0, row: 0, columns: 1, rows: 3 }];
  for (let column = 0; column < 12; column++) {
    for (let row = 0; row < 3; row++) spots.push({ spot: { on: "straight", number: 3 * (column + 1) - row }, column: column + 1, row, columns: 1, rows: 1 });
  }
  (["column3", "column2", "column1"] as const).forEach((on, row) => spots.push({ spot: { on }, column: 13, row, columns: 1, rows: 1 }));
  (["dozen1", "dozen2", "dozen3"] as const).forEach((on, index) => spots.push({ spot: { on }, column: 1 + 4 * index, row: 3, columns: 4, rows: 1 }));
  (["low", "even", "red", "black", "odd", "high"] as const).forEach((on, index) => spots.push({ spot: { on }, column: 1 + 2 * index, row: 4, columns: 2, rows: 1 }));
  return spots;
}

const LAYOUT = layoutSpots();

export function drawRoulette(context: BoardContext): void {
  const { ui, area, mySeat, local, seconds } = context;
  const state = context.view as RouletteView;
  const send = (move: RouletteMove): void => context.send(move);
  const canBet = isMyMove(context) && mySeat !== null;

  const stripHeight = drawSeatStrip(context, area, state.chips, (seat) => {
    const laid = state.bets[seat].reduce((sum, bet) => sum + bet.amount, 0);
    const status = context.toMove.includes(seat) ? "betting" : state.isReady[seat] ? "ready" : "out";
    const last = state.lastSpin && state.lastSpin.staked[seat] > 0 ? `, last ${state.lastSpin.returned[seat] - state.lastSpin.staked[seat] >= 0 ? "+" : ""}${state.lastSpin.returned[seat] - state.lastSpin.staked[seat]}` : "";
    return `${status}${laid > 0 ? `, ${laid} down` : ""}${last}`;
  });
  const controlsHeight = 46;
  const top = area.y + stripHeight + 6;
  const height = area.y + area.height - controlsHeight - top;
  const radius = Math.max(20, Math.min(height / 2, area.width * 0.17));
  const start = animationStart(local, "roulette", state.spins, seconds);
  const progress = state.lastSpin ? easedProgress(seconds, start, SPIN_SECONDS) : 1;
  drawWheel(ui, area.x + radius, top + height / 2, radius, state.lastSpin?.number ?? null, progress);

  const tableArea = { x: area.x + 2 * radius + 16, y: top, width: area.width - 2 * radius - 16, height };
  drawLayout(context, tableArea, state, canBet, progress >= 1);

  // The controls and the last spin, under the wheel and table.
  const controlsTop = area.y + area.height - controlsHeight + 4;
  const result = state.lastSpin;
  const resultText =
    !result || progress < 1
      ? result
        ? "The wheel is spinning..."
        : "Place your bets"
      : `${result.number} ${rouletteColor(result.number)}${mySeat !== null && result.staked[mySeat] > 0 ? `: you staked ${result.staked[mySeat]}, back ${result.returned[mySeat]}` : ""}`;
  ui.text(progress < 1 ? BOARD_COLORS.dim : BOARD_COLORS.bright, resultText, area.x, controlsTop, 11);
  if (state.history.length > 1 && progress >= 1) ui.text(BOARD_COLORS.dim, `Before: ${state.history.slice(1, 9).join(" ")}`, area.x + area.width, controlsTop + 1, 9, "right");
  if (!canBet) return;
  const mine = state.bets[mySeat];
  const rowY = controlsTop + 18;
  const pickerEnd = drawChipPicker(ui, local, area.x, rowY, state.chips[mySeat]);
  drawButtonRow(ui, pickerEnd + 10, rowY, [
    ...(mine.length > 0 ? [{ label: "Clear", color: BOARD_COLORS.warn, onPress: () => send({ kind: "clear" }) }] : []),
    { label: mine.length > 0 ? "Spin" : "Sit out this spin", color: BOARD_COLORS.accent, onPress: () => send({ kind: "ready" }) },
  ]);
}

// The wheel, turned so the pocket `result` comes to rest under the pointer at the top as `progress`
// runs to 1, with the ball running the other way around the rim.
function drawWheel(ui: Ui, centerX: number, centerY: number, radius: number, result: number | null, progress: number): void {
  const pocketAngle = (2 * Math.PI) / WHEEL_ORDER.length;
  const top = -Math.PI / 2;
  const resultIndex = result === null ? 0 : WHEEL_ORDER.indexOf(result);
  // Pocket i is centered at rotation + i * pocketAngle; the result's ends at the top.
  const rotation = top - resultIndex * pocketAngle - (1 - progress) * 3 * 2 * Math.PI;
  ui.circle(BOARD_COLORS.grid, 0.7, centerX, centerY, radius);
  ui.circle(BOARD_COLORS.grid, 0.5, centerX, centerY, radius * 0.72);
  ui.circle(BOARD_COLORS.grid, 0.4, centerX, centerY, radius * 0.25);
  const lines = ui.pen(BOARD_COLORS.grid, 0.35);
  const numberSize = Math.min(9, radius * 0.075);
  WHEEL_ORDER.forEach((number, index) => {
    const edge = rotation + (index - 0.5) * pocketAngle;
    lines.addSegment(centerX + radius * 0.72 * Math.cos(edge), centerY + radius * 0.72 * Math.sin(edge), centerX + radius * Math.cos(edge), centerY + radius * Math.sin(edge));
    const middle = rotation + index * pocketAngle;
    if (numberSize >= 5) {
      const textRadius = radius * 0.86;
      ui.text(pocketColor(number), `${number}`, centerX + textRadius * Math.cos(middle), centerY + textRadius * Math.sin(middle) - numberSize / 2, numberSize, "center", 0.85);
    } else {
      ui.circle(pocketColor(number), 0.6, centerX + radius * 0.86 * Math.cos(middle), centerY + radius * 0.86 * Math.sin(middle), 1.5);
    }
  });
  // Spokes on the hub turn with the wheel.
  for (let spoke = 0; spoke < 4; spoke++) {
    const angle = rotation + (spoke * Math.PI) / 2;
    lines.addSegment(centerX, centerY, centerX + radius * 0.25 * Math.cos(angle), centerY + radius * 0.25 * Math.sin(angle));
  }
  // The pointer, and the ball: it runs against the wheel and drops into the pocket at the top.
  const pointer = ui.pen(BOARD_COLORS.accent, 1);
  pointer.moveTo(centerX - 5, centerY - radius - 8);
  pointer.lineTo(centerX + 5, centerY - radius - 8);
  pointer.lineTo(centerX, centerY - radius - 1);
  pointer.closePath();
  if (result === null) return;
  const ballAngle = top + (1 - progress) * 4 * 2 * Math.PI;
  const ballRadius = radius * (0.66 + 0.3 * (1 - progress));
  ui.circle(BOARD_COLORS.bright, 1.2, centerX + ballRadius * Math.cos(ballAngle), centerY + ballRadius * Math.sin(ballAngle), Math.max(2, radius * 0.035));
  if (progress >= 1) ui.text(pocketColor(result), `${result}`, centerX, centerY - Math.min(14, radius * 0.18) / 2, Math.min(14, radius * 0.18), "center", 1.2);
}

function drawLayout(context: BoardContext, area: Rect, state: RouletteView, canBet: boolean, isSettled: boolean): void {
  const { ui, mySeat, local } = context;
  const cellWidth = area.width / 14;
  const cellHeight = Math.min(area.height / 5, cellWidth * 1.6);
  const tableTop = area.y + (area.height - cellHeight * 5) / 2;
  const textSize = Math.max(6, Math.min(10, cellWidth * 0.36, cellHeight * 0.4));
  const result = isSettled ? state.lastSpin?.number : undefined;
  const chipSize = mySeat === null ? CHIP_SIZES[0] : chipSizeOf(local, state.chips[mySeat]);
  for (const { spot, column, row, columns, rows } of LAYOUT) {
    const rect = { x: area.x + column * cellWidth, y: tableTop + row * cellHeight, width: columns * cellWidth, height: rows * cellHeight };
    const isWinner = result !== undefined && spot.on === "straight" && spot.number === result;
    const isHovered = canBet && ui.isHovered(rect);
    ui.rect(BOARD_COLORS.grid, isHovered ? 0.9 : 0.35, rect);
    const color = spot.on === "straight" ? pocketColor(spot.number!) : spot.on === "red" ? RED : BOARD_COLORS.text;
    ui.text(color, spotName(spot), rect.x + rect.width / 2, rect.y + (rect.height - textSize) / 2, textSize, "center", isWinner ? 1.4 : 0.85);
    if (isWinner) ui.rect(BOARD_COLORS.bright, 1.1, rect, 2);
    // Each seat's chips on the spot: a ring in the seat's color, the viewer's with its amount.
    state.bets.forEach((bets, seat) => {
      const bet = bets.find((each) => each.on === spot.on && each.number === spot.number);
      if (!bet) return;
      const ringX = rect.x + 4 + (seat % 3) * 4;
      const ringY = rect.y + 4 + Math.floor(seat / 3) * 4;
      ui.circle(seatColor(seat), 1, ringX, ringY, 2.5);
      if (seat === mySeat) ui.text(BOARD_COLORS.accent, `${bet.amount}`, rect.x + rect.width - 2, rect.y + rect.height - 8, 7, "right", 1.1);
    });
    const mine = mySeat === null ? undefined : state.bets[mySeat].find((each) => each.on === spot.on && each.number === spot.number);
    const fits = mySeat !== null && (mine?.amount ?? 0) + chipSize <= ROULETTE_MAXIMUM_BET && (mine !== undefined || state.bets[mySeat].length < ROULETTE_MOST_BETS);
    if (canBet && fits) ui.region(rect, () => context.send({ kind: "bet", ...spot, amount: chipSize } satisfies RouletteMove));
  }
}
