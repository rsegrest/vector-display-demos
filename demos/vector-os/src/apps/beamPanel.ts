import { SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList } from "@vector-display/core";
import { BEAM_SETTING_RANGES, DynamicGeometry, getDemoFont, type BeamSettingsStore, type Demo, type DemoFrame } from "@vector-demos/demo-kit";
import type { OsApp, OsServices, PointerKind } from "./OsApp.js";

const LABEL_COLOR: BeamColor = { red: 0.6, green: 0.85, blue: 1 };
const TRACK_COLOR: BeamColor = { red: 0.3, green: 0.5, blue: 0.75 };
const KNOB_COLOR: BeamColor = { red: 1, green: 0.85, blue: 0.4 };

export const ROW_HEIGHT = 36;
export const TOP_MARGIN = 18;
const LABEL_X = 16;
const TRACK_LEFT = 205;
const VALUE_WIDTH = 92;
const KNOB_HALF = 6;
const TEXT_SIZE = 13;

// Sliders for the beam, drawn by the beam. Dragging one changes the display it is
// drawn on, so this is the one program whose controls alter their own appearance.
export class BeamPanel implements Demo {
  private readonly tracks = new DynamicGeometry(32);
  private readonly knobs = new DynamicGeometry(64);
  private width = 420;
  // The slider being dragged, if any.
  private active: number | null = null;

  public constructor(private readonly store: BeamSettingsStore) {}

  public update(): void {}

  public draw(displayList: DisplayList, frame: DemoFrame): void {
    this.width = frame.width;
    const font = getDemoFont();
    const { left, right } = this.track();
    this.tracks.clear();
    this.knobs.clear();
    BEAM_SETTING_RANGES.forEach((range, row) => {
      const y = this.rowY(row);
      const value = this.store.current[range.key];
      const x = left + ((value - range.minimum) / (range.maximum - range.minimum)) * (right - left);
      this.tracks.addSegment(left, y, right, y);
      this.knobs.moveTo(x - KNOB_HALF, y - KNOB_HALF * 1.6);
      this.knobs.lineTo(x + KNOB_HALF, y - KNOB_HALF * 1.6);
      this.knobs.lineTo(x + KNOB_HALF, y + KNOB_HALF * 1.6);
      this.knobs.lineTo(x - KNOB_HALF, y + KNOB_HALF * 1.6);
      this.knobs.closePath();
      displayList.setColor(LABEL_COLOR);
      font.addText(displayList, { text: range.label.toUpperCase(), x: LABEL_X, y: y - TEXT_SIZE / 2, size: TEXT_SIZE, intensity: 0.85 });
      const places = range.step >= 1 ? 0 : range.step >= 0.1 ? 1 : 2;
      font.addText(displayList, { text: `${value.toFixed(places)}${range.unit ? ` ${range.unit.toUpperCase()}` : ""}`, x: frame.width - 14, y: y - TEXT_SIZE / 2, size: TEXT_SIZE, alignment: "right", intensity: 0.85 });
    });
    displayList.setColor(TRACK_COLOR);
    displayList.addShape(this.tracks, { ...SCREEN_SPACE_PLACEMENT, intensity: 0.7 });
    displayList.setColor(KNOB_COLOR);
    displayList.addShape(this.knobs, { ...SCREEN_SPACE_PLACEMENT, intensity: 1.1 });
    displayList.setColor(LABEL_COLOR);
    font.addText(displayList, { text: "RESET", x: LABEL_X, y: this.resetY(), size: TEXT_SIZE, intensity: 1 });
  }

  public pointer(kind: PointerKind, x: number, y: number): void {
    if (kind === "hover") return;
    if (kind === "up") {
      this.active = null;
      return;
    }
    if (kind === "down") {
      if (y >= this.resetY() - 8 && y <= this.resetY() + TEXT_SIZE + 8 && x < 120) {
        this.store.reset();
        return;
      }
      const row = Math.round((y - TOP_MARGIN - ROW_HEIGHT / 2) / ROW_HEIGHT);
      this.active = row >= 0 && row < BEAM_SETTING_RANGES.length && x >= this.track().left - 12 ? row : null;
    }
    if (this.active === null) return;
    const range = BEAM_SETTING_RANGES[this.active];
    const { left, right } = this.track();
    const amount = Math.max(0, Math.min(1, (x - left) / (right - left)));
    const raw = range.minimum + amount * (range.maximum - range.minimum);
    // Snap to the setting's own step, so values read as round numbers.
    this.store.set({ [range.key]: Math.round(raw / range.step) * range.step });
  }

  private track(): { left: number; right: number } {
    return { left: TRACK_LEFT, right: Math.max(TRACK_LEFT + 40, this.width - VALUE_WIDTH) };
  }

  private rowY(row: number): number {
    return TOP_MARGIN + ROW_HEIGHT / 2 + row * ROW_HEIGHT;
  }

  private resetY(): number {
    return TOP_MARGIN + BEAM_SETTING_RANGES.length * ROW_HEIGHT + 8;
  }
}

export function createBeamPanel(services: OsServices): OsApp {
  const panel = new BeamPanel(services.beam);
  return { demo: panel, worldHeight: null, onPointer: (kind, x, y) => panel.pointer(kind, x, y) };
}
