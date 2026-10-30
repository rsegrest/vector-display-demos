import { betSizes, type Card } from "../../../../../../packages/table-games/src/casino.js";
import {
  BLACKJACK_MAX_BET,
  BLACKJACK_MIN_BET,
  handTotal,
  type BlackjackMove,
  type BlackjackResult,
  type BlackjackView,
} from "../../../../../../packages/table-games/src/games/blackjack.js";
import type { Rect } from "../Ui.js";
import { BOARD_COLORS, isMyMove, type BoardContext } from "./BoardContext.js";
import { buttonRowHeight, CARD_ASPECT, cardRowWidth, drawButtonRow, drawCardRow, drawSeatPanel, seatRects, waitingFor, type BoardButton } from "./cards.js";

// Blackjack: the dealer's hand across the top, the players' seats below it, and the viewer's
// bets or moves along the bottom. While everyone bets, the last round stays on show, dimmed:
// the dealer's final hand and each seat's hand and result.

const TEXT_SIZE = 10;
const SMALL_SIZE = 9;

const RESULT_WORDS: Readonly<Record<BlackjackResult, string>> = { blackjack: "blackjack", win: "win", push: "push", lose: "lose", bust: "bust" };

function nameOf(names: readonly string[], seat: number): string {
  return names[seat] ?? `Player ${seat + 1}`;
}

function signed(amount: number): string {
  return amount > 0 ? `+${amount}` : `${amount}`;
}

// A hand's total for people: "soft 17", "21", "bust 24".
function totalText(cards: readonly Card[]): string {
  const { total, isSoft } = handTotal(cards);
  if (total > 21) return `bust ${total}`;
  return isSoft && total < 21 ? `soft ${total}` : `${total}`;
}

function actionButtons(context: BoardContext, view: BlackjackView, seat: number): BoardButton[] {
  const send = (move: BlackjackMove): void => context.send(move);
  const player = view.players[seat];
  if (view.phase === "betting") {
    const sizes = [...new Set([Math.min(BLACKJACK_MIN_BET, player.chips), ...betSizes(player.chips, BLACKJACK_MIN_BET, BLACKJACK_MAX_BET)])];
    return sizes.map((amount) => ({ label: `Bet ${amount}`, onPress: () => send({ kind: "bet", amount }), color: BOARD_COLORS.accent }));
  }
  const buttons: BoardButton[] = [
    { label: "Hit", onPress: () => send({ kind: "hit" }) },
    { label: "Stand", onPress: () => send({ kind: "stand" }) },
  ];
  if (player.cards.length === 2 && player.chips >= player.bet) buttons.push({ label: "Double down", onPress: () => send({ kind: "double" }), color: BOARD_COLORS.accent });
  return buttons;
}

function drawSeat(context: BoardContext, view: BlackjackView, seat: number, rect: Rect): void {
  const { ui, names, mySeat } = context;
  const player = view.players[seat];
  const inner = drawSeatPanel(ui, rect, seat, nameOf(names, seat), player.chips, context.toMove.includes(seat), seat === mySeat, TEXT_SIZE);
  const last = view.phase === "betting" ? view.lastRound?.hands[seat] ?? null : null;

  // The line under the name: the bet, or how the last round went while the next is bet.
  let line: string;
  if (!player.isInRound) line = "out of chips";
  else if (view.phase === "betting") line = player.hasBet ? `bet ${player.bet}` : "placing a bet";
  else line = `bet ${player.bet}${player.isDoubled ? " (doubled)" : ""}, ${totalText(player.cards)}`;
  ui.text(BOARD_COLORS.dim, ui.fitted(line, SMALL_SIZE, inner.width), inner.x, inner.y, SMALL_SIZE);

  const cardsTop = inner.y + SMALL_SIZE + 6;
  const resultSpace = SMALL_SIZE + 4;
  const cardWidth = Math.max(10, Math.min(inner.width * 0.24, (inner.y + inner.height - cardsTop - resultSpace) / CARD_ASPECT));
  const cards = view.phase === "playing" ? player.cards : last?.cards ?? [];
  drawCardRow(ui, inner.x, cardsTop, cardWidth, cards, inner.width, view.phase === "playing" ? 0.9 : 0.45);
  if (last) {
    const color = last.net > 0 ? BOARD_COLORS.bright : last.net < 0 ? BOARD_COLORS.warn : BOARD_COLORS.dim;
    ui.text(color, ui.fitted(`last round: ${RESULT_WORDS[last.result]} ${signed(last.net)}`, SMALL_SIZE, inner.width), inner.x, inner.y + inner.height - SMALL_SIZE, SMALL_SIZE);
  }
}

export function drawBlackjack(context: BoardContext): void {
  const { ui, area, mySeat } = context;
  const view = context.view as BlackjackView;
  const count = view.players.length;
  const buttons = isMyMove(context) && mySeat !== null ? actionButtons(context, view, mySeat) : [];
  const actionsHeight = buttonRowHeight(ui, area.width, buttons.map((button) => button.label));
  const actionsTop = area.y + area.height - actionsHeight;
  const statusTop = actionsTop - (actionsHeight > 0 ? 8 : 0) - TEXT_SIZE - 2;
  const tableHeight = statusTop - 8 - area.y;

  // The dealer: this round's cards (the hole card face down), or the last round's, dimmed.
  const dealerHeight = Math.min(tableHeight * 0.34, 110);
  const isPlaying = view.phase === "playing";
  const dealerCards: readonly (Card | null)[] = isPlaying ? view.dealerCards : view.lastRound?.dealerCards ?? [];
  const shownDealer = dealerCards.filter((card): card is Card => card !== null);
  let dealerLabel = "Dealer";
  if (isPlaying) dealerLabel = `Dealer shows ${totalText(shownDealer)}`;
  else if (view.lastRound) dealerLabel = `Last round: dealer ${totalText(shownDealer)}`;
  ui.text(BOARD_COLORS.text, dealerLabel, area.x + area.width / 2, area.y, TEXT_SIZE, "center");
  const dealerCardWidth = Math.max(10, Math.min((dealerHeight - TEXT_SIZE - 10) / CARD_ASPECT, area.width / 10));
  const dealerRowWidth = Math.min(area.width, cardRowWidth(dealerCards.length, dealerCardWidth));
  drawCardRow(ui, area.x + (area.width - dealerRowWidth) / 2, area.y + TEXT_SIZE + 8, dealerCardWidth, dealerCards, area.width, isPlaying ? 0.9 : 0.45);

  const seatsArea = { x: area.x, y: area.y + dealerHeight + 8, width: area.width, height: tableHeight - dealerHeight - 8 };
  seatRects(seatsArea, count, count <= 3 ? count : 3).forEach((rect, seat) => drawSeat(context, view, seat, rect));

  ui.text(context.outcome ? BOARD_COLORS.accent : BOARD_COLORS.bright, ui.fitted(statusLine(context, view), TEXT_SIZE, area.width), area.x, statusTop, TEXT_SIZE);
  if (buttons.length > 0) drawButtonRow(ui, { x: area.x, y: actionsTop, width: area.width, height: actionsHeight }, buttons);
}

function statusLine(context: BoardContext, view: BlackjackView): string {
  if (context.outcome) return context.outcome.summary ?? "The game is over";
  const mine = context.mySeat;
  const isMine = mine !== null && context.toMove.includes(mine);
  if (view.phase === "betting") return isMine ? `Round ${view.roundNumber + 1}: place your bet` : `Round ${view.roundNumber + 1}: bets. ${waitingFor(context.names, context.toMove)}`;
  if (isMine) return `Your hand: ${totalText(view.players[mine].cards)}. Hit or stand?`;
  return waitingFor(context.names, context.toMove);
}
