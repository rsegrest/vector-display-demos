import { isIndex, isRecord, refuse, seatsWithMost, type Choice, type MoveResult, type Outcome, type Seat, type TableGame } from "../TableGame.js";
import { rollDie } from "../casino.js";

export const DICE_COUNT = 5;
export const ROLLS_PER_TURN = 3;
export const UPPER_BONUS_THRESHOLD = 63;
export const UPPER_BONUS = 35;
export const YAHTZEE_BONUS = 100;

export const CATEGORIES = [
  "ones",
  "twos",
  "threes",
  "fours",
  "fives",
  "sixes",
  "threeOfAKind",
  "fourOfAKind",
  "fullHouse",
  "smallStraight",
  "largeStraight",
  "yahtzee",
  "chance",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const UPPER_CATEGORIES: readonly Category[] = CATEGORIES.slice(0, 6);

// Each category's name for people and computer players, as on the printed scorecard.
export const CATEGORY_NAMES: Readonly<Record<Category, string>> = {
  ones: "ones",
  twos: "twos",
  threes: "threes",
  fours: "fours",
  fives: "fives",
  sixes: "sixes",
  threeOfAKind: "three of a kind",
  fourOfAKind: "four of a kind",
  fullHouse: "full house",
  smallStraight: "small straight",
  largeStraight: "large straight",
  yahtzee: "Yahtzee",
  chance: "chance",
};

export interface Scorecard {
  // The points written in each box; null while the box is open.
  readonly boxes: Readonly<Record<Category, number | null>>;
  // How many extra Yahtzees were rolled after the Yahtzee box was scored at 50.
  readonly yahtzeeBonuses: number;
}

export interface YahtzeeState {
  readonly turn: Seat;
  // The five dice as last rolled; meaningless until the player in turn has rolled once.
  readonly dice: readonly number[];
  // Which dice were kept on the last roll, for the board to show.
  readonly kept: readonly boolean[];
  // 3 at the start of a turn, before any roll; 0 once all three are used.
  readonly rollsLeft: number;
  readonly scorecards: readonly Scorecard[];
  readonly outcome: Outcome | null;
  readonly lastScore: { readonly seat: Seat; readonly category: Category; readonly points: number } | null;
}

// Dice are public: every seat sees the whole state.
export type YahtzeeView = YahtzeeState;

export type YahtzeeMove =
  | { readonly kind: "roll"; readonly keep: readonly boolean[] }
  | { readonly kind: "score"; readonly category: Category };

function emptyScorecard(): Scorecard {
  const boxes = Object.fromEntries(CATEGORIES.map((category) => [category, null])) as Record<Category, number | null>;
  return { boxes, yahtzeeBonuses: 0 };
}

// How many of each face, counts[face] for faces 1 to 6.
function faceCounts(dice: readonly number[]): number[] {
  const counts = Array<number>(7).fill(0);
  for (const face of dice) counts[face]++;
  return counts;
}

const sum = (dice: readonly number[]): number => dice.reduce((total, face) => total + face, 0);

export function isYahtzee(dice: readonly number[]): boolean {
  return dice.length === DICE_COUNT && dice.every((face) => face === dice[0]);
}

// The longest run of consecutive faces among the dice, as those faces in order.
export function longestRun(dice: readonly number[]): number[] {
  const counts = faceCounts(dice);
  let best: number[] = [];
  let run: number[] = [];
  for (let face = 1; face <= 6; face++) {
    run = counts[face] > 0 ? [...run, face] : [];
    if (run.length > best.length) best = run;
  }
  return best;
}

// A rolled Yahtzee once the Yahtzee box is filled is a "joker" (the standard rules): it must
// go in its own upper box if that is open; failing that, any lower box, where a full house and
// the straights count in full; failing that, any upper box, for nothing.
function isJoker(dice: readonly number[], scorecard: Scorecard): boolean {
  return isYahtzee(dice) && scorecard.boxes.yahtzee !== null;
}

// The points these dice would put in `category`, on this scorecard (the joker rule included).
export function pointsFor(dice: readonly number[], category: Category, scorecard: Scorecard): number {
  const counts = faceCounts(dice);
  const joker = isJoker(dice, scorecard);
  const upperIndex = UPPER_CATEGORIES.indexOf(category);
  if (upperIndex >= 0) return counts[upperIndex + 1] * (upperIndex + 1);
  switch (category) {
    case "threeOfAKind":
      return counts.some((count) => count >= 3) ? sum(dice) : 0;
    case "fourOfAKind":
      return counts.some((count) => count >= 4) ? sum(dice) : 0;
    case "fullHouse":
      return joker || (counts.includes(3) && counts.includes(2)) ? 25 : 0;
    case "smallStraight":
      return joker || longestRun(dice).length >= 4 ? 30 : 0;
    case "largeStraight":
      return joker || longestRun(dice).length === 5 ? 40 : 0;
    case "yahtzee":
      return isYahtzee(dice) ? 50 : 0;
    default:
      return sum(dice);
  }
}

// The boxes these dice may be scored in: every open box, but for a joker (see isJoker).
export function openCategories(dice: readonly number[], scorecard: Scorecard): Category[] {
  const open = CATEGORIES.filter((category) => scorecard.boxes[category] === null);
  if (!isJoker(dice, scorecard)) return open;
  const ownUpperBox = UPPER_CATEGORIES[dice[0] - 1];
  if (open.includes(ownUpperBox)) return [ownUpperBox];
  const openLower = open.filter((category) => !UPPER_CATEGORIES.includes(category));
  return openLower.length > 0 ? openLower : open;
}

export function upperSubtotal(scorecard: Scorecard): number {
  return UPPER_CATEGORIES.reduce((total, category) => total + (scorecard.boxes[category] ?? 0), 0);
}

export function upperBonus(scorecard: Scorecard): number {
  return upperSubtotal(scorecard) >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS : 0;
}

export function scorecardTotal(scorecard: Scorecard): number {
  const boxes = CATEGORIES.reduce((total, category) => total + (scorecard.boxes[category] ?? 0), 0);
  return boxes + upperBonus(scorecard) + scorecard.yahtzeeBonuses * YAHTZEE_BONUS;
}

export function isScorecardFull(scorecard: Scorecard): boolean {
  return CATEGORIES.every((category) => scorecard.boxes[category] !== null);
}

function readMove(move: unknown): YahtzeeMove | null {
  if (!isRecord(move)) return null;
  if (move.kind === "roll") {
    const keep = move.keep;
    if (!Array.isArray(keep) || keep.length !== DICE_COUNT || !keep.every((each) => typeof each === "boolean")) return null;
    return { kind: "roll", keep: [...keep] };
  }
  if (move.kind === "score" && CATEGORIES.includes(move.category as Category)) return { kind: "score", category: move.category as Category };
  return null;
}

function roll(state: YahtzeeState, keep: readonly boolean[], random: () => number): MoveResult<YahtzeeState> {
  if (state.rollsLeft === 0) return refuse("No rolls left: choose a box to score");
  const isFirstRoll = state.rollsLeft === ROLLS_PER_TURN;
  // The first roll of a turn throws all five; the last player's dice are not kept.
  if (isFirstRoll && keep.some(Boolean)) return refuse("Roll all five dice first");
  if (keep.every(Boolean)) return refuse("Keep fewer dice, or score");
  const dice = state.dice.map((face, index) => (keep[index] ? face : rollDie(random)));
  return { ok: true, state: { ...state, dice, kept: [...keep], rollsLeft: state.rollsLeft - 1 } };
}

function score(state: YahtzeeState, seat: Seat, category: Category): MoveResult<YahtzeeState> {
  if (state.rollsLeft === ROLLS_PER_TURN) return refuse("Roll the dice first");
  const scorecard = state.scorecards[seat];
  if (scorecard.boxes[category] !== null) return refuse("That box is already scored");
  if (!openCategories(state.dice, scorecard).includes(category)) return refuse("A Yahtzee must go in its own upper box while that is open");
  const points = pointsFor(state.dice, category, scorecard);
  // An extra Yahtzee earns its bonus whichever box it is scored in, but only after a 50.
  const earnsBonus = isYahtzee(state.dice) && scorecard.boxes.yahtzee === 50;
  const scored: Scorecard = { boxes: { ...scorecard.boxes, [category]: points }, yahtzeeBonuses: scorecard.yahtzeeBonuses + (earnsBonus ? 1 : 0) };
  const scorecards = state.scorecards.map((each, index) => (index === seat ? scored : each));
  const isOver = scorecards.every(isScorecardFull);
  const totals = scorecards.map(scorecardTotal);
  return {
    ok: true,
    state: {
      ...state,
      turn: isOver ? seat : (seat + 1) % scorecards.length,
      kept: Array<boolean>(DICE_COUNT).fill(false),
      rollsLeft: ROLLS_PER_TURN,
      scorecards,
      outcome: isOver ? { winners: seatsWithMost(totals), summary: `Highest total: ${Math.max(...totals)}` } : null,
      lastScore: { seat, category, points },
    },
  };
}

// ── For computer players ────────────────────────────────────────────────────

// About what a box is worth on average in a game played well: scoring well above this is a
// good use of the box, and zeroing the box with the smallest par costs least.
const PAR: Readonly<Record<Category, number>> = {
  ones: 2,
  twos: 5,
  threes: 8,
  fours: 11,
  fives: 14,
  sixes: 17,
  threeOfAKind: 15,
  fourOfAKind: 8,
  fullHouse: 15,
  smallStraight: 18,
  largeStraight: 12,
  yahtzee: 8,
  chance: 22,
};

function keepLabel(dice: readonly number[], keep: readonly boolean[]): string {
  const kept = dice.filter((_, index) => keep[index]);
  return kept.length === 0 ? "roll all five dice again" : `roll again keeping ${kept.join(" ")}`;
}

// Keep every die showing the most common face (the higher face on a tie).
function keepMostCommon(dice: readonly number[]): boolean[] {
  const counts = faceCounts(dice);
  const mostCommon = [6, 5, 4, 3, 2, 1].reduce((best, face) => (counts[face] > counts[best] ? face : best), 6);
  return dice.map((face) => face === mostCommon);
}

// Keep one die of each face in the longest run.
function keepRun(dice: readonly number[]): boolean[] {
  const left = new Set(longestRun(dice));
  return dice.map((face) => left.delete(face));
}

// The keep patterns worth offering: none, all of the most common face, one of each face in the
// longest run, and the pairs of a two-pair roll. Never all five, which wastes a roll.
function keepPatterns(dice: readonly number[]): boolean[][] {
  const counts = faceCounts(dice);
  const pairs = [1, 2, 3, 4, 5, 6].filter((face) => counts[face] === 2);
  const patterns = [
    dice.map(() => false),
    keepMostCommon(dice),
    ...(longestRun(dice).length >= 3 ? [keepRun(dice)] : []),
    ...(pairs.length === 2 ? [dice.map((face) => pairs.includes(face))] : []),
  ];
  const seen = new Set<string>();
  return patterns.filter((keep) => {
    const key = keep.map(Number).join("");
    if (keep.every(Boolean) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scoreLabel(points: number, category: Category): string {
  return `score ${points} in ${CATEGORY_NAMES[category]}`;
}

const sameMove = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// The greedy player's move: score at once what is too good to risk, else keep toward a straight
// or the most common face, and on the last roll take the box that beats its par by most.
function greedyMove(view: YahtzeeView, seat: Seat): YahtzeeMove {
  if (view.rollsLeft === ROLLS_PER_TURN) return { kind: "roll", keep: Array<boolean>(DICE_COUNT).fill(false) };
  const scorecard = view.scorecards[seat];
  const valued = openCategories(view.dice, scorecard).map((category) => ({ category, points: pointsFor(view.dice, category, scorecard) }));
  const great = valued.filter(({ category, points }) => points > 0 && ["yahtzee", "largeStraight", "fullHouse"].includes(category)).sort((a, b) => b.points - a.points);
  if (great.length > 0) return { kind: "score", category: great[0].category };
  const scoreBest = (): YahtzeeMove => {
    const best = valued.reduce((top, each) => (each.points - PAR[each.category] > top.points - PAR[top.category] ? each : top));
    return { kind: "score", category: best.category };
  };
  if (view.rollsLeft === 0) return scoreBest();
  const isOpen = (category: Category): boolean => scorecard.boxes[category] === null;
  const runLength = longestRun(view.dice).length;
  if (runLength >= 4 && isOpen("smallStraight") && !isOpen("largeStraight")) return { kind: "score", category: "smallStraight" };
  if (runLength === 4 && (isOpen("smallStraight") || isOpen("largeStraight"))) return { kind: "roll", keep: keepRun(view.dice) };
  const keep = keepMostCommon(view.dice);
  // Five of a kind with nowhere good to put it: there is nothing left to roll for.
  return keep.every(Boolean) ? scoreBest() : { kind: "roll", keep };
}

export const yahtzee: TableGame<YahtzeeState, YahtzeeView> = {
  id: "yahtzee",
  title: "Yahtzee",
  description: "Roll five dice up to three times a turn and fill in thirteen boxes.",
  family: "dice and words",
  minPlayers: 1,
  maxPlayers: 4,
  strategy:
    "Score the most points over thirteen turns. Each turn, roll up to three times, keeping any dice between rolls, then write the dice in one open box, even for zero. Aim for 63 in the upper boxes (three of each face) for the 35 bonus; keep a Yahtzee, large straight or full house when it comes; use chance and the ones box as places to dump a poor roll.",
  canLookAhead: false,

  start: (playerCount) => ({
    turn: 0,
    dice: Array<number>(DICE_COUNT).fill(1),
    kept: Array<boolean>(DICE_COUNT).fill(false),
    rollsLeft: ROLLS_PER_TURN,
    scorecards: Array.from({ length: playerCount }, emptyScorecard),
    outcome: null,
    lastScore: null,
  }),

  play(state, seat, rawMove, random): MoveResult<YahtzeeState> {
    if (state.outcome) return refuse("The game is over");
    if (!isIndex(seat, state.scorecards.length) || seat !== state.turn) return refuse("Not your turn");
    const move = readMove(rawMove);
    if (!move) return refuse("That is not a Yahtzee move");
    return move.kind === "roll" ? roll(state, move.keep, random) : score(state, seat, move.category);
  },

  viewFor: (state) => state,
  toMove: (state) => (state.outcome ? [] : [state.turn]),
  outcome: (state) => state.outcome,

  choices(state, seat): Choice[] {
    if (state.outcome || seat !== state.turn) return [];
    if (state.rollsLeft === ROLLS_PER_TURN) return [{ move: { kind: "roll", keep: Array<boolean>(DICE_COUNT).fill(false) }, label: "roll the dice" }];
    const scorecard = state.scorecards[seat];
    const rolls: Choice[] =
      state.rollsLeft > 0 ? keepPatterns(state.dice).map((keep) => ({ move: { kind: "roll", keep }, label: keepLabel(state.dice, keep) })) : [];
    const scores: Choice[] = openCategories(state.dice, scorecard).map((category) => ({
      move: { kind: "score", category },
      label: scoreLabel(pointsFor(state.dice, category, scorecard), category),
    }));
    return [...rolls, ...scores];
  },

  simpleStrategy(view, seat, choices) {
    const wanted = greedyMove(view, seat);
    return choices.find((choice) => sameMove(choice.move, wanted)) ?? choices[0];
  },
};
