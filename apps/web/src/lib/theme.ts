export type Theme = "ground" | "air";

/** Switches the atmosphere (tokens.css). Ground = airport (ivory); Air = cabin (midnight). */
export function setTheme(theme: Theme): void {
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;
  root.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "air" ? "#0E1A2F" : "#F4EFE4");
}

/** Interface brightness, 0.5–1 (FR-024). Separate from the window's sun-driven light. */
export function setInterfaceBrightness(level: number): void {
  const clamped = Math.min(1, Math.max(0.5, level));
  document.documentElement.style.setProperty("--ui-brightness", String(clamped));
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function isCoarsePointer(): boolean {
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
}
