import {
  DemoHost,
  bindEscapeToIndex,
  createRandomSeed,
  readIntegerParameter,
  showFatalError,
  toggleFullscreen,
} from "@vector-demos/demo-kit";
import { ATTRACTORS_WORLD_HEIGHT, AttractorsDemo, MAX_PARTICLES, MIN_PARTICLES, PARTICLE_STEP, TRAIL_MODES } from "./AttractorsDemo.js";
import { ATTRACTORS } from "./sim/attractors.js";

const DRAG_RADIANS_PER_PIXEL = 0.006;

// Runs the strange attractors full screen. ?attractor= (1-based), ?particles= and
// ?seed= pick the starting system and cloud.
export function startAttractors(canvas: HTMLCanvasElement): void {
  const demo = new AttractorsDemo({
    seed: readIntegerParameter("seed", createRandomSeed(), 0, 0x7fffffff),
    attractorIndex: readIntegerParameter("attractor", 1, 1, ATTRACTORS.length) - 1,
    particleCount: readIntegerParameter("particles", 3500, MIN_PARTICLES, MAX_PARTICLES),
  });

  let host: DemoHost;
  try {
    host = DemoHost.start(canvas, demo, {
      worldHeight: ATTRACTORS_WORLD_HEIGHT,
      maxStepsPerFrame: 2,
      lineStyle: { beamWidth: 1.3, glowRadius: 2.4, glowStrength: 0.16, endpointBrightness: 0.2, jointOverlap: 0 },
      phosphor: {
        persistenceHalfLifeMilliseconds: TRAIL_MODES[demo.trailIndex].halfLifeMilliseconds,
        bloomStrength: 0.5,
        bloomBlurIterations: 2,
        exposure: 1.3,
        flickerAmount: 0.02,
        flickerFrequencyHz: 12,
      },
    });
  } catch (error) {
    console.error(error);
    showFatalError("Strange Attractors needs WebGL2, which this browser did not provide.");
    return;
  }
  demo.onTrailChange = (halfLifeMilliseconds) => host.phosphor.setSettings({ persistenceHalfLifeMilliseconds: halfLifeMilliseconds });
  bindEscapeToIndex();

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    demo.noteActivity();
    let handled = true;
    switch (event.key) {
      case "n": case "N": case "ArrowRight": demo.changeAttractor(1); break;
      case "b": case "B": case "ArrowLeft": demo.changeAttractor(-1); break;
      case "a": case "A": demo.toggleAuto(); break;
      case "r": case "R": demo.scatter(); break;
      case "c": case "C": demo.toggleAutoCamera(); break;
      case "[": demo.changeParticleCount(-PARTICLE_STEP); break;
      case "]": demo.changeParticleCount(PARTICLE_STEP); break;
      case "-": case "_": case "ArrowDown": demo.changeSpeed(-1); break;
      case "=": case "+": case "ArrowUp": demo.changeSpeed(1); break;
      case "t": case "T": demo.cycleTrails(); break;
      case " ": demo.togglePause(); break;
      case "h": case "H": demo.toggleHud(); break;
      case "f": case "F": toggleFullscreen(); break;
      default: handled = false;
    }
    if (handled) {
      event.preventDefault();
      syncUrl(demo);
    }
  });

  let activePointer: number | null = null;
  let lastX = 0;
  let lastY = 0;
  canvas.style.cursor = "grab";
  canvas.addEventListener("pointerdown", (event) => {
    demo.noteActivity();
    activePointer = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    lastX = event.clientX;
    lastY = event.clientY;
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerId !== activePointer) {
      if (event.pointerType === "mouse") demo.noteActivity();
      return;
    }
    demo.rotateBy((event.clientX - lastX) * DRAG_RADIANS_PER_PIXEL, (event.clientY - lastY) * DRAG_RADIANS_PER_PIXEL);
    lastX = event.clientX;
    lastY = event.clientY;
  });
  const release = (event: PointerEvent) => {
    if (event.pointerId === activePointer) activePointer = null;
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      demo.noteActivity();
      demo.zoomBy(Math.exp(-event.deltaY * 0.0015));
    },
    { passive: false },
  );
  (window as unknown as { attractors: unknown }).attractors = { demo, host };
}

// Keeps the address bar shareable: the same URL reproduces the same starting cloud.
function syncUrl(demo: AttractorsDemo): void {
  const params = new URLSearchParams({
    seed: String(demo.currentSeed),
    attractor: String(demo.attractorIndex + 1),
    particles: String(demo.particleCount),
  });
  history.replaceState(null, "", `?${params}`);
}
