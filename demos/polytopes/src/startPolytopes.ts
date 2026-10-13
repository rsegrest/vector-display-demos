import {
  DemoHost,
  bindEscapeToIndex,
  createRandomSeed,
  readIntegerParameter,
  showFatalError,
  toggleFullscreen,
} from "@vector-demos/demo-kit";
import { POLYTOPES_WORLD_HEIGHT, PolytopesDemo, TRAIL_MODES } from "./PolytopesDemo.js";
import { regularPolytopes } from "./sim/polytopes.js";

const DRAG_RADIANS_PER_PIXEL = 0.007;

// Runs the 4D polytopes full screen. ?polytope= (1-based), ?projection=stereographic
// and ?seed= pick the starting shape and view.
export function startPolytopes(canvas: HTMLCanvasElement): void {
  const parameters = new URLSearchParams(location.search);
  const demo = new PolytopesDemo({
    seed: readIntegerParameter("seed", createRandomSeed(), 0, 0x7fffffff),
    polytopeIndex: readIntegerParameter("polytope", 3, 1, regularPolytopes().length) - 1,
    projection: parameters.get("projection") === "stereographic" ? "STEREOGRAPHIC" : "PERSPECTIVE",
  });

  let host: DemoHost;
  try {
    host = DemoHost.start(canvas, demo, {
      worldHeight: POLYTOPES_WORLD_HEIGHT,
      lineStyle: { beamWidth: 1.4, glowRadius: 2.8, glowStrength: 0.2, endpointBrightness: 0.25, jointOverlap: 0.4 },
      phosphor: {
        persistenceHalfLifeMilliseconds: TRAIL_MODES[demo.trailIndex].halfLifeMilliseconds,
        bloomStrength: 0.6,
        bloomBlurIterations: 2,
        exposure: 1.35,
        flickerAmount: 0.02,
        flickerFrequencyHz: 12,
      },
    });
  } catch (error) {
    console.error(error);
    showFatalError("4D Polytopes needs WebGL2, which this browser did not provide.");
    return;
  }
  demo.onTrailChange = (halfLifeMilliseconds) => host.phosphor.setSettings({ persistenceHalfLifeMilliseconds: halfLifeMilliseconds });
  bindEscapeToIndex();

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    demo.noteActivity();
    let handled = true;
    switch (event.key) {
      case "n": case "N": case "ArrowRight": demo.changePolytope(1); break;
      case "b": case "B": case "ArrowLeft": demo.changePolytope(-1); break;
      case "p": case "P": demo.toggleProjection(); break;
      case "w": case "W": demo.toggleRotateThroughW(); break;
      case "r": case "R": demo.newSpin(); break;
      case "a": case "A": demo.toggleAuto(); break;
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
    demo.dragBy((event.clientX - lastX) * DRAG_RADIANS_PER_PIXEL, (event.clientY - lastY) * DRAG_RADIANS_PER_PIXEL, event.shiftKey);
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
  (window as unknown as { polytopes: unknown }).polytopes = { demo, host };
}

// Keeps the address bar shareable: the same URL opens the same shape and view.
function syncUrl(demo: PolytopesDemo): void {
  const params = new URLSearchParams({
    polytope: String(demo.index + 1),
    projection: demo.projection.toLowerCase(),
    seed: String(demo.currentSeed),
  });
  history.replaceState(null, "", `?${params}`);
}
