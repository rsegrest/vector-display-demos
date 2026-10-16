import { DisplayList } from "@vector-display/core";
import { getDemoFont, type ClipRect, type Demo, type DemoFrame } from "@vector-demos/demo-kit";
import { SegmentBlitter } from "../../SegmentBlitter.js";
import type { KeyPress, OsApp, PointerKind } from "../OsApp.js";
import type { ArcadeCabinet } from "./ArcadeCabinet.js";
import { FixedStepClock } from "./FixedStepClock.js";

// The line of controls under the picture.
export const CONTROLS_TEXT_SIZE = 9;
const CONTROLS_LINE_HEIGHT = 16;
const CONTROLS_MARGIN = 8;
// Pointer movements further apart than this are not one movement: the pointer left the window and came back.
const POINTER_GAP_SECONDS = 0.15;

export interface ArcadeLayout {
  // Where the game's screen goes in the window, and how its coordinates are scaled to fill it.
  readonly picture: ClipRect;
  readonly scaleX: number;
  readonly scaleY: number;
  // The baseline of the first line of controls.
  readonly controlsTop: number;
}

// Fits the game's screen into the window above its lines of controls, as large
// as it will go at the screen's own shape, and centred in what is left over.
export function arcadeLayout(width: number, height: number, screen: ArcadeCabinet["screen"], controlLines: number): ArcadeLayout {
  const controlsHeight = controlLines > 0 ? controlLines * CONTROLS_LINE_HEIGHT + CONTROLS_MARGIN : 0;
  const available = { width: Math.max(1, width), height: Math.max(1, height - controlsHeight) };
  const pictureWidth = Math.min(available.width, available.height * screen.aspect);
  const pictureHeight = pictureWidth / screen.aspect;
  const left = (available.width - pictureWidth) / 2;
  const top = (available.height - pictureHeight) / 2;
  return {
    picture: { left, top, right: left + pictureWidth, bottom: top + pictureHeight },
    scaleX: pictureWidth / screen.width,
    scaleY: pictureHeight / screen.height,
    controlsTop: top + pictureHeight + CONTROLS_MARGIN / 2,
  };
}

// Breaks the controls into lines that fit the width. The games list them as
// groups two spaces apart ("1 COIN  ENTER START"), and a group is never split.
export function wrapControls(text: string, width: number, measure: (line: string) => number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const group of text.split(/ {2,}/)) {
    const longer = line ? `${line}   ${group}` : group;
    if (line && measure(longer) > width) {
      lines.push(line);
      line = group;
    } else {
      line = longer;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// One of the arcade games, running in a window.
//
// It is never paused. In the background it carries on as the cabinet would,
// playing its attract mode (or a game, until the ships run out); in front it
// has the keyboard, and, for Tempest, the mouse as its spinner. The game keeps
// its own time: the OS's updates are turned into the game's own steps.
class ArcadeGameDemo implements Demo {
  private readonly clock: FixedStepClock;
  private readonly picture = new DisplayList();
  private readonly blitter = new SegmentBlitter();
  private seconds = 0;
  private isFocused = false;
  private lastPointer: { x: number; seconds: number } | null = null;

  public constructor(private readonly cabinet: ArcadeCabinet) {
    this.clock = new FixedStepClock(cabinet.stepsPerSecond, cabinet.mostStepsAtOnce);
  }

  public update(deltaSeconds: number): void {
    this.seconds += deltaSeconds;
    // Called even when no step is due, as the pages do once a display frame: that is when sound is updated.
    this.cabinet.advance(this.clock.advance(deltaSeconds));
  }

  public draw(displayList: DisplayList, frame: DemoFrame): void {
    const font = getDemoFont();
    const controls = wrapControls(this.cabinet.controls, frame.width - 2 * CONTROLS_MARGIN, (line) => font.measureText(line, CONTROLS_TEXT_SIZE).width);
    const layout = arcadeLayout(frame.width, frame.height, this.cabinet.screen, controls.length);
    this.picture.clear();
    this.cabinet.draw(this.picture);
    this.blitter.beginFrame();
    this.blitter.blit(this.picture, displayList, {
      offsetX: layout.picture.left,
      offsetY: layout.picture.top,
      scale: layout.scaleX,
      scaleY: layout.scaleY,
      intensity: 1,
      inside: layout.picture,
      outside: [],
    });
    displayList.setColor({ red: 0.5, green: 0.85, blue: 0.95 });
    controls.forEach((line, index) => {
      font.addText(displayList, {
        text: line,
        x: frame.width / 2,
        y: layout.controlsTop + index * CONTROLS_LINE_HEIGHT,
        size: CONTROLS_TEXT_SIZE,
        alignment: "center",
        intensity: this.isFocused ? 0.75 : 0.35,
      });
    });
  }

  public setFocused(focused: boolean): void {
    this.isFocused = focused;
    this.lastPointer = null;
    // A button held as the window left the front would otherwise stay down.
    if (!focused) this.cabinet.mouseButton?.(0, false);
  }

  public keyDown(press: KeyPress): boolean {
    // A key press is what browsers ask for before a page may make sound.
    this.cabinet.enableSound();
    return this.cabinet.keyDown(press);
  }

  public keyUp(press: KeyPress): void {
    this.cabinet.keyUp(press);
  }

  // The pointer turns a spinner by how far it moves sideways, and its button fires.
  // Only in front: a window behind is only being watched.
  public pointer(kind: PointerKind, x: number): void {
    if (!this.isFocused || !this.cabinet.mouseMove) return;
    if (kind === "down") {
      this.cabinet.enableSound();
      this.cabinet.mouseButton?.(0, true);
    } else if (kind === "up") {
      this.cabinet.mouseButton?.(0, false);
    }
    const last = this.lastPointer;
    if (last && this.seconds - last.seconds < POINTER_GAP_SECONDS) this.cabinet.mouseMove(x - last.x);
    this.lastPointer = { x, seconds: this.seconds };
  }
}

export interface ArcadeAppOptions {
  // Brightness of the picture. A game drawn for a screen of its own, with its own glow, can be too bright in a window.
  readonly brightness?: number;
}

export function createArcadeApp(cabinet: ArcadeCabinet, options: ArcadeAppOptions = {}): OsApp {
  const demo = new ArcadeGameDemo(cabinet);
  return {
    demo,
    // One unit per screen unit: the game is scaled to the window here, keeping its screen's shape.
    worldHeight: null,
    brightness: options.brightness ?? 1,
    onKeyDown: (press) => demo.keyDown(press),
    onKeyUp: (press) => demo.keyUp(press),
    onPointer: (kind, x) => demo.pointer(kind, x),
    setFocused: (focused) => demo.setFocused(focused),
    setAudible: (audible) => cabinet.setAudible(audible),
    dispose: () => cabinet.dispose(),
  };
}
