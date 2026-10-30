import type { GameId } from "@vector-demos/table-games";
import type { BoardDrawer } from "./BoardContext.js";
import { drawBaccarat } from "./baccaratBoard.js";
import { drawBlackjack } from "./blackjackBoard.js";
import { drawBoggle } from "./boggleBoard.js";
import { drawChess } from "./chessBoard.js";
import { drawBattleship, drawCheckers, drawConnectFour } from "./classicBoards.js";
import { drawCraps } from "./crapsBoard.js";
import { drawKeno } from "./kenoBoard.js";
import { drawPachinko } from "./pachinkoBoard.js";
import { drawPoker } from "./pokerBoard.js";
import { drawRoulette } from "./rouletteBoard.js";
import { drawSlots } from "./slotsBoard.js";
import { drawTicTacToe } from "./ticTacToeBoard.js";
import { drawYahtzee } from "./yahtzeeBoard.js";

// Each game's board, by game.
export const BOARDS: Partial<Record<GameId, BoardDrawer>> = {
  connect4: drawConnectFour,
  checkers: drawCheckers,
  battleship: drawBattleship,
  tictactoe: drawTicTacToe,
  chess: drawChess,
  yahtzee: drawYahtzee,
  boggle: drawBoggle,
  poker: drawPoker,
  blackjack: drawBlackjack,
  baccarat: drawBaccarat,
  roulette: drawRoulette,
  craps: drawCraps,
  keno: drawKeno,
  slots: drawSlots,
  pachinko: drawPachinko,
};
