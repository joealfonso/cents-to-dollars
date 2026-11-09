// Methods, #/methods and #/methods/{calibration,latency,self-test} (DESIGN.md 3.4). Phase A placeholder:
// the checks still run on the test page. Phase C adds the result blocks, deep links and a leave hook.

import type { Route } from '../router.ts';

const html = `
<div class="shell route">
  <header class="page-header">
    <div class="ph-text">
      <p class="eyebrow">Setup</p>
      <h1 id="methods-title" tabindex="-1">Methods and setup checks</h1>
      <p class="lede">Run these once on a new microphone, interface or computer. You do not need them to sing.</p>
    </div>
  </header>
  <section class="panel" aria-labelledby="methods-ph-title">
    <div class="strip"><h2 class="strip-title" id="methods-ph-title">Not built yet</h2></div>
    <div class="pbody">
      <p class="prose">The calibration, loopback latency and self-test checks are moving here. Until then, run them on the test page. The self-test needs the dev server.</p>
      <p><a class="btn btn-primary" href="#/legacy">Open the test page <span class="arrow" aria-hidden="true">→</span></a></p>
    </div>
  </section>
</div>`;

export function methodsRoute(root: HTMLElement): Route {
  root.innerHTML = html;
  root.setAttribute('aria-labelledby', 'methods-title');
  return { title: 'Methods', nav: 'methods' };
}
