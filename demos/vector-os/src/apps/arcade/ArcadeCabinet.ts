import type { DisplayList } from "@vector-display/core";
import type { KeyPress } from "../OsApp.js";

// A game from vector-games, as its src/embed.ts offers it: the game without its
// page. Each game declares this same shape for itself, so neither side imports
// the other's types and each still builds on its own; the shape is the contract.
//
// The game owns its machine, its input adapter and its sound. The OS owns the
// clock (it decides how many of the game's steps to run), the keyboard (it passes
// on keys only while the game's window is in front), and the screen (it draws
// the game's picture into the window).
export interface ArcadeCabinet {
  // The picture's coordinates, and the shape of the screen it is shown on (width / height),
  // which is not always the shape of the coordinates: Tempest's tube is taller than its units are.
  readonly screen: { readonly width: number; readonly height: number; readonly aspect: number };
  // The game's own fixed step, and the most steps its page makes up after a stall.
  readonly stepsPerSecond: number;
  readonly mostStepsAtOnce: number;
  // The keys, in a line, for the OS to show under the picture.
  readonly controls: string;
  // Returns whether the game uses the key.
  keyDown(key: KeyPress): boolean;
  keyUp(key: KeyPress): void;
  // Sideways mouse movement and the mouse buttons, for a game with a spinner (Tempest); the buttons also for Red Baron.
  mouseMove?(dx: number): void;
  mouseButton?(button: number, down: boolean): void;
  // Where the pointer is over the picture, for a game steered by it (Red Baron's flight stick):
  // x and y from 0 to 1 across the picture, or null when it has left the picture or the window.
  pointerAt?(point: { readonly x: number; readonly y: number } | null): void;
  // The picture in 3D, for a VR headset (a game whose program projects its own 3D: Tempest): line
  // ends as x, y, z with the eye at the origin looking down -z and the nearest drawing at 1, and
  // r, g, b, brightness per line; null when the game cannot say.
  picture3d?(): Picture3d | null;
  // For a game whose 3D is a choice (Asteroids: no depth of its own), the next of its styles; returns its name.
  cycle3dStyle?(): string;
  // Runs this many steps, then does what the page does once a display frame (sound, saving scores).
  advance(steps: number): void;
  draw(displayList: DisplayList): void;
  // Starts sound; called from a key press or click, as browsers require.
  enableSound(): void;
  setAudible(audible: boolean): void;
  dispose(): void;
}

export interface Picture3d {
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  /** How much the headset squeezes the picture's width and height (default 0.25, Tempest's). */
  readonly spread?: number;
  /** How far below the viewer's eye the picture's eye goes, in meters (default 0.3, Tempest's). */
  readonly drop?: number;
  /** Something for the room to draw behind the picture: "space" (stars, a nebula, a solar system; vr/backdrop.ts). */
  readonly backdrop?: "space";
  /**
   * Where the flat picture lies on the distance-1 plane (x right, y up, in these positions' units), for a
   * game steered by the pointer (pointerAt): the headset's ray aims at that plane as a mouse at the flat picture.
   */
  readonly flatFrame?: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };
}

export interface ArcadeModule {
  createCabinet(): ArcadeCabinet;
}
