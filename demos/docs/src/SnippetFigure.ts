import type { DisplayList } from "@vector-display/core";
import { DemoHost, type BeamSettings, type BeamSettingsStore, type Demo, type DemoFrame } from "@vector-demos/demo-kit";
import { SnippetProgram, type SnippetView } from "./snippetRuntime.js";

// Each display is this tall, in CSS pixels; world units match CSS pixels, so an
// example can think in the sizes it sees.
export const STAGE_HEIGHT = 260;
// How long after the last keystroke the code is run again.
const EDIT_DELAY_MILLISECONDS = 250;

let nextId = 0;

// One live example: an editor for its code and a display that runs it.
//
// It takes over a <figure> that holds the example as ordinary text, so the page
// reads properly before this code loads, or if it never does. The display is
// created only while the figure is on screen and given up when it scrolls away:
// browsers allow a page only a handful of WebGL displays at once.
export class SnippetFigure {
  public readonly program: SnippetProgram;

  private readonly original: string;
  private readonly stage: HTMLDivElement;
  private readonly editor: HTMLTextAreaElement;
  private readonly status: HTMLParagraphElement;
  private host: DemoHost | null = null;
  private stopListening: (() => void) | null = null;
  private editTimer: number | null = null;
  private applied = "";
  private shownStatus = "";

  public constructor(
    private readonly figure: HTMLElement,
    private readonly settings: BeamSettingsStore,
    api: Record<string, unknown>,
  ) {
    const source = figure.querySelector("pre[data-snippet]");
    this.original = (source?.textContent ?? "").replace(/^\n+|\s+$/g, "");
    this.program = new SnippetProgram(this.original, api);
    const id = `snippet-${nextId++}`;
    const title = figure.dataset.title ?? "Example";

    this.stage = document.createElement("div");
    this.stage.className = "snippet-stage";
    this.stage.style.height = `${STAGE_HEIGHT}px`;

    const label = document.createElement("label");
    label.htmlFor = id;
    label.className = "snippet-label";
    label.textContent = `${title}: edit the code and the display redraws`;

    this.editor = document.createElement("textarea");
    this.editor.id = id;
    this.editor.className = "snippet-editor";
    this.editor.value = this.original;
    this.editor.spellcheck = false;
    this.editor.autocapitalize = "off";
    this.editor.setAttribute("autocomplete", "off");
    this.editor.setAttribute("autocorrect", "off");
    this.editor.rows = Math.max(4, this.original.split("\n").length + 1);
    this.editor.addEventListener("input", () => this.scheduleEdit());

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "snippet-reset";
    reset.textContent = "Reset";
    reset.addEventListener("click", () => {
      this.editor.value = this.original;
      this.program.setCode(this.original);
      this.showStatus();
    });

    this.status = document.createElement("p");
    this.status.className = "snippet-status";
    this.status.setAttribute("role", "status");

    const controls = document.createElement("div");
    controls.className = "snippet-controls";
    controls.append(this.status, reset);

    // The original text is replaced by the editor, which holds the same code.
    source?.remove();
    figure.prepend(this.stage, label, this.editor, controls);
    figure.classList.add("snippet-live");
    this.showStatus();
  }

  public get isActive(): boolean {
    return this.host !== null;
  }

  // Starts the display. Does nothing if it is already running; reports the
  // problem in place if this browser cannot provide WebGL2.
  public activate(): void {
    if (this.host) return;
    // A canvas whose display has been given up cannot be used again, so each start gets a new one.
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", `Vector display for the example: ${this.figure.dataset.title ?? "example"}`);
    canvas.setAttribute("role", "img");
    this.stage.replaceChildren(canvas);
    try {
      this.host = DemoHost.start(canvas, this.createDemo(), { worldHeight: STAGE_HEIGHT, maxStepsPerFrame: 1 });
    } catch {
      this.stage.textContent = "This display needs WebGL2, which this browser did not provide.";
      return;
    }
    this.applied = "";
    this.stopListening = this.settings.subscribe(() => (this.applied = ""));
  }

  public deactivate(): void {
    this.stopListening?.();
    this.stopListening = null;
    this.host?.stop();
    this.host = null;
    this.stage.replaceChildren();
  }

  private createDemo(): Demo {
    return {
      update: () => {},
      draw: (list: DisplayList, frame: DemoFrame) => {
        const view = this.program.draw(list, frame.seconds, frame.width, frame.height);
        this.applyLook(view);
        this.showStatus();
      },
    };
  }

  // The visitor's beam settings, with whatever this example sets for itself on top.
  private applyLook(view: SnippetView): void {
    const host = this.host;
    if (!host) return;
    const beam: BeamSettings = this.settings.current;
    const lineStyle = { beamWidth: beam.beamWidth, glowRadius: beam.glowRadius, glowStrength: beam.glowStrength, endpointBrightness: 0.15, jointOverlap: 0.5, ...view.lineStyle };
    const phosphor = {
      persistenceHalfLifeMilliseconds: beam.persistenceHalfLifeMilliseconds,
      bloomStrength: beam.bloomStrength,
      bloomBlurIterations: 2,
      exposure: beam.exposure,
      flickerAmount: beam.flickerAmount,
      flickerFrequencyHz: 12,
      ...view.phosphor,
    };
    // Settings are sent to the display only when they change.
    const signature = JSON.stringify([lineStyle, phosphor]);
    if (signature === this.applied) return;
    this.applied = signature;
    try {
      host.setLineStyle(lineStyle);
      host.phosphor.setSettings(phosphor);
    } catch {
      // An example can put anything in its settings; nonsense is ignored.
    }
  }

  private scheduleEdit(): void {
    if (this.editTimer !== null) window.clearTimeout(this.editTimer);
    this.editTimer = window.setTimeout(() => {
      this.editTimer = null;
      this.program.setCode(this.editor.value);
      this.showStatus();
    }, EDIT_DELAY_MILLISECONDS);
  }

  private showStatus(): void {
    const { status } = this.program;
    const text =
      status.kind === "running"
        ? "Running"
        : status.kind === "syntax"
          ? `Not valid yet, still showing the last version that was. ${status.message}`
          : `Stopped: the code raised an error. ${status.message}`;
    if (text === this.shownStatus) return;
    this.shownStatus = text;
    this.status.textContent = text;
    this.status.dataset.kind = status.kind;
  }
}
