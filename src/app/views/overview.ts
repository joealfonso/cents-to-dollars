// Overview, #/ (DESIGN.md 3.1). Phase A: page header, Technical checks with the
// no-mic fields, and the Not built yet panel. "Start singing" goes to #/voice; Phase B makes it start the mic
// inside the click (live.start({ owner: 'voice' })) before changing the hash.

import type { Route } from '../router.ts';
import { fieldRow, repaintFields, runPassiveChecks, type FieldName } from '../fields.ts';
import { live } from '../live.ts';
import '../../styles/overview.css';

const CHECKS: FieldName[] = ['mic-permission', 'browser-audio', 'secure', 'a4', 'calibration', 'latency', 'selftest'];

const NOT_BUILT: [title: string, desc: string][] = [
  ['Aural skills', 'Interval recognition and pitch matching'],
  ['Source separation', 'Isolate the voice from the accompaniment'],
  ['Repertoire register', 'Works, language, key and study status'],
  ['Sessions', 'Saved takes and notes'],
];

// M2-DESIGN.md 1.5: link rows to the other built tools. Interval recognition and Sung exercises join this list
// when they are built.
const MORE_TOOLS: [title: string, href: string, desc: string][] = [
  ['Open a recording', '#/file', 'Pitch, cents, vibrato and spectrogram of an audio file from this computer'],
];

const FEATURES: [title: string, desc: string][] = [
  ['The note you are on', 'The nearest note, large enough to read from across the room, and how many cents sharp or flat you are. 100 cents is one half step.'],
  ['Your vibrato', 'How many times a second your pitch swings, and how wide the swing is.'],
  ['Your ring', 'How much of your sound sits between 2.5 and 3.5 kHz, where the ring of a trained voice often shows up, so you can watch it change as you adjust.'],
  ['A picture of your sound', 'A scrolling chart of your voice with your pitch marked on it, so you can see what the numbers mean.'],
];

const STEPS: [title: string, desc: string][] = [
  ['Start listening', 'Press Start singing, then choose Allow when your browser asks to listen.'],
  ['Sing a steady note', 'The note and the flat or sharp reading follow you as you sing. Hold a note for a couple of seconds to see your vibrato.'],
  ['Match your tuning', 'If your piano or ensemble tunes above or below A4 = 440 Hz, change the tuning reference. Every note and cent follows it.'],
  ['Stop when you are done', 'Nothing was recorded, so there is nothing to delete.'],
  ['New laptop, phone or room?', 'Run the setup checks once. They tell you how accurately and how quickly the app hears you there.'],
];

// Order at every width (3.6): page header with the one primary action; What it shows you; How to use it (open at
// 600 and up, data-open-wide) beside Good to know; then Setup and roadmap: Technical checks and Not built yet as
// disclosure rows, and More tools (M2-DESIGN.md 1.5) beside them. Sections are ruled, not boxed (1.10).
const html = `
<div class="shell route ov-route">
  <header class="page-header">
    <div class="ph-text">
      <h1 id="ov-title" tabindex="-1">Cents to Dollars</h1>
      <p class="lede">See the note you are singing, how many cents sharp or flat you are, and your vibrato. Runs in this browser; audio is not saved or uploaded.</p>
    </div>
    <div class="ph-action">
      <button type="button" class="btn btn-primary" id="ov-start">Start singing</button>
      <p class="ov-setup"><a class="link link-hit ov-setup-link" href="#/methods">Setup checks</a></p>
    </div>
  </header>

  <section class="sec ov-features" aria-labelledby="ov-what-title">
    <header class="sec-head"><h2 class="sec-title" id="ov-what-title">What it shows you</h2></header>
    <ul class="ov-feature-grid" role="list">
      ${FEATURES.map(([t, d]) => `
      <li class="ov-feature" role="listitem"><h3 class="ov-feature-title">${t}</h3><p class="ov-feature-desc">${d}</p></li>`).join('')}
    </ul>
  </section>

  <div class="sec-grid ov-use">
    <details class="disclosure ov-how col-7" id="ov-how" data-open-wide>
      <summary>How to use it</summary>
      <ol class="ov-steps" role="list">
        ${STEPS.map(([t, d], i) => `
        <li class="ov-step" role="listitem"><span class="ov-step-no" aria-hidden="true">${i + 1}</span><span class="ov-step-title">${t}</span><span class="ov-step-desc">${d}</span></li>`).join('')}
      </ol>
    </details>

    <section class="sec col-5 ov-good" aria-labelledby="ov-good-title">
      <header class="sec-head"><h2 class="sec-title" id="ov-good-title">Good to know</h2></header>
      <dl class="ov-notes">
        <div class="ov-note"><dt>Private</dt><dd>Your voice is measured in this browser and thrown away. Nothing is saved or uploaded.</dd></div>
        <div class="ov-note"><dt>Close, not perfect</dt><dd>The live reading can jump an octave for a moment. If a note looks an octave off, trust your ear and check the picture.</dd></div>
      </dl>
      <p class="ov-more"><a class="link link-hit" href="#/about">How it works, and how it is tested <span class="arrow" aria-hidden="true">→</span></a></p>
    </section>
  </div>

  <section class="ov-ref" aria-labelledby="ov-ref-title">
    <h2 class="group-label ov-ref-label" id="ov-ref-title">Setup and roadmap</h2>
    <div class="sec-grid ov-ref-grid">
      <div class="col-7 ov-ref-rows">
        <details class="disclosure" id="ov-checks">
          <summary>Technical checks</summary>
          <dl class="kv-list">${CHECKS.map(fieldRow).join('')}</dl>
        </details>
        <details class="disclosure ov-notbuilt" id="ov-notbuilt" data-open-wide>
          <summary>Not built yet</summary>
          <ul class="ov-names" role="list">
            ${NOT_BUILT.map(([t, d]) => `
            <li class="ov-name" role="listitem"><span class="ov-name-title">${t}</span> <span class="ov-name-desc">${d}</span></li>`).join('')}
          </ul>
        </details>
      </div>
      <div class="col-5 ov-side">
        <h3 class="ov-side-title">More tools</h3>
        <ul class="ov-links" role="list">
          ${MORE_TOOLS.map(([t, href, d]) => `
          <li class="ov-link" role="listitem">
            <a class="link link-hit" href="${href}">${t}</a>
            <span class="ov-link-desc">${d}</span>
          </li>`).join('')}
        </ul>
      </div>
    </div>
  </section>
</div>`;

export function overviewRoute(root: HTMLElement): Route {
  root.innerHTML = html;
  root.setAttribute('aria-labelledby', 'ov-title');

  // Start the mic inside the click, so the permission prompt is tied to the gesture, then go to Voice analysis.
  root.querySelector('#ov-start')?.addEventListener('click', () => {
    void live.start({ owner: 'voice' });
    location.hash = '#/voice';
  });

  return {
    title: 'Overview',
    nav: 'overview',
    enter() {
      runPassiveChecks();
      repaintFields(root);
    },
  };
}
