import type { RandomSource } from "@vector-demos/demo-kit";
import type { Page } from "./pageLayout.js";

// The scene in three dimensions: x to the right, y up, z away from the viewer, who
// sits at the origin. The page lies on a plane that starts below and in front of
// the viewer and rises gently into the distance, so text sliding along it shrinks
// toward a vanishing point near the top of the screen.
export const PLANE_ELEVATION = (24 * Math.PI) / 180;
const PLANE_RISE = Math.sin(PLANE_ELEVATION);
const PLANE_RUN = Math.cos(PLANE_ELEVATION);
// Where a page's first line starts: this far below the eye and this far ahead.
const PLANE_DROP = 78;
const PLANE_START_DEPTH = 40;

export type CrawlPhase = "ASSEMBLE" | "CRAWL" | "SHATTER";

export const ASSEMBLE_SECONDS = 2.4;
export const SHATTER_SECONDS = 4.2;
// Page units per second that the text slides away at speed 1.
export const CRAWL_SPEED = 4.5;
// A page appears with its last line this far along the plane, which puts the whole
// page on screen, and is done once that line has slid this far.
export const ENTRY_DISTANCE = 55;
export const EXIT_DISTANCE = 270;

const FLOATS = 6;

// A point on the page, `distance` further along the plane than where it started, in the scene.
export function pageToScene(pageX: number, pageY: number, distance: number, out: Float32Array, offset: number): void {
  const along = pageY + distance;
  out[offset] = pageX;
  out[offset + 1] = -PLANE_DROP + along * PLANE_RISE;
  out[offset + 2] = PLANE_START_DEPTH + along * PLANE_RUN;
}

// Where a ray from the eye through (directionX, directionY, 1) meets the plane, or null if it never does.
export function rayToPlane(directionX: number, directionY: number): [number, number, number] | null {
  // Points on the plane satisfy y * run - (z - start) * rise = -drop * run.
  const denominator = directionY * PLANE_RUN - PLANE_RISE;
  if (Math.abs(denominator) < 1e-6) return null;
  const distance = (-PLANE_DROP * PLANE_RUN - PLANE_START_DEPTH * PLANE_RISE) / denominator;
  if (distance <= 0) return null;
  return [directionX * distance, directionY * distance, distance];
}

// The strokes of the current page as free bodies. Most of the time each one sits
// in its place in the text. When the page shatters every stroke becomes a small
// spinning stick thrown outward; when the next page assembles, its strokes fly in
// from scattered places and settle into words.
export class CrawlScene {
  public phase: CrawlPhase = "ASSEMBLE";
  public pageIndex = 0;
  // How far the page has slid along the plane.
  public distance = 0;
  // Seconds into the current phase.
  public phaseSeconds = 0;
  // Stroke end points in the scene: x0, y0, z0, x1, y1, z1 each.
  public current = new Float32Array(0);

  private home = new Float32Array(0);
  // Each loose stroke as a centre, half its length as a vector, a velocity and a spin.
  private centre = new Float32Array(0);
  private half = new Float32Array(0);
  private velocity = new Float32Array(0);
  private spinAxis = new Float32Array(0);
  private spinRate = new Float32Array(0);

  public constructor(
    private readonly pages: readonly Page[],
    private readonly random: RandomSource,
  ) {
    if (pages.length === 0) throw new Error("a crawl needs at least one page");
    this.startPage(0);
  }

  public get page(): Page {
    return this.pages[this.pageIndex];
  }

  // 0 while strokes are still scattered, 1 once the page has come together.
  public get assembly(): number {
    if (this.phase === "CRAWL") return 1;
    if (this.phase === "SHATTER") return 0;
    const amount = Math.min(1, this.phaseSeconds / ASSEMBLE_SECONDS);
    return amount * amount * (3 - 2 * amount);
  }

  public update(deltaSeconds: number, speed: number): void {
    this.phaseSeconds += deltaSeconds;
    if (this.phase === "SHATTER") {
      this.fly(deltaSeconds);
      if (this.phaseSeconds >= SHATTER_SECONDS) this.startPage((this.pageIndex + 1) % this.pages.length);
      return;
    }
    this.distance += CRAWL_SPEED * speed * deltaSeconds;
    this.placeHome();
    if (this.phase === "ASSEMBLE") {
      this.gather();
      if (this.phaseSeconds >= ASSEMBLE_SECONDS) {
        this.phase = "CRAWL";
        this.phaseSeconds = 0;
      }
    } else {
      this.current.set(this.home);
      // The whole page has receded into the distance: break it up and bring on the next.
      if (this.distance - this.page.height > EXIT_DISTANCE) this.shatter(null);
    }
  }

  // Breaks the page into its strokes, thrown outward from `origin` (a point in the
  // scene), or from the middle of the text if none is given.
  public shatter(origin: readonly [number, number, number] | null): void {
    if (this.phase === "SHATTER") return;
    const count = this.page.segmentCount;
    const from = origin ?? this.middle();
    for (let stroke = 0; stroke < count; stroke++) {
      const offset = stroke * FLOATS;
      const base = stroke * 3;
      for (let axis = 0; axis < 3; axis++) {
        this.centre[base + axis] = (this.current[offset + axis] + this.current[offset + 3 + axis]) / 2;
        this.half[base + axis] = (this.current[offset + 3 + axis] - this.current[offset + axis]) / 2;
      }
      const awayX = this.centre[base] - from[0];
      const awayY = this.centre[base + 1] - from[1];
      const awayZ = this.centre[base + 2] - from[2];
      const range = Math.hypot(awayX, awayY, awayZ) + 1e-6;
      // Strokes near the blast are thrown hardest.
      const force = 110 + 340 / (1 + range / 40);
      this.velocity[base] = (awayX / range) * force + (this.random() - 0.5) * 130;
      // Up off the plane, and some of them straight at the viewer.
      this.velocity[base + 1] = (awayY / range) * force + (this.random() - 0.3) * 110;
      this.velocity[base + 2] = (awayZ / range) * force - this.random() * 210;
      this.randomAxis(this.spinAxis, base);
      this.spinRate[stroke] = (this.random() - 0.5) * 14;
    }
    this.phase = "SHATTER";
    this.phaseSeconds = 0;
  }

  public nextPage(): void {
    this.startPage((this.pageIndex + 1) % this.pages.length);
  }

  // --- Internals -----------------------------------------------------------------------------------------

  private startPage(index: number): void {
    this.pageIndex = index;
    const count = this.page.segmentCount;
    this.current = new Float32Array(count * FLOATS);
    this.home = new Float32Array(count * FLOATS);
    this.centre = new Float32Array(count * 3);
    this.half = new Float32Array(count * 3);
    this.velocity = new Float32Array(count * 3);
    this.spinAxis = new Float32Array(count * 3);
    this.spinRate = new Float32Array(count);
    this.distance = this.page.height + ENTRY_DISTANCE;
    this.phase = "ASSEMBLE";
    this.phaseSeconds = 0;
    this.placeHome();
    // Scatter: each stroke starts somewhere in the space in front of the viewer, at any angle.
    const { segments } = this.page;
    for (let stroke = 0; stroke < count; stroke++) {
      const base = stroke * 3;
      const length = Math.hypot(segments[stroke * 4 + 2] - segments[stroke * 4], segments[stroke * 4 + 3] - segments[stroke * 4 + 1]);
      this.centre[base] = (this.random() - 0.5) * 520;
      this.centre[base + 1] = -80 + this.random() * 300;
      this.centre[base + 2] = 70 + this.random() * 520;
      this.randomAxis(this.half, base);
      for (let axis = 0; axis < 3; axis++) this.half[base + axis] *= length / 2;
    }
    this.gather();
  }

  private placeHome(): void {
    const { segments, segmentCount } = this.page;
    for (let stroke = 0; stroke < segmentCount; stroke++) {
      pageToScene(segments[stroke * 4], segments[stroke * 4 + 1], this.distance, this.home, stroke * FLOATS);
      pageToScene(segments[stroke * 4 + 2], segments[stroke * 4 + 3], this.distance, this.home, stroke * FLOATS + 3);
    }
  }

  // Part-way from each stroke's scattered start to its place in the text.
  private gather(): void {
    const amount = this.assembly;
    const count = this.page.segmentCount;
    for (let stroke = 0; stroke < count; stroke++) {
      const offset = stroke * FLOATS;
      const base = stroke * 3;
      for (let axis = 0; axis < 3; axis++) {
        const startA = this.centre[base + axis] - this.half[base + axis];
        const startB = this.centre[base + axis] + this.half[base + axis];
        this.current[offset + axis] = startA + (this.home[offset + axis] - startA) * amount;
        this.current[offset + 3 + axis] = startB + (this.home[offset + 3 + axis] - startB) * amount;
      }
    }
  }

  private fly(deltaSeconds: number): void {
    const count = this.page.segmentCount;
    // A little drag, so the cloud slows and hangs instead of leaving at a constant speed.
    const drag = Math.exp(-0.9 * deltaSeconds);
    for (let stroke = 0; stroke < count; stroke++) {
      const base = stroke * 3;
      const offset = stroke * FLOATS;
      for (let axis = 0; axis < 3; axis++) {
        this.velocity[base + axis] *= drag;
        this.centre[base + axis] += this.velocity[base + axis] * deltaSeconds;
      }
      this.rotate(base, this.spinRate[stroke] * deltaSeconds);
      for (let axis = 0; axis < 3; axis++) {
        this.current[offset + axis] = this.centre[base + axis] - this.half[base + axis];
        this.current[offset + 3 + axis] = this.centre[base + axis] + this.half[base + axis];
      }
    }
  }

  // Turns a stroke's half-vector about its spin axis (Rodrigues' rotation).
  private rotate(base: number, angle: number): void {
    const { half, spinAxis } = this;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const kx = spinAxis[base];
    const ky = spinAxis[base + 1];
    const kz = spinAxis[base + 2];
    const vx = half[base];
    const vy = half[base + 1];
    const vz = half[base + 2];
    const dot = kx * vx + ky * vy + kz * vz;
    half[base] = vx * cosine + (ky * vz - kz * vy) * sine + kx * dot * (1 - cosine);
    half[base + 1] = vy * cosine + (kz * vx - kx * vz) * sine + ky * dot * (1 - cosine);
    half[base + 2] = vz * cosine + (kx * vy - ky * vx) * sine + kz * dot * (1 - cosine);
  }

  private randomAxis(out: Float32Array, base: number): void {
    let x = 0;
    let y = 0;
    let z = 0;
    let length = 0;
    do {
      x = this.random() * 2 - 1;
      y = this.random() * 2 - 1;
      z = this.random() * 2 - 1;
      length = Math.hypot(x, y, z);
    } while (length > 1 || length < 1e-3);
    out[base] = x / length;
    out[base + 1] = y / length;
    out[base + 2] = z / length;
  }

  private middle(): [number, number, number] {
    const count = this.page.segmentCount;
    const total = [0, 0, 0];
    for (let stroke = 0; stroke < count; stroke++) {
      for (let axis = 0; axis < 3; axis++) total[axis] += this.current[stroke * FLOATS + axis];
    }
    return [total[0] / Math.max(1, count), total[1] / Math.max(1, count), total[2] / Math.max(1, count)];
  }
}
