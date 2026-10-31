import { CITIES } from "./cities.js";
import { CornerPanel } from "./CornerPanel.js";
import type { Place } from "./sim/astronomy.js";

export interface NamedPlace extends Place {
  readonly name: string;
}

// LOCATION: where the sky is seen from. A city from the list, the browser's own location (it asks
// the visitor, only when that button is pressed), or a latitude and longitude typed in.
export class LocationPanel extends CornerPanel {
  public onChoose: (place: NamedPlace) => void = () => {};
  private readonly latitude: HTMLInputElement;
  private readonly longitude: HTMLInputElement;
  private readonly message: HTMLParagraphElement;

  public constructor(bar: HTMLElement, current: Place) {
    super(bar, "LOCATION", "star-map-location", "Where the sky is seen from");

    const city = document.createElement("select");
    city.append(new Option("CHOOSE A CITY", ""));
    for (const [index, each] of CITIES.entries()) city.append(new Option(each.name.toUpperCase(), String(index)));
    city.addEventListener("change", () => {
      const chosen = CITIES[Number(city.value)];
      if (!chosen || city.value === "") return;
      this.latitude.value = String(chosen.latitude);
      this.longitude.value = String(chosen.longitude);
      this.choose({ latitude: chosen.latitude, longitude: chosen.longitude, name: chosen.name });
    });

    this.latitude = LocationPanel.numberField(current.latitude, -90, 90);
    this.longitude = LocationPanel.numberField(current.longitude, -180, 180);
    this.message = document.createElement("p");
    this.message.className = "corner-panel-message";
    this.message.textContent = "OR TYPE IT: NORTH AND EAST POSITIVE, SOUTH AND WEST NEGATIVE.";

    const set = CornerPanel.textButton("SET", () => {}, "submit");
    set.className = "corner-panel-submit";
    this.panel.append(
      CornerPanel.labeled("CITY", city),
      CornerPanel.textButton("USE MY LOCATION", () => this.useBrowserLocation()),
      this.message,
      CornerPanel.labeled("LATITUDE", this.latitude),
      CornerPanel.labeled("LONGITUDE", this.longitude),
      set,
    );
    this.panel.addEventListener("submit", () => {
      const latitude = Number.parseFloat(this.latitude.value);
      const longitude = Number.parseFloat(this.longitude.value);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
        this.message.textContent = "LATITUDE IS -90 TO 90, LONGITUDE -180 TO 180.";
        return;
      }
      this.choose({ latitude, longitude, name: "Typed location" });
    });
  }

  private choose(place: NamedPlace): void {
    this.onChoose(place);
    this.close();
  }

  private useBrowserLocation(): void {
    if (!("geolocation" in navigator)) {
      this.message.textContent = "THIS BROWSER CANNOT TELL WHERE IT IS. TYPE IT INSTEAD.";
      return;
    }
    this.message.textContent = "ASKING THE BROWSER...";
    navigator.geolocation.getCurrentPosition(
      (position) => {
        // Rounded: a hundredth of a degree (about a kilometer) is far finer than the sky needs.
        const latitude = Math.round(position.coords.latitude * 100) / 100;
        const longitude = Math.round(position.coords.longitude * 100) / 100;
        this.latitude.value = String(latitude);
        this.longitude.value = String(longitude);
        this.choose({ latitude, longitude, name: "Your location" });
      },
      () => (this.message.textContent = "THE BROWSER DID NOT SAY. TYPE IT INSTEAD."),
      { maximumAge: 600_000, timeout: 15_000 },
    );
  }

  private static numberField(value: number, minimum: number, maximum: number): HTMLInputElement {
    const field = document.createElement("input");
    field.type = "number";
    field.step = "any";
    field.min = String(minimum);
    field.max = String(maximum);
    field.value = String(value);
    return field;
  }
}
