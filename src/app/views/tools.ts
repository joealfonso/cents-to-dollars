// Tools, #/tools (DESIGN.md 3.2, CUTTABLE). Index table plus a detail panel for Voice analysis.
// Unbuilt tools are muted "Not built yet" rows with no links.

import type { Route } from '../router.ts';
import { fieldRow, getField, repaintFields, runPassiveChecks } from '../fields.ts';
import { DEFAULT_YIN } from '../../dsp/yin.ts';

interface Tool { no: string; name: string; desc: string; input: string; href?: string; ready?: 'va' | 'fa' }

const TOOLS: Tool[] = [
  { no: '01', name: 'Voice analysis', desc: 'Note, cents sharp or flat, vibrato and a picture of the sound, live as you sing', input: 'Live listening', href: '#/voice', ready: 'va' },
  { no: '02', name: 'Aural skills', desc: 'Interval recognition and pitch matching', input: 'Audio output' },
  { no: '03', name: 'Source separation', desc: 'Isolate the voice from the accompaniment', input: 'Audio file' },
  { no: '04', name: 'Repertoire register', desc: 'Works, language, key and study status', input: 'None' },
  { no: '05', name: 'Recording analysis', desc: 'Pitch, cents, vibrato and spectrogram of an audio file', input: 'Audio file', href: '#/file', ready: 'fa' },
];

function row(t: Tool): string {
  const built = !!t.href;
  // A linked row: the tool name is underlined at rest and the row ends with an arrow (1.10 tap-affordance rule).
  const name = built
    ? `<a class="irow-link" href="${t.href}">${t.name}</a>`
    : t.name;
  const arrow = built ? '<span class="irow-arrow" aria-hidden="true">→</span>' : '';
  // Readiness: Voice analysis from the secure-page and browser-audio checks (voiceStatus below), Recording
  // analysis from Worker and decodeAudioData (fileStatus below, M2-DESIGN.md 1.4).
  const status = built
    ? `<span class="dot" aria-hidden="true" data-${t.ready}-dot></span><span data-${t.ready}-status>Checking…</span>`
    : `<span class="dot" aria-hidden="true"></span><span class="tag-notbuilt">Not built yet</span>`;
  return `
  <div role="row" data-built="${built}"${t.no === '01' ? ' data-selected' : ''}>
    <span role="cell" class="ino">${t.no}</span>
    <span role="cell" class="iname">${name}</span>
    <span role="cell" class="idesc">${t.desc}</span>
    <span role="cell" class="iinput"><span class="ck">Input</span>${t.input}</span>
    <span role="cell" class="istat"><span class="istatus">${status}</span>${arrow}</span>
  </div>`;
}

// Order (3.6): page header; Tool index; Voice analysis detail, with "Open voice analysis" right after its
// description at every width. Ruled sections, no boxes (1.10).
const html = `
<div class="shell route">
  <header class="page-header">
    <div class="ph-text">
      <h1 id="tools-title" tabindex="-1">Tools</h1>
      <p class="lede">Tools for singing practice that run in this browser. Pick a tool to see what it shows and what it needs, then open it. Use the same room and the same laptop or phone each time, so today's readings compare with last week's.</p>
    </div>
  </header>

  <div class="sec-grid tools-grid">
    <section class="sec col-7" aria-labelledby="tools-index-title">
      <header class="sec-head"><h2 class="sec-title" id="tools-index-title">Tool index</h2></header>
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

    <section class="sec col-5 tools-va" aria-labelledby="tools-va-title">
      <header class="sec-head"><h2 class="sec-title" id="tools-va-title">Voice analysis</h2><span class="sec-meta"><span class="dot" aria-hidden="true" data-va-dot></span><span data-va-status>Checking…</span></span></header>
      <div class="sec-body">
        <p class="prose">Shows the note you are singing, how many cents sharp or flat you are, your vibrato and a picture of your sound, live. Set the laptop or phone on your stand, press Start listening and sing. Hold a long note to check its tuning, or sing a phrase and watch where it drifts.</p>
        <p class="tools-open"><a class="btn btn-primary" href="#/voice">Open voice analysis <span class="arrow" aria-hidden="true">→</span></a></p>
      </div>
      <dl class="kv-list tools-kv">
        <div class="kv"><dt class="kv-label">Shows</dt><dd class="kv-body"><span class="kv-value">Note, cents, pitch, vibrato speed and width, spectrogram</span></dd></div>
        <div class="kv"><dt class="kv-label">Input</dt><dd class="kv-body"><span class="kv-value">Live listening</span></dd></div>
        <div class="kv"><dt class="kv-label">Analysis window</dt><dd class="kv-body"><span class="kv-value">${DEFAULT_YIN.bufferSize} samples</span></dd></div>
      </dl>
      <div class="group tools-req">
        <h3 class="group-label">Requirements</h3>
        <dl class="kv-list">${(['mic-permission', 'browser-audio', 'secure'] as const).map(fieldRow).join('')}</dl>
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

/** Recording analysis needs a Worker and decodeAudioData. No permission is involved. */
function fileStatus(): { ok: boolean; text: string } {
  const ok = typeof Worker === 'function' && typeof OfflineAudioContext !== 'undefined'
    && typeof OfflineAudioContext.prototype.decodeAudioData === 'function';
  return ok ? { ok, text: 'Ready' } : { ok, text: 'Not available in this browser' };
}

function paintStatus(root: HTMLElement, key: 'va' | 'fa', s: { ok: boolean; text: string }) {
  for (const el of root.querySelectorAll<HTMLElement>(`[data-${key}-status]`)) el.textContent = s.text;
  for (const el of root.querySelectorAll<HTMLElement>(`[data-${key}-dot]`)) {
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
      paintStatus(root, 'va', voiceStatus());
      paintStatus(root, 'fa', fileStatus());
    },
  };
}
