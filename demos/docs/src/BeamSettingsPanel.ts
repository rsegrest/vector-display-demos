import { BEAM_SETTING_RANGES, type BeamSettingsStore } from "@vector-demos/demo-kit";

// A slider for each beam setting, bound both ways to the store: moving a slider
// changes every display on the page at once, and the values come back on the next visit.
export function createBeamSettingsPanel(store: BeamSettingsStore): HTMLElement {
  const panel = document.createElement("form");
  panel.className = "beam-panel";
  panel.setAttribute("aria-label", "Beam settings");
  panel.addEventListener("submit", (event) => event.preventDefault());

  const sliders = new Map<string, { input: HTMLInputElement; output: HTMLOutputElement; unit: string; step: number }>();
  for (const range of BEAM_SETTING_RANGES) {
    const id = `beam-${range.key}`;
    const row = document.createElement("div");
    row.className = "beam-row";

    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = range.label;

    const input = document.createElement("input");
    input.type = "range";
    input.id = id;
    input.min = String(range.minimum);
    input.max = String(range.maximum);
    input.step = String(range.step);
    input.addEventListener("input", () => store.set({ [range.key]: Number(input.value) }));

    const output = document.createElement("output");
    output.htmlFor.add(id);

    row.append(label, input, output);
    panel.append(row);
    sliders.set(range.key, { input, output, unit: range.unit, step: range.step });
  }

  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Reset to defaults";
  reset.addEventListener("click", () => store.reset());
  panel.append(reset);

  store.subscribe((settings) => {
    for (const [key, slider] of sliders) {
      const value = settings[key as keyof typeof settings];
      slider.input.value = String(value);
      const places = slider.step < 0.1 ? 2 : slider.step < 1 ? 1 : 0;
      slider.output.textContent = `${value.toFixed(places)}${slider.unit ? ` ${slider.unit}` : ""}`;
    }
  });
  return panel;
}
