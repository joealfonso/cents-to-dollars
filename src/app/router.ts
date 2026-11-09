// Hash router (DESIGN.md 3, 5, 6.5). One <section data-route="..."> per route, all in index.html.
// On a hash change it takes a navigation number, awaits the current route's leave hook, and shows the new
// route only if no newer navigation started meanwhile. Then it sets the title, the nav marker and focuses h1.
// Screen changes run inside a view transition where the browser supports one (styles in app.css).

export type RouteName = 'overview' | 'tools' | 'voice' | 'methods' | 'about' | 'notfound' | 'legacy';

export interface Route {
  /** document.title. Overview is the bare app name. */
  title: string;
  /** Nav item marked aria-current="page" while this route shows, if any. */
  nav?: 'overview' | 'tools' | 'methods' | 'about';
  /** Runs before the route is shown. `sub` is the rest of the path, for example "self-test" in #/methods/self-test. */
  enter?: (sub: string) => void | Promise<void>;
  /** Runs before another route is shown. The old route stays visible until it settles. */
  leave?: () => Promise<void>;
  /**
   * An element inside the route for `sub` (a Methods deep link). If it returns one, the router scrolls to it,
   * and focuses it instead of the h1 when it would focus the h1.
   */
  focusTarget?: (sub: string) => HTMLElement | null;
}

export const APP_NAME = 'Cents to Dollars';

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

const PATHS: Record<string, RouteName> = {
  '': 'overview',
  tools: 'tools',
  voice: 'voice',
  methods: 'methods',
  about: 'about',
  legacy: 'legacy',
};

/** "#/methods/self-test" -> { name: 'methods', sub: 'self-test' }. Anything unknown is notfound. */
export function parseHash(hash: string): { name: RouteName; sub: string } {
  if (hash === '' || hash === '#') return { name: 'overview', sub: '' };
  if (!hash.startsWith('#/')) return { name: 'notfound', sub: '' };
  const [head = '', ...rest] = hash.slice(2).replace(/\/+$/, '').split('/');
  // Own keys only: "#/constructor" or "#/__proto__" must not resolve to Object.prototype members.
  const name = hasOwn(PATHS, head) ? PATHS[head] : undefined;
  if (!name) return { name: 'notfound', sub: '' };
  if (name === 'methods') return { name, sub: rest.join('/') };
  return rest.length ? { name: 'notfound', sub: '' } : { name, sub: '' };
}

export function createRouter(routes: Record<RouteName, Route>) {
  let current: RouteName | null = null;
  let navSeq = 0;
  let leaving: Promise<void> | null = null; // shared, so a second navigation does not run the hook twice

  function section(name: RouteName) {
    return document.querySelector<HTMLElement>(`[data-route="${name}"]`);
  }

  function heading(name: RouteName) {
    const h1 = section(name)?.querySelector<HTMLElement>('h1');
    if (h1 && !h1.hasAttribute('tabindex')) h1.tabIndex = -1;
    return h1;
  }

  function leaveCurrent(): Promise<void> {
    if (leaving) return leaving;
    const hook = current ? routes[current].leave : undefined;
    if (!hook) return Promise.resolve();
    // Promise.resolve().then(hook) also catches a hook that throws synchronously, so the route still changes.
    leaving = Promise.resolve()
      .then(hook)
      .catch((e) => console.error('route leave failed', e))
      .finally(() => { leaving = null; });
    return leaving;
  }

  async function go(focus: boolean) {
    const nav = ++navSeq;
    let name: RouteName = 'notfound';
    let sub = '';
    let route: Route = routes.notfound;
    try {
      const parsed = parseHash(location.hash);
      if (hasOwn(routes, parsed.name)) ({ name, sub } = parsed);
      route = routes[name];
    } catch (e) {
      console.error('route lookup failed', e);
      name = 'notfound'; sub = ''; route = routes.notfound;
    }
    if (name !== current) {
      await leaveCurrent();
      if (nav !== navSeq) return; // a faster second navigation wins
    }
    try {
      await route.enter?.(sub);
    } catch (e) {
      console.error('route enter failed', e);
    }
    if (nav !== navSeq) return;
    const previous = current;
    if (name !== previous) {
      // `current` moves now so a navigation that starts mid-animation sees the right route to leave.
      current = name;
      if (previous && canAnimate()) {
        const vt = document.startViewTransition(render);
        // A newer navigation (or a hidden tab) skips the animation; the DOM update still runs, so nothing is lost.
        vt.ready.catch(() => {});
        vt.finished.catch(() => {});
        try { await vt.updateCallbackDone; } catch (e) { console.error('route render failed', e); }
        if (nav !== navSeq) return;
      } else {
        render();
      }
    }
    const target = route.focusTarget?.(sub) ?? null;
    if (target) {
      target.scrollIntoView({ block: 'start' });
      if (focus) target.focus({ preventScroll: true });
    } else if (focus) {
      // Same route, no target (the Methods nav link while on #/methods/self-test): nothing rendered, so nothing
      // scrolled. Go to the top and let the focus move scroll the h1 into view.
      if (name === previous) {
        window.scrollTo(0, 0);
        heading(name)?.focus();
      } else heading(name)?.focus({ preventScroll: true });
    }
  }

  /**
   * Cross-fades screens with the View Transitions API where it exists. Skipped under reduced motion (the
   * theme sets those durations to 0ms, so it would only block clicks) and when the harness sets data-motion="off".
   */
  function canAnimate() {
    return typeof document.startViewTransition === 'function'
      && document.documentElement.dataset.motion !== 'off'
      && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Shows whatever route is `current` when it runs. Reading `current` here (not a captured name) keeps the
   * page right even when two transitions overlap and their update callbacks run out of order.
   */
  function render() {
    if (!current) return;
    const route = routes[current];
    for (const n of Object.keys(routes) as RouteName[]) {
      const s = section(n);
      if (s) s.hidden = n !== current;
    }
    document.title = current === 'overview' ? APP_NAME : `${route.title} | ${APP_NAME}`;
    for (const a of document.querySelectorAll<HTMLElement>('[data-nav]')) {
      if (a.dataset.nav === route.nav) {
        a.setAttribute('aria-current', 'page');
        // On compact screens the nav row scrolls sideways; keep the current item in view.
        a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } else a.removeAttribute('aria-current');
    }
    window.scrollTo(0, 0);
  }

  return {
    start() {
      window.addEventListener('hashchange', () => void go(true));
      // On compact screens the nav row scrolls sideways. The browser leaves a half-visible link where it is on
      // focus, which clips its ring; scroll-padding-inline on the list makes this leave room for the ring.
      document.querySelector('.nav ul')?.addEventListener('focusin', (e) => {
        if (e.target instanceof HTMLElement) e.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
      void go(false); // first load: no focus move, the page starts at the top
    },
    /** The route on screen now. */
    get current() { return current; },
    /** Focuses the visible route's h1 (used by the skip link). */
    focusHeading() { if (current) heading(current)?.focus(); },
  };
}
