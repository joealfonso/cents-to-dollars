// Voice analysis, #/voice (DESIGN.md 3.3). Phase A placeholder: the live readout is still on the test page.
// Phase B replaces this with the hero, spectrogram, Readings and Setup, and adds a leave hook (await live.stop()).

import type { Route } from '../router.ts';

const html = `
<div class="shell route">
  <header class="page-header">
    <div class="ph-text">
      <p class="eyebrow"><a class="link" href="#/tools">Tools</a> / Voice analysis</p>
      <h1 id="va-title" tabindex="-1">Voice analysis</h1>
    </div>
  </header>
  <section class="panel" aria-labelledby="va-ph-title">
    <div class="strip"><h2 class="strip-title" id="va-ph-title">Not built yet</h2></div>
    <div class="pbody">
      <p class="prose">This screen is being built. Until it is ready, the live pitch readout is on the test page.</p>
      <p><a class="btn btn-primary" href="#/legacy">Open the test page <span class="arrow" aria-hidden="true">→</span></a></p>
    </div>
  </section>
</div>`;

export function voiceRoute(root: HTMLElement): Route {
  root.innerHTML = html;
  root.setAttribute('aria-labelledby', 'va-title');
  return { title: 'Voice analysis', nav: 'tools' };
}
