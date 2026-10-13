import { defineConfig } from "vite";

// Served from the portfolio site's public/demos/travel-globe/ and reached through a rewrite from
// /globe, so asset URLs must be absolute: relative ones would resolve against /globe instead.
export default defineConfig({
  root: new URL(".", import.meta.url).pathname,
  base: "/demos/travel-globe/",
  build: { target: "es2022", outDir: "../dist-standalone", emptyOutDir: true },
});
