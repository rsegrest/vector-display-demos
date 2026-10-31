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
import { Customizer, type CustomizerWords } from "./Customizer.js";
import { pagesFromText, pagesToText, parsePages } from "./sim/pageLayout.js";

// Runs the text crawl full screen. The CUSTOMIZE button in the top right corner sets your own
// words, and writes them into the address, so a reload or a shared link shows them again:
// ?text=LINE ONE|LINE TWO, where "|" ends a line, "||" ends a page, and a line starting with "#"
// is a title.
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

  const customizer = new Customizer(document.body, wordsOf(customPages));
  customizer.onSubmit = ({ header, text }) => {
    const pages = pagesFromText(fontSafeText(header), fontSafeText(text));
    const address = new URL(location.href);
    // Nothing typed: back to the crawl's own words.
    if (pages.length === 0 || !demo.showPages(pages)) {
      demo.showPages(DEFAULT_PAGES);
      address.searchParams.delete("text");
    } else {
      address.searchParams.set("text", pagesToText(pages));
    }
    history.replaceState(history.state, "", address);
    canvas.focus();
  };
  // Escape closes the panel first; with it closed, Escape returns to the index as everywhere.
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || !customizer.isOpen) return;
      event.stopImmediatePropagation();
      customizer.close();
      canvas.focus();
    },
    { capture: true },
  );
  bindEscapeToIndex();

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // Typing in the panel is typing, not the crawl's keys.
    if (customizer.owns(event.target)) return;
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

// The words already showing (from the address), as the panel's two fields: the first page's
// titles as the header, every other line as the text.
function wordsOf(pages: readonly (readonly string[])[]): CustomizerWords {
  const lines = pages.flat();
  return {
    header: lines.filter((line) => line.startsWith("#")).map((line) => line.slice(1)).join(" "),
    text: lines.filter((line) => !line.startsWith("#")).join("\n"),
  };
}
