// Adds the travel-data API to a Vite dev server (never to a production build), and keeps a save from
// triggering a page reload: the page already shows the edits, so reloading would only lose its place.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { handleTravelRequest } from "./travelApi.js";

const DATA_PATH = fileURLToPath(new URL("../data/travel.json", import.meta.url));
const BACKUP_DIR = fileURLToPath(new URL("../data/backups", import.meta.url));
const GEO_PATH = fileURLToPath(new URL("../data/geo.json", import.meta.url));
// This PC (also reached by its LAN address) and Rick's Mac. Override with TRAVEL_EDITORS="ip,ip".
const DEFAULT_EDITORS = ["127.0.0.1", "192.168.1.148", "192.168.1.198"];
const IGNORE_RELOAD_MS = 3000;

export function travelEditApi(): Plugin {
  const editors = process.env.TRAVEL_EDITORS?.split(",").map((ip) => ip.trim()).filter(Boolean) ?? DEFAULT_EDITORS;
  const geo = JSON.parse(readFileSync(GEO_PATH, "utf8"));
  const knownIds = new Set<string>([...geo.countries, ...geo.states].map((feature: { id: string }) => feature.id));
  let lastSave = 0;
  return {
    name: "travel-edit-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? "").split("?")[0];
        if (!path.startsWith("/api/travel")) return next();
        let body = "";
        request.on("data", (chunk: Buffer) => (body += chunk));
        request.on("end", () => {
          const result = handleTravelRequest(
            { method: request.method ?? "GET", path, remoteAddress: request.socket.remoteAddress, body },
            { dataPath: DATA_PATH, backupDir: BACKUP_DIR, editors, knownIds },
          );
          if (request.method === "PUT" && result.status === 200) lastSave = Date.now();
          response.statusCode = result.status;
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify(result.body));
        });
      });
    },
    handleHotUpdate({ file }) {
      if (file === DATA_PATH && Date.now() - lastSave < IGNORE_RELOAD_MS) return [];
    },
  };
}
