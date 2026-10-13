import { SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList } from "@vector-display/core";
import { DynamicGeometry, buildPath, getDemoFont, glyphStrokes, type BeamPath, type DemoFrame } from "@vector-demos/demo-kit";

const TEXT_COLOR: BeamColor = { red: 0.45, green: 1, blue: 0.6 };
const LOGO_COLOR: BeamColor = { red: 0.55, green: 0.95, blue: 1 };

// Each line of the self-test appears this long after the one before, typing itself out.
const LINE_SECONDS = 0.26;
const CHARACTERS_PER_SECOND = 90;
// Then the beam writes the logo, and holds it a moment.
export const LOGO_SECONDS = 1.9;
const HOLD_SECONDS = 0.7;

// The power-on sequence: a self-test in the manner of an old machine's, then the
// name written out by the beam, stroke by stroke, as one continuous motion.
export class BootSequence {
  public seconds = 0;

  private readonly lines: string[];
  private readonly logo: BeamPath = buildPath(glyphStrokes("VECTOR OS"));
  private readonly logoGeometry = new DynamicGeometry(256);

  public constructor(programCount: number) {
    this.lines = [
      "VECTOR OS 0.1",
      "",
      "BEAM DEFLECTION ........ OK",
      "PHOSPHOR ............... OK",
      "STROKE MEMORY .......... OK",
      "CHARACTER GENERATOR .... OK",
      `PROGRAMS FOUND ......... ${programCount}`,
      "",
      "STARTING DESKTOP",
    ];
  }

  // How long the whole sequence takes.
  public get duration(): number {
    return this.lines.length * LINE_SECONDS + 0.4 + LOGO_SECONDS + HOLD_SECONDS;
  }

  public get isDone(): boolean {
    return this.seconds >= this.duration;
  }

  public update(deltaSeconds: number): void {
    this.seconds += deltaSeconds;
  }

  public skip(): void {
    this.seconds = this.duration;
  }

  public draw(displayList: DisplayList, frame: DemoFrame): void {
    const testSeconds = this.lines.length * LINE_SECONDS + 0.4;
    if (this.seconds < testSeconds) this.drawSelfTest(displayList);
    else this.drawLogo(displayList, frame, Math.min(1, (this.seconds - testSeconds) / LOGO_SECONDS));
  }

  private drawSelfTest(displayList: DisplayList): void {
    const font = getDemoFont();
    displayList.setColor(TEXT_COLOR);
    this.lines.forEach((line, row) => {
      const typed = Math.floor((this.seconds - row * LINE_SECONDS) * CHARACTERS_PER_SECOND);
      if (typed <= 0 || !line) return;
      font.addText(displayList, { text: line.slice(0, typed), x: 60, y: 70 + row * 30, size: 18, intensity: 0.95 });
    });
  }

  // The logo up to `progress` (0..1) of the way through the beam's tour of it.
  private drawLogo(displayList: DisplayList, frame: DemoFrame, progress: number): void {
    const { points, times, drawn, stopCount } = this.logo;
    const scale = frame.width * 0.3;
    const centreX = frame.width / 2;
    const centreY = frame.height / 2;
    const geometry = this.logoGeometry;
    geometry.clear();
    for (let stop = 1; stop < stopCount; stop++) {
      if (times[stop - 1] >= progress) break;
      if (!drawn[stop]) continue;
      // The stroke the beam is on is drawn only as far as the beam has got.
      const amount = Math.min(1, (progress - times[stop - 1]) / Math.max(1e-9, times[stop] - times[stop - 1]));
      const fromX = points[(stop - 1) * 3];
      const fromY = points[(stop - 1) * 3 + 1];
      geometry.addSegment(
        centreX + fromX * scale,
        centreY - fromY * scale,
        centreX + (fromX + (points[stop * 3] - fromX) * amount) * scale,
        centreY - (fromY + (points[stop * 3 + 1] - fromY) * amount) * scale,
      );
    }
    displayList.setColor(LOGO_COLOR);
    displayList.addShape(geometry, { ...SCREEN_SPACE_PLACEMENT, intensity: 1.3 });
  }
}
