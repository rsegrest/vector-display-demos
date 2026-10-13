import { DemoHost, bindEscapeToIndex, showFatalError, toggleFullscreen } from "@vector-demos/demo-kit";
import { BOIDS_WORLD_HEIGHT, BoidsDemo } from "./BoidsDemo.js";

// Runs Boids on the Beam full screen on the canvas, with keyboard controls.
export function startBoids(canvas: HTMLCanvasElement): void {
  const demo = new BoidsDemo();
  let host: DemoHost;
  try {
    host = DemoHost.start(canvas, demo, {
      worldHeight: BOIDS_WORLD_HEIGHT,
      maxStepsPerFrame: 5,
      // The original page's look.
      lineStyle: { beamWidth: 1.35, glowRadius: 3, glowStrength: 0.25, endpointBrightness: 0.6, jointOverlap: 1 },
      phosphor: {
        persistenceHalfLifeMilliseconds: demo.persistenceMilliseconds,
        bloomStrength: 1.5,
        exposure: 1.6,
        flickerAmount: 0.04,
        flickerFrequencyHz: 12,
      },
    });
  } catch (error) {
    console.error(error);
    showFatalError("Boids on the Beam needs WebGL2, which this browser did not provide.");
    return;
  }
  demo.onPersistenceChange = (milliseconds) => host.phosphor.setSettings({ persistenceHalfLifeMilliseconds: milliseconds });
  bindEscapeToIndex();

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    demo.noteActivity();
    switch (event.key) {
      case " ": demo.togglePause(); break;
      case ".": demo.isPaused = true; host.stepOnce(); break;
      case "r": case "R": demo.scatter(); break;
      case "-": case "_": demo.changeCount(-1); break;
      case "=": case "+": demo.changeCount(1); break;
      case "q": case "Q": demo.changeWeight("separationWeight", 1); break;
      case "a": case "A": demo.changeWeight("separationWeight", -1); break;
      case "w": case "W": demo.changeWeight("alignmentWeight", 1); break;
      case "s": case "S": demo.changeWeight("alignmentWeight", -1); break;
      case "e": case "E": demo.changeWeight("cohesionWeight", 1); break;
      case "d": case "D": demo.changeWeight("cohesionWeight", -1); break;
      case "p": case "P": demo.cyclePersistence(); break;
      case "t": case "T": demo.cycleTrail(); break;
      case "h": case "H": demo.toggleHud(); break;
      case "f": case "F": toggleFullscreen(); break;
      default: return;
    }
    event.preventDefault();
  });
  canvas.addEventListener("pointermove", () => demo.noteActivity());
  (window as unknown as { boids: unknown }).boids = { demo, host };
}
