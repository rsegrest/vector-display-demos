import { DemoHost, bindEscapeToIndex, readIntegerParameter, showFatalError, toggleFullscreen } from "@vector-demos/demo-kit";
import { LeniaDemo, TRAIL_MODES } from "./LeniaDemo.js";
import { LENIA_CREATURES } from "./sim/creatures.js";

const WORLD_HEIGHT = 1000;

// Runs Lenia full screen on the canvas, with keyboard and pointer controls.
// ?species=N (1-based) starts on a particular creature.
export function startLenia(canvas: HTMLCanvasElement): void {
  const demo = new LeniaDemo(readIntegerParameter("species", 1, 1, LENIA_CREATURES.length) - 1);
  let host: DemoHost;
  try {
    host = DemoHost.start(canvas, demo, {
      worldHeight: WORLD_HEIGHT,
      // Contours are chained paths with a vertex every grid cell, so endpoint dwell would bead every line.
      lineStyle: { beamWidth: 1.25, glowRadius: 2.4, glowStrength: 0.16, endpointBrightness: 0, jointOverlap: 0 },
      phosphor: {
        persistenceHalfLifeMilliseconds: TRAIL_MODES[demo.trailIndex].halfLifeMilliseconds,
        bloomStrength: 0.6,
        bloomBlurIterations: 2,
        exposure: 1.5,
        flickerAmount: 0.02,
        flickerFrequencyHz: 12,
      },
    });
  } catch (error) {
    console.error(error);
    showFatalError("Lenia needs WebGL2, which this browser did not provide.");
    return;
  }
  demo.onTrailChange = (halfLifeMilliseconds) => host.phosphor.setSettings({ persistenceHalfLifeMilliseconds: halfLifeMilliseconds });
  bindEscapeToIndex();

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    demo.noteActivity();
    switch (event.key) {
      case "n": case "N": case "ArrowRight": demo.advance(1); break;
      case "b": case "B": case "ArrowLeft": demo.advance(-1); break;
      case "r": case "R": demo.reseed(); break;
      case "a": case "A": demo.toggleAuto(); break;
      case "l": case "L": demo.cycleLevels(); break;
      case "v": case "V": demo.toggleRelief(); break;
      case "t": case "T": demo.cycleTrails(); break;
      case "-": case "_": case "ArrowDown": demo.changeSpeed(-1); break;
      case "=": case "+": case "ArrowUp": demo.changeSpeed(1); break;
      case " ": demo.togglePause(); break;
      case ".": demo.stepOnce(); break;
      case "h": case "H": demo.toggleHud(); break;
      case "f": case "F": toggleFullscreen(); break;
      default: return;
    }
    event.preventDefault();
  });

  canvas.style.cursor = "crosshair";
  canvas.addEventListener("pointerdown", (event) => {
    demo.noteActivity();
    const point = host.clientToWorld(event.clientX, event.clientY);
    if (event.shiftKey || event.button === 2) demo.eraseAt(point.x, point.y);
    else demo.dropAt(point.x, point.y);
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("pointermove", () => demo.noteActivity());
  (window as unknown as { lenia: unknown }).lenia = { demo, host };
}
