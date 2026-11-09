// Compact navigation (DESIGN.md 2.1a). Under 600px the Nav button (#nav-toggle) discloses #site-nav as an in-flow panel.
// aria-expanded on the button is the only state; app.css shows the panel from it. No focus trap, no scroll lock.

// Same query as the compact header in app.css: under 600px, and phone landscape at any width (DESIGN.md 3.6).
const COMPACT = '(max-width: 599px), (orientation: landscape) and (max-height: 500px)';

export function initNav({ focusHeading }: { focusHeading: () => void }): void {
  const toggle = document.getElementById('nav-toggle');
  const nav = document.getElementById('site-nav');
  if (!toggle || !nav) return;

  const compact = window.matchMedia?.(COMPACT);
  const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';
  // While closed at compact the panel stays rendered at zero height (DESIGN.md 1.7a pattern A). inert takes its
  // links out of the tab order and the accessibility tree from the first frame of a close; CSS adds
  // visibility: hidden once the exit ends. At 600px and up the nav is always shown, so it is never inert there.
  const sync = () => { nav.inert = !!compact?.matches && !isOpen(); };
  // `rescueFocus` is false on the link-tap path, where the router or focusHeading moves focus next. Otherwise, if focus
  // is inside the panel when it closes, inert would drop it to <body>, so it goes to the button first.
  const setOpen = (open: boolean, rescueFocus = true) => {
    if (!open && rescueFocus && nav.contains(document.activeElement) && toggle.getClientRects().length > 0) toggle.focus();
    toggle.setAttribute('aria-expanded', String(open));
    sync();
  };
  sync();

  // A <button>, so Enter and Space arrive here as a click. Focus stays on the button.
  toggle.addEventListener('click', () => setOpen(!isOpen()));

  // Escape closes only while focus is on the button or inside the panel.
  const onEscape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !isOpen()) return;
    setOpen(false);
    toggle.focus();
  };
  toggle.addEventListener('keydown', onEscape);
  nav.addEventListener('keydown', onEscape);

  // A panel link closes the panel. A new route focuses its own h1 (router); the current page's link causes
  // no hashchange, so focus goes to the h1 here instead of staying on a link that is about to be hidden.
  nav.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!a || !isOpen()) return;
    // Modified clicks open a tab or window or download; the page does not navigate, so the panel stays.
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button > 0) return;
    // Instant close (1.7a): the route transition is the motion. Transitions are off while the closed style is
    // applied, then back on; reading layout in between commits the closed style with no transition.
    nav.setAttribute('data-close', 'instant');
    setOpen(false, false);
    void nav.offsetHeight;
    nav.setAttribute('data-close', '');
    if (a.hash === location.hash) focusHeading();
  });

  // A click anywhere else closes it. Not cancelled: nothing is covered, so the click still lands.
  document.addEventListener('click', (e) => {
    if (!isOpen() || !(e.target instanceof Node)) return;
    if (toggle.contains(e.target) || nav.contains(e.target)) return;
    setOpen(false);
  });

  // Any route change (Back, "Start singing", a deep link) closes it and leaves focus alone.
  window.addEventListener('hashchange', () => setOpen(false));

  // Crossing the breakpoint either way starts closed.
  compact?.addEventListener('change', () => setOpen(false));
}
