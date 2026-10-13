import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { handleTravelRequest, isEditor } from "../src/server/travelApi.js";
import travel from "../src/data/travel.json";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "travel-api-"));
  const dataPath = join(dir, "travel.json");
  writeFileSync(dataPath, JSON.stringify(travel, null, 2) + "\n");
  const options = { dataPath, backupDir: join(dir, "backups"), editors: ["127.0.0.1", "192.168.1.198"], knownIds: new Set(["FR", "US-AL", ...Object.keys(travel.places.countries), ...Object.keys(travel.places.states)]) };
  return { dir, dataPath, options };
}

describe("isEditor", () => {
  it("matches IPv4, IPv4-mapped IPv6 and loopback addresses", () => {
    expect(isEditor("192.168.1.198", ["192.168.1.198"])).toBe(true);
    expect(isEditor("::ffff:192.168.1.198", ["192.168.1.198"])).toBe(true);
    expect(isEditor("::1", ["127.0.0.1"])).toBe(true);
    expect(isEditor("192.168.1.50", ["192.168.1.198"])).toBe(false);
    expect(isEditor(undefined, ["127.0.0.1"])).toBe(false);
  });
});

describe("handleTravelRequest", () => {
  it("tells each machine whether it may edit", () => {
    const { options } = setup();
    expect(handleTravelRequest({ method: "GET", path: "/api/travel/editor", remoteAddress: "192.168.1.198" }, options).body).toMatchObject({ canEdit: true });
    expect(handleTravelRequest({ method: "GET", path: "/api/travel/editor", remoteAddress: "192.168.1.77" }, options).body).toMatchObject({ canEdit: false });
  });

  it("saves valid data from an editor, keeping a backup of the old file", () => {
    const { dir, dataPath, options } = setup();
    const edited = structuredClone(travel);
    edited.profile.title = "Edited";
    const response = handleTravelRequest({ method: "PUT", path: "/api/travel", remoteAddress: "127.0.0.1", body: JSON.stringify(edited) }, options);
    expect(response.status).toBe(200);
    expect(JSON.parse(readFileSync(dataPath, "utf8")).profile.title).toBe("Edited");
    const backups = readdirSync(join(dir, "backups"));
    expect(backups).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(dir, "backups", backups[0]), "utf8")).profile.title).toBe(travel.profile.title);
  });

  it("refuses saves from other machines and leaves the file alone", () => {
    const { dataPath, options } = setup();
    const before = readFileSync(dataPath, "utf8");
    const response = handleTravelRequest({ method: "PUT", path: "/api/travel", remoteAddress: "192.168.1.77", body: "{}" }, options);
    expect(response.status).toBe(403);
    expect(readFileSync(dataPath, "utf8")).toBe(before);
  });

  it("rejects invalid data with the list of problems", () => {
    const { dataPath, options } = setup();
    const before = readFileSync(dataPath, "utf8");
    const bad = { ...travel, places: { countries: { ZZ: { status: "visited" } }, states: {} } };
    const response = handleTravelRequest({ method: "PUT", path: "/api/travel", remoteAddress: "127.0.0.1", body: JSON.stringify(bad) }, options);
    expect(response.status).toBe(400);
    expect((response.body as { problems: string[] }).problems[0]).toContain("ZZ");
    expect(readFileSync(dataPath, "utf8")).toBe(before);
    expect(handleTravelRequest({ method: "PUT", path: "/api/travel", remoteAddress: "127.0.0.1", body: "not json" }, options).status).toBe(400);
  });

  it("keeps only the most recent backups", () => {
    const { dir, options } = setup();
    for (let i = 0; i < 35; i++) {
      handleTravelRequest({ method: "PUT", path: "/api/travel", remoteAddress: "127.0.0.1", body: JSON.stringify({ ...travel, version: 1 + (i % 2) }) }, { ...options, now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, i)) });
    }
    expect(readdirSync(join(dir, "backups")).length).toBe(30);
  });
});
