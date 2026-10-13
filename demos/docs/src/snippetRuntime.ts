// Runs the guide's examples. Each example is a few lines of JavaScript that fill
// a display list for one frame. The reader can edit them, so the code is compiled
// in the page as it is typed, and anything it does wrong is caught and reported
// rather than allowed to break the guide.
//
// The code only ever comes from the page itself or from what the reader types. It
// is never read from the address bar or from storage, so a link cannot carry code
// into someone else's browser.

import { NO_NEIGHBOR_SEGMENT, SCREEN_SPACE_PLACEMENT, Shape, type DisplayList } from "@vector-display/core";
import { DEFAULT_PERSPECTIVE_CAMERA, WireframeModel, WireframeProjector, createBoxModel, createModelPlacement, createPyramidModel } from "@vector-display/3d";
import { DEFAULT_PHOSPHOR_SETTINGS, type PhosphorSettings } from "@vector-display/beam-fx";
import { ARCADE_FONT_METRICS, ARCADE_GLYPHS, VectorFont } from "@vector-display/font";
import { DEFAULT_LINE_STYLE, type LineStyle } from "@vector-display/webgl";
import { Angle, Vector } from "es-vector-math";

// Everything an example can use by name: the packages' own exports, under their
// own names, so that what works here works when imported in a real program.
export function createSnippetApi(): Record<string, unknown> {
  return {
    // @vector-display/core
    Shape,
    SCREEN_SPACE_PLACEMENT,
    NO_NEIGHBOR_SEGMENT,
    // @vector-display/font, plus one font made ready: building it every frame would be wasteful.
    VectorFont,
    ARCADE_GLYPHS,
    ARCADE_FONT_METRICS,
    font: VectorFont.createArcadeFont(),
    // @vector-display/3d and the maths library it is built on
    WireframeModel,
    WireframeProjector,
    createBoxModel,
    createPyramidModel,
    createModelPlacement,
    DEFAULT_PERSPECTIVE_CAMERA,
    Vector,
    Angle,
    // Defaults from @vector-display/webgl and @vector-display/beam-fx
    DEFAULT_LINE_STYLE,
    DEFAULT_PHOSPHOR_SETTINGS,
  };
}

// What an example may set to change how its own display looks.
export interface SnippetView {
  lineStyle?: Partial<LineStyle>;
  phosphor?: Partial<PhosphorSettings>;
}

export type SnippetFunction = (api: Record<string, unknown>, list: DisplayList, t: number, width: number, height: number, view: SnippetView) => void;

export type CompileResult = { readonly ok: true; readonly run: SnippetFunction } | { readonly ok: false; readonly message: string };

// Turns an example's text into a function. Inside it, `list` is the display list
// to fill, `t` the time in seconds, `width` and `height` the size of the display,
// and `view` a place to put line-style and phosphor settings.
export function compileSnippet(code: string, apiNames: readonly string[]): CompileResult {
  try {
    const run = new Function("api", "list", "t", "width", "height", "view", `"use strict";\nconst { ${apiNames.join(", ")} } = api;\n${code}\n`) as SnippetFunction;
    return { ok: true, run };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

export type SnippetStatus =
  | { readonly kind: "running" }
  // The text does not parse; the last version that did keeps running.
  | { readonly kind: "syntax"; readonly message: string }
  // The code threw while drawing; it is not run again until it is edited.
  | { readonly kind: "failed"; readonly message: string };

// One example: its current code, and how it is getting on.
export class SnippetProgram {
  public status: SnippetStatus = { kind: "running" };

  private readonly api: Record<string, unknown>;
  private readonly apiNames: string[];
  private run: SnippetFunction | null = null;
  private readonly view: SnippetView = {};

  public constructor(code: string, api: Record<string, unknown> = createSnippetApi()) {
    this.api = api;
    this.apiNames = Object.keys(api);
    this.setCode(code);
  }

  public setCode(code: string): void {
    const result = compileSnippet(code, this.apiNames);
    if (result.ok) {
      this.run = result.run;
      this.status = { kind: "running" };
    } else {
      this.status = { kind: "syntax", message: result.message };
    }
  }

  // Fills `list` for one frame and returns the view settings the example asked
  // for. If the example throws, whatever it had added to the list is discarded.
  public draw(list: DisplayList, t: number, width: number, height: number): SnippetView {
    this.view.lineStyle = undefined;
    this.view.phosphor = undefined;
    if (!this.run || this.status.kind === "failed") return this.view;
    try {
      this.run(this.api, list, t, width, height, this.view);
    } catch (error) {
      list.clear();
      this.view.lineStyle = undefined;
      this.view.phosphor = undefined;
      this.status = { kind: "failed", message: describe(error) };
    }
    return this.view;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

// The text of each example in a page of HTML: the contents of every
// <pre data-snippet> element, with the HTML escapes turned back into characters.
export function extractSnippets(html: string): string[] {
  const snippets: string[] = [];
  const pattern = /<pre[^>]*\bdata-snippet\b[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/g;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    snippets.push(match[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"));
  }
  return snippets;
}
