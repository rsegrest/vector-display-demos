import type { BeamColor } from "@vector-display/core";
import type { Outcome, Seat } from "@vector-demos/table-games";
import type { Rect, Ui } from "../Ui.js";

// Everything a game's board is given to draw itself for one frame, and to turn clicks into moves.
// A board draws only inside `area`, with `ui` (lines in batches, text in Hershey Sans on the plain
// text layer, buttons and clickable regions), and tells the game what was clicked through `send`.
export interface BoardContext {
  readonly ui: Ui;
  readonly area: Rect;
  // The game's view for this window's seat (or a watcher's), as the game's viewFor made it.
  readonly view: unknown;
  // The seat this window plays, or null for someone watching. In practice on one screen, the
  // seat now to move.
  readonly mySeat: Seat | null;
  readonly toMove: readonly Seat[];
  readonly names: readonly string[];
  readonly outcome: Outcome | null;
  // Sends a move; the game's rules decide whether it stands.
  send(move: unknown): void;
  // The board's own state between frames (a piece picked up, dice chosen to keep, a word being
  // traced): what the room never hears about. Emptied when a new game starts.
  readonly local: Record<string, unknown>;
  // Seconds since the window opened, for animation.
  readonly seconds: number;
}

export type BoardDrawer = (context: BoardContext) => void;

// Whether it is this window's turn to move.
export function isMyMove(context: BoardContext): boolean {
  return context.mySeat !== null && context.toMove.includes(context.mySeat);
}

// The colors the boards share, so every game in the window looks of a piece.
export const BOARD_COLORS = {
  text: { red: 0.6, green: 0.85, blue: 1 },
  dim: { red: 0.45, green: 0.6, blue: 0.8 },
  bright: { red: 0.9, green: 1, blue: 0.95 },
  accent: { red: 1, green: 0.8, blue: 0.35 },
  warn: { red: 1, green: 0.55, blue: 0.4 },
  grid: { red: 0.35, green: 0.6, blue: 1 },
  // A color for each seat, in seat order.
  seats: [
    { red: 1, green: 0.35, blue: 0.3 },
    { red: 1, green: 0.9, blue: 0.3 },
    { red: 0.4, green: 1, blue: 0.55 },
    { red: 0.75, green: 0.5, blue: 1 },
    { red: 0.3, green: 0.85, blue: 1 },
    { red: 1, green: 0.55, blue: 0.85 },
  ],
} satisfies Record<string, BeamColor | readonly BeamColor[]>;
