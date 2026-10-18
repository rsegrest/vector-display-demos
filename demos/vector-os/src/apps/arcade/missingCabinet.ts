import type { ArcadeCabinet } from "./ArcadeCabinet.js";

// Used in place of a game's src/embed.ts when its repository in vector-games is
// not present next to this workspace, so the site still starts and builds, and
// opening the window reports that the game could not load.
export function createCabinet(): ArcadeCabinet {
  throw new Error("Arcade game source is not installed in ../vector-games");
}
