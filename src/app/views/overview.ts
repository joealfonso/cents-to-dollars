// Overview, #/ (DESIGN.md 3.1). Phase A: first-visit theme choice, page header, Technical checks with the
// no-mic fields, and the Not built yet panel. "Start singing" goes to #/voice; Phase B makes it start the mic
// inside the click (live.start({ owner: 'voice' })) before changing the hash.

import type { Route } from '../router.ts';
import { fieldRow, repaintFields, runPassiveChecks, type FieldName } from '../fields.ts';
import { hasChosenTheme, setTheme } from '../theme.ts';

const CHECKS: FieldName[] = ['mic-permission', 'browser-audio', 'secure', 'a4', 'calibration', 'latency', 'selftest'];

const NOT_BUILT: [title: string, desc: string][] = [
  ['Aural skills', 'Interval recognition and pitch matching'],
  ['Source separation', 'Isolate the voice from the accompaniment'],
  ['Repertoire register', 'Works, language, key and study status'],
  ['Sessions', 'Saved takes and notes'],
];

const html = `
<div class="shell route">
  <section class="panel theme-choice" id="theme-choice" aria-labelledby="theme-choice-title" hidden>
    <div class="strip"><h2 class="strip-title" id="theme-choice-title">How should it look?</h2></div>
    <div class="pbody">
      <p class="choice-text">Paper is calm, for reading. Loud is big, for singing across the room.</p>
      <p class="choice-actions">
        <button type="button" class="btn btn-ghost" data-choose="editorial">Keep Paper</button>
        <button type="button" class="btn btn-ghost" data-choose="loud">Switch to Loud</button>
      </p>
    </div>
  </section>

  <header class="page-header">
    <div class="ph-text">
      <h1 id="ov-title" tabindex="-1">Cents to Dollars</h1>
      <p class="lede">See the note you are singing, how many cents sharp or flat you are, and your vibrato. Runs in this browser; audio is not saved or uploaded.</p>
    </div>
    <div class="ph-action">
      <button type="button" class="btn btn-primary" id="ov-start">Start singing</button>
      <a class="link" href="#/methods">Setup checks</a>
    </div>
  </header>

  <div class="grid-12">
    <details class="panel disclosure col-7" id="ov-checks">
      <summary>Technical checks</summary>
      <dl class="kv-list">${CHECKS.map(fieldRow).join('')}</dl>
    </details>

    <section class="panel col-5" aria-labelledby="ov-notbuilt-title">
      <div class="strip"><h2 class="strip-title" id="ov-notbuilt-title">Not built yet</h2></div>
      <ul class="rows">
        ${NOT_BUILT.map(([t, d]) => `
        <li class="row" data-built="false">
          <span class="row-title">${t}</span>
          <span class="row-status"><span class="dot" aria-hidden="true"></span><span class="tag-notbuilt">Not built yet</span></span>
          <span class="row-desc">${d}</span>
        </li>`).join('')}
      </ul>
    </section>
  </div>
</div>`;

function syncChoice(root: HTMLElement) {
  const panel = root.querySelector<HTMLElement>('#theme-choice');
  if (panel) panel.hidden = hasChosenTheme();
}

export function overviewRoute(root: HTMLElement): Route {
  root.innerHTML = html;
  root.setAttribute('aria-labelledby', 'ov-title');

  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-choose]')) {
    b.addEventListener('click', () => {
      setTheme(b.dataset.choose === 'loud' ? 'loud' : 'editorial');
      syncChoice(root);
      root.querySelector<HTMLElement>('#ov-title')?.focus(); // the focused button is gone; keep focus on the page
    });
  }
  // A pick in the header switch also counts as the choice.
  document.addEventListener('themechange', () => syncChoice(root));

  root.querySelector('#ov-start')?.addEventListener('click', () => { location.hash = '#/voice'; });

  return {
    title: 'Overview',
    nav: 'overview',
    enter() {
      syncChoice(root);
      runPassiveChecks();
      repaintFields(root);
    },
  };
}
