import {
  DemoHost,
  bindEscapeToIndex,
  createRandomSeed,
  readIntegerParameter,
  showFatalError,
  toggleFullscreen,
} from "@vector-demos/demo-kit";
import { RULE_PRESETS } from "./sim/rules.js";
import {
  MAX_PARTICLES,
  MAX_SPECIES,
  MIN_PARTICLES,
  MIN_SPECIES,
  ParticleLifeDemo,
  TRAIL_MODES,
} from "./ParticleLifeDemo.js";

const WORLD_HEIGHT = 1000;
const PARTICLE_STEP = 500;
const PAN_STEP = 40;

// Runs Particle Life full screen on the canvas, with keyboard, pointer and URL-parameter controls.
export function startParticleLife(canvas: HTMLCanvasElement): void {
  const aspect = (canvas.clientWidth || innerWidth) / Math.max(1, canvas.clientHeight || innerHeight);
  const demo = new ParticleLifeDemo(
    {
      seed: readIntegerParameter("seed", createRandomSeed(), 0, 0x7fffffff),
      speciesCount: readIntegerParameter("species", 6, MIN_SPECIES, MAX_SPECIES),
      particleCount: readIntegerParameter("particles", 3000, MIN_PARTICLES, MAX_PARTICLES),
      presetIndex: readIntegerParameter("preset", 0, 0, RULE_PRESETS.length - 1),
    },
    WORLD_HEIGHT * aspect,
    WORLD_HEIGHT,
  );

  let host: DemoHost;
  try {
    host = DemoHost.start(canvas, demo, {
      worldHeight: WORLD_HEIGHT,
      maxStepsPerFrame: 2,
      lineStyle: { beamWidth: 1.4, glowRadius: 2.4, glowStrength: 0.16, endpointBrightness: 0.25, jointOverlap: 0 },
      phosphor: {
        persistenceHalfLifeMilliseconds: TRAIL_MODES[demo.trailModeIndex].halfLifeMilliseconds,
        bloomStrength: 0.55,
        bloomBlurIterations: 2,
        exposure: 1.5,
        flickerAmount: 0.02,
        flickerFrequencyHz: 12,
      },
    });
  } catch (error) {
    console.error(error);
    showFatalError("Particle Life needs WebGL2, which this browser did not provide.");
    return;
  }

  demo.onTrailModeChange = (mode) => host.phosphor.setSettings({ persistenceHalfLifeMilliseconds: mode.halfLifeMilliseconds });
  bindKeyboard(demo, host);
  bindPointer(canvas, demo, host);
  bindEscapeToIndex();
  // Handy for poking at the demo from the console.
  (window as unknown as { particleLife: unknown }).particleLife = { demo, host };
}

function bindKeyboard(demo: ParticleLifeDemo, host: DemoHost): void {
  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    demo.noteActivity();
    let handled = true;
    switch (event.key) {
      case "r": case "R": demo.newRules(); break;
      case "m": case "M": demo.mutate(); break;
      case "p": case "P": demo.nextPreset(); break;
      case "e": case "E": demo.toggleEvolve(); break;
      case "t": case "T": demo.cycleTrails(); break;
      case "c": case "C": demo.toggleAutoCamera(); break;
      case "h": case "H": demo.toggleHud(); break;
      case "0": demo.resetView(); break;
      case "[": demo.changeSpecies(-1); break;
      case "]": demo.changeSpecies(1); break;
      case "-": case "_": demo.changeParticleCount(-PARTICLE_STEP); break;
      case "=": case "+": demo.changeParticleCount(PARTICLE_STEP); break;
      case " ": demo.togglePause(); break;
      case ".": demo.isPaused = true; host.stepOnce(); break;
      case "ArrowLeft": demo.panBy(-PAN_STEP, 0); break;
      case "ArrowRight": demo.panBy(PAN_STEP, 0); break;
      case "ArrowUp": demo.panBy(0, -PAN_STEP); break;
      case "ArrowDown": demo.panBy(0, PAN_STEP); break;
      case "f": case "F": toggleFullscreen(); break;
      default: handled = false;
    }
    if (handled) {
      event.preventDefault();
      syncUrl(demo);
    }
  });
}

function bindPointer(canvas: HTMLCanvasElement, demo: ParticleLifeDemo, host: DemoHost): void {
  let activePointer: number | null = null;
  let strength = 0;
  const apply = (event: PointerEvent) => {
    const point = host.clientToWorld(event.clientX, event.clientY);
    demo.setPointer(point.x, point.y, strength);
  };
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("pointerdown", (event) => {
    demo.noteActivity();
    activePointer = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    strength = event.button === 2 || event.shiftKey ? -1 : 1;
    apply(event);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerId === activePointer) apply(event);
    else if (event.pointerType === "mouse") demo.noteActivity();
  });
  const release = (event: PointerEvent) => {
    if (event.pointerId !== activePointer) return;
    activePointer = null;
    demo.setPointer(0, 0, 0);
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      demo.noteActivity();
      const point = host.clientToWorld(event.clientX, event.clientY);
      demo.zoomAt(Math.exp(-event.deltaY * 0.0015), point.x, point.y);
    },
    { passive: false },
  );
}

// Keeps the address bar shareable: the same URL reproduces the same starting rules.
function syncUrl(demo: ParticleLifeDemo): void {
  const params = new URLSearchParams({
    seed: String(demo.currentSeed),
    species: String(demo.speciesCount),
    particles: String(demo.particleCount),
    preset: String(demo.preset),
  });
  history.replaceState(null, "", `?${params}`);
}

