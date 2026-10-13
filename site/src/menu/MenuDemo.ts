import { SCREEN_SPACE_PLACEMENT, Shape, type BeamColor, type DisplayList } from "@vector-display/core";
import { getDemoFont, type Demo, type DemoFrame } from "@vector-demos/demo-kit";
import type { DemoEntry } from "../catalog.js";
import { ITEM_TEXT_SIZE, MenuModel, type MenuLayout } from "./MenuModel.js";

const TITLE_COLOR: BeamColor = { red: 0.7, green: 0.95, blue: 1 };
const ITEM_COLOR: BeamColor = { red: 0.8, green: 0.92, blue: 1 };
const POINTER_COLOR: BeamColor = { red: 0.55, green: 1, blue: 0.75 };
const DIM_COLOR: BeamColor = { red: 0.45, green: 0.6, blue: 0.7 };
const POINTER_GAP = 34;
const LAUNCH_SECONDS = 0.35;

// An arrowhead pointing right, tip at the origin.
const POINTER_SHAPE = Shape.fromPolyline({
  points: [{ x: -26, y: -14 }, { x: 0, y: 0 }, { x: -26, y: 14 }, { x: -18, y: 0 }],
  isClosed: true,
});
const RULE_SHAPE = Shape.fromSegmentCoordinates([-1, 0, 1, 0]);

// The index page: a vector-font list of demos with an animated pointer beside the selection.
export class MenuDemo implements Demo {
  public readonly model: MenuModel;
  public onOpen: (entry: DemoEntry) => void = () => {};
  private width = 1600;
  private height = 1000;
  private seconds = 0;
  private launchSeconds = -1;
  private readonly itemWidths: number[];
  private readonly titles: string[];

  public constructor(
    private readonly entries: readonly DemoEntry[],
    rememberedIndex: number,
  ) {
    this.model = new MenuModel(entries.length, rememberedIndex);
    this.titles = entries.map((entry) => entry.title.toUpperCase());
    this.itemWidths = this.titles.map((title) => getDemoFont().measureText(title, ITEM_TEXT_SIZE).width);
  }

  public get layout(): MenuLayout {
    return this.model.layout({ width: this.width, height: this.height, itemWidths: this.itemWidths });
  }

  public get isLaunching(): boolean {
    return this.launchSeconds >= 0;
  }

  public resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  public select(index: number): void {
    if (!this.isLaunching) this.model.selectedIndex = index;
  }

  public move(delta: number): void {
    if (!this.isLaunching) this.model.move(delta);
  }

  public moveColumn(delta: number): void {
    if (!this.isLaunching) this.model.moveColumn(delta, this.layout);
  }

  // Flares the selection briefly, then hands over to onOpen.
  public open(index = this.model.selectedIndex): void {
    if (this.isLaunching) return;
    this.model.selectedIndex = index;
    this.launchSeconds = 0;
  }

  public update(deltaSeconds: number): void {
    this.seconds += deltaSeconds;
    this.model.update(deltaSeconds, this.layout);
    if (this.launchSeconds >= 0) {
      this.launchSeconds += deltaSeconds;
      if (this.launchSeconds >= LAUNCH_SECONDS) {
        this.launchSeconds = -1;
        this.onOpen(this.entries[this.model.selectedIndex]);
      }
    }
  }

  public draw(displayList: DisplayList, frame: DemoFrame): void {
    const font = getDemoFont();
    const layout = this.layout;
    const centerX = frame.width / 2;

    displayList.setColor(TITLE_COLOR);
    const titleY = Math.max(60, layout.listTop - 250);
    font.addText(displayList, { text: "VECTOR DEMOS", x: centerX, y: titleY, size: 64, alignment: "center", intensity: 1.1 });
    displayList.addShape(RULE_SHAPE, { x: centerX, y: titleY + 100, rotation: 0, scale: 300, intensity: 0.5 });
    displayList.setColor(DIM_COLOR);
    font.addText(displayList, {
      text: "GENERATIVE AND ARTIFICIAL LIFE DEMOS FOR VECTOR-DISPLAY",
      x: centerX,
      y: titleY + 124,
      size: 16,
      alignment: "center",
      intensity: 0.8,
    });

    const launchFlare = this.isLaunching ? 1 + 2.5 * Math.sin((this.launchSeconds / LAUNCH_SECONDS) * Math.PI) : 1;
    layout.rows.forEach((row, index) => {
      const isSelected = index === this.model.selectedIndex;
      displayList.setColor(ITEM_COLOR);
      font.addText(displayList, {
        text: this.titles[index],
        x: row.left,
        y: row.top,
        size: ITEM_TEXT_SIZE,
        intensity: isSelected ? 1.25 * launchFlare : 0.45,
      });
    });

    // The pointer bobs gently and slides between rows; the phosphor leaves a short trail as it moves.
    const bob = Math.sin(this.seconds * 4) * 5;
    displayList.setColor(POINTER_COLOR);
    displayList.addShape(POINTER_SHAPE, {
      x: this.model.pointerX - POINTER_GAP + bob,
      y: this.model.pointerY,
      rotation: 0,
      scale: 1,
      intensity: 1.2 * launchFlare,
    });

    const selected = this.entries[this.model.selectedIndex];
    displayList.setColor(DIM_COLOR);
    font.addText(displayList, {
      text: selected.description.toUpperCase(),
      x: centerX,
      // Below the list, but never down among the key help.
      y: Math.min(layout.listBottom + 80, frame.height - 122),
      size: 16,
      alignment: "center",
      intensity: 0.9,
    });
    font.addText(displayList, {
      text: "ARROWS SELECT   ENTER OPEN   ESC IN A DEMO RETURNS HERE",
      x: centerX,
      y: frame.height - 60,
      size: 14,
      alignment: "center",
      intensity: 0.5,
    });
    displayList.addShape(RULE_SHAPE, { ...SCREEN_SPACE_PLACEMENT, x: centerX, y: frame.height - 80, scale: 200, intensity: 0.25 });
  }
}
