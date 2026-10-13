export interface DemoEntry {
  // Route under the site root, without slashes.
  readonly path: string;
  readonly title: string;
  readonly description: string;
}

// Every demo, in menu order. Each one has a page at /<path>/ (see vite.config.ts).
export const DEMO_CATALOG: readonly DemoEntry[] = [
  {
    path: "particle-life",
    title: "Particle Life",
    description: "Species chase, orbit and swarm under asymmetric attraction rules",
  },
  {
    path: "lenia",
    title: "Lenia",
    description: "Continuous cellular life forms drawn as glowing topographic contours",
  },
  {
    path: "travel-globe",
    title: "Travel Globe",
    description: "Rick's travels on a spinning vector globe, hatched in status colors",
  },
  {
    path: "life",
    title: "Life on the Beam",
    description: "Conway's Game of Life traced cell by cell, newborn cells burning white",
  },
  {
    path: "boids",
    title: "Boids on the Beam",
    description: "Reynolds flocking: separation, alignment and cohesion as glowing arrowheads",
  },
  {
    path: "slime-mold",
    title: "Slime Mold",
    description: "Physarum agents follow each other's trail, so the phosphor itself grows the network",
  },
  {
    path: "ca-terrain",
    title: "Cellular Terrain",
    description: "One-dimensional cellular automata extruded as ridgelines you fly over",
  },
  {
    path: "biomorphs",
    title: "Biomorphs",
    description: "Dawkins' recursive creatures, bred by choosing one of eight mutant children",
  },
  {
    path: "attractors",
    title: "Strange Attractors",
    description: "Thousands of particles flowing through Lorenz, Aizawa, Thomas and other chaotic systems",
  },
  {
    path: "gray-scott",
    title: "Gray-Scott",
    description: "Reaction-diffusion growing coral, mazes and dividing spots, drawn as contour lines",
  },
];
