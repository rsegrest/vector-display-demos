import { DemoHost, bindEscapeToIndex, readIntegerParameter, showFatalError, toggleFullscreen } from "@vector-demos/demo-kit";
import { CREASE_STEP_DEGREES, MESHES, MESHES_WORLD_HEIGHT, MeshesDemo, TRAIL_MODES } from "./MeshesDemo.js";

const DRAG_RADIANS_PER_PIXEL = 0.007;

// Runs the feature-edge meshes full screen. ?mesh= (1-based) picks the starting mesh.
export function startMeshes(canvas: HTMLCanvasElement): void {
  const demo = new MeshesDemo({ meshIndex: readIntegerParameter("mesh", 1, 1, MESHES.length) - 1 });

  let host: DemoHost;
  try {
    host = DemoHost.start(canvas, demo, {
      worldHeight: MESHES_WORLD_HEIGHT,
      // Edges are loose segments meeting at shared corners; a little overlap closes the joints.
      lineStyle: { beamWidth: 1.4, glowRadius: 2.6, glowStrength: 0.18, endpointBrightness: 0.08, jointOverlap: 0.5 },
      phosphor: {
        persistenceHalfLifeMilliseconds: TRAIL_MODES[demo.trailIndex].halfLifeMilliseconds,
        bloomStrength: 0.55,
        bloomBlurIterations: 2,
        exposure: 1.3,
        flickerAmount: 0.02,
        flickerFrequencyHz: 12,
      },
    });
  } catch (error) {
    console.error(error);
    showFatalError("Feature Edges needs WebGL2, which this browser did not provide.");
    return;
  }
  demo.onTrailChange = (halfLifeMilliseconds) => host.phosphor.setSettings({ persistenceHalfLifeMilliseconds: halfLifeMilliseconds });
  bindEscapeToIndex();

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    demo.noteActivity();
    let handled = true;
    switch (event.key) {
      case "n": case "N": case "ArrowRight": demo.changeMesh(1); break;
      case "b": case "B": case "ArrowLeft": demo.changeMesh(-1); break;
      case "m": case "M": demo.toggleMode(); break;
      case "l": case "L": demo.toggleHiddenLines(); break;
      case "[": case "ArrowDown": demo.changeCrease(-CREASE_STEP_DEGREES); break;
      case "]": case "ArrowUp": demo.changeCrease(CREASE_STEP_DEGREES); break;
      case "a": case "A": demo.toggleAuto(); break;
      case "c": case "C": demo.toggleAutoCamera(); break;
      case "t": case "T": demo.cycleTrails(); break;
      case " ": demo.togglePause(); break;
      case "h": case "H": demo.toggleHud(); break;
      case "f": case "F": toggleFullscreen(); break;
      default: handled = false;
    }
    if (handled) {
      event.preventDefault();
      history.replaceState(null, "", `?mesh=${demo.index + 1}`);
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
  (window as unknown as { meshes: unknown }).meshes = { demo, host };
}
