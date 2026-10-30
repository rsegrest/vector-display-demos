import {
  KENO_MOST_PICKS,
  KENO_NUMBERS,
  KENO_PAY_TABLE,
  quickPicks,
  type KenoMove,
  type KenoView,
} from "../../../../../../packages/table-games/src/games/keno.js";
import type { Rect } from "../Ui.js";
import { BOARD_COLORS, isMyMove, type BoardContext } from "./BoardContext.js";
import { animationStart, chipSizeOf, drawButtonRow, drawChipPicker, drawSeatStrip } from "./rouletteBoard.js";

// Keno: the 80 numbers in a card of 10 by 8, clicked to mark a ticket (kept on the board until it
// is played, and after, to play again), the numbers drawn ringed one after another, and the pay
// table for the ticket being marked beside it.

const COLUMNS = 10;
const ROWS = KENO_NUMBERS / COLUMNS;
const REVEAL_SECONDS = 2.5;

// The numbers marked on this window's ticket, kept in the board's `local`.
function marksOf(local: Record<string, unknown>): number[] {
  local.kenoMarks ??= [];
  return local.kenoMarks as number[];
}

export function drawKeno(context: BoardContext): void {
  const { ui, area, mySeat, local, seconds } = context;
  const state = context.view as KenoView;
  const send = (move: KenoMove): void => context.send(move);
  const canPlay = isMyMove(context) && mySeat !== null;
  const marks = marksOf(local);

  const stripHeight = drawSeatStrip(context, area, state.chips, (seat) => {
    const ticket = state.tickets[seat];
    if (ticket) return `in: ${ticket.picks.length} numbers for ${ticket.amount}`;
    if (state.isSkipping[seat]) return "skips this draw";
    const last = state.lastDraw?.tickets[seat];
    if (last) return `${context.toMove.includes(seat) ? "marking, " : ""}last: ${state.lastDraw!.matches[seat]} of ${last.picks.length}, back ${state.lastDraw!.returned[seat]}`;
    return context.toMove.includes(seat) ? "marking a ticket" : "out";
  });
  const controlsHeight = 46;
  const top = area.y + stripHeight + 6;
  const height = area.y + area.height - controlsHeight - top;
  const sideWidth = Math.min(170, area.width * 0.3);
  const cell = Math.max(8, Math.min((area.width - sideWidth - 12) / COLUMNS, height / ROWS));
  const card: Rect = { x: area.x, y: top, width: cell * COLUMNS, height: cell * ROWS };

  // The draw is revealed a number at a time; until then only those shown so far count.
  const start = animationStart(local, "keno", state.draws, seconds);
  const drawn = state.lastDraw?.numbers ?? [];
  const shownCount = Math.min(drawn.length, Math.floor(((seconds - start) / REVEAL_SECONDS) * drawn.length) + 1);
  const shown = new Set(drawn.slice(0, Math.max(0, shownCount)));
  const isRevealed = shownCount >= drawn.length;
  const textSize = Math.max(6, Math.min(10, cell * 0.38));

  for (let number = 1; number <= KENO_NUMBERS; number++) {
    const column = (number - 1) % COLUMNS;
    const row = Math.floor((number - 1) / COLUMNS);
    const rect = { x: card.x + column * cell, y: card.y + row * cell, width: cell, height: cell };
    const isMarked = marks.includes(number);
    const isDrawn = shown.has(number);
    const canMark = canPlay && (isMarked || marks.length < KENO_MOST_PICKS);
    ui.rect(BOARD_COLORS.grid, canMark && ui.isHovered(rect) ? 0.9 : 0.25, rect, 1);
    ui.text(isMarked ? BOARD_COLORS.accent : BOARD_COLORS.text, `${number}`, rect.x + cell / 2, rect.y + (cell - textSize) / 2, textSize, "center", isMarked ? 1.2 : 0.75);
    if (isMarked) ui.rect(BOARD_COLORS.accent, isDrawn ? 1.3 : 0.8, rect, 3);
    if (isDrawn) ui.circle(isMarked ? BOARD_COLORS.bright : BOARD_COLORS.warn, isMarked ? 1.3 : 0.8, rect.x + cell / 2, rect.y + cell / 2, cell * 0.42);
    if (canMark) {
      ui.region(rect, () => {
        const index = marks.indexOf(number);
        if (index >= 0) marks.splice(index, 1);
        else marks.push(number);
      });
    }
  }

  // Beside the card: the pay table for the ticket being marked, and the last draw.
  const sideX = card.x + card.width + 12;
  const payCount = marks.length > 0 ? marks.length : 5;
  ui.text(BOARD_COLORS.dim, `${payCount} marked pays (times the bet)`, sideX, top, 9);
  const pays = Object.entries(KENO_PAY_TABLE[payCount]).reverse();
  pays.forEach(([matches, multiple], index) => ui.text(BOARD_COLORS.text, `${matches} drawn: ${multiple}`, sideX + 4, top + 14 + index * 12, 9));
  let y = top + 20 + pays.length * 12;
  if (state.lastDraw && mySeat !== null && state.lastDraw.tickets[mySeat]) {
    const text = isRevealed ? `Last ticket: ${state.lastDraw.matches[mySeat]} of ${state.lastDraw.tickets[mySeat]!.picks.length} drawn, back ${state.lastDraw.returned[mySeat]}` : "Drawing...";
    ui.text(BOARD_COLORS.bright, ui.fitted(text, 9, area.x + area.width - sideX), sideX, y, 9);
    y += 14;
  }
  if (state.lastDraw) ui.text(BOARD_COLORS.dim, `Draw ${state.draws}: rings are the numbers drawn`, sideX, y, 8);

  const controlsTop = area.y + area.height - controlsHeight + 4;
  ui.text(BOARD_COLORS.dim, canPlay ? `Mark 1 to ${KENO_MOST_PICKS} numbers, pick a bet, then play the ticket` : "Waiting for the others' tickets", area.x, controlsTop, 10);
  if (!canPlay) return;
  const rowY = controlsTop + 18;
  const pickerEnd = drawChipPicker(ui, local, area.x, rowY, state.chips[mySeat]);
  const amount = chipSizeOf(local, state.chips[mySeat]);
  const seat = mySeat;
  drawButtonRow(ui, pickerEnd + 10, rowY, [
    ...(marks.length > 0
      ? [
          { label: `Play ${marks.length} for ${amount}`, color: BOARD_COLORS.accent, onPress: () => send({ kind: "bet", picks: [...marks], amount }) },
          { label: "Clear", color: BOARD_COLORS.warn, onPress: () => marks.splice(0) },
        ]
      : [{ label: "Quick pick 5", color: BOARD_COLORS.text, onPress: () => marks.push(...quickPicks(5, state.draws + Math.floor(seconds * 10), seat)) }]),
    { label: "Skip this draw", color: BOARD_COLORS.dim, onPress: () => send({ kind: "skip" }) },
  ]);
}
