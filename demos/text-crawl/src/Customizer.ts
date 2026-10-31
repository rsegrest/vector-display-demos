import { fontSafeText } from "@vector-demos/demo-kit";
import { LINE_CHARACTERS, TITLE_CHARACTERS } from "./sim/pageLayout.js";

// The most a visitor may type: a header of a few title lines, and text for several pages.
const HEADER_LENGTH = TITLE_CHARACTERS * 3;
const TEXT_LENGTH = 1200;

export interface CustomizerWords {
  readonly header: string;
  readonly text: string;
}

// A CUSTOMIZE button in the top right corner that opens a panel for the crawl's words: a header
// and the text, typed centered and in capitals, just as the crawl will show them, and a SUBMIT
// button that closes the panel and hands the words over. The page's styles (site/src/textCrawl.css)
// give it the arcade font.
export class Customizer {
  public onSubmit: (words: CustomizerWords) => void = () => {};
  private readonly button: HTMLButtonElement;
  private readonly panel: HTMLFormElement;
  private readonly header: HTMLInputElement;
  private readonly text: HTMLTextAreaElement;

  public constructor(parent: HTMLElement, initial: CustomizerWords) {
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "crawl-customize-button";
    this.button.textContent = "CUSTOMIZE";
    this.button.setAttribute("aria-expanded", "false");
    this.button.setAttribute("aria-controls", "crawl-customize");
    this.button.addEventListener("click", () => (this.isOpen ? this.close() : this.open()));

    this.panel = document.createElement("form");
    this.panel.id = "crawl-customize";
    this.panel.className = "crawl-customize";
    this.panel.hidden = true;
    this.panel.setAttribute("aria-label", "Your own words for the crawl");

    this.header = document.createElement("input");
    this.header.type = "text";
    this.header.maxLength = HEADER_LENGTH;
    this.header.placeholder = "HEADER";
    this.header.value = initial.header;

    this.text = document.createElement("textarea");
    this.text.rows = 8;
    this.text.maxLength = TEXT_LENGTH;
    this.text.placeholder = "YOUR TEXT, LINE BY LINE";
    this.text.value = initial.text;
    // Lines no longer than the crawl's, so they wrap here where they will wrap there.
    this.text.cols = LINE_CHARACTERS;

    for (const field of [this.header, this.text]) {
      field.spellcheck = false;
      field.autocomplete = "off";
      // Capitals as they are typed, as the crawl draws them; anything the font cannot draw goes.
      field.addEventListener("input", () => Customizer.capitalize(field));
    }

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "crawl-customize-submit";
    submit.textContent = "SUBMIT";

    this.panel.append(Customizer.labeled("HEADER", this.header), Customizer.labeled("TEXT", this.text), submit);
    this.panel.addEventListener("submit", (event) => {
      event.preventDefault();
      this.onSubmit({ header: this.header.value, text: this.text.value });
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
    this.header.focus();
  }

  public close(): void {
    this.panel.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
  }

  // Whether a key event belongs to the panel (typing in it), so the crawl's own keys leave it alone.
  public owns(target: EventTarget | null): boolean {
    return target instanceof Node && (this.panel.contains(target) || target === this.button);
  }

  private static labeled(title: string, field: HTMLElement): HTMLLabelElement {
    const label = document.createElement("label");
    const caption = document.createElement("span");
    caption.textContent = title;
    label.append(caption, field);
    return label;
  }

  private static capitalize(field: HTMLInputElement | HTMLTextAreaElement): void {
    const { selectionStart, selectionEnd, value } = field;
    const safe = value
      .split("\n")
      .map((line) => fontSafeText(line))
      .join("\n");
    if (safe === value) return;
    field.value = safe;
    // Keep the caret where it was (capitals are the same length; a dropped character moves it back).
    const shift = safe.length - value.length;
    if (selectionStart !== null && selectionEnd !== null) field.setSelectionRange(selectionStart + shift, selectionEnd + shift);
  }
}
