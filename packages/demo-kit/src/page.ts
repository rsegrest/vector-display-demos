// Replaces the page with a plain error message, e.g. when WebGL2 is missing.
export function showFatalError(message: string): void {
  const element = document.createElement("div");
  element.setAttribute("role", "alert");
  element.style.cssText =
    "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;" +
    "color:#f88;font:16px ui-monospace,monospace;text-align:center;background:#000";
  element.textContent = message;
  document.body.appendChild(element);
}

// Escape returns to the demo index. It is registered in the capture phase so it
// runs before any demo handler, ignores auto-repeat, and does not defer to
// fullscreen: when the page receives the key, one press is always enough. (A
// browser may keep the very first Escape pressed in fullscreen to leave
// fullscreen, in which case a second press reaches the page.)
export function bindEscapeToIndex(indexHref = "../"): void {
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || event.repeat) return;
      location.href = indexHref;
    },
    { capture: true },
  );
}

export function readIntegerParameter(name: string, fallback: number, low: number, high: number): number {
  const value = Number.parseInt(new URLSearchParams(location.search).get(name) ?? "", 10);
  return Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : fallback;
}

export function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.();
}
