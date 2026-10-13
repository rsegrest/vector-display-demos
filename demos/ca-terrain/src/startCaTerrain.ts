import {
  DemoHost,
  bindEscapeToIndex,
  createRandomSeed,
  readIntegerParameter,
  showFatalError,
  toggleFullscreen,
} from "@vector-demos/demo-kit";
import { CAMERA_PRESETS, CaTerrainDemo, TERRAIN_WORLD_HEIGHT, TRAIL_MODES } from "./CaTerrainDemo.js";
import { RULE_PRESETS } from "./sim/elementaryCA.js";

// Runs the cellular-automaton terrain full screen. ?rule= (1-based), ?seed= and
// ?camera= pick the starting rule, initial row and flight height.
export function startCaTerrain(canvas: HTMLCanvasElement): void {
  const demo = new CaTerrainDemo({
    seed: readIntegerParameter("seed", createRandomSeed(), 0, 0x7fffffff),
    ruleIndex: readIntegerParameter("rule", 1, 1, RULE_PRESETS.length) - 1,
    cameraIndex: readIntegerParameter("camera", 1, 1, CAMERA_PRESETS.length) - 1,
  });

  let host: DemoHost;
  try {
    host = DemoHost.start(canvas, demo, {
      worldHeight: TERRAIN_WORLD_HEIGHT,
      // Ridgelines are connected paths; walls are single segments. No endpoint dwell,
      // so the beam does not bead every generation.
      lineStyle: { beamWidth: 1.25, glowRadius: 2.4, glowStrength: 0.16, endpointBrightness: 0, jointOverlap: 0.4 },
      phosphor: {
        persistenceHalfLifeMilliseconds: TRAIL_MODES[demo.trailIndex].halfLifeMilliseconds,
        bloomStrength: 0.24,
        bloomBlurIterations: 2,
        exposure: 1.1,
        flickerAmount: 0.02,
        flickerFrequencyHz: 12,
      },
    });
  } catch (error) {
    console.error(error);
    showFatalError("Cellular Terrain needs WebGL2, which this browser did not provide.");
    return;
  }
  demo.onTrailChange = (halfLifeMilliseconds) => host.phosphor.setSettings({ persistenceHalfLifeMilliseconds: halfLifeMilliseconds });
  bindEscapeToIndex();

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    demo.noteActivity();
    let handled = true;
    switch (event.key) {
      case "n": case "N": demo.nextRule(1); break;
      case "b": case "B": demo.nextRule(-1); break;
      case "r": case "R": demo.randomize(); break;
      case "g": case "G": demo.singleSeed(); break;
      case "a": case "A": demo.toggleAuto(); break;
      case "-": case "_": case "ArrowDown": demo.changeSpeed(-1); break;
      case "=": case "+": case "ArrowUp": demo.changeSpeed(1); break;
      case "c": case "C": demo.nextCamera(); break;
      case "l": case "L": demo.toggleWalls(); break;
      case "[": demo.changeRidge(-1); break;
      case "]": demo.changeRidge(1); break;
      case "t": case "T": demo.cycleTrails(); break;
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

  canvas.addEventListener("pointermove", () => demo.noteActivity());
  (window as unknown as { caTerrain: unknown }).caTerrain = { demo, host };
}

// Keeps the address bar shareable: the same URL reproduces the same flight.
function syncUrl(demo: CaTerrainDemo): void {
  const params = new URLSearchParams({
    seed: String(demo.currentSeed),
    rule: String(demo.rulePreset + 1),
    camera: String(demo.cameraPreset + 1),
  });
  history.replaceState(null, "", `?${params}`);
}
