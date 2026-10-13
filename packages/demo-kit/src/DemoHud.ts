import type { BeamColor, DisplayList } from "@vector-display/core";
import { getDemoFont } from "./font.js";

export interface DemoHudContent {
  readonly title: string;
  readonly statusLines: readonly string[];
  readonly helpLines: readonly string[];
  readonly width: number;
  readonly height: number;
  // Text and spacing are sized for a world 1000 units tall; pass worldHeight / 1000 for other worlds.
  readonly scale?: number;
}

export const HUD_MARGIN = 28;
export const HUD_TEXT_COLOR: BeamColor = { red: 0.75, green: 0.9, blue: 1 };

const IDLE_SECONDS = 10;
const FADE_SECONDS = 1.5;
const BANNER_SECONDS = 3;

// The standard demo overlay: title and status top left, key help bottom left, and a banner top center
// announcing changes. It fades out after a while without input, so a hands-off demo shows only the art.
// Draw it from Demo.drawOverlay so changing text does not leave phosphor trails.
export class DemoHud {
  private idleSeconds = 0;
  private pinned: boolean | null = null;
  private bannerText = "";
  private bannerSeconds = 0;

  public update(deltaSeconds: number): void {
    this.idleSeconds += deltaSeconds;
    this.bannerSeconds = Math.max(0, this.bannerSeconds - deltaSeconds);
  }

  public noteActivity(): void {
    this.idleSeconds = 0;
  }

  // Switches between always shown and hidden; the automatic fade no longer applies after the first toggle.
  public toggle(): void {
    this.pinned = this.visibility <= 0.5;
    this.idleSeconds = 0;
  }

  public showBanner(text: string): void {
    this.bannerText = text;
    this.bannerSeconds = BANNER_SECONDS;
  }

  public get visibility(): number {
    if (this.pinned !== null) return this.pinned ? 1 : 0;
    const fade = (this.idleSeconds - IDLE_SECONDS) / FADE_SECONDS;
    return Math.max(0, Math.min(1, 1 - fade));
  }

  public draw(displayList: DisplayList, content: DemoHudContent): void {
    const font = getDemoFont();
    const scale = content.scale ?? 1;
    const margin = HUD_MARGIN * scale;
    displayList.setColor(HUD_TEXT_COLOR);
    if (this.bannerSeconds > 0) {
      font.addText(displayList, {
        text: this.bannerText,
        x: content.width / 2,
        y: margin,
        size: 22 * scale,
        alignment: "center",
        intensity: Math.min(1, this.bannerSeconds / 0.8),
      });
    }
    const intensity = this.visibility;
    if (intensity <= 0.01) return;
    font.addText(displayList, { text: content.title, x: margin, y: margin, size: 28 * scale, intensity });
    content.statusLines.forEach((line, index) => {
      font.addText(displayList, {
        text: line,
        x: margin,
        y: margin + (50 + index * 26) * scale,
        size: 16 * scale,
        intensity: intensity * 0.8,
      });
    });
    const helpTop = content.height - margin - (content.helpLines.length * 26 - 8) * scale;
    content.helpLines.forEach((line, index) => {
      font.addText(displayList, {
        text: line,
        x: margin,
        y: helpTop + index * 26 * scale,
        size: 14 * scale,
        intensity: intensity * 0.6,
      });
    });
  }
}
