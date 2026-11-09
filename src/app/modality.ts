// Input modality (DESIGN.md 3.6, "Route focus"). Sets html[data-modality] to "keyboard" on a keydown (not a lone
// modifier) and "pointer" on a pointerdown. Starts as "pointer", so a page load or a script navigation never shows
// the ring on a programmatically focused heading. app.css reads it; the browser's :focus-visible guess is not used
// for those headings, because Chrome treats script focus with no prior pointer event as keyboard focus.

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta']);

export function initModality(doc: Document = document): void {
  const root = doc.documentElement;
  root.dataset.modality = 'pointer';
  const opts = { capture: true, passive: true } as const;
  doc.addEventListener('keydown', (e) => {
    if (MODIFIERS.has(e.key)) return;
    if (root.dataset.modality !== 'keyboard') root.dataset.modality = 'keyboard';
  }, opts);
  doc.addEventListener('pointerdown', () => {
    if (root.dataset.modality !== 'pointer') root.dataset.modality = 'pointer';
  }, opts);
}
