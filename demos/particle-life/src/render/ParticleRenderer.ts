import { SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList, type ShapePlacement } from "@vector-display/core";
import { DynamicGeometry } from "@vector-demos/demo-kit";
import type { ParticleWorld } from "../sim/ParticleWorld.js";
import type { Camera } from "./Camera.js";
import { createSpeciesPalette } from "./palette.js";

// Particles are bucketed by speed so faster ones burn brighter; each bucket is one draw entry per species.
const SPEED_BUCKETS: readonly { readonly maxSpeed: number; readonly intensity: number }[] = [
  { maxSpeed: 25, intensity: 0.7 },
  { maxSpeed: 90, intensity: 1 },
  { maxSpeed: Infinity, intensity: 1.35 },
];
const STROKE_SECONDS = 0.045;
const MAX_STROKE_LENGTH = 16;

// Draws each particle as a short stroke pointing back along its velocity, so motion shows even without trails.
export class ParticleRenderer {
  private palette: BeamColor[] = [];
  private geometries: DynamicGeometry[] = [];
  private readonly placements: ShapePlacement[] = SPEED_BUCKETS.map((bucket) => ({
    ...SCREEN_SPACE_PLACEMENT,
    intensity: bucket.intensity,
  }));

  public get speciesColors(): readonly BeamColor[] {
    return this.palette;
  }

  public draw(displayList: DisplayList, world: ParticleWorld, camera: Camera): void {
    this.ensureSpecies(world.speciesCount);
    for (const geometry of this.geometries) geometry.clear();

    const { positionX, positionY, velocityX, velocityY, species } = world;
    const strokeScale = STROKE_SECONDS * camera.zoom;
    const maxLength = MAX_STROKE_LENGTH * camera.zoom;
    const margin = maxLength;
    const right = world.width + margin;
    const bottom = world.height + margin;
    const bucketCount = SPEED_BUCKETS.length;

    for (let i = 0; i < world.particleCount; i++) {
      const head = camera.toScreen(positionX[i], positionY[i]);
      const headX = head.x;
      const headY = head.y;
      if (headX < -margin || headY < -margin || headX > right || headY > bottom) continue;
      const speed = Math.hypot(velocityX[i], velocityY[i]);
      let tailX = headX - velocityX[i] * strokeScale;
      let tailY = headY - velocityY[i] * strokeScale;
      const length = speed * strokeScale;
      if (length > maxLength) {
        const shorten = maxLength / length;
        tailX = headX + (tailX - headX) * shorten;
        tailY = headY + (tailY - headY) * shorten;
      }
      let bucket = 0;
      while (speed > SPEED_BUCKETS[bucket].maxSpeed) bucket++;
      this.geometries[species[i] * bucketCount + bucket].addSegment(tailX, tailY, headX, headY);
    }

    for (let speciesIndex = 0; speciesIndex < world.speciesCount; speciesIndex++) {
      displayList.setColor(this.palette[speciesIndex]);
      for (let bucket = 0; bucket < bucketCount; bucket++) {
        const geometry = this.geometries[speciesIndex * bucketCount + bucket];
        if (geometry.segmentCount > 0) displayList.addShape(geometry, this.placements[bucket]);
      }
    }
  }

  private ensureSpecies(speciesCount: number): void {
    if (this.palette.length === speciesCount) return;
    this.palette = createSpeciesPalette(speciesCount);
    this.geometries = [];
    for (let index = 0; index < speciesCount * SPEED_BUCKETS.length; index++) {
      this.geometries.push(new DynamicGeometry(1024));
    }
  }
}
