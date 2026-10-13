import { DemoHost, showFatalError, toggleFullscreen } from "@vector-demos/demo-kit";
import "./travelGlobe.css";
import { BadgeStrip } from "./BadgeStrip.js";
import { TravelGlobeDemo } from "./TravelGlobeDemo.js";
import type { TravelEditor } from "./editor/TravelEditor.js";
import { createAtlas, type GeoData, type TravelData } from "./places.js";
import geo from "./data/geo.json";
import travel from "./data/travel.json";

const WORLD_HEIGHT = 1000;
const CLICK_SLOP = 6;
// Two clicks (or taps) this close in time and space are a double-click.
const DOUBLE_CLICK_MS = 350;
const DOUBLE_CLICK_DISTANCE = 20;
const BLOG_BASE_URL = "https://ricksegrest.com";

export interface TravelGlobeOptions {
  // Where Escape goes when nothing is selected (the demo index). Leave out when the globe is the whole page.
  readonly indexHref?: string;
  // The dev server's travel-data API ("/api/travel"). When set, machines allowed to edit get an Edit button.
  readonly editApi?: string;
}

// Runs the travel globe full screen on the canvas, with mouse, touch and keyboard controls.
export function startTravelGlobe(canvas: HTMLCanvasElement, options: TravelGlobeOptions = {}): void {
  const atlas = createAtlas(travel as TravelData, geo as GeoData);
  const demo = new TravelGlobeDemo(atlas);

  // The canvas shares the window with the badge strip below it.
  const layout = document.createElement("div");
  layout.className = "travel-globe";
  canvas.replaceWith(layout);
  const strip = new BadgeStrip(demo);
  layout.append(canvas, strip.element);

  addAccessiblePlaceList(demo);
  const announcer = addAnnouncer();
  demo.onSelectionChange = (feature) => {
    strip.showSelection(feature);
    const place = feature ? atlas.placeFor(feature) : undefined;
    announcer.textContent = !feature ? "" : place ? `${place.name}: ${place.status}${place.years.length ? `, ${place.years.join(", ")}` : ""}` : `${feature.name}: not yet visited`;
  };
  demo.onModeChange = () => strip.render();
  demo.onTourChange = (isTouring) => strip.showTour(isTouring);
  let editor: TravelEditor | null = null;
  if (options.editApi) {
    void setUpEditor(options.editApi, demo, strip, layout).then((created) => (editor = created));
    const showSelection = demo.onSelectionChange;
    demo.onSelectionChange = (feature) => {
      showSelection(feature);
      editor?.showSelection(feature);
    };
  }

  let host: DemoHost;
  try {
    host = DemoHost.start(canvas, demo, {
      worldHeight: WORLD_HEIGHT,
      lineStyle: { beamWidth: 1.25, glowRadius: 2.4, glowStrength: 0.15, endpointBrightness: 0, jointOverlap: 0 },
      phosphor: { persistenceHalfLifeMilliseconds: 45, bloomStrength: 0.5, exposure: 1.45, flickerAmount: 0.015 },
    });
  } catch (error) {
    console.error(error);
    showFatalError("The travel globe needs WebGL2, which this browser did not provide. The list of places is below.");
    document.querySelector(".place-list")?.classList.remove("visually-hidden");
    return;
  }

  const openPost = () => {
    const slug = demo.selectedPlace?.blogPostSlug;
    if (slug) location.href = `${BLOG_BASE_URL}/blog/${slug}`;
  };

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // Typing in the editor's fields must not drive the globe.
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select")) return;
    // Enter and Space belong to a focused badge or button.
    if (event.target instanceof HTMLButtonElement && (event.key === "Enter" || event.key === " ")) return;
    if (event.key === "Escape" && editor?.isPicking) {
      editor.stopPicking();
      event.preventDefault();
      return;
    }
    demo.noteActivity();
    switch (event.key) {
      case "ArrowLeft": demo.dragBy(40, 0, 0); break;
      case "ArrowRight": demo.dragBy(-40, 0, 0); break;
      case "ArrowUp": demo.dragBy(0, 40, 0); break;
      case "ArrowDown": demo.dragBy(0, -40, 0); break;
      case "=": case "+": demo.zoomBy(1.25); break;
      case "-": case "_": demo.zoomBy(0.8); break;
      case "[": demo.stepPlace(-1); break;
      case "]": demo.stepPlace(1); break;
      case "w": case "W": demo.setMode("world"); break;
      case "u": case "U": demo.setMode("us"); break;
      case "p": case "P": demo.toggleTour(); break;
      case "Enter": openPost(); break;
      case " ": demo.toggleAutoRotate(); break;
      case "h": case "H": demo.toggleHelp(); break;
      case "f": case "F": toggleFullscreen(); break;
      case "Escape":
        if (document.fullscreenElement) return;
        demo.stopTour();
        if (demo.selected) demo.select(null);
        else if (demo.mode === "us") demo.setMode("world");
        else if (options.indexHref) location.href = options.indexHref;
        break;
      default: return;
    }
    event.preventDefault();
  });

  bindPointer(canvas, demo, host);
  (window as unknown as { travelGlobe: unknown }).travelGlobe = { demo, host, atlas };
}

// Asks the dev server whether this machine may edit; if so, adds the Edit button and the editor panel.
async function setUpEditor(apiUrl: string, demo: TravelGlobeDemo, strip: BadgeStrip, layout: HTMLElement): Promise<TravelEditor | null> {
  try {
    const { canEdit } = (await (await fetch(`${apiUrl}/editor`)).json()) as { canEdit: boolean };
    if (!canEdit) return null;
    // Start from the file on disk, which may be newer than the copy bundled into the page.
    const current = (await (await fetch(apiUrl)).json()) as TravelData;
    const applyData = (data: TravelData) => {
      demo.replaceAtlas(createAtlas(data, geo as GeoData));
      strip.render();
    };
    applyData(current);
    // Loaded only here, so the public site (no edit API) never downloads the editor.
    const { TravelEditor } = await import("./editor/TravelEditor.js");
    const editor = new TravelEditor({
      apiUrl,
      initialData: current,
      onChange: applyData,
      onPickMode: (onPick) => {
        demo.onPickLocation = onPick;
        layout.classList.toggle("is-picking", onPick !== null);
      },
      onOpenChange: (isOpen) => {
        demo.showsDetails = !isOpen;
        editButton.setAttribute("aria-pressed", String(isOpen));
      },
    });
    const editButton = strip.addEditButton(() => editor.toggle());
    editor.showSelection(demo.selected);
    layout.appendChild(editor.element);
    return editor;
  } catch {
    // No dev server API (for example a static build): no editing.
    return null;
  }
}

// One finger or the mouse drags the globe; two fingers pinch to zoom. A press that barely moves is a click.
function bindPointer(canvas: HTMLCanvasElement, demo: TravelGlobeDemo, host: DemoHost): void {
  const active = new Map<number, { x: number; y: number }>();
  let downPoint: { x: number; y: number } | null = null;
  let hasDragged = false;
  let lastMoveTime = 0;
  let pinchDistance = 0;
  let lastClick: { x: number; y: number; time: number } | null = null;

  canvas.style.cursor = "grab";
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    const point = host.clientToWorld(event.clientX, event.clientY);
    active.set(event.pointerId, point);
    demo.noteActivity();
    demo.stopSpin();
    if (active.size === 1) {
      downPoint = point;
      hasDragged = false;
      lastMoveTime = performance.now();
      canvas.style.cursor = "grabbing";
    } else if (active.size === 2) {
      const [a, b] = [...active.values()];
      pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      hasDragged = true;
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    const point = host.clientToWorld(event.clientX, event.clientY);
    const previous = active.get(event.pointerId);
    if (!previous) {
      if (event.pointerType === "mouse") demo.setPointer(point.x, point.y);
      return;
    }
    active.set(event.pointerId, point);
    if (active.size === 2) {
      const [a, b] = [...active.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDistance > 0) demo.zoomBy(distance / pinchDistance);
      pinchDistance = distance;
      return;
    }
    if (downPoint && Math.hypot(point.x - downPoint.x, point.y - downPoint.y) > CLICK_SLOP) hasDragged = true;
    if (hasDragged) {
      const now = performance.now();
      demo.dragBy(point.x - previous.x, point.y - previous.y, (now - lastMoveTime) / 1000);
      lastMoveTime = now;
    }
  });

  const release = (event: PointerEvent) => {
    if (!active.has(event.pointerId)) return;
    active.delete(event.pointerId);
    if (active.size > 0) return;
    canvas.style.cursor = "grab";
    // A pause before letting go means "stop here", not "fling".
    if (performance.now() - lastMoveTime > 80) demo.stopSpin();
    if (!hasDragged && downPoint && event.type === "pointerup") {
      const now = performance.now();
      const isDouble =
        lastClick !== null &&
        now - lastClick.time < DOUBLE_CLICK_MS &&
        Math.hypot(downPoint.x - lastClick.x, downPoint.y - lastClick.y) < DOUBLE_CLICK_DISTANCE;
      if (isDouble) {
        demo.focusAt(downPoint.x, downPoint.y);
        lastClick = null;
      } else {
        demo.clickAt(downPoint.x, downPoint.y);
        lastClick = { ...downPoint, time: now };
      }
    }
    downPoint = null;
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("pointerleave", () => demo.clearPointer());
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      demo.zoomBy(Math.exp(-event.deltaY * 0.0015));
    },
    { passive: false },
  );
}

// The same places as real text, for screen readers and as a fallback without WebGL2.
function addAccessiblePlaceList(demo: TravelGlobeDemo): void {
  const section = document.createElement("section");
  section.className = "place-list visually-hidden";
  section.setAttribute("aria-label", "Places");
  const heading = document.createElement("h1");
  heading.textContent = demo.atlas.title;
  section.appendChild(heading);
  for (const [kind, label] of [["country", "Countries"], ["state", "US states"]] as const) {
    const subheading = document.createElement("h2");
    subheading.textContent = label;
    const list = document.createElement("ul");
    for (const place of demo.atlas.places.filter((p) => p.kind === kind)) {
      const item = document.createElement("li");
      const details = [place.status, place.years.join(", "), place.cities.map((city) => city.name).join(", ")].filter(Boolean);
      item.textContent = `${place.name}: ${details.join("; ")}`;
      if (place.blogPostSlug) {
        const link = document.createElement("a");
        link.href = `${BLOG_BASE_URL}/blog/${place.blogPostSlug}`;
        link.textContent = ` (${place.postTitle ?? "post"})`;
        item.appendChild(link);
      }
      list.appendChild(item);
    }
    section.append(subheading, list);
  }
  document.body.appendChild(section);
}

function addAnnouncer(): HTMLElement {
  const announcer = document.createElement("p");
  announcer.className = "visually-hidden";
  announcer.setAttribute("aria-live", "polite");
  document.body.appendChild(announcer);
  return announcer;
}
