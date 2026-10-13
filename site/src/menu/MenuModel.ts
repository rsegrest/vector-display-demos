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
}

export const ITEM_TEXT_SIZE = 34;
const ROW_SPACING = 74;
// How far the clickable area reaches left of the text, to cover the pointer.
const HIT_MARGIN_LEFT = 260;
const HIT_MARGIN_RIGHT = 120;
const POINTER_EASE_PER_SECOND = 14;

// Selection, layout and hit testing for the index list, independent of drawing.
export class MenuModel {
  public selectedIndex: number;
  public pointerY = Number.NaN;

  public constructor(
    private readonly itemCount: number,
    rememberedIndex = 0,
  ) {
    this.selectedIndex = rememberedIndex >= 0 && rememberedIndex < itemCount ? rememberedIndex : 0;
  }

  public move(delta: number): void {
    this.selectedIndex = (((this.selectedIndex + delta) % this.itemCount) + this.itemCount) % this.itemCount;
  }

  public layout(input: MenuLayoutInput): MenuLayout {
    const widest = Math.max(...input.itemWidths);
    const listLeft = (input.width - widest) / 2;
    const listHeight = (this.itemCount - 1) * ROW_SPACING + ITEM_TEXT_SIZE;
    // Slightly below center, leaving room for the title.
    const listTop = input.height * 0.56 - listHeight / 2;
    const rows = input.itemWidths.map((width, index) => ({
      left: listLeft,
      top: listTop + index * ROW_SPACING,
      width,
      height: ITEM_TEXT_SIZE,
    }));
    return { rows, rowSpacing: ROW_SPACING, listLeft, listTop, listBottom: listTop + listHeight };
  }

  // Index of the row under a point, or -1. Each row's hit area spans half the gap to its neighbors.
  public rowAt(layout: MenuLayout, x: number, y: number): number {
    const halfGap = (layout.rowSpacing - ITEM_TEXT_SIZE) / 2;
    return layout.rows.findIndex(
      (row) =>
        x >= row.left - HIT_MARGIN_LEFT &&
        x <= row.left + row.width + HIT_MARGIN_RIGHT &&
        y >= row.top - halfGap &&
        y <= row.top + row.height + halfGap,
    );
  }

  public update(deltaSeconds: number, layout: MenuLayout): void {
    const row = layout.rows[this.selectedIndex];
    const target = row.top + row.height / 2;
    if (Number.isNaN(this.pointerY)) {
      this.pointerY = target;
      return;
    }
    this.pointerY += (target - this.pointerY) * (1 - Math.exp(-POINTER_EASE_PER_SECOND * deltaSeconds));
  }
}
