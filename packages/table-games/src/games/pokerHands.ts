import type { Card, Rank } from "../casino.js";

// Poker hands: the best five of any number of cards, as a category and a list of numbers that
// compare from left to right (the category first, then the ranks that break ties), so two hands
// are compared by their scores alone. Aces are high, and also low in the five-high straight
// (the "wheel", A-2-3-4-5).

export type HandCategory =
  | "high card"
  | "pair"
  | "two pair"
  | "three of a kind"
  | "straight"
  | "flush"
  | "full house"
  | "four of a kind"
  | "straight flush";

// In order, worst first: a category's place in this list is the first number of its score.
export const HAND_CATEGORIES: readonly HandCategory[] = [
  "high card",
  "pair",
  "two pair",
  "three of a kind",
  "straight",
  "flush",
  "full house",
  "four of a kind",
  "straight flush",
];

export interface HandValue {
  readonly category: HandCategory;
  // [category index, then tie-breaking ranks from most to least important], ranks 2..14.
  readonly score: readonly number[];
  // The five cards that make the hand.
  readonly cards: readonly Card[];
  // For people: "full house, kings over sevens".
  readonly name: string;
}

export const RANK_VALUES: Readonly<Record<Rank, number>> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, J: 11, Q: 12, K: 13, A: 14,
};

const RANK_NAMES: Readonly<Record<number, string>> = {
  2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten", 11: "jack", 12: "queen", 13: "king", 14: "ace",
};

function plural(rank: number): string {
  return rank === 6 ? "sixes" : `${RANK_NAMES[rank]}s`;
}

// Below zero when `a` is the worse hand, above when the better, zero when they tie.
export function compareScores(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

// The high card of a straight among these ranks (5 for the wheel), or 0 if there is none.
function straightHigh(distinctRanksHighFirst: readonly number[]): number {
  const ranks = distinctRanksHighFirst.includes(14) ? [...distinctRanksHighFirst, 1] : distinctRanksHighFirst;
  for (let start = 0; start + 4 < ranks.length; start++) {
    if (ranks[start] - ranks[start + 4] === 4) return ranks[start];
  }
  return 0;
}

// Exactly five cards.
function valueOfFive(cards: readonly Card[]): HandValue {
  const ranks = cards.map((card) => RANK_VALUES[card.rank]).sort((a, b) => b - a);
  const isFlush = cards.every((card) => card.suit === cards[0].suit);
  const distinct = [...new Set(ranks)];
  const high = distinct.length === 5 ? straightHigh(distinct) : 0;
  // Ranks grouped by how many of each, the larger groups first, then the higher rank.
  const counts = distinct.map((rank) => ({ rank, count: ranks.filter((each) => each === rank).length })).sort((a, b) => b.count - a.count || b.rank - a.rank);
  const grouped = counts.map((group) => group.rank);
  const shape = counts.map((group) => group.count).join("");
  const make = (category: HandCategory, tieBreakers: readonly number[], name: string): HandValue => ({
    category,
    score: [HAND_CATEGORIES.indexOf(category), ...tieBreakers],
    cards,
    name,
  });
  if (high && isFlush) return make("straight flush", [high], high === 14 ? "royal flush" : `straight flush, ${RANK_NAMES[high]} high`);
  if (shape === "41") return make("four of a kind", grouped, `four ${plural(grouped[0])}`);
  if (shape === "32") return make("full house", grouped, `full house, ${plural(grouped[0])} over ${plural(grouped[1])}`);
  if (isFlush) return make("flush", ranks, `flush, ${RANK_NAMES[ranks[0]]} high`);
  if (high) return make("straight", [high], `straight, ${RANK_NAMES[high]} high`);
  if (shape === "311") return make("three of a kind", grouped, `three ${plural(grouped[0])}`);
  if (shape === "221") return make("two pair", grouped, `two pair, ${plural(grouped[0])} and ${plural(grouped[1])}`);
  if (shape === "2111") return make("pair", grouped, `pair of ${plural(grouped[0])}`);
  return make("high card", ranks, `${RANK_NAMES[ranks[0]]} high`);
}

// Every way to choose `size` of `items`, in order.
function combinations<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [first, ...rest] = items;
  return [...combinations(rest, size - 1).map((chosen) => [first, ...chosen]), ...combinations(rest, size)];
}

// The best hand from five to seven cards (hold'em: two hole cards and up to five on the board).
// With fewer than five, the cards are valued as they are (pairs and high cards), which is
// what a computer player needs before the flop.
export function bestHand(cards: readonly Card[]): HandValue {
  if (cards.length < 5) {
    const ranks = cards.map((card) => RANK_VALUES[card.rank]).sort((a, b) => b - a);
    const isPair = ranks.length >= 2 && new Set(ranks).size < ranks.length;
    const pairRank = isPair ? ranks.find((rank, index) => ranks.indexOf(rank) !== index)! : 0;
    return isPair
      ? { category: "pair", score: [1, pairRank, ...ranks.filter((rank) => rank !== pairRank)], cards, name: `pair of ${plural(pairRank)}` }
      : { category: "high card", score: [0, ...ranks], cards, name: ranks.length ? `${RANK_NAMES[ranks[0]]} high` : "no cards" };
  }
  let best: HandValue | null = null;
  for (const five of combinations(cards, 5)) {
    const value = valueOfFive(five);
    if (!best || compareScores(value.score, best.score) > 0) best = value;
  }
  return best!;
}
