import { BeamSettingsStore, DemoHost, bindEscapeToIndex, browserSettingsStorage, showFatalError, type BeamSettings } from "@vector-demos/demo-kit";
import { VECTOR_OS_WORLD_HEIGHT, VectorOsDemo } from "./VectorOsDemo.js";

// Runs Vector OS full screen. ?boot=0 skips the power-on sequence.
export function startVectorOs(canvas: HTMLCanvasElement): void {
  const parameters = new URLSearchParams(location.search);
  // The same saved beam settings the Live Guide uses.
  const beam = new BeamSettingsStore(browserSettingsStorage());
  const os = new VectorOsDemo({ skipBoot: parameters.get("boot") === "0", beam });

  let host: DemoHost;
  try {
    host = DemoHost.start(canvas, os, { worldHeight: VECTOR_OS_WORLD_HEIGHT, maxStepsPerFrame: 2 });
  } catch (error) {
    console.error(error);
    showFatalError("Vector OS needs WebGL2, which this browser did not provide.");
    return;
  }
  // One beam draws everything, so one set of settings applies to all of it: the
  // control panel and the terminal's SET command both change the real display.
  beam.subscribe((settings: BeamSettings) => {
    host.setLineStyle({ beamWidth: settings.beamWidth, glowRadius: settings.glowRadius, glowStrength: settings.glowStrength, endpointBrightness: 0.12, jointOverlap: 0.4 });
    host.phosphor.setSettings({
      persistenceHalfLifeMilliseconds: settings.persistenceHalfLifeMilliseconds,
      bloomStrength: settings.bloomStrength,
      bloomBlurIterations: 2,
      exposure: settings.exposure,
      flickerAmount: settings.flickerAmount,
      flickerFrequencyHz: 12,
    });
  });
  os.onNavigate = (page) => {
    location.href = `../${page}/`;
  };
  bindEscapeToIndex();

  window.addEventListener("keydown", (event) => {
    // Escape is left to the handler above, which returns to the index.
    if (event.key === "Escape" || event.key === "Meta") return;
    // Shortcuts are left to the browser. Ctrl and Alt alone are not shortcuts: the games use them as buttons.
    if ((event.metaKey || event.ctrlKey || event.altKey) && event.key !== "Control" && event.key !== "Alt") return;
    const used = os.keyDown({ key: event.key, code: event.code, repeat: event.repeat });
    // Keep keys the browser would act on (space scrolls, backspace goes back) for the OS, and any key a game uses.
    if (used || event.key.length === 1 || ["Backspace", "Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(event.key)) event.preventDefault();
  });
  // A key held down in a game is held until it comes up, so every release is passed on;
  // and when the browser window loses focus the releases will not come, so all are let go.
  window.addEventListener("keyup", (event) => os.keyUp({ key: event.key, code: event.code, repeat: false }));
  window.addEventListener("blur", () => os.releaseKeys());

  const at = (event: PointerEvent): { x: number; y: number } => host.clientToWorld(event.clientX, event.clientY);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    const point = at(event);
    os.pointer("down", point.x, point.y, event.shiftKey);
  });
  canvas.addEventListener("pointermove", (event) => {
    const point = at(event);
    os.pointer("move", point.x, point.y, event.shiftKey);
    canvas.style.cursor = os.cursorAt(point.x, point.y);
  });
  const release = (event: PointerEvent): void => {
    const point = at(event);
    os.pointer("up", point.x, point.y, event.shiftKey);
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  // Off the page: a window following the pointer (a game steered by it) is told it has gone.
  canvas.addEventListener("pointerleave", (event) => {
    const point = at(event);
    os.pointer("leave", point.x, point.y, event.shiftKey);
  });
  (window as unknown as { vectorOs: unknown }).vectorOs = { os, host };
}
