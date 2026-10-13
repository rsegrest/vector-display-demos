import { SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList } from "@vector-display/core";
import { DemoHud, DynamicGeometry, createSeededRandom, type Demo, type DemoFrame, type RandomSource } from "@vector-demos/demo-kit";
import { addBiomorph, blendGenomes, createSegmentBuffer, describeGenome, growSegments, levelsForBlend, segmentCountFor } from "./render/biomorph.js";
import { centreOf, childIndexAt, layoutBiomorphs, type BiomorphLayout, type Rect } from "./render/layout.js";
import { CHILD_COUNT, breedChildren, clampGene, createRandomGenome, genomeKey, pickAutopilotChild, type Genome } from "./sim/genome.js";

export const BIOMORPH_WORLD_HEIGHT = 1000;
const AUTOPILOT_SECONDS = 3;
// A chosen child first travels to the middle of the grid, then its own children
// grow out of it into their cells. The two overlap a little so it reads as one move.
export const ARRIVE_SECONDS = 0.32;
export const EMERGE_SECONDS = 0.6;
const EMERGE_OVERLAP_SECONDS = 0.1;
// Share of a cell's shorter side that a creature fills.
const CREATURE_FILL = 0.88;

// Starting creatures to breed from. Cycling through them is a quick way to see how
// much one genome's neighbourhood can hold.
export const BIOMORPH_PRESETS: readonly { readonly name: string; readonly genome: readonly number[] }[] = [
  { name: "TREE", genome: [1, -3, 1, -1, 2, 2, 2, 3, 7] },
  { name: "INSECT", genome: [1, 1, -4, 1, -1, -2, 8, -4, 6] },
  { name: "BRAMBLE", genome: [-1, -1, -4, 2, 3, 3, 1, -2, 8] },
  { name: "CORAL", genome: [-3, -4, 0, 5, 3, -3, -2, 2, 8] },
  { name: "MASK", genome: [2, -3, -2, -1, 5, 1, -2, 5, 7] },
  { name: "TOTEM", genome: [2, -4, 2, 2, 0, -4, 5, 0, 7] },
  { name: "LANTERN", genome: [-2, 2, 2, -2, -4, -3, 4, 4, 8] },
  { name: "ANTLERS", genome: [-4, -2, -5, 1, 1, 5, -1, 0, 7] },
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

// The breeding grid. The parent sits in the middle, its eight mutant children
// around it; choosing one promotes it and breeds a new litter. Small mutations
// plus a chooser are the whole of evolution here, and the forms are line drawings
// already, so they suit a beam perfectly.
export class BiomorphDemo implements Demo {
  public isPaused = false;
  public selected = 0;
  public autopilot = false;
  public presetIndex = 0;
  // Called whenever the parent changes, so the page can keep its address shareable.
  public onParentChange: () => void = () => {};

  private readonly hud = new DemoHud();
  private readonly frames = new DynamicGeometry(64);
  private readonly highlight = new DynamicGeometry(16);
  private readonly parentGeometry = new DynamicGeometry(512);
  private readonly childGeometries: DynamicGeometry[] = [];
  private readonly segmentBuffer = createSegmentBuffer();
  private random: RandomSource;
  private seed: number;
  private parent: Genome;
  private children: Genome[];
  private readonly history: Genome[] = [];
  // Every creature bred from so far in this lineage, for the autopilot to avoid.
  private readonly visited = new Set<string>();
  private generation = 0;
  private transitionSeconds = ARRIVE_SECONDS + EMERGE_SECONDS;
  // The cell the current parent was chosen from, while it is still on its way in.
  private arrivingFrom: number | null = null;
  private autopilotSeconds = 0;
  private hovered: number | null = null;
  private worldWidth = 1600;
  private worldHeight = BIOMORPH_WORLD_HEIGHT;

  public constructor(options: BiomorphOptions) {
    this.seed = options.seed;
    this.random = createSeededRandom(options.seed);
    this.parent = options.genome ? [...options.genome] : [...BIOMORPH_PRESETS[0].genome];
    this.children = breedChildren(this.parent, this.random);
    for (let index = 0; index < CHILD_COUNT; index++) this.childGeometries.push(new DynamicGeometry(512));
    this.visited.add(genomeKey(this.parent));
    this.startTransition(null);
    this.hud.showBanner("BIOMORPHS");
  }

  public get currentSeed(): number {
    return this.seed;
  }

  public get parentGenome(): Genome {
    return this.parent;
  }

  public get childGenomes(): readonly Genome[] {
    return this.children;
  }

  public get generationCount(): number {
    return this.generation;
  }

  // 0 while a chosen child is still where it was picked, 1 once it sits in the middle.
  public get arriveProgress(): number {
    if (this.arrivingFrom === null) return 1;
    return smoothstep(this.transitionSeconds / ARRIVE_SECONDS);
  }

  // 0 while the litter is still folded into the parent, 1 once every child has
  // reached its cell and its own shape.
  public get emergeProgress(): number {
    const start = this.arrivingFrom === null ? 0 : ARRIVE_SECONDS - EMERGE_OVERLAP_SECONDS;
    return smoothstep((this.transitionSeconds - start) / EMERGE_SECONDS);
  }

  public resize(width: number, height: number): void {
    this.worldWidth = width;
    this.worldHeight = height;
  }

  public update(deltaSeconds: number): void {
    this.hud.update(deltaSeconds);
    this.transitionSeconds += deltaSeconds;
    if (this.isPaused) return;
    if (this.autopilot) {
      this.autopilotSeconds += deltaSeconds;
      if (this.autopilotSeconds >= AUTOPILOT_SECONDS) {
        this.autopilotSeconds = 0;
        this.choose(pickAutopilotChild(this.children, this.visited, this.random));
      }
    }
  }

  public draw(displayList: DisplayList): void {
    const layout = this.layout();
    const arrive = this.arriveProgress;
    const emerge = this.emergeProgress;
    const parentCentre = centreOf(layout.parent);
    const size = layout.cellSize * CREATURE_FILL;

    this.drawFrames(layout, displayList);

    // The parent, on its way in from the cell it was chosen in.
    const origin = this.arrivingFrom === null ? parentCentre : centreOf(layout.children[this.arrivingFrom]);
    this.parentGeometry.clear();
    this.addCreature(this.parentGeometry, this.parent, levelsForBlend(this.parent, this.parent), mix(origin.x, parentCentre.x, arrive), mix(origin.y, parentCentre.y, arrive), size);
    displayList.setColor(mixColor(HIGHLIGHT_COLOR, PARENT_COLOR, arrive));
    displayList.addShape(this.parentGeometry, { ...SCREEN_SPACE_PLACEMENT, intensity: 1.15 });

    // The litter, each child growing out of the parent's shape into its own.
    if (emerge <= 0) return;
    const selectedChild = this.selectedIndex();
    this.children.forEach((child, index) => {
      const cellCentre = centreOf(layout.children[index]);
      const geometry = this.childGeometries[index];
      geometry.clear();
      this.addCreature(
        geometry,
        blendGenomes(this.parent, child, emerge),
        levelsForBlend(this.parent, child),
        mix(parentCentre.x, cellCentre.x, emerge),
        mix(parentCentre.y, cellCentre.y, emerge),
        size,
      );
      const chosen = index === selectedChild;
      displayList.setColor(chosen ? HIGHLIGHT_COLOR : CHILD_COLOR);
      displayList.addShape(geometry, { ...SCREEN_SPACE_PLACEMENT, intensity: (chosen ? 1.1 : 0.5) * emerge });
    });
  }

  public drawOverlay(displayList: DisplayList, frame: DemoFrame): void {
    const selectedChild = this.selectedIndex();
    this.hud.draw(displayList, {
      title: "BIOMORPHS",
      statusLines: [
        `GENERATION ${this.generation}  CHILD ${selectedChild + 1}/8  SEGMENTS ${segmentCountFor(this.parent[8] ?? 0)}`,
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
    this.visited.add(genomeKey(this.parent));
    this.generation++;
    this.breed(index);
    this.hud.showBanner(`GENERATION ${this.generation}`);
  }

  public undo(): void {
    const previous = this.history.pop();
    if (!previous) return;
    this.parent = previous;
    this.generation--;
    this.breed(null);
    this.hud.showBanner("BACK ONE GENERATION");
  }

  // A brand new creature, with no ancestry.
  public randomize(): void {
    this.seed = Math.floor(Math.random() * 0x7fffffff);
    this.random = createSeededRandom(this.seed);
    this.startLineage(createRandomGenome(this.random));
    this.hud.showBanner(`RANDOM  SEED ${this.seed}`);
  }

  // The next starting creature, freshly bred.
  public nextPreset(): void {
    this.presetIndex = (this.presetIndex + 1) % BIOMORPH_PRESETS.length;
    this.startLineage([...BIOMORPH_PRESETS[this.presetIndex].genome]);
    this.hud.showBanner(BIOMORPH_PRESETS[this.presetIndex].name);
  }

  // New mutations of the same parent.
  public reroll(): void {
    this.breed(null);
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

  private startLineage(genome: Genome): void {
    this.parent = genome;
    this.history.length = 0;
    this.visited.clear();
    this.visited.add(genomeKey(genome));
    this.generation = 0;
    this.breed(null);
  }

  // A new litter around the current parent. `chosenFrom` is the cell the parent
  // was picked from, if it was picked.
  private breed(chosenFrom: number | null): void {
    this.children = breedChildren(this.parent, this.random);
    this.selected = 0;
    this.hovered = null;
    this.startTransition(chosenFrom);
    this.onParentChange();
  }

  private startTransition(chosenFrom: number | null): void {
    this.arrivingFrom = chosenFrom;
    this.transitionSeconds = 0;
  }

  private layout(): BiomorphLayout {
    return layoutBiomorphs(this.worldWidth, this.worldHeight, this.worldHeight * 0.1, this.worldHeight * 0.09);
  }

  private addCreature(geometry: DynamicGeometry, genes: Genome, levels: number, centreX: number, centreY: number, size: number): void {
    const count = growSegments(genes, levels, this.segmentBuffer);
    addBiomorph(geometry, this.segmentBuffer, count, centreX, centreY, size);
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

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function mixColor(from: BeamColor, to: BeamColor, amount: number): BeamColor {
  return { red: mix(from.red, to.red, amount), green: mix(from.green, to.green, amount), blue: mix(from.blue, to.blue, amount) };
}

function smoothstep(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

// Exposed so a URL can carry a genome around.
export function parseGenome(value: string | null): number[] | null {
  if (!value) return null;
  const parts = value.split(/[,\s]+/).map((part) => Number.parseInt(part, 10));
  if (parts.length !== 9 || parts.some((part) => !Number.isFinite(part))) return null;
  return parts.map((part, index) => clampGene(part, index === 8));
}
