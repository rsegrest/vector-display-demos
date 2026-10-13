import {
  DemoHost,
  bindEscapeToIndex,
  createRandomSeed,
  readIntegerParameter,
  showFatalError,
  toggleFullscreen,
} from "@vector-demos/demo-kit";
import { BIOMORPH_WORLD_HEIGHT, BiomorphDemo, parseGenome } from "./BiomorphDemo.js";

// Runs the biomorph breeding grid full screen. ?genes=1,2,... and ?seed= start from
// a reproducible creature and litter, and the address follows the parent as you
// breed, so whatever you have bred can be shared by copying it.
export function startBiomorphs(canvas: HTMLCanvasElement): void {
  const parameters = new URLSearchParams(location.search);
  const demo = new BiomorphDemo({
    seed: readIntegerParameter("seed", createRandomSeed(), 0, 0x7fffffff),
    genome: parseGenome(parameters.get("genes")),
  });

  let host: DemoHost;
  try {
    host = DemoHost.start(canvas, demo, {
      worldHeight: BIOMORPH_WORLD_HEIGHT,
      // The creatures are single short segments meeting at shared points; no
      // endpoint dwell, so the beam does not bead every branch tip.
      lineStyle: { beamWidth: 1.4, glowRadius: 2.6, glowStrength: 0.18, endpointBrightness: 0, jointOverlap: 0.6 },
      phosphor: {
        persistenceHalfLifeMilliseconds: 90,
        bloomStrength: 0.7,
        bloomBlurIterations: 2,
        exposure: 1.5,
        flickerAmount: 0.02,
        flickerFrequencyHz: 12,
      },
    });
  } catch (error) {
    console.error(error);
    showFatalError("Biomorphs need WebGL2, which this browser did not provide.");
    return;
  }
  bindEscapeToIndex();
  demo.onParentChange = () => {
    history.replaceState(null, "", `?genes=${demo.parentGenome.join(",")}&seed=${demo.currentSeed}`);
  };

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    demo.noteActivity();
    let handled = true;
    switch (event.key) {
      case "ArrowLeft": case "ArrowUp": demo.moveSelection(-1); break;
      case "ArrowRight": case "ArrowDown": demo.moveSelection(1); break;
      case "Enter": demo.choose(demo.selected); break;
      case "Backspace": demo.undo(); break;
      case "r": case "R": demo.randomize(); break;
      case "p": case "P": demo.nextPreset(); break;
      case "g": case "G": demo.reroll(); break;
      case "a": case "A": demo.toggleAutopilot(); break;
      case " ": demo.togglePause(); break;
      case "h": case "H": demo.toggleHud(); break;
      case "f": case "F": toggleFullscreen(); break;
      default: handled = false;
    }
    if (handled) event.preventDefault();
  });

  canvas.style.cursor = "pointer";
  canvas.addEventListener("pointermove", (event) => {
    demo.noteActivity();
    const point = host.clientToWorld(event.clientX, event.clientY);
    const index = demo.pickAt(point.x, point.y);
    demo.setHovered(index !== null && index >= 0 ? index : null);
    canvas.style.cursor = index !== null ? "pointer" : "default";
  });
  canvas.addEventListener("pointerdown", (event) => {
    demo.noteActivity();
    const point = host.clientToWorld(event.clientX, event.clientY);
    const index = demo.pickAt(point.x, point.y);
    if (index !== null && index >= 0) demo.choose(index);
  });
  (window as unknown as { biomorphs: unknown }).biomorphs = { demo, host };
}
