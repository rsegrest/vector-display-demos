export interface MenuLayoutInput {
  readonly width: number;
  readonly height: number;
  // Measured width of each item's title at ITEM_TEXT_SIZE.
  readonly itemWidths: readonly number[];
}

export interface MenuRow {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface MenuLayout {
  readonly rows: readonly MenuRow[];
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

  // Steps sideways to the same row of the next column, if there is one.
  public moveColumn(delta: number, layout: MenuLayout): void {
    const target = this.selectedIndex + delta * layout.rowsPerColumn;
    if (target >= 0 && target < this.itemCount) this.selectedIndex = target;
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
    const itemWidths = input.itemWidths.map((width) => width * scale);
    const widest = Math.max(...itemWidths);
    // As many rows as fit between the title and the footer; any more start another column.
    const availableHeight = input.height - TOP_RESERVE - BOTTOM_RESERVE;
    const maximumRows = Math.max(1, Math.floor((availableHeight - textSize) / rowSpacing) + 1);
    const columnCount = Math.ceil(this.itemCount / maximumRows);
    const rowsPerColumn = Math.ceil(this.itemCount / columnCount);
    const listLeft = (input.width - (columnCount * widest + (columnCount - 1) * columnGap)) / 2;
    const listHeight = (rowsPerColumn - 1) * rowSpacing + textSize;
    // Slightly below center, leaving room for the title.
    const listTop = columnCount === 1 ? input.height * 0.56 - listHeight / 2 : Math.max(TOP_RESERVE, input.height * 0.56 - listHeight / 2);
    const rows = itemWidths.map((width, index) => ({
      left: listLeft + Math.floor(index / rowsPerColumn) * (widest + columnGap),
      top: listTop + (index % rowsPerColumn) * rowSpacing,
      width,
      height: textSize,
    }));
    return { rows, textSize, rowSpacing, listLeft, listTop, listBottom: listTop + listHeight, columnCount, rowsPerColumn, columnWidth: widest, columnGap };
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
