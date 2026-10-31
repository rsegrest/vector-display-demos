/// <reference types="vitest" />
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig, type Plugin } from "vitest/config";
import { DEMO_CATALOG } from "./src/catalog.js";
import { travelEditApi } from "../demos/travel-globe/src/server/vitePlugin.js";
import { ARCADE_GAMES, arcadeGamesViteConfig } from "../demos/vector-os/arcadeGames.js";

// Pages that belong to a demo rather than being one: explainers in the Live Guide's style.
const EXTRA_PAGES: readonly { readonly name: string; readonly path: string }[] = [{ name: "epicycles-how-it-works", path: "epicycles/how-it-works" }];

// /particle-life → /particle-life/, so routes work with or without the trailing slash.
// The games' own pages, under /arcade/, are routes too.
function addTrailingSlash(): Plugin {
  const routes = new Set([...DEMO_CATALOG.map((demo) => `/${demo.path}`), ...EXTRA_PAGES.map((page) => `/${page.path}`), ...ARCADE_GAMES.map((game) => `/arcade/${game}`)]);
  return {
    name: "add-trailing-slash",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const [path, query] = (request.url ?? "").split("?");
        if (!routes.has(path)) return next();
        response.statusCode = 301;
        response.setHeader("Location", `${path}/${query ? `?${query}` : ""}`);
        response.end();
      });
    },
  };
}

// The games' own pages are built into public/arcade/<game>/ (tools/build-arcade.mjs). The dev
// server serves public files only by their full name, so /arcade/<game>/ is given its index.html.
function serveArcadePages(): Plugin {
  const pages = new Set(ARCADE_GAMES.map((game) => `/arcade/${game}/`));
  return {
    name: "serve-arcade-pages",
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const [path, query] = (request.url ?? "").split("?");
        if (pages.has(path)) request.url = `${path}index.html${query ? `?${query}` : ""}`;
        next();
      });
    },
  };
}

// Star Wars runs its board in a worker that sleeps between interrupts (SharedArrayBuffer,
// Atomics.wait), which a page may do only when cross-origin isolated. Vector OS (/os/, /vr/) and
// Star Wars' own page get the two headers; COEP "credentialless" still lets the OS's other programs
// load from other sites (live-earth's CORS feeds). Scripts and workers get them everywhere, which
// changes nothing for the pages that load them. Other pages are left as they were.
const ISOLATED_PAGES = ["/os/", "/vr/", "/arcade/starwars/"];
function crossOriginIsolation(): Plugin {
  const isolate = (request: { url?: string; headers: Record<string, string | string[] | undefined> }, response: { setHeader(name: string, value: string): void }): void => {
    const path = (request.url ?? "").split("?")[0];
    const document = request.headers["sec-fetch-dest"] === "document" || request.headers["sec-fetch-dest"] === "iframe";
    if (document && !ISOLATED_PAGES.some((page) => path.startsWith(page))) return;
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
  };
  return {
    name: "cross-origin-isolation",
    configureServer(server) { server.middlewares.use((request, response, next) => { isolate(request, response); next(); }); },
    configurePreviewServer(server) { server.middlewares.use((request, response, next) => { isolate(request, response); next(); }); },
  };
}

const siteRoot = dirname(fileURLToPath(import.meta.url));
// HTTPS=1 (npm run dev:https) serves over https with a self-signed certificate: WebXR runs only on
// secure pages, so the Quest's browser can open /vr/ from this PC only this way (or over adb reverse).
const https = process.env.HTTPS === "1";

export default defineConfig({
  base: "./",
  appType: "mpa",
  // travelEditApi only runs in the dev server: it lets this PC and Rick's Mac edit the travel globe's data.
  plugins: [crossOriginIsolation(), addTrailingSlash(), serveArcadePages(), travelEditApi(), ...(https ? [basicSsl()] : [])],
  // Vector OS runs the arcade games from vector-games, next to this repository.
  resolve: arcadeGamesViteConfig.resolve,
  // Star Wars' board worker imports modules.
  worker: { format: "es" },
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(siteRoot, "index.html"),
        ...Object.fromEntries(DEMO_CATALOG.map((demo) => [demo.path, resolve(siteRoot, demo.path, "index.html")])),
        ...Object.fromEntries(EXTRA_PAGES.map((page) => [page.name, resolve(siteRoot, page.path, "index.html")])),
      },
    },
  },
  // With HTTPS (the headset), files are polled for changes: the native watcher stopped seeing edits
  // during the VR sessions of 2026-10-18/19 and the Quest ran stale code without anyone knowing.
  server: { host: "0.0.0.0", port: 5180, strictPort: true, fs: arcadeGamesViteConfig.server.fs, ...(https ? { watch: { usePolling: true, interval: 500 } } : {}) },
  preview: { host: "0.0.0.0", port: 5180, strictPort: true },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
