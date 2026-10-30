import type { BeamColor } from "@vector-display/core";
import { CRAPS_MAXIMUM_BET, CRAPS_MOST_ODDS, type CrapsBetKind, type CrapsMove, type CrapsView } from "../../../../../../packages/table-games/src/games/craps.js";
import type { Rect, Ui } from "../Ui.js";
import { BOARD_COLORS, isMyMove, type BoardContext } from "./BoardContext.js";
import { animationStart, chipSizeOf, drawButtonRow, drawChipPicker, drawSeatStrip, seatColor } from "./rouletteBoard.js";

// Craps: the point numbers along the top with the puck, the field, don't pass and the pass line
// (with its odds) below, and the dice to the right. A click on a bet lays the picked chip size.

const TUMBLE_SECONDS = 1.1;
const POINT_NUMBERS: readonly number[] = [4, 5, 6, 8, 9, 10];

// Where the pips of each face sit, on a 3 by 3 grid from the top left.
const PIPS: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ],
  5: [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ],
  6: [
    [0, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [2, 2],
  ],
};

function drawDie(ui: Ui, x: number, y: number, size: number, face: number, color: BeamColor, intensity: number): void {
  ui.rect(color, intensity, { x, y, width: size, height: size });
  for (const [column, row] of PIPS[face]) ui.circle(color, intensity, x + size * (0.22 + 0.28 * column), y + size * (0.22 + 0.28 * row), Math.max(1.2, size * 0.07));
}

function crapsBetsText(view: CrapsView, seat: number): string {
  const bets = view.bets[seat];
  const parts = [bets.pass && `pass ${bets.pass}`, bets.odds && `odds ${bets.odds}`, bets.dontPass && `don't ${bets.dontPass}`, bets.field && `field ${bets.field}`].filter(Boolean);
  const status = view.isReady[seat] ? "ready" : "";
  return [status, ...parts].filter(Boolean).join(", ") || "no bets";
}

export function drawCraps(context: BoardContext): void {
  const { ui, area, mySeat, local, seconds } = context;
  const state = context.view as CrapsView;
  const send = (move: CrapsMove): void => context.send(move);
  const canBet = isMyMove(context) && mySeat !== null;

  const stripHeight = drawSeatStrip(context, area, state.chips, (seat) => crapsBetsText(state, seat));
  const controlsHeight = 46;
  const top = area.y + stripHeight + 6;
  const height = area.y + area.height - controlsHeight - top;
  const diceWidth = Math.min(160, area.width * 0.28);
  const table: Rect = { x: area.x, y: top, width: area.width - diceWidth - 12, height };
  const start = animationStart(local, "craps", state.rolls, seconds);
  const isTumbling = state.lastRoll !== null && seconds - start < TUMBLE_SECONDS;

  drawTable(context, table, state, canBet);

  // The dice, tumbling for a moment after a roll, and what the table calls it.
  const diceArea = { x: area.x + area.width - diceWidth, y: top, width: diceWidth, height };
  const dieSize = Math.min(44, diceWidth * 0.36, height * 0.4);
  const diceY = diceArea.y + 8;
  state.lastRoll?.dice.forEach((face, index) => {
    const shown = isTumbling ? 1 + (Math.floor(seconds * 14 + index * 3) % 6) : face;
    const x = diceArea.x + diceWidth / 2 - dieSize - 4 + index * (dieSize + 8) + (isTumbling ? Math.sin(seconds * 23 + index) * 3 : 0);
    drawDie(ui, x, diceY, dieSize, shown, BOARD_COLORS.bright, 1);
  });
  if (!state.lastRoll) ui.text(BOARD_COLORS.dim, "No roll yet", diceArea.x + diceWidth / 2, diceY + dieSize / 2 - 5, 10, "center");
  const callY = diceY + dieSize + 12;
  if (state.lastRoll && !isTumbling) {
    ui.text(BOARD_COLORS.accent, state.lastRoll.call, diceArea.x + diceWidth / 2, callY, 11, "center", 1.1);
    if (mySeat !== null && state.lastRoll.returned[mySeat] > 0) ui.text(BOARD_COLORS.bright, `You got back ${state.lastRoll.returned[mySeat]}`, diceArea.x + diceWidth / 2, callY + 16, 9, "center");
  }
  ui.text(BOARD_COLORS.dim, `Shooter: ${context.names[state.shooter] ?? ""}`, diceArea.x + diceWidth / 2, callY + 32, 9, "center");
  if (state.history.length > 0 && !isTumbling) ui.text(BOARD_COLORS.dim, ui.fitted(`Rolls: ${state.history.slice(0, 8).join(" ")}`, 8, diceWidth), diceArea.x + diceWidth / 2, callY + 46, 8, "center");

  const controlsTop = area.y + area.height - controlsHeight + 4;
  ui.text(BOARD_COLORS.dim, state.point === null ? "Come-out roll: lay the pass line or don't pass" : `The point is ${state.point}: odds may go behind the pass line`, area.x, controlsTop, 10);
  if (!canBet) return;
  const bets = state.bets[mySeat];
  const canClear = bets.field > 0 || bets.odds > 0 || (state.point === null && bets.pass + bets.dontPass > 0);
  const hasBets = bets.pass + bets.dontPass + bets.field + bets.odds > 0;
  const rowY = controlsTop + 18;
  const pickerEnd = drawChipPicker(ui, local, area.x, rowY, state.chips[mySeat]);
  drawButtonRow(ui, pickerEnd + 10, rowY, [
    ...(canClear ? [{ label: "Take down", color: BOARD_COLORS.warn, onPress: () => send({ kind: "clear" }) }] : []),
    { label: hasBets ? "Roll" : "Sit out this roll", color: BOARD_COLORS.accent, onPress: () => send({ kind: "ready" }) },
  ]);
}

// The felt: point boxes, the field, don't pass, and the pass line with its odds.
function drawTable(context: BoardContext, area: Rect, state: CrapsView, canBet: boolean): void {
  const { ui, mySeat, local } = context;
  const rowHeight = area.height / 4;
  const textSize = Math.max(7, Math.min(11, rowHeight * 0.3));
  ui.rect(BOARD_COLORS.grid, 0.6, area);

  // The point boxes, with the puck: ON over the point, OFF beside them on a come-out roll.
  const boxWidth = area.width / (POINT_NUMBERS.length + 1);
  const offRect = { x: area.x, y: area.y, width: boxWidth, height: rowHeight };
  ui.text(state.point === null ? BOARD_COLORS.bright : BOARD_COLORS.dim, "OFF", offRect.x + boxWidth / 2, offRect.y + (rowHeight - textSize) / 2, textSize, "center");
  if (state.point === null) ui.circle(BOARD_COLORS.bright, 0.9, offRect.x + boxWidth / 2, offRect.y + rowHeight / 2, Math.min(boxWidth, rowHeight) * 0.4);
  POINT_NUMBERS.forEach((number, index) => {
    const rect = { x: area.x + (index + 1) * boxWidth, y: area.y, width: boxWidth, height: rowHeight };
    const isPoint = state.point === number;
    ui.rect(BOARD_COLORS.grid, 0.35, rect);
    ui.text(isPoint ? BOARD_COLORS.accent : BOARD_COLORS.text, `${number}`, rect.x + boxWidth / 2, rect.y + (rowHeight - textSize) / 2, textSize, "center", isPoint ? 1.3 : 0.8);
    if (isPoint) ui.circle(BOARD_COLORS.accent, 1.1, rect.x + boxWidth / 2, rect.y + rowHeight / 2, Math.min(boxWidth, rowHeight) * 0.4);
  });

  const isComeOut = state.point === null;
  const myBets = mySeat === null ? null : state.bets[mySeat];
  const chipSize = mySeat === null ? 0 : chipSizeOf(local, state.chips[mySeat]);
  // Odds may go behind a pass bet, up to twice it.
  const canTakeOdds = myBets !== null && myBets.pass > 0 && myBets.odds + chipSize <= CRAPS_MOST_ODDS * myBets.pass;
  const oddsWidth = area.width * 0.25;
  const zones: { on: CrapsBetKind; label: string; rect: Rect; isOpen: boolean }[] = [
    { on: "field", label: "FIELD  2  3  4  9  10  11  12   (2 pays 2 to 1, 12 pays 3 to 1)", rect: { x: area.x, y: area.y + rowHeight, width: area.width, height: rowHeight }, isOpen: true },
    { on: "dontPass", label: "DON'T PASS BAR (12 pushes)", rect: { x: area.x, y: area.y + 2 * rowHeight, width: area.width, height: rowHeight }, isOpen: isComeOut },
    { on: "pass", label: "PASS LINE", rect: { x: area.x, y: area.y + 3 * rowHeight, width: area.width - oddsWidth, height: rowHeight }, isOpen: isComeOut },
    { on: "odds", label: "ODDS", rect: { x: area.x + area.width - oddsWidth, y: area.y + 3 * rowHeight, width: oddsWidth, height: rowHeight }, isOpen: !isComeOut && canTakeOdds },
  ];
  for (const { on, label, rect, isOpen } of zones) {
    const isClickable = canBet && isOpen && myBets !== null && myBets[on] + chipSize <= CRAPS_MAXIMUM_BET;
    const isHovered = isClickable && ui.isHovered(rect);
    ui.rect(BOARD_COLORS.grid, isHovered ? 1 : 0.4, rect);
    ui.text(isOpen ? BOARD_COLORS.text : BOARD_COLORS.dim, ui.fitted(label, textSize, rect.width - 8), rect.x + rect.width / 2, rect.y + (rect.height - textSize) / 2, textSize, "center", isOpen ? 0.95 : 0.6);
    // Each seat's chips on the bet: a ring in its color, the viewer's with its amount.
    state.bets.forEach((bets, seat) => {
      if (bets[on] === 0) return;
      ui.circle(seatColor(seat), 1, rect.x + 6 + seat * 7, rect.y + rect.height - 6, 2.5);
      if (seat === mySeat) ui.text(BOARD_COLORS.accent, `${bets[on]}`, rect.x + rect.width - 4, rect.y + rect.height - 10, 8, "right", 1.1);
    });
    if (isClickable) ui.region(rect, () => context.send({ kind: "bet", on, amount: chipSize } satisfies CrapsMove));
  }
}
