import type { Seat } from "./TableGame.js";

// What the card, dice and casino games share: cards, shuffling with the game's own random
// source (so a game is repeatable in tests), dice, and chips.

export type Suit = "spades" | "hearts" | "diamonds" | "clubs";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";

export interface Card {
  readonly suit: Suit;
  readonly rank: Rank;
}

export const SUITS: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];
export const RANKS: readonly Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

// A card's short name for people and for computer players: "Q of hearts".
export function cardName(card: Card): string {
  const names: Partial<Record<Rank, string>> = { A: "ace", J: "jack", Q: "queen", K: "king" };
  return `${names[card.rank] ?? card.rank} of ${card.suit}`;
}

export function freshDeck(decks = 1): Card[] {
  return Array.from({ length: decks }, () => SUITS.flatMap((suit) => RANKS.map((rank) => ({ suit, rank })))).flat();
}

// Fisher-Yates, with the game's random source.
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function rollDie(random: () => number, sides = 6): number {
  return Math.floor(random() * sides) + 1;
}

// Every player at a casino table starts with this many chips. Chips exist only at the table:
// nothing is bought, kept or paid out.
export const STARTING_CHIPS = 1000;

// The bets a computer player (or a quick button) offers, from a stack of chips.
export function betSizes(chips: number, minimum: number, maximum: number): number[] {
  const sizes = [minimum, 25, 50, 100, 250].filter((size) => size >= minimum && size <= maximum && size <= chips);
  return [...new Set(sizes)];
}

export function chipsOutcome(chips: readonly number[]): { winners: Seat[]; summary: string } {
  const best = Math.max(...chips);
  const winners = chips.flatMap((count, seat) => (count === best ? [seat] : []));
  return { winners, summary: `Most chips: ${best}` };
}
