// Theme: Paper only (DESIGN.md 1.2a). <html data-theme="editorial"> is in the markup; initTheme() re-applies it
// and clears the key the old theme switch saved. The Loud tokens and CSS stay in the codebase, dormant.

export type Theme = 'editorial' | 'loud';

const KEY = 'centstodollars.theme';
const isTheme = (v: unknown): v is Theme => v === 'editorial' || v === 'loud';

export function currentTheme(): Theme {
  const v = document.documentElement.dataset.theme;
  return isTheme(v) ? v : 'editorial';
}

/** Sets Paper and forgets any saved theme. Call once. Storage errors are ignored, with no message. */
export function initTheme(): void {
  document.documentElement.dataset.theme = 'editorial';
  try { localStorage.removeItem(KEY); } catch { /* nothing reads the key any more */ }
}
