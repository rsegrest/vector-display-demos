import type { BeamColor } from "@vector-display/core";
import {
  CATEGORIES,
  CATEGORY_NAMES,
  DICE_COUNT,
  openCategories,
  pointsFor,
  ROLLS_PER_TURN,
  scorecardTotal,
  UPPER_BONUS_THRESHOLD,
  upperBonus,
  upperSubtotal,
  YAHTZEE_BONUS,
  type Category,
  type YahtzeeMove,
  type YahtzeeView,
} from "../../../../../../packages/table-games/src/games/yahtzee.js";
import type { Rect, Ui } from "../Ui.js";
import { BOARD_COLORS, isMyMove, type BoardContext } from "./BoardContext.js";

const TEXT_SIZE = 9;

// Which dice the player means to keep on the next roll: the board's own, until Roll is pressed.
// `rollKey` says which roll the choice belongs to, so a new roll or turn starts it afresh.
interface YahtzeeChoices {
  keep: boolean[];
  rollKey: string;
}

function choicesOf(local: Record<string, unknown>, view: YahtzeeView): YahtzeeChoices {
  const filled = view.scorecards.reduce((total, scorecard) => total + CATEGORIES.filter((category) => scorecard.boxes[category] !== null).length, 0);
  const rollKey = `${view.turn}:${view.rollsLeft}:${filled}`;
  const choices = (local.yahtzee ??= { keep: [...view.kept], rollKey } satisfies YahtzeeChoices) as YahtzeeChoices;
  if (choices.rollKey !== rollKey) {
    // After a roll, the dice kept for it stay kept, ready for the next.
    choices.keep = view.rollsLeft === ROLLS_PER_TURN ? Array<boolean>(DICE_COUNT).fill(false) : [...view.kept];
    choices.rollKey = rollKey;
  }
  return choices;
}

// Where each face's pips sit, as fractions of the die across and down.
const PIPS: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  1: [[0.5, 0.5]],
  2: [[0.28, 0.28], [0.72, 0.72]],
  3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
  6: [[0.28, 0.25], [0.72, 0.25], [0.28, 0.5], [0.72, 0.5], [0.28, 0.75], [0.72, 0.75]],
};

function drawDie(ui: Ui, rect: Rect, face: number | null, color: BeamColor, intensity: number, isKept: boolean): void {
  ui.rect(color, intensity, rect);
  // A kept die gets a second frame inside the first.
  if (isKept) ui.rect(color, intensity, rect, 3);
  if (face === null) return;
  for (const [across, down] of PIPS[face]) ui.circle(color, intensity, rect.x + across * rect.width, rect.y + down * rect.height, Math.max(1.5, rect.width * 0.07));
}

// Yahtzee: the dice and the Roll button along the top, and every player's scorecard below.
export function drawYahtzee(context: BoardContext): void {
  const { ui, area, mySeat } = context;
  const view = context.view as YahtzeeView;
  const send = (move: YahtzeeMove): void => context.send(move);
  const choices = choicesOf(context.local, view);
  const myTurn = isMyMove(context) && mySeat === view.turn;
  const hasRolled = view.rollsLeft < ROLLS_PER_TURN;

  // ── The dice ──
  const stripHeight = Math.min(64, Math.max(34, area.height * 0.2));
  const dieSize = Math.floor(Math.min(stripHeight - 16, (area.width * 0.5) / (DICE_COUNT + 1)));
  const gap = Math.floor(dieSize * 0.25);
  for (let index = 0; index < DICE_COUNT; index++) {
    const rect = { x: area.x + index * (dieSize + gap), y: area.y, width: dieSize, height: dieSize };
    const isKept = hasRolled && choices.keep[index];
    const canToggle = myTurn && hasRolled && view.rollsLeft > 0;
    const isHovered = canToggle && ui.isHovered(rect);
    const color = isKept ? BOARD_COLORS.accent : BOARD_COLORS.bright;
    drawDie(ui, rect, hasRolled ? view.dice[index] : null, color, isHovered ? 1.2 : hasRolled ? 0.85 : 0.35, isKept);
    if (isKept) ui.text(BOARD_COLORS.accent, "kept", rect.x + dieSize / 2, rect.y + dieSize + 4, TEXT_SIZE - 1, "center");
    if (canToggle) ui.region(rect, () => (choices.keep[index] = !choices.keep[index]));
  }

  // ── The Roll button and what is happening ──
  const controlsX = area.x + DICE_COUNT * (dieSize + gap) + gap;
  const rollRect = { x: controlsX, y: area.y, width: 92, height: Math.min(24, dieSize) };
  const keepsAll = hasRolled && choices.keep.every(Boolean);
  if (myTurn && view.rollsLeft > 0 && !keepsAll) {
    const label = view.rollsLeft === ROLLS_PER_TURN ? "Roll (3 left)" : `Roll (${view.rollsLeft} left)`;
    ui.button(BOARD_COLORS.accent, rollRect, label, () => send({ kind: "roll", keep: hasRolled ? [...choices.keep] : Array<boolean>(DICE_COUNT).fill(false) }), 10);
  } else {
    ui.rect(BOARD_COLORS.dim, 0.3, rollRect);
    ui.text(BOARD_COLORS.dim, `Rolls left: ${view.rollsLeft}`, rollRect.x + rollRect.width / 2, rollRect.y + (rollRect.height - 10) / 2, 10, "center");
  }
  const statusX = controlsX + rollRect.width + 10;
  const statusWidth = area.x + area.width - statusX;
  // The status lines, when there is room for them beside the dice.
  if (statusWidth >= 40) ui.text(BOARD_COLORS.text, ui.fitted(statusLine(context, view, myTurn, keepsAll), TEXT_SIZE, statusWidth), statusX, area.y + 3, TEXT_SIZE);
  if (view.lastScore && statusWidth >= 40) {
    const { seat, category, points } = view.lastScore;
    const line = `${context.names[seat] ?? `Player ${seat + 1}`} scored ${points} in ${CATEGORY_NAMES[category]}`;
    ui.text(BOARD_COLORS.dim, ui.fitted(line, TEXT_SIZE, statusWidth), statusX, area.y + 17, TEXT_SIZE);
  }

  drawScorecards(context, view, { x: area.x, y: area.y + stripHeight, width: area.width, height: area.height - stripHeight }, myTurn && hasRolled, send);
}

function statusLine(context: BoardContext, view: YahtzeeView, myTurn: boolean, keepsAll: boolean): string {
  if (view.outcome) return view.outcome.summary ?? "Game over";
  if (!myTurn) return `${context.names[view.turn] ?? `Player ${view.turn + 1}`} is rolling`;
  if (view.rollsLeft === ROLLS_PER_TURN) return "Your turn: roll the dice";
  if (view.rollsLeft === 0) return "Choose a box to score";
  return keepsAll ? "All kept: choose a box to score" : "Click dice to keep, roll, or choose a box";
}

// The scorecards: a row for each box, a column for each player. On the player's turn, after a
// roll, each box they may use shows what it would score, and scores it when clicked.
function drawScorecards(context: BoardContext, view: YahtzeeView, area: Rect, canScore: boolean, send: (move: YahtzeeMove) => void): void {
  const { ui, mySeat } = context;
  const rows: { label: string; category?: Category; value: (seat: number) => string }[] = [
    ...CATEGORIES.slice(0, 6).map((category) => ({ label: capitalized(CATEGORY_NAMES[category]), category, value: (seat: number) => boxText(view, seat, category) })),
    {
      label: `Upper bonus (${UPPER_BONUS_THRESHOLD})`,
      value: (seat: number) => (upperBonus(view.scorecards[seat]) > 0 ? String(upperBonus(view.scorecards[seat])) : `${upperSubtotal(view.scorecards[seat])}/${UPPER_BONUS_THRESHOLD}`),
    },
    ...CATEGORIES.slice(6).map((category) => ({ label: capitalized(CATEGORY_NAMES[category]), category, value: (seat: number) => boxText(view, seat, category) })),
    { label: "Yahtzee bonus", value: (seat: number) => (view.scorecards[seat].yahtzeeBonuses > 0 ? String(view.scorecards[seat].yahtzeeBonuses * YAHTZEE_BONUS) : "") },
    { label: "Total", value: (seat: number) => String(scorecardTotal(view.scorecards[seat])) },
  ];
  const rowHeight = Math.min(18, area.height / (rows.length + 1));
  const textSize = Math.min(TEXT_SIZE, Math.floor(rowHeight * 0.7));
  const labelWidth = Math.min(120, area.width * 0.35);
  const players = view.scorecards.length;
  const columnWidth = Math.min(90, (area.width - labelWidth) / players);
  const tableWidth = labelWidth + columnWidth * players;
  const textTop = (row: number): number => area.y + row * rowHeight + (rowHeight - textSize) / 2;
  const columnCenter = (seat: number): number => area.x + labelWidth + columnWidth * (seat + 0.5);
  const open = canScore && mySeat !== null ? openCategories(view.dice, view.scorecards[mySeat]) : [];

  // The header: each player's name in their seat's color, the one in turn lit.
  for (let seat = 0; seat < players; seat++) {
    const seatColor = BOARD_COLORS.seats[seat % BOARD_COLORS.seats.length];
    const name = ui.fitted(context.names[seat] ?? `Player ${seat + 1}`, textSize, columnWidth - 4);
    const isInTurn = !view.outcome && seat === view.turn;
    ui.text(seatColor, name, columnCenter(seat), textTop(0), textSize, "center", isInTurn ? 1.3 : 0.8);
    if (isInTurn) ui.pen(seatColor, 0.8).addSegment(columnCenter(seat) - columnWidth * 0.35, area.y + rowHeight - 1, columnCenter(seat) + columnWidth * 0.35, area.y + rowHeight - 1);
  }
  const grid = ui.pen(BOARD_COLORS.grid, 0.25);
  rows.forEach((row, index) => {
    const top = area.y + (index + 1) * rowHeight;
    grid.addSegment(area.x, top, area.x + tableWidth, top);
    const isSummary = row.category === undefined;
    ui.text(isSummary ? BOARD_COLORS.dim : BOARD_COLORS.text, ui.fitted(row.label, textSize, labelWidth - 4), area.x + 2, textTop(index + 1), textSize);
    for (let seat = 0; seat < players; seat++) {
      const cell = { x: area.x + labelWidth + columnWidth * seat, y: top, width: columnWidth, height: rowHeight };
      const category = row.category;
      if (category && seat === mySeat && open.includes(category)) {
        const points = pointsFor(view.dice, category, view.scorecards[seat]);
        const isHovered = ui.isHovered(cell);
        if (isHovered) ui.rect(BOARD_COLORS.accent, 0.9, cell, 1);
        ui.text(BOARD_COLORS.accent, String(points), columnCenter(seat), textTop(index + 1), textSize, "center", isHovered ? 1.3 : 0.7);
        ui.region(cell, () => send({ kind: "score", category }));
      } else {
        ui.text(row.label === "Total" ? BOARD_COLORS.bright : BOARD_COLORS.text, row.value(seat), columnCenter(seat), textTop(index + 1), textSize, "center");
      }
    }
  });
  const bottom = area.y + (rows.length + 1) * rowHeight;
  grid.addSegment(area.x, bottom, area.x + tableWidth, bottom);
  for (let seat = 0; seat <= players; seat++) {
    const x = area.x + labelWidth + columnWidth * seat;
    grid.addSegment(x, area.y + rowHeight, x, bottom);
  }
}

function boxText(view: YahtzeeView, seat: number, category: Category): string {
  const points = view.scorecards[seat].boxes[category];
  return points === null ? "" : String(points);
}

function capitalized(text: string): string {
  return text[0].toUpperCase() + text.slice(1);
}
