import { DemoHost, bindEscapeToIndex, readIntegerParameter, showFatalError, toggleFullscreen } from "@vector-demos/demo-kit";
import { EPICYCLES_WORLD_HEIGHT, EpicyclesDemo, SHAPES, TRAIL_MODES } from "./EpicyclesDemo.js";

// Runs the epicycles full screen. Draw on the canvas to give it a shape of your
// own. ?shape= (1-based) picks the starting shape.
export function startEpicycles(canvas: HTMLCanvasElement): void {
  const demo = new EpicyclesDemo({ shapeIndex: readIntegerParameter("shape", 1, 1, SHAPES.length) - 1 });

  let host: DemoHost;
  try {
    host = DemoHost.start(canvas, demo, {
      worldHeight: EPICYCLES_WORLD_HEIGHT,
      // Circles and the trace are chained paths; no endpoint dwell, a little overlap at the joints.
      lineStyle: { beamWidth: 1.4, glowRadius: 2.8, glowStrength: 0.18, endpointBrightness: 0, jointOverlap: 0.4 },
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
    showFatalError("Fourier Epicycles needs WebGL2, which this browser did not provide.");
    return;
  }
  demo.onTrailChange = (halfLifeMilliseconds) => host.phosphor.setSettings({ persistenceHalfLifeMilliseconds: halfLifeMilliseconds });
  bindEscapeToIndex();

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    demo.noteActivity();
    let handled = true;
    if (event.key >= "0" && event.key <= "9") {
      demo.traceGlyph(event.key);
    } else {
      switch (event.key) {
        case "n": case "N": case "ArrowRight": demo.changeShape(1); break;
        case "b": case "B": case "ArrowLeft": demo.changeShape(-1); break;
        case "[": case "ArrowDown": demo.changeTerms(-1); break;
        case "]": case "ArrowUp": demo.changeTerms(1); break;
        case "a": case "A": demo.toggleAuto(); break;
        case "-": case "_": demo.changeSpeed(-1); break;
        case "=": case "+": demo.changeSpeed(1); break;
        case "c": case "C": demo.toggleCircles(); break;
        case "g": case "G": demo.toggleGhost(); break;
        case "t": case "T": demo.cycleTrails(); break;
        case " ": demo.togglePause(); break;
        case "h": case "H": demo.toggleHud(); break;
        case "f": case "F": toggleFullscreen(); break;
        default: handled = false;
      }
    }
    if (handled) {
      event.preventDefault();
      history.replaceState(null, "", `?shape=${demo.shape + 1}`);
    }
  });

  let activePointer: number | null = null;
  canvas.style.cursor = "crosshair";
  canvas.addEventListener("pointerdown", (event) => {
    demo.noteActivity();
    activePointer = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    const point = host.clientToWorld(event.clientX, event.clientY);
    demo.beginSketch(point.x, point.y);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerId !== activePointer) {
      if (event.pointerType === "mouse") demo.noteActivity();
      return;
    }
    const point = host.clientToWorld(event.clientX, event.clientY);
    demo.extendSketch(point.x, point.y);
  });
  const release = (event: PointerEvent) => {
    if (event.pointerId !== activePointer) return;
    activePointer = null;
    demo.endSketch();
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  (window as unknown as { epicycles: unknown }).epicycles = { demo, host };
}
