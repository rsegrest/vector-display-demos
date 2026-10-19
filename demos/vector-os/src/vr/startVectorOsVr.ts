// Vector OS in a virtual cabinet: the whole desktop, games and all, drawn on a
// hidden canvas exactly as its own page draws it, and shown on a big screen in
// a dark room, in a WebXR headset (the Meta Quest's browser) or, without one,
// as a flat preview on the page.  The right controller's ray is the mouse; the
// left controller is the arcade controls (controllerKeys.ts); a keyboard works
// too.  Nothing in Vector OS or the games changes.

import { DemoHost, showFatalError, type FrameScheduler } from "@vector-demos/demo-kit";
import { VECTOR_OS_WORLD_HEIGHT, VectorOsDemo } from "../VectorOsDemo.js";
import { codeOf, heldKeys, keyEdges, profileFor } from "./controllerKeys.js";
import { anchorAt, lookAt, multiply, panelOpacity, perspective, rayOfPose, rayOnScreen, screenFor, transformRay } from "./geometry.js";
import { VrRoom } from "./VrRoom.js";

// The few WebXR shapes used here (TypeScript's DOM library leaves WebXR out).
interface XrPose {
  readonly transform: { readonly matrix: Float32Array; readonly inverse: { readonly matrix: Float32Array } };
}
interface XrView extends XrPose {
  readonly projectionMatrix: Float32Array;
}
interface XrInputSource {
  readonly handedness: string;
  readonly targetRayMode?: string;
  readonly targetRaySpace: unknown;
  readonly gamepad?: { readonly buttons: readonly { readonly pressed: boolean }[]; readonly axes: readonly number[] };
}
interface XrFrame {
  getViewerPose(space: unknown): (XrPose & { readonly views: readonly XrView[] }) | null;
  getPose(space: unknown, base: unknown): XrPose | null;
}
interface XrLayer {
  readonly framebuffer: WebGLFramebuffer | null;
  getViewport(view: XrView): { x: number; y: number; width: number; height: number };
}
interface XrSession extends EventTarget {
  readonly inputSources: Iterable<XrInputSource>;
  readonly renderState: { readonly baseLayer?: XrLayer };
  updateRenderState(state: { baseLayer: XrLayer }): void;
  requestReferenceSpace(kind: string): Promise<unknown>;
  requestAnimationFrame(callback: (time: number, frame: XrFrame) => void): number;
  cancelAnimationFrame(id: number): void;
  end(): Promise<void>;
}
interface XrSystem {
  isSessionSupported(mode: string): Promise<boolean>;
  requestSession(mode: string, options: object): Promise<XrSession>;
}
declare const XRWebGLLayer: new (session: XrSession, gl: WebGL2RenderingContext) => XrLayer;

/** The hidden canvas Vector OS draws into: a 16:9 desktop (its default windows are laid out for one). */
const DESKTOP = { width: 1920, height: 1080 };
const PREVIEW_EYE: [number, number, number] = [0, 1.6, 0.4];

export function startVectorOsVr(view: HTMLCanvasElement, enterButton: HTMLButtonElement, note: HTMLElement): void {
  // Vector OS on its own canvas, out of sight, sized as a desktop.
  const desktop = document.createElement("canvas");
  desktop.style.cssText = `position:fixed;left:-${DESKTOP.width + 100}px;top:0;width:${DESKTOP.width}px;height:${DESKTOP.height}px`;
  document.body.appendChild(desktop);
  const os = new VectorOsDemo({ skipBoot: new URLSearchParams(location.search).get("boot") === "0" });
  let host: DemoHost;
  try {
    host = DemoHost.start(desktop, os, { worldHeight: VECTOR_OS_WORLD_HEIGHT, maxStepsPerFrame: 2 });
  } catch (error) {
    console.error(error);
    showFatalError("The virtual cabinet needs WebGL2, which this browser did not provide.");
    return;
  }
  // A program's own page cannot open inside the headset: its title-bar box maximizes the window instead.
  os.launchMaximizes = true;

  const gl = view.getContext("webgl2", { antialias: true, xrCompatible: true } as WebGLContextAttributes);
  if (!gl) {
    showFatalError("The virtual cabinet needs WebGL2, which this browser did not provide.");
    return;
  }
  // The desktop's screen, and the far bigger one a program full screen gets: 4.8 m tall at the
  // same distance, about 85 degrees of the view, with the room around it gone.
  const desktopScreen = screenFor(DESKTOP.width / DESKTOP.height, 3.6);
  const fullScreen = screenFor(DESKTOP.width / DESKTOP.height, 4.8 * (DESKTOP.width / DESKTOP.height));
  let screen = desktopScreen;
  // With a game in 3D there is no screen: the panel goes under this one instead, a stand-in 1.4 m ahead
  // at eye height, so it sits about 0.75 m below the eye (under the 4.8 m full screen it was below the floor).
  const panelPlace3d = { centre: [0, 1.6, -1.4] as const, width: 1.6, height: 0.8 };
  let panelPlace = desktopScreen as typeof desktopScreen;
  // Whether a game stands in the room in 3D: then there is no screen to point at, and the ray is not a mouse.
  let showing3d = false;
  const room = new VrRoom(gl, screen);
  const fitScreen = () => {
    // A game full screen that projects its own 3D (Tempest) stands in the room in 3D instead of
    // on the screen; on its flat screens (text, the score table) the big screen comes back.
    const picture = os.isFullScreen ? os.fullScreenPicture3d() : null;
    room.setPicture3d(picture);
    if (picture && !showing3d) {
      // The pointer leaves the game, and a game the mouse steers (Red Baron, once clicked) lets go of it
      // (its M key, as on its page): in 3D it is flown with the controllers.
      os.pointer("leave", 0, 0, false);
      if (os.focusedProgramId === "red-baron") {
        os.keyDown({ key: "m", code: "KeyM", repeat: false });
        os.keyUp({ key: "m", code: "KeyM", repeat: false });
      }
    }
    showing3d = picture !== null;
    const wanted = os.isFullScreen ? fullScreen : desktopScreen;
    if (wanted !== screen) {
      screen = wanted;
      room.setScreen(screen);
      room.showRoom = !os.isFullScreen;
    }
    const wantedPanel = showing3d ? panelPlace3d : screen;
    if (wantedPanel !== panelPlace) {
      panelPlace = wantedPanel;
      room.setPanelUnder(panelPlace);
    }
  };
  // The controls panel under the screen in the headset (it fades in as the viewer looks down at it).
  const statusCanvas = document.createElement("canvas");
  statusCanvas.width = 1024;
  statusCanvas.height = 256;
  const statusPen = statusCanvas.getContext("2d")!;
  const showStatus = (lines: string[]) => {
    statusPen.fillStyle = "#020608";
    statusPen.fillRect(0, 0, statusCanvas.width, statusCanvas.height);
    statusPen.fillStyle = "#8ff";
    statusPen.font = "26px monospace";
    lines.forEach((line, i) => statusPen.fillText(line.slice(0, 70), 16, 48 + i * 44));
    room.takeStatus(statusCanvas);
  };
  const toDesktop = (point: { x: number; y: number }) => ({ x: point.x * host.worldSize.width, y: point.y * host.worldSize.height });

  // --- the keyboard, as on Vector OS's page ---------------------------------
  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Escape") {
      os.exitFullScreen();
      return;
    }
    if (os.keyDown({ key: event.key, code: event.code, repeat: event.repeat }) || event.key === " " || event.key.startsWith("Arrow")) event.preventDefault();
  });
  window.addEventListener("keyup", (event) => os.keyUp({ key: event.key, code: event.code, repeat: false }));
  window.addEventListener("blur", () => os.releaseKeys());

  // --- the flat preview: the room from a fixed eye, the mouse a ray -----------
  const fovY = (60 * Math.PI) / 180;
  const previewRay = (event: PointerEvent) => {
    const bounds = view.getBoundingClientRect();
    const ndcX = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    const ndcY = 1 - ((event.clientY - bounds.top) / bounds.height) * 2;
    const tan = Math.tan(fovY / 2);
    const aspect = bounds.width / Math.max(1, bounds.height);
    // The preview eye looks straight ahead, down -z.
    const direction: [number, number, number] = [ndcX * tan * aspect, ndcY * tan, -1];
    return rayOnScreen(PREVIEW_EYE, direction, screen);
  };
  const previewPointer = (kind: "down" | "move" | "up") => (event: PointerEvent) => {
    const hit = previewRay(event);
    if (!hit) return;
    const point = toDesktop(hit);
    os.pointer(kind, point.x, point.y, event.shiftKey);
  };
  view.addEventListener("pointerdown", previewPointer("down"));
  view.addEventListener("pointermove", previewPointer("move"));
  view.addEventListener("pointerup", previewPointer("up"));
  view.addEventListener("contextmenu", (event) => event.preventDefault());

  let inHeadset = false;
  const drawPreview = () => {
    if (inHeadset) return;
    const width = Math.floor(view.clientWidth * Math.min(2, devicePixelRatio));
    const height = Math.floor(view.clientHeight * Math.min(2, devicePixelRatio));
    if (view.width !== width || view.height !== height) {
      view.width = width;
      view.height = height;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    fitScreen();
    room.takePicture(desktop);
    room.clear();
    room.draw(perspective(fovY, width / Math.max(1, height), 0.05, 1000), lookAt(PREVIEW_EYE, [PREVIEW_EYE[0], PREVIEW_EYE[1], PREVIEW_EYE[2] - 1]), [], { width, height });
    requestAnimationFrame(drawPreview);
  };
  requestAnimationFrame(drawPreview);

  // --- the headset ------------------------------------------------------------
  const xr = (navigator as unknown as { xr?: XrSystem }).xr;
  if (!xr) {
    note.textContent = window.isSecureContext
      ? "This browser has no WebXR: this is the flat preview. Open this page in the Quest's browser to step inside."
      : "WebXR needs a secure page (https, or localhost): this is the flat preview. See the README for serving it to the Quest.";
    enterButton.disabled = true;
  } else {
    void xr.isSessionSupported("immersive-vr").then((supported) => {
      enterButton.disabled = !supported;
      if (!supported) note.textContent = "This browser has WebXR but no headset: this is the flat preview.";
    });
  }

  enterButton.addEventListener("click", async () => {
    if (!xr || inHeadset) return;
    const session = await xr.requestSession("immersive-vr", { requiredFeatures: ["local-floor"] });
    await (gl as unknown as { makeXRCompatible(): Promise<void> }).makeXRCompatible();
    session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
    const floor = await session.requestReferenceSpace("local-floor");
    inHeadset = true;

    // Vector OS's frames now come from the session's (the window's stop in the headset).
    let pendingFrame: ((time: number) => void) | null = null;
    const sessionFrames: FrameScheduler = {
      request: (callback) => {
        pendingFrame = callback;
        return 1;
      },
      cancel: () => {
        pendingFrame = null;
      },
    };
    host.setFrameScheduler(sessionFrames);

    const heldByHand = new Map<string, Set<string>>();
    // The click is WebXR's "select": a controller's trigger, or a pinch with hand tracking.  The
    // pointing hand is the right one, or whichever hand last selected (a lone hand, a left-hander).
    let pointingHand = "right";
    let lastFrame: XrFrame | null = null;
    const hitOf = (source: XrInputSource, frame: XrFrame | null) => {
      const pose = frame?.getPose(source.targetRaySpace, floor);
      if (!pose) return null;
      const { origin, direction } = roomRay(pose.transform.matrix);
      return rayOnScreen(origin, direction, screen);
    };
    // The left controller's trigger is the fire button, not a click (it has a gamepad: controllerKeys.ts).
    const clicks = (source: XrInputSource) => !(source.handedness === "left" && source.gamepad && pointingHand === "right");
    session.addEventListener("selectstart", (event) => {
      const source = (event as unknown as { inputSource: XrInputSource }).inputSource;
      if (!clicks(source) || showing3d) return;
      pointingHand = source.handedness;
      const hit = hitOf(source, (event as unknown as { frame?: XrFrame }).frame ?? lastFrame);
      if (hit) {
        const point = toDesktop(hit);
        os.pointer("down", point.x, point.y, false);
      }
    });
    session.addEventListener("selectend", (event) => {
      const source = (event as unknown as { inputSource: XrInputSource }).inputSource;
      if (!clicks(source) || source.handedness !== pointingHand || showing3d) return;
      const hit = hitOf(source, (event as unknown as { frame?: XrFrame }).frame ?? lastFrame);
      const point = hit ? toDesktop(hit) : { x: 0, y: 0 };
      os.pointer(hit ? "up" : "leave", point.x, point.y, false);
    });
    let frames = 0;
    let rightStickWasPressed = false;
    let leftStickWasPressed = false;
    let rightGripWasPressed = false;
    let rightFlickWas = 0;
    // What the page sees of the style controls, for the panel (the owner could not switch styles: this says where it stops).
    let styleDiagnosis = "";
    // The 3D style just chosen (right grip), shown on the panel for a moment.
    let styleShown: { name: string; until: number } | null = null;
    // Where the room stands: recentred on the head when the session starts, when a program goes
    // full screen, and when the left thumbstick is pressed in (sitting or standing, it faces you).
    let anchor: ReturnType<typeof anchorAt> | null = null;
    let recentreWanted = true;
    let wasFullScreen = false;
    // A controller's ray in the room's space.
    const roomRay = (matrix: ArrayLike<number>) => {
      const ray = rayOfPose(matrix);
      return anchor ? transformRay(anchor.toRoom, ray.origin, ray.direction) : ray;
    };
    const onFrame = (time: number, frame: XrFrame) => {
      session.requestAnimationFrame(onFrame);
      fitScreen();
      lastFrame = frame;
      frames += 1;
      try {
        handleInputs(frame);
      } catch (error) {
        console.error(error);
      }
      draw(time, frame);
    };
    const handleInputs = (frame: XrFrame) => {
      const rays: { origin: number[]; end: number[] }[] = [];
      for (const source of session.inputSources) {
        const pose = frame.getPose(source.targetRaySpace, floor);
        const pad = source.gamepad;
        if (pose) {
          const { origin, direction } = roomRay(pose.transform.matrix);
          // The ray stops at the screen when it meets it, so its end is the cursor.
          const t = direction[2] < -1e-6 ? (screen.centre[2] - origin[2]) / direction[2] : 6;
          const reach = rayOnScreen(origin, direction, screen) ? t : 6;
          rays.push({ origin, end: [origin[0] + direction[0] * reach, origin[1] + direction[1] * reach, origin[2] + direction[2] * reach] });
          if (source.handedness === pointingHand && !showing3d) {
            const hit = rayOnScreen(origin, direction, screen);
            if (hit) {
              const point = toDesktop(hit);
              os.pointer("move", point.x, point.y, false);
            }
          }
        }
        if (pad && source.handedness === "left") {
          // The left thumbstick, pressed: recentre the room on the head.
          const stickPressed = pad.buttons[3]?.pressed === true;
          if (stickPressed && !leftStickWasPressed) recentreWanted = true;
          leftStickWasPressed = stickPressed;
        }
        if (pad && source.handedness === "right") {
          // The right grip: the full-screen game's next 3D style, for a game whose 3D is a choice.
          const gripPressed = pad.buttons[1]?.pressed === true;
          if (gripPressed && !rightGripWasPressed) {
            const name = os.cycleFullScreen3dStyle();
            styleShown = { name: name ?? "none for this game", until: performance.now() + 2000 };
          }
          rightGripWasPressed = gripPressed;
          // The right thumbstick flicked left or right: the same, a second way (games with treads use it to drive).
          const across = pad.axes[2] ?? 0;
          const flick = !profileFor(os.focusedProgramId).treads && Math.abs(across) > 0.7 ? Math.sign(across) : Math.abs(across) < 0.3 ? 0 : rightFlickWas;
          if (flick !== 0 && rightFlickWas === 0) {
            const name = os.cycleFullScreen3dStyle();
            styleShown = { name: name ?? "none for this game", until: performance.now() + 2000 };
          }
          rightFlickWas = flick;
          styleDiagnosis = `right pad: ${pad.buttons.length} buttons, grip ${gripPressed ? "DOWN" : "up"}, stick x ${across.toFixed(1)}; ${os.focusedProgramId ?? "none"}`;
          // The right thumbstick, pressed: back from a program full screen to the desktop.
          const stickPressed = pad.buttons[3]?.pressed === true;
          if (stickPressed && !rightStickWasPressed) os.exitFullScreen();
          rightStickWasPressed = stickPressed;
        }
        if (pad) {
          const before = heldByHand.get(source.handedness) ?? new Set<string>();
          const now = heldKeys({ hand: source.handedness, pressed: pad.buttons.map((b) => b.pressed), stick: [pad.axes[2] ?? 0, pad.axes[3] ?? 0] }, before, profileFor(os.focusedProgramId));
          for (const edge of keyEdges(before, now)) {
            const press = { key: edge.key, code: codeOf(edge.key), repeat: false };
            if (edge.down) os.keyDown(press);
            else os.keyUp(press);
          }
          heldByHand.set(source.handedness, now);
        }
      }

      currentRays = rays;
    };
    let currentRays: { origin: number[]; end: number[] }[] = [];
    const draw = (time: number, frame: XrFrame) => {
      const run = pendingFrame;
      pendingFrame = null;
      try {
        run?.(time); // Vector OS steps and draws its desktop
      } catch (error) {
        console.error(error);
      }
      const rays = currentRays;
      const pose = frame.getViewerPose(floor);
      const layer = session.renderState.baseLayer;
      if (!pose || !layer) return;
      if (os.isFullScreen && !wasFullScreen) recentreWanted = true;
      wasFullScreen = os.isFullScreen;
      if (recentreWanted || !anchor) {
        anchor = anchorAt(pose.transform.matrix);
        recentreWanted = false;
      }
      const showingStyle = styleShown && performance.now() < styleShown.until;
      if (showingStyle) showStatus(["3D STYLE", styleShown!.name.toUpperCase(), "RIGHT GRIP or RIGHT STICK LEFT/RIGHT: next style"]);
      else if (frames % 10 === 1 && showing3d) {
        showStatus([
          "IN 3D: RIGHT GRIP or RIGHT STICK LEFT/RIGHT: next 3D style",
          "RIGHT STICK PRESS: exit full screen   LEFT STICK PRESS: recentre",
          "LEFT: stick turn/thrust, trigger fire, grip shields/zap, X coin, Y start",
          styleDiagnosis || "right controller: not seen",
        ]);
      } else if (frames % 10 === 1) {
        showStatus(
          profileFor(os.focusedProgramId).treads
            ? ["BATTLEZONE", "LEFT STICK: left tread    RIGHT STICK: right tread", "LEFT TRIGGER: fire    X: coin    Y: start", "RIGHT: trigger click, GRIP 3D style, STICK PRESS exit full screen", "LEFT STICK PRESS: recentre the view"]
            : ["CONTROLS", "LEFT STICK: turn / thrust    TRIGGER: fire    GRIP: shields / zap", "X: coin    Y: start    RIGHT B: two players", "RIGHT: trigger click, GRIP 3D style, STICK PRESS exit full screen", "LEFT STICK PRESS: recentre the view"],
        );
      }
      // The head's forward ray: the panel fades in as the gaze goes below the screen.
      const head = roomRay(pose.transform.matrix);
      room.panelOpacity = showingStyle ? 1 : panelOpacity(head.origin, head.direction, panelPlace);
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
      room.takePicture(desktop);
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
      room.clear();
      for (const eye of pose.views) {
        const viewport = layer.getViewport(eye);
        gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
        room.draw(eye.projectionMatrix, multiply(eye.transform.inverse.matrix, anchor.toWorld), rays, viewport);
      }
    };
    session.requestAnimationFrame(onFrame);
    session.addEventListener("end", () => {
      inHeadset = false;
      os.releaseKeys();
      host.setFrameScheduler(null);
      requestAnimationFrame(drawPreview);
    });
  });

  (window as unknown as { vectorOsVr: unknown }).vectorOsVr = { os, host };
}
