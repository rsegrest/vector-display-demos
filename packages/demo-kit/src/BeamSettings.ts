// The look of the beam, as one set of numbers a visitor can adjust and that is
// remembered between visits and between pages. Sizes are in CSS pixels.

export interface BeamSettings {
  // Width of the line itself.
  readonly beamWidth: number;
  // How far the soft halo round each line reaches, and how bright it is.
  readonly glowRadius: number;
  readonly glowStrength: number;
  // How long a line takes to fade to half brightness after the beam has moved on.
  readonly persistenceHalfLifeMilliseconds: number;
  // The wide glow that bright lines throw.
  readonly bloomStrength: number;
  readonly exposure: number;
  // Depth of the random brightness flutter, 0 (none) to 1.
  readonly flickerAmount: number;
}

export interface BeamSettingRange {
  readonly key: keyof BeamSettings;
  readonly label: string;
  readonly minimum: number;
  readonly maximum: number;
  readonly step: number;
  readonly unit: string;
}

export const DEFAULT_BEAM_SETTINGS: BeamSettings = {
  beamWidth: 1.4,
  glowRadius: 2.8,
  glowStrength: 0.18,
  persistenceHalfLifeMilliseconds: 80,
  bloomStrength: 0.6,
  exposure: 1.35,
  flickerAmount: 0.02,
};

// What each setting may be set to. Flicker stops well short of its full range:
// strong full-screen flicker can trigger photosensitive seizures.
export const BEAM_SETTING_RANGES: readonly BeamSettingRange[] = [
  { key: "beamWidth", label: "Beam width", minimum: 0.5, maximum: 4, step: 0.1, unit: "px" },
  { key: "glowRadius", label: "Glow radius", minimum: 0, maximum: 10, step: 0.2, unit: "px" },
  { key: "glowStrength", label: "Glow strength", minimum: 0, maximum: 1, step: 0.02, unit: "" },
  { key: "persistenceHalfLifeMilliseconds", label: "Persistence", minimum: 0, maximum: 1500, step: 10, unit: "ms" },
  { key: "bloomStrength", label: "Bloom", minimum: 0, maximum: 2, step: 0.05, unit: "" },
  { key: "exposure", label: "Exposure", minimum: 0.5, maximum: 3, step: 0.05, unit: "" },
  { key: "flickerAmount", label: "Flicker", minimum: 0, maximum: 0.15, step: 0.01, unit: "" },
];

// Where the settings are kept. Tests and pages without storage supply their own.
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const BEAM_SETTINGS_STORAGE_KEY = "vector-demos:beam-settings";

type Listener = (settings: BeamSettings) => void;

// Holds the current settings, keeps them within range, saves every change, and
// tells whoever is listening. One store can drive any number of displays.
export class BeamSettingsStore {
  private settings: BeamSettings;
  private readonly listeners = new Set<Listener>();

  public constructor(private readonly storage: SettingsStorage | null = null) {
    this.settings = { ...DEFAULT_BEAM_SETTINGS, ...this.read() };
  }

  public get current(): BeamSettings {
    return this.settings;
  }

  public set(changes: Partial<BeamSettings>): void {
    this.settings = clampSettings({ ...this.settings, ...changes });
    this.save();
    for (const listener of this.listeners) listener(this.settings);
  }

  public reset(): void {
    this.set(DEFAULT_BEAM_SETTINGS);
  }

  // Calls `listener` now with the current settings and again on every change.
  // Returns a function that stops the calls.
  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.settings);
    return () => this.listeners.delete(listener);
  }

  // Whatever was saved, so long as it is a set of numbers; anything else is ignored.
  private read(): Partial<BeamSettings> {
    try {
      const saved = JSON.parse(this.storage?.getItem(BEAM_SETTINGS_STORAGE_KEY) ?? "null") as Record<string, unknown> | null;
      if (!saved || typeof saved !== "object") return {};
      const usable: Record<string, number> = {};
      for (const range of BEAM_SETTING_RANGES) {
        const value = saved[range.key];
        if (typeof value === "number" && Number.isFinite(value)) usable[range.key] = value;
      }
      return clampSettings({ ...DEFAULT_BEAM_SETTINGS, ...usable });
    } catch {
      return {};
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(BEAM_SETTINGS_STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Storage full or blocked: the settings still apply, they are just not remembered.
    }
  }
}

function clampSettings(settings: BeamSettings): BeamSettings {
  const clamped: Record<string, number> = {};
  for (const range of BEAM_SETTING_RANGES) clamped[range.key] = Math.max(range.minimum, Math.min(range.maximum, settings[range.key]));
  return clamped as unknown as BeamSettings;
}

// The browser's own storage, or null where it is unavailable (private windows, blocked site data).
export function browserSettingsStorage(): SettingsStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
