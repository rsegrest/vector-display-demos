// The dev server's travel-data API: read the data, ask whether this machine may edit, and save.
// Only machines on the editor list (by IP address) may save; the firewall already limits the dev
// server to the home network. Saves are validated, the previous file is backed up, and the new file
// is written atomically (temp file + rename) so a failed save cannot leave it half-written.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateTravelData } from "../data/travelData.js";

export interface TravelApiOptions {
  readonly dataPath: string;
  readonly backupDir: string;
  // IP addresses allowed to save. Loopback (this machine) is 127.0.0.1.
  readonly editors: readonly string[];
  readonly knownIds: ReadonlySet<string>;
  readonly maxBackups?: number;
  readonly now?: () => Date;
}

export interface TravelRequest {
  readonly method: string;
  readonly path: string;
  readonly remoteAddress: string | undefined;
  readonly body?: string;
}

export interface TravelResponse {
  readonly status: number;
  readonly body: unknown;
}

export function isEditor(remoteAddress: string | undefined, editors: readonly string[]): boolean {
  if (!remoteAddress) return false;
  const address = remoteAddress.replace(/^::ffff:/, "");
  const normalized = address === "::1" ? "127.0.0.1" : address;
  return editors.includes(normalized);
}

export function handleTravelRequest(request: TravelRequest, options: TravelApiOptions): TravelResponse {
  const canEdit = isEditor(request.remoteAddress, options.editors);
  if (request.method === "GET" && request.path === "/api/travel/editor") {
    return { status: 200, body: { canEdit, address: request.remoteAddress ?? null } };
  }
  if (request.method === "GET" && request.path === "/api/travel") {
    return { status: 200, body: JSON.parse(readFileSync(options.dataPath, "utf8")) };
  }
  if (request.method === "PUT" && request.path === "/api/travel") {
    if (!canEdit) return { status: 403, body: { problems: ["This machine is not allowed to edit the travel data."] } };
    let data: unknown;
    try {
      data = JSON.parse(request.body ?? "");
    } catch {
      return { status: 400, body: { problems: ["The request was not valid JSON."] } };
    }
    const problems = validateTravelData(data, options.knownIds);
    if (problems.length) return { status: 400, body: { problems } };
    backUp(options);
    const temporaryPath = `${options.dataPath}.saving`;
    writeFileSync(temporaryPath, JSON.stringify(data, null, 2) + "\n");
    renameSync(temporaryPath, options.dataPath);
    return { status: 200, body: { ok: true } };
  }
  return { status: 404, body: { problems: ["Not found."] } };
}

function backUp(options: TravelApiOptions): void {
  if (!existsSync(options.dataPath)) return;
  mkdirSync(options.backupDir, { recursive: true });
  const stamp = (options.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-");
  writeFileSync(join(options.backupDir, `travel-${stamp}.json`), readFileSync(options.dataPath));
  const backups = readdirSync(options.backupDir).filter((name) => name.startsWith("travel-")).sort();
  const excess = backups.length - (options.maxBackups ?? 30);
  for (const name of backups.slice(0, Math.max(0, excess))) unlinkSync(join(options.backupDir, name));
}
