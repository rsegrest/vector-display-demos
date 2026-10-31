export interface MenuLayoutInput {
  readonly width: number;
  readonly height: number;
  // Measured width of each item's title at ITEM_TEXT_SIZE.
  readonly itemWidths: readonly number[];
  // The items in groups, in order, each under a heading; without them, one group with no heading.
  readonly groups?: readonly MenuGroupInput[];
}

export interface MenuGroupInput {
  readonly title: string;
  // How many items, of those in order, belong to it.
  readonly size: number;
  // Measured width of the heading at ITEM_TEXT_SIZE (it is drawn at HEADING_SCALE of that).
  readonly titleWidth: number;
}

// A group's heading, placed above its first item (or above the first in a later column, when a
// group too long for one column is split).
export interface MenuHeading {
  readonly title: string;
  readonly left: number;
  readonly top: number;
  readonly size: number;
}

export interface MenuRow {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface MenuLayout {
  readonly rows: readonly MenuRow[];
  readonly headings: readonly MenuHeading[];
  // The size the titles are drawn at: ITEM_TEXT_SIZE, or smaller when the list would not fit.
  readonly textSize: number;
  readonly rowSpacing: number;
  readonly listLeft: number;
  readonly listTop: number;
  readonly listBottom: number;
  // The list splits into columns when it is too long for the screen.
  readonly columnCount: number;
  readonly rowsPerColumn: number;
  readonly columnWidth: number;
  readonly columnGap: number;
}

export const ITEM_TEXT_SIZE = 30;
// Headings are smaller than the items they head, as in Vector OS's launcher.
export const HEADING_SCALE = 0.6;
const ROW_SPACING = 62;
// How far the clickable area reaches left of the text, to cover the pointer.
const HIT_MARGIN_LEFT = 260;
const HIT_MARGIN_RIGHT = 120;
const POINTER_EASE_PER_SECOND = 14;
// Room kept clear above the list for the title, and below it for the description and key help.
const TOP_RESERVE = 240;
const BOTTOM_RESERVE = 180;
// Space between columns, which the pointer of the right-hand one sits in.
const COLUMN_GAP = 170;
// Room kept at each side of the list, for the pointer at the left and a margin at the right.
const SIDE_MARGIN = 70;
// The list shrinks in steps of this much until it fits, but no smaller than MINIMUM_SCALE.
const SCALE_STEP = 0.05;
const MINIMUM_SCALE = 0.4;

// Selection, layout and hit testing for the index list, independent of drawing.
export class MenuModel {
  public selectedIndex: number;
  public pointerY = Number.NaN;
  public pointerX = Number.NaN;

  public constructor(
    private readonly itemCount: number,
    rememberedIndex = 0,
  ) {
    this.selectedIndex = rememberedIndex >= 0 && rememberedIndex < itemCount ? rememberedIndex : 0;
  }

  public move(delta: number): void {
    this.selectedIndex = (((this.selectedIndex + delta) % this.itemCount) + this.itemCount) % this.itemCount;
  }

  // Steps sideways to the item in the next column whose row is nearest, if there is one.
  public moveColumn(delta: number, layout: MenuLayout): void {
    const current = layout.rows[this.selectedIndex];
    const lefts = [...new Set(layout.rows.map((row) => row.left))].sort((first, second) => first - second);
    const targetLeft = lefts[lefts.indexOf(current.left) + delta];
    if (targetLeft === undefined) return;
    let best = -1;
    layout.rows.forEach((row, index) => {
      if (row.left !== targetLeft) return;
      if (best < 0 || Math.abs(row.top - current.top) < Math.abs(layout.rows[best].top - current.top)) best = index;
    });
    if (best >= 0) this.selectedIndex = best;
  }

  // The list at full size if it fits the screen; on a narrower screen (a laptop's 16:10, a
  // window not maximized), as large as fits: smaller text and spacing, which may also let
  // more rows into a column and so need fewer columns.
  public layout(input: MenuLayoutInput): MenuLayout {
    let scale = 1;
    let layout = this.layoutAt(input, scale);
    while (scale - SCALE_STEP >= MINIMUM_SCALE && layout.columnCount * layout.columnWidth + (layout.columnCount - 1) * layout.columnGap > input.width - 2 * SIDE_MARGIN) {
      scale -= SCALE_STEP;
      layout = this.layoutAt(input, scale);
    }
    return layout;
  }

  private layoutAt(input: MenuLayoutInput, scale: number): MenuLayout {
    const textSize = ITEM_TEXT_SIZE * scale;
    const rowSpacing = ROW_SPACING * scale;
    const columnGap = COLUMN_GAP * scale;
    const headingSize = textSize * HEADING_SCALE;
    // A heading takes most of a row; a group ends with a little space before the next.
    const headingSpacing = rowSpacing * 0.8;
    const groupGap = rowSpacing * 0.35;
    const groups = input.groups ?? [{ title: "", size: input.itemWidths.length, titleWidth: 0 }];
    const itemWidths = input.itemWidths.map((width) => width * scale);
    const availableHeight = input.height - TOP_RESERVE - BOTTOM_RESERVE;

    // Lay groups down a column; a group that does not fit below the last starts a new column, and
    // one too long for any column is split into equal parts, each part a column of its own.
    type Placed = { readonly kind: "heading"; readonly title: string } | { readonly kind: "item"; readonly index: number };
    const columns: { lines: { placed: Placed; offset: number }[]; height: number }[] = [];
    const startColumn = (): void => void columns.push({ lines: [], height: 0 });
    startColumn();
    let index = 0;
    for (const group of groups) {
      const hasHeading = group.title !== "";
      const headingHeight = hasHeading ? headingSpacing : 0;
      const groupHeight = headingHeight + (group.size - 1) * rowSpacing + textSize;
      let column = columns[columns.length - 1];
      const spaceBefore = column.lines.length > 0 ? groupGap + rowSpacing - textSize : 0;
      if (column.lines.length > 0 && column.height + spaceBefore + groupHeight > availableHeight) {
        startColumn();
        column = columns[columns.length - 1];
      }
      const rowsThatFit = Math.max(1, Math.floor((availableHeight - headingHeight - textSize) / rowSpacing) + 1);
      const parts = Math.ceil(group.size / rowsThatFit);
      const perPart = Math.ceil(group.size / parts);
      for (let part = 0; part < parts; part++) {
        if (part > 0) {
          startColumn();
          column = columns[columns.length - 1];
        }
        let offset = column.lines.length > 0 ? column.height + groupGap + rowSpacing - textSize : 0;
        if (hasHeading && part === 0) {
          column.lines.push({ placed: { kind: "heading", title: group.title }, offset });
          offset += headingSpacing;
        }
        const count = Math.min(perPart, group.size - part * perPart);
        for (let line = 0; line < count; line++) {
          column.lines.push({ placed: { kind: "item", index: index++ }, offset });
          offset += rowSpacing;
        }
        column.height = offset - rowSpacing + textSize;
      }
    }

    const headingWidths = new Map(groups.map((group) => [group.title, group.titleWidth * scale * HEADING_SCALE]));
    const widest = Math.max(...itemWidths, ...groups.map((group) => headingWidths.get(group.title) ?? 0));
    const columnCount = columns.length;
    const listLeft = (input.width - (columnCount * widest + (columnCount - 1) * columnGap)) / 2;
    const listHeight = Math.max(...columns.map((column) => column.height));
    // Slightly below center, leaving room for the title, and never down into the footer's room.
    const listTop = Math.min(Math.max(TOP_RESERVE, input.height * 0.56 - listHeight / 2), input.height - BOTTOM_RESERVE - listHeight);
    const rows: MenuRow[] = new Array(itemWidths.length);
    const headings: MenuHeading[] = [];
    columns.forEach((column, columnIndex) => {
      const left = listLeft + columnIndex * (widest + columnGap);
      for (const { placed, offset } of column.lines) {
        if (placed.kind === "heading") headings.push({ title: placed.title, left, top: listTop + offset + (textSize - headingSize), size: headingSize });
        else rows[placed.index] = { left, top: listTop + offset, width: itemWidths[placed.index], height: textSize };
      }
    });
    const rowsPerColumn = Math.max(...columns.map((column) => column.lines.filter((line) => line.placed.kind === "item").length));
    return { rows, headings, textSize, rowSpacing, listLeft, listTop, listBottom: listTop + listHeight, columnCount, rowsPerColumn, columnWidth: widest, columnGap };
  }

  // Index of the row under a point, or -1. Each row's hit area spans half the gap to its neighbors.
  public rowAt(layout: MenuLayout, x: number, y: number): number {
    const halfGap = (layout.rowSpacing - layout.textSize) / 2;
    // With several columns, each row's hit area stops half way to the next column.
    const single = layout.columnCount === 1;
    const marginLeft = single ? HIT_MARGIN_LEFT : layout.columnGap / 2;
    return layout.rows.findIndex(
      (row) =>
        x >= row.left - marginLeft &&
        x <= (single ? row.left + row.width + HIT_MARGIN_RIGHT : row.left + layout.columnWidth + layout.columnGap / 2) &&
        y >= row.top - halfGap &&
        y <= row.top + row.height + halfGap,
    );
  }

  public update(deltaSeconds: number, layout: MenuLayout): void {
    const row = layout.rows[this.selectedIndex];
    const target = row.top + row.height / 2;
    if (Number.isNaN(this.pointerY)) {
      this.pointerY = target;
      this.pointerX = row.left;
      return;
    }
    const ease = 1 - Math.exp(-POINTER_EASE_PER_SECOND * deltaSeconds);
    this.pointerY += (target - this.pointerY) * ease;
    this.pointerX += (row.left - this.pointerX) * ease;
  }
}
