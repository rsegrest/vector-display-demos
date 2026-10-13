import { describe, expect, it } from "vitest";
import { DisplayList, FLOATS_PER_BEAM_SEGMENT } from "@vector-display/core";
import { createSeededRandom } from "@vector-demos/demo-kit";
import { DEFAULT_PAGES, TextCrawlDemo } from "../src/TextCrawlDemo.js";
import {
  ASSEMBLE_SECONDS,
  CRAWL_SPEED,
  CrawlScene,
  ENTRY_DISTANCE,
  EXIT_DISTANCE,
  PLANE_ELEVATION,
  SHATTER_SECONDS,
  pageToScene,
  rayToPlane,
} from "../src/sim/CrawlScene.js";
import { LINE_HEIGHT, TITLE_SCALE, layoutPage, parsePages } from "../src/sim/pageLayout.js";

const STEP = 1 / 60;

function createScene(lines: readonly string[] = ["HELLO", "WORLD"], seed = 4): CrawlScene {
  return new CrawlScene([layoutPage(lines), layoutPage(["SECOND PAGE"])], createSeededRandom(seed));
}

function run(scene: CrawlScene, seconds: number): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += STEP) scene.update(STEP, 1);
}

function length(values: Float32Array, stroke: number): number {
  const offset = stroke * 6;
  return Math.hypot(values[offset + 3] - values[offset], values[offset + 4] - values[offset + 1], values[offset + 5] - values[offset + 2]);
}

describe("layoutPage", () => {
  it("turns letters into strokes, centred on the page", () => {
    // L is two strokes.
    const page = layoutPage(["L"]);
    expect(page.segmentCount).toBe(2);
    let left = Infinity;
    let right = -Infinity;
    for (let index = 0; index < page.segments.length; index += 2) {
      left = Math.min(left, page.segments[index]);
      right = Math.max(right, page.segments[index]);
    }
    expect(left).toBeCloseTo(-2, 5);
    expect(right).toBeCloseTo(2, 5);
    expect(page.width).toBeCloseTo(4, 5);
  });

  it("puts each line below the last, capitals six units tall", () => {
    const page = layoutPage(["I", "I"]);
    const ys = Array.from(page.segments).filter((_value, index) => index % 2 === 1);
    expect(Math.max(...ys)).toBeCloseTo(0, 5);
    expect(Math.min(...ys)).toBeCloseTo(-LINE_HEIGHT - 6, 5);
    expect(page.height).toBeCloseTo(2 * LINE_HEIGHT, 5);
  });

  it("makes a title larger and flags its strokes", () => {
    const page = layoutPage(["#L", "L"]);
    expect(Array.from(page.isTitle)).toEqual([1, 1, 0, 0]);
    const titleHeight = Math.abs(page.segments[1] - page.segments[3]) || Math.abs(page.segments[5] - page.segments[7]);
    expect(titleHeight).toBeCloseTo(6 * TITLE_SCALE, 5);
  });

  it("keeps a blank line's space and draws nothing for it", () => {
    expect(layoutPage(["I", "", "I"]).height).toBeCloseTo(3 * LINE_HEIGHT, 5);
    expect(layoutPage([""]).segmentCount).toBe(0);
  });
});

describe("parsePages", () => {
  it("splits lines on | and pages on ||, dropping empty pages", () => {
    expect(parsePages("#TITLE|ONE|TWO||NEXT")).toEqual([["#TITLE", "ONE", "TWO"], ["NEXT"]]);
    expect(parsePages("ONLY")).toEqual([["ONLY"]]);
    expect(parsePages("|| ||")).toEqual([]);
  });
});

describe("the plane", () => {
  it("rises gently into the distance", () => {
    const near = new Float32Array(3);
    const far = new Float32Array(3);
    pageToScene(5, 0, 0, near, 0);
    pageToScene(5, 0, 100, far, 0);
    expect(far[0]).toBe(near[0]);
    expect(far[2] - near[2]).toBeCloseTo(100 * Math.cos(PLANE_ELEVATION), 4);
    expect(far[1] - near[1]).toBeCloseTo(100 * Math.sin(PLANE_ELEVATION), 4);
    expect(near[1]).toBeLessThan(0);
  });

  it("is found again by a ray from the eye through any point on it", () => {
    const point = new Float32Array(3);
    pageToScene(-30, -12, 150, point, 0);
    const hit = rayToPlane(point[0] / point[2], point[1] / point[2]);
    expect(hit).not.toBeNull();
    for (let axis = 0; axis < 3; axis++) expect(hit![axis]).toBeCloseTo(point[axis], 3);
  });

  it("is never met by a ray pointing above its vanishing line", () => {
    expect(rayToPlane(0, Math.tan(PLANE_ELEVATION) + 0.1)).toBeNull();
  });
});

describe("CrawlScene", () => {
  it("gathers scattered strokes into the text, each keeping its length", () => {
    const scene = createScene();
    expect(scene.phase).toBe("ASSEMBLE");
    expect(scene.assembly).toBe(0);
    const scatteredLength = length(scene.current, 0);
    run(scene, ASSEMBLE_SECONDS + 0.1);
    expect(scene.phase).toBe("CRAWL");
    expect(scene.assembly).toBe(1);
    // Once assembled, every stroke lies exactly where the page puts it.
    const { segments, segmentCount } = scene.page;
    const expected = new Float32Array(3);
    for (let stroke = 0; stroke < segmentCount; stroke++) {
      pageToScene(segments[stroke * 4], segments[stroke * 4 + 1], scene.distance, expected, 0);
      for (let axis = 0; axis < 3; axis++) expect(scene.current[stroke * 6 + axis]).toBeCloseTo(expected[axis], 3);
    }
    expect(length(scene.current, 0)).toBeCloseTo(scatteredLength, 3);
  });

  it("starts each page already in view and slides it away at a steady pace", () => {
    const scene = createScene();
    expect(scene.distance).toBeCloseTo(scene.page.height + ENTRY_DISTANCE, 5);
    const before = scene.distance;
    run(scene, 1);
    expect(scene.distance - before).toBeCloseTo(CRAWL_SPEED, 1);
    const paced = createScene();
    for (let elapsed = 0; elapsed < 1; elapsed += STEP) paced.update(STEP, 2);
    expect(paced.distance - before).toBeCloseTo(CRAWL_SPEED * 2, 1);
  });

  it("throws the strokes apart when shattered, without stretching them", () => {
    const scene = createScene();
    run(scene, ASSEMBLE_SECONDS + 0.5);
    const lengths = Array.from({ length: scene.page.segmentCount }, (_unused, stroke) => length(scene.current, stroke));
    const spread = (): number => {
      let total = 0;
      const count = scene.page.segmentCount;
      for (let stroke = 1; stroke < count; stroke++) {
        total += Math.hypot(scene.current[stroke * 6] - scene.current[0], scene.current[stroke * 6 + 1] - scene.current[1], scene.current[stroke * 6 + 2] - scene.current[2]);
      }
      return total / (count - 1);
    };
    const together = spread();
    scene.shatter(null);
    expect(scene.phase).toBe("SHATTER");
    run(scene, 1);
    expect(spread()).toBeGreaterThan(together * 2);
    lengths.forEach((expected, stroke) => expect(length(scene.current, stroke)).toBeCloseTo(expected, 3));
    for (const value of scene.current) expect(Number.isFinite(value)).toBe(true);
  });

  it("throws strokes away from wherever the blast is", () => {
    const scene = createScene(["IIIIIIIIII"]);
    run(scene, ASSEMBLE_SECONDS + 0.5);
    const before = Array.from(scene.current);
    // A blast far to the left pushes everything to the right.
    scene.shatter([-400, before[1], before[2]]);
    run(scene, 0.5);
    let movedRight = 0;
    for (let stroke = 0; stroke < scene.page.segmentCount; stroke++) {
      if (scene.current[stroke * 6] > before[stroke * 6]) movedRight++;
    }
    expect(movedRight / scene.page.segmentCount).toBeGreaterThan(0.85);
  });

  it("brings on the next page after a shatter, and wraps round to the first", () => {
    const scene = createScene();
    scene.shatter(null);
    run(scene, SHATTER_SECONDS + 0.1);
    expect(scene.pageIndex).toBe(1);
    expect(scene.phase).toBe("ASSEMBLE");
    scene.nextPage();
    expect(scene.pageIndex).toBe(0);
  });

  it("shatters by itself once the page has slid away", () => {
    const scene = createScene();
    const seconds = (EXIT_DISTANCE - ENTRY_DISTANCE) / CRAWL_SPEED;
    run(scene, seconds - 1);
    expect(scene.phase).toBe("CRAWL");
    run(scene, 2);
    expect(scene.phase).toBe("SHATTER");
  });

  it("is the same every time for the same seed", () => {
    const first = createScene(["SAME"], 9);
    const second = createScene(["SAME"], 9);
    first.shatter(null);
    second.shatter(null);
    run(first, 1);
    run(second, 1);
    expect(Array.from(first.current)).toEqual(Array.from(second.current));
  });

  it("refuses to start with no pages", () => {
    expect(() => new CrawlScene([], createSeededRandom(1))).toThrow();
  });
});

describe("TextCrawlDemo", () => {
  const FRAME = { width: 1778, height: 1000, seconds: 0 };

  function drawn(demo: TextCrawlDemo): { count: number; data: Float32Array } {
    const displayList = new DisplayList();
    demo.draw(displayList, FRAME);
    return { count: displayList.segmentCount, data: displayList.getSegmentData().slice(0, displayList.segmentCount * FLOATS_PER_BEAM_SEGMENT) };
  }

  it("fits every default line on screen once the page has assembled", () => {
    for (let page = 0; page < DEFAULT_PAGES.length; page++) {
      const demo = new TextCrawlDemo({ seed: 2, pages: [DEFAULT_PAGES[page]] });
      demo.resize(FRAME.width, FRAME.height);
      for (let elapsed = 0; elapsed < ASSEMBLE_SECONDS + 0.2; elapsed += STEP) demo.update(STEP);
      const { count, data } = drawn(demo);
      expect(count).toBe(demo.scene.page.segmentCount);
      for (let segment = 0; segment < count; segment++) {
        const offset = segment * FLOATS_PER_BEAM_SEGMENT;
        for (const x of [data[offset], data[offset + 2]]) {
          expect(x).toBeGreaterThan(0);
          expect(x).toBeLessThan(FRAME.width);
        }
      }
    }
  });

  it("draws text smaller as it slides away", () => {
    const demo = new TextCrawlDemo({ seed: 2, pages: [["IIIIIIII"]] });
    demo.resize(FRAME.width, FRAME.height);
    const extent = (): number => {
      const { count, data } = drawn(demo);
      const xs: number[] = [];
      for (let segment = 0; segment < count; segment++) xs.push(data[segment * FLOATS_PER_BEAM_SEGMENT]);
      return Math.max(...xs) - Math.min(...xs);
    };
    for (let elapsed = 0; elapsed < ASSEMBLE_SECONDS + 0.2; elapsed += STEP) demo.update(STEP);
    const near = extent();
    for (let elapsed = 0; elapsed < 10; elapsed += STEP) demo.update(STEP);
    expect(extent()).toBeLessThan(near * 0.75);
  });

  it("never draws a stroke that is behind the viewer, and keeps the rest finite", () => {
    const demo = new TextCrawlDemo({ seed: 2, pages: [DEFAULT_PAGES[0]] });
    demo.resize(FRAME.width, FRAME.height);
    for (let elapsed = 0; elapsed < ASSEMBLE_SECONDS + 0.2; elapsed += STEP) demo.update(STEP);
    demo.shatterAt(900, 800);
    for (let frame = 0; frame < 150; frame++) {
      demo.update(STEP);
      const { count, data } = drawn(demo);
      expect(count).toBeLessThanOrEqual(demo.scene.page.segmentCount);
      for (let index = 0; index < count * FLOATS_PER_BEAM_SEGMENT; index += FLOATS_PER_BEAM_SEGMENT) {
        for (let coordinate = 0; coordinate < 4; coordinate++) expect(Number.isFinite(data[index + coordinate])).toBe(true);
      }
    }
  });

  it("holds still while paused", () => {
    const demo = new TextCrawlDemo({ seed: 2, pages: [["HOLD"]] });
    demo.togglePause();
    const before = demo.scene.distance;
    for (let frame = 0; frame < 60; frame++) demo.update(STEP);
    expect(demo.scene.distance).toBe(before);
  });
});
