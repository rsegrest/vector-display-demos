export type DemoGroup = "creative" | "simulation" | "alife" | "os";

// The index's groups, in its order: Vector OS's launcher's categories (its Creative, Simulation and
// Artificial Life hold these same demos), with Vector OS itself and the guide under Simulation.
export const DEMO_GROUPS: readonly { readonly id: DemoGroup; readonly title: string; readonly startsColumn: boolean }[] = [
  { id: "creative", title: "Creative", startsColumn: true },
  { id: "simulation", title: "Simulation", startsColumn: true },
  // In the middle column, under Simulation, when the screen is wide enough for three.
  { id: "os", title: "Vector OS and Guide", startsColumn: false },
  { id: "alife", title: "Artificial Life", startsColumn: true },
];

export interface DemoEntry {
  // Route under the site root, without slashes.
  readonly path: string;
  readonly group: DemoGroup;
  readonly title: string;
  readonly description: string;
}

// Every demo. Each one has a page at /<path>/ (see vite.config.ts).
const DEMOS: readonly DemoEntry[] = [
  {
    path: "particle-life",
    group: "alife",
    title: "Particle Life",
    description: "Species chase, orbit and swarm under asymmetric attraction rules",
  },
  {
    path: "lenia",
    group: "alife",
    title: "Lenia",
    description: "Continuous cellular life forms drawn as glowing topographic contours",
  },
  {
    path: "travel-globe",
    group: "simulation",
    title: "Travel Globe",
    description: "Rick's travels on a spinning vector globe, hatched in status colors",
  },
  {
    path: "life",
    group: "alife",
    title: "Life on the Beam",
    description: "Conway's Game of Life traced cell by cell, newborn cells burning white",
  },
  {
    path: "boids",
    group: "alife",
    title: "Boids on the Beam",
    description: "Reynolds flocking: separation, alignment and cohesion as glowing arrowheads",
  },
  {
    path: "slime-mold",
    group: "alife",
    title: "Slime Mold",
    description: "Physarum agents follow each other's trail, so the phosphor itself grows the network",
  },
  {
    path: "ca-terrain",
    group: "simulation",
    title: "Cellular Terrain",
    description: "One-dimensional cellular automata extruded as ridgelines you fly over",
  },
  {
    path: "biomorphs",
    group: "alife",
    title: "Biomorphs",
    description: "Dawkins' recursive creatures, bred by choosing one of eight mutant children",
  },
  {
    path: "attractors",
    group: "simulation",
    title: "Strange Attractors",
    description: "Thousands of particles flowing through Lorenz, Aizawa, Thomas and other chaotic systems",
  },
  {
    path: "gray-scott",
    group: "simulation",
    title: "Gray-Scott",
    description: "Reaction-diffusion growing coral, mazes and dividing spots, drawn as contour lines",
  },
  {
    path: "polytopes",
    group: "creative",
    title: "4D Polytopes",
    description: "The tesseract, 24-cell, 600-cell and their kin, rotating through the fourth dimension",
  },
  {
    path: "oscilloscope",
    group: "creative",
    title: "Oscilloscope",
    description: "Sound drawn as a beam: left channel across, right channel up, pictures you can hear",
  },
  {
    path: "text-crawl",
    group: "creative",
    title: "Text Crawl",
    description: "Words receding into the distance, then shattering into their strokes",
  },
  {
    path: "epicycles",
    group: "creative",
    title: "Fourier Epicycles",
    description: "Chains of turning circles that redraw any shape, including one you sketch",
  },
  {
    path: "live-earth",
    group: "simulation",
    title: "Live Earth",
    description: "Real satellites, the space station's track and this week's earthquakes on a wireframe globe",
  },
  {
    path: "meshes",
    group: "creative",
    title: "Feature Edges",
    description: "The teapot, the bunny and friends as line drawings: outline and folds only, hidden lines removed",
  },
  {
    path: "docs",
    group: "os",
    title: "Live Guide",
    description: "How the vector-display packages work, with every example editable and running",
  },
  {
    path: "os",
    group: "os",
    title: "Vector OS",
    description: "A desktop drawn by one beam: windows running the demos, a terminal, a clock",
  },
  {
    path: "vr",
    group: "os",
    title: "Vector OS VR",
    description: "Vector OS and its games on a big screen in a dark room, in a WebXR headset",
  },
];

// Every demo in menu order: group by group, each group in the order above.
export const DEMO_CATALOG: readonly DemoEntry[] = DEMO_GROUPS.flatMap((group) => DEMOS.filter((demo) => demo.group === group.id));
