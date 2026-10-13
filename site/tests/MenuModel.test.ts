import { describe, expect, it } from "vitest";
import { MenuModel } from "../src/menu/MenuModel.js";

const ITEMS = ["PARTICLE LIFE", "LENIA", "SLIME MOLD"];

describe("MenuModel", () => {
  it("moves the selection with wrap-around", () => {
    const menu = new MenuModel(ITEMS.length);
    expect(menu.selectedIndex).toBe(0);
    menu.move(-1);
    expect(menu.selectedIndex).toBe(2);
    menu.move(1);
    expect(menu.selectedIndex).toBe(0);
    menu.move(1);
    expect(menu.selectedIndex).toBe(1);
  });

  it("starts from a remembered index when it is valid", () => {
    expect(new MenuModel(3, 2).selectedIndex).toBe(2);
    expect(new MenuModel(3, 7).selectedIndex).toBe(0);
  });

  it("lays rows out centered vertically and finds the row under a point", () => {
    const menu = new MenuModel(ITEMS.length);
    const layout = menu.layout({ width: 1600, height: 1000, itemWidths: [400, 150, 300] });
    expect(layout.rows).toHaveLength(3);
    const middle = layout.rows[1];
    expect(middle.top + middle.height / 2).toBeCloseTo(layout.rows[0].top + layout.rows[0].height / 2 + layout.rowSpacing);
    // Rows share a left edge so the list reads as a column.
    expect(new Set(layout.rows.map((row) => row.left)).size).toBe(1);
    expect(menu.rowAt(layout, middle.left + 10, middle.top + 2)).toBe(1);
    expect(menu.rowAt(layout, middle.left - 200, middle.top + 2)).toBe(1);
    expect(menu.rowAt(layout, 10, 5)).toBe(-1);
  });

  it("eases the pointer toward the selected row", () => {
    const menu = new MenuModel(ITEMS.length);
    const layout = menu.layout({ width: 1600, height: 1000, itemWidths: [400, 150, 300] });
    menu.update(1, layout);
    const start = menu.pointerY;
    menu.move(2);
    menu.update(0.05, layout);
    const target = layout.rows[2].top + layout.rows[2].height / 2;
    expect(menu.pointerY).toBeGreaterThan(start);
    expect(menu.pointerY).toBeLessThan(target);
    for (let step = 0; step < 60; step++) menu.update(1 / 60, layout);
    expect(menu.pointerY).toBeCloseTo(target, 1);
  });
});
