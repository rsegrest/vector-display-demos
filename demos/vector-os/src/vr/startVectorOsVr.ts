// Vector OS in a virtual cabinet: the whole desktop, games and all, drawn on a
// hidden canvas exactly as its own page draws it, and shown on a big screen in
// a dark room, in a WebXR headset (the Meta Quest's browser) or, without one,
// as a flat preview on the page.  The right controller's ray is the mouse; the
// left controller is the arcade controls (controllerKeys.ts); a keyboard works
// too.  Nothing in Vector OS or the games changes.

import { DemoHost, showFatalError, type FrameScheduler } from "@vector-demos/demo-kit";
import { VECTOR_OS_WORLD_HEIGHT, VectorOsDemo } from "../VectorOsDemo.js";
import { codeOf, heldKeys, keyEdges, profileFor } from "./controllerKeys.js";
import { lookAt, perspective, rayOfPose, rayOnScreen, screenFor } from "./geometry.js";
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
  getViewerPose(space: unknown): { readonly views: readonly XrView[] } | null;
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
  const room = new VrRoom(gl, screen);
  const fitScreen = () => {
    const wanted = os.isFullScreen ? fullScreen : desktopScreen;
    if (wanted === screen) return;
    screen = wanted;
    room.setScreen(screen);
    room.showRoom = !os.isFullScreen;
  };
  // The status panel under the screen in the headset: what the controllers report, and the last error.
  const statusCanvas = document.createElement("canvas");
  statusCanvas.width = 1024;
  statusCanvas.height = 256;
  const statusPen = statusCanvas.getContext("2d")!;
  let lastError = "";
  const showStatus = (lines: string[]) => {
    statusPen.fillStyle = "#020608";
    statusPen.fillRect(0, 0, statusCanvas.width, statusCanvas.height);
    statusPen.fillStyle = "#8ff";
    statusPen.font = "26px monospace";
    lines.forEach((line, i) => statusPen.fillText(line.slice(0, 70), 16, 36 + i * 36));
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
    room.draw(perspective(fovY, width / Math.max(1, height), 0.05, 50), lookAt(PREVIEW_EYE, [PREVIEW_EYE[0], PREVIEW_EYE[1], PREVIEW_EYE[2] - 1]));
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
      const { origin, direction } = rayOfPose(pose.transform.matrix);
      return rayOnScreen(origin, direction, screen);
    };
    // The left controller's trigger is the fire button, not a click (it has a gamepad: controllerKeys.ts).
    const clicks = (source: XrInputSource) => !(source.handedness === "left" && source.gamepad && pointingHand === "right");
    session.addEventListener("selectstart", (event) => {
      const source = (event as unknown as { inputSource: XrInputSource }).inputSource;
      if (!clicks(source)) return;
      pointingHand = source.handedness;
      const hit = hitOf(source, (event as unknown as { frame?: XrFrame }).frame ?? lastFrame);
      if (hit) {
        const point = toDesktop(hit);
        os.pointer("down", point.x, point.y, false);
      }
    });
    session.addEventListener("selectend", (event) => {
      const source = (event as unknown as { inputSource: XrInputSource }).inputSource;
      if (!clicks(source) || source.handedness !== pointingHand) return;
      const hit = hitOf(source, (event as unknown as { frame?: XrFrame }).frame ?? lastFrame);
      const point = hit ? toDesktop(hit) : { x: 0, y: 0 };
      os.pointer(hit ? "up" : "leave", point.x, point.y, false);
    });
    let frames = 0;
    let rightStickWasPressed = false;
    const onFrame = (time: number, frame: XrFrame) => {
      session.requestAnimationFrame(onFrame);
      fitScreen();
      lastFrame = frame;
      frames += 1;
      const status: string[] = [];
      try {
        handleInputs(frame, status);
      } catch (error) {
        lastError = String(error);
        console.error(error);
      }
      draw(time, frame, status);
    };
    const handleInputs = (frame: XrFrame, status: string[]) => {
      const rays: { origin: number[]; end: number[] }[] = [];
      for (const source of session.inputSources) {
        const pose = frame.getPose(source.targetRaySpace, floor);
        const pad = source.gamepad;
        const pressedNow = pad ? pad.buttons.map((b, i) => (b.pressed ? i : -1)).filter((i) => i >= 0).join(",") : "no pad";
        status.push(`${source.handedness} ${source.targetRayMode ?? ""}: pose ${pose ? "yes" : "NO"}, pressed [${pressedNow}]`);
        if (pose) {
          const { origin, direction } = rayOfPose(pose.transform.matrix);
          // The ray stops at the screen when it meets it, so its end is the cursor.
          const t = direction[2] < -1e-6 ? (screen.centre[2] - origin[2]) / direction[2] : 6;
          const reach = rayOnScreen(origin, direction, screen) ? t : 6;
          rays.push({ origin, end: [origin[0] + direction[0] * reach, origin[1] + direction[1] * reach, origin[2] + direction[2] * reach] });
          if (source.handedness === pointingHand) {
            const hit = rayOnScreen(origin, direction, screen);
            if (hit) {
              const point = toDesktop(hit);
              os.pointer("move", point.x, point.y, false);
            }
          }
        }
        if (pad && source.handedness === "right") {
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
    const draw = (time: number, frame: XrFrame, status: string[]) => {
      const run = pendingFrame;
      pendingFrame = null;
      try {
        run?.(time); // Vector OS steps and draws its desktop
      } catch (error) {
        lastError = String(error);
        console.error(error);
      }
      const rays = currentRays;
      const pose = frame.getViewerPose(floor);
      const layer = session.renderState.baseLayer;
      if (!pose || !layer) return;
      if (frames % 10 === 1) {
        const keys = [...heldByHand.values()].flatMap((held) => [...held]).map((key) => (key === " " ? "Space" : key));
        showStatus([
          `RIGHT: ray + trigger click, A start, B 2 players, stick press: exit full screen`,
          profileFor(os.focusedProgramId).treads
            ? `BATTLEZONE: left stick left tread, right stick right tread, left trigger fire, X coin, Y start`
            : `LEFT: X coin, Y start, trigger fire, grip shields/zap, stick turn/thrust`,
          ...status,
          `keys held: ${keys.join(" ") || "none"}   ${lastError ? `error: ${lastError}` : ""}`,
        ]);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
      room.takePicture(desktop);
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
      room.clear();
      for (const eye of pose.views) {
        const viewport = layer.getViewport(eye);
        gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
        room.draw(eye.projectionMatrix, eye.transform.inverse.matrix, rays);
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
