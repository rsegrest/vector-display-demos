#!/usr/bin/env node
// Builds each arcade game's own page into the site, at /arcade/<game>/.
//
//   npm run build:arcade
//
// Vector OS runs the games in windows; the box on a game's title bar opens the
// game's own page, which is the game's own build, unchanged: each game is built
// in its own folder in vector-games, with its own Vite and its own config, into
// site/public/arcade/<game>/. Vite serves that folder as it is on the dev server
// and copies it into site/dist when the site is built, so the pages are on the
// same site (and share its storage, so a score set in one place is in the
// other). `npm run build` runs this first. The games' list is
// demos/vector-os/arcade-games.json; VECTOR_GAMES_DIR moves their folder.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const { games } = JSON.parse(readFileSync(join(root, "demos/vector-os/arcade-games.json"), "utf8"));
const gamesDir = resolve(process.env.VECTOR_GAMES_DIR ?? join(root, "../vector-games"));
const outRoot = join(root, "site/public/arcade");

rmSync(outRoot, { recursive: true, force: true });
for (const game of games) {
  const gameDir = join(gamesDir, game);
  if (!existsSync(join(gameDir, "node_modules"))) {
    console.error(`${gameDir} is missing or has no node_modules: run npm install there first.`);
    process.exit(1);
  }
  const outDir = join(outRoot, game);
  console.log(`Building ${game} into ${outDir}`);
  // The game's own Vite, so it builds exactly as it does on its own (its config sets base "./").
  execFileSync("npx", ["vite", "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "warn"], { cwd: gameDir, stdio: "inherit" });
}
