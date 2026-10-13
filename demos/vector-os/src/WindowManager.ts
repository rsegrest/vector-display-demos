import type { ClipRect } from "@vector-demos/demo-kit";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const TITLE_BAR_HEIGHT = 36;
// The close box, and the box that opens the program full screen, at the ends of the title bar.
export const TITLE_BOX_SIZE = 20;
const TITLE_BOX_INSET = 8;
// The corner you drag to resize, measured in from the bottom right.
export const RESIZE_GRIP = 22;
export const MINIMUM_WIDTH = 260;
export const MINIMUM_HEIGHT = 190;
// A window opens and closes as a rectangle growing from, or shrinking to, where it came from.
export const ZOOM_SECONDS = 0.28;

export type WindowPart = "close" | "launch" | "title" | "resize" | "content";

export interface OsWindow<Payload> {
  readonly id: number;
  readonly title: string;
  readonly payload: Payload;
  // The whole frame, title bar included.
  readonly rect: Rect;
  // Where the window grew from, and shrinks back to when closed.
  readonly origin: Rect;
  // "opening" and "closing" are the zoom animations; only an "open" window shows its contents.
  state: "opening" | "open" | "closing";
  // How far through the current animation, 0..1.
  animation: number;
  // Whether the title bar shows the box that opens this program full screen.
  readonly canLaunch: boolean;
}

export interface Hit<Payload> {
  readonly window: OsWindow<Payload>;
  readonly part: WindowPart;
}

type Drag<Payload> = { readonly window: OsWindow<Payload>; readonly kind: "move" | "resize"; readonly grabX: number; readonly grabY: number };

// Keeps track of the windows: where each is, which is in front, and what a pointer
// at any spot is touching. It knows nothing about what is inside them or how they
// are drawn; `Payload` is whatever the caller wants to keep with each window.
export class WindowManager<Payload> {
  // Back to front: the last window is on top and has the keyboard.
  private readonly stack: OsWindow<Payload>[] = [];
  private bounds: Rect = { x: 0, y: 0, width: 1600, height: 1000 };
  private nextId = 1;
  private drag: Drag<Payload> | null = null;

  // The part of the screen windows may occupy.
  public setBounds(bounds: Rect): void {
    this.bounds = { ...bounds };
    for (const window of this.stack) this.keepOnScreen(window.rect);
  }

  public get windows(): readonly OsWindow<Payload>[] {
    return this.stack;
  }

  // The window in front, which gets the keyboard; null if none is fully open.
  public get focused(): OsWindow<Payload> | null {
    for (let index = this.stack.length - 1; index >= 0; index--) {
      if (this.stack[index].state !== "closing") return this.stack[index];
    }
    return null;
  }

  // Opens a window of the given size, growing out of `origin`, placed wherever it
  // covers least of the windows already open.
  public open(title: string, payload: Payload, size: { width: number; height: number }, origin: Rect, canLaunch = false): OsWindow<Payload> {
    const width = Math.min(Math.max(MINIMUM_WIDTH, size.width), this.bounds.width);
    const height = Math.min(Math.max(MINIMUM_HEIGHT, size.height), this.bounds.height);
    const rect = { ...this.findPlace(width, height), width, height };
    this.keepOnScreen(rect);
    const window: OsWindow<Payload> = { id: this.nextId++, title, payload, rect, origin: { ...origin }, state: "opening", animation: 0, canLaunch };
    this.stack.push(window);
    return window;
  }

  // Starts a window closing; it is removed once it has shrunk away.
  public close(window: OsWindow<Payload>): void {
    if (window.state === "closing") return;
    window.state = "closing";
    window.animation = 0;
    if (this.drag?.window === window) this.drag = null;
  }

  public bringToFront(window: OsWindow<Payload>): void {
    const index = this.stack.indexOf(window);
    if (index < 0 || index === this.stack.length - 1) return;
    this.stack.splice(index, 1);
    this.stack.push(window);
  }

  // Advances the opening and closing animations. Returns the windows that have just finished closing.
  public update(deltaSeconds: number): OsWindow<Payload>[] {
    const closed: OsWindow<Payload>[] = [];
    for (const window of [...this.stack]) {
      if (window.state === "open") continue;
      window.animation = Math.min(1, window.animation + deltaSeconds / ZOOM_SECONDS);
      if (window.animation < 1) continue;
      if (window.state === "opening") {
        window.state = "open";
      } else {
        this.stack.splice(this.stack.indexOf(window), 1);
        closed.push(window);
      }
    }
    return closed;
  }

  // The rectangle inside the frame where the program draws.
  public contentRect(window: OsWindow<Payload>): Rect {
    return { x: window.rect.x, y: window.rect.y + TITLE_BAR_HEIGHT, width: window.rect.width, height: window.rect.height - TITLE_BAR_HEIGHT };
  }

  public closeBox(window: OsWindow<Payload>): Rect {
    return { x: window.rect.x + TITLE_BOX_INSET, y: window.rect.y + (TITLE_BAR_HEIGHT - TITLE_BOX_SIZE) / 2, width: TITLE_BOX_SIZE, height: TITLE_BOX_SIZE };
  }

  public launchBox(window: OsWindow<Payload>): Rect {
    return {
      x: window.rect.x + window.rect.width - TITLE_BOX_INSET - TITLE_BOX_SIZE,
      y: window.rect.y + (TITLE_BAR_HEIGHT - TITLE_BOX_SIZE) / 2,
      width: TITLE_BOX_SIZE,
      height: TITLE_BOX_SIZE,
    };
  }

  // What is at a point: the frontmost open window there, and which part of it.
  public hitTest(x: number, y: number): Hit<Payload> | null {
    for (let index = this.stack.length - 1; index >= 0; index--) {
      const window = this.stack[index];
      if (window.state !== "open" || !contains(window.rect, x, y)) continue;
      if (contains(this.closeBox(window), x, y)) return { window, part: "close" };
      if (window.canLaunch && contains(this.launchBox(window), x, y)) return { window, part: "launch" };
      if (y < window.rect.y + TITLE_BAR_HEIGHT) return { window, part: "title" };
      if (x > window.rect.x + window.rect.width - RESIZE_GRIP && y > window.rect.y + window.rect.height - RESIZE_GRIP) return { window, part: "resize" };
      return { window, part: "content" };
    }
    return null;
  }

  // Begins moving a window by its title bar, or resizing it by its corner.
  public beginDrag(window: OsWindow<Payload>, kind: "move" | "resize", x: number, y: number): void {
    this.bringToFront(window);
    this.drag =
      kind === "move"
        ? { window, kind, grabX: x - window.rect.x, grabY: y - window.rect.y }
        : { window, kind, grabX: window.rect.x + window.rect.width - x, grabY: window.rect.y + window.rect.height - y };
  }

  public get isDragging(): boolean {
    return this.drag !== null;
  }

  public dragTo(x: number, y: number): void {
    const drag = this.drag;
    if (!drag) return;
    const { rect } = drag.window;
    if (drag.kind === "move") {
      rect.x = x - drag.grabX;
      rect.y = y - drag.grabY;
    } else {
      rect.width = Math.max(MINIMUM_WIDTH, x + drag.grabX - rect.x);
      rect.height = Math.max(MINIMUM_HEIGHT, y + drag.grabY - rect.y);
    }
    this.keepOnScreen(rect);
  }

  public endDrag(): void {
    this.drag = null;
  }

  // The frames of every window in front of the given one (or of all of them, for
  // null): what must be cut out of anything drawn behind.
  public framesInFront(window: OsWindow<Payload> | null): ClipRect[] {
    const from = window ? this.stack.indexOf(window) + 1 : 0;
    return this.stack
      .slice(from)
      .filter((other) => other.state === "open")
      .map((other) => toClipRect(other.rect));
  }

  // The rectangle to draw for a window that is opening or closing: part-way
  // between where it came from and its full frame.
  public zoomRect(window: OsWindow<Payload>): Rect {
    const raw = window.state === "closing" ? 1 - window.animation : window.animation;
    const amount = raw * raw * (3 - 2 * raw);
    const { origin, rect } = window;
    return {
      x: origin.x + (rect.x - origin.x) * amount,
      y: origin.y + (rect.y - origin.y) * amount,
      width: origin.width + (rect.width - origin.width) * amount,
      height: origin.height + (rect.height - origin.height) * amount,
    };
  }

  // Tries places across the screen, left to right and top to bottom, and takes the
  // one that overlaps the open windows least. On an empty screen that is the top
  // left; once the screen is full, windows start to stack, each a little further
  // along than the last so that no title bar is hidden.
  private findPlace(width: number, height: number): { x: number; y: number } {
    const { bounds } = this;
    const others = this.stack.filter((window) => window.state !== "closing");
    const margin = 16;
    const step = 36;
    let best = { x: bounds.x + margin, y: bounds.y + margin };
    let bestCost = Infinity;
    for (let y = bounds.y + margin; y + height <= bounds.y + bounds.height - margin || y === bounds.y + margin; y += step) {
      for (let x = bounds.x + margin; x + width <= bounds.x + bounds.width - margin || x === bounds.x + margin; x += step) {
        let cost = 0;
        for (const other of others) {
          const overlapX = Math.min(x + width, other.rect.x + other.rect.width) - Math.max(x, other.rect.x);
          const overlapY = Math.min(y + height, other.rect.y + other.rect.height) - Math.max(y, other.rect.y);
          if (overlapX > 0 && overlapY > 0) cost += overlapX * overlapY;
          // Landing exactly on another window's corner would hide its title bar.
          if (Math.abs(x - other.rect.x) < step && Math.abs(y - other.rect.y) < step) cost += width * height;
        }
        if (cost < bestCost) {
          bestCost = cost;
          best = { x, y };
        }
      }
    }
    return best;
  }

  // A window may be pushed partly off the sides or bottom, but its title bar stays
  // reachable, and it is never larger than the screen.
  private keepOnScreen(rect: Rect): void {
    const { bounds } = this;
    rect.width = Math.min(rect.width, bounds.width);
    rect.height = Math.min(rect.height, bounds.height);
    const reachable = 80;
    rect.x = Math.max(bounds.x - rect.width + reachable, Math.min(bounds.x + bounds.width - reachable, rect.x));
    rect.y = Math.max(bounds.y, Math.min(bounds.y + bounds.height - TITLE_BAR_HEIGHT, rect.y));
  }
}

export function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

export function toClipRect(rect: Rect): ClipRect {
  return { left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height };
}
