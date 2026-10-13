import { DemoHost, bindEscapeToIndex, showFatalError, toggleFullscreen } from "@vector-demos/demo-kit";
import { createLiveEarth } from "./createLiveEarth.js";
import { LIVE_EARTH_WORLD_HEIGHT } from "./LiveEarthDemo.js";

// Runs the live Earth full screen. Satellite orbits and earthquakes are fetched
// from CelesTrak and the USGS when the page opens; if either cannot be reached,
// the copy bundled with the demo is shown instead and labelled as a snapshot.
export function startLiveEarth(canvas: HTMLCanvasElement): void {
  const { demo } = createLiveEarth();

  let host: DemoHost;
  try {
    host = DemoHost.start(canvas, demo, {
      worldHeight: LIVE_EARTH_WORLD_HEIGHT,
      lineStyle: { beamWidth: 1.3, glowRadius: 2.6, glowStrength: 0.16, endpointBrightness: 0.1, jointOverlap: 0.4 },
      phosphor: {
        persistenceHalfLifeMilliseconds: 70,
        bloomStrength: 0.5,
        bloomBlurIterations: 2,
        exposure: 1.3,
        flickerAmount: 0.02,
        flickerFrequencyHz: 12,
      },
    });
  } catch (error) {
    console.error(error);
    showFatalError("The live Earth needs WebGL2, which this browser did not provide.");
    return;
  }
  bindEscapeToIndex();

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    demo.noteActivity();
    let handled = true;
    switch (event.key) {
      case "i": case "I": demo.toggleFollow(); break;
      case "-": case "_": case "ArrowDown": demo.changeRate(-1); break;
      case "=": case "+": case "ArrowUp": demo.changeRate(1); break;
      case "0": demo.goToNow(); break;
      case "w": case "W": demo.replayWeek(); break;
      case "s": case "S": demo.toggleSatellites(); break;
      case "q": case "Q": demo.toggleQuakes(); break;
      case "g": case "G": demo.toggleGraticule(); break;
      case "d": case "D": demo.toggleTerminator(); break;
      case "a": case "A": demo.toggleSpin(); break;
      case " ": demo.togglePause(); break;
      case "h": case "H": demo.toggleHud(); break;
      case "f": case "F": toggleFullscreen(); break;
      default: handled = false;
    }
    if (handled) event.preventDefault();
  });

  let activePointer: number | null = null;
  let lastX = 0;
  let lastY = 0;
  canvas.style.cursor = "grab";
  canvas.addEventListener("pointerdown", (event) => {
    demo.noteActivity();
    activePointer = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    const point = host.clientToWorld(event.clientX, event.clientY);
    lastX = point.x;
    lastY = point.y;
  });
  canvas.addEventListener("pointermove", (event) => {
    const point = host.clientToWorld(event.clientX, event.clientY);
    demo.setPointer(point.x, point.y);
    if (event.pointerId !== activePointer) {
      if (event.pointerType === "mouse") demo.noteActivity();
      return;
    }
    demo.dragBy(point.x - lastX, point.y - lastY);
    lastX = point.x;
    lastY = point.y;
  });
  const release = (event: PointerEvent) => {
    if (event.pointerId === activePointer) activePointer = null;
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("pointerleave", () => demo.setPointer(null));
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      demo.noteActivity();
      demo.zoomBy(Math.exp(-event.deltaY * 0.0015));
    },
    { passive: false },
  );
  (window as unknown as { liveEarth: unknown }).liveEarth = { demo, host };
}
