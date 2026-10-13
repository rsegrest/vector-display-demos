import { DisplayList } from "@vector-display/core";
import { WebGLVectorRenderer, type LineStyle } from "@vector-display/webgl";
import { PhosphorPipeline, type PhosphorSettings } from "@vector-display/beam-fx";

export interface DemoFrame {
  // World size this frame. Height is fixed by the host options; width follows the canvas aspect ratio.
  readonly width: number;
  readonly height: number;
  readonly seconds: number;
}

export interface Demo {
  // Called at a fixed rate, possibly several times per animation frame.
  update(deltaSeconds: number): void;
  draw(displayList: DisplayList, frame: DemoFrame): void;
  // Optional crisp layer for text and UI, drawn straight onto the canvas after the phosphor pass,
  // so it gets no trails or bloom and does not smear when it changes.
  drawOverlay?(displayList: DisplayList, frame: DemoFrame): void;
  resize?(width: number, height: number): void;
}

export interface DemoHostOptions {
  readonly worldHeight: number;
  readonly fixedStepSeconds?: number;
  readonly maxStepsPerFrame?: number;
  // Sizes in CSS pixels; the host scales them by the device pixel ratio.
  readonly lineStyle?: Partial<LineStyle>;
  // Style for the drawOverlay layer, so HUD text stays legible whatever look the demo itself uses.
  readonly overlayLineStyle?: Partial<LineStyle>;
  readonly phosphor?: Partial<PhosphorSettings>;
}

const DEFAULT_LINE_STYLE_CSS: LineStyle = {
  beamWidth: 1.3,
  glowRadius: 2.6,
  glowStrength: 0.14,
  endpointBrightness: 0.15,
  jointOverlap: 0.5,
};

const DEFAULT_OVERLAY_LINE_STYLE_CSS: LineStyle = {
  beamWidth: 1.3,
  glowRadius: 2,
  glowStrength: 0.12,
  endpointBrightness: 0.1,
  jointOverlap: 0.3,
};

// Owns the canvas, renderer and phosphor pipeline, and runs a fixed-step update loop for one demo.
export class DemoHost {
  public readonly renderer: WebGLVectorRenderer;
  public readonly phosphor: PhosphorPipeline;
  public isPaused = false;
  public lastFrameMilliseconds = 0;

  private readonly displayList = new DisplayList();
  private readonly overlayDisplayList = new DisplayList();
  private readonly fixedStepSeconds: number;
  private readonly maxStepsPerFrame: number;
  private readonly lineStyleCss: LineStyle;
  private readonly overlayLineStyleCss: LineStyle;
  private worldWidth: number;
  private pixelRatio = 1;
  private accumulatedSeconds = 0;
  private previousTime = 0;
  private elapsedSeconds = 0;
  private pendingSingleSteps = 0;
  private animationFrameId = 0;
  private readonly onResize = (): void => this.layout();

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly demo: Demo,
    private readonly options: DemoHostOptions,
  ) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error("WebGL2 is not available in this browser");
    this.worldWidth = options.worldHeight;
    this.renderer = new WebGLVectorRenderer(gl, { width: this.worldWidth, height: options.worldHeight });
    this.phosphor = new PhosphorPipeline(this.renderer, options.phosphor);
    this.fixedStepSeconds = options.fixedStepSeconds ?? 1 / 60;
    this.maxStepsPerFrame = options.maxStepsPerFrame ?? 4;
    this.lineStyleCss = { ...DEFAULT_LINE_STYLE_CSS, ...options.lineStyle };
    this.overlayLineStyleCss = { ...DEFAULT_OVERLAY_LINE_STYLE_CSS, ...options.overlayLineStyle };
  }

  public static start(canvas: HTMLCanvasElement, demo: Demo, options: DemoHostOptions): DemoHost {
    const host = new DemoHost(canvas, demo, options);
    host.layout();
    window.addEventListener("resize", host.onResize);
    host.previousTime = performance.now();
    host.animationFrameId = requestAnimationFrame((time) => host.frame(time));
    return host;
  }

  public get worldSize(): { readonly width: number; readonly height: number } {
    return { width: this.worldWidth, height: this.options.worldHeight };
  }

  // Line style sizes are in CSS pixels.
  public setLineStyle(lineStyle: Partial<LineStyle>): void {
    Object.assign(this.lineStyleCss, lineStyle);
    this.applyLineStyle();
  }

  public stepOnce(): void {
    this.pendingSingleSteps++;
  }

  // Converts a pointer position on the canvas to world coordinates.
  public clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - bounds.left) / bounds.width) * this.worldWidth,
      y: ((clientY - bounds.top) / bounds.height) * this.options.worldHeight,
    };
  }

  // Lays the display out again, for when the canvas has changed size without the window doing so.
  public refreshLayout(): void {
    this.layout();
  }

  // Stops drawing and gives everything back, including the canvas's WebGL context:
  // browsers allow only a handful at once, so a page with many displays must
  // release the ones it is not showing. The canvas cannot be drawn to again.
  public stop(): void {
    cancelAnimationFrame(this.animationFrameId);
    window.removeEventListener("resize", this.onResize);
    this.phosphor.dispose();
    this.renderer.dispose();
    this.renderer.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  private layout(): void {
    this.pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const cssWidth = this.canvas.clientWidth || window.innerWidth;
    const cssHeight = this.canvas.clientHeight || window.innerHeight;
    const pixelWidth = Math.max(1, Math.floor(cssWidth * this.pixelRatio));
    const pixelHeight = Math.max(1, Math.floor(cssHeight * this.pixelRatio));
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    const worldHeight = this.options.worldHeight;
    this.worldWidth = worldHeight * (cssWidth / Math.max(1, cssHeight));
    this.renderer.setWorldSize({ width: this.worldWidth, height: worldHeight });
    this.applyLineStyle();
    this.demo.resize?.(this.worldWidth, worldHeight);
  }

  private applyLineStyle(style: LineStyle = this.lineStyleCss): void {
    this.renderer.setLineStyle({
      ...style,
      beamWidth: style.beamWidth * this.pixelRatio,
      glowRadius: style.glowRadius * this.pixelRatio,
    });
  }

  private frame(time: number): void {
    const elapsedMilliseconds = Math.min(250, time - this.previousTime);
    this.previousTime = time;
    const workStart = performance.now();

    if (!this.isPaused) this.accumulatedSeconds += elapsedMilliseconds / 1000;
    let steps = 0;
    while (this.accumulatedSeconds >= this.fixedStepSeconds && steps < this.maxStepsPerFrame) {
      this.demo.update(this.fixedStepSeconds);
      this.accumulatedSeconds -= this.fixedStepSeconds;
      steps++;
    }
    // Drop time we could not catch up on rather than spiralling.
    if (steps === this.maxStepsPerFrame) this.accumulatedSeconds = 0;
    for (; this.pendingSingleSteps > 0; this.pendingSingleSteps--) this.demo.update(this.fixedStepSeconds);
    if (!this.isPaused) this.elapsedSeconds += elapsedMilliseconds / 1000;

    const demoFrame: DemoFrame = { width: this.worldWidth, height: this.options.worldHeight, seconds: this.elapsedSeconds };
    this.displayList.clear();
    this.demo.draw(this.displayList, demoFrame);
    this.phosphor.renderFrame(this.displayList, elapsedMilliseconds);
    if (this.demo.drawOverlay) {
      this.overlayDisplayList.clear();
      this.demo.drawOverlay(this.overlayDisplayList, demoFrame);
      // The phosphor pass leaves the canvas bound, and drawDisplayList adds on top without clearing.
      this.applyLineStyle(this.overlayLineStyleCss);
      this.renderer.drawDisplayList(this.overlayDisplayList);
      this.applyLineStyle();
    }
    this.lastFrameMilliseconds = performance.now() - workStart;
    this.animationFrameId = requestAnimationFrame((nextTime) => this.frame(nextTime));
  }
}
