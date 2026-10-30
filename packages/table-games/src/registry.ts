import { baccarat } from "./games/baccarat.js";
import { battleship } from "./games/battleship.js";
import { blackjack } from "./games/blackjack.js";
import { boggle } from "./games/boggle.js";
import { checkers } from "./games/checkers.js";
import { chess } from "./games/chess.js";
import { connectFour } from "./games/connectFour.js";
import { craps } from "./games/craps.js";
import { keno } from "./games/keno.js";
import { pachinko } from "./games/pachinko.js";
import { poker } from "./games/poker.js";
import { roulette } from "./games/roulette.js";
import { slots } from "./games/slots.js";
import { ticTacToe } from "./games/ticTacToe.js";
import { yahtzee } from "./games/yahtzee.js";
import type { GameId, TableGame } from "./TableGame.js";

// Each game's state is its own type; the room only stores it and hands it back.
export type AnyTableGame = TableGame<any, unknown>;

// The games that can be played, in the order the window lists them.
const GAMES: readonly AnyTableGame[] = [
  ticTacToe,
  connectFour,
  checkers,
  chess,
  battleship,
  yahtzee,
  boggle,
  poker,
  blackjack,
  baccarat,
  roulette,
  craps,
  keno,
  slots,
  pachinko,
];

export const TABLE_GAMES: ReadonlyMap<GameId, AnyTableGame> = new Map(GAMES.map((game) => [game.id, game]));

export const AVAILABLE_GAMES: readonly GameId[] = GAMES.map((game) => game.id);

export function hasRules(game: GameId): boolean {
  return TABLE_GAMES.has(game);
}

export function rulesFor(game: GameId): AnyTableGame {
  const rules = TABLE_GAMES.get(game);
  if (!rules) throw new Error(`No rules for ${game}`);
  return rules;
}
