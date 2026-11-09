// Theme: data-theme on <html>, saved in localStorage, announced with a 'themechange' event (DESIGN.md 1.2).
// The inline script in index.html applies the saved theme before first paint; this module keeps it in sync.

export type Theme = 'editorial' | 'loud';

const KEY = 'centstodollars.theme';
const isTheme = (v: unknown): v is Theme => v === 'editorial' || v === 'loud';

/** The saved theme, or null when nothing valid is saved or storage cannot be read. */
export function storedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return isTheme(v) ? v : null;
  } catch {
    return null;
  }
}

/** True once she has picked a theme, this visit or before. Storage errors still count a pick for the visit. */
let pickedThisVisit = false;
export function hasChosenTheme(): boolean {
  return pickedThisVisit || storedTheme() !== null;
}

export function currentTheme(): Theme {
  const v = document.documentElement.dataset.theme;
  return isTheme(v) ? v : 'editorial';
}

/** Applies and saves a theme. Storage errors are ignored: the theme still holds for this visit. */
export function setTheme(theme: Theme): void {
  pickedThisVisit = true;
  try { localStorage.setItem(KEY, theme); } catch { /* keep working for the visit, no message */ }
  const changed = currentTheme() !== theme;
  document.documentElement.dataset.theme = theme;
  syncSwitch();
  if (changed) document.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
}

function radios(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>('#theme-switch input[name="theme"]')];
}

function syncSwitch() {
  const t = currentTheme();
  for (const r of radios()) r.checked = r.value === t;
}

/** Wires the header switch. Call once. */
export function initTheme(): void {
  // The head script already set data-theme; re-apply here so an unknown attribute value falls back to Paper.
  document.documentElement.dataset.theme = storedTheme() ?? currentTheme();
  syncSwitch();
  for (const r of radios()) {
    r.addEventListener('change', () => { if (r.checked && isTheme(r.value)) setTheme(r.value); });
  }
}
