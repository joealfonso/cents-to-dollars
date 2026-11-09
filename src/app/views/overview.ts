// Overview, #/ (DESIGN.md 3.1). Phase A: first-visit theme choice, page header, Technical checks with the
// no-mic fields, and the Not built yet panel. "Start singing" goes to #/voice; Phase B makes it start the mic
// inside the click (live.start({ owner: 'voice' })) before changing the hash.

import type { Route } from '../router.ts';
import { fieldRow, repaintFields, runPassiveChecks, type FieldName } from '../fields.ts';
import { hasChosenTheme, setTheme } from '../theme.ts';
import { live } from '../live.ts';
import '../../styles/overview.css';

const CHECKS: FieldName[] = ['mic-permission', 'browser-audio', 'secure', 'a4', 'calibration', 'latency', 'selftest'];

const NOT_BUILT: [title: string, desc: string][] = [
  ['Aural skills', 'Interval recognition and pitch matching'],
  ['Source separation', 'Isolate the voice from the accompaniment'],
  ['Repertoire register', 'Works, language, key and study status'],
  ['Sessions', 'Saved takes and notes'],
];

// More tools (M2-DESIGN.md 1.5): built tools other than Voice analysis, as link rows. Interval recognition and
// Sung exercises join this list when their routes exist; until then they stay out (and Aural skills stays in
// Not built yet), so no row links to Not found.
const MORE_TOOLS: [title: string, desc: string, href: string][] = [
  ['Open a recording', 'Pitch, cents, vibrato and spectrogram of an audio file, analysed in this browser.', '#/file'],
];

const FEATURES: [title: string, desc: string][] = [
  ['The note you are on', 'The nearest note, large enough to read from across the room, and how many cents sharp or flat you are. 100 cents is one half step.'],
  ['Your vibrato', 'How many times a second your pitch swings, and how wide the swing is.'],
  ['Your ring', 'How much of your sound sits between 2.5 and 3.5 kHz, where the ring of a trained voice often shows up, so you can watch it change as you adjust.'],
  ['A picture of your sound', 'A scrolling chart of your voice with your pitch marked on it, so you can see what the numbers mean.'],
];

const STEPS: [title: string, desc: string][] = [
  ['Start the microphone', 'Press Start singing, then choose Allow when your browser asks.'],
  ['Sing a steady note', 'The note and the flat or sharp reading follow you as you sing. Hold a note for a couple of seconds to see your vibrato.'],
  ['Match your tuning', 'If your piano or ensemble tunes above or below A4 = 440 Hz, change the tuning reference. Every note and cent follows it.'],
  ['Stop when you are done', 'Nothing was recorded, so there is nothing to delete.'],
  ['New mic or computer?', 'Run the setup checks once. They tell you how accurate and how delayed your setup is.'],
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
      <a class="link ov-setup-link" href="#/methods">Setup checks</a>
    </div>
  </header>

  <section class="panel ov-features" aria-labelledby="ov-what-title">
    <div class="strip"><h2 class="strip-title" id="ov-what-title">What it shows you</h2></div>
    <ul class="ov-feature-grid" role="list">
      ${FEATURES.map(([t, d]) => `
      <li class="ov-feature" role="listitem"><h3 class="ov-feature-title">${t}</h3><p class="ov-feature-desc">${d}</p></li>`).join('')}
    </ul>
  </section>

  <div class="grid-12 ov-use">
    <section class="panel col-7" aria-labelledby="ov-how-title">
      <div class="strip"><h2 class="strip-title" id="ov-how-title">How to use it</h2></div>
      <ol class="ov-steps" role="list">
        ${STEPS.map(([t, d], i) => `
        <li class="ov-step" role="listitem"><span class="ov-step-no" aria-hidden="true">${i + 1}</span><span class="ov-step-title">${t}</span><span class="ov-step-desc">${d}</span></li>`).join('')}
      </ol>
    </section>

    <section class="col-5 ov-good" aria-labelledby="ov-good-title">
      <h2 class="ov-good-title" id="ov-good-title">Good to know</h2>
      <dl class="ov-notes">
        <div class="ov-note"><dt>Private</dt><dd>Your voice is measured in this browser and thrown away. Nothing is saved or uploaded.</dd></div>
        <div class="ov-note"><dt>Close, not perfect</dt><dd>The live reading can jump an octave for a moment. If a note looks an octave off, trust your ear and check the picture.</dd></div>
        <div class="ov-note"><dt>For practice and study</dt><dd>Not a diagnostic or medical device.</dd></div>
      </dl>
      <p class="ov-more"><a class="link" href="#/about">How it works, and how it is tested <span class="arrow" aria-hidden="true">→</span></a></p>
    </section>
  </div>

  <div class="ov-ref-head">
    <h2 class="label">Setup and roadmap</h2>
  </div>
  <div class="grid-12 ov-ref">
    <details class="panel disclosure col-7" id="ov-checks">
      <summary>Technical checks</summary>
      <dl class="kv-list">${CHECKS.map(fieldRow).join('')}</dl>
    </details>

    <div class="col-5 ov-side">
    <section class="panel" aria-labelledby="ov-more-title">
      <div class="strip"><h2 class="strip-title" id="ov-more-title">More tools</h2></div>
      <ul class="rows" role="list">
        ${MORE_TOOLS.map(([t, d, href]) => `
        <li class="row" role="listitem">
          <a class="row-title link" href="${href}">${t}</a>
          <span class="row-desc">${d}</span>
        </li>`).join('')}
      </ul>
    </section>

    <section class="panel" aria-labelledby="ov-notbuilt-title">
      <div class="strip"><h2 class="strip-title" id="ov-notbuilt-title">Not built yet</h2></div>
      <ul class="rows" role="list">
        ${NOT_BUILT.map(([t, d]) => `
        <li class="row" role="listitem" data-built="false">
          <span class="row-title">${t}</span>
          <span class="row-status"><span class="dot" aria-hidden="true"></span><span class="tag-notbuilt">Not built yet</span></span>
          <span class="row-desc">${d}</span>
        </li>`).join('')}
      </ul>
    </section>
    </div>
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

  // Start the mic inside the click, so the permission prompt is tied to the gesture, then go to Voice analysis.
  root.querySelector('#ov-start')?.addEventListener('click', () => {
    void live.start({ owner: 'voice' });
    location.hash = '#/voice';
  });

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
