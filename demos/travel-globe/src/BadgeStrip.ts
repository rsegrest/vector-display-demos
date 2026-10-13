import type { BeamColor } from "@vector-display/core";
import { STATUS_COLORS } from "./render/GlobeRenderer.js";
import type { TravelGlobeDemo } from "./TravelGlobeDemo.js";
import type { GeoFeature } from "./places.js";

// The strip under the globe: World / United States, previous-tour-next, and a badge per place in the
// current scope. Plain HTML, so the flags render as emoji and the controls work with any input.
export class BadgeStrip {
  public readonly element: HTMLElement;
  private readonly list: HTMLElement;
  private readonly modeButtons: Record<"world" | "us", HTMLButtonElement>;
  private readonly tourButton: HTMLButtonElement;
  private badges = new Map<string, HTMLButtonElement>();

  public constructor(private readonly demo: TravelGlobeDemo) {
    this.element = document.createElement("nav");
    this.element.className = "badge-strip";
    this.element.setAttribute("aria-label", "Places");

    const modes = group("Map");
    this.modeButtons = {
      world: button("🌐 World", () => demo.setMode("world")),
      us: button("🇺🇸 United States", () => demo.setMode("us")),
    };
    modes.append(this.modeButtons.world, this.modeButtons.us);

    const tour = group("Tour");
    this.tourButton = button("▶ Tour", () => demo.toggleTour());
    tour.append(
      button("‹", () => demo.stepPlace(-1), "Previous place"),
      this.tourButton,
      button("›", () => demo.stepPlace(1), "Next place"),
    );

    this.list = document.createElement("div");
    this.list.className = "badge-list";
    this.element.append(modes, tour, this.list);
    this.render();
  }

  // Rebuilds the badges for the current scope.
  public render(): void {
    const { mode } = this.demo;
    this.modeButtons.world.setAttribute("aria-pressed", String(mode === "world"));
    this.modeButtons.us.setAttribute("aria-pressed", String(mode === "us"));
    this.list.setAttribute("aria-label", mode === "us" ? "US states" : "Countries");
    this.list.replaceChildren();
    this.badges.clear();
    for (const place of this.demo.scopePlaces) {
      const badge = button("", () => {
        this.demo.stopTour();
        this.demo.noteActivity();
        this.demo.select(place);
      });
      badge.className = "badge";
      badge.style.setProperty("--status", cssColor(STATUS_COLORS[place.status]));
      badge.title = `${place.name}: ${place.status}`;
      const marker = document.createElement("span");
      if (place.kind === "country") {
        marker.textContent = flagEmoji(place.id);
        marker.setAttribute("aria-hidden", "true");
      } else {
        marker.className = "code";
        marker.textContent = place.id.replace("US-", "");
        marker.setAttribute("aria-hidden", "true");
      }
      badge.append(marker, document.createTextNode(place.name));
      this.badges.set(place.id, badge);
      this.list.appendChild(badge);
    }
    this.showSelection(this.demo.selected);
  }

  public showSelection(selected: GeoFeature | null): void {
    for (const [id, badge] of this.badges) {
      const isCurrent = id === selected?.id;
      badge.setAttribute("aria-current", String(isCurrent));
      if (isCurrent) badge.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    }
  }

  // Shown only on machines allowed to edit (the dev server decides).
  public addEditButton(onClick: () => void): HTMLButtonElement {
    const edit = button("✎ Edit", onClick, "Edit travel data");
    edit.setAttribute("aria-pressed", "false");
    const group = this.element.querySelector(".group[aria-label='Tour']")!;
    group.after(wrapInGroup("Editing", edit));
    return edit;
  }

  public showTour(isTouring: boolean): void {
    this.tourButton.textContent = isTouring ? "❚❚ Pause" : "▶ Tour";
    this.tourButton.setAttribute("aria-pressed", String(isTouring));
  }
}

function wrapInGroup(label: string, child: HTMLElement): HTMLElement {
  const element = group(label);
  element.appendChild(child);
  return element;
}

function group(label: string): HTMLElement {
  const element = document.createElement("div");
  element.className = "group";
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", label);
  return element;
}

function button(text: string, onClick: () => void, label?: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = text;
  if (label) element.setAttribute("aria-label", label);
  element.addEventListener("click", onClick);
  return element;
}

function cssColor({ red, green, blue }: BeamColor): string {
  return `rgb(${Math.round(red * 255)} ${Math.round(green * 255)} ${Math.round(blue * 255)})`;
}

// Two regional-indicator letters make a flag, e.g. "FR" -> 🇫🇷.
function flagEmoji(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}
