import { createSeededRandom } from "@vector-demos/demo-kit";

export interface Star {
  readonly lng: number;
  readonly lat: number;
  // 0 = brightness bucket of the faintest stars, 2 = the brightest few.
  readonly magnitude: 0 | 1 | 2;
  readonly isWarm: boolean;
}

// A fixed sky: stars spread evenly over a sphere (uniform in sin(latitude)), mostly faint,
// a few bright, and about one in five warm-colored.
export function createStars(count: number, seed = 1977): Star[] {
  const random = createSeededRandom(seed);
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    const lat = (Math.asin(2 * random() - 1) * 180) / Math.PI;
    const lng = random() * 360 - 180;
    const roll = random();
    stars.push({ lng, lat, magnitude: roll < 0.7 ? 0 : roll < 0.94 ? 1 : 2, isWarm: random() < 0.2 });
  }
  return stars;
}
