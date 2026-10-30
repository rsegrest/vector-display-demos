import { isRecord, refuse, seatsWithMost, type Choice, type MoveResult, type Outcome, type Seat, type TableGame } from "../TableGame.js";
import { shuffled } from "../casino.js";
import { BOGGLE_WORDS } from "./boggleWords.js";

export const BOGGLE_SIZE = 4;
export const SHORTEST_WORD = 3;
// The round's length, for the board's countdown. The rules have no clock (see `boggle` below).
export const ROUND_SECONDS = 180;

// The sixteen dice of the standard (1992) set, one string of six faces each; "Q" is the "Qu" face.
const DICE = [
  "AAEEGN", "ABBJOO", "ACHOPS", "AFFKPS",
  "AOOTTW", "CIMOTU", "DEILRX", "DELRVY",
  "DISTTY", "EEGHNW", "EEINSU", "EHRTVW",
  "EIOSST", "ELRTTY", "HIMNQU", "HLNNRZ",
];

export interface BoggleState {
  // [row][column]: each die's face, a capital letter or "Qu".
  readonly grid: readonly (readonly string[])[];
  // Each seat's words, lower case, in the order found.
  readonly words: readonly (readonly string[])[];
  readonly isDone: readonly boolean[];
  // Each seat's points, once every seat is done.
  readonly scores: readonly number[] | null;
  readonly outcome: Outcome | null;
}

// What a seat sees: its own words, and only how many the others have found until the game ends.
export interface BoggleView {
  readonly grid: readonly (readonly string[])[];
  // null for another seat's words while the game is on.
  readonly words: readonly (readonly string[] | null)[];
  readonly wordCounts: readonly number[];
  readonly isDone: readonly boolean[];
  readonly scores: readonly number[] | null;
  readonly outcome: Outcome | null;
}

// How many words the simple computer player finds before it stops.
const COMPUTER_WORD_LIMIT = 8;

export type BoggleMove = { readonly kind: "word"; readonly word: string } | { readonly kind: "done" };

// Shake the dice into the grid: each die in a random place, showing a random face.
function shakeGrid(random: () => number): string[][] {
  const faces = shuffled(DICE, random).map((die) => {
    const face = die[Math.floor(random() * die.length)];
    return face === "Q" ? "Qu" : face;
  });
  return Array.from({ length: BOGGLE_SIZE }, (_, row) => faces.slice(row * BOGGLE_SIZE, (row + 1) * BOGGLE_SIZE));
}

// The cells, in order, that spell `word` on the grid: each next to the one before (across, down
// or diagonally), none used twice. null if the word cannot be traced.
export function tracePath(grid: BoggleState["grid"], word: string): [number, number][] | null {
  const target = word.toLowerCase();
  const used = new Set<number>();
  const path: [number, number][] = [];
  const extend = (row: number, column: number, offset: number): boolean => {
    if (row < 0 || row >= BOGGLE_SIZE || column < 0 || column >= BOGGLE_SIZE || used.has(row * BOGGLE_SIZE + column)) return false;
    const face = grid[row][column].toLowerCase();
    if (!target.startsWith(face, offset)) return false;
    used.add(row * BOGGLE_SIZE + column);
    path.push([row, column]);
    if (offset + face.length === target.length) return true;
    for (let rowStep = -1; rowStep <= 1; rowStep++) {
      for (let columnStep = -1; columnStep <= 1; columnStep++) {
        if ((rowStep !== 0 || columnStep !== 0) && extend(row + rowStep, column + columnStep, offset + face.length)) return true;
      }
    }
    used.delete(row * BOGGLE_SIZE + column);
    path.pop();
    return false;
  };
  for (let row = 0; row < BOGGLE_SIZE; row++) {
    for (let column = 0; column < BOGGLE_SIZE; column++) {
      if (extend(row, column, 0)) return path;
    }
  }
  return null;
}

export function isDictionaryWord(word: string): boolean {
  return word.length >= SHORTEST_WORD && BOGGLE_WORDS.has(word.toLowerCase());
}

// Points by length, as in the standard rules ("qu" counts as two letters).
export function wordScore(word: string): number {
  if (word.length <= 4) return 1;
  if (word.length === 5) return 2;
  if (word.length === 6) return 3;
  if (word.length === 7) return 5;
  return 11;
}

// Every dictionary word that can be traced on the grid, longest first, then alphabetically.
export function findWords(grid: BoggleState["grid"]): string[] {
  const found = [...BOGGLE_WORDS].filter((word) => tracePath(grid, word) !== null);
  return found.sort((a, b) => b.length - a.length || a.localeCompare(b));
}

// Each seat's points: a word scores only for a seat that alone found it.
export function seatScores(words: BoggleState["words"]): number[] {
  const finders = new Map<string, number>();
  for (const list of words) for (const word of list) finders.set(word, (finders.get(word) ?? 0) + 1);
  return words.map((list) => list.reduce((total, word) => total + (finders.get(word) === 1 ? wordScore(word) : 0), 0));
}

function readMove(move: unknown): BoggleMove | null {
  if (!isRecord(move)) return null;
  if (move.kind === "done") return { kind: "done" };
  if (move.kind === "word" && typeof move.word === "string" && move.word.length <= BOGGLE_SIZE * BOGGLE_SIZE * 2) return { kind: "word", word: move.word.trim().toLowerCase() };
  return null;
}

function submitWord(state: BoggleState, seat: Seat, word: string): MoveResult<BoggleState> {
  if (!/^[a-z]+$/.test(word)) return refuse("A word is letters only");
  if (word.length < SHORTEST_WORD) return refuse(`Words have at least ${SHORTEST_WORD} letters`);
  if (state.words[seat].includes(word)) return refuse("You already have that word");
  if (!tracePath(state.grid, word)) return refuse("That word is not on the grid");
  if (!isDictionaryWord(word)) return refuse("That word is not in the dictionary");
  const words = state.words.map((list, index) => (index === seat ? [...list, word] : list));
  return { ok: true, state: { ...state, words } };
}

function markDone(state: BoggleState, seat: Seat): BoggleState {
  const isDone = state.isDone.map((done, index) => done || index === seat);
  if (!isDone.every(Boolean)) return { ...state, isDone };
  const scores = seatScores(state.words);
  return { ...state, isDone, scores, outcome: { winners: seatsWithMost(scores), summary: `Most points: ${Math.max(...scores)}` } };
}

// How many words a computer player is offered at a time.
const WORDS_OFFERED = 6;

// The round lasts three minutes, but the rules have no clock (the room server and the window run
// the same code, and neither may disagree about time). Each seat ends its own round with "done";
// the board counts down from 3:00 and sends "done" itself when the time runs out. The game ends
// when every seat is done.
export const boggle: TableGame<BoggleState, BoggleView> = {
  id: "boggle",
  title: "Boggle",
  description: "Find words in a grid of sixteen letter dice before the three minutes run out.",
  family: "dice and words",
  computerPauseSeconds: 15,
  minPlayers: 1,
  maxPlayers: 6,
  strategy:
    "Find the most points of words in the 4 by 4 letter grid. A word is traced through letters next to each other (across, down or diagonally), using each die once, and has at least three letters. Longer words score more (3-4 letters 1, 5 letters 2, 6 letters 3, 7 letters 5, 8 or more 11), and a word another player also found scores nothing, so unusual and long words are best. Say done when you find no more.",
  canLookAhead: false,

  start: (playerCount, random) => ({
    grid: shakeGrid(random),
    words: Array.from({ length: playerCount }, () => []),
    isDone: Array<boolean>(playerCount).fill(false),
    scores: null,
    outcome: null,
  }),

  play(state, seat, rawMove): MoveResult<BoggleState> {
    if (state.outcome) return refuse("The game is over");
    if (!Number.isInteger(seat) || seat < 0 || seat >= state.words.length) return refuse("Not a seat at this table");
    if (state.isDone[seat]) return refuse("You are done for this round");
    const move = readMove(rawMove);
    if (!move) return refuse("That is not a Boggle move");
    return move.kind === "word" ? submitWord(state, seat, move.word) : { ok: true, state: markDone(state, seat) };
  },

  viewFor(state, seat): BoggleView {
    const canSee = (index: number): boolean => state.outcome !== null || index === seat;
    return {
      grid: state.grid,
      words: state.words.map((list, index) => (canSee(index) ? list : null)),
      wordCounts: state.words.map((list) => list.length),
      isDone: state.isDone,
      scores: state.scores,
      outcome: state.outcome,
    };
  },

  toMove: (state) => (state.outcome ? [] : state.isDone.flatMap((done, seat) => (done ? [] : [seat]))),
  outcome: (state) => state.outcome,

  choices(state, seat): Choice[] {
    if (state.outcome || state.isDone[seat]) return [];
    const mine = new Set(state.words[seat]);
    const words = findWords(state.grid).filter((word) => !mine.has(word)).slice(0, WORDS_OFFERED);
    return [
      ...words.map((word) => ({ move: { kind: "word", word }, label: `submit the word ${word}` })),
      { move: { kind: "done" }, label: "done: stop looking for words" },
    ];
  },

  // A fair opponent, not a dictionary: it finds a modest number of words, a random handful
  // of those it could see, then says it is done.
  simpleStrategy(view, seat, choices, random) {
    const done = choices.find((choice) => (choice.move as BoggleMove).kind === "done") ?? choices[choices.length - 1];
    const words = choices.filter((choice) => (choice.move as BoggleMove).kind === "word");
    const found = view.words[seat]?.length ?? 0;
    if (words.length === 0 || found >= COMPUTER_WORD_LIMIT) return done;
    return words[Math.floor(random() * words.length)];
  },
};
