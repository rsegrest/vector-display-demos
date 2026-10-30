import {
  BOGGLE_SIZE,
  ROUND_SECONDS,
  SHORTEST_WORD,
  wordScore,
  type BoggleMove,
  type BoggleView,
} from "../../../../../../packages/table-games/src/games/boggle.js";
import type { Rect } from "../Ui.js";
import { BOARD_COLORS, isMyMove, type BoardContext } from "./BoardContext.js";

const TEXT_SIZE = 10;

type Cell = readonly [row: number, column: number];

// What the board remembers between frames: the word being traced, as the dice clicked in order,
// and when the countdown started. The rules have no clock, so the countdown lives here, and
// sends "done" itself when it reaches 0:00.
interface BoggleChoices {
  path: Cell[];
  startedAt: number;
  hasSentDone: boolean;
}

function choicesOf(context: BoardContext): BoggleChoices {
  context.local.boggle ??= { path: [], startedAt: context.seconds, hasSentDone: false } satisfies BoggleChoices;
  return context.local.boggle as BoggleChoices;
}

// Where the grid goes in `area`: a square on the left, as tall as the board allows, leaving
// room on the right for the word, the buttons and the word lists.
export function boggleGridRect(area: Rect): Rect {
  const size = Math.floor(Math.min(area.height, area.width * 0.5));
  return { x: area.x, y: area.y + (area.height - size) / 2, width: size, height: size };
}

const isNeighbor = ([row, column]: Cell, [otherRow, otherColumn]: Cell): boolean =>
  Math.max(Math.abs(row - otherRow), Math.abs(column - otherColumn)) === 1;

export function drawBoggle(context: BoardContext): void {
  const { ui, area, mySeat } = context;
  const view = context.view as BoggleView;
  const send = (move: BoggleMove): void => context.send(move);
  const choices = choicesOf(context);
  const canPlay = isMyMove(context) && mySeat !== null && !view.isDone[mySeat];
  const word = choices.path.map(([row, column]) => view.grid[row][column]).join("").toLowerCase();
  const submit = (): void => {
    if (word.length >= SHORTEST_WORD) send({ kind: "word", word });
    choices.path = [];
  };
  const finish = (): void => {
    choices.hasSentDone = true;
    choices.path = [];
    send({ kind: "done" });
  };

  // The countdown: when it runs out, this seat is done.
  const secondsLeft = Math.max(0, ROUND_SECONDS - (context.seconds - choices.startedAt));
  if (canPlay && secondsLeft === 0 && !choices.hasSentDone) finish();

  // ── The grid ──
  const grid = boggleGridRect(area);
  const cell = grid.width / BOGGLE_SIZE;
  const pathIndex = (row: number, column: number): number => choices.path.findIndex(([r, c]) => r === row && c === column);
  for (let row = 0; row < BOGGLE_SIZE; row++) {
    for (let column = 0; column < BOGGLE_SIZE; column++) {
      const rect = { x: grid.x + column * cell, y: grid.y + row * cell, width: cell, height: cell };
      const index = pathIndex(row, column);
      const isTraced = index >= 0;
      const isHovered = canPlay && ui.isHovered(rect);
      ui.rect(isTraced ? BOARD_COLORS.accent : BOARD_COLORS.grid, isTraced ? 1 : isHovered ? 0.8 : 0.4, rect, 3);
      const face = view.grid[row][column];
      const letterSize = cell * (face.length > 1 ? 0.36 : 0.45);
      ui.text(isTraced ? BOARD_COLORS.accent : BOARD_COLORS.bright, face, rect.x + cell / 2, rect.y + (cell - letterSize) / 2, letterSize, "center", isTraced ? 1.3 : 1);
      if (canPlay) ui.region(rect, () => clickDie(choices, [row, column], index, submit));
    }
  }
  // The traced path, die to die.
  const path = ui.pen(BOARD_COLORS.accent, 0.6);
  choices.path.forEach(([row, column], index) => {
    const x = grid.x + (column + 0.5) * cell;
    const y = grid.y + (row + 0.5) * cell;
    if (index === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  });

  // ── The side panel ──
  const panel = { x: grid.x + grid.width + 14, y: area.y, width: area.x + area.width - (grid.x + grid.width + 14), height: area.height };
  const timeText = `${Math.floor(secondsLeft / 60)}:${String(Math.floor(secondsLeft % 60)).padStart(2, "0")}`;
  const status = view.outcome
    ? (view.outcome.summary ?? "Game over")
    : mySeat === null
      ? "Watching"
      : view.isDone[mySeat]
        ? "Done: waiting for the others"
        : `Time left ${timeText}`;
  ui.text(secondsLeft < 30 && canPlay ? BOARD_COLORS.warn : BOARD_COLORS.text, ui.fitted(status, 12, panel.width), panel.x, panel.y, 12);

  let y = panel.y + 22;
  if (canPlay) {
    ui.text(BOARD_COLORS.accent, ui.fitted(word === "" ? "Click letters to trace a word" : word.toUpperCase(), word === "" ? TEXT_SIZE : 16, panel.width), panel.x, y, word === "" ? TEXT_SIZE : 16);
    y += 24;
    const buttonHeight = 22;
    const buttonWidth = Math.min(70, (panel.width - 12) / 3);
    if (word.length >= SHORTEST_WORD) ui.button(BOARD_COLORS.accent, { x: panel.x, y, width: buttonWidth, height: buttonHeight }, "Submit", submit, TEXT_SIZE);
    if (word !== "") ui.button(BOARD_COLORS.dim, { x: panel.x + buttonWidth + 6, y, width: buttonWidth, height: buttonHeight }, "Clear", () => (choices.path = []), TEXT_SIZE);
    ui.button(BOARD_COLORS.warn, { x: panel.x + 2 * (buttonWidth + 6), y, width: buttonWidth, height: buttonHeight }, "Done", finish, TEXT_SIZE);
    y += buttonHeight + 10;
  }
  drawWordLists(context, view, { x: panel.x, y, width: panel.width, height: panel.y + panel.height - y });
}

// A click on a die: the first die starts a word; a neighbor of the last die, not yet used,
// adds to it; the last die again submits it; an earlier die in the word goes back to it; any
// other die starts again from there.
function clickDie(choices: BoggleChoices, cell: Cell, index: number, submit: () => void): void {
  const last = choices.path.at(-1);
  if (index >= 0 && index === choices.path.length - 1) submit();
  else if (index >= 0) choices.path = choices.path.slice(0, index + 1);
  else if (last && isNeighbor(last, cell)) choices.path = [...choices.path, cell];
  else choices.path = [cell];
}

// This seat's words with their points; the others' as counts until the game ends, then everyone's
// words, with those found by more than one player (which score nothing) dimmed.
function drawWordLists(context: BoardContext, view: BoggleView, area: Rect): void {
  const { ui, mySeat } = context;
  const lineHeight = TEXT_SIZE + 4;
  const finders = new Map<string, number>();
  for (const list of view.words) for (const word of list ?? []) finders.set(word, (finders.get(word) ?? 0) + 1);
  const nameOf = (seat: number): string => context.names[seat] ?? `Player ${seat + 1}`;
  const seatColor = (seat: number) => BOARD_COLORS.seats[seat % BOARD_COLORS.seats.length];

  // Before the end, a line for each other seat: how many words it has.
  let y = area.y;
  if (!view.outcome) {
    for (let seat = 0; seat < view.words.length; seat++) {
      if (seat === mySeat || y + lineHeight > area.y + area.height) continue;
      const line = `${nameOf(seat)}: ${view.wordCounts[seat]} words${view.isDone[seat] ? ", done" : ""}`;
      ui.text(seatColor(seat), ui.fitted(line, TEXT_SIZE, area.width), area.x, y, TEXT_SIZE);
      y += lineHeight;
    }
    y += 4;
  }

  // The lists to show in full: this seat's, or everyone's once the game is over, side by side.
  const shown = view.words.flatMap((list, seat) => (list !== null && (view.outcome !== null || seat === mySeat) ? [{ seat, list }] : []));
  if (shown.length === 0) return;
  const columnWidth = area.width / shown.length;
  const rowsThatFit = Math.max(0, Math.floor((area.y + area.height - y) / lineHeight) - 1);
  shown.forEach(({ seat, list }, column) => {
    const x = area.x + column * columnWidth;
    const points = list.reduce((total, word) => total + (view.outcome && (finders.get(word) ?? 0) > 1 ? 0 : wordScore(word)), 0);
    const heading = view.outcome ? `${nameOf(seat)}: ${view.scores?.[seat] ?? points}` : `Your words: ${points}`;
    ui.text(seatColor(seat), ui.fitted(heading, TEXT_SIZE, columnWidth - 6), x, y, TEXT_SIZE);
    // The newest words first, as many as fit.
    const newestFirst = [...list].reverse();
    const visible = newestFirst.length > rowsThatFit ? newestFirst.slice(0, Math.max(0, rowsThatFit - 1)) : newestFirst;
    visible.forEach((word, row) => {
      const isShared = view.outcome !== null && (finders.get(word) ?? 0) > 1;
      const line = `${word} ${isShared ? 0 : wordScore(word)}`;
      ui.text(isShared ? BOARD_COLORS.dim : BOARD_COLORS.text, ui.fitted(line, TEXT_SIZE, columnWidth - 6), x, y + (row + 1) * lineHeight, TEXT_SIZE, "left", isShared ? 0.5 : 0.95);
    });
    if (visible.length < newestFirst.length) ui.text(BOARD_COLORS.dim, `and ${newestFirst.length - visible.length} more`, x, y + (visible.length + 1) * lineHeight, TEXT_SIZE);
  });
}
