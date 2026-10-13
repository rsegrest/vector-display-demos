import { SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList } from "@vector-display/core";
import { DemoHud, DynamicGeometry, createSeededRandom, type Demo, type DemoFrame, type RandomSource } from "@vector-demos/demo-kit";
import { buildBiomorph, describeGenome, type Biomorph } from "./render/biomorph.js";
import { centreOf, childIndexAt, layoutBiomorphs, type BiomorphLayout, type Rect } from "./render/layout.js";
import { breedChildren, createRandomGenome, clampGene, type Genome } from "./sim/genome.js";

export const BIOMORPH_WORLD_HEIGHT = 1000;
const AUTOPILOT_SECONDS = 3;
const GROW_SECONDS = 0.45;

// Famous starting creatures from Dawkins' portfolios: the basic tree and the
// swept-wing insect. Cycling through them is a quick way to see how much one
// genome's neighbourhood can hold.
export const BIOMORPH_PRESETS: readonly { readonly name: string; readonly genome: readonly number[] }[] = [
  { name: "TREE", genome: [1, -3, 1, -1, 2, 2, 2, 3, 7] },
  { name: "INSECT", genome: [1, 1, -4, 1, -1, -2, 8, -4, 6] },
];

const PARENT_COLOR: BeamColor = { red: 1, green: 0.82, blue: 0.42 };
const CHILD_COLOR: BeamColor = { red: 0.5, green: 1, blue: 0.78 };
const FRAME_COLOR: BeamColor = { red: 0.22, green: 0.32, blue: 0.38 };
const HIGHLIGHT_COLOR: BeamColor = { red: 0.65, green: 1, blue: 0.95 };

const HELP_LINES = [
  "CLICK A CHILD TO BREED   ARROWS SELECT   ENTER CHOOSE   BACKSPACE UNDO",
  "R RANDOM   P PRESET   G REROLL CHILDREN   A AUTOPILOT   H HUD   F FULLSCREEN   ESC MENU",
];

export interface BiomorphOptions {
  readonly seed: number;
  readonly genome?: Genome | null;
}

interface PlacedCreature {
  readonly biomorph: Biomorph;
  readonly rect: Rect;
}

// The breeding grid. The parent sits in the middle, its eight mutant children
// around it; choosing one promotes it and breeds a new litter. Small mutations
// plus a chooser are the whole of evolution here, and the forms are line drawings
// already, so they suit a beam perfectly.
export class BiomorphDemo implements Demo {
  public isPaused = false;
  public selected = 0;
  public autopilot = false;
  public presetIndex = 0;

  private readonly hud = new DemoHud();
  private readonly frames = new DynamicGeometry(64);
  private readonly highlight = new DynamicGeometry(16);
  private random: RandomSource;
  private seed: number;
  private parent: number[];
  private parentBiomorph: Biomorph;
  private children: number[][];
  private childBiomorphs: Biomorph[];
  private readonly history: number[][] = [];
  private generation = 0;
  private generationSeconds = GROW_SECONDS;
  private autopilotSeconds = 0;
  private hovered: number | null = null;
  private worldWidth = 1600;
  private worldHeight = BIOMORPH_WORLD_HEIGHT;

  public constructor(options: BiomorphOptions) {
    this.seed = options.seed;
    this.random = createSeededRandom(options.seed);
    this.parent = options.genome ? [...options.genome] : [...BIOMORPH_PRESETS[0].genome];
    this.parentBiomorph = buildBiomorph(this.parent);
    this.children = breedChildren(this.parent, this.random);
    this.childBiomorphs = this.children.map((genome) => buildBiomorph(genome));
    this.hud.showBanner("BIOMORPHS");
  }

  public get currentSeed(): number {
    return this.seed;
  }

  public get parentGenome(): Genome {
    return this.parent;
  }

  public get generationCount(): number {
    return this.generation;
  }

  public resize(width: number, height: number): void {
    this.worldWidth = width;
    this.worldHeight = height;
  }

  public update(deltaSeconds: number): void {
    this.hud.update(deltaSeconds);
    this.generationSeconds += deltaSeconds;
    if (this.isPaused) return;
    if (this.autopilot) {
      this.autopilotSeconds += deltaSeconds;
      if (this.autopilotSeconds >= AUTOPILOT_SECONDS) {
        this.autopilotSeconds = 0;
        this.choose(Math.floor(this.random() * this.children.length));
      }
    }
  }

  public draw(displayList: DisplayList): void {
    const layout = this.layout();
    const grown = Math.min(1, this.generationSeconds / GROW_SECONDS);

    this.drawFrames(layout, displayList);
    this.drawCreature(displayList, { biomorph: this.parentBiomorph, rect: layout.parent }, PARENT_COLOR, 1.15 * grown);

    const selectedChild = this.selectedIndex();
    this.childBiomorphs.forEach((biomorph, index) => {
      const chosen = index === selectedChild;
      const intensity = (chosen ? 1.1 : 0.5) * grown;
      this.drawCreature(displayList, { biomorph, rect: layout.children[index] }, chosen ? HIGHLIGHT_COLOR : CHILD_COLOR, intensity);
    });
  }

  public drawOverlay(displayList: DisplayList, frame: DemoFrame): void {
    const selectedChild = this.selectedIndex();
    this.hud.draw(displayList, {
      title: "BIOMORPHS",
      statusLines: [
        `GENERATION ${this.generation}  CHILD ${selectedChild + 1}/8  SEGMENTS ${this.parentBiomorph.segmentCount}`,
        `PARENT  ${describeGenome(this.parent)}`,
        `CHILD   ${describeGenome(this.children[selectedChild])}${this.autopilot ? "   AUTOPILOT" : ""}${this.isPaused ? "   PAUSED" : ""}`,
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

  public moveSelection(delta: number): void {
    const count = this.children.length;
    this.selected = (((this.selected + delta) % count) + count) % count;
  }

  public setHovered(index: number | null): void {
    this.hovered = index === null || index < 0 ? null : index;
  }

  // Promotes a child to parent and breeds a fresh litter around it.
  public choose(index: number): void {
    if (index < 0 || index >= this.children.length) return;
    this.history.push(this.parent);
    this.parent = this.children[index];
    this.parentBiomorph = this.childBiomorphs[index];
    this.breed();
    this.generation++;
    this.hud.showBanner(`GENERATION ${this.generation}`);
  }

  public undo(): void {
    const previous = this.history.pop();
    if (!previous) return;
    this.parent = previous;
    this.parentBiomorph = buildBiomorph(previous);
    this.breed();
    this.hud.showBanner("BACK ONE GENERATION");
  }

  // A brand new creature, with no ancestry.
  public randomize(): void {
    this.seed = Math.floor(Math.random() * 0x7fffffff);
    this.random = createSeededRandom(this.seed);
    this.parent = createRandomGenome(this.random);
    this.parentBiomorph = buildBiomorph(this.parent);
    this.history.length = 0;
    this.generation = 0;
    this.breed();
    this.hud.showBanner(`RANDOM  SEED ${this.seed}`);
  }

  // One of Dawkins' starting creatures, freshly bred.
  public nextPreset(): void {
    this.presetIndex = (this.presetIndex + 1) % BIOMORPH_PRESETS.length;
    this.parent = [...BIOMORPH_PRESETS[this.presetIndex].genome];
    this.parentBiomorph = buildBiomorph(this.parent);
    this.history.length = 0;
    this.generation = 0;
    this.breed();
    this.hud.showBanner(BIOMORPH_PRESETS[this.presetIndex].name);
  }

  // New mutations of the same parent.
  public reroll(): void {
    this.breed();
    this.hud.showBanner("NEW CHILDREN");
  }

  public toggleAutopilot(): void {
    this.autopilot = !this.autopilot;
    this.autopilotSeconds = 0;
    this.hud.showBanner(`AUTOPILOT ${this.autopilot ? "ON" : "OFF"}`);
  }

  // Which child (or parent, -1) is under a world point, if any.
  public pickAt(worldX: number, worldY: number): number | null {
    return childIndexAt(this.layout(), worldX, worldY);
  }

  // --- Internals -----------------------------------------------------------------------------------------

  private selectedIndex(): number {
    return this.hovered !== null && this.hovered >= 0 ? this.hovered : this.selected;
  }

  private breed(): void {
    this.children = breedChildren(this.parent, this.random);
    this.childBiomorphs = this.children.map((genome) => buildBiomorph(genome));
    this.generationSeconds = 0;
    this.selected = 0;
    this.hovered = null;
  }

  private layout(): BiomorphLayout {
    return layoutBiomorphs(this.worldWidth, this.worldHeight, this.worldHeight * 0.13, this.worldHeight * 0.17);
  }

  private drawCreature(displayList: DisplayList, placed: PlacedCreature, color: BeamColor, intensity: number): void {
    const centre = centreOf(placed.rect);
    displayList.setColor(color);
    displayList.addShape(placed.biomorph.shape, {
      ...SCREEN_SPACE_PLACEMENT,
      x: centre.x,
      y: centre.y,
      scale: Math.min(placed.rect.width, placed.rect.height) * 0.86,
      intensity,
    });
  }

  private drawFrames(layout: BiomorphLayout, displayList: DisplayList): void {
    this.frames.clear();
    this.highlight.clear();
    for (const rect of [layout.parent, ...layout.children]) addRectangle(this.frames, rect);
    const selected = this.selectedIndex();
    addRectangle(this.highlight, layout.parent);
    addRectangle(this.highlight, layout.children[selected]);
    displayList.setColor(FRAME_COLOR);
    displayList.addShape(this.frames, { ...SCREEN_SPACE_PLACEMENT, intensity: 0.35 });
    displayList.setColor(HIGHLIGHT_COLOR);
    displayList.addShape(this.highlight, { ...SCREEN_SPACE_PLACEMENT, intensity: 0.7 });
  }
}

function addRectangle(geometry: DynamicGeometry, rect: Rect): void {
  geometry.moveTo(rect.x, rect.y);
  geometry.lineTo(rect.x + rect.width, rect.y);
  geometry.lineTo(rect.x + rect.width, rect.y + rect.height);
  geometry.lineTo(rect.x, rect.y + rect.height);
  geometry.closePath();
}

// Exposed so a URL can carry a genome around.
export function parseGenome(value: string | null): number[] | null {
  if (!value) return null;
  const parts = value.split(/[,\s]+/).map((part) => Number.parseInt(part, 10));
  if (parts.length !== 9 || parts.some((part) => !Number.isFinite(part))) return null;
  return parts.map((part, index) => clampGene(part, index === 8));
}
