import { DisplayList, SCREEN_SPACE_PLACEMENT, type BeamColor } from "@vector-display/core";
import { BeamSettingsStore, DynamicGeometry, getDemoFont, type Demo, type DemoFrame } from "@vector-demos/demo-kit";
import type { AppEntry, OsApp, OsServices, PointerKind } from "./apps/OsApp.js";
import { APP_ENTRIES } from "./apps/registry.js";
import { BootSequence } from "./Boot.js";
import { SegmentBlitter } from "./SegmentBlitter.js";
import { TITLE_BAR_HEIGHT, TITLE_BOX_SIZE, RESIZE_GRIP, WindowManager, contains, toClipRect, type OsWindow, type Rect } from "./WindowManager.js";

export const VECTOR_OS_WORLD_HEIGHT = 1000;
export const MENU_BAR_HEIGHT = 44;
export const LAUNCHER_WIDTH = 300;
const LAUNCHER_ROW = 31;
const LAUNCHER_TOP = MENU_BAR_HEIGHT + 22;
const LAUNCHER_TEXT = 13;
// Opening one more window than this closes the one at the back.
export const MAXIMUM_WINDOWS = 8;
// The programs opened when the desktop first appears.
const STARTUP_PROGRAMS: readonly string[] = ["terminal", "clock", "polytopes"];

const CHROME_COLOR: BeamColor = { red: 0.45, green: 0.75, blue: 1 };
const DESKTOP_COLOR: BeamColor = { red: 0.5, green: 0.85, blue: 0.95 };
const HEADING_COLOR: BeamColor = { red: 1, green: 0.8, blue: 0.4 };

// What the OS keeps with each window.
interface Running {
  readonly entry: AppEntry;
  // Null until the program has loaded.
  app: OsApp | null;
  failed: boolean;
  // The program's own display list: it draws here, with no idea it is in a window.
  readonly list: DisplayList;
  // The size of the space last given to the program.
  worldWidth: number;
  worldHeight: number;
}

interface LauncherRow {
  readonly rect: Rect;
  readonly entry: AppEntry | null;
  readonly text: string;
}

export interface VectorOsOptions {
  // Skip the power-on sequence.
  readonly skipBoot?: boolean;
  // The programs to offer; a parameter so tests can use small ones.
  readonly entries?: readonly AppEntry[];
  readonly beam?: BeamSettingsStore;
  readonly now?: () => Date;
  readonly startup?: readonly string[];
}

// A desktop on a vector display. One beam draws all of it: the menu bar, the
// launcher, the window frames, and every program running in every window.
//
// Programs never draw to the screen. Each has a display list of its own, and each
// frame the OS copies those lists into the real one, shrunk into their windows
// and cut wherever another window lies on top. That is why the site's demos run
// here unchanged: they draw exactly as they do full screen.
export class VectorOsDemo implements Demo {
  public readonly beam: BeamSettingsStore;
  // Called when a window's "open full screen" box is clicked, with the program's id.
  public onNavigate: (id: string) => void = () => {};

  private readonly entries: readonly AppEntry[];
  private readonly windows = new WindowManager<Running>();
  private readonly blitter = new SegmentBlitter();
  private readonly desktopList = new DisplayList();
  private readonly chromeList = new DisplayList();
  private readonly textList = new DisplayList();
  private readonly chrome = new DynamicGeometry(64);
  private readonly desktopLines = new DynamicGeometry(16);
  private readonly services: OsServices;
  private readonly now: () => Date;
  private readonly startup: readonly string[];
  private boot: BootSequence | null;
  private width = 1778;
  private height = VECTOR_OS_WORLD_HEIGHT;
  private seconds = 0;
  private hoveredRow = -1;
  // The window that has the pointer while its button is held in that window's contents.
  private captured: OsWindow<Running> | null = null;
  private segmentCount = 0;

  public constructor(options: VectorOsOptions = {}) {
    this.entries = options.entries ?? APP_ENTRIES;
    this.beam = options.beam ?? new BeamSettingsStore();
    this.now = options.now ?? (() => new Date());
    this.startup = options.startup ?? STARTUP_PROGRAMS;
    this.boot = options.skipBoot ? null : new BootSequence(this.entries.length);
    this.services = {
      beam: this.beam,
      entries: this.entries,
      launch: (id) => this.launch(id),
      openWindows: () => this.windows.windows.filter((window) => window.state !== "closing").map((window) => window.title),
      close: (name) => this.closeByName(name),
      reboot: () => this.reboot(),
      now: this.now,
    };
    this.resize(this.width, this.height);
    if (!this.boot) this.openStartupPrograms();
  }

  public get isBooting(): boolean {
    return this.boot !== null;
  }

  public get openTitles(): string[] {
    return this.services.openWindows();
  }

  // The window in front, for tests and for the page to inspect.
  public get focusedTitle(): string | null {
    return this.windows.focused?.title ?? null;
  }

  public get windowManager(): WindowManager<Running> {
    return this.windows;
  }

  public get drawnSegments(): number {
    return this.segmentCount;
  }

  public resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.windows.setBounds({ x: LAUNCHER_WIDTH, y: MENU_BAR_HEIGHT, width: Math.max(300, width - LAUNCHER_WIDTH), height: height - MENU_BAR_HEIGHT });
  }

  public update(deltaSeconds: number): void {
    this.seconds += deltaSeconds;
    if (this.boot) {
      this.boot.update(deltaSeconds);
      if (this.boot.isDone) this.finishBoot();
      return;
    }
    for (const closed of this.windows.update(deltaSeconds)) closed.payload.app?.dispose?.();
    for (const window of this.windows.windows) {
      const running = window.payload;
      if (window.state !== "open" || !running.app) continue;
      this.sizeWorld(window);
      running.app.demo.update(deltaSeconds);
    }
  }

  public draw(displayList: DisplayList, frame: DemoFrame): void {
    if (this.boot) {
      this.boot.draw(displayList, frame);
      this.segmentCount = displayList.segmentCount;
      return;
    }
    const screen = { left: 0, top: 0, right: frame.width, bottom: frame.height };
    this.blitter.beginFrame();

    // The desktop is behind everything, so every window is cut out of it.
    this.desktopList.clear();
    this.drawDesktop(this.desktopList, frame);
    this.blitter.blit(this.desktopList, displayList, { offsetX: 0, offsetY: 0, scale: 1, intensity: 1, inside: screen, outside: this.windows.framesInFront(null) });

    // Then the windows, back to front, each cut by the ones in front of it.
    const focused = this.windows.focused;
    for (const window of this.windows.windows) {
      const inFront = this.windows.framesInFront(window);
      this.chromeList.clear();
      if (window.state === "open") this.drawFrame(window, window === focused);
      else this.drawZoom(window);
      this.blitter.blit(this.chromeList, displayList, { offsetX: 0, offsetY: 0, scale: 1, intensity: 1, inside: screen, outside: inFront });
      if (window.state === "open") this.drawContents(displayList, window, frame.seconds, inFront);
    }
    this.segmentCount = displayList.segmentCount;
  }

  // Reading text from the programs that have any, on the display's plain text layer.
  // It is cut to its window and by the windows in front, just as the rest of the contents are.
  public drawText(displayList: DisplayList, frame: DemoFrame): void {
    if (this.boot) return;
    for (const window of this.windows.windows) {
      const running = window.payload;
      if (window.state !== "open" || !running.app?.demo.drawText) continue;
      const content = this.windows.contentRect(window);
      const inside = toClipRect({ x: content.x + 1, y: content.y + 1, width: content.width - 2, height: content.height - 2 });
      const scale = this.sizeWorld(window);
      this.textList.clear();
      running.app.demo.drawText(this.textList, { width: running.worldWidth, height: running.worldHeight, seconds: frame.seconds });
      this.blitter.blit(this.textList, displayList, { offsetX: content.x, offsetY: content.y, scale, intensity: 1, inside, outside: this.windows.framesInFront(window) });
    }
  }

  // --- Input ---------------------------------------------------------------------------------------------

  // A key press. Goes to the program in the window in front.
  public key(key: string): void {
    if (this.boot) {
      this.boot.skip();
      return;
    }
    this.windows.focused?.payload.app?.onKey?.(key);
  }

  // The pointer, in screen (world) coordinates.
  public pointer(kind: "down" | "move" | "up", x: number, y: number, shiftKey = false): void {
    if (this.boot) {
      if (kind === "down") this.boot.skip();
      return;
    }
    if (kind === "down") this.pointerDown(x, y, shiftKey);
    else if (kind === "move") this.pointerMove(x, y, shiftKey);
    else this.pointerUp(x, y, shiftKey);
  }

  // What the pointer is over: for the page to choose a cursor.
  public cursorAt(x: number, y: number): "default" | "pointer" | "move" | "nwse-resize" {
    if (this.boot) return "default";
    const hit = this.windows.hitTest(x, y);
    if (hit) return hit.part === "title" ? "move" : hit.part === "resize" ? "nwse-resize" : hit.part === "content" ? "default" : "pointer";
    return this.launcherRowAt(x, y) >= 0 ? "pointer" : "default";
  }

  // Opens a program by id, or brings its window to the front if it is already open.
  public launch(id: string, origin?: Rect): boolean {
    const entry = this.entries.find((candidate) => candidate.id === id);
    if (!entry) return false;
    const existing = this.windows.windows.find((window) => window.payload.entry === entry && window.state !== "closing");
    if (existing) {
      this.windows.bringToFront(existing);
      return true;
    }
    const live = this.windows.windows.filter((window) => window.state !== "closing");
    if (live.length >= MAXIMUM_WINDOWS) this.windows.close(live[0]);
    const from = origin ?? this.launcherRows().find((row) => row.entry === entry)?.rect ?? { x: this.width / 2, y: this.height / 2, width: 0, height: 0 };
    const running: Running = { entry, app: null, failed: false, list: new DisplayList(), worldWidth: 0, worldHeight: 0 };
    this.windows.open(entry.title, running, entry.size, from, entry.kind === "demo");
    // Tools are ready at once; demos arrive when their code has loaded.
    Promise.resolve()
      .then(() => entry.create(this.services))
      .then((app) => {
        running.app = app;
      })
      .catch((error: unknown) => {
        console.error(error);
        running.failed = true;
      });
    return true;
  }

  // --- Internals -----------------------------------------------------------------------------------------

  private finishBoot(): void {
    this.boot = null;
    this.openStartupPrograms();
  }

  private openStartupPrograms(): void {
    for (const id of this.startup) this.launch(id);
  }

  private reboot(): void {
    for (const window of this.windows.windows) {
      window.payload.app?.dispose?.();
      this.windows.close(window);
    }
    // The closing animations are cut short: a reboot is abrupt.
    this.windows.update(1);
    this.captured = null;
    this.boot = new BootSequence(this.entries.length);
  }

  private closeByName(name: string): number {
    const plain = (text: string): string => text.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const wanted = plain(name);
    const matches = this.windows.windows.filter(
      (window) => window.state !== "closing" && (wanted === "ALL" || plain(window.title).startsWith(wanted) || plain(window.payload.entry.id).startsWith(wanted)),
    );
    for (const window of matches) this.windows.close(window);
    return matches.length;
  }

  // Gives the program the size of its drawing space, and tells it when that changes.
  private sizeWorld(window: OsWindow<Running>): number {
    const running = window.payload;
    const content = this.windows.contentRect(window);
    const worldHeight = running.app?.worldHeight ?? content.height;
    const worldWidth = worldHeight * (content.width / Math.max(1, content.height));
    if (running.app && (worldWidth !== running.worldWidth || worldHeight !== running.worldHeight)) {
      running.worldWidth = worldWidth;
      running.worldHeight = worldHeight;
      running.app.demo.resize?.(worldWidth, worldHeight);
    }
    return content.height / worldHeight;
  }

  private pointerDown(x: number, y: number, shiftKey: boolean): void {
    const hit = this.windows.hitTest(x, y);
    if (!hit) {
      const row = this.launcherRows()[this.launcherRowAt(x, y)];
      if (row?.entry) this.launch(row.entry.id, row.rect);
      return;
    }
    this.windows.bringToFront(hit.window);
    if (hit.part === "close") this.windows.close(hit.window);
    else if (hit.part === "launch") this.onNavigate(hit.window.payload.entry.id);
    else if (hit.part === "title") this.windows.beginDrag(hit.window, "move", x, y);
    else if (hit.part === "resize") this.windows.beginDrag(hit.window, "resize", x, y);
    else {
      this.captured = hit.window;
      this.sendPointer(hit.window, "down", x, y, shiftKey);
    }
  }

  private pointerMove(x: number, y: number, shiftKey: boolean): void {
    if (this.windows.isDragging) {
      this.windows.dragTo(x, y);
      return;
    }
    if (this.captured) {
      this.sendPointer(this.captured, "move", x, y, shiftKey);
      return;
    }
    const hit = this.windows.hitTest(x, y);
    this.hoveredRow = hit ? -1 : this.launcherRowAt(x, y);
    if (hit?.part === "content") this.sendPointer(hit.window, "hover", x, y, shiftKey);
  }

  private pointerUp(x: number, y: number, shiftKey: boolean): void {
    this.windows.endDrag();
    if (this.captured) this.sendPointer(this.captured, "up", x, y, shiftKey);
    this.captured = null;
  }

  // Passes the pointer to a window's program, in the program's own coordinates.
  private sendPointer(window: OsWindow<Running>, kind: PointerKind, x: number, y: number, shiftKey: boolean): void {
    const app = window.payload.app;
    if (!app?.onPointer || window.state !== "open") return;
    const content = this.windows.contentRect(window);
    const scale = this.sizeWorld(window);
    app.onPointer(kind, (x - content.x) / scale, (y - content.y) / scale, shiftKey);
  }

  // The launcher's rows: a heading for each kind of program, then its programs.
  private launcherRows(): LauncherRow[] {
    const rows: LauncherRow[] = [];
    let y = LAUNCHER_TOP;
    for (const [kind, heading] of [["tool", "TOOLS"], ["demo", "DEMOS"]] as const) {
      const entries = this.entries.filter((entry) => entry.kind === kind);
      if (entries.length === 0) continue;
      rows.push({ rect: { x: 0, y, width: LAUNCHER_WIDTH, height: LAUNCHER_ROW }, entry: null, text: heading });
      y += LAUNCHER_ROW;
      for (const entry of entries) {
        rows.push({ rect: { x: 0, y, width: LAUNCHER_WIDTH, height: LAUNCHER_ROW }, entry, text: entry.title.toUpperCase() });
        y += LAUNCHER_ROW;
      }
      y += LAUNCHER_ROW * 0.4;
    }
    return rows;
  }

  private launcherRowAt(x: number, y: number): number {
    return this.launcherRows().findIndex((row) => row.entry !== null && contains(row.rect, x, y));
  }

  private drawDesktop(list: DisplayList, frame: DemoFrame): void {
    const font = getDemoFont();
    this.desktopLines.clear();
    this.desktopLines.addSegment(0, MENU_BAR_HEIGHT, frame.width, MENU_BAR_HEIGHT);
    this.desktopLines.addSegment(LAUNCHER_WIDTH, MENU_BAR_HEIGHT, LAUNCHER_WIDTH, frame.height);
    list.setColor(DESKTOP_COLOR);
    list.addShape(this.desktopLines, { ...SCREEN_SPACE_PLACEMENT, intensity: 0.45 });
    font.addText(list, { text: "VECTOR OS", x: 18, y: 12, size: 20, intensity: 1.1 });
    const time = this.now();
    const clock = [time.getHours(), time.getMinutes(), time.getSeconds()].map((part) => String(part).padStart(2, "0")).join(":");
    font.addText(list, { text: clock, x: frame.width - 18, y: 14, size: 16, alignment: "right", intensity: 0.9 });

    const open = new Set(this.windows.windows.filter((window) => window.state !== "closing").map((window) => window.payload.entry));
    this.launcherRows().forEach((row, index) => {
      if (!row.entry) {
        list.setColor(HEADING_COLOR);
        font.addText(list, { text: row.text, x: 18, y: row.rect.y + 8, size: LAUNCHER_TEXT - 1, intensity: 0.8 });
        return;
      }
      list.setColor(DESKTOP_COLOR);
      // A program that is running is marked, and the row under the pointer is brighter.
      const marker = open.has(row.entry) ? "> " : "  ";
      font.addText(list, { text: `${marker}${row.text}`, x: 18, y: row.rect.y + 8, size: LAUNCHER_TEXT, intensity: index === this.hoveredRow ? 1.3 : 0.65 });
    });
  }

  // A window's frame: its outline, title bar, title, and the boxes and grip on it.
  private drawFrame(window: OsWindow<Running>, isFocused: boolean): void {
    const { rect } = window;
    const geometry = this.chrome;
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;
    geometry.clear();
    addRectangle(geometry, rect);
    geometry.addSegment(rect.x, rect.y + TITLE_BAR_HEIGHT, right, rect.y + TITLE_BAR_HEIGHT);
    // The close box, with a cross in it.
    const close = this.windows.closeBox(window);
    addRectangle(geometry, close);
    geometry.addSegment(close.x + 5, close.y + 5, close.x + TITLE_BOX_SIZE - 5, close.y + TITLE_BOX_SIZE - 5);
    geometry.addSegment(close.x + TITLE_BOX_SIZE - 5, close.y + 5, close.x + 5, close.y + TITLE_BOX_SIZE - 5);
    if (window.canLaunch) {
      // The "open full screen" box: a small frame with an arrow leaving its corner.
      const launch = this.windows.launchBox(window);
      addRectangle(geometry, launch);
      geometry.addSegment(launch.x + 6, launch.y + TITLE_BOX_SIZE - 6, launch.x + TITLE_BOX_SIZE - 5, launch.y + 5);
      geometry.addSegment(launch.x + TITLE_BOX_SIZE - 5, launch.y + 5, launch.x + TITLE_BOX_SIZE - 11, launch.y + 5);
      geometry.addSegment(launch.x + TITLE_BOX_SIZE - 5, launch.y + 5, launch.x + TITLE_BOX_SIZE - 5, launch.y + 11);
    }
    // The resize grip: two strokes across the bottom right corner.
    geometry.addSegment(right - RESIZE_GRIP + 6, bottom - 4, right - 4, bottom - RESIZE_GRIP + 6);
    geometry.addSegment(right - RESIZE_GRIP + 13, bottom - 4, right - 4, bottom - RESIZE_GRIP + 13);
    this.chromeList.setColor(CHROME_COLOR);
    this.chromeList.addShape(geometry, { ...SCREEN_SPACE_PLACEMENT, intensity: isFocused ? 1.1 : 0.45 });
    getDemoFont().addText(this.chromeList, { text: window.title.toUpperCase(), x: rect.x + rect.width / 2, y: rect.y + 11, size: 14, alignment: "center", intensity: isFocused ? 1.2 : 0.55 });
  }

  // An opening or closing window: a few nested rectangles between where it came
  // from and its frame, the trailing ones fainter, which reads as a zoom.
  private drawZoom(window: OsWindow<Running>): void {
    const geometry = this.chrome;
    geometry.clear();
    const lead = this.windows.zoomRect(window);
    addRectangle(geometry, lead);
    const { origin } = window;
    for (const trail of [0.66, 0.33]) {
      addRectangle(geometry, {
        x: origin.x + (lead.x - origin.x) * trail,
        y: origin.y + (lead.y - origin.y) * trail,
        width: origin.width + (lead.width - origin.width) * trail,
        height: origin.height + (lead.height - origin.height) * trail,
      });
    }
    this.chromeList.setColor(CHROME_COLOR);
    this.chromeList.addShape(geometry, { ...SCREEN_SPACE_PLACEMENT, intensity: 0.8 });
  }

  // Has the program draw itself, then copies its strokes into the window.
  private drawContents(displayList: DisplayList, window: OsWindow<Running>, seconds: number, inFront: ReturnType<WindowManager<Running>["framesInFront"]>): void {
    const running = window.payload;
    const content = this.windows.contentRect(window);
    const inside = toClipRect({ x: content.x + 1, y: content.y + 1, width: content.width - 2, height: content.height - 2 });
    running.list.clear();
    if (!running.app) {
      // Not loaded yet, or it could not be.
      this.chromeList.clear();
      this.chromeList.setColor(CHROME_COLOR);
      getDemoFont().addText(this.chromeList, {
        text: running.failed ? "COULD NOT LOAD" : "LOADING",
        x: content.x + content.width / 2,
        y: content.y + content.height / 2 - 8,
        size: 16,
        alignment: "center",
        intensity: 0.5 + 0.4 * Math.abs(Math.sin(this.seconds * 3)),
      });
      this.blitter.blit(this.chromeList, displayList, { offsetX: 0, offsetY: 0, scale: 1, intensity: 1, inside, outside: inFront });
      return;
    }
    const scale = this.sizeWorld(window);
    running.app.demo.draw(running.list, { width: running.worldWidth, height: running.worldHeight, seconds });
    this.blitter.blit(running.list, displayList, { offsetX: content.x, offsetY: content.y, scale, intensity: running.app.brightness ?? 1, inside, outside: inFront });
  }
}

function addRectangle(geometry: DynamicGeometry, rect: Rect): void {
  geometry.moveTo(rect.x, rect.y);
  geometry.lineTo(rect.x + rect.width, rect.y);
  geometry.lineTo(rect.x + rect.width, rect.y + rect.height);
  geometry.lineTo(rect.x, rect.y + rect.height);
  geometry.closePath();
}
