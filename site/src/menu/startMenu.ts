import { DemoHost, showFatalError } from "@vector-demos/demo-kit";
import { DEMO_CATALOG, type DemoEntry } from "../catalog.js";
import { MenuDemo } from "./MenuDemo.js";

const WORLD_HEIGHT = 1000;
const STORAGE_KEY = "vector-demos:last-demo";

function readRememberedIndex(): number {
  try {
    const path = localStorage.getItem(STORAGE_KEY);
    return DEMO_CATALOG.findIndex((entry) => entry.path === path);
  } catch {
    return 0;
  }
}

function rememberDemo(entry: DemoEntry): void {
  try {
    localStorage.setItem(STORAGE_KEY, entry.path);
  } catch {
    // Storage can be unavailable (private windows, blocked site data); the menu just starts at the top.
  }
}

function demoHref(entry: DemoEntry): string {
  return `./${entry.path}/`;
}

// Real links for screen readers and keyboard users, and a fallback when WebGL2 is missing.
function addAccessibleLinks(): void {
  const nav = document.createElement("nav");
  nav.className = "visually-hidden";
  nav.setAttribute("aria-label", "Demos");
  const list = document.createElement("ul");
  for (const entry of DEMO_CATALOG) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = demoHref(entry);
    link.textContent = `${entry.title}: ${entry.description}`;
    item.appendChild(link);
    list.appendChild(item);
  }
  nav.appendChild(list);
  document.body.appendChild(nav);
}

export function startMenu(canvas: HTMLCanvasElement): void {
  addAccessibleLinks();
  const menu = new MenuDemo(DEMO_CATALOG, readRememberedIndex());
  menu.onOpen = (entry) => {
    rememberDemo(entry);
    location.href = demoHref(entry);
  };

  let host: DemoHost;
  try {
    host = DemoHost.start(canvas, menu, {
      worldHeight: WORLD_HEIGHT,
      lineStyle: { beamWidth: 1.6, glowRadius: 2.8, glowStrength: 0.16, endpointBrightness: 0.2, jointOverlap: 0.3 },
      phosphor: { persistenceHalfLifeMilliseconds: 60, bloomStrength: 0.45, exposure: 1.4, flickerAmount: 0.03 },
    });
  } catch (error) {
    console.error(error);
    showFatalError("The demos need WebGL2, which this browser did not provide.");
    document.querySelector("nav")?.classList.remove("visually-hidden");
    return;
  }

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const number = Number.parseInt(event.key, 10);
    if (event.key === "ArrowUp" || event.key === "w" || event.key === "W") menu.move(-1);
    else if (event.key === "ArrowDown" || event.key === "s" || event.key === "S") menu.move(1);
    else if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") menu.moveColumn(-1);
    else if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") menu.moveColumn(1);
    else if (event.key === "Enter" || event.key === " ") menu.open();
    else if (number >= 1 && number <= DEMO_CATALOG.length) menu.open(number - 1);
    else return;
    event.preventDefault();
  });

  const rowUnder = (event: PointerEvent | MouseEvent) => {
    const point = host.clientToWorld(event.clientX, event.clientY);
    return menu.model.rowAt(menu.layout, point.x, point.y);
  };
  canvas.addEventListener("pointermove", (event) => {
    const row = rowUnder(event);
    canvas.style.cursor = row >= 0 ? "pointer" : "default";
    if (row >= 0) menu.select(row);
  });
  canvas.addEventListener("click", (event) => {
    const row = rowUnder(event);
    if (row >= 0) menu.open(row);
  });
  // Coming back with the browser's Back button can restore this page from cache mid-launch.
  window.addEventListener("pageshow", () => canvas.focus());
}
