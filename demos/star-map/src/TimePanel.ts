import { CornerPanel } from "./CornerPanel.js";
import type { ClockZone } from "./StarMapDemo.js";

// TIME: which moment the sky shows. A date and time typed or picked, an hour slider that sweeps the
// chosen day's night as it is dragged (the sky follows), and NOW to go back to the present.
export class TimePanel extends CornerPanel {
  // Called as the time changes: on every movement of the slider, and when a date is set.
  public onChange: (time: Date) => void = () => {};
  public onNow: () => void = () => {};
  private readonly date: HTMLInputElement;
  private readonly hour: HTMLInputElement;
  private readonly hourLabel: HTMLSpanElement;

  // The zone the date and time are read in: the browser's, or the faraway place's (see StarMapDemo.clockZone).
  private zone: ClockZone = { offsetMinutes: 0, isBrowsers: true };

  public constructor(bar: HTMLElement, current: () => Date, zone: () => ClockZone) {
    super(bar, "TIME", "star-map-time", "Which moment the sky shows");
    this.date = document.createElement("input");
    this.date.type = "date";
    this.hour = document.createElement("input");
    this.hour.type = "range";
    // Minutes of the day, in quarter hours.
    this.hour.min = "0";
    this.hour.max = String(24 * 60 - 15);
    this.hour.step = "15";
    this.hourLabel = document.createElement("span");
    const hourField = CornerPanel.labeled("TIME OF DAY", this.hour);
    hourField.querySelector("span")!.append(" ", this.hourLabel);

    const show = (): void => this.onChange(this.chosen());
    this.date.addEventListener("change", show);
    this.hour.addEventListener("input", () => {
      this.showHour();
      show();
    });

    const message = document.createElement("p");
    message.className = "corner-panel-message";
    message.textContent = "DRAG THE SLIDER TO SWEEP THROUGH THE DAY. THE CLOCK RUNS ON FROM THERE.";
    const now = CornerPanel.textButton("NOW", () => {
      this.onNow();
      this.fill(new Date());
    });
    now.className = "corner-panel-submit";
    this.panel.append(CornerPanel.labeled("DATE", this.date), hourField, message, now);
    // Filled from the sky's clock each time it opens.
    this.onOpen = () => {
      this.zone = zone();
      hourField.querySelector("span")!.firstChild!.textContent = this.zone.isBrowsers ? "TIME OF DAY" : "TIME OF DAY THERE (APPROX.)";
      this.fill(current());
    };
  }

  private fill(time: Date): void {
    const pad = (value: number): string => String(value).padStart(2, "0");
    // The time as the zone reads it: shifted, then read as UTC.
    const zoned = new Date(time.getTime() + this.zone.offsetMinutes * 60_000);
    this.date.value = `${zoned.getUTCFullYear()}-${pad(zoned.getUTCMonth() + 1)}-${pad(zoned.getUTCDate())}`;
    this.hour.value = String(zoned.getUTCHours() * 60 + Math.floor(zoned.getUTCMinutes() / 15) * 15);
    this.showHour();
  }

  private showHour(): void {
    const minutes = Number(this.hour.value);
    const time = new Date(Date.UTC(2000, 0, 1, Math.floor(minutes / 60), minutes % 60));
    this.hourLabel.textContent = time.toLocaleTimeString(undefined, { timeZone: "UTC", hour: "numeric", minute: "2-digit" }).toUpperCase();
  }

  // The moment chosen, read in the zone.
  private chosen(): Date {
    const [year, month, day] = this.date.value.split("-").map(Number);
    const minutes = Number(this.hour.value);
    if (!year || !month || !day) return new Date();
    return new Date(Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60) - this.zone.offsetMinutes * 60_000);
  }
}
