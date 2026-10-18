// Vector OS in a virtual cabinet: the whole desktop, games and all, drawn on a
// hidden canvas exactly as its own page draws it, and shown on a big screen in
// a dark room, in a WebXR headset (the Meta Quest's browser) or, without one,
// as a flat preview on the page.  The right controller's ray is the mouse; the
// left controller is the arcade controls (controllerKeys.ts); a keyboard works
// too.  Nothing in Vector OS or the games changes.

import { DemoHost, showFatalError, type FrameScheduler } from "@vector-demos/demo-kit";
import { VECTOR_OS_WORLD_HEIGHT, VectorOsDemo } from "../VectorOsDemo.js";
import { codeOf, heldKeys, keyEdges } from "./controllerKeys.js";
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
  // A game's own page cannot open inside the headset; stay in the room.
  os.onNavigate = () => {};

  const gl = view.getContext("webgl2", { antialias: true, xrCompatible: true } as WebGLContextAttributes);
  if (!gl) {
    showFatalError("The virtual cabinet needs WebGL2, which this browser did not provide.");
    return;
  }
  const screen = screenFor(DESKTOP.width / DESKTOP.height, 3.6);
  const room = new VrRoom(gl, screen);
  const toDesktop = (point: { x: number; y: number }) => ({ x: point.x * host.worldSize.width, y: point.y * host.worldSize.height });

  // --- the keyboard, as on Vector OS's page ---------------------------------
  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
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
    let triggerWasDown = false;
    const onFrame = (time: number, frame: XrFrame) => {
      session.requestAnimationFrame(onFrame);
      const run = pendingFrame;
      pendingFrame = null;
      run?.(time); // Vector OS steps and draws its desktop

      const rays: { origin: number[]; end: number[] }[] = [];
      for (const source of session.inputSources) {
        const pose = frame.getPose(source.targetRaySpace, floor);
        const pad = source.gamepad;
        if (source.handedness === "right" && pose) {
          const { origin, direction } = rayOfPose(pose.transform.matrix);
          const hit = rayOnScreen(origin, direction, screen);
          const reach = 6;
          rays.push({ origin, end: [origin[0] + direction[0] * reach, origin[1] + direction[1] * reach, origin[2] + direction[2] * reach] });
          const trigger = pad?.buttons[0]?.pressed === true;
          if (hit) {
            const point = toDesktop(hit);
            if (trigger !== triggerWasDown) os.pointer(trigger ? "down" : "up", point.x, point.y, false);
            else os.pointer("move", point.x, point.y, false);
          } else if (triggerWasDown && !trigger) {
            os.pointer("leave", 0, 0, false);
          }
          triggerWasDown = trigger;
        }
        if (pad) {
          const before = heldByHand.get(source.handedness) ?? new Set<string>();
          const now = heldKeys({ hand: source.handedness, pressed: pad.buttons.map((b) => b.pressed), stick: [pad.axes[2] ?? 0, pad.axes[3] ?? 0] }, before);
          for (const edge of keyEdges(before, now)) {
            const press = { key: edge.key, code: codeOf(edge.key), repeat: false };
            if (edge.down) os.keyDown(press);
            else os.keyUp(press);
          }
          heldByHand.set(source.handedness, now);
        }
      }

      const pose = frame.getViewerPose(floor);
      const layer = session.renderState.baseLayer;
      if (!pose || !layer) return;
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
