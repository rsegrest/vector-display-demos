import { SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList, type ShapePlacement } from "@vector-display/core";
import { DynamicGeometry, HUD_MARGIN, HUD_TEXT_COLOR, getDemoFont } from "@vector-demos/demo-kit";

const FRAME_COLOR: BeamColor = { red: 0.35, green: 0.45, blue: 0.55 };

// The live attraction matrix, top right. Row = the species that reacts, column = the species it reacts to.
// Each cell's bar points right for attraction and left for repulsion, in the reacting species' color.
export class RulesMatrixView {
  private readonly frameGeometry = new DynamicGeometry(8);
  private readonly speciesGeometries: DynamicGeometry[] = [];

  public draw(
    displayList: DisplayList,
    attraction: Float32Array,
    speciesColors: readonly BeamColor[],
    worldWidth: number,
    intensity: number,
  ): void {
    const count = speciesColors.length;
    const cell = Math.min(30, 260 / count);
    const size = cell * count;
    const left = worldWidth - HUD_MARGIN - size;
    const top = HUD_MARGIN + 18;
    const halfBar = cell * 0.42;

    while (this.speciesGeometries.length < count) this.speciesGeometries.push(new DynamicGeometry(64));
    for (const geometry of this.speciesGeometries) geometry.clear();

    const frame = this.frameGeometry;
    frame.clear();
    frame.moveTo(left, top);
    frame.lineTo(left + size, top);
    frame.lineTo(left + size, top + size);
    frame.lineTo(left, top + size);
    frame.closePath();

    for (let row = 0; row < count; row++) {
      const geometry = this.speciesGeometries[row];
      const centerY = top + (row + 0.5) * cell;
      // Row key on the left, column key on top.
      geometry.addSegment(left - 14, centerY, left - 6, centerY);
      geometry.addSegment(left + (row + 0.5) * cell, top - 14, left + (row + 0.5) * cell, top - 6);
      for (let column = 0; column < count; column++) {
        const value = attraction[row * count + column];
        const centerX = left + (column + 0.5) * cell;
        geometry.addSegment(centerX, centerY, centerX + value * halfBar, centerY);
      }
    }

    displayList.setColor(FRAME_COLOR);
    displayList.addShape(frame, { ...SCREEN_SPACE_PLACEMENT, intensity: intensity * 0.5 });
    const placement: ShapePlacement = { ...SCREEN_SPACE_PLACEMENT, intensity };
    for (let row = 0; row < count; row++) {
      displayList.setColor(speciesColors[row]);
      displayList.addShape(this.speciesGeometries[row], placement);
    }
    displayList.setColor(HUD_TEXT_COLOR);
    getDemoFont().addText(displayList, {
      text: "RULES",
      x: left + size,
      y: top + size + 10,
      size: 14,
      alignment: "right",
      intensity: intensity * 0.6,
    });
  }
}
