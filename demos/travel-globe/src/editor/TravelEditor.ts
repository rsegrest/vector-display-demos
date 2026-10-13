import type { BeamColor } from "@vector-display/core";
import { STATUS_COLORS } from "../render/GlobeRenderer.js";
import { formatYears, parseYears } from "../data/travelData.js";
import { PLACE_STATUSES, type GeoFeature, type PlaceStatus, type TravelData } from "../places.js";
import { addCity, entryFor, removeCity, setPost, setProfile, setStatus, setYears, updateCity, type PlaceRef } from "./editTravel.js";

export interface TravelEditorOptions {
  // The dev server's travel API, e.g. "/api/travel".
  readonly apiUrl: string;
  readonly initialData: TravelData;
  // Called after every edit so the globe can redraw with the working copy.
  readonly onChange: (data: TravelData) => void;
  // Turns map picking on (with a callback for the picked spot) or off (null).
  readonly onPickMode: (onPick: ((location: { lng: number; lat: number }) => void) | null) => void;
  readonly onOpenChange: (isOpen: boolean) => void;
}

const STATUS_LABELS: Record<PlaceStatus, string> = {
  visited: "Visited",
  seen: "Seen",
  planned: "Planned",
  want: "Want to go",
  lived: "Lived",
};

// The edit panel: profile, the selected place's status, years, post and cities, and Save / Revert.
// It edits a working copy; nothing is written until Save.
export class TravelEditor {
  public readonly element: HTMLElement;
  private data: TravelData;
  private saved: TravelData;
  private selected: GeoFeature | null = null;
  private message = "";
  private isError = false;
  private pickingForCity = false;

  public constructor(private readonly options: TravelEditorOptions) {
    this.data = options.initialData;
    this.saved = options.initialData;
    this.element = document.createElement("aside");
    this.element.className = "travel-editor";
    this.element.setAttribute("aria-label", "Edit travel data");
    this.element.hidden = true;
    window.addEventListener("beforeunload", (event) => {
      if (this.isDirty) event.preventDefault();
    });
  }

  public get isOpen(): boolean {
    return !this.element.hidden;
  }

  public get isDirty(): boolean {
    return JSON.stringify(this.data) !== JSON.stringify(this.saved);
  }

  public toggle(): void {
    this.element.hidden = !this.element.hidden;
    if (!this.isOpen) this.stopPicking();
    this.options.onOpenChange(this.isOpen);
    this.render();
  }

  public showSelection(feature: GeoFeature | null): void {
    this.selected = feature;
    if (this.isOpen) this.render();
  }

  private get place(): PlaceRef | null {
    const feature = this.selected;
    return feature ? { id: feature.id, kind: feature.kind, name: feature.name } : null;
  }

  private update(next: TravelData, rerender = true): void {
    this.data = next;
    this.message = "";
    this.options.onChange(next);
    if (rerender) this.render();
    else this.renderFooter();
  }

  private render(): void {
    if (!this.isOpen) return;
    this.element.replaceChildren(this.header(), this.profileSection(), this.placeSection(), this.footer());
  }

  private renderFooter(): void {
    this.element.querySelector(".editor-footer")?.replaceWith(this.footer());
  }

  private header(): HTMLElement {
    const header = el("div", "editor-header");
    header.append(el("h2", "", "Edit travel data"), button("Close", () => this.toggle(), "Close the editor"));
    return header;
  }

  private profileSection(): HTMLElement {
    const section = el("section", "editor-section");
    const title = input(this.data.profile.title ?? "", "Title");
    const homeBase = input(this.data.profile.homeBase ?? "", "Home base");
    const apply = () => this.update(setProfile(this.data, { title: title.value, homeBase: homeBase.value }), false);
    title.addEventListener("input", apply);
    homeBase.addEventListener("input", apply);
    section.append(labeled("Title", title), labeled("Home base", homeBase));
    return section;
  }

  private placeSection(): HTMLElement {
    const section = el("section", "editor-section");
    const place = this.place;
    if (!place) {
      section.append(el("p", "editor-hint", "Click a country or state on the globe to edit it."));
      return section;
    }
    const entry = entryFor(this.data, place);
    section.append(el("h3", "", `${place.name} (${place.kind === "state" ? "US state" : "country"})`));

    const statuses = el("div", "editor-statuses");
    statuses.setAttribute("role", "group");
    statuses.setAttribute("aria-label", "Status");
    const statusButton = (label: string, status: PlaceStatus | null, color?: BeamColor) => {
      const choice = button(label, () => this.update(setStatus(this.data, place, status)));
      choice.setAttribute("aria-pressed", String((entry?.status ?? null) === status));
      if (color) choice.style.setProperty("--status", cssColor(color));
      return choice;
    };
    statuses.append(statusButton("Not visited", null));
    for (const status of PLACE_STATUSES) statuses.append(statusButton(STATUS_LABELS[status], status, STATUS_COLORS[status]));
    section.append(statuses);
    if (!entry) return section;

    const years = input(formatYears(entry.years ?? []), "Years");
    years.placeholder = "1995-1997, 2001";
    const yearsError = el("p", "editor-error");
    years.addEventListener("change", () => {
      const parsed = parseYears(years.value);
      yearsError.textContent = parsed.error ?? "";
      if (parsed.years) this.update(setYears(this.data, place, parsed.years), false);
    });
    section.append(labeled("Years", years), yearsError);

    const postTitle = input(entry.post?.title ?? "", "Post title");
    const postSlug = input(entry.blogPostSlug ?? "", "Post slug");
    postSlug.placeholder = "malaysia-surprising-sanctuary";
    const postBody = document.createElement("textarea");
    postBody.value = entry.post?.body ?? "";
    postBody.rows = 2;
    const applyPost = () => this.update(setPost(this.data, place, { title: postTitle.value, slug: postSlug.value, body: postBody.value }), false);
    for (const field of [postTitle, postSlug, postBody]) field.addEventListener("change", applyPost);
    section.append(labeled("Blog post title", postTitle), labeled("Blog post slug (ricksegrest.com/blog/…)", postSlug), labeled("Note", postBody));

    section.append(el("h4", "", "Cities"));
    (entry.cities ?? []).forEach((city, index) => {
      const row = el("div", "editor-city");
      const name = input(city.name, "City name");
      name.addEventListener("change", () => this.update(updateCity(this.data, place, index, { name: name.value.trim() }), false));
      const kind = document.createElement("select");
      kind.setAttribute("aria-label", "City kind");
      for (const option of ["visited", "lived", "want"] as const) kind.add(new Option(STATUS_LABELS[option], option, false, city.kind === option));
      kind.addEventListener("change", () => this.update(updateCity(this.data, place, index, { kind: kind.value as typeof city.kind })));
      const where = el("span", "editor-coords", `${city.lat.toFixed(2)}, ${city.lng.toFixed(2)}`);
      row.append(name, kind, where, button("✕", () => this.update(removeCity(this.data, place, index)), `Remove ${city.name || "city"}`));
      section.append(row);
      if (!city.name && index === (entry.cities ?? []).length - 1) queueMicrotask(() => name.focus());
    });
    const addButton = button(this.pickingForCity ? "Click the city's spot on the globe… (Esc cancels)" : "+ Add a city by clicking the map", () =>
      this.pickingForCity ? this.stopPicking() : this.startPicking(place),
    );
    addButton.classList.add("editor-add-city");
    addButton.setAttribute("aria-pressed", String(this.pickingForCity));
    section.append(addButton);
    return section;
  }

  private startPicking(place: PlaceRef): void {
    this.pickingForCity = true;
    this.options.onPickMode((location) => {
      this.stopPicking();
      const kind = entryFor(this.data, place)?.status === "lived" ? "lived" : "visited";
      this.update(addCity(this.data, place, { name: "", lat: round(location.lat), lng: round(location.lng), kind }));
    });
    this.render();
  }

  public stopPicking(): void {
    if (!this.pickingForCity) return;
    this.pickingForCity = false;
    this.options.onPickMode(null);
    this.render();
  }

  public get isPicking(): boolean {
    return this.pickingForCity;
  }

  private footer(): HTMLElement {
    const footer = el("div", "editor-footer");
    const save = button(this.isDirty ? "Save" : "Saved", () => void this.save());
    save.disabled = !this.isDirty;
    save.classList.add("editor-save");
    const revert = button("Revert", () => this.update(this.saved));
    revert.disabled = !this.isDirty;
    const message = el("p", this.isError ? "editor-error" : "editor-message", this.message);
    message.setAttribute("aria-live", "polite");
    footer.append(save, revert, message);
    return footer;
  }

  private async save(): Promise<void> {
    try {
      const response = await fetch(this.options.apiUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.data),
      });
      const result = (await response.json()) as { ok?: boolean; problems?: string[] };
      if (response.ok) {
        this.saved = this.data;
        this.message = "Saved to travel.json. Publish to update the live site.";
        this.isError = false;
      } else {
        this.message = (result.problems ?? ["Save failed."]).join(" ");
        this.isError = true;
      }
    } catch {
      this.message = "Could not reach the dev server to save.";
      this.isError = true;
    }
    this.renderFooter();
  }
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function input(value: string, label: string): HTMLInputElement {
  const element = document.createElement("input");
  element.type = "text";
  element.value = value;
  element.setAttribute("aria-label", label);
  return element;
}

function labeled(text: string, control: HTMLElement): HTMLElement {
  const label = el("label", "editor-field");
  label.append(el("span", "", text), control);
  return label;
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

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
