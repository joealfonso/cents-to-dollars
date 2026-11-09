// Not found (DESIGN.md 3.5).

import type { Route } from '../router.ts';

const html = `
<div class="shell route">
  <header class="page-header">
    <div class="ph-text">
      <h1 id="nf-title" tabindex="-1">Page not found</h1>
      <p class="lede">There is no page at this address.</p>
    </div>
    <div class="ph-action"><a class="btn btn-primary" href="#/">Go to Overview</a></div>
  </header>
</div>`;

export function notFoundRoute(root: HTMLElement): Route {
  root.innerHTML = html;
  root.setAttribute('aria-labelledby', 'nf-title');
  return { title: 'Page not found' };
}
