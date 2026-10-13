import {
  DemoHost,
  bindEscapeToIndex,
  createRandomSeed,
  readIntegerParameter,
  showFatalError,
  toggleFullscreen,
} from "@vector-demos/demo-kit";
import {
  AGENT_STEP,
  MAX_AGENTS,
  MIN_AGENTS,
  SLIME_PRESETS,
  SLIME_WORLD_HEIGHT,
  SlimeMoldDemo,
  TRAIL_MODES,
} from "./SlimeMoldDemo.js";

// Runs the slime mold full screen on the canvas, with keyboard and pointer controls.
// ?seed=, ?agents= and ?preset= start from a reproducible dish.
export function startSlimeMold(canvas: HTMLCanvasElement): void {
  const demo = new SlimeMoldDemo({
    seed: readIntegerParameter("seed", createRandomSeed(), 0, 0x7fffffff),
    agentCount: readIntegerParameter("agents", 8000, MIN_AGENTS, MAX_AGENTS),
    presetIndex: readIntegerParameter("preset", 0, 0, SLIME_PRESETS.length - 1),
  });

  let host: DemoHost;
  try {
    host = DemoHost.start(canvas, demo, {
      worldHeight: SLIME_WORLD_HEIGHT,
      maxStepsPerFrame: 6,
      lineStyle: { beamWidth: 1.2, glowRadius: 2.2, glowStrength: 0.12, endpointBrightness: 0, jointOverlap: 0 },
      phosphor: {
        persistenceHalfLifeMilliseconds: TRAIL_MODES[demo.trailIndex].halfLifeMilliseconds,
        bloomStrength: 0.28,
        bloomBlurIterations: 2,
        exposure: 1.15,
        flickerAmount: 0.02,
        flickerFrequencyHz: 12,
      },
    });
  } catch (error) {
    console.error(error);
    showFatalError("Slime Mold needs WebGL2, which this browser did not provide.");
    return;
  }
  demo.onTrailChange = (halfLifeMilliseconds) => host.phosphor.setSettings({ persistenceHalfLifeMilliseconds: halfLifeMilliseconds });
  bindEscapeToIndex();

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    demo.noteActivity();
    let handled = true;
    switch (event.key) {
      case "n": case "N": demo.nextPreset(); break;
      case "r": case "R": demo.reseed(); break;
      case "c": case "C": demo.clearTrail(); break;
      case "[": demo.changeAgentCount(-AGENT_STEP); break;
      case "]": demo.changeAgentCount(AGENT_STEP); break;
      case "-": case "_": case "ArrowDown": demo.changeSpeed(-1); break;
      case "=": case "+": case "ArrowUp": demo.changeSpeed(1); break;
      case "t": case "T": demo.cycleTrails(); break;
      case "e": case "E": demo.toggleAuto(); break;
      case " ": demo.togglePause(); break;
      case ".": demo.stepOnce(); break;
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
  let strength = 1;
  const paint = (event: PointerEvent) => {
    const point = host.clientToWorld(event.clientX, event.clientY);
    demo.paintAt(point.x, point.y, strength);
  };
  canvas.style.cursor = "crosshair";
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("pointerdown", (event) => {
    demo.noteActivity();
    activePointer = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    strength = event.button === 2 || event.shiftKey ? -4 : 4;
    paint(event);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerId === activePointer) paint(event);
    else demo.noteActivity();
  });
  const release = (event: PointerEvent) => {
    if (event.pointerId === activePointer) activePointer = null;
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  (window as unknown as { slimeMold: unknown }).slimeMold = { demo, host };
}

// Keeps the address bar shareable: the same URL reproduces the same starting dish.
function syncUrl(demo: SlimeMoldDemo): void {
  const params = new URLSearchParams({
    seed: String(demo.currentSeed),
    agents: String(demo.agentCount),
    preset: String(demo.preset),
  });
  history.replaceState(null, "", `?${params}`);
}
