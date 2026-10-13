import type { RandomSource } from "@vector-demos/demo-kit";
import { Fft2d } from "./fft.js";

// Shapes from the reference implementation (Chakazul/Lenia), where kn / gn = 1 is "polynomial".
export type KernelCoreShape = "polynomial" | "exponential";
export type GrowthShape = "polynomial" | "gaussian";

export interface LeniaParameters {
  // Kernel radius in cells.
  readonly radius: number;
  // Steps per unit time: each step moves cells by growth / timeSteps.
  readonly timeSteps: number;
  // Relative peak height of each concentric kernel ring, innermost first.
  readonly rings: readonly number[];
  // Center (mu) and width (sigma) of the growth function.
  readonly growthCenter: number;
  readonly growthWidth: number;
  readonly kernelCore?: KernelCoreShape;
  readonly growthShape?: GrowthShape;
}

// Smooth bumps on (0, 1) that peak at 1 when x = 0.5.
export function polynomialCore(x: number): number {
  if (x <= 0 || x >= 1) return 0;
  const bump = 4 * x * (1 - x);
  return bump * bump * bump * bump;
}

export function exponentialCore(x: number): number {
  if (x <= 0 || x >= 1) return 0;
  return Math.exp(4 - 1 / (x * (1 - x)));
}

// Growth mapped to [-1, 1]: cells whose neighborhood sum is near the center grow, others decay.
export function polynomialGrowth(potential: number, center: number, width: number): number {
  const offset = potential - center;
  const bump = Math.max(0, 1 - (offset * offset) / (9 * width * width));
  return 2 * bump * bump * bump * bump - 1;
}

export function gaussianGrowth(potential: number, center: number, width: number): number {
  const offset = potential - center;
  return 2 * Math.exp(-(offset * offset) / (2 * width * width)) - 1;
}

// Lenia on a torus: a continuous-state, continuous-space cellular automaton. Each step every cell
// takes a ring-shaped weighted average of its neighborhood (the "potential") and grows or decays
// depending on how close that average is to the growth center.
export class LeniaWorld {
  public readonly cells: Float32Array;
  public readonly potential: Float32Array;
  public kernel: Float32Array;
  public parameters: LeniaParameters;
  private readonly fft: Fft2d;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private kernelSpectrumRe: Float64Array;
  private kernelSpectrumIm: Float64Array;

  public constructor(
    public readonly width: number,
    public readonly height: number,
    parameters: LeniaParameters,
  ) {
    this.cells = new Float32Array(width * height);
    this.potential = new Float32Array(width * height);
    this.fft = new Fft2d(width, height);
    this.re = new Float64Array(width * height);
    this.im = new Float64Array(width * height);
    this.parameters = parameters;
    this.kernel = new Float32Array(width * height);
    this.kernelSpectrumRe = new Float64Array(width * height);
    this.kernelSpectrumIm = new Float64Array(width * height);
    this.setParameters(parameters);
  }

  public setParameters(parameters: LeniaParameters): void {
    this.parameters = parameters;
    this.buildKernel();
  }

  public step(): void {
    this.computePotential();
    const { cells, potential } = this;
    const { growthCenter, growthWidth, timeSteps } = this.parameters;
    const growth = this.parameters.growthShape === "gaussian" ? gaussianGrowth : polynomialGrowth;
    const deltaTime = 1 / timeSteps;
    for (let i = 0; i < cells.length; i++) {
      const next = cells[i] + deltaTime * growth(potential[i], growthCenter, growthWidth);
      cells[i] = next < 0 ? 0 : next > 1 ? 1 : next;
    }
  }

  // potential = kernel ⊛ cells (circular convolution), via the FFT.
  public computePotential(): void {
    const { re, im, cells, kernelSpectrumRe, kernelSpectrumIm } = this;
    for (let i = 0; i < cells.length; i++) {
      re[i] = cells[i];
      im[i] = 0;
    }
    this.fft.forward(re, im);
    for (let i = 0; i < re.length; i++) {
      const productRe = re[i] * kernelSpectrumRe[i] - im[i] * kernelSpectrumIm[i];
      im[i] = re[i] * kernelSpectrumIm[i] + im[i] * kernelSpectrumRe[i];
      re[i] = productRe;
    }
    this.fft.inverse(re, im);
    for (let i = 0; i < cells.length; i++) this.potential[i] = re[i];
  }

  // Writes a pattern centered on a point, wrapping at the edges. quarterTurns rotates it by 90° steps.
  public stamp(pattern: { width: number; height: number; cells: Float32Array }, centerX: number, centerY: number, quarterTurns = 0): void {
    const turns = ((quarterTurns % 4) + 4) % 4;
    const rotatedWidth = turns % 2 === 0 ? pattern.width : pattern.height;
    const rotatedHeight = turns % 2 === 0 ? pattern.height : pattern.width;
    const left = Math.round(centerX - rotatedWidth / 2);
    const top = Math.round(centerY - rotatedHeight / 2);
    for (let y = 0; y < pattern.height; y++) {
      for (let x = 0; x < pattern.width; x++) {
        const value = pattern.cells[y * pattern.width + x];
        if (value === 0) continue;
        const [rx, ry] =
          turns === 0 ? [x, y]
          : turns === 1 ? [pattern.height - 1 - y, x]
          : turns === 2 ? [pattern.width - 1 - x, pattern.height - 1 - y]
          : [y, pattern.width - 1 - x];
        const wx = (((left + rx) % this.width) + this.width) % this.width;
        const wy = (((top + ry) % this.height) + this.height) % this.height;
        this.cells[wy * this.width + wx] = value;
      }
    }
  }

  // Random values in a disk of the given radius (in cells), the usual way to start Lenia "soups".
  public seedPatch(random: RandomSource, centerX: number, centerY: number, radius: number, density = 1): void {
    this.forEachInDisk(centerX, centerY, radius, (index) => {
      if (random() < density) this.cells[index] = Math.max(this.cells[index], random());
    });
  }

  public erase(centerX: number, centerY: number, radius: number): void {
    this.forEachInDisk(centerX, centerY, radius, (index) => (this.cells[index] = 0));
  }

  public clear(): void {
    this.cells.fill(0);
  }

  public mass(): number {
    let total = 0;
    for (const value of this.cells) total += value;
    return total;
  }

  private forEachInDisk(centerX: number, centerY: number, radius: number, visit: (index: number) => void): void {
    const { width, height } = this;
    const reach = Math.ceil(radius);
    const roundedX = Math.round(centerX);
    const roundedY = Math.round(centerY);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const x = (((roundedX + dx) % width) + width) % width;
        const y = (((roundedY + dy) % height) + height) % height;
        visit(y * width + x);
      }
    }
  }

  // The kernel is stored wrapped around (0, 0) so the FFT product is a centered convolution.
  private buildKernel(): void {
    const { width, height } = this;
    const { radius, rings } = this.parameters;
    const kernelCore = this.parameters.kernelCore === "exponential" ? exponentialCore : polynomialCore;
    const kernel = new Float32Array(width * height);
    let total = 0;
    const reach = Math.ceil(radius);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const normalizedDistance = Math.hypot(dx, dy) / radius;
        if (normalizedDistance >= 1) continue;
        const ringPosition = rings.length * normalizedDistance;
        const ring = Math.min(Math.floor(ringPosition), rings.length - 1);
        const value = rings[ring] * kernelCore(ringPosition - ring);
        if (value === 0) continue;
        const x = ((dx % width) + width) % width;
        const y = ((dy % height) + height) % height;
        kernel[y * width + x] += value;
        total += value;
      }
    }
    for (let i = 0; i < kernel.length; i++) kernel[i] /= total;
    this.kernel = kernel;

    const spectrumRe = Float64Array.from(kernel);
    const spectrumIm = new Float64Array(kernel.length);
    this.fft.forward(spectrumRe, spectrumIm);
    this.kernelSpectrumRe = spectrumRe;
    this.kernelSpectrumIm = spectrumIm;
  }
}
