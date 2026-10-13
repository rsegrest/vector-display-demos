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
  readonly rowSpacing: number;
  readonly listLeft: number;
  readonly listTop: number;
  readonly listBottom: number;
  // The list splits into columns when it is too long for the screen.
  readonly columnCount: number;
  readonly rowsPerColumn: number;
  readonly columnWidth: number;
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

  public layout(input: MenuLayoutInput): MenuLayout {
    const widest = Math.max(...input.itemWidths);
    // As many rows as fit between the title and the footer; any more start another column.
    const availableHeight = input.height - TOP_RESERVE - BOTTOM_RESERVE;
    const maximumRows = Math.max(1, Math.floor((availableHeight - ITEM_TEXT_SIZE) / ROW_SPACING) + 1);
    const columnCount = Math.ceil(this.itemCount / maximumRows);
    const rowsPerColumn = Math.ceil(this.itemCount / columnCount);
    const listLeft = (input.width - (columnCount * widest + (columnCount - 1) * COLUMN_GAP)) / 2;
    const listHeight = (rowsPerColumn - 1) * ROW_SPACING + ITEM_TEXT_SIZE;
    // Slightly below center, leaving room for the title.
    const listTop = columnCount === 1 ? input.height * 0.56 - listHeight / 2 : Math.max(TOP_RESERVE, input.height * 0.56 - listHeight / 2);
    const rows = input.itemWidths.map((width, index) => ({
      left: listLeft + Math.floor(index / rowsPerColumn) * (widest + COLUMN_GAP),
      top: listTop + (index % rowsPerColumn) * ROW_SPACING,
      width,
      height: ITEM_TEXT_SIZE,
    }));
    return { rows, rowSpacing: ROW_SPACING, listLeft, listTop, listBottom: listTop + listHeight, columnCount, rowsPerColumn, columnWidth: widest };
  }

  // Index of the row under a point, or -1. Each row's hit area spans half the gap to its neighbors.
  public rowAt(layout: MenuLayout, x: number, y: number): number {
    const halfGap = (layout.rowSpacing - ITEM_TEXT_SIZE) / 2;
    // With several columns, each row's hit area stops half way to the next column.
    const single = layout.columnCount === 1;
    const marginLeft = single ? HIT_MARGIN_LEFT : COLUMN_GAP / 2;
    return layout.rows.findIndex(
      (row) =>
        x >= row.left - marginLeft &&
        x <= (single ? row.left + row.width + HIT_MARGIN_RIGHT : row.left + layout.columnWidth + COLUMN_GAP / 2) &&
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
