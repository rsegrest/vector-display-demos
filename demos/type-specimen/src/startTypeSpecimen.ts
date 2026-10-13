import { DemoHost, bindEscapeToIndex, showFatalError, toggleFullscreen } from "@vector-demos/demo-kit";
import { SPECIMEN_FONTS, SPECIMEN_WORLD_HEIGHT, TypeSpecimenDemo } from "./TypeSpecimenDemo.js";

function readNumberParameter(parameters: URLSearchParams, name: string): number | undefined {
  const value = Number.parseFloat(parameters.get(name) ?? "");
  return Number.isFinite(value) ? value : undefined;
}

// Runs the type specimen full screen. The address can set the starting state:
// ?font=1..7  &crisp=1  &size=<capital height in px>  &beam=<width in px>  &glow=0..1  &color=1..3
export function startTypeSpecimen(canvas: HTMLCanvasElement): void {
  const parameters = new URLSearchParams(location.search);
  const demo = new TypeSpecimenDemo({
    fontIndex: (readNumberParameter(parameters, "font") ?? 1) - 1,
    isCrisp: parameters.get("crisp") === "1",
    readingSize: readNumberParameter(parameters, "size"),
    beamWidth: readNumberParameter(parameters, "beam"),
    glow: readNumberParameter(parameters, "glow"),
    colorIndex: (readNumberParameter(parameters, "color") ?? 1) - 1,
  });

  let host: DemoHost;
  try {
    host = DemoHost.start(canvas, demo, {
      worldHeight: SPECIMEN_WORLD_HEIGHT,
      // The text never moves, so there is nothing for trails to show; a short one keeps changes clean.
      // Glow and bloom are set by applyBeam, from the demo's glow level.
      lineStyle: { endpointBrightness: 0.08, jointOverlap: 0.4 },
      overlayLineStyle: { endpointBrightness: 0.06, jointOverlap: 0.4 },
      phosphor: { persistenceHalfLifeMilliseconds: 30, bloomBlurIterations: 1, exposure: 1.2, flickerAmount: 0 },
    });
  } catch (error) {
    console.error(error);
    showFatalError("The type specimen needs WebGL2, which this browser did not provide.");
    return;
  }
  bindEscapeToIndex();

  const applyBeam = (): void => {
    // At full glow a strong bloom fills in letters this small, so even the top of the range is modest.
    const glow = demo.glow;
    host.setLineStyle({ beamWidth: demo.beamWidth, glowRadius: demo.beamWidth * (1 + 0.6 * glow), glowStrength: 0.08 * glow });
    host.setOverlayLineStyle({ beamWidth: demo.beamWidth, glowRadius: demo.beamWidth * (1 + 0.5 * glow), glowStrength: 0.06 * glow });
    host.phosphor.setSettings({ bloomStrength: 0.2 * glow });
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
      case "c": case "C": demo.isCrisp = !demo.isCrisp; break;
      case "[": demo.changeBeamWidth(-1); applyBeam(); break;
      case "]": demo.changeBeamWidth(1); applyBeam(); break;
      case ",": case "<": demo.changeGlow(-1); applyBeam(); break;
      case ".": case ">": demo.changeGlow(1); applyBeam(); break;
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
