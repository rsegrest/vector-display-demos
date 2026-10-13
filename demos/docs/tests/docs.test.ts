import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DisplayList } from "@vector-display/core";
import { SnippetProgram, compileSnippet, createSnippetApi, extractSnippets } from "../src/snippetRuntime.js";

const PAGE = readFileSync(fileURLToPath(new URL("../../../site/docs/index.html", import.meta.url)), "utf8");
const WIDTH = 560;
const HEIGHT = 260;
const api = createSnippetApi();

describe("compileSnippet", () => {
  it("makes a function that fills the list it is given", () => {
    const result = compileSnippet("list.setColor({ red: 1, green: 1, blue: 1 }); list.addShape(Shape.createDot(), SCREEN_SPACE_PLACEMENT);", Object.keys(api));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const list = new DisplayList();
    result.run(api, list, 0, WIDTH, HEIGHT, {});
    expect(list.segmentCount).toBe(1);
  });

  it("reports text that does not parse instead of throwing", () => {
    const result = compileSnippet("list.addShape(", Object.keys(api));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("SyntaxError");
  });

  it("runs in strict mode, so a mistyped name is an error and not a new global", () => {
    const result = compileSnippet("misspelled = 5;", Object.keys(api));
    expect(result.ok).toBe(true);
    if (result.ok) expect(() => result.run(api, new DisplayList(), 0, WIDTH, HEIGHT, {})).toThrow(ReferenceError);
  });
});

describe("SnippetProgram", () => {
  const DOT = "list.addShape(Shape.createDot(), SCREEN_SPACE_PLACEMENT);";

  it("gives the code the time and the size of the display", () => {
    const program = new SnippetProgram("list.addShape(Shape.createDot(), { x: width / 2 + t, y: height, rotation: 0, scale: 1, intensity: 1 });", api);
    const list = new DisplayList();
    program.draw(list, 5, 400, 200);
    const data = list.getSegmentData();
    expect(data[0]).toBeCloseTo(205, 5);
    expect(data[1]).toBeCloseTo(200, 5);
  });

  it("keeps running the last good version while the text is half typed", () => {
    const program = new SnippetProgram(DOT, api);
    program.setCode(`${DOT} list.addShape(`);
    expect(program.status.kind).toBe("syntax");
    const list = new DisplayList();
    program.draw(list, 0, WIDTH, HEIGHT);
    expect(list.segmentCount).toBe(1);
    program.setCode(`${DOT} ${DOT}`);
    expect(program.status.kind).toBe("running");
    list.clear();
    program.draw(list, 0, WIDTH, HEIGHT);
    expect(list.segmentCount).toBe(2);
  });

  it("stops code that throws, discards what it drew, and starts again when edited", () => {
    const program = new SnippetProgram(`${DOT} nothing.here();`, api);
    const list = new DisplayList();
    program.draw(list, 0, WIDTH, HEIGHT);
    expect(program.status.kind).toBe("failed");
    expect(list.segmentCount).toBe(0);
    // It is not run again, so the error is not raised sixty times a second.
    program.draw(list, 0, WIDTH, HEIGHT);
    expect(list.segmentCount).toBe(0);
    program.setCode(DOT);
    program.draw(list, 0, WIDTH, HEIGHT);
    expect(program.status.kind).toBe("running");
    expect(list.segmentCount).toBe(1);
  });

  it("hands back the look the code asked for, and forgets it when the code stops asking", () => {
    const program = new SnippetProgram("view.lineStyle = { beamWidth: 3 }; view.phosphor = { exposure: 2 };", api);
    const list = new DisplayList();
    const view = program.draw(list, 0, WIDTH, HEIGHT);
    expect(view.lineStyle).toEqual({ beamWidth: 3 });
    expect(view.phosphor).toEqual({ exposure: 2 });
    program.setCode(DOT);
    const after = program.draw(list, 0, WIDTH, HEIGHT);
    expect(after.lineStyle).toBeUndefined();
    expect(after.phosphor).toBeUndefined();
  });
});

describe("extractSnippets", () => {
  it("finds each example and turns HTML escapes back into code", () => {
    const html = '<figure><pre data-snippet><code>if (a &lt; b &amp;&amp; c &gt; d) { say(&quot;hi&quot;); }</code></pre></figure><pre class="listing"><code>not live</code></pre>';
    expect(extractSnippets(html)).toEqual(['if (a < b && c > d) { say("hi"); }']);
  });
});

describe("the guide's examples", () => {
  const snippets = extractSnippets(PAGE);

  it("are all found", () => {
    expect(snippets.length).toBe(10);
    expect(PAGE.match(/<figure class="snippet"/g)).toHaveLength(snippets.length);
  });

  it.each(snippets.map((code, index) => [index + 1, code.split("\n")[0].slice(0, 60), code] as const))("example %i runs and draws something (%s)", (_number, _firstLine, code) => {
    const program = new SnippetProgram(code, api);
    expect(program.status).toEqual({ kind: "running" });
    const list = new DisplayList();
    // Several moments, since the examples move.
    for (const time of [0, 0.37, 1.9, 12.5, 3600]) {
      list.clear();
      program.draw(list, time, WIDTH, HEIGHT);
      expect(program.status).toEqual({ kind: "running" });
      expect(list.segmentCount).toBeGreaterThan(0);
      const data = list.getSegmentData();
      for (let index = 0; index < list.segmentCount * 4; index++) expect(Number.isFinite(data[index])).toBe(true);
    }
  });

  it("use only names the guide gives them", () => {
    // A name used but not provided would be a ReferenceError when run, which the test above catches;
    // this checks the other direction, that nothing is provided and never shown.
    const all = snippets.join("\n");
    const unused = Object.keys(api).filter((name) => !new RegExp(`\\b${name}\\b`).test(all) && !new RegExp(`\\b${name}\\b`).test(PAGE));
    expect(unused).toEqual([]);
  });
});

describe("the guide's text", () => {
  it("states the libraries' real default settings", async () => {
    const { DEFAULT_LINE_STYLE } = await import("@vector-display/webgl");
    const { DEFAULT_PHOSPHOR_SETTINGS } = await import("@vector-display/beam-fx");
    const defaults: Record<string, number> = { ...DEFAULT_LINE_STYLE, ...DEFAULT_PHOSPHOR_SETTINGS };
    for (const [name, value] of Object.entries(defaults)) {
      const row = new RegExp(`<td><code>${name}</code></td><td>([^<]+)</td>`).exec(PAGE);
      expect(row, `${name} should have a row in a settings table`).not.toBeNull();
      expect(Number(row![1])).toBe(value);
    }
  });

  it("links every section from the contents list", () => {
    const linked = [...PAGE.matchAll(/<li><a href="#([a-z-]+)">/g)].map((match) => match[1]);
    const sections = [...PAGE.matchAll(/<section id="([a-z-]+)">/g)].map((match) => match[1]);
    expect(linked).toEqual(sections);
  });
});
