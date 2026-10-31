// A button in the row at the top right corner that opens a small panel under it, and closes it again.
// The page's styles (site/src/starMap.css) draw both like the site's other corner panels.
export class CornerPanel {
  protected readonly button: HTMLButtonElement;
  protected readonly panel: HTMLFormElement;
  // Told when a panel opens, so the others close.
  public onOpen: () => void = () => {};

  public constructor(bar: HTMLElement, label: string, id: string, description: string) {
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "corner-link";
    this.button.textContent = label;
    this.button.setAttribute("aria-expanded", "false");
    this.button.setAttribute("aria-controls", id);
    this.button.addEventListener("click", () => (this.isOpen ? this.close() : this.open()));

    this.panel = document.createElement("form");
    this.panel.id = id;
    this.panel.className = "corner-panel";
    this.panel.hidden = true;
    this.panel.setAttribute("aria-label", description);
    this.panel.addEventListener("submit", (event) => event.preventDefault());
    bar.append(this.button);
    bar.parentElement!.append(this.panel);
  }

  public get isOpen(): boolean {
    return !this.panel.hidden;
  }

  public open(): void {
    this.onOpen();
    this.panel.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
    (this.panel.querySelector("input, select, button") as HTMLElement | null)?.focus();
  }

  public close(): void {
    this.panel.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
  }

  // Whether a key event belongs to the panel (typing in it), so the map's own keys leave it alone.
  public owns(target: EventTarget | null): boolean {
    return target instanceof Node && (this.panel.contains(target) || target === this.button);
  }

  // The row of corner buttons, made once for the page.
  public static bar(parent: HTMLElement): HTMLElement {
    const existing = parent.querySelector<HTMLElement>(".corner-bar");
    if (existing) return existing;
    const bar = document.createElement("div");
    bar.className = "corner-bar";
    parent.append(bar);
    return bar;
  }

  protected static labeled(title: string, field: HTMLElement): HTMLLabelElement {
    const label = document.createElement("label");
    const caption = document.createElement("span");
    caption.textContent = title;
    label.append(caption, field);
    return label;
  }

  protected static textButton(text: string, onPress: () => void, type: "button" | "submit" = "button"): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = type;
    button.textContent = text;
    if (type === "button") button.addEventListener("click", onPress);
    return button;
  }
}
