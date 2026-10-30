import { SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList } from "@vector-display/core";
import { DynamicGeometry, fontSafeText, getDemoFont } from "@vector-demos/demo-kit";

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

interface Batch {
  readonly color: BeamColor;
  readonly intensity: number;
  readonly geometry: DynamicGeometry;
}

// Drawing and clicking for a window laid out afresh every frame: whatever is drawn as a button
// or a clickable area this frame is what the next click is tested against. Lines are gathered
// by color and brightness and drawn in one batch each.
export class Ui {
  private readonly batches = new Map<string, Batch>();
  private targets: { rect: Rect; onPress: () => void }[] = [];
  private displayList: DisplayList | null = null;
  public pointerX = -1;
  public pointerY = -1;

  public begin(displayList: DisplayList): void {
    this.displayList = displayList;
    this.targets = [];
    for (const batch of this.batches.values()) batch.geometry.clear();
  }

  public end(): void {
    const displayList = this.displayList!;
    for (const { color, intensity, geometry } of this.batches.values()) {
      if (geometry.segmentCount === 0) continue;
      displayList.setColor(color);
      displayList.addShape(geometry, { ...SCREEN_SPACE_PLACEMENT, intensity });
    }
    this.displayList = null;
  }

  // A click: the last target drawn under the pointer is pressed. Returns whether one was.
  public press(x: number, y: number): boolean {
    for (let index = this.targets.length - 1; index >= 0; index--) {
      if (contains(this.targets[index].rect, x, y)) {
        this.targets[index].onPress();
        return true;
      }
    }
    return false;
  }

  public isHovered(rect: Rect): boolean {
    return contains(rect, this.pointerX, this.pointerY);
  }

  public region(rect: Rect, onPress: () => void): void {
    this.targets.push({ rect, onPress });
  }

  public pen(color: BeamColor, intensity: number): DynamicGeometry {
    const key = `${color.red},${color.green},${color.blue},${intensity}`;
    let batch = this.batches.get(key);
    if (!batch) {
      batch = { color, intensity, geometry: new DynamicGeometry(256) };
      this.batches.set(key, batch);
    }
    return batch.geometry;
  }

  public rect(color: BeamColor, intensity: number, rect: Rect, inset = 0): void {
    const pen = this.pen(color, intensity);
    pen.moveTo(rect.x + inset, rect.y + inset);
    pen.lineTo(rect.x + rect.width - inset, rect.y + inset);
    pen.lineTo(rect.x + rect.width - inset, rect.y + rect.height - inset);
    pen.lineTo(rect.x + inset, rect.y + rect.height - inset);
    pen.closePath();
  }

  public circle(color: BeamColor, intensity: number, centerX: number, centerY: number, radius: number): void {
    const pen = this.pen(color, intensity);
    const sides = Math.max(10, Math.min(28, Math.round(radius)));
    pen.moveTo(centerX + radius, centerY);
    for (let side = 1; side < sides; side++) {
      const angle = (side / sides) * 2 * Math.PI;
      pen.lineTo(centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle));
    }
    pen.closePath();
  }

  public cross(color: BeamColor, intensity: number, centerX: number, centerY: number, half: number): void {
    const pen = this.pen(color, intensity);
    pen.addSegment(centerX - half, centerY - half, centerX + half, centerY + half);
    pen.addSegment(centerX - half, centerY + half, centerX + half, centerY - half);
  }

  // Text in the arcade font, which has capitals only; `y` is its top.
  public text(color: BeamColor, text: string, x: number, y: number, size: number, alignment: "left" | "center" | "right" = "left", intensity = 0.95): void {
    const displayList = this.displayList!;
    displayList.setColor(color);
    getDemoFont().addText(displayList, { text: fontSafeText(text), x, y, size, alignment, intensity });
  }

  public textWidth(text: string, size: number): number {
    return getDemoFont().measureText(fontSafeText(text), size).width;
  }

  // Text cut short with "..." to fit `width`.
  public fitted(text: string, size: number, width: number): string {
    if (this.textWidth(text, size) <= width) return text;
    let cut = text;
    while (cut.length > 1 && this.textWidth(`${cut}...`, size) > width) cut = cut.slice(0, -1);
    return `${cut}...`;
  }

  public button(color: BeamColor, rect: Rect, label: string, onPress: () => void, size = 12): void {
    const isHovered = this.isHovered(rect);
    this.rect(color, isHovered ? 1.1 : 0.5, rect);
    this.text(color, label, rect.x + rect.width / 2, rect.y + (rect.height - size) / 2, size, "center", isHovered ? 1.3 : 0.95);
    this.region(rect, onPress);
  }
}
