/// <reference types="vitest" />
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";
import { DEMO_CATALOG } from "./src/catalog.js";
import { travelEditApi } from "../demos/travel-globe/src/server/vitePlugin.js";

// /particle-life → /particle-life/, so routes work with or without the trailing slash.
function addTrailingSlash(): Plugin {
  const routes = new Set(DEMO_CATALOG.map((demo) => `/${demo.path}`));
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

const siteRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  appType: "mpa",
  // travelEditApi only runs in the dev server: it lets this PC and Rick's Mac edit the travel globe's data.
  plugins: [addTrailingSlash(), travelEditApi()],
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(siteRoot, "index.html"),
        ...Object.fromEntries(DEMO_CATALOG.map((demo) => [demo.path, resolve(siteRoot, demo.path, "index.html")])),
      },
    },
  },
  server: { host: "0.0.0.0", port: 5180, strictPort: true },
  preview: { host: "0.0.0.0", port: 5180, strictPort: true },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
