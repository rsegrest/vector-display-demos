import type { DisplayList } from "@vector-display/core";
import { DemoHud, type Demo, type DemoFrame } from "@vector-demos/demo-kit";
import { MeshRenderer, type EdgeCounts, type EdgeMode } from "./render/MeshRenderer.js";
import { buildTopology, loadStored, type Mesh, type MeshTopology, type StoredMesh } from "./sim/mesh.js";
import { gear, torusKnot } from "./sim/shapes.js";

export const MESHES_WORLD_HEIGHT = 1000;
export const MIN_CREASE_DEGREES = 10;
export const MAX_CREASE_DEGREES = 85;
export const CREASE_STEP_DEGREES = 5;
export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 3;
export const TRAIL_MODES: readonly { readonly name: string; readonly halfLifeMilliseconds: number }[] = [
  { name: "SHORT", halfLifeMilliseconds: 35 },
  { name: "MEDIUM", halfLifeMilliseconds: 110 },
  { name: "LONG", halfLifeMilliseconds: 380 },
];

export interface MeshEntry {
  readonly name: string;
  readonly credit: string;
  // The crease angle that suits this mesh: lower for crisp parts, higher for lumpy scans.
  readonly creaseDegrees: number;
  readonly load: () => Promise<Mesh>;
}

const stored = (importer: () => Promise<{ default: unknown }>): (() => Promise<Mesh>) => {
  return async () => loadStored((await importer()).default as StoredMesh);
};

// The classics of computer graphics, and two shapes made from formulae. The
// scanned and modelled ones are loaded only when first shown.
export const MESHES: readonly MeshEntry[] = [
  { name: "UTAH TEAPOT", credit: "MARTIN NEWELL, UNIVERSITY OF UTAH, 1975", creaseDegrees: 35, load: stored(() => import("./data/teapot.json")) },
  { name: "STANFORD BUNNY", credit: "STANFORD 3D SCANNING REPOSITORY, 1994", creaseDegrees: 65, load: stored(() => import("./data/bunny.json")) },
  { name: "GEAR", credit: "GENERATED", creaseDegrees: 25, load: async () => gear() },
  { name: "SPOT", credit: "KEENAN CRANE, PUBLIC DOMAIN", creaseDegrees: 45, load: stored(() => import("./data/spot.json")) },
  { name: "TORUS KNOT", credit: "GENERATED", creaseDegrees: 40, load: async () => torusKnot() },
];

const AUTO_SECONDS = 20;
const AUTO_YAW_PER_SECOND = 0.32;
const FADE_SECONDS = 0.3;
// Share of the screen's shorter side that the mesh's bounding radius covers.
const MESH_SHARE = 0.36;

const HELP_LINES = [
  "DRAG ROTATE   WHEEL ZOOM   N / B MESH   M FEATURE EDGES / ALL EDGES   L HIDDEN LINES   [ ] CREASE ANGLE",
  "A AUTO   C AUTO CAMERA   T TRAILS   SPACE PAUSE   H HUD   F FULLSCREEN   ESC MENU",
];

export interface MeshesOptions {
  readonly meshIndex: number;
  // The meshes to show; a parameter so tests can use small ones.
  readonly meshes?: readonly MeshEntry[];
}

// Real meshes as line drawings. Drawing every edge of a mesh gives a grey tangle,
// because most edges are only there to approximate a curved surface. This draws
// the few that describe the shape: the outline, the sharp folds and any open
// borders, with whatever the object itself hides cut away. Press M to see the
// tangle it is choosing from, and L to see through it.
export class MeshesDemo implements Demo {
  public isPaused = false;
  public autoCycle = true;
  public autoCamera = true;
  public mode: EdgeMode = "FEATURES";
  public hiddenLines = true;
  public creaseDegrees: number;
  public trailIndex = 0;
  public yaw = 0.6;
  public pitch = 0.32;
  public zoom = 1;
  public onTrailChange: (halfLifeMilliseconds: number) => void = () => {};

  private readonly meshes: readonly MeshEntry[];
  private readonly renderer = new MeshRenderer();
  private readonly hud = new DemoHud();
  private readonly loaded = new Map<number, MeshTopology>();
  private readonly loading = new Set<number>();
  // One load per mesh, shared by everyone who asks for it.
  private readonly requests = new Map<number, Promise<void>>();
  private meshIndex: number;
  // The mesh to switch to once the current one has faded out.
  private pendingIndex: number | null = null;
  private fade = 0;
  private autoSeconds = 0;
  private cameraSeconds = 0;
  private counts: EdgeCounts = { silhouette: 0, crease: 0, other: 0, segments: 0 };

  public constructor(options: MeshesOptions) {
    this.meshes = options.meshes ?? MESHES;
    this.meshIndex = options.meshIndex % this.meshes.length;
    this.creaseDegrees = this.meshes[this.meshIndex].creaseDegrees;
    void this.request(this.meshIndex);
    this.hud.showBanner(this.meshes[this.meshIndex].name);
  }

  public get index(): number {
    return this.pendingIndex ?? this.meshIndex;
  }

  public get current(): MeshEntry {
    return this.meshes[this.meshIndex];
  }

  // The mesh on screen, once it has loaded.
  public get topology(): MeshTopology | null {
    return this.loaded.get(this.meshIndex) ?? null;
  }

  public get edgeCounts(): Readonly<EdgeCounts> {
    return this.counts;
  }

  // Resolves once the given mesh has loaded; for tests, and for showing a mesh as soon as it is ready.
  public async whenLoaded(index = this.index): Promise<void> {
    await this.request(index);
  }

  public update(deltaSeconds: number): void {
    this.hud.update(deltaSeconds);
    this.updateFade(deltaSeconds);
    if (this.isPaused) return;
    if (this.autoCamera) {
      this.cameraSeconds += deltaSeconds;
      this.yaw += AUTO_YAW_PER_SECOND * deltaSeconds;
      this.pitch = 0.32 + 0.2 * Math.sin(this.cameraSeconds * 0.21);
    }
    if (this.autoCycle && this.topology) {
      this.autoSeconds += deltaSeconds;
      if (this.autoSeconds >= AUTO_SECONDS) this.changeMesh(1);
    }
  }

  public draw(displayList: DisplayList, frame: DemoFrame): void {
    const topology = this.topology;
    if (!topology) {
      this.counts = { silhouette: 0, crease: 0, other: 0, segments: 0 };
      return;
    }
    this.counts = this.renderer.draw(
      displayList,
      topology,
      {
        yaw: this.yaw,
        pitch: this.pitch,
        centreX: frame.width / 2,
        centreY: frame.height / 2,
        scale: Math.min(frame.width, frame.height) * MESH_SHARE * this.zoom,
        creaseDegrees: this.creaseDegrees,
        mode: this.mode,
        hiddenLines: this.hiddenLines,
      },
      this.fade,
    );
  }

  public drawOverlay(displayList: DisplayList, frame: DemoFrame): void {
    const topology = this.topology;
    const entry = this.current;
    this.hud.draw(displayList, {
      title: "FEATURE EDGES",
      statusLines: [
        `${entry.name}  ${entry.credit}`,
        topology
          ? `${topology.faceCount} TRIANGLES  ${topology.edgeCount} EDGES  DRAWN: ${this.counts.silhouette} SILHOUETTE  ${this.counts.crease} CREASE${this.mode === "ALL EDGES" ? `  ${this.counts.other} OTHER` : ""}`
          : "LOADING",
        `${this.mode}  HIDDEN LINES ${this.hiddenLines ? "REMOVED" : "SHOWN"}  CREASE OVER ${this.creaseDegrees} DEGREES  SEGMENTS ${this.counts.segments}${this.isPaused ? "  PAUSED" : ""}`,
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

  // Fades the current mesh out and the next (or previous) one in, loading it if need be.
  public changeMesh(delta: number): void {
    const count = this.meshes.length;
    this.pendingIndex = (((this.index + delta) % count) + count) % count;
    this.autoSeconds = 0;
    void this.request(this.pendingIndex);
    this.hud.showBanner(this.meshes[this.pendingIndex].name);
  }

  public toggleMode(): void {
    this.mode = this.mode === "FEATURES" ? "ALL EDGES" : "FEATURES";
    this.hud.showBanner(this.mode);
  }

  public toggleHiddenLines(): void {
    this.hiddenLines = !this.hiddenLines;
    this.hud.showBanner(this.hiddenLines ? "HIDDEN LINES REMOVED" : "HIDDEN LINES SHOWN");
  }

  public changeCrease(delta: number): void {
    this.creaseDegrees = Math.max(MIN_CREASE_DEGREES, Math.min(MAX_CREASE_DEGREES, this.creaseDegrees + delta));
    this.hud.showBanner(`CREASE OVER ${this.creaseDegrees} DEGREES`);
  }

  public toggleAuto(): void {
    this.autoCycle = !this.autoCycle;
    this.autoSeconds = 0;
    this.hud.showBanner(`AUTO ${this.autoCycle ? "ON" : "OFF"}`);
  }

  public toggleAutoCamera(): void {
    this.autoCamera = !this.autoCamera;
    this.hud.showBanner(`AUTO CAMERA ${this.autoCamera ? "ON" : "OFF"}`);
  }

  public cycleTrails(): void {
    this.trailIndex = (this.trailIndex + 1) % TRAIL_MODES.length;
    this.onTrailChange(TRAIL_MODES[this.trailIndex].halfLifeMilliseconds);
    this.hud.showBanner(`TRAILS ${TRAIL_MODES[this.trailIndex].name}`);
  }

  // Dragging takes over from the automatic turning.
  public rotateBy(deltaYaw: number, deltaPitch: number): void {
    this.autoCamera = false;
    this.yaw += deltaYaw;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + deltaPitch));
  }

  public zoomBy(factor: number): void {
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
  }

  // --- Internals -----------------------------------------------------------------------------------------

  private request(index: number): Promise<void> {
    let pending = this.requests.get(index);
    if (!pending) {
      pending = this.load(index);
      this.requests.set(index, pending);
    }
    return pending;
  }

  private async load(index: number): Promise<void> {
    this.loading.add(index);
    try {
      this.loaded.set(index, buildTopology(await this.meshes[index].load()));
    } catch (error) {
      console.error(error);
      this.hud.showBanner(`COULD NOT LOAD ${this.meshes[index].name}`);
      // Forget the attempt, so asking again tries again.
      this.requests.delete(index);
    } finally {
      this.loading.delete(index);
    }
  }

  private updateFade(deltaSeconds: number): void {
    const step = deltaSeconds / FADE_SECONDS;
    if (this.pendingIndex === null) {
      this.fade = this.topology ? Math.min(1, this.fade + step) : 0;
      return;
    }
    this.fade = Math.max(0, this.fade - step);
    // Hold on the dark frame until the next mesh has arrived.
    if (this.fade === 0 && !this.loading.has(this.pendingIndex)) {
      this.meshIndex = this.pendingIndex;
      this.pendingIndex = null;
      this.creaseDegrees = this.current.creaseDegrees;
    }
  }
}
