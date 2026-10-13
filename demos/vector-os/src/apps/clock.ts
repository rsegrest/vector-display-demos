import { SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList } from "@vector-display/core";
import { DynamicGeometry, getDemoFont, type Demo, type DemoFrame } from "@vector-demos/demo-kit";
import type { OsApp, OsServices } from "./OsApp.js";

const FACE_COLOR: BeamColor = { red: 0.5, green: 0.75, blue: 1 };
const HAND_COLOR: BeamColor = { red: 1, green: 0.95, blue: 0.8 };
const SECOND_COLOR: BeamColor = { red: 1, green: 0.4, blue: 0.3 };
const RIM_SIDES = 60;

// Angles of the three hands, in radians clockwise from twelve o'clock. Each hand
// moves smoothly: the hour hand is part-way between numbers, as on a real clock.
export function handAngles(time: Date): { hour: number; minute: number; second: number } {
  const seconds = time.getSeconds() + time.getMilliseconds() / 1000;
  const minutes = time.getMinutes() + seconds / 60;
  const hours = (time.getHours() % 12) + minutes / 60;
  return { hour: (hours / 12) * Math.PI * 2, minute: (minutes / 60) * Math.PI * 2, second: (seconds / 60) * Math.PI * 2 };
}

// An analog clock face showing the local time.
export class Clock implements Demo {
  private readonly face = new DynamicGeometry(128);
  private readonly hands = new DynamicGeometry(8);
  private readonly sweep = new DynamicGeometry(4);

  public constructor(private readonly now: () => Date) {}

  public update(): void {}

  public draw(displayList: DisplayList, frame: DemoFrame): void {
    const centreX = frame.width / 2;
    const centreY = frame.height / 2 - 10;
    const radius = Math.max(20, Math.min(frame.width, frame.height - 44) / 2 - 14);
    const at = (angle: number, distance: number): [number, number] => [centreX + Math.sin(angle) * distance, centreY - Math.cos(angle) * distance];

    this.face.clear();
    this.face.moveTo(...at(0, radius));
    for (let side = 1; side < RIM_SIDES; side++) this.face.lineTo(...at((side / RIM_SIDES) * Math.PI * 2, radius));
    this.face.closePath();
    // A mark for every hour, longer at the quarters.
    for (let hour = 0; hour < 12; hour++) {
      const angle = (hour / 12) * Math.PI * 2;
      const [outerX, outerY] = at(angle, radius * 0.94);
      const [innerX, innerY] = at(angle, radius * (hour % 3 === 0 ? 0.78 : 0.86));
      this.face.addSegment(innerX, innerY, outerX, outerY);
    }
    displayList.setColor(FACE_COLOR);
    displayList.addShape(this.face, { ...SCREEN_SPACE_PLACEMENT, intensity: 0.7 });

    const time = this.now();
    const angles = handAngles(time);
    this.hands.clear();
    this.hands.addSegment(centreX, centreY, ...at(angles.hour, radius * 0.5));
    this.hands.addSegment(centreX, centreY, ...at(angles.minute, radius * 0.76));
    displayList.setColor(HAND_COLOR);
    displayList.addShape(this.hands, { ...SCREEN_SPACE_PLACEMENT, intensity: 1.2 });

    this.sweep.clear();
    const [tailX, tailY] = at(angles.second + Math.PI, radius * 0.14);
    this.sweep.addSegment(tailX, tailY, ...at(angles.second, radius * 0.86));
    displayList.setColor(SECOND_COLOR);
    displayList.addShape(this.sweep, { ...SCREEN_SPACE_PLACEMENT, intensity: 1 });

    const digits = [time.getHours(), time.getMinutes(), time.getSeconds()].map((part) => String(part).padStart(2, "0")).join(":");
    displayList.setColor(FACE_COLOR);
    getDemoFont().addText(displayList, { text: digits, x: centreX, y: frame.height - 30, size: 15, alignment: "center", intensity: 0.9 });
  }
}

export function createClock(services: OsServices): OsApp {
  return { demo: new Clock(() => services.now()), worldHeight: null };
}
