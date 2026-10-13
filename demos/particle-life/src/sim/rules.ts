import { randomBetween, type RandomSource } from "@vector-demos/demo-kit";

// How strongly each species is drawn to each other species.
// attraction[a * speciesCount + b] is how species a reacts to species b, from -1 (flee) to 1 (approach).
// The matrix is not symmetric: that asymmetry is what makes the particles chase, orbit and swim.
export interface Rules {
  readonly speciesCount: number;
  readonly attraction: Float32Array;
}

export interface RulePreset {
  readonly name: string;
  readonly create: (random: RandomSource, speciesCount: number) => Rules;
}

function buildRules(speciesCount: number, valueAt: (from: number, to: number) => number): Rules {
  const attraction = new Float32Array(speciesCount * speciesCount);
  for (let from = 0; from < speciesCount; from++) {
    for (let to = 0; to < speciesCount; to++) {
      attraction[from * speciesCount + to] = clampUnit(valueAt(from, to));
    }
  }
  return { speciesCount, attraction };
}

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function isNext(from: number, to: number, speciesCount: number): boolean {
  return to === (from + 1) % speciesCount;
}

export function createRandomRules(random: RandomSource, speciesCount: number): Rules {
  return buildRules(speciesCount, () => randomBetween(random, -1, 1));
}

export const RULE_PRESETS: readonly RulePreset[] = [
  { name: "CHAOS", create: createRandomRules },
  {
    // Each species follows the next, forming snakes and ribbons.
    name: "CHAINS",
    create: (random, speciesCount) =>
      buildRules(speciesCount, (from, to) => {
        if (from === to) return randomBetween(random, 0.4, 0.8);
        if (isNext(from, to, speciesCount)) return randomBetween(random, 0.5, 1);
        return randomBetween(random, -0.4, 0.1);
      }),
  },
  {
    // Strong self-attraction and mild dislike of others makes membrane-bound cells.
    name: "CELLS",
    create: (random, speciesCount) =>
      buildRules(speciesCount, (from, to) =>
        from === to ? randomBetween(random, 0.6, 1) : randomBetween(random, -0.6, 0.25),
      ),
  },
  {
    // Each species hunts the next and flees the previous.
    name: "PREDATORS",
    create: (random, speciesCount) =>
      buildRules(speciesCount, (from, to) => {
        if (from === to) return randomBetween(random, 0.1, 0.5);
        if (isNext(from, to, speciesCount)) return randomBetween(random, 0.7, 1);
        if (isNext(to, from, speciesCount)) return randomBetween(random, -1, -0.6);
        return randomBetween(random, -0.2, 0.2);
      }),
  },
];

export function blendRules(from: Float32Array, to: Float32Array, amount: number, out: Float32Array): void {
  for (let index = 0; index < out.length; index++) out[index] = from[index] + (to[index] - from[index]) * amount;
}

// Nudges every entry by up to maxChange, so a living pattern drifts instead of being replaced.
export function mutateRules(rules: Rules, random: RandomSource, maxChange: number): Rules {
  const attraction = rules.attraction.map((value) => clampUnit(value + randomBetween(random, -maxChange, maxChange)));
  return { speciesCount: rules.speciesCount, attraction };
}
