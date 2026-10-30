import type { Card } from "../../../../../../packages/table-games/src/casino.js";
import {
  amountToCall,
  BIG_BLIND,
  canBeRaised,
  isAllIn,
  isStillIn,
  potTotal,
  raiseSizes,
  type PokerMove,
  type PokerView,
} from "../../../../../../packages/table-games/src/games/poker.js";
import type { Rect } from "../Ui.js";
import { BOARD_COLORS, isMyMove, type BoardContext } from "./BoardContext.js";
import { buttonRowHeight, CARD_ASPECT, cardRowWidth, drawButtonRow, drawCard, drawCardRow, drawSeatPanel, roundedRect, seatRects, waitingFor, type BoardButton } from "./cards.js";

// Texas hold'em: the seats in two rows around the board (the top row left to right, the bottom
// row right to left, so the order runs around the table), the five shared cards and the pot
// between them, and the viewer's actions along the bottom when it is their move. The last
// settled hand stays on show: its winner on the line under the board, and in each seat the hand
// it showed down.

const TEXT_SIZE = 10;
const SMALL_SIZE = 9;

interface PokerChoices {
  // The amount on the "raise to" button, changed with its - and + buttons.
  raiseTo: number;
}

function choicesOf(local: Record<string, unknown>): PokerChoices {
  local.poker ??= { raiseTo: 0 } satisfies PokerChoices;
  return local.poker as PokerChoices;
}

function nameOf(names: readonly string[], seat: number): string {
  return names[seat] ?? `Player ${seat + 1}`;
}

// The last hand in a line, with names: "Hand 3: Ann wins 240 with a pair of aces".
function lastHandText(view: PokerView, names: readonly string[]): string {
  const hand = view.lastHand;
  if (!hand) return "";
  const main = hand.pots[0];
  const winners = main.winners.map((seat) => nameOf(names, seat)).join(" and ");
  const total = hand.won.reduce((sum, chips) => sum + chips, 0);
  const verb = main.winners.length > 1 ? "split" : "wins";
  return main.handName ? `Hand ${hand.handNumber}: ${winners} ${verb} ${total} with ${main.handName}` : `Hand ${hand.handNumber}: ${winners} ${verb} ${total}`;
}

// The buttons for the viewer's move: fold, check or call, the preset raises, and a raise of the
// viewer's own size, stepped by the big blind.
function actionButtons(context: BoardContext, view: PokerView, seat: number): BoardButton[] {
  const send = (move: PokerMove): void => context.send(move);
  const player = view.players[seat];
  const owed = amountToCall(view, player);
  const buttons: BoardButton[] = [];
  if (owed > 0) {
    buttons.push({ label: "Fold", onPress: () => send({ kind: "fold" }), color: BOARD_COLORS.warn });
    buttons.push({ label: owed === player.chips ? `Call ${owed} (all in)` : `Call ${owed}`, onPress: () => send({ kind: "call" }) });
  } else {
    buttons.push({ label: "Check", onPress: () => send({ kind: "check" }) });
  }
  if (!canBeRaised(view.players, seat)) return buttons;
  const sizes = raiseSizes(view, seat);
  if (sizes.length === 0) return buttons;
  for (const { to, label } of sizes) buttons.push({ label: label[0].toUpperCase() + label.slice(1), onPress: () => send({ kind: "raise", to }), color: BOARD_COLORS.accent });
  // The viewer's own raise, kept between the smallest raise and all in.
  const smallest = sizes[0].to;
  const allIn = sizes[sizes.length - 1].to;
  const choices = choicesOf(context.local);
  const clamp = (amount: number): number => Math.max(smallest, Math.min(allIn, amount));
  choices.raiseTo = clamp(choices.raiseTo || smallest);
  const amount = choices.raiseTo;
  const verb = view.currentBet === 0 ? "Bet" : "Raise to";
  buttons.push({ label: "-", onPress: () => (choices.raiseTo = clamp(amount - BIG_BLIND)) });
  buttons.push({ label: `${verb} ${amount}`, onPress: () => send({ kind: "raise", to: amount }), color: BOARD_COLORS.bright });
  buttons.push({ label: "+", onPress: () => (choices.raiseTo = clamp(amount + BIG_BLIND)) });
  return buttons;
}

// The small words under a seat's name: its place at the table, and what it last did.
function seatTags(view: PokerView, seat: number): string {
  const player = view.players[seat];
  const tags: string[] = [];
  if (seat === view.dealer) tags.push("dealer");
  if (seat === view.smallBlindSeat) tags.push("small blind");
  if (seat === view.bigBlindSeat) tags.push("big blind");
  if (!player.isInHand) tags.push(player.chips === 0 ? "out of chips" : "sitting out");
  else if (player.hasFolded) tags.push("folded");
  else if (isAllIn(player)) tags.push("all in");
  else if (view.lastAction?.seat === seat) tags.push(view.lastAction.text);
  return tags.join(", ");
}

function drawSeat(context: BoardContext, view: PokerView, seat: number, rect: Rect): void {
  const { ui, names, mySeat } = context;
  const player = view.players[seat];
  const isToMove = context.toMove.includes(seat);
  const inner = drawSeatPanel(ui, rect, seat, nameOf(names, seat), player.chips, isToMove, seat === mySeat, TEXT_SIZE);
  ui.text(BOARD_COLORS.dim, ui.fitted(seatTags(view, seat), SMALL_SIZE, inner.width), inner.x, inner.y, SMALL_SIZE);

  // Cards fill what is left, two across with room beside them for the bet.
  const cardsTop = inner.y + SMALL_SIZE + 6;
  const lastLine = SMALL_SIZE + 4;
  const cardWidth = Math.max(10, Math.min(inner.width * 0.22, (inner.y + inner.height - cardsTop - lastLine) / CARD_ASPECT));
  if (player.isInHand) {
    const cards: (Card | null)[] = player.holeCards ? [...player.holeCards] : [null, null];
    drawCardRow(ui, inner.x, cardsTop, cardWidth, cards, Infinity, player.hasFolded ? 0.35 : 0.9);
  }
  const besideCards = inner.x + cardRowWidth(2, cardWidth) + 8;
  if (player.streetBet > 0) ui.text(BOARD_COLORS.accent, `bet ${player.streetBet}`, besideCards, cardsTop, SMALL_SIZE);

  // The last hand: what this seat won, and the cards it showed, small.
  const hand = view.lastHand;
  const shown = hand?.shown.find((each) => each.seat === seat);
  const won = hand?.won[seat] ?? 0;
  const resultText = [won > 0 ? `won ${won}` : "", shown?.handName ?? ""].filter(Boolean).join(", ");
  if (resultText) ui.text(won > 0 ? BOARD_COLORS.bright : BOARD_COLORS.dim, ui.fitted(`last hand: ${resultText}`, SMALL_SIZE, inner.width), inner.x, inner.y + inner.height - SMALL_SIZE, SMALL_SIZE);
  const miniWidth = cardWidth * 0.6;
  if (shown && besideCards + cardRowWidth(2, miniWidth) <= inner.x + inner.width) {
    drawCardRow(ui, besideCards, cardsTop + SMALL_SIZE + 6, miniWidth, shown.cards, Infinity, 0.6);
  }
}

export function drawPoker(context: BoardContext): void {
  const { ui, area, names, mySeat } = context;
  const view = context.view as PokerView;
  const count = view.players.length;
  const myMove = isMyMove(context) && mySeat !== null;

  // From the bottom up: the viewer's actions, then a status line.
  const buttons = myMove ? actionButtons(context, view, mySeat) : [];
  const actionsHeight = buttonRowHeight(ui, area.width, buttons.map((button) => button.label));
  const actionsTop = area.y + area.height - actionsHeight;
  const statusTop = actionsTop - (actionsHeight > 0 ? 8 : 0) - TEXT_SIZE - 2;
  const tableHeight = statusTop - 8 - area.y;

  // The board between two rows of seats.
  const centerHeight = Math.min(tableHeight * 0.34, 110);
  const rowHeight = (tableHeight - centerHeight - 16) / 2;
  const perRow = Math.ceil(count / 2);
  const topSeats = Array.from({ length: perRow }, (_, index) => index);
  const bottomSeats = Array.from({ length: count - perRow }, (_, index) => count - 1 - index);
  const topRects = seatRects({ x: area.x, y: area.y, width: area.width, height: rowHeight }, topSeats.length, perRow);
  const bottomRects = seatRects({ x: area.x, y: area.y + rowHeight + centerHeight + 16, width: area.width, height: rowHeight }, bottomSeats.length, perRow);
  topSeats.forEach((seat, index) => drawSeat(context, view, seat, topRects[index]));
  bottomSeats.forEach((seat, index) => drawSeat(context, view, seat, bottomRects[index]));

  // The community cards, with empty places for those still to come, and the pot.
  const centerTop = area.y + rowHeight + 8;
  const lineSpace = SMALL_SIZE + 6;
  const communityWidth = Math.max(10, Math.min((centerHeight - 2 * lineSpace) / CARD_ASPECT, area.width / 9));
  const rowWidth = cardRowWidth(5, communityWidth);
  const communityLeft = area.x + (area.width - rowWidth) / 2;
  const cardsTop = centerTop + lineSpace;
  ui.text(BOARD_COLORS.accent, `Pot ${potTotal(view.players)}`, area.x + area.width / 2, centerTop, TEXT_SIZE, "center");
  for (let place = 0; place < 5; place++) {
    const x = communityLeft + place * communityWidth * 1.12;
    const card = view.community[place];
    if (card) drawCard(ui, x, cardsTop, communityWidth, card);
    else roundedRect(ui, BOARD_COLORS.grid, 0.2, { x, y: cardsTop, width: communityWidth, height: communityWidth * CARD_ASPECT }, communityWidth * 0.14);
  }
  const handText = lastHandText(view, names);
  if (handText) ui.text(BOARD_COLORS.dim, ui.fitted(handText, SMALL_SIZE, area.width), area.x + area.width / 2, cardsTop + communityWidth * CARD_ASPECT + 6, SMALL_SIZE, "center");

  // Whose move it is, or how the game ended.
  ui.text(context.outcome ? BOARD_COLORS.accent : BOARD_COLORS.bright, ui.fitted(statusLine(context, view), TEXT_SIZE, area.width), area.x, statusTop, TEXT_SIZE);
  if (buttons.length > 0) drawButtonRow(ui, { x: area.x, y: actionsTop, width: area.width, height: actionsHeight }, buttons);
}

function statusLine(context: BoardContext, view: PokerView): string {
  if (context.outcome) return context.outcome.summary ?? "The game is over";
  const street = { preflop: "Before the flop", flop: "The flop", turn: "The turn", river: "The river" }[view.street];
  const stillIn = view.players.filter(isStillIn).length;
  const mine = context.mySeat;
  if (mine !== null && context.toMove.includes(mine)) {
    const owed = amountToCall(view, view.players[mine]);
    return `${street}, ${stillIn} in the hand: your move${owed > 0 ? `, ${owed} to call` : ""}`;
  }
  return `${street}, ${stillIn} in the hand. ${waitingFor(context.names, context.toMove)}`;
}
