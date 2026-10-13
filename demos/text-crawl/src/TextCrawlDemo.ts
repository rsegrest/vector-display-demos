import { SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList } from "@vector-display/core";
import { DemoHud, DynamicGeometry, createSeededRandom, type Demo, type DemoFrame } from "@vector-demos/demo-kit";
import { CrawlScene, SHATTER_SECONDS, rayToPlane } from "./sim/CrawlScene.js";
import { layoutPage } from "./sim/pageLayout.js";

export const TEXT_CRAWL_WORLD_HEIGHT = 1000;
export const SPEEDS: readonly number[] = [0.5, 1, 2, 4];
export const TRAIL_MODES: readonly { readonly name: string; readonly halfLifeMilliseconds: number }[] = [
  { name: "SHORT", halfLifeMilliseconds: 35 },
  { name: "MEDIUM", halfLifeMilliseconds: 80 },
  { name: "LONG", halfLifeMilliseconds: 320 },
];

// The pages shown when the address gives no text of its own. Lines are kept under
// about 26 characters so the nearest ones fit the screen.
export const DEFAULT_PAGES: readonly (readonly string[])[] = [
  [
    "#THE BEAM",
    "BEFORE PIXELS, A SCREEN",
    "WAS ONE POINT OF LIGHT",
    "SWEPT FROM PLACE TO PLACE.",
    "",
    "IT DREW NOTHING BUT LINES,",
    "AND WHERE LINES CROSSED",
    "THEY BURNED BRIGHTER.",
  ],
  [
    "#PHOSPHOR",
    "THE GLASS REMEMBERED.",
    "EACH STROKE FADED SLOWLY,",
    "SO A MOVING BEAM LEFT",
    "A TRAIL BEHIND IT.",
    "",
    "MOTION WAS NOT DRAWN.",
    "IT WAS LEFT OVER.",
  ],
  [
    "#STROKES",
    "EVERY LETTER HERE IS",
    "A HANDFUL OF STRAIGHT",
    "STROKES, NOTHING MORE.",
    "",
    "PRESS SPACE, OR CLICK",
    "ANYWHERE IN THE TEXT,",
    "AND SEE FOR YOURSELF.",
  ],
];

// Focal length of the view, in world units: larger is a narrower, flatter view.
const FOCAL_LENGTH = 700;
// Strokes are cut off this close to the eye, so nothing divides by nearly zero.
const NEAR_DEPTH = 8;
// Text is brightest up close and fades to almost nothing by this depth.
const FADE_DEPTH = 460;
const DEPTH_BANDS = 6;
const BODY_COLOR: BeamColor = { red: 1, green: 0.78, blue: 0.3 };
const TITLE_COLOR: BeamColor = { red: 0.45, green: 0.95, blue: 1 };

const HELP_LINES = [
  "SPACE OR CLICK SHATTER   N NEXT PAGE   - + SPEED   T TRAILS   P PAUSE   H HUD   F FULLSCREEN   ESC MENU",
  "ADD ?TEXT=LINE ONE|LINE TWO TO THE ADDRESS FOR YOUR OWN WORDS  (# STARTS A TITLE, || A NEW PAGE)",
];

export interface TextCrawlOptions {
  readonly seed: number;
  readonly pages: readonly (readonly string[])[];
}

interface Band {
  readonly geometry: DynamicGeometry;
  readonly color: BeamColor;
  readonly intensity: number;
}

// Text in the vector font, laid on a plane that recedes from the viewer, sliding
// away into the distance. The text is only ever its strokes: the perspective comes
// from projecting each stroke's two ends, and when the page shatters the same
// strokes simply stop being held in place.
export class TextCrawlDemo implements Demo {
  public readonly scene: CrawlScene;
  public isPaused = false;
  public speedIndex = 1;
  public trailIndex = 1;
  public onTrailChange: (halfLifeMilliseconds: number) => void = () => {};

  private readonly hud = new DemoHud();
  private readonly bands: Band[] = [];
  private readonly pageCount: number;
  private screenWidth = 1778;
  private screenHeight = TEXT_CRAWL_WORLD_HEIGHT;
  private segmentCount = 0;

  public constructor(options: TextCrawlOptions) {
    const pages = options.pages.map((lines) => layoutPage(lines)).filter((page) => page.segmentCount > 0);
    this.pageCount = pages.length;
    this.scene = new CrawlScene(pages, createSeededRandom(options.seed));
    for (const color of [BODY_COLOR, TITLE_COLOR]) {
      for (let band = 0; band < DEPTH_BANDS; band++) {
        const nearness = 1 - band / (DEPTH_BANDS - 1);
        this.bands.push({ geometry: new DynamicGeometry(512), color, intensity: 0.07 + 1.05 * nearness * nearness });
      }
    }
    this.hud.showBanner("TEXT CRAWL");
  }

  public resize(width: number, height: number): void {
    this.screenWidth = width;
    this.screenHeight = height;
  }

  public update(deltaSeconds: number): void {
    this.hud.update(deltaSeconds);
    if (!this.isPaused) this.scene.update(deltaSeconds, SPEEDS[this.speedIndex]);
  }

  public draw(displayList: DisplayList, frame: DemoFrame): void {
    const { scene } = this;
    const { current } = scene;
    const { isTitle, segmentCount } = scene.page;
    const centreX = frame.width / 2;
    const centreY = frame.height / 2;
    for (const band of this.bands) band.geometry.clear();

    for (let stroke = 0; stroke < segmentCount; stroke++) {
      const offset = stroke * 6;
      let x0 = current[offset];
      let y0 = current[offset + 1];
      let z0 = current[offset + 2];
      let x1 = current[offset + 3];
      let y1 = current[offset + 4];
      let z1 = current[offset + 5];
      if (z0 < NEAR_DEPTH && z1 < NEAR_DEPTH) continue;
      // Cut the part that is too close to the eye, or behind it.
      if (z0 < NEAR_DEPTH) {
        const amount = (NEAR_DEPTH - z0) / (z1 - z0);
        x0 += (x1 - x0) * amount;
        y0 += (y1 - y0) * amount;
        z0 = NEAR_DEPTH;
      } else if (z1 < NEAR_DEPTH) {
        const amount = (NEAR_DEPTH - z1) / (z0 - z1);
        x1 += (x0 - x1) * amount;
        y1 += (y0 - y1) * amount;
        z1 = NEAR_DEPTH;
      }
      const depth = (z0 + z1) / 2;
      const band = Math.max(0, Math.min(DEPTH_BANDS - 1, Math.floor((depth / FADE_DEPTH) * DEPTH_BANDS)));
      this.bands[(isTitle[stroke] ? DEPTH_BANDS : 0) + band].geometry.addSegment(
        centreX + (FOCAL_LENGTH * x0) / z0,
        centreY - (FOCAL_LENGTH * y0) / z0,
        centreX + (FOCAL_LENGTH * x1) / z1,
        centreY - (FOCAL_LENGTH * y1) / z1,
      );
    }

    // Loose strokes flare as the page breaks, then burn out; gathering ones glow in.
    const glow =
      scene.phase === "SHATTER"
        ? Math.max(0, 1 - scene.phaseSeconds / SHATTER_SECONDS) * (1 + 0.5 * Math.exp(-scene.phaseSeconds * 6))
        : 0.25 + 0.75 * scene.assembly;
    this.segmentCount = 0;
    for (const band of this.bands) {
      if (band.geometry.segmentCount === 0) continue;
      this.segmentCount += band.geometry.segmentCount;
      displayList.setColor(band.color);
      displayList.addShape(band.geometry, { ...SCREEN_SPACE_PLACEMENT, intensity: band.intensity * glow });
    }
  }

  public drawOverlay(displayList: DisplayList, frame: DemoFrame): void {
    this.hud.draw(displayList, {
      title: "TEXT CRAWL",
      statusLines: [
        `PAGE ${this.scene.pageIndex + 1}/${this.pageCount}  ${this.scene.phase}  STROKES ${this.scene.page.segmentCount}`,
        `SPEED ${SPEEDS[this.speedIndex]}X  TRAILS ${TRAIL_MODES[this.trailIndex].name}  SEGMENTS ${this.segmentCount}${this.isPaused ? "  PAUSED" : ""}`,
      ],
      helpLines: HELP_LINES,
      width: frame.width,
      height: frame.height,
      scale: frame.height / 1000,
    });
  }

  // --- Actions -------------------------------------------------------------------------------------------

  public noteActivity(): void {
    this.hud.noteActivity();
  }

  public toggleHud(): void {
    this.hud.toggle();
  }

  public togglePause(): void {
    this.isPaused = !this.isPaused;
  }

  // Shatters the page from the middle of the text.
  public shatter(): void {
    this.scene.shatter(null);
  }

  // Shatters the page from the point on it under a screen position (world units).
  public shatterAt(screenX: number, screenY: number): void {
    const origin = rayToPlane((screenX - this.screenWidth / 2) / FOCAL_LENGTH, -(screenY - this.screenHeight / 2) / FOCAL_LENGTH);
    this.scene.shatter(origin);
  }

  public nextPage(): void {
    this.scene.nextPage();
  }

  public changeSpeed(delta: number): void {
    this.speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, this.speedIndex + delta));
    this.hud.showBanner(`SPEED ${SPEEDS[this.speedIndex]}X`);
  }

  public cycleTrails(): void {
    this.trailIndex = (this.trailIndex + 1) % TRAIL_MODES.length;
    this.onTrailChange(TRAIL_MODES[this.trailIndex].halfLifeMilliseconds);
    this.hud.showBanner(`TRAILS ${TRAIL_MODES[this.trailIndex].name}`);
  }
}
