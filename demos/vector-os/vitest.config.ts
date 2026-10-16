import { defineConfig } from "vitest/config";
import { arcadeGamesViteConfig } from "./arcadeGames.js";

export default defineConfig({
  resolve: arcadeGamesViteConfig.resolve,
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
