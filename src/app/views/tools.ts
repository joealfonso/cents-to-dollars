// Tools, #/tools (DESIGN.md 3.2, CUTTABLE). Index table plus a detail panel for Voice analysis.
// Unbuilt tools are muted "Not built yet" rows with no links.

import type { Route } from '../router.ts';
import { fieldRow, getField, repaintFields, runPassiveChecks } from '../fields.ts';
import { DEFAULT_YIN } from '../../dsp/yin.ts';

interface Tool { no: string; name: string; desc: string; input: string; href?: string }

const TOOLS: Tool[] = [
  { no: '01', name: 'Voice analysis', desc: 'Note, cents sharp or flat, vibrato and spectrogram from the microphone', input: 'Microphone', href: '#/voice' },
  { no: '02', name: 'Aural skills', desc: 'Interval recognition and pitch matching', input: 'Audio output' },
  { no: '03', name: 'Source separation', desc: 'Isolate the voice from the accompaniment', input: 'Audio file' },
  { no: '04', name: 'Repertoire register', desc: 'Works, language, key and study status', input: 'None' },
];

function row(t: Tool): string {
  const built = !!t.href;
  const name = built
    ? `<a class="irow-link" href="${t.href}">${t.name}</a>`
    : t.name;
  // Voice analysis readiness comes from the secure-page and browser-audio checks (voiceStatus below).
  const status = built
    ? `<span class="dot" aria-hidden="true" data-va-dot></span><span data-va-status>Checking…</span>`
    : `<span class="dot" aria-hidden="true"></span><span class="tag-notbuilt">Not built yet</span>`;
  return `
  <div role="row" data-built="${built}"${t.no === '01' ? ' data-selected' : ''}>
    <span role="cell" class="ino">${t.no}</span>
    <span role="cell" class="iname">${name}</span>
    <span role="cell" class="idesc">${t.desc}</span>
    <span role="cell" class="iinput"><span class="ck">Input</span>${t.input}</span>
    <span role="cell"><span class="istatus">${status}</span></span>
  </div>`;
}

const html = `
<div class="shell route">
  <header class="page-header">
    <div class="ph-text">
      <p class="eyebrow">Tools</p>
      <h1 id="tools-title" tabindex="-1">Tools</h1>
      <p class="lede">Voice analysis is ready. The other tools are planned and not built yet.</p>
    </div>
  </header>

  <div class="grid-12">
    <section class="panel col-7" aria-labelledby="tools-index-title">
      <div class="strip"><h2 class="strip-title" id="tools-index-title">Tool index</h2></div>
      <div class="itable" role="table" aria-labelledby="tools-index-title">
        <div role="row" class="ihead">
          <span role="columnheader">No.</span>
          <span role="columnheader">Tool</span>
          <span role="columnheader">What it does</span>
          <span role="columnheader">Input</span>
          <span role="columnheader">Status</span>
        </div>
        ${TOOLS.map(row).join('')}
      </div>
    </section>

    <section class="panel col-5" aria-labelledby="tools-va-title">
      <div class="strip"><span class="strip-title">Selected: 01</span><span class="strip-meta" data-va-status>Checking…</span></div>
      <div class="pbody">
        <h2 class="panel-title" id="tools-va-title">Voice analysis</h2>
        <p class="prose">Shows the note you are singing, how many cents sharp or flat you are, your vibrato, and a spectrogram of your voice.</p>
      </div>
      <dl class="kv-list">
        <div class="kv"><dt class="kv-label">Shows</dt><dd class="kv-body"><span class="kv-value">Note, cents, pitch, vibrato speed and width, spectrogram</span></dd></div>
        <div class="kv"><dt class="kv-label">Input</dt><dd class="kv-body"><span class="kv-value">Microphone</span></dd></div>
        <div class="kv"><dt class="kv-label">Analysis window</dt><dd class="kv-body"><span class="kv-value">${DEFAULT_YIN.bufferSize} samples</span></dd></div>
      </dl>
      <p class="eyebrow list-label">Requirements</p>
      <dl class="kv-list">${(['mic-permission', 'browser-audio', 'secure'] as const).map(fieldRow).join('')}</dl>
      <div class="pbody">
        <a class="btn btn-primary" href="#/voice">Open voice analysis <span class="arrow" aria-hidden="true">→</span></a>
      </div>
    </section>
  </div>
</div>`;

/** Ready only when the page is secure and the browser has AudioWorklet. The microphone is asked for later. */
function voiceStatus(): { ok: boolean; text: string } {
  const secure = getField('secure');
  const audio = getField('browser-audio');
  if (!secure || !audio) return { ok: false, text: 'Checking…' };
  if (secure.status !== 'ok') return { ok: false, text: 'Needs a secure page' };
  if (audio.status !== 'ok') return { ok: false, text: 'Not available in this browser' };
  return { ok: true, text: 'Ready' };
}

function paintVoiceStatus(root: HTMLElement) {
  const s = voiceStatus();
  for (const el of root.querySelectorAll<HTMLElement>('[data-va-status]')) el.textContent = s.text;
  for (const el of root.querySelectorAll<HTMLElement>('[data-va-dot]')) {
    el.classList.toggle('dot-ok', s.ok);
    el.classList.toggle('dot-error', !s.ok && s.text !== 'Checking…');
  }
}

export function toolsRoute(root: HTMLElement): Route {
  root.innerHTML = html;
  root.setAttribute('aria-labelledby', 'tools-title');
  return {
    title: 'Tools',
    nav: 'tools',
    enter() {
      runPassiveChecks();
      repaintFields(root);
      paintVoiceStatus(root);
    },
  };
}
