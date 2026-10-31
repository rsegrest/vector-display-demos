import { DemoHost, bindEscapeToIndex, showFatalError, toggleFullscreen } from "@vector-demos/demo-kit";
import { CornerPanel } from "./CornerPanel.js";
import { LocationPanel, type NamedPlace } from "./LocationPanel.js";
import { TimePanel } from "./TimePanel.js";
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

  const bar = CornerPanel.bar(document.body);
  const timePanel = new TimePanel(bar, () => demo.time, () => demo.clockZone());
  const panel = new LocationPanel(bar, demo.place);
  const panels: CornerPanel[] = [timePanel, panel];
  // One panel open at a time.
  for (const each of panels) {
    const opened = each.onOpen;
    each.onOpen = () => {
      for (const other of panels) if (other !== each) other.close();
      opened();
    };
  }
  timePanel.onChange = (time) => demo.setTime(time);
  timePanel.onNow = () => demo.returnToNow();
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
      const open = panels.filter((each) => each.isOpen);
      if (event.key !== "Escape" || open.length === 0) return;
      event.stopImmediatePropagation();
      for (const each of open) each.close();
      canvas.focus();
    },
    { capture: true },
  );
  bindEscapeToIndex();

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || panels.some((each) => each.owns(event.target))) return;
    demo.noteActivity();
    let handled = starMapKey(demo, event.key);
    if (!handled && (event.key === "f" || event.key === "F")) {
      toggleFullscreen();
      handled = true;
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

// The address's place, or else the one last chosen in this browser, or a guess from the time zone.
function startingPlace(): { place: { latitude: number; longitude: number }; placeName: string } {
  const parameters = new URLSearchParams(location.search);
  const latitude = Number.parseFloat(parameters.get("lat") ?? "");
  const longitude = Number.parseFloat(parameters.get("lon") ?? "");
  if (Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
    return { place: { latitude, longitude }, placeName: "Location from the address" };
  }
  return browserPlace();
}

// The place last chosen in this browser (on the page or in Vector OS), or, the first time, a guess
// from the time zone: its longitude (15 degrees an hour from Greenwich) at 40 degrees north, marked
// as approximate.
export function browserPlace(): { place: { latitude: number; longitude: number }; placeName: string } {
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

// What a key does to the map, for the page and for Vector OS's window alike; false if nothing.
export function starMapKey(demo: StarMapDemo, key: string): boolean {
  const step = (ARROW_STEP * demo.view.fieldOfView) / 90;
  switch (key) {
    case "ArrowLeft": demo.look(-step, 0); return true;
    case "ArrowRight": demo.look(step, 0); return true;
    case "ArrowUp": demo.look(0, step); return true;
    case "ArrowDown": demo.look(0, -step); return true;
    case "-": case "_": demo.zoom(1.15); return true;
    case "=": case "+": demo.zoom(1 / 1.15); return true;
    case ",": case "<": demo.changeTimeRate(-1); return true;
    case ".": case ">": demo.changeTimeRate(1); return true;
    case "0": demo.returnToNow(); return true;
    case "p": case "P": demo.toggle("solarSystem"); return true;
    case "l": case "L": demo.toggle("lines"); return true;
    case "k": case "K": demo.toggle("names"); return true;
    case "m": case "M": demo.toggle("milkyWay"); return true;
    case "g": case "G": demo.toggle("grid"); return true;
    case "b": case "B": demo.toggle("ground"); return true;
    case "h": case "H": demo.toggleHud(); return true;
    default: return false;
  }
}
