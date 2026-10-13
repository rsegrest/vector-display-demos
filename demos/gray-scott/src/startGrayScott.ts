import {
  DemoHost,
  bindEscapeToIndex,
  createRandomSeed,
  readIntegerParameter,
  showFatalError,
  toggleFullscreen,
} from "@vector-demos/demo-kit";
import { GRAY_SCOTT_WORLD_HEIGHT, GrayScottDemo, REACTION_PRESETS } from "./GrayScottDemo.js";

// Runs Gray-Scott full screen, with keyboard and pointer controls. ?pattern=
// (1-based) and ?seed= start from a reproducible dish.
export function startGrayScott(canvas: HTMLCanvasElement): void {
  const demo = new GrayScottDemo({
    seed: readIntegerParameter("seed", createRandomSeed(), 0, 0x7fffffff),
    presetIndex: readIntegerParameter("pattern", 1, 1, REACTION_PRESETS.length) - 1,
  });

  let host: DemoHost;
  try {
    host = DemoHost.start(canvas, demo, {
      worldHeight: GRAY_SCOTT_WORLD_HEIGHT,
      // The simulation costs the same however late the frame is, so never run it twice to catch up.
      maxStepsPerFrame: 1,
      // Contours are chained paths, so no endpoint dwell and a little overlap at the joints.
      lineStyle: { beamWidth: 1.3, glowRadius: 2.6, glowStrength: 0.18, endpointBrightness: 0, jointOverlap: 0.4 },
      phosphor: {
        persistenceHalfLifeMilliseconds: 110,
        bloomStrength: 0.5,
        bloomBlurIterations: 2,
        exposure: 1.25,
        flickerAmount: 0.02,
        flickerFrequencyHz: 12,
      },
    });
  } catch (error) {
    console.error(error);
    showFatalError("Gray-Scott needs WebGL2, which this browser did not provide.");
    return;
  }
  bindEscapeToIndex();

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    demo.noteActivity();
    let handled = true;
    switch (event.key) {
      case "n": case "N": case "ArrowRight": demo.changePreset(1); break;
      case "b": case "B": case "ArrowLeft": demo.changePreset(-1); break;
      case "m": case "M": demo.toggleMap(); break;
      case "r": case "R": demo.reseed(); break;
      case "c": case "C": demo.clear(); break;
      case "e": case "E": demo.toggleAuto(); break;
      case "-": case "_": case "ArrowDown": demo.changeSpeed(-1); break;
      case "=": case "+": case "ArrowUp": demo.changeSpeed(1); break;
      case "[": demo.changeLevels(-1); break;
      case "]": demo.changeLevels(1); break;
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
  let wiping = false;
  const paint = (event: PointerEvent) => {
    const point = host.clientToWorld(event.clientX, event.clientY);
    demo.pointerAt(point.x, point.y, wiping);
  };
  canvas.style.cursor = "crosshair";
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("pointerdown", (event) => {
    demo.noteActivity();
    activePointer = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    wiping = event.button === 2 || event.shiftKey;
    paint(event);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerId === activePointer) paint(event);
    else if (event.pointerType === "mouse") demo.noteActivity();
  });
  const release = (event: PointerEvent) => {
    if (event.pointerId === activePointer) activePointer = null;
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  (window as unknown as { grayScott: unknown }).grayScott = { demo, host };
}

// Keeps the address bar shareable: the same URL reproduces the same starting dish.
function syncUrl(demo: GrayScottDemo): void {
  const params = new URLSearchParams({ seed: String(demo.currentSeed), pattern: String(demo.preset + 1) });
  history.replaceState(null, "", `?${params}`);
}
