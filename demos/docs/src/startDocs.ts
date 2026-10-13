import { BeamSettingsStore, browserSettingsStorage } from "@vector-demos/demo-kit";
import { createBeamSettingsPanel } from "./BeamSettingsPanel.js";
import { SnippetFigure } from "./SnippetFigure.js";
import { createSnippetApi } from "./snippetRuntime.js";

// Displays are started a little before they scroll into view.
const ACTIVATION_MARGIN = "200px";
// Never more than this many displays running, however tall the window.
const MAXIMUM_ACTIVE = 8;

export interface DocsPage {
  readonly figures: readonly SnippetFigure[];
  readonly settings: BeamSettingsStore;
}

// Brings a guide page to life: every <figure class="snippet"> becomes an editor
// with a live display, and the element with id "beam-settings" gets the sliders.
// The page is complete, readable text without this.
export function startDocs(root: ParentNode = document): DocsPage {
  const settings = new BeamSettingsStore(browserSettingsStorage());
  const api = createSnippetApi();
  const figures = [...root.querySelectorAll<HTMLElement>("figure.snippet")].map((figure) => new SnippetFigure(figure, settings, api));

  const panelSlot = root.querySelector("#beam-settings");
  if (panelSlot) panelSlot.append(createBeamSettingsPanel(settings));

  const byElement = new Map<Element, SnippetFigure>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const figure = byElement.get(entry.target);
        if (!figure) continue;
        if (!entry.isIntersecting) figure.deactivate();
        else if (figures.filter((other) => other.isActive).length < MAXIMUM_ACTIVE) figure.activate();
      }
    },
    { rootMargin: ACTIVATION_MARGIN },
  );
  for (const [index, element] of [...root.querySelectorAll<HTMLElement>("figure.snippet")].entries()) {
    byElement.set(element, figures[index]);
    observer.observe(element);
  }

  const page = { figures, settings };
  (window as unknown as { vectorDocs: unknown }).vectorDocs = page;
  return page;
}
