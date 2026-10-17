import { describe, expect, it } from "vitest";
import { DisplayList } from "@vector-display/core";
import { equationLines, findClosure, formatSize, gearCentreAt, maximumPenSpeed, penPointAt, type SpiralParameters } from "../src/apps/gearSpirals/gearMath.js";
import {
  DEFAULT_PARAMETERS,
  Drawing,
  FIELD_RANGES,
  GearSpiralsModel,
  INK_SEGMENT_CAP,
  INK_STEP_LENGTH,
  PALETTE_HUES,
  PLATE_HALF_SIZE,
} from "../src/apps/gearSpirals/GearSpiralsModel.js";
import { GearSpirals, layoutGearSpirals } from "../src/apps/gearSpirals/GearSpirals.js";

const inside = (baseRadius: number, gearRadius: number, penDistance: number): SpiralParameters => ({ mode: "inside", baseRadius, gearRadius, penDistance });
const outside = (baseRadius: number, gearRadius: number, penDistance: number): SpiralParameters => ({ mode: "outside", baseRadius, gearRadius, penDistance });

// Runs the motor until the current curve stops, or a time limit is reached.
function runUntilStopped(model: GearSpiralsModel, seconds = 600): number {
  let elapsed = 0;
  while (!model.current.isFinished && elapsed < seconds) {
    model.update(1 / 60);
    elapsed += 1 / 60;
  }
  return elapsed;
}

describe("the pen's path", () => {
  it("follows the hypotrochoid's formula inside the ring", () => {
    const parameters = inside(100, 37, 30);
    const point = { x: 0, y: 0 };
    for (const t of [0, 0.3, 1, 2.5, 10]) {
      const k = (100 - 37) / 37;
      penPointAt(parameters, t, point);
      expect(point.x).toBeCloseTo(63 * Math.cos(t) + 30 * Math.cos(k * t), 10);
      expect(point.y).toBeCloseTo(63 * Math.sin(t) - 30 * Math.sin(k * t), 10);
    }
  });

  it("follows the epitrochoid's formula outside the ring", () => {
    const parameters = outside(100, 37, 30);
    const point = { x: 0, y: 0 };
    for (const t of [0, 0.3, 1, 2.5, 10]) {
      const k = (100 + 37) / 37;
      penPointAt(parameters, t, point);
      expect(point.x).toBeCloseTo(137 * Math.cos(t) - 30 * Math.cos(k * t), 10);
      expect(point.y).toBeCloseTo(137 * Math.sin(t) - 30 * Math.sin(k * t), 10);
    }
  });

  it("keeps the pen its distance from the gear's centre, and the gear touching the ring", () => {
    const pen = { x: 0, y: 0 };
    const gear = { x: 0, y: 0 };
    for (const parameters of [inside(96, 36, 20), outside(96, 36, 50)]) {
      for (const t of [0, 0.7, 4]) {
        penPointAt(parameters, t, pen);
        gearCentreAt(parameters, t, gear);
        expect(Math.hypot(pen.x - gear.x, pen.y - gear.y)).toBeCloseTo(parameters.penDistance, 10);
        const fromCentre = Math.hypot(gear.x, gear.y);
        expect(parameters.mode === "inside" ? fromCentre + 36 : fromCentre - 36).toBeCloseTo(96, 10);
      }
    }
  });

  it("never moves faster than its stated top speed", () => {
    const parameters = inside(100, 37, 30);
    const speed = maximumPenSpeed(parameters);
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    const dt = 1e-4;
    for (let t = 0; t < 20; t += 0.01) {
      penPointAt(parameters, t, a);
      penPointAt(parameters, t + dt, b);
      expect(Math.hypot(b.x - a.x, b.y - a.y) / dt).toBeLessThanOrEqual(speed + 1e-6);
    }
  });
});

describe("closing the curve", () => {
  it.each([
    // R / r = 8 / 3: three trips round, eight petals.
    [96, 36, 3, 8],
    [100, 37, 37, 100],
    [100, 50, 1, 2],
    [105, 63, 3, 5],
    [150, 60, 2, 5],
    [100, 37.5, 3, 8],
    [180, 149, 149, 180],
  ])("R = %d, r = %d closes after %d trips with %d petals", (baseRadius, gearRadius, trips, petals) => {
    expect(findClosure(inside(baseRadius, gearRadius, 20))).toEqual({ trips, petals });
    expect(findClosure(outside(baseRadius, gearRadius, 20))).toEqual({ trips, petals });
  });

  it("really is back where it started after that many trips, and not before", () => {
    const parameters = inside(96, 36, 25);
    const start = penPointAt(parameters, 0, { x: 0, y: 0 });
    const point = { x: 0, y: 0 };
    penPointAt(parameters, 3 * 2 * Math.PI, point);
    expect(Math.hypot(point.x - start.x, point.y - start.y)).toBeLessThan(1e-9);
    for (const trips of [1, 2]) {
      penPointAt(parameters, trips * 2 * Math.PI, point);
      expect(Math.hypot(point.x - start.x, point.y - start.y)).toBeGreaterThan(1);
    }
  });

  it("accepts a ratio close enough to a simple one, as a pen on paper would", () => {
    // 36.00001 is 36 to well within a ten-thousandth of a turn over three trips.
    expect(findClosure(inside(96, 36.00001, 20))).toEqual({ trips: 3, petals: 8 });
  });

  it("says a curve does not close when no small number of trips brings it back", () => {
    expect(findClosure(inside(100, 100 / Math.SQRT2, 20))).toBeNull();
    expect(findClosure(inside(100, 37.123, 20))).toBeNull();
    // π is famously close to 355/113, near enough to count as closing after 113 trips.
    expect(findClosure(inside(100, 100 / Math.PI, 20))).toEqual({ trips: 113, petals: 355 });
  });

  it("treats a pen at the gear's centre as a circle, closed after one trip", () => {
    expect(findClosure(inside(100, 37, 0))).toEqual({ trips: 1, petals: 0 });
  });
});

describe("the equation", () => {
  it("is written out with the sizes in place, inside", () => {
    expect(equationLines(inside(100, 37, 30))).toEqual([
      "x(t) = (100 − 37)·cos t + 30·cos(((100 − 37)/37)·t)",
      "y(t) = (100 − 37)·sin t − 30·sin(((100 − 37)/37)·t)",
    ]);
  });

  it("is written out with the sizes in place, outside", () => {
    expect(equationLines(outside(96, 36.5, 12.25))).toEqual([
      "x(t) = (96 + 36.5)·cos t − 12.25·cos(((96 + 36.5)/36.5)·t)",
      "y(t) = (96 + 36.5)·sin t − 12.25·sin(((96 + 36.5)/36.5)·t)",
    ]);
  });

  it("shows sizes as whole numbers or to two places", () => {
    expect(formatSize(37)).toBe("37");
    expect(formatSize(37.5)).toBe("37.5");
    expect(formatSize(37.256)).toBe("37.26");
  });
});

describe("a drawing", () => {
  it("draws its curve in short lines and stops when it closes", () => {
    const drawing = new Drawing();
    drawing.reset(inside(96, 36, 25), 0, 0, 38);
    drawing.advanceTo(1000, INK_SEGMENT_CAP);
    expect(drawing.stopReason).toBe("closed");
    expect(drawing.trips).toBeCloseTo(3, 9);
    const data = drawing.ink.segmentCoordinates;
    for (let segment = 0; segment < drawing.ink.segmentCount; segment++) {
      const offset = segment * 4;
      expect(Math.hypot(data[offset + 2] - data[offset], data[offset + 3] - data[offset + 1])).toBeLessThanOrEqual(INK_STEP_LENGTH + 1e-6);
    }
    // The last line ends where the first began.
    const last = (drawing.ink.segmentCount - 1) * 4;
    expect(Math.hypot(data[last + 2] - data[0], data[last + 3] - data[1])).toBeLessThan(1e-3);
  });

  it("is cut at the plate's edge", () => {
    const drawing = new Drawing();
    drawing.reset(outside(170, 100, 150), 0, 0, 38);
    drawing.advanceTo(2 * Math.PI, INK_SEGMENT_CAP);
    const data = drawing.ink.segmentCoordinates;
    expect(drawing.ink.segmentCount).toBeGreaterThan(10);
    for (let index = 0; index < drawing.ink.segmentCount * 4; index++) expect(Math.abs(data[index])).toBeLessThanOrEqual(PLATE_HALF_SIZE + 1e-3);
  });

  it("stops for want of ink when given no more room", () => {
    const drawing = new Drawing();
    drawing.reset(inside(100, 37, 30), 0, 0, 38);
    expect(drawing.advanceTo(1000, 50)).toBe(50);
    expect(drawing.stopReason).toBe("ink");
  });
});

describe("the toy", () => {
  it("opens drawing something straight away, and stops once the curve has closed", () => {
    const model = new GearSpiralsModel();
    expect(model.parameters).toEqual(DEFAULT_PARAMETERS);
    expect(model.isRunning).toBe(true);
    model.update(0.5);
    expect(model.current.ink.segmentCount).toBeGreaterThan(50);
    runUntilStopped(model);
    expect(model.current.stopReason).toBe("closed");
    expect(model.isRunning).toBe(false);
    expect(model.closureText).toBe("37 TRIPS, 100 PETALS");
    expect(model.status).toBe("FINISHED: THE CURVE HAS CLOSED");
  });

  it("holds every typed value to its range", () => {
    const model = new GearSpiralsModel();
    model.beginEntry("baseRadius");
    for (const key of "9999") model.key(key);
    model.key("Enter");
    expect(model.parameters.baseRadius).toBe(FIELD_RANGES.baseRadius.maximum);
    model.beginEntry("speed");
    for (const key of "0.01") model.key(key);
    model.key("Enter");
    expect(model.speed).toBe(FIELD_RANGES.speed.minimum);
    // Inside the ring the gear must stay smaller than it.
    model.beginEntry("gearRadius");
    for (const key of "500") model.key(key);
    model.key("Enter");
    expect(model.parameters.gearRadius).toBe(FIELD_RANGES.gearRadius.maximum);
    model.setValue("baseRadius", 60);
    expect(model.parameters.gearRadius).toBeLessThan(60);
  });

  it("takes digits and one decimal point, and Tab moves to the next value", () => {
    const model = new GearSpiralsModel();
    model.beginEntry("penDistance");
    for (const key of "12.5.7x") model.key(key);
    expect(model.entry?.text).toBe("12.57");
    model.key("Backspace");
    model.key("Tab");
    expect(model.parameters.penDistance).toBe(12.5);
    expect(model.entry?.field).toBe("speed");
    model.key("Enter");
    // Nothing typed leaves the value alone.
    expect(model.speed).toBe(1.5);
    expect(model.entry).toBeNull();
  });

  it("starts the curve again when a size changes, and recolours it when the colour does", () => {
    const model = new GearSpiralsModel();
    model.update(1);
    const before = model.current.ink.segmentCount;
    model.pickColour(2);
    expect(model.current.hue).toBe(PALETTE_HUES[2]);
    expect(model.current.ink.segmentCount).toBe(before);
    model.setFromSlider("gearRadius", 0.1);
    expect(model.current.ink.segmentCount).toBe(0);
    expect(model.current.parameters.gearRadius).toBe(Math.round(5 + 0.1 * 145));
    expect(model.isRunning).toBe(true);
  });

  it("keeps finished curves with overlay, and wipes them with clear", () => {
    const model = new GearSpiralsModel();
    runUntilStopped(model);
    const firstHue = model.hue;
    model.overlay();
    expect(model.kept).toHaveLength(1);
    expect(model.hue).not.toBe(firstHue);
    // The new curve waits for new settings, and starts by itself when one is changed.
    expect(model.isRunning).toBe(false);
    model.setMode("outside");
    expect(model.isRunning).toBe(true);
    model.update(1);
    expect(model.current.ink.segmentCount).toBeGreaterThan(0);
    expect(model.kept[0].hue).toBe(firstHue);
    expect(model.kept[0].parameters.mode).toBe("inside");
    model.clear();
    expect(model.kept).toHaveLength(0);
    expect(model.current.ink.segmentCount).toBeLessThan(5);
  });

  it("does not overlay an empty plate", () => {
    const model = new GearSpiralsModel();
    model.overlay();
    expect(model.kept).toHaveLength(0);
    model.update(1);
    model.overlay();
    model.overlay();
    expect(model.kept).toHaveLength(1);
  });

  it("drops the oldest kept curve when the ink runs out", () => {
    const model = new GearSpiralsModel();
    model.setValue("speed", 10);
    for (let curve = 0; curve < 8; curve++) {
      runUntilStopped(model);
      model.overlay();
      model.setValue("penDistance", 10 + curve * 5);
    }
    expect(model.inkSegmentCount).toBeLessThanOrEqual(INK_SEGMENT_CAP);
    expect(model.kept.length).toBeLessThan(8);
  });

  it("is defined with the mouse: the base, then the gear, then the pen", () => {
    const model = new GearSpiralsModel();
    model.toggleDefine();
    expect(model.defineStep).toBe("base");
    expect(model.isRunning).toBe(false);
    // Press at the centre and drag out to the ring.
    model.platePointer("down", 10, -20);
    model.platePointer("move", 60, -20);
    model.platePointer("up", 130, -20);
    expect([model.centreX, model.centreY]).toEqual([10, -20]);
    expect(model.parameters.baseRadius).toBe(120);
    expect(model.defineStep).toBe("gear");
    // Dragging inside the ring sizes a gear that rolls inside: here its far side is 40 in from the ring.
    model.platePointer("down", 90, -20);
    model.platePointer("up", 90, -20);
    expect(model.parameters.mode).toBe("inside");
    expect(model.parameters.gearRadius).toBe(20);
    expect(model.defineStep).toBe("pen");
    // The gear sits at the ring's right, centred 100 from the base's centre; a click 12 from its centre sets the pen.
    model.platePointer("down", 10 + 100 + 12, -20);
    expect(model.parameters.penDistance).toBe(12);
    expect(model.defineStep).toBe("none");
    expect(model.isRunning).toBe(true);
  });

  it("rolls the gear outside when it is sized outside the ring, and ignores clicks off the gear", () => {
    const model = new GearSpiralsModel();
    model.toggleDefine();
    model.platePointer("down", 0, 0);
    model.platePointer("up", 80, 0);
    // Straight up from the centre, 60 beyond the ring.
    model.platePointer("down", 0, -140);
    model.platePointer("up", 0, -140);
    expect(model.parameters).toMatchObject({ mode: "outside", baseRadius: 80, gearRadius: 30 });
    expect(model.current.startT).toBeCloseTo(Math.PI / 2, 9);
    model.platePointer("down", 150, 150);
    expect(model.defineStep).toBe("pen");
    // The gear's centre is at (0, −110).
    model.platePointer("down", 0, -110 + 25);
    expect(model.parameters.penDistance).toBe(25);
  });

  it("moves only the base's centre when it is clicked rather than dragged", () => {
    const model = new GearSpiralsModel();
    model.toggleDefine();
    model.platePointer("down", 30, 30);
    model.platePointer("up", 31, 30);
    expect(model.parameters.baseRadius).toBe(100);
    expect(model.centreX).toBe(30);
  });

  it("is cranked by hand by dragging the gear around the base", () => {
    const model = new GearSpiralsModel();
    // The gear starts at the right of the ring, its centre 63 out.
    model.platePointer("down", 63, 0);
    expect(model.isCranking).toBe(true);
    expect(model.isRunning).toBe(false);
    // A quarter turn anticlockwise on screen, a little at a time.
    for (let step = 1; step <= 10; step++) {
      const angle = (step / 10) * (Math.PI / 2);
      model.platePointer("move", 63 * Math.cos(angle), -63 * Math.sin(angle));
    }
    expect(model.current.t).toBeCloseTo(Math.PI / 2, 6);
    const inked = model.current.ink.segmentCount;
    expect(inked).toBeGreaterThan(5);
    // Back again moves the gear but draws nothing more.
    model.platePointer("move", 63, 0);
    expect(model.current.t).toBeCloseTo(0, 6);
    expect(model.current.ink.segmentCount).toBe(inked);
    model.platePointer("up", 63, 0);
    expect(model.isCranking).toBe(false);
    model.update(1);
    expect(model.current.t).toBeCloseTo(0, 6);
  });

  it("does not take hold of the plate away from the gear", () => {
    const model = new GearSpiralsModel();
    model.platePointer("down", -150, -150);
    expect(model.isCranking).toBe(false);
    expect(model.isRunning).toBe(true);
  });

  it("answers its shortcut keys", () => {
    const model = new GearSpiralsModel();
    model.key(" ");
    expect(model.isRunning).toBe(false);
    model.key("m");
    expect(model.parameters.mode).toBe("outside");
    model.key("d");
    expect(model.defineStep).toBe("base");
  });
});

describe("the window", () => {
  it("fits the plate, the equation and every control inside its default size", () => {
    const width = 980;
    const height = 680 - 36;
    const layout = layoutGearSpirals(width, height);
    const rects = [layout.plate, ...layout.buttons.map((button) => button.rect), ...layout.swatches, ...layout.sliders.map((slider) => slider.valueBox)];
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(height);
    }
    // The controls are beside the plate, not over it.
    for (const { rect } of layout.buttons) expect(rect.x).toBeGreaterThan(layout.plate.x + layout.plate.width);
    // Room for the readouts' four lines below the buttons, and for the equation below the plate.
    expect(layout.readoutY + 4 * 18).toBeLessThanOrEqual(height);
    expect(layout.equationY + 19 + 12).toBeLessThanOrEqual(height);
  });

  it("presses its buttons and drags its sliders", () => {
    const spirals = new GearSpirals();
    spirals.resize(980, 644);
    const layout = layoutGearSpirals(980, 644);
    const button = (id: string) => layout.buttons.find((candidate) => candidate.id === id)!.rect;
    const outsideButton = button("outside");
    spirals.pointer("down", outsideButton.x + 5, outsideButton.y + 5);
    expect(spirals.model.parameters.mode).toBe("outside");
    const slider = layout.sliders.find((candidate) => candidate.field === "penDistance")!;
    spirals.pointer("down", slider.trackLeft, slider.trackY);
    spirals.pointer("move", slider.trackRight, slider.trackY);
    spirals.pointer("up", slider.trackRight, slider.trackY);
    expect(spirals.model.parameters.penDistance).toBe(FIELD_RANGES.penDistance.maximum);
    spirals.pointer("down", slider.valueBox.x + 5, slider.valueBox.y + 5);
    expect(spirals.model.entry?.field).toBe("penDistance");
    spirals.key("4");
    // Pressing elsewhere finishes the typing.
    spirals.pointer("down", 2, 2);
    expect(spirals.model.parameters.penDistance).toBe(4);
  });

  it("puts the equation on the plain text layer only, and the controls on the beam", () => {
    const spirals = new GearSpirals();
    const beam = new DisplayList();
    spirals.draw(beam, { width: 900, height: 564, seconds: 0 });
    const text = new DisplayList();
    spirals.drawText(text);
    expect(text.segmentCount).toBeGreaterThan(100);
    // The beam layer would be far busier if the equation's letters were on it too; the controls alone are a few hundred segments.
    spirals.update(1);
    const later = new DisplayList();
    spirals.draw(later, { width: 900, height: 564, seconds: 1 });
    expect(later.segmentCount).toBeGreaterThan(beam.segmentCount);
  });
});
