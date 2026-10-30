import { betSizes } from "../../../../../../packages/table-games/src/casino.js";
import {
  BACCARAT_MAX_BET,
  BACCARAT_MIN_BET,
  BACCARAT_SIDES,
  type BaccaratMove,
  type BaccaratSide,
  type BaccaratView,
} from "../../../../../../packages/table-games/src/games/baccarat.js";
import type { Rect } from "../Ui.js";
import { BOARD_COLORS, isMyMove, type BoardContext } from "./BoardContext.js";
import { buttonRowHeight, CARD_ASPECT, cardRowWidth, drawButtonRow, drawCardRow, drawSeatPanel, seatRects, waitingFor, type BoardButton } from "./cards.js";

// Baccarat: the last coup across the top (the player's hand on the left, the banker's on the
// right, and who won), the seats below with their bets and how the last coup went for them, and
// the viewer's bet along the bottom: the side to bet on, chosen first, then the amount. The coup
// is dealt the moment the last bet is in, so the top always shows the one just played.

const TEXT_SIZE = 10;
const SMALL_SIZE = 9;
const SIDE_NAMES: Readonly<Record<BaccaratSide, string>> = { player: "Player", banker: "Banker", tie: "Tie" };

interface BaccaratChoices {
  side: BaccaratSide;
}

function choicesOf(local: Record<string, unknown>): BaccaratChoices {
  local.baccarat ??= { side: "banker" } satisfies BaccaratChoices;
  return local.baccarat as BaccaratChoices;
}

function nameOf(names: readonly string[], seat: number): string {
  return names[seat] ?? `Player ${seat + 1}`;
}

function signed(amount: number): string {
  return amount > 0 ? `+${amount}` : `${amount}`;
}

function betButtons(context: BoardContext, view: BaccaratView, seat: number): BoardButton[] {
  const choices = choicesOf(context.local);
  const chips = view.seats[seat].chips;
  const sides: BoardButton[] = BACCARAT_SIDES.map((side) => ({
    label: SIDE_NAMES[side],
    onPress: () => (choices.side = side),
    color: side === choices.side ? BOARD_COLORS.bright : BOARD_COLORS.dim,
    isChosen: side === choices.side,
  }));
  const sizes = [...new Set([Math.min(BACCARAT_MIN_BET, chips), ...betSizes(chips, BACCARAT_MIN_BET, BACCARAT_MAX_BET)])];
  const amounts = sizes.map(
    (amount): BoardButton => ({
      label: `Bet ${amount} on ${choices.side}`,
      onPress: () => context.send({ kind: "bet", on: choices.side, amount } satisfies BaccaratMove),
      color: BOARD_COLORS.accent,
    }),
  );
  return [...sides, ...amounts];
}

function drawSeat(context: BoardContext, view: BaccaratView, seat: number, rect: Rect): void {
  const { ui, names, mySeat } = context;
  const player = view.seats[seat];
  const inner = drawSeatPanel(ui, rect, seat, nameOf(names, seat), player.chips, context.toMove.includes(seat), seat === mySeat, TEXT_SIZE);
  let line: string;
  if (!player.isInRound) line = "out of chips";
  else if (player.bet) line = `bet ${player.bet.amount} on ${player.bet.on}`;
  else line = "placing a bet";
  ui.text(BOARD_COLORS.text, ui.fitted(line, SMALL_SIZE, inner.width), inner.x, inner.y, SMALL_SIZE);
  const last = view.lastCoup?.results[seat];
  if (last) {
    const color = last.net > 0 ? BOARD_COLORS.bright : last.net < 0 ? BOARD_COLORS.warn : BOARD_COLORS.dim;
    const text = `last coup: ${last.bet.amount} on ${last.bet.on}, ${signed(last.net)}`;
    ui.text(color, ui.fitted(text, SMALL_SIZE, inner.width), inner.x, Math.min(inner.y + SMALL_SIZE + 8, inner.y + inner.height - SMALL_SIZE), SMALL_SIZE);
  }
}

// One side of the coup: its name and total, and its cards.
function drawHand(context: BoardContext, view: BaccaratView, side: "player" | "banker", rect: Rect): void {
  const { ui } = context;
  const coup = view.lastCoup;
  const isWinner = coup?.winner === side;
  const total = side === "player" ? coup?.playerTotal : coup?.bankerTotal;
  const title = coup ? `${SIDE_NAMES[side]} ${total}${isWinner ? ", wins" : ""}` : SIDE_NAMES[side];
  ui.text(isWinner ? BOARD_COLORS.accent : BOARD_COLORS.text, title, rect.x + rect.width / 2, rect.y, TEXT_SIZE, "center");
  const cards = coup ? (side === "player" ? coup.playerCards : coup.bankerCards) : [];
  const cardWidth = Math.max(10, Math.min((rect.height - TEXT_SIZE - 8) / CARD_ASPECT, rect.width / 4));
  const rowWidth = cardRowWidth(cards.length, cardWidth);
  drawCardRow(ui, rect.x + (rect.width - rowWidth) / 2, rect.y + TEXT_SIZE + 8, cardWidth, cards, rect.width, 0.9);
}

export function drawBaccarat(context: BoardContext): void {
  const { ui, area, mySeat } = context;
  const view = context.view as BaccaratView;
  const buttons = isMyMove(context) && mySeat !== null ? betButtons(context, view, mySeat) : [];
  const actionsHeight = buttonRowHeight(ui, area.width, buttons.map((button) => button.label));
  const actionsTop = area.y + area.height - actionsHeight;
  const statusTop = actionsTop - (actionsHeight > 0 ? 8 : 0) - TEXT_SIZE - 2;
  const tableHeight = statusTop - 8 - area.y;

  const coupHeight = Math.min(tableHeight * 0.4, 110);
  const half = (area.width - 20) / 2;
  drawHand(context, view, "player", { x: area.x, y: area.y, width: half, height: coupHeight });
  drawHand(context, view, "banker", { x: area.x + half + 20, y: area.y, width: half, height: coupHeight });
  if (view.lastCoup?.winner === "tie") ui.text(BOARD_COLORS.accent, "Tie", area.x + area.width / 2, area.y, TEXT_SIZE, "center");

  const seatsArea = { x: area.x, y: area.y + coupHeight + 8, width: area.width, height: tableHeight - coupHeight - 8 };
  const count = view.seats.length;
  seatRects(seatsArea, count, count <= 3 ? count : 3).forEach((rect, seat) => drawSeat(context, view, seat, rect));

  ui.text(context.outcome ? BOARD_COLORS.accent : BOARD_COLORS.bright, ui.fitted(statusLine(context, view), TEXT_SIZE, area.width), area.x, statusTop, TEXT_SIZE);
  if (buttons.length > 0) drawButtonRow(ui, { x: area.x, y: actionsTop, width: area.width, height: actionsHeight }, buttons);
}

function statusLine(context: BoardContext, view: BaccaratView): string {
  if (context.outcome) return context.outcome.summary ?? "The game is over";
  const mine = context.mySeat;
  const round = `Coup ${view.roundNumber + 1}`;
  if (mine !== null && context.toMove.includes(mine)) return `${round}: choose a side, then a bet. Banker pays 0.95 to 1, tie 8 to 1.`;
  return `${round}: ${waitingFor(context.names, context.toMove)}`;
}
