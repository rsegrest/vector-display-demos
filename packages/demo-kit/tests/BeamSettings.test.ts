import { describe, expect, it } from "vitest";
import { BEAM_SETTINGS_STORAGE_KEY, BEAM_SETTING_RANGES, BeamSettingsStore, DEFAULT_BEAM_SETTINGS, type SettingsStorage } from "../src/BeamSettings.js";

function memoryStorage(initial: Record<string, string> = {}): SettingsStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

describe("BeamSettingsStore", () => {
  it("starts from the defaults when nothing is saved", () => {
    expect(new BeamSettingsStore(memoryStorage()).current).toEqual(DEFAULT_BEAM_SETTINGS);
    expect(new BeamSettingsStore().current).toEqual(DEFAULT_BEAM_SETTINGS);
  });

  it("saves every change and finds it again", () => {
    const storage = memoryStorage();
    new BeamSettingsStore(storage).set({ beamWidth: 2.5, bloomStrength: 1 });
    const reopened = new BeamSettingsStore(storage);
    expect(reopened.current.beamWidth).toBe(2.5);
    expect(reopened.current.bloomStrength).toBe(1);
    expect(reopened.current.exposure).toBe(DEFAULT_BEAM_SETTINGS.exposure);
  });

  it("keeps every setting within its range", () => {
    const store = new BeamSettingsStore(memoryStorage());
    store.set({ beamWidth: 99, flickerAmount: 1, glowRadius: -5 });
    expect(store.current.beamWidth).toBe(4);
    expect(store.current.flickerAmount).toBe(0.15);
    expect(store.current.glowRadius).toBe(0);
  });

  it("tells listeners at once and on each change, until they leave", () => {
    const store = new BeamSettingsStore(memoryStorage());
    const seen: number[] = [];
    const leave = store.subscribe((settings) => seen.push(settings.exposure));
    store.set({ exposure: 2 });
    leave();
    store.set({ exposure: 2.5 });
    expect(seen).toEqual([DEFAULT_BEAM_SETTINGS.exposure, 2]);
  });

  it("goes back to the defaults on reset", () => {
    const store = new BeamSettingsStore(memoryStorage());
    store.set({ exposure: 2, beamWidth: 3 });
    store.reset();
    expect(store.current).toEqual(DEFAULT_BEAM_SETTINGS);
  });

  it("ignores saved values that are damaged, out of range or not numbers", () => {
    expect(new BeamSettingsStore(memoryStorage({ [BEAM_SETTINGS_STORAGE_KEY]: "not json" })).current).toEqual(DEFAULT_BEAM_SETTINGS);
    const partial = new BeamSettingsStore(
      memoryStorage({ [BEAM_SETTINGS_STORAGE_KEY]: JSON.stringify({ beamWidth: "wide", exposure: 2, flickerAmount: 9, extra: 1 }) }),
    );
    expect(partial.current.beamWidth).toBe(DEFAULT_BEAM_SETTINGS.beamWidth);
    expect(partial.current.exposure).toBe(2);
    expect(partial.current.flickerAmount).toBe(0.15);
    expect(Object.keys(partial.current).sort()).toEqual(Object.keys(DEFAULT_BEAM_SETTINGS).sort());
  });

  it("carries on when storage refuses to save", () => {
    const store = new BeamSettingsStore({
      getItem: () => null,
      setItem: () => {
        throw new Error("full");
      },
    });
    store.set({ exposure: 2 });
    expect(store.current.exposure).toBe(2);
  });

  it("describes a range for every setting, with the default inside it", () => {
    expect(BEAM_SETTING_RANGES.map((range) => range.key).sort()).toEqual(Object.keys(DEFAULT_BEAM_SETTINGS).sort());
    for (const range of BEAM_SETTING_RANGES) {
      expect(DEFAULT_BEAM_SETTINGS[range.key]).toBeGreaterThanOrEqual(range.minimum);
      expect(DEFAULT_BEAM_SETTINGS[range.key]).toBeLessThanOrEqual(range.maximum);
    }
  });
});
