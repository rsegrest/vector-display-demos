import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import arcadeGames from "./arcade-games.json";

// Where Vector OS finds the arcade games, for the Vite configs that build it.
//
// The games are not packages of this workspace: each is its own repository in
// vector-games, next to this one, built and checked on its own. Vector OS
// imports each one's src/embed.ts by the name @vector-games/<folder>, which
// these settings point at the folder (or at a stub if the folder is not there,
// so the site still starts and builds without vector-games). VECTOR_GAMES_DIR
// moves the folder.

const vectorOsRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(vectorOsRoot, "../..");
const missingCabinet = resolve(vectorOsRoot, "src/apps/arcade/missingCabinet.ts");

export const ARCADE_GAMES: readonly string[] = arcadeGames.games;
export const VECTOR_GAMES_DIR = resolve(process.env.VECTOR_GAMES_DIR ?? resolve(repositoryRoot, "../vector-games"));

export function arcadeGameDirectory(game: string): string {
  return resolve(VECTOR_GAMES_DIR, game);
}

export function hasArcadeGame(game: string): boolean {
  return existsSync(resolve(arcadeGameDirectory(game), "src/embed.ts"));
}

// To merge into a Vite (or Vitest) config.
export const arcadeGamesViteConfig = {
  resolve: {
    alias: ARCADE_GAMES.map((game) => {
      const embed = resolve(arcadeGameDirectory(game), "src/embed.ts");
      return { find: `@vector-games/${game}`, replacement: existsSync(embed) ? embed : missingCabinet };
    }),
    // The games bring their own copies of the vector-display packages; one copy is used, this
    // workspace's, so the display lists they draw into are the very ones the OS hands them.
    dedupe: ["@vector-display/core", "@vector-display/font", "@vector-display/3d", "@vector-display/beam-fx", "@vector-display/webgl"],
  },
  // The dev server may serve the games' source, which lies outside this workspace.
  server: { fs: { allow: [repositoryRoot, VECTOR_GAMES_DIR] } },
};

