// #/legacy (DESIGN.md 3.5, 6.5): the M1 test page, kept until Phase C passes. Its markup is static in
// index.html under <section data-route="legacy">, with its original IDs. The script loads on the first visit
// through a dynamic import, so its top-level wiring runs only once. Leaving awaits its stopLive().

import type { Route } from '../router.ts';

type LegacyModule = typeof import('../../testpage/main.ts');
let mod: Promise<LegacyModule> | null = null;

export function legacyRoute(root: HTMLElement): Route {
  return {
    title: 'Test page',
    async enter() {
      if (!mod) {
        root.setAttribute('aria-busy', 'true');
        mod = import('../../testpage/main.ts');
      }
      try {
        await mod;
      } catch (e) {
        console.error('legacy test page failed to load', e);
        showError(root);
      } finally {
        root.removeAttribute('aria-busy');
      }
    },
    async leave() {
      if (!mod) return;
      const m = await mod.catch(() => null);
      await m?.stopLive();
    },
  };
}

function showError(root: HTMLElement) {
  if (root.querySelector('#legacy-error')) return;
  const p = document.createElement('p');
  p.id = 'legacy-error';
  p.className = 'legacy-error';
  p.setAttribute('role', 'alert');
  p.textContent = 'The test page could not load. Reload the page to try again. The browser console has the details.';
  root.prepend(p);
}
