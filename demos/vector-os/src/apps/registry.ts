import { createRandomSeed } from "@vector-demos/demo-kit";
import { createBeamPanel } from "./beamPanel.js";
import { createClock } from "./clock.js";
import type { AppEntry, OsApp } from "./OsApp.js";
import { createTerminal } from "./terminal.js";

const DEMO_SIZE = { width: 620, height: 400 };
// A demo shrunk into a window packs its lines closer together, so it is dimmed to match.
const DEMO_BRIGHTNESS = 0.75;

// Every program the OS can run. The tools are part of the OS. The demos are the
// site's own demos, unchanged: each is imported only when first launched, and
// constructed exactly as its own page constructs it.
//
// A few demos are given the pointer, where what a click means is simple. The rest
// are for watching; the box at the right of the title bar opens the real thing.
export const APP_ENTRIES: readonly AppEntry[] = [
  { id: "terminal", title: "Terminal", kind: "tool", size: { width: 560, height: 380 }, create: createTerminal },
  { id: "clock", title: "Clock", kind: "tool", size: { width: 300, height: 340 }, create: createClock },
  { id: "beam", title: "Beam Settings", kind: "tool", size: { width: 520, height: 350 }, create: createBeamPanel },
  {
    id: "particle-life",
    title: "Particle Life",
    kind: "demo",
    size: DEMO_SIZE,
    create: async () => {
      const { ParticleLifeDemo } = await import("@vector-demos/particle-life");
      return demoApp(new ParticleLifeDemo({ seed: createRandomSeed(), speciesCount: 6, particleCount: 2000, presetIndex: 0 }, 1600, 1000));
    },
  },
  {
    id: "lenia",
    title: "Lenia",
    kind: "demo",
    size: DEMO_SIZE,
    create: async () => {
      const { LeniaDemo } = await import("@vector-demos/lenia");
      return demoApp(new LeniaDemo(0));
    },
  },
  {
    id: "life",
    title: "Life on the Beam",
    kind: "demo",
    size: DEMO_SIZE,
    create: async () => {
      const { LifeDemo } = await import("@vector-demos/life");
      return demoApp(new LifeDemo(), { worldHeight: 640 });
    },
  },
  {
    id: "boids",
    title: "Boids on the Beam",
    kind: "demo",
    size: DEMO_SIZE,
    create: async () => {
      const { BoidsDemo } = await import("@vector-demos/boids");
      return demoApp(new BoidsDemo(), { worldHeight: 640 });
    },
  },
  {
    id: "slime-mold",
    title: "Slime Mold",
    kind: "demo",
    size: DEMO_SIZE,
    create: async () => {
      const { SlimeMoldDemo } = await import("@vector-demos/slime-mold");
      const demo = new SlimeMoldDemo({ seed: createRandomSeed(), agentCount: 8000, presetIndex: 0 });
      // Click or drag to drop food; with shift, to wipe.
      return demoApp(demo, { onPointer: (kind, x, y, shiftKey) => (kind === "down" || kind === "move") && demo.pointerAt(x, y, shiftKey) });
    },
  },
  {
    id: "ca-terrain",
    title: "Cellular Terrain",
    kind: "demo",
    size: DEMO_SIZE,
    create: async () => {
      const { CaTerrainDemo } = await import("@vector-demos/ca-terrain");
      return demoApp(new CaTerrainDemo({ seed: createRandomSeed(), ruleIndex: 0, cameraIndex: 0 }));
    },
  },
  {
    id: "biomorphs",
    title: "Biomorphs",
    kind: "demo",
    size: { width: 520, height: 520 },
    create: async () => {
      const { BiomorphDemo } = await import("@vector-demos/biomorphs");
      const demo = new BiomorphDemo({ seed: createRandomSeed() });
      return demoApp(demo, {
        brightness: 1,
        // Click a child to breed from it, as on the demo's own page.
        onPointer: (kind, x, y) => {
          const picked = demo.pickAt(x, y);
          if (kind === "down" && picked !== null && picked >= 0) demo.choose(picked);
          else if (kind === "hover") demo.setHovered(picked !== null && picked >= 0 ? picked : null);
        },
      });
    },
  },
  {
    id: "attractors",
    title: "Strange Attractors",
    kind: "demo",
    size: DEMO_SIZE,
    create: async () => {
      const { AttractorsDemo } = await import("@vector-demos/attractors");
      return demoApp(new AttractorsDemo({ seed: createRandomSeed(), attractorIndex: 0, particleCount: 2500 }));
    },
  },
  {
    id: "gray-scott",
    title: "Gray-Scott",
    kind: "demo",
    size: DEMO_SIZE,
    create: async () => {
      const { GrayScottDemo } = await import("@vector-demos/gray-scott");
      const demo = new GrayScottDemo({ seed: createRandomSeed(), presetIndex: 0 });
      return demoApp(demo, { onPointer: (kind, x, y, shiftKey) => (kind === "down" || kind === "move") && demo.pointerAt(x, y, shiftKey) });
    },
  },
  {
    id: "polytopes",
    title: "4D Polytopes",
    kind: "demo",
    size: { width: 520, height: 460 },
    create: async () => {
      const { PolytopesDemo } = await import("@vector-demos/polytopes");
      return demoApp(new PolytopesDemo({ seed: createRandomSeed(), polytopeIndex: 3, projection: "PERSPECTIVE" }), { brightness: 1 });
    },
  },
  {
    id: "oscilloscope",
    title: "Oscilloscope",
    kind: "demo",
    size: { width: 480, height: 460 },
    create: async () => {
      const { OscilloscopeDemo } = await import("@vector-demos/oscilloscope");
      // Silent here: sound belongs to the demo's own page.
      return demoApp(new OscilloscopeDemo({ programIndex: 2 }), { brightness: 1 });
    },
  },
  {
    id: "text-crawl",
    title: "Text Crawl",
    kind: "demo",
    size: DEMO_SIZE,
    create: async () => {
      const { DEFAULT_PAGES, TextCrawlDemo } = await import("@vector-demos/text-crawl");
      const demo = new TextCrawlDemo({ seed: createRandomSeed(), pages: DEFAULT_PAGES });
      return demoApp(demo, { brightness: 1, onPointer: (kind, x, y) => kind === "down" && demo.shatterAt(x, y) });
    },
  },
  {
    id: "epicycles",
    title: "Fourier Epicycles",
    kind: "demo",
    size: DEMO_SIZE,
    create: async () => {
      const { EpicyclesDemo } = await import("@vector-demos/epicycles");
      const demo = new EpicyclesDemo({ shapeIndex: 0 });
      return demoApp(demo, {
        brightness: 1,
        // Draw a shape for the circles to trace.
        onPointer: (kind, x, y) => {
          if (kind === "down") demo.beginSketch(x, y);
          else if (kind === "move") demo.extendSketch(x, y);
          else if (kind === "up") demo.endSketch();
        },
      });
    },
  },
  {
    id: "live-earth",
    title: "Live Earth",
    kind: "demo",
    size: { width: 600, height: 480 },
    create: async () => {
      const { createLiveEarth } = await import("@vector-demos/live-earth");
      const { demo, stop } = createLiveEarth();
      return demoApp(demo, { dispose: stop });
    },
  },
  {
    id: "meshes",
    title: "Feature Edges",
    kind: "demo",
    size: { width: 520, height: 460 },
    create: async () => {
      const { MeshesDemo } = await import("@vector-demos/meshes");
      return demoApp(new MeshesDemo({ meshIndex: 0 }), { brightness: 1 });
    },
  },
];

function demoApp(demo: OsApp["demo"], options: Partial<Omit<OsApp, "demo">> = {}): OsApp {
  return { demo, worldHeight: 1000, brightness: DEMO_BRIGHTNESS, ...options };
}
