import type { BeamSettingsStore, Demo } from "@vector-demos/demo-kit";

// "move" is the pointer moving with the button held, "hover" without.
export type PointerKind = "down" | "move" | "up" | "hover";

// A program that runs in a window. At heart it is just a Demo, the same interface
// every demo on the site already has: something that can be updated and can draw
// itself into a display list. That is the whole trick of the OS: anything that can
// run full screen can run in a window, because neither knows the difference.
export interface OsApp {
  readonly demo: Demo;
  // The height of the space the program draws in. The demos were written for a
  // screen 1000 (or 640) units tall and are shrunk to fit; programs written for the
  // OS use null, meaning one unit per screen unit, so their text stays a fixed size.
  readonly worldHeight: number | null;
  // Brightness of the window's contents: a shrunken demo packs its lines closer, so it is turned down a little.
  readonly brightness?: number;
  // Keys typed while the window is in front.
  onKey?(key: string): void;
  // The pointer over the window's contents, in the program's own coordinates.
  onPointer?(kind: PointerKind, x: number, y: number, shiftKey: boolean): void;
  // Called when the window closes, for programs with something to stop.
  dispose?(): void;
}

export type AppCategory = "utilities" | "creative" | "simulation" | "alife" | "arcade";

// The launcher's groups, in the order it lists them. A group with no programs is left out.
export const APP_CATEGORIES: readonly { readonly id: AppCategory; readonly title: string }[] = [
  { id: "utilities", title: "Utilities" },
  { id: "creative", title: "Creative" },
  { id: "simulation", title: "Simulation" },
  { id: "alife", title: "Artificial Life" },
  { id: "arcade", title: "Arcade" },
];

export interface AppEntry {
  // The name typed at the terminal, and for demos the path of their own page.
  readonly id: string;
  readonly title: string;
  readonly kind: "demo" | "tool";
  // The group the launcher lists it under.
  readonly category: AppCategory;
  readonly size: { readonly width: number; readonly height: number };
  // Demos are loaded only when first launched.
  readonly create: (services: OsServices) => Promise<OsApp> | OsApp;
}

// What the OS offers its programs: the terminal and control panel work through this.
export interface OsServices {
  readonly beam: BeamSettingsStore;
  readonly entries: readonly AppEntry[];
  // Opens a program by its id; false if there is no such program.
  launch(id: string): boolean;
  // Titles of the windows now open, back to front.
  openWindows(): string[];
  // Closes windows whose title or id matches, or all of them for "ALL". Returns how many.
  close(name: string): number;
  reboot(): void;
  now(): Date;
}
