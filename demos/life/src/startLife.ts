import { DemoHost, bindEscapeToIndex, showFatalError, toggleFullscreen } from "@vector-demos/demo-kit";
import { LIFE_WORLD_HEIGHT, LifeDemo } from "./LifeDemo.js";

// Runs Life on the Beam full screen on the canvas, with keyboard and pointer controls.
export function startLife(canvas: HTMLCanvasElement): void {
  const demo = new LifeDemo();
  let host: DemoHost;
  try {
    host = DemoHost.start(canvas, demo, {
      worldHeight: LIFE_WORLD_HEIGHT,
      // The original page's look: a slightly wider glow than the other demos.
      lineStyle: { beamWidth: 1.3, glowRadius: 3.2, glowStrength: 0.25, endpointBrightness: 0.6, jointOverlap: 1 },
      phosphor: {
        persistenceHalfLifeMilliseconds: demo.persistenceMilliseconds,
        bloomStrength: demo.bloomStrength,
        exposure: 1.5,
        flickerAmount: 0.05,
        flickerFrequencyHz: 12,
      },
    });
  } catch (error) {
    console.error(error);
    showFatalError("Life on the Beam needs WebGL2, which this browser did not provide.");
    return;
  }
  demo.onPhosphorChange = (persistenceHalfLifeMilliseconds, bloomStrength) =>
    host.phosphor.setSettings({ persistenceHalfLifeMilliseconds, bloomStrength });
  bindEscapeToIndex();

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    demo.noteActivity();
    switch (event.key) {
      case " ": demo.togglePause(); break;
      case ".": demo.stepOnce(); break;
      case "r": case "R": demo.randomize(); break;
      case "g": case "G": demo.launchGliders(); break;
      case "c": case "C": demo.clear(); break;
      case "-": case "_": case "ArrowLeft": case "ArrowDown": demo.changeSpeed(-1); break;
      case "=": case "+": case "ArrowRight": case "ArrowUp": demo.changeSpeed(1); break;
      case "t": case "T": demo.cyclePersistence(); break;
      case "b": case "B": demo.cycleBloom(); break;
      case "h": case "H": demo.toggleHud(); break;
      case "f": case "F": toggleFullscreen(); break;
      default: return;
    }
    event.preventDefault();
  });

  let isPainting = false;
  const paint = (event: PointerEvent) => {
    const point = host.clientToWorld(event.clientX, event.clientY);
    demo.paintAt(point.x, point.y);
  };
  canvas.style.cursor = "crosshair";
  canvas.addEventListener("pointerdown", (event) => {
    demo.noteActivity();
    isPainting = true;
    canvas.setPointerCapture(event.pointerId);
    paint(event);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (isPainting) paint(event);
  });
  const stop = () => (isPainting = false);
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);
  (window as unknown as { life: unknown }).life = { demo, host };
}
