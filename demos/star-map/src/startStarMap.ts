import { DemoHost, bindEscapeToIndex, showFatalError, toggleFullscreen } from "@vector-demos/demo-kit";
import { LocationPanel, type NamedPlace } from "./LocationPanel.js";
import { STAR_MAP_WORLD_HEIGHT, StarMapDemo } from "./StarMapDemo.js";

// Where this browser keeps the place last chosen.
const PLACE_KEY = "vector-demos:star-map-place";
// Degrees a press of an arrow key turns the view, at a 90-degree field of view.
const ARROW_STEP = 5;

// Runs the star map full screen. ?lat=41.88&lon=-87.63 sets the place; otherwise the place last
// chosen in this browser, or, the first time, a guess from the time zone until LOCATION is used.
export function startStarMap(canvas: HTMLCanvasElement): void {
  const demo = new StarMapDemo(startingPlace());

  let host: DemoHost;
  try {
    host = DemoHost.start(canvas, demo, {
      worldHeight: STAR_MAP_WORLD_HEIGHT,
      // No endpoint dwell: it would put a bright bead at every joint of the constellation lines and
      // the horizon, like extra stars. The stars are drawn bright enough without it.
      lineStyle: { beamWidth: 1.5, glowRadius: 2.8, glowStrength: 0.2, endpointBrightness: 0, jointOverlap: 0.4 },
      phosphor: { persistenceHalfLifeMilliseconds: 120, bloomStrength: 0.7, bloomBlurIterations: 2, exposure: 1.35, flickerAmount: 0.02, flickerFrequencyHz: 12 },
    });
  } catch (error) {
    console.error(error);
    showFatalError("The star map needs WebGL2, which this browser did not provide.");
    return;
  }

  const panel = new LocationPanel(document.body, demo.place);
  panel.onChoose = (place: NamedPlace) => {
    demo.setPlace({ latitude: place.latitude, longitude: place.longitude }, place.name);
    try {
      localStorage.setItem(PLACE_KEY, JSON.stringify(place));
    } catch {
      // Storage can be unavailable (private windows); the place lasts until the page closes.
    }
    canvas.focus();
  };

  // Escape closes the panel first; with it closed, Escape returns to the index as everywhere.
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || !panel.isOpen) return;
      event.stopImmediatePropagation();
      panel.close();
      canvas.focus();
    },
    { capture: true },
  );
  bindEscapeToIndex();

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || panel.owns(event.target)) return;
    demo.noteActivity();
    const step = (ARROW_STEP * demo.view.fieldOfView) / 90;
    let handled = true;
    switch (event.key) {
      case "ArrowLeft": demo.look(-step, 0); break;
      case "ArrowRight": demo.look(step, 0); break;
      case "ArrowUp": demo.look(0, step); break;
      case "ArrowDown": demo.look(0, -step); break;
      case "-": case "_": demo.zoom(1.15); break;
      case "=": case "+": demo.zoom(1 / 1.15); break;
      case ",": case "<": demo.changeTimeRate(-1); break;
      case ".": case ">": demo.changeTimeRate(1); break;
      case "0": demo.returnToNow(); break;
      case "l": case "L": demo.toggle("lines"); break;
      case "k": case "K": demo.toggle("names"); break;
      case "m": case "M": demo.toggle("milkyWay"); break;
      case "g": case "G": demo.toggle("grid"); break;
      case "b": case "B": demo.toggle("ground"); break;
      case "h": case "H": demo.toggleHud(); break;
      case "f": case "F": toggleFullscreen(); break;
      default: handled = false;
    }
    if (handled) event.preventDefault();
  });

  // Dragging turns the sky with the pointer; the wheel zooms.
  let dragFrom: { x: number; y: number } | null = null;
  canvas.style.cursor = "grab";
  canvas.addEventListener("pointerdown", (event) => {
    demo.noteActivity();
    canvas.setPointerCapture(event.pointerId);
    dragFrom = host.clientToWorld(event.clientX, event.clientY);
    canvas.style.cursor = "grabbing";
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse") demo.noteActivity();
    if (!dragFrom) return;
    const point = host.clientToWorld(event.clientX, event.clientY);
    demo.drag(point.x - dragFrom.x, point.y - dragFrom.y);
    dragFrom = point;
  });
  const endDrag = (): void => {
    dragFrom = null;
    canvas.style.cursor = "grab";
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      demo.noteActivity();
      const pixels = event.deltaMode === 1 ? event.deltaY * 32 : event.deltaY;
      demo.zoom(Math.exp(pixels * 0.0015));
    },
    { passive: false },
  );
  (window as unknown as { starMap: unknown }).starMap = { demo, host };
}

// The address's place, the one last chosen here, or a guess from the time zone: its longitude (15
// degrees an hour from Greenwich) at 40 degrees north, marked as approximate.
function startingPlace(): { place: { latitude: number; longitude: number }; placeName: string } {
  const parameters = new URLSearchParams(location.search);
  const latitude = Number.parseFloat(parameters.get("lat") ?? "");
  const longitude = Number.parseFloat(parameters.get("lon") ?? "");
  if (Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
    return { place: { latitude, longitude }, placeName: "Location from the address" };
  }
  try {
    const stored = JSON.parse(localStorage.getItem(PLACE_KEY) ?? "null") as NamedPlace | null;
    if (stored && Number.isFinite(stored.latitude) && Number.isFinite(stored.longitude)) {
      return { place: { latitude: stored.latitude, longitude: stored.longitude }, placeName: stored.name };
    }
  } catch {
    // Unreadable or unavailable storage: fall through to the guess.
  }
  const hoursEast = -new Date().getTimezoneOffset() / 60;
  return { place: { latitude: 40, longitude: Math.max(-180, Math.min(180, hoursEast * 15)) }, placeName: "Approximate (time zone)" };
}
