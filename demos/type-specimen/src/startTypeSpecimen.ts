import { DemoHost, bindEscapeToIndex, showFatalError, toggleFullscreen } from "@vector-demos/demo-kit";
import { SPECIMEN_FONTS, SPECIMEN_WORLD_HEIGHT, TypeSpecimenDemo } from "./TypeSpecimenDemo.js";

function readNumberParameter(parameters: URLSearchParams, name: string): number | undefined {
  const value = Number.parseFloat(parameters.get(name) ?? "");
  return Number.isFinite(value) ? value : undefined;
}

// Runs the type specimen full screen. The address can set the starting state:
// ?font=1..7  &size=<capital height in px>  &beam=<width in px>  &color=1..3
export function startTypeSpecimen(canvas: HTMLCanvasElement): void {
  const parameters = new URLSearchParams(location.search);
  const demo = new TypeSpecimenDemo({
    fontIndex: (readNumberParameter(parameters, "font") ?? 1) - 1,
    readingSize: readNumberParameter(parameters, "size"),
    beamWidth: readNumberParameter(parameters, "beam"),
    colorIndex: (readNumberParameter(parameters, "color") ?? 1) - 1,
  });

  let host: DemoHost;
  try {
    host = DemoHost.start(canvas, demo, {
      worldHeight: SPECIMEN_WORLD_HEIGHT,
      textBeamWidth: demo.beamWidth,
      // The text never moves, so there is nothing for trails to show; a short one keeps changes clean.
      phosphor: { persistenceHalfLifeMilliseconds: 30, flickerAmount: 0 },
    });
  } catch (error) {
    console.error(error);
    showFatalError("The type specimen needs WebGL2, which this browser did not provide.");
    return;
  }
  bindEscapeToIndex();

  const applyBeam = (): void => {
    host.setTextBeamWidth(demo.beamWidth);
    host.setLineStyle({ beamWidth: demo.beamWidth });
  };
  const measure = (): void => {
    demo.unitsPerPixel = SPECIMEN_WORLD_HEIGHT / Math.max(1, canvas.clientHeight || window.innerHeight);
  };
  applyBeam();
  measure();
  window.addEventListener("resize", measure);

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    let handled = true;
    switch (event.key) {
      case "ArrowRight": case "n": case "N": case " ": demo.changeFont(1); break;
      case "ArrowLeft": demo.changeFont(-1); break;
      case "[": demo.changeBeamWidth(-1); applyBeam(); break;
      case "]": demo.changeBeamWidth(1); applyBeam(); break;
      case "-": case "_": demo.changeReadingSize(-1); break;
      case "=": case "+": demo.changeReadingSize(1); break;
      case "g": case "G": demo.cycleColor(); break;
      case "f": case "F": toggleFullscreen(); break;
      default: {
        const digit = Number.parseInt(event.key, 10);
        if (digit >= 1 && digit <= SPECIMEN_FONTS.length) demo.fontIndex = digit - 1;
        else handled = false;
      }
    }
    if (handled) event.preventDefault();
  });
  (window as unknown as { typeSpecimen: unknown }).typeSpecimen = { demo, host };
}
