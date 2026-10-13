import {
  DemoHost,
  bindEscapeToIndex,
  createRandomSeed,
  fontSafeText,
  readIntegerParameter,
  showFatalError,
  toggleFullscreen,
} from "@vector-demos/demo-kit";
import { DEFAULT_PAGES, TEXT_CRAWL_WORLD_HEIGHT, TRAIL_MODES, TextCrawlDemo } from "./TextCrawlDemo.js";
import { parsePages } from "./sim/pageLayout.js";

// Runs the text crawl full screen. ?text=LINE ONE|LINE TWO shows your own words:
// "|" ends a line, "||" ends a page, and a line starting with "#" is a title.
export function startTextCrawl(canvas: HTMLCanvasElement): void {
  const custom = new URLSearchParams(location.search).get("text");
  // Only characters the vector font can draw; the rest become spaces.
  const customPages = custom ? parsePages(fontSafeText(custom.toUpperCase())) : [];
  const demo = new TextCrawlDemo({
    seed: readIntegerParameter("seed", createRandomSeed(), 0, 0x7fffffff),
    pages: customPages.length > 0 ? customPages : DEFAULT_PAGES,
  });

  let host: DemoHost;
  try {
    host = DemoHost.start(canvas, demo, {
      worldHeight: TEXT_CRAWL_WORLD_HEIGHT,
      // Letters are loose strokes that meet at corners; a little overlap closes the joints.
      lineStyle: { beamWidth: 1.5, glowRadius: 2.8, glowStrength: 0.18, endpointBrightness: 0.12, jointOverlap: 0.5 },
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
    showFatalError("The text crawl needs WebGL2, which this browser did not provide.");
    return;
  }
  demo.onTrailChange = (halfLifeMilliseconds) => host.phosphor.setSettings({ persistenceHalfLifeMilliseconds: halfLifeMilliseconds });
  bindEscapeToIndex();

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    demo.noteActivity();
    let handled = true;
    switch (event.key) {
      case " ": case "Enter": demo.shatter(); break;
      case "n": case "N": case "ArrowRight": demo.nextPage(); break;
      case "-": case "_": case "ArrowDown": demo.changeSpeed(-1); break;
      case "=": case "+": case "ArrowUp": demo.changeSpeed(1); break;
      case "t": case "T": demo.cycleTrails(); break;
      case "p": case "P": demo.togglePause(); break;
      case "h": case "H": demo.toggleHud(); break;
      case "f": case "F": toggleFullscreen(); break;
      default: handled = false;
    }
    if (handled) event.preventDefault();
  });

  canvas.style.cursor = "crosshair";
  canvas.addEventListener("pointerdown", (event) => {
    demo.noteActivity();
    const point = host.clientToWorld(event.clientX, event.clientY);
    demo.shatterAt(point.x, point.y);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse") demo.noteActivity();
  });
  (window as unknown as { textCrawl: unknown }).textCrawl = { demo, host };
}
