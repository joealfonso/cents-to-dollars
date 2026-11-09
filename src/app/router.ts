// Hash router (DESIGN.md 3, 5, 6.5). One <section data-route="..."> per route, all in index.html.
// On a hash change it takes a navigation number, awaits the current route's leave hook, and shows the new
// route only if no newer navigation started meanwhile. Then it sets the title, the nav marker and focuses h1.

export type RouteName = 'overview' | 'tools' | 'voice' | 'methods' | 'notfound' | 'legacy';

export interface Route {
  /** document.title. Overview is the bare app name. */
  title: string;
  /** Nav item marked aria-current="page" while this route shows, if any. */
  nav?: 'overview' | 'tools' | 'methods';
  /** Runs before the route is shown. `sub` is the rest of the path, for example "self-test" in #/methods/self-test. */
  enter?: (sub: string) => void | Promise<void>;
  /** Runs before another route is shown. The old route stays visible until it settles. */
  leave?: () => Promise<void>;
}

export const APP_NAME = 'Cents to Dollars';

const PATHS: Record<string, RouteName> = {
  '': 'overview',
  tools: 'tools',
  voice: 'voice',
  methods: 'methods',
  legacy: 'legacy',
};

/** "#/methods/self-test" -> { name: 'methods', sub: 'self-test' }. Anything unknown is notfound. */
export function parseHash(hash: string): { name: RouteName; sub: string } {
  if (hash === '' || hash === '#') return { name: 'overview', sub: '' };
  if (!hash.startsWith('#/')) return { name: 'notfound', sub: '' };
  const [head = '', ...rest] = hash.slice(2).replace(/\/+$/, '').split('/');
  const name = PATHS[head];
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
    leaving = hook()
      .catch((e) => console.error('route leave failed', e))
      .finally(() => { leaving = null; });
    return leaving;
  }

  async function go(focus: boolean) {
    const nav = ++navSeq;
    const { name, sub } = parseHash(location.hash);
    if (name !== current) {
      await leaveCurrent();
      if (nav !== navSeq) return; // a faster second navigation wins
    }
    const route = routes[name];
    try {
      await route.enter?.(sub);
    } catch (e) {
      console.error('route enter failed', e);
    }
    if (nav !== navSeq) return;
    const changed = name !== current;
    if (changed) {
      if (current) { const old = section(current); if (old) old.hidden = true; }
      const next = section(name);
      if (next) next.hidden = false;
      current = name;
      document.title = name === 'overview' ? APP_NAME : `${route.title} | ${APP_NAME}`;
      for (const a of document.querySelectorAll<HTMLElement>('[data-nav]')) {
        if (a.dataset.nav === route.nav) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      }
      window.scrollTo(0, 0);
    }
    if (focus) heading(name)?.focus({ preventScroll: true });
  }

  return {
    start() {
      window.addEventListener('hashchange', () => void go(true));
      void go(false); // first load: no focus move, the page starts at the top
    },
    /** The route on screen now. */
    get current() { return current; },
    /** Focuses the visible route's h1 (used by the skip link). */
    focusHeading() { if (current) heading(current)?.focus(); },
  };
}
