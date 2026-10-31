import type { Place } from "./sim/astronomy.js";

export interface NamedPlace extends Place {
  readonly name: string;
}

// A LOCATION button in the top right corner that opens a panel for where the sky is seen from: the
// browser's own location (it asks the visitor, only when the button is pressed), or a latitude and
// longitude typed in. The page's styles (site/src/starMap.css) draw it like the site's other panels.
export class LocationPanel {
  public onChoose: (place: NamedPlace) => void = () => {};
  private readonly button: HTMLButtonElement;
  private readonly panel: HTMLFormElement;
  private readonly latitude: HTMLInputElement;
  private readonly longitude: HTMLInputElement;
  private readonly message: HTMLParagraphElement;

  public constructor(parent: HTMLElement, current: Place) {
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "corner-link";
    this.button.textContent = "LOCATION";
    this.button.setAttribute("aria-expanded", "false");
    this.button.setAttribute("aria-controls", "star-map-location");
    this.button.addEventListener("click", () => (this.isOpen ? this.close() : this.open()));

    this.panel = document.createElement("form");
    this.panel.id = "star-map-location";
    this.panel.className = "corner-panel";
    this.panel.hidden = true;
    this.panel.setAttribute("aria-label", "Where the sky is seen from");

    const useMine = document.createElement("button");
    useMine.type = "button";
    useMine.textContent = "USE MY LOCATION";
    useMine.addEventListener("click", () => this.useBrowserLocation());

    this.latitude = LocationPanel.numberField(current.latitude, -90, 90);
    this.longitude = LocationPanel.numberField(current.longitude, -180, 180);
    this.message = document.createElement("p");
    this.message.className = "corner-panel-message";
    this.message.textContent = "OR TYPE IT: NORTH AND EAST POSITIVE, SOUTH AND WEST NEGATIVE.";

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "corner-panel-submit";
    submit.textContent = "SET";

    this.panel.append(useMine, this.message, LocationPanel.labeled("LATITUDE", this.latitude), LocationPanel.labeled("LONGITUDE", this.longitude), submit);
    this.panel.addEventListener("submit", (event) => {
      event.preventDefault();
      const latitude = Number.parseFloat(this.latitude.value);
      const longitude = Number.parseFloat(this.longitude.value);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
        this.message.textContent = "LATITUDE IS -90 TO 90, LONGITUDE -180 TO 180.";
        return;
      }
      this.onChoose({ latitude, longitude, name: "Typed location" });
      this.close();
    });
    parent.append(this.button, this.panel);
  }

  public get isOpen(): boolean {
    return !this.panel.hidden;
  }

  public open(): void {
    this.panel.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
    this.latitude.focus();
  }

  public close(): void {
    this.panel.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
  }

  // Whether a key event belongs to the panel (typing in it), so the map's own keys leave it alone.
  public owns(target: EventTarget | null): boolean {
    return target instanceof Node && (this.panel.contains(target) || target === this.button);
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
        this.onChoose({ latitude, longitude, name: "Your location" });
        this.close();
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

  private static labeled(title: string, field: HTMLElement): HTMLLabelElement {
    const label = document.createElement("label");
    const caption = document.createElement("span");
    caption.textContent = title;
    label.append(caption, field);
    return label;
  }
}
