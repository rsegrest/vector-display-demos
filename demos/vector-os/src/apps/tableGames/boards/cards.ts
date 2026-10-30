import type { BeamColor } from "@vector-display/core";
import type { Card, Suit } from "../../../../../../packages/table-games/src/casino.js";
import type { Rect, Ui } from "../Ui.js";
import { BOARD_COLORS } from "./BoardContext.js";

// What the card games' boards share: playing cards drawn in lines (a rounded outline, the rank in
// text and the suit as a small vector symbol, or a patterned back for a card face down), seat
// panels, and a row of buttons that wraps when it runs out of room.

// A card is this many times as tall as it is wide.
export const CARD_ASPECT = 1.4;

export const RED_SUIT: BeamColor = { red: 1, green: 0.42, blue: 0.4 };
export const BLACK_SUIT: BeamColor = { red: 0.85, green: 0.92, blue: 1 };
const CARD_EDGE: BeamColor = { red: 0.55, green: 0.75, blue: 1 };
const CARD_BACK: BeamColor = { red: 0.35, green: 0.55, blue: 1 };

export function suitColor(suit: Suit): BeamColor {
  return suit === "hearts" || suit === "diamonds" ? RED_SUIT : BLACK_SUIT;
}

// A rectangle with its corners rounded off by quarter circles of `radius`.
export function roundedRect(ui: Ui, color: BeamColor, intensity: number, rect: Rect, radius: number): void {
  const pen = ui.pen(color, intensity);
  const r = Math.min(radius, rect.width / 2, rect.height / 2);
  const corners = [
    { x: rect.x + rect.width - r, y: rect.y + r, from: -Math.PI / 2 },
    { x: rect.x + rect.width - r, y: rect.y + rect.height - r, from: 0 },
    { x: rect.x + r, y: rect.y + rect.height - r, from: Math.PI / 2 },
    { x: rect.x + r, y: rect.y + r, from: Math.PI },
  ];
  const steps = 4;
  pen.moveTo(rect.x + r, rect.y);
  for (const corner of corners) {
    for (let step = 0; step <= steps; step++) {
      const angle = corner.from + (step / steps) * (Math.PI / 2);
      pen.lineTo(corner.x + r * Math.cos(angle), corner.y + r * Math.sin(angle));
    }
  }
  pen.closePath();
}

// A closed outline through `points`, given in a box from -1 to 1 around the center (y down).
function outline(ui: Ui, color: BeamColor, intensity: number, centerX: number, centerY: number, half: number, points: readonly [number, number][]): void {
  const pen = ui.pen(color, intensity);
  pen.moveTo(centerX + points[0][0] * half, centerY + points[0][1] * half);
  for (const [x, y] of points.slice(1)) pen.lineTo(centerX + x * half, centerY + y * half);
  pen.closePath();
}

// The classic heart curve, point down, filling about -1..1 across and -0.75..1 down.
function heartPoints(isUpsideDown: boolean): [number, number][] {
  const points: [number, number][] = [];
  const steps = 24;
  for (let step = 0; step < steps; step++) {
    const t = (step / steps) * 2 * Math.PI;
    const x = (16 * Math.sin(t) ** 3) / 17;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17;
    points.push([x, isUpsideDown ? -y : y]);
  }
  return points;
}

// A suit symbol `size` across, centered on (centerX, centerY).
export function drawSuit(ui: Ui, suit: Suit, centerX: number, centerY: number, size: number, intensity = 0.95): void {
  const color = suitColor(suit);
  const half = size / 2;
  switch (suit) {
    case "hearts":
      outline(ui, color, intensity, centerX, centerY + half * 0.1, half, heartPoints(false));
      break;
    case "diamonds":
      outline(ui, color, intensity, centerX, centerY, half, [
        [0, -1],
        [0.7, 0],
        [0, 1],
        [-0.7, 0],
      ]);
      break;
    case "spades":
      // A heart upside down, on a short flared stem.
      outline(ui, color, intensity, centerX, centerY - half * 0.2, half * 0.8, heartPoints(true));
      outline(ui, color, intensity, centerX, centerY, half, [
        [0, 0.25],
        [0.3, 1],
        [-0.3, 1],
      ]);
      break;
    case "clubs":
      ui.circle(color, intensity, centerX, centerY - half * 0.45, half * 0.36);
      ui.circle(color, intensity, centerX - half * 0.45, centerY + half * 0.12, half * 0.36);
      ui.circle(color, intensity, centerX + half * 0.45, centerY + half * 0.12, half * 0.36);
      outline(ui, color, intensity, centerX, centerY, half, [
        [0, 0.1],
        [0.3, 1],
        [-0.3, 1],
      ]);
      break;
  }
}

// One card `width` wide with its top left corner at (x, y): face up with the rank in the corner
// and the suit in the middle, or face down (null) with a patterned back.
export function drawCard(ui: Ui, x: number, y: number, width: number, card: Card | null, intensity = 0.9): void {
  const height = width * CARD_ASPECT;
  const rect = { x, y, width, height };
  const radius = width * 0.14;
  if (!card) {
    roundedRect(ui, CARD_BACK, intensity * 0.8, rect, radius);
    const inner = { x: x + width * 0.16, y: y + width * 0.16, width: width * 0.68, height: height - width * 0.32 };
    ui.rect(CARD_BACK, intensity * 0.55, inner);
    // A diamond lattice: the inner panel's diagonals and a diamond through their midpoints.
    const pen = ui.pen(CARD_BACK, intensity * 0.45);
    pen.addSegment(inner.x, inner.y, inner.x + inner.width, inner.y + inner.height);
    pen.addSegment(inner.x + inner.width, inner.y, inner.x, inner.y + inner.height);
    const middleX = inner.x + inner.width / 2;
    const middleY = inner.y + inner.height / 2;
    pen.moveTo(middleX, inner.y);
    pen.lineTo(inner.x + inner.width, middleY);
    pen.lineTo(middleX, inner.y + inner.height);
    pen.lineTo(inner.x, middleY);
    pen.closePath();
    return;
  }
  roundedRect(ui, CARD_EDGE, intensity * 0.7, rect, radius);
  const color = suitColor(card.suit);
  const rankSize = Math.max(6, width * 0.3);
  ui.text(color, card.rank, x + width * 0.12, y + width * 0.12, rankSize, "left", intensity + 0.05);
  drawSuit(ui, card.suit, x + width / 2, y + height * 0.62, width * 0.46, intensity);
}

// The width a row of `count` cards takes, overlapping when there are more than fit with a gap.
export function cardRowWidth(count: number, cardWidth: number): number {
  return count === 0 ? 0 : cardWidth + (count - 1) * cardWidth * 1.12;
}

// Cards left to right from (x, y), squeezed together if needed to fit `maxWidth`.
export function drawCardRow(ui: Ui, x: number, y: number, cardWidth: number, cards: readonly (Card | null)[], maxWidth = Infinity, intensity = 0.9): void {
  if (cards.length === 0) return;
  const natural = cardWidth * 1.12;
  const step = cards.length > 1 ? Math.min(natural, (maxWidth - cardWidth) / (cards.length - 1)) : 0;
  cards.forEach((card, index) => drawCard(ui, x + index * Math.max(step, cardWidth * 0.3), y, cardWidth, card, intensity));
}

// ── Seats and buttons ──────────────────────────────────────────────────────

export function seatColor(seat: number): BeamColor {
  return BOARD_COLORS.seats[seat % BOARD_COLORS.seats.length];
}

// A seat's outline, lit while it is that seat's move, and its name and chips across the top.
// Returns where the panel's contents go, below that line.
export function drawSeatPanel(ui: Ui, rect: Rect, seat: number, name: string, chips: number, isToMove: boolean, isMine: boolean, textSize: number): Rect {
  const color = seatColor(seat);
  roundedRect(ui, isToMove ? BOARD_COLORS.accent : color, isToMove ? 1.05 : 0.35, rect, 6);
  if (isMine) roundedRect(ui, color, 0.3, { x: rect.x + 3, y: rect.y + 3, width: rect.width - 6, height: rect.height - 6 }, 4);
  const chipsText = `${chips}`;
  const chipsWidth = ui.textWidth(chipsText, textSize);
  const nameWidth = rect.width - chipsWidth - 22;
  ui.text(color, ui.fitted(isMine ? `${name} (you)` : name, textSize, nameWidth), rect.x + 7, rect.y + 6, textSize);
  ui.text(BOARD_COLORS.accent, chipsText, rect.x + rect.width - 7, rect.y + 6, textSize, "right");
  return { x: rect.x + 7, y: rect.y + 6 + textSize + 6, width: rect.width - 14, height: rect.height - textSize - 18 };
}

// The panels for `count` seats in rows of at most `perRow`, filling `area`.
export function seatRects(area: Rect, count: number, perRow: number, gap = 8): Rect[] {
  const rows = Math.ceil(count / perRow);
  const height = (area.height - gap * (rows - 1)) / rows;
  return Array.from({ length: count }, (_, seat) => {
    const row = Math.floor(seat / perRow);
    const inRow = Math.min(perRow, count - row * perRow);
    const width = (area.width - gap * (perRow - 1)) / perRow;
    // A short last row is centered.
    const left = area.x + ((perRow - inRow) * (width + gap)) / 2;
    return { x: left + (seat % perRow) * (width + gap), y: area.y + row * (height + gap), width, height };
  });
}

export interface BoardButton {
  readonly label: string;
  readonly onPress: () => void;
  readonly color?: BeamColor;
  // Drawn lit, as the option chosen.
  readonly isChosen?: boolean;
}

// Buttons left to right from the top left of `area`, wrapping onto new rows; returns the height used.
export function drawButtonRow(ui: Ui, area: Rect, buttons: readonly BoardButton[], textSize = 10, buttonHeight = 22, gap = 6): number {
  let x = area.x;
  let y = area.y;
  for (const button of buttons) {
    const width = Math.min(area.width, ui.textWidth(button.label, textSize) + 16);
    if (x > area.x && x + width > area.x + area.width) {
      x = area.x;
      y += buttonHeight + gap;
    }
    const rect = { x, y, width, height: buttonHeight };
    const color = button.color ?? BOARD_COLORS.text;
    ui.button(color, rect, ui.fitted(button.label, textSize, width - 6), button.onPress, textSize);
    if (button.isChosen) ui.rect(color, 0.9, rect, 3);
    x += width + gap;
  }
  return buttons.length === 0 ? 0 : y + buttonHeight - area.y;
}

// The height `drawButtonRow` would take for these labels, to lay out the space above it first.
export function buttonRowHeight(ui: Ui, width: number, labels: readonly string[], textSize = 10, buttonHeight = 22, gap = 6): number {
  if (labels.length === 0) return 0;
  let x = 0;
  let rows = 1;
  for (const label of labels) {
    const buttonWidth = Math.min(width, ui.textWidth(label, textSize) + 16);
    if (x > 0 && x + buttonWidth > width) {
      x = 0;
      rows++;
    }
    x += buttonWidth + gap;
  }
  return rows * buttonHeight + (rows - 1) * gap;
}

// A line of who still has to move, for the status line: "Waiting for Ann and Bob".
export function waitingFor(names: readonly string[], seats: readonly number[]): string {
  const listed = seats.map((seat) => names[seat] ?? `Player ${seat + 1}`);
  if (listed.length <= 1) return listed.length ? `Waiting for ${listed[0]}` : "";
  return `Waiting for ${listed.slice(0, -1).join(", ")} and ${listed.at(-1)}`;
}
