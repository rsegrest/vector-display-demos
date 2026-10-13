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

  describe("with more items than fit in one column", () => {
    const count = 12;
    const widths = new Array<number>(count).fill(300);
    widths[3] = 420;
    const menu = new MenuModel(count);
    const layout = menu.layout({ width: 1778, height: 1000, itemWidths: widths });

    it("splits into equal columns that stay clear of the title and the footer", () => {
      expect(layout.columnCount).toBe(2);
      expect(layout.rowsPerColumn).toBe(6);
      expect(new Set(layout.rows.map((row) => row.left)).size).toBe(2);
      for (const row of layout.rows) {
        expect(row.top).toBeGreaterThanOrEqual(240);
        expect(row.top + row.height).toBeLessThanOrEqual(1000 - 180);
        expect(row.left).toBeGreaterThan(0);
        expect(row.left + row.width).toBeLessThan(1778);
      }
      // Reading order runs down the first column, then down the second.
      expect(layout.rows[5].top).toBeGreaterThan(layout.rows[4].top);
      expect(layout.rows[6].top).toBe(layout.rows[0].top);
      expect(layout.rows[6].left).toBeGreaterThan(layout.rows[0].left + 420);
    });

    it("keeps a short list in a single column, and fits sixteen in two", () => {
      const short = new MenuModel(8).layout({ width: 1778, height: 1000, itemWidths: new Array<number>(8).fill(300) });
      expect(short.columnCount).toBe(1);
      const long = new MenuModel(16).layout({ width: 1778, height: 1000, itemWidths: new Array<number>(16).fill(300) });
      expect(long.columnCount).toBe(2);
      expect(long.rowsPerColumn).toBe(8);
    });

    it("gives every row its own hit area, with none overlapping", () => {
      layout.rows.forEach((row, index) => {
        expect(menu.rowAt(layout, row.left + 5, row.top + 5)).toBe(index);
        expect(menu.rowAt(layout, row.left + row.width - 5, row.top + row.height - 5)).toBe(index);
        // Where the pointer sits, just left of the text.
        expect(menu.rowAt(layout, row.left - 40, row.top + 5)).toBe(index);
      });
    });

    it("steps sideways between columns and stays put at the edges", () => {
      const model = new MenuModel(count, 2);
      model.moveColumn(1, layout);
      expect(model.selectedIndex).toBe(8);
      model.moveColumn(1, layout);
      expect(model.selectedIndex).toBe(8);
      model.moveColumn(-1, layout);
      expect(model.selectedIndex).toBe(2);
      model.moveColumn(-1, layout);
      expect(model.selectedIndex).toBe(2);
    });

    it("slides the pointer across to the other column", () => {
      const model = new MenuModel(count, 0);
      model.update(1, layout);
      expect(model.pointerX).toBe(layout.rows[0].left);
      model.moveColumn(1, layout);
      for (let step = 0; step < 90; step++) model.update(1 / 60, layout);
      expect(model.pointerX).toBeCloseTo(layout.rows[6].left, 1);
    });
  });
});
