import type { RandomSource } from "@vector-demos/demo-kit";
import { interactionForce } from "./force.js";
import type { Rules } from "./rules.js";

export interface ParticleWorldSettings {
  // World units within which particles affect each other.
  interactionRadius: number;
  // Fraction of the interaction radius inside which every pair repels.
  repulsionRadius: number;
  forceScale: number;
  frictionHalfLifeSeconds: number;
}

export interface Attractor {
  readonly x: number;
  readonly y: number;
  // Positive pulls particles in, negative pushes them away.
  readonly strength: number;
  readonly radius: number;
}

export interface ParticleWorldOptions extends Partial<ParticleWorldSettings> {
  readonly width: number;
  readonly height: number;
  readonly particleCount: number;
  readonly rules: Rules;
  readonly random: RandomSource;
}

const ATTRACTOR_ACCELERATION = 2400;

// Particle Life on a torus. Particles of each species attract or repel other species according to the rules,
// and a uniform grid limits each particle's neighbor search to the 3×3 cells around it.
export class ParticleWorld {
  public width: number;
  public height: number;
  public particleCount = 0;
  public speciesCount: number;
  public attraction: Float32Array;
  public positionX = new Float32Array(0);
  public positionY = new Float32Array(0);
  public velocityX = new Float32Array(0);
  public velocityY = new Float32Array(0);
  public species = new Uint8Array(0);
  // Interleaved x, y per particle, from the latest computeAccelerations().
  public acceleration = new Float32Array(0);
  public readonly settings: ParticleWorldSettings;

  private readonly random: RandomSource;
  private attractor: Attractor | null = null;
  private gridColumns = 0;
  private gridRows = 0;
  private cellStart = new Int32Array(0);
  private particleCell = new Int32Array(0);
  private sortedParticles = new Int32Array(0);
  private sortedX = new Float32Array(0);
  private sortedY = new Float32Array(0);
  private sortedSpecies = new Uint8Array(0);
  private fillCursor = new Int32Array(0);
  private readonly neighborCells = new Int32Array(9);
  private readonly pullScratch = { x: 0, y: 0 };

  public constructor(options: ParticleWorldOptions) {
    this.width = options.width;
    this.height = options.height;
    this.random = options.random;
    this.settings = {
      interactionRadius: options.interactionRadius ?? 70,
      repulsionRadius: options.repulsionRadius ?? 0.3,
      forceScale: options.forceScale ?? 10,
      frictionHalfLifeSeconds: options.frictionHalfLifeSeconds ?? 0.04,
    };
    this.speciesCount = options.rules.speciesCount;
    this.attraction = Float32Array.from(options.rules.attraction);
    this.setParticleCount(options.particleCount);
  }

  public setParticleCount(particleCount: number): void {
    this.particleCount = particleCount;
    this.positionX = new Float32Array(particleCount);
    this.positionY = new Float32Array(particleCount);
    this.velocityX = new Float32Array(particleCount);
    this.velocityY = new Float32Array(particleCount);
    this.species = new Uint8Array(particleCount);
    this.acceleration = new Float32Array(particleCount * 2);
    this.particleCell = new Int32Array(particleCount);
    this.sortedParticles = new Int32Array(particleCount);
    this.sortedX = new Float32Array(particleCount);
    this.sortedY = new Float32Array(particleCount);
    this.sortedSpecies = new Uint8Array(particleCount);
    this.scatter();
  }

  // Random positions, zero velocity, species dealt out in turn.
  public scatter(): void {
    for (let i = 0; i < this.particleCount; i++) {
      this.positionX[i] = this.random() * this.width;
      this.positionY[i] = this.random() * this.height;
      this.velocityX[i] = 0;
      this.velocityY[i] = 0;
      this.species[i] = i % this.speciesCount;
    }
  }

  // Replaces the attraction matrix. A new species count reassigns species but keeps positions.
  public setRules(rules: Rules): void {
    if (rules.speciesCount !== this.speciesCount) {
      this.speciesCount = rules.speciesCount;
      this.attraction = new Float32Array(rules.speciesCount * rules.speciesCount);
      for (let i = 0; i < this.particleCount; i++) this.species[i] = i % this.speciesCount;
    }
    this.attraction.set(rules.attraction);
  }

  public setAttractor(attractor: Attractor | null): void {
    this.attractor = attractor;
  }

  public resize(width: number, height: number): void {
    const scaleX = width / this.width;
    const scaleY = height / this.height;
    for (let i = 0; i < this.particleCount; i++) {
      this.positionX[i] = Math.min(this.positionX[i] * scaleX, width - 1e-3);
      this.positionY[i] = Math.min(this.positionY[i] * scaleY, height - 1e-3);
    }
    this.width = width;
    this.height = height;
  }

  public step(deltaSeconds: number): void {
    this.computeAccelerations();
    const friction = Math.pow(0.5, deltaSeconds / this.settings.frictionHalfLifeSeconds);
    const { positionX, positionY, velocityX, velocityY, acceleration, width, height } = this;
    for (let i = 0; i < this.particleCount; i++) {
      velocityX[i] = velocityX[i] * friction + acceleration[i * 2] * deltaSeconds;
      velocityY[i] = velocityY[i] * friction + acceleration[i * 2 + 1] * deltaSeconds;
      let x = positionX[i] + velocityX[i] * deltaSeconds;
      let y = positionY[i] + velocityY[i] * deltaSeconds;
      x -= Math.floor(x / width) * width;
      y -= Math.floor(y / height) * height;
      // Float rounding can land exactly on the far edge.
      positionX[i] = x >= width ? 0 : x;
      positionY[i] = y >= height ? 0 : y;
    }
  }

  public computeAccelerations(): void {
    this.buildGrid();
    const { attraction, speciesCount, acceleration, width, height } = this;
    const { sortedX, sortedY, sortedSpecies, sortedParticles, cellStart } = this;
    const { interactionRadius, repulsionRadius, forceScale } = this.settings;
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const radiusSquared = interactionRadius * interactionRadius;
    const inverseRadius = 1 / interactionRadius;
    const outputScale = interactionRadius * forceScale;
    const columns = this.gridColumns;
    const rows = this.gridRows;
    const neighborCells = this.neighborCells;

    // Cell by cell, so all particles in a cell share one neighbor list and read memory that is close together.
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const cell = row * columns + column;
        if (cellStart[cell] === cellStart[cell + 1]) continue;
        let neighborCount = 0;
        for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
          const neighborRow = (row + rowOffset + rows) % rows;
          for (let columnOffset = -1; columnOffset <= 1; columnOffset++) {
            neighborCells[neighborCount++] = neighborRow * columns + ((column + columnOffset + columns) % columns);
          }
        }

        for (let slot = cellStart[cell]; slot < cellStart[cell + 1]; slot++) {
          const x = sortedX[slot];
          const y = sortedY[slot];
          const attractionRow = sortedSpecies[slot] * speciesCount;
          let sumX = 0;
          let sumY = 0;
          for (let neighbor = 0; neighbor < 9; neighbor++) {
            const neighborCell = neighborCells[neighbor];
            const end = cellStart[neighborCell + 1];
            for (let other = cellStart[neighborCell]; other < end; other++) {
              let dx = sortedX[other] - x;
              let dy = sortedY[other] - y;
              if (dx > halfWidth) dx -= width;
              else if (dx < -halfWidth) dx += width;
              if (dy > halfHeight) dy -= height;
              else if (dy < -halfHeight) dy += height;
              const distanceSquared = dx * dx + dy * dy;
              // Also skips the particle itself, at distance zero.
              if (distanceSquared <= 0 || distanceSquared >= radiusSquared) continue;
              const distance = Math.sqrt(distanceSquared);
              const force = interactionForce(
                distance * inverseRadius,
                attraction[attractionRow + sortedSpecies[other]],
                repulsionRadius,
              );
              const scale = force / distance;
              sumX += dx * scale;
              sumY += dy * scale;
            }
          }

          let accelerationX = sumX * outputScale;
          let accelerationY = sumY * outputScale;
          if (this.attractor) {
            const pull = this.attractorPull(x, y);
            accelerationX += pull.x;
            accelerationY += pull.y;
          }
          const particle = sortedParticles[slot];
          acceleration[particle * 2] = accelerationX;
          acceleration[particle * 2 + 1] = accelerationY;
        }
      }
    }
  }

  private attractorPull(x: number, y: number): { x: number; y: number } {
    const attractor = this.attractor!;
    const pull = this.pullScratch;
    pull.x = 0;
    pull.y = 0;
    let dx = attractor.x - x;
    let dy = attractor.y - y;
    if (dx > this.width / 2) dx -= this.width;
    else if (dx < -this.width / 2) dx += this.width;
    if (dy > this.height / 2) dy -= this.height;
    else if (dy < -this.height / 2) dy += this.height;
    const distance = Math.hypot(dx, dy);
    if (distance < 1 || distance > attractor.radius) return pull;
    const falloff = 1 - distance / attractor.radius;
    const magnitude = (ATTRACTOR_ACCELERATION * attractor.strength * falloff) / distance;
    pull.x = dx * magnitude;
    pull.y = dy * magnitude;
    return pull;
  }

  // Counting sort of particles into grid cells at least one interaction radius wide.
  private buildGrid(): void {
    const radius = this.settings.interactionRadius;
    const columns = Math.max(3, Math.floor(this.width / radius));
    const rows = Math.max(3, Math.floor(this.height / radius));
    if (columns !== this.gridColumns || rows !== this.gridRows) {
      this.gridColumns = columns;
      this.gridRows = rows;
      this.cellStart = new Int32Array(columns * rows + 1);
    }
    const cellStart = this.cellStart;
    cellStart.fill(0);
    const cellWidth = this.width / columns;
    const cellHeight = this.height / rows;
    for (let i = 0; i < this.particleCount; i++) {
      const column = Math.min(columns - 1, Math.floor(this.positionX[i] / cellWidth));
      const row = Math.min(rows - 1, Math.floor(this.positionY[i] / cellHeight));
      const cell = row * columns + column;
      this.particleCell[i] = cell;
      cellStart[cell + 1]++;
    }
    for (let cell = 0; cell < columns * rows; cell++) cellStart[cell + 1] += cellStart[cell];
    if (this.fillCursor.length !== cellStart.length) this.fillCursor = new Int32Array(cellStart.length);
    const fillCursor = this.fillCursor;
    fillCursor.set(cellStart);
    for (let i = 0; i < this.particleCount; i++) {
      const slot = fillCursor[this.particleCell[i]]++;
      this.sortedParticles[slot] = i;
      this.sortedX[slot] = this.positionX[i];
      this.sortedY[slot] = this.positionY[i];
      this.sortedSpecies[slot] = this.species[i];
    }
  }
}
