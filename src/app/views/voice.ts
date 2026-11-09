// Voice analysis, #/voice (DESIGN.md 2.8 to 2.10, 3.0, 3.3, 6). The hero readout, A4 stepper, Space bar,
// spectrogram, Readings, Details, Setup and How to read this. The mic belongs to live.ts; this view only
// subscribes to its state and frames. Leaving the route awaits live.stop().
//
// IDs: every ID in DESIGN.md 7.3 for this screen gets a "va-" prefix (live-toggle -> va-live-toggle,
// m-pitch -> va-m-pitch), because the legacy page (#/legacy) stays in the DOM with live-toggle,
// cents-meter, readout-announce and others.
//
// Timing for the hold and the gate hint uses the frame clock (frame.t), so it follows the audio, not the
// display. The hero redraws every animation frame from the newest frame, with no smoothing (2.9).

import type { Route } from '../router.ts';
import type { WorkletFrame } from '../../audio/tracker.worklet.ts';
import { live, type LiveSnapshot } from '../live.ts';
import { currentA4, setA4 } from '../fields.ts';
import { TOLERANCE_CENTS, HOLD_FULL_MS, GATE_HINT_MS } from '../readout-constants.ts';
import {
  MINUS, signedFixed, centsLabel, noteGlyph, splitNote, directionFor, holdExpired, gateHintDue, shouldAnnounce, stableFor,
  type Announced,
} from '../readout.ts';
import { nearestNote } from '../../dsp/pitch.ts';
import { analyzeVibrato } from '../../dsp/vibrato.ts';
import { SF_BAND, REF_BAND } from '../../dsp/spectrum.ts';
import { SPEC_TOP_HZ, readSpecPalette, fillSpecColumn, putF0Mark } from '../spectrogram.ts';
import { DEFAULT_YIN } from '../../dsp/yin.ts';
import { DEFAULT_HOP } from '../../dsp/analyzer.ts';

// ---------------------------------------------------------------- UI constants (from the legacy main.ts)
const VIB_WINDOW_S = 2.5;
const HISTORY_MAX = 4000;
/** Level bar range, a display choice: the left end of the bar is this many dBFS. */
const LEVEL_MIN_DB = -80;
/** Screen reader note announcements and the meter label change at most this often (2.9). */
const ANNOUNCE_MS = 1000;
/** Delay before a repeated announcement is set again after clearing the region. */
const REANNOUNCE_DELAY_MS = 100;
const SILENCE_DB = DEFAULT_YIN.silenceDb;
/** Spectrogram data resolution: one column per frame (960 frames, DESIGN.md 2.10) by 300 frequency rows. */
const RING_W = 960;
const RING_H = 300;

const SPACE_KEY = 'centstodollars.space';
const A4_MIN = 400;
const A4_MAX = 480;

// ---------------------------------------------------------------- states and copy (2.14, supersedes 3.0)
type ViewState =
  | 'idle' | 'requesting' | 'listening' | 'stopping' | 'stopped'
  | 'denied' | 'nodevice' | 'busy' | 'insecure' | 'analyser' | 'ended';

/**
 * chip: the status chip in the page header row. msg: the plain idle instruction (no callout). kind/title/step: the
 * one callout in the note slot (2.14), when there is one. The step ends with the action's exact label. error: the
 * chip dot is the error square.
 */
interface Copy { chip: string; msg: string; kind: 'action' | 'info' | null; title: string; step: string; action: string | null; error: boolean }
const COPY: Record<ViewState, Copy> = {
  idle: { chip: 'Idle', msg: 'Press Start listening and sing a steady note. Audio stays in this browser and is not saved.', kind: null, title: '', step: '', action: 'Start listening', error: false },
  requesting: { chip: 'Waiting for permission', msg: '', kind: 'info', title: 'Your browser is asking if this page can listen.', step: 'Choose Allow.', action: 'Waiting for permission…', error: false },
  listening: { chip: 'Listening', msg: '', kind: null, title: '', step: '', action: 'Stop listening', error: false },
  stopping: { chip: 'Listening', msg: '', kind: null, title: '', step: '', action: 'Stopping…', error: false },
  stopped: { chip: 'Stopped', msg: '', kind: null, title: '', step: '', action: 'Start listening', error: false },
  denied: { chip: 'Listening blocked', msg: '', kind: 'action', title: 'Listening is blocked for this page.', step: "In your browser's site settings, allow Microphone for this site, then press Try again.", action: 'Try again', error: true },
  nodevice: { chip: 'Can\'t listen', msg: '', kind: 'action', title: 'This laptop or phone has no microphone the browser can use.', step: 'Check your sound settings, then press Try again.', action: 'Try again', error: true },
  busy: { chip: 'Can\'t listen', msg: '', kind: 'action', title: 'Another app is using the sound input.', step: 'Close it, then press Try again.', action: 'Try again', error: true },
  insecure: { chip: 'Not available', msg: '', kind: 'action', title: 'Listening only works on a secure page.', step: 'Open http://127.0.0.1:5173.', action: null, error: true },
  analyser: { chip: 'Can\'t listen', msg: '', kind: 'action', title: 'This browser could not start the audio analyser.', step: 'Press Try again.', action: 'Try again', error: true },
  ended: { chip: 'Listening stopped', msg: '', kind: 'action', title: 'Listening stopped.', step: 'Press Start listening to continue.', action: 'Start listening', error: true },
};
/** The insecure step names the address as a link (2.14). Same text as COPY.insecure.step. */
const INSECURE_STEP_HTML = 'Open <a class="link" href="http://127.0.0.1:5173/">http://127.0.0.1:5173</a>.';
const GATE_TITLE = 'Too quiet to hear.';
const GATE_STEP = 'Move closer or turn the input up.';
/** The gate hint is announced each time it appears, at most this often (2.14). */
const GATE_SAY_MS = 5000;

function viewState(s: LiveSnapshot): ViewState {
  if (s.status === 'error') return s.error ?? 'analyser';
  return s.status;
}

// ---------------------------------------------------------------- formatting
/** Fixed decimals with a real minus sign for negatives (dBFS values). */
const fx = (x: number, d: number) => x.toFixed(d).replace(/^-/, MINUS);

// ---------------------------------------------------------------- markup
const ARROW_LEFT = '<svg class="va-arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 12H5M11 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square"/></svg>';
const ARROW_RIGHT = '<svg class="va-arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 12h15M13 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square"/></svg>';
const UNIT = '<span class="v-paper">c</span><span class="v-loud">CENTS</span>';
/** Callout icons (2.14): a circle with "!" for action and warn, with "i" for info, both in ink, so the kind never
 *  depends on colour alone. */
const ICON_ALERT = '<svg class="msg-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4v5" stroke="currentColor" stroke-width="1.75"/><circle cx="8" cy="11.6" r="1.1" fill="currentColor"/></svg>';
const ICON_INFO = '<svg class="msg-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="4.6" r="1.1" fill="currentColor"/><path d="M8 7v5" stroke="currentColor" stroke-width="1.75"/></svg>';

const tolLeft = 50 - TOLERANCE_CENTS;
const gatePct = Math.max(0, Math.min(100, ((SILENCE_DB - LEVEL_MIN_DB) / -LEVEL_MIN_DB) * 100));

const kv = (label: string, id: string, empty: string, placeholder = false, labelId = '') => `
      <div class="kv"><dt class="kv-label"${labelId ? ` id="${labelId}"` : ''}>${label}</dt><dd class="kv-body"><span class="kv-value" id="${id}"${placeholder ? ' data-empty' : ''}>${empty}</span><span class="va-kv-note" id="${id}-note" hidden></span></dd></div>`;
/** A Readings stat cell (3.6): mono label above the value, no rules between rows. */
const stat = (label: string, id: string, empty: string, big: boolean) => `
      <div class="va-stat${big ? ' va-stat-big' : ''}"><dt class="va-stat-label">${label}</dt><dd class="va-stat-body"><span class="va-stat-v" id="${id}" data-empty>${empty}</span><span class="va-kv-note" id="${id}-note"${big ? '' : ' hidden'}>${big ? VIB_WINDOW_NOTE : ''}</span></dd></div>`;
const NO_VIB = `No vibrato found in the last ${VIB_WINDOW_S} s`;
/** The Readings cell is small, so its empty value is short; the window is in the note line under it. */
const NO_VIB_SHORT = 'None yet';
const VIB_WINDOW_NOTE = `last ${VIB_WINDOW_S} s`;

// DOM order at every width (3.6): page header (h1, status chip), hero, Readings, Spectrogram, How to read this,
// Setup. The wide grid places them as before (voice.css). The toggle stays at the end of the hero in the DOM; under
// 600 its bar is fixed to the bottom of the screen, in phone landscape it sits in the page header row.
const html = `
<div class="shell route va-route">
  <header class="page-header va-header">
    <div class="ph-text">
      <p class="eyebrow va-crumb"><a class="link" href="#/tools">Tools</a> / Voice analysis</p>
      <h1 id="va-title" tabindex="-1">Voice analysis</h1>
    </div>
    <p class="va-status"><span class="dot" id="va-status-dot" aria-hidden="true"></span><span id="va-readout-status">Idle</span></p>
  </header>

  <div class="va-grid">
    <section class="va-hero" id="va-hero" aria-label="Note" data-has="none">
      <div class="va-hero-body">
        <div class="va-note-row">
          <div class="va-note-slot">
            <p class="va-note" id="va-note-line" data-empty>
              <span class="va-last" id="va-readout-last" aria-hidden="true" hidden>Last:</span>
              <span class="va-glyphs" aria-hidden="true"><span class="va-letter" id="va-readout-note">No pitch yet</span><span class="va-ao"><span class="va-acc" id="va-readout-acc"></span><span class="va-oct" id="va-readout-oct"></span></span></span>
              <span class="visually-hidden" id="va-note-spoken">No pitch yet</span>
            </p>
            <p class="va-msg" id="va-readout-msg"></p>
            <div class="va-announce" id="va-readout-announce" role="status">
              <span class="visually-hidden" id="va-say"></span>
              <div class="msg" id="va-readout-error" data-kind="action" hidden>
                <span class="msg-icon-slot" id="va-readout-error-icon">${ICON_ALERT}</span>
                <div class="msg-text">
                  <p class="msg-title" id="va-readout-error-text"></p>
                  <p class="msg-step prose" id="va-readout-error-step"></p>
                  <details class="disclosure" id="va-readout-error-details" hidden><summary aria-label="Error details">Details</summary><pre class="msg-raw" id="va-readout-error-raw"></pre></details>
                </div>
              </div>
            </div>
          </div>
          <div class="va-side">
            <p class="va-chip"><span class="va-cents" id="va-readout-cents"></span><span class="va-unit">${UNIT}</span></p>
            <p class="va-a4-ro" id="va-a4-readonly">A4 440 Hz</p>
          </div>
        </div>

        <p class="va-dir" id="va-readout-dir"></p>

        <div class="va-meter" id="va-cents-meter" role="img" aria-label="Cents meter: No pitch">
          <div class="va-track">
            <span class="va-tol" id="va-cents-tol-zone" style="left:${tolLeft}%;width:${2 * TOLERANCE_CENTS}%"></span>
            <span class="va-tick" style="left:0"></span><span class="va-tick va-tick-mid" style="left:50%"></span><span class="va-tick" style="left:100%"></span>
            <span class="va-marker" id="va-cents-marker" hidden></span>
          </div>
        </div>

        <div class="va-cap-slot">
          <p class="va-caption">Nearest note in equal temperament</p>
          <p class="va-hint" id="va-readout-gate-hint" hidden>${ICON_ALERT}<span><span class="va-hint-title">${GATE_TITLE}</span> <span class="va-hint-step">${GATE_STEP}</span></span></p>
        </div>

        <div class="va-level" id="va-level-meter" aria-hidden="true"><span class="va-level-fill" id="va-level-fill"></span><span class="va-level-gate" style="left:${gatePct}%"></span></div>

        <div class="va-actionbar">
          <button type="button" class="btn btn-primary va-toggle" id="va-live-toggle" data-state="idle"><span class="va-live-dot" aria-hidden="true"></span><span id="va-toggle-label">Start listening</span></button>
          <p class="va-space-hint" id="va-space-hint">Space bar also starts and stops</p>
        </div>
      </div>
    </section>

    <section class="group va-readings" aria-labelledby="va-readings-title">
      <h2 class="group-label va-readings-label" id="va-readings-title">Readings</h2>
      <dl class="va-stats">${stat('Vibrato speed', 'va-m-vib-speed', NO_VIB_SHORT, true)}${stat('Vibrato width', 'va-m-vib-width', NO_VIB_SHORT, true)}${stat('Pitch', 'va-m-pitch', 'No pitch', false)}${stat('Off by', 'va-m-offby', 'No pitch', false)}
      </dl>
      <details class="disclosure va-details" id="va-details">
        <summary aria-label="Reading details">Details</summary>
        <dl class="kv-list">${kv('F0', 'va-d-f0', 'No pitch', true)}${kv('Deviation', 'va-d-dev', 'No pitch', true)}${kv('Vibrato extent, peak to peak', 'va-d-vib-p2p', NO_VIB, true)}${kv(`Energy ${fx(SF_BAND[0] / 1000, 1)} to ${fx(SF_BAND[1] / 1000, 1)} kHz vs ${fx(REF_BAND[0] / 1000, 2)} to ${REF_BAND[1] / 1000} kHz`, 'va-d-band', `No voiced frames in the last ${VIB_WINDOW_S} s`, true)}${kv('Input level', 'va-d-level', 'Not listening', true)}${kv('Voicing gate', 'va-d-gate', `${fx(SILENCE_DB, 0)} dBFS`)}
        </dl>
      </details>
    </section>

    <section class="group va-spec" aria-labelledby="va-spec-title">
      <div class="group-head">
        <h2 class="group-label" id="va-spec-title">Spectrogram</h2>
        <p class="group-meta va-spec-meta"><span id="va-spec-span">0 to ${SPEC_TOP_HZ / 1000} kHz</span> <span class="va-spec-state" id="va-spec-state">Not listening</span></p>
      </div>
      <div class="plot-frame">
        <div class="va-spec-panel">
          <div class="va-plot">
            <div class="va-axis" aria-hidden="true"><span>${SPEC_TOP_HZ / 1000} kHz</span><span>3</span><span>2</span><span>1</span><span>0</span></div>
            <div class="va-canvas-wrap">
              <canvas id="va-spectrogram" width="960" height="300" role="img" aria-label="Spectrogram 0 to 4 kHz with pitch marks. The readings are listed as text in the Readings panel."></canvas>
            </div>
          </div>
          <ul class="va-legend" role="list">
            <li><span class="va-sw va-sw-f0" aria-hidden="true"></span>F0</li>
            <li><span class="va-sw va-sw-band" aria-hidden="true"></span>${fx(SF_BAND[0] / 1000, 1)} to ${fx(SF_BAND[1] / 1000, 1)} kHz band</li>
          </ul>
          <p class="va-plot-caption"><span class="v-paper">Brightness is energy. Orange marks are the pitch the app measured.</span><span class="v-loud">Brightness is energy. Pink marks are the pitch the app measured.</span></p>
        </div>
      </div>
    </section>

    <section class="sec va-howto" aria-labelledby="va-howto-title">
      <header class="sec-head"><h2 class="sec-title" id="va-howto-title">How to read this</h2></header>
      <div class="sec-body">
        <p class="prose">Cents are the distance from the nearest equal-tempered note at your A4. Singers often tune away from equal temperament, so a few cents is not a mistake.</p>
        <p class="prose">Vibrato width is how far your pitch goes up and down from the middle, in cents. Vibrato speed is how many times a second it does that.</p>
        <p class="prose">If the octave looks wrong, compare the orange marks with the lowest strong band in the spectrogram. The live view sometimes jumps an octave; this is a known limit (VALIDATION.md section 4).</p>
        <ul class="va-docs"><li><a class="link link-hit" href="/MEASUREMENT.md">MEASUREMENT.md</a></li><li><a class="link link-hit" href="/VALIDATION.md">VALIDATION.md</a></li></ul>
        <p class="prose va-docs-note">Dev server only, opens raw text.</p>
      </div>
    </section>

    <details class="disclosure va-setup" id="va-setup">
      <summary>Setup</summary>
      <div class="va-a4-row">
        <div class="va-a4" role="group" aria-labelledby="va-a4-label">
          <label class="va-a4-label" id="va-a4-label" for="va-a4">A4</label>
          <button type="button" class="va-step" id="va-a4-dec" aria-label="Lower A4 by 1 hertz"><span aria-hidden="true">${MINUS}</span></button>
          <input class="va-a4-input" id="va-a4" type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" spellcheck="false" aria-describedby="va-a4-unit va-a4-error">
          <span class="va-a4-unit" id="va-a4-unit">Hz</span>
          <button type="button" class="va-step" id="va-a4-inc" aria-label="Raise A4 by 1 hertz"><span aria-hidden="true">+</span></button>
          <button type="button" class="btn btn-ghost va-a4-done" id="va-a4-done">Done</button>
        </div>
        <p class="va-a4-error" id="va-a4-error" role="status"></p>
      </div>
      <dl class="kv-list">${kv('Input', 'va-s-input', 'Shown while listening', true)}${kv('Sample rate', 'va-s-rate', 'Shown while listening', true)}${kv('Base latency', 'va-s-latency', 'Shown while listening', true)}${kv('Analysis window', 'va-s-window', `${DEFAULT_YIN.bufferSize} samples`)}${kv('Display range', 'va-s-range', `0 to ${SPEC_TOP_HZ / 1000} kHz`)}
        <div class="kv"><dt class="kv-label" id="va-s-space-label">Space bar shortcut</dt><dd class="kv-body"><label class="va-switch"><input type="checkbox" role="switch" id="va-s-space" aria-labelledby="va-s-space-label" checked><span class="kv-value" id="va-s-space-text" aria-hidden="true">On</span></label></dd></div>
      </dl>
    </details>
  </div>
</div>`;

// ---------------------------------------------------------------- view
interface Hist { t: number; f0: number; voiced: boolean; eSf: number; eRef: number; rmsDb: number }

export function voiceRoute(root: HTMLElement): Route {
  root.innerHTML = html;
  root.setAttribute('aria-labelledby', 'va-title');

  const $ = <T extends HTMLElement = HTMLElement>(id: string) => {
    const el = root.querySelector<T>(`#${id}`);
    if (!el) throw new Error(`voice view: #${id} missing`);
    return el;
  };
  const el = {
    hero: $('va-hero'),
    status: $('va-readout-status'), statusDot: $('va-status-dot'),
    noteLine: $('va-note-line'), last: $('va-readout-last'), note: $('va-readout-note'),
    acc: $('va-readout-acc'), oct: $('va-readout-oct'), spoken: $('va-note-spoken'),
    msg: $('va-readout-msg'), error: $('va-readout-error'), errorIcon: $('va-readout-error-icon'),
    errorText: $('va-readout-error-text'), errorStep: $('va-readout-error-step'),
    errorDetails: $<HTMLDetailsElement>('va-readout-error-details'), errorRaw: $('va-readout-error-raw'),
    dir: $('va-readout-dir'), cents: $('va-readout-cents'),
    meter: $('va-cents-meter'), marker: $('va-cents-marker'),
    a4: $<HTMLInputElement>('va-a4'), a4Dec: $<HTMLButtonElement>('va-a4-dec'), a4Inc: $<HTMLButtonElement>('va-a4-inc'),
    a4Done: $<HTMLButtonElement>('va-a4-done'), a4Error: $('va-a4-error'), a4ro: $('va-a4-readonly'),
    hint: $('va-readout-gate-hint'), levelFill: $('va-level-fill'),
    toggle: $<HTMLButtonElement>('va-live-toggle'), toggleLabel: $('va-toggle-label'), spaceHint: $('va-space-hint'),
    announce: $('va-say'),
    canvas: $<HTMLCanvasElement>('va-spectrogram'), specSpan: $('va-spec-span'), specState: $('va-spec-state'),
    mPitch: $('va-m-pitch'), mOffby: $('va-m-offby'), mVibSpeed: $('va-m-vib-speed'), mVibWidth: $('va-m-vib-width'),
    mVibSpeedNote: $('va-m-vib-speed-note'), mVibWidthNote: $('va-m-vib-width-note'),
    dF0: $('va-d-f0'), dDev: $('va-d-dev'), dP2p: $('va-d-vib-p2p'), dBand: $('va-d-band'), dLevel: $('va-d-level'),
    sInput: $('va-s-input'), sRate: $('va-s-rate'), sLatency: $('va-s-latency'), sWindow: $('va-s-window'),
    space: $<HTMLInputElement>('va-s-space'), spaceText: $('va-s-space-text'),
  };

  const setText = (e: HTMLElement, t: string) => { if (e.textContent !== t) e.textContent = t; };
  const setHidden = (e: HTMLElement, h: boolean) => { if (e.hidden !== h) e.hidden = h; };
  const setAttr = (e: HTMLElement, k: string, v: string) => { if (e.getAttribute(k) !== v) e.setAttribute(k, v); };
  const setHtml = (e: HTMLElement, key: string, markup: string) => {
    if (e.dataset.key === key) return;
    e.dataset.key = key;
    e.innerHTML = markup;
  };
  /** A Readings value: a number part and a unit part, or (num null) one empty text. Spans are made once. */
  const setStat = (e: HTMLElement, num: string | null, rest: string) => {
    if (num === null) {
      if (e.hasAttribute('data-empty')) { setText(e, rest); return; }
      e.setAttribute('data-empty', '');
      e.textContent = rest;
      return;
    }
    if (e.hasAttribute('data-empty') || e.childElementCount !== 2) {
      e.removeAttribute('data-empty');
      e.innerHTML = '<span class="va-num"></span> <span class="va-stat-unit"></span>';
    }
    setText(e.firstElementChild as HTMLElement, num);
    setText(e.lastElementChild as HTMLElement, rest);
  };

  // ------------------------------------------------ data from frames
  let history: Hist[] = [];
  let lastVoiced: { f0: number; t: number } | null = null;
  let belowSince: number | null = null;
  let pendingCols: WorkletFrame[] = [];
  let fs = 0;
  let info: { input: string; rate: string; latency: string; window: string } | null = null;

  /** Bumped on every frame and on reset, so Readings recompute vibrato and the band ratio only when needed. */
  let frameSeq = 0;
  live.onFrame((f) => {
    frameSeq++;
    history.push({ t: f.t, f0: f.voiced ? f.f0 : 0, voiced: f.voiced, eSf: f.eSf, eRef: f.eRef, rmsDb: f.rmsDb });
    if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX);
    if (f.voiced && f.f0 > 0) lastVoiced = { f0: f.f0, t: f.t };
    if (f.rmsDb < SILENCE_DB) { if (belowSince === null) belowSince = f.t; } else belowSince = null;
    // Cap the queue: rAF stops while the tab is hidden but the worklet keeps posting (6.10).
    pendingCols.push(f);
    if (pendingCols.length > RING_W) pendingCols.splice(0, pendingCols.length - RING_W);
  });

  // ------------------------------------------------ spectrogram (colours from tokens, re-read on themechange)
  // The data lives in an offscreen ring of RING_W x RING_H, one column per frame, written with putImageData.
  // The visible canvas is sized from its CSS box times devicePixelRatio and shows the ring oldest to newest
  // with two drawImage calls, so nothing is read back from the screen and a resize just repaints.
  const ring = document.createElement('canvas');
  ring.width = RING_W;
  ring.height = RING_H;
  const rg = ring.getContext('2d');
  const g = el.canvas.getContext('2d');
  let ringX = 0; // next column to write; columns [ringX, W) are the oldest
  let drawnAny = false; // a column has been drawn since the last clear (spectrogram meta: "Waiting for sound")
  const col = rg ? rg.createImageData(1, RING_H) : null;

  const readPalette = () => readSpecPalette(rg);
  let pal = readPalette();
  document.addEventListener('themechange', () => { pal = readPalette(); }); // from the next column (6.9)

  /** Bitmap = CSS size x devicePixelRatio, so the plot is sharp at any zoom. Skipped while the route is hidden. */
  function sizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(el.canvas.clientWidth * dpr), h = Math.round(el.canvas.clientHeight * dpr);
    if (!w || !h) return;
    if (el.canvas.width !== w || el.canvas.height !== h) { el.canvas.width = w; el.canvas.height = h; }
    paint();
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(sizeCanvas).observe(el.canvas);
  window.addEventListener('resize', sizeCanvas); // devicePixelRatio changes with browser zoom

  /** Copies the ring to the visible canvas, oldest column on the left. */
  function paint() {
    if (!g) return;
    const W = el.canvas.width, H = el.canvas.height, sx = W / RING_W;
    g.imageSmoothingEnabled = false;
    const older = RING_W - ringX;
    if (older > 0) g.drawImage(ring, ringX, 0, older, RING_H, 0, 0, older * sx, H);
    if (ringX > 0) g.drawImage(ring, 0, 0, ringX, RING_H, older * sx, 0, ringX * sx, H);
  }

  function clearCanvas() {
    pal = readPalette();
    if (!rg) return;
    const [r, gg, b] = pal.surface;
    rg.fillStyle = `rgb(${r},${gg},${b})`;
    rg.fillRect(0, 0, RING_W, RING_H);
    ringX = 0;
    drawnAny = false;
    paint();
  }

  /** Writes the queued frames into the ring. Returns true if anything was drawn. */
  function drawColumns(): boolean {
    if (!rg || !col || !fs) { pendingCols = []; return false; }
    let cols = pendingCols.splice(0);
    if (!cols.length) return false;
    if (cols.length > RING_W) cols = cols.slice(-RING_W);
    const N = DEFAULT_YIN.bufferSize, d = col.data;
    for (const f of cols) {
      fillSpecColumn(d, 1, RING_H, 0, pal, f.power ?? null, N, fs);
      if (f.voiced && f.f0 > 0) putF0Mark(d, 1, RING_H, 0, f.f0, pal); // F0 mark with a 1px halo in the plot colour (1.4)
      rg.putImageData(col, ringX, 0);
      ringX = (ringX + 1) % RING_W;
    }
    drawnAny = true;
    return true;
  }

  // ------------------------------------------------ A4 stepper (2.8)
  let a4 = currentA4();
  let a4Invalid = false;
  el.a4.value = String(a4);
  const syncA4ro = () => setText(el.a4ro, `A4 ${a4} Hz`);
  syncA4ro();
  function parseA4(raw: string): number | null {
    const s = raw.trim().replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const v = Number(s);
    return v >= A4_MIN && v <= A4_MAX ? v : null;
  }
  function clearA4Error() {
    a4Invalid = false;
    el.a4.removeAttribute('aria-invalid');
    setText(el.a4Error, '');
  }
  function applyA4(v: number) {
    const changed = v !== a4;
    a4 = v;
    el.a4.value = String(v);
    syncA4ro();
    clearA4Error();
    if (!changed) return;
    setA4(v); // shared with Recording analysis for this visit, saved when storage allows
    say(`Reference A4 = ${v} Hz`);
    render();
  }
  function validateA4() {
    const v = parseA4(el.a4.value);
    if (v === null) {
      a4Invalid = true;
      setText(el.a4Error, `Enter a value from ${A4_MIN} to ${A4_MAX} Hz`);
      el.a4.setAttribute('aria-invalid', 'true');
      return; // the last valid A4 stays in use
    }
    applyA4(v);
  }
  el.a4.addEventListener('change', validateA4);
  el.a4.addEventListener('blur', () => { if (a4Invalid || el.a4.value !== String(a4)) validateA4(); });
  // Enter (hardware keyboards, Go or Next on Android keypads) commits and leaves the field, so the action bar returns.
  el.a4.addEventListener('keydown', (e) => { if (e.key === 'Enter') { validateA4(); el.a4.blur(); } });
  // Done: the iOS decimal keypad has no Done key. Shown while the A4 group has focus (CSS). mousedown is cancelled so
  // the press does not blur the field first and hide the button under the finger; the click then commits and moves
  // focus to Done itself, so no input has focus and the bar returns. An invalid value shows the field error and keeps
  // the last valid A4 (2.8).
  el.a4Done.addEventListener('mousedown', (e) => e.preventDefault());
  el.a4Done.addEventListener('click', () => { validateA4(); el.a4Done.focus(); });
  const step = (d: number) => applyA4(Math.round(Math.min(A4_MAX, Math.max(A4_MIN, a4 + d)) * 10) / 10);
  el.a4Dec.addEventListener('click', () => step(-1));
  el.a4Inc.addEventListener('click', () => step(1));

  // ------------------------------------------------ Space bar (3.3)
  let spaceOn = true;
  try { spaceOn = localStorage.getItem(SPACE_KEY) !== 'off'; } catch { /* default on */ }
  el.space.checked = spaceOn;
  function syncSpace() {
    setText(el.spaceText, spaceOn ? 'On' : 'Off');
    render();
  }
  el.space.addEventListener('change', () => {
    spaceOn = el.space.checked;
    try { localStorage.setItem(SPACE_KEY, spaceOn ? 'on' : 'off'); } catch { /* keep it for this visit */ }
    syncSpace();
  });
  const SKIP_TARGETS = 'input, textarea, select, button, a[href], summary, [contenteditable]:not([contenteditable="false"]), [role="switch"], [role="radio"], [role="button"]';
  // Attached once; acts only while this route is the committed, visible one (see the route observer below).
  function onKey(e: KeyboardEvent) {
    if (!visible || !spaceOn || e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const t = e.target;
    if (t instanceof Element && t.closest(SKIP_TARGETS)) return;
    e.preventDefault();
    toggle();
  }

  // ------------------------------------------------ toggle
  let refocus = false;
  function toggle() {
    const s = live.status;
    if (s === 'listening') { void live.stop(); return; }
    if (s === 'requesting' || s === 'stopping') return;
    if (viewState(live.snapshot()) === 'insecure') return;
    void live.start({ owner: 'voice' });
  }
  // Phone landscape draws the toggle at the right end of the title row; the row reserves its measured size, so the h1
  // and chip wrap beside it when text is enlarged (voice.css, landscape block).
  const route = root.querySelector<HTMLElement>('.va-route');
  if (route && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      const r = el.toggle.getBoundingClientRect();
      if (!r.width) return;
      route.style.setProperty('--va-toggle-w', `${Math.ceil(r.width)}px`);
      route.style.setProperty('--va-toggle-h', `${Math.ceil(r.height)}px`);
    }).observe(el.toggle);
  }
  el.toggle.addEventListener('click', () => {
    refocus = true; // the button is disabled while busy, which drops focus; give it back afterwards
    toggle();
  });

  // ------------------------------------------------ announcements (throttled for notes, at once for states)
  // A note is announced only when shouldAnnounce says the note or the direction really changed (with
  // hysteresis), and at most once per ANNOUNCE_MS. Repeating the same text clears the region and sets it on a
  // later task, because clearing and setting in the same task is often not announced twice.
  let announced: Announced | null = null;
  let annAt = -Infinity;
  let annTimer = 0;
  function say(text: string) {
    window.clearTimeout(annTimer);
    annAt = performance.now();
    if (el.announce.textContent !== text) { el.announce.textContent = text; return; }
    el.announce.textContent = '';
    annTimer = window.setTimeout(() => { el.announce.textContent = text; }, REANNOUNCE_DELAY_MS);
  }
  // A change must also hold for ANNOUNCE_STABLE_MS of frame time (stableFor), so vibrato across a boundary
  // never re-announces.
  let pendingKey = '';
  let pendingSince: number | null = null;
  function announceNote(note: string, spoken: string, cents: number, f0: number, targetHz: number, t: number) {
    const dir = directionFor(cents, TOLERANCE_CENTS);
    if (!shouldAnnounce(announced, { note, cents, f0 }, TOLERANCE_CENTS)) { pendingKey = ''; pendingSince = null; return; }
    const key = `${note}|${dir}`;
    if (key !== pendingKey) { pendingKey = key; pendingSince = t; }
    if (announced && !stableFor(t, pendingSince)) return; // the first reading is announced at once
    if (performance.now() - annAt < ANNOUNCE_MS) return;
    pendingKey = ''; pendingSince = null;
    announced = { note, targetHz, dir };
    const r = Math.round(cents) || 0;
    say(`${spoken}, ${r === 0 ? '0 cents' : `${Math.abs(r)} ${Math.abs(r) === 1 ? 'cent' : 'cents'} ${r < 0 ? 'flat' : 'sharp'}`}`);
  }
  let meterLabelAt = -Infinity;
  function meterLabel(text: string, immediate: boolean) {
    if (el.meter.getAttribute('aria-label') === text) return;
    const now = performance.now();
    if (!immediate && now - meterLabelAt < ANNOUNCE_MS) return;
    meterLabelAt = now;
    el.meter.setAttribute('aria-label', text);
  }

  // ------------------------------------------------ reset (6.6) and render
  function resetView() {
    history = [];
    lastVoiced = null;
    belowSince = null;
    pendingCols = [];
    info = null;
    announced = null;
    pendingKey = ''; pendingSince = null;
    frameSeq++;
    clearCanvas();
  }

  let prevVs: ViewState | null = null;
  function onState(s: LiveSnapshot) {
    const vs = viewState(s);
    if (vs === 'requesting' && prevVs !== 'requesting') resetView(); // a new take starts on a clean plot (7.6)
    if (vs === 'listening' && s.session) {
      const ctx = s.session.ctx;
      fs = ctx.sampleRate;
      const track = s.session.stream.getAudioTracks()[0];
      const bl = ctx.baseLatency;
      info = {
        input: track?.label || 'Not reported by this browser',
        rate: `${fs} Hz`,
        latency: typeof bl === 'number' && Number.isFinite(bl) ? `${fx(bl * 1000, 1)} ms` : 'Not reported by this browser',
        window: `${DEFAULT_YIN.bufferSize} samples (${fx((DEFAULT_YIN.bufferSize / fs) * 1000, 1)} ms)`,
      };
    }
    // A state with a callout is announced once by the callout itself, which sits inside the status region
    // (#va-readout-announce), so its text is on the page once (2.14, MSG-01, MSG-13). Other states say the chip.
    if (vs !== prevVs && prevVs !== null && vs !== 'idle' && vs !== 'stopping') {
      const c = COPY[vs];
      // "Listening" is announced once, by the header's #mic-indicator (main.ts), not here as well.
      if (c.kind) { window.clearTimeout(annTimer); setText(el.announce, ''); } else if (vs !== 'listening') say(c.chip);
    }
    prevVs = vs;
    syncLoop();
    render();
    if (refocus && !el.toggle.disabled && !el.toggle.hidden) {
      refocus = false;
      if (visible && document.activeElement !== el.toggle) el.toggle.focus();
    }
  }
  live.subscribe(onState);

  let gateSaidAt = -Infinity;
  let vibSeq = -1;
  let vibShown = false;
  let vibCache: ReturnType<typeof analyzeVibrato> = null;
  let bandCache = NaN;
  function render() {
    const snap = live.snapshot();
    const vs = viewState(snap);
    const copy = COPY[vs];
    const active = vs === 'listening' || vs === 'stopping';
    const showReading = active || vs === 'stopped';
    const newest = showReading ? history[history.length - 1] : undefined;
    const reading = showReading ? lastVoiced : null;
    const held = !!reading && holdExpired(newest?.t ?? null, reading.t, HOLD_FULL_MS);
    const stale = !!reading && (vs === 'stopped' || held);

    // status chip
    setText(el.status, active && stale ? 'No pitch' : copy.chip);
    el.statusDot.className = `dot${active ? (stale ? '' : ' dot-live') : copy.error ? ' dot-error' : ''}`;

    // note slot: the note, or the idle instruction, or the one callout (2.14)
    const callout = copy.kind !== null;
    setHidden(el.noteLine, callout);
    setHidden(el.error, !callout);
    setAttr(el.hero, 'data-msg', callout ? copy.kind ?? '' : '');
    if (callout) {
      setAttr(el.error, 'data-kind', copy.kind ?? 'action');
      setHtml(el.errorIcon, copy.kind ?? '', copy.kind === 'info' ? ICON_INFO : ICON_ALERT);
      setText(el.errorText, copy.title);
      if (vs === 'insecure') setHtml(el.errorStep, 'insecure', INSECURE_STEP_HTML);
      else { delete el.errorStep.dataset.key; setText(el.errorStep, copy.step); }
    } else {
      setText(el.errorText, '');
      delete el.errorStep.dataset.key;
      setText(el.errorStep, '');
    }
    const showDetails = vs === 'analyser' && !!snap.detail;
    setHidden(el.errorDetails, !showDetails);
    setText(el.errorRaw, showDetails ? snap.detail : '');
    setText(el.msg, !callout && !reading ? copy.msg : '');
    setHidden(el.msg, callout || !!reading || !copy.msg);

    let r: number | null = null;
    let centsNow = 0;
    if (reading) {
      const n = nearestNote(reading.f0, a4);
      const parts = splitNote(n.name);
      r = Math.round(n.cents) || 0; // || 0 turns -0 into 0
      centsNow = n.cents;
      el.noteLine.removeAttribute('data-empty');
      setText(el.note, parts.letter);
      setText(el.acc, parts.acc);
      setText(el.oct, parts.oct);
      setText(el.spoken, stale ? `Last: ${parts.spoken}` : parts.spoken);
      if (!stale && vs === 'listening') announceNote(n.name, parts.spoken, n.cents, reading.f0, n.targetHz, reading.t);
    } else {
      el.noteLine.setAttribute('data-empty', '');
      setText(el.note, 'No pitch yet');
      setText(el.acc, '');
      setText(el.oct, '');
      setText(el.spoken, 'No pitch yet');
    }
    setHidden(el.last, !stale);
    el.hero.toggleAttribute('data-stale', stale);

    // cue and chip
    const dir = r === null ? 'none' : directionFor(centsNow, TOLERANCE_CENTS).toLowerCase();
    setAttr(el.hero, 'data-has', r === null ? 'none' : 'pitch');
    setAttr(el.hero, 'data-dir', dir);
    if (dir === 'flat') setHtml(el.dir, 'flat', `${ARROW_LEFT}<span class="va-dir-word">Flat</span>`);
    else if (dir === 'sharp') setHtml(el.dir, 'sharp', `<span class="va-dir-word">Sharp</span>${ARROW_RIGHT}`);
    else if (dir === 'within') setHtml(el.dir, 'within', `<span class="va-ok-dot" aria-hidden="true"></span><span class="va-dir-word">Within</span> <span class="va-dir-unit">±${TOLERANCE_CENTS} ${UNIT}</span>`);
    else setHtml(el.dir, 'none', '');
    setText(el.cents, r === null ? '' : centsLabel(centsNow));

    // meter
    if (r === null || !reading) {
      setHidden(el.marker, true);
      meterLabel('Cents meter: No pitch', true);
    } else {
      const c = Math.max(-50, Math.min(50, nearestNote(reading.f0, a4).cents));
      setHidden(el.marker, false);
      const left = `${50 + c}%`;
      if (el.marker.style.left !== left) el.marker.style.left = left;
      meterLabel(`Cents meter: ${r === 0 ? '0 cents' : `${Math.abs(r)} cents ${r < 0 ? 'flat' : 'sharp'}`}${stale ? ', last heard' : ''}`, false);
    }

    // gate hint and level
    const gate = vs === 'listening' && gateHintDue(newest?.t ?? null, belowSince, GATE_HINT_MS);
    if (gate && el.hint.hidden && performance.now() - gateSaidAt >= GATE_SAY_MS) {
      gateSaidAt = performance.now();
      say(`${GATE_TITLE} ${GATE_STEP}`);
    }
    setHidden(el.hint, !gate);
    const lvl = active && newest ? Math.max(0, Math.min(1, (newest.rmsDb - LEVEL_MIN_DB) / -LEVEL_MIN_DB)) : 0;
    const tf = `scaleX(${lvl.toFixed(3)})`;
    if (el.levelFill.style.transform !== tf) el.levelFill.style.transform = tf;

    // toggle
    const busy = vs === 'requesting' || vs === 'stopping';
    setHidden(el.toggle, copy.action === null);
    if (copy.action !== null) setText(el.toggleLabel, copy.action);
    if (el.toggle.disabled !== busy) el.toggle.disabled = busy;
    setAttr(el.toggle, 'data-state', busy ? 'busy' : active ? 'live' : 'idle');
    setHidden(el.spaceHint, !spaceOn || copy.action === null);

    // spectrogram meta: the span, then a state word, never a message and nothing over the plot (2.14)
    const specState = active ? (drawnAny ? '' : 'Waiting for sound') : vs === 'stopped' ? 'Stopped' : 'Not listening';
    setText(el.specState, specState);
    setHidden(el.specState, !specState);
    setText(el.specSpan, fs && info ? `0 to ${SPEC_TOP_HZ / 1000} kHz, last ${fx((RING_W * DEFAULT_HOP) / fs, 1)} s` : `0 to ${SPEC_TOP_HZ / 1000} kHz`);

    // Readings and Details: the newest frame, and the last 2.5 s for vibrato and the band ratio
    const voicedNow = !!newest && newest.voiced && newest.f0 > 0;
    const nowNote = voicedNow ? nearestNote(newest.f0, a4) : null;
    setText(el.mPitch, nowNote && newest ? `${fx(newest.f0, 1)} Hz` : 'No pitch');
    el.mPitch.toggleAttribute('data-empty', !nowNote);
    if (nowNote) {
      const n = Math.abs(Math.round(nowNote.cents) || 0);
      const glyph = noteGlyph(nowNote.name);
      setText(el.mOffby, n === 0 ? `0 cents from ${glyph}` : `${n} ${n === 1 ? 'cent' : 'cents'} ${nowNote.cents < 0 ? 'flat' : 'sharp'} of ${glyph}`);
    } else setText(el.mOffby, 'No pitch');
    el.mOffby.toggleAttribute('data-empty', !nowNote);
    setText(el.dF0, nowNote && newest ? `${fx(newest.f0, 2)} Hz` : 'No pitch');
    el.dF0.toggleAttribute('data-empty', !(nowNote && newest));
    setText(el.dDev, nowNote ? `${signedFixed(nowNote.cents, 1)} c from ${noteGlyph(nowNote.name)} (${fx(nowNote.targetHz, 2)} Hz)` : 'No pitch');
    el.dDev.toggleAttribute('data-empty', !nowNote);

    // Vibrato and the band ratio change only when a frame arrives; skip the work on frames with nothing new.
    if (vibSeq !== frameSeq || vibShown !== showReading) {
      vibSeq = frameSeq;
      vibShown = showReading;
      const recent = newest ? history.filter((h) => h.t > newest.t - VIB_WINDOW_S) : [];
      vibCache = recent.length ? analyzeVibrato(recent) : null;
      let eSf = 0, eRef = 0;
      for (const h of recent) if (h.voiced) { eSf += h.eSf; eRef += h.eRef; }
      bandCache = eSf > 0 && eRef > 0 ? 10 * Math.log10(eSf / eRef) : NaN;
    }
    const vib = vibCache, band = bandCache;
    // The number at --t-reading, the unit after it in --t-body-s (3.6). Text is still "{r} per second".
    setStat(el.mVibSpeed, vib ? fx(vib.rateHz, 1) : null, vib ? 'per second' : NO_VIB_SHORT);
    setStat(el.mVibWidth, vib ? `±${fx(vib.extentCents, 0)}` : null, vib ? 'cents' : NO_VIB_SHORT);
    setText(el.mVibSpeedNote, VIB_WINDOW_NOTE);
    setText(el.mVibWidthNote, VIB_WINDOW_NOTE);
    setHidden(el.mVibSpeedNote, false);
    setHidden(el.mVibWidthNote, false);
    setText(el.dP2p, vib ? `${fx(vib.extentPeakToPeakCents, 1)} cents` : NO_VIB);
    el.dP2p.toggleAttribute('data-empty', !vib);
    setText(el.dBand, Number.isFinite(band) ? `${signedFixed(band, 1)} dB, last ${VIB_WINDOW_S} s, voiced frames` : `No voiced frames in the last ${VIB_WINDOW_S} s`);
    el.dBand.toggleAttribute('data-empty', !Number.isFinite(band));
    const levelOk = !!(active && newest && Number.isFinite(newest.rmsDb));
    setText(el.dLevel, levelOk && newest ? `${fx(newest.rmsDb, 1)} dBFS` : 'Not listening');
    el.dLevel.toggleAttribute('data-empty', !levelOk);

    // Setup
    setText(el.sInput, info?.input ?? 'Shown while listening');
    el.sInput.toggleAttribute('data-empty', !info?.input);
    setText(el.sRate, info?.rate ?? 'Shown while listening');
    el.sRate.toggleAttribute('data-empty', !info?.rate);
    setText(el.sLatency, info?.latency ?? 'Shown while listening');
    el.sLatency.toggleAttribute('data-empty', !info?.latency);
    setText(el.sWindow, info?.window ?? `${DEFAULT_YIN.bufferSize} samples`);
  }

  // ------------------------------------------------ animation loop
  let visible = false;
  let raf = 0;
  function loop() {
    raf = requestAnimationFrame(loop); // re-arm first so a throw below cannot freeze the display
    try { if (drawColumns()) paint(); render(); } catch (e) { console.error('voice loop error', e); }
  }
  function syncLoop() {
    const want = visible && (live.status === 'listening' || live.status === 'stopping');
    if (want && !raf) raf = requestAnimationFrame(loop);
    if (!want && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
      if (drawColumns()) paint(); // the last columns before the stop
    }
  }

  clearCanvas();
  syncSpace();
  document.addEventListener('keydown', onKey);

  // Route commit (6.5): the router shows a route by unhiding its section, after enter() and only if no newer
  // navigation superseded it. Watching the sections here means a superseded enter() leaves nothing running:
  // the loop and Space follow the committed route, not enter(). Safety net: when the committed route is not
  // Voice analysis and the mic is still owned by 'voice' (for example Overview's start, then a quick second
  // navigation elsewhere), stop it.
  function onCommit() {
    const committed = document.querySelector<HTMLElement>('[data-route]:not([hidden])')?.dataset.route ?? null;
    const isVoice = committed === 'voice';
    if (isVoice !== visible) {
      visible = isVoice;
      syncLoop();
      if (visible) { sizeCanvas(); render(); }
    }
    const snap = live.snapshot();
    if (!isVoice && committed !== null && snap.owner === 'voice' && (snap.status === 'requesting' || snap.status === 'listening')) {
      void live.stop().then(() => live.reset());
    }
  }
  const commitObserver = new MutationObserver(onCommit);
  for (const sec of document.querySelectorAll('[data-route]')) commitObserver.observe(sec, { attributes: true, attributeFilter: ['hidden'] });


  return {
    title: 'Voice analysis',
    nav: 'tools',
    // enter() only prepares state; nothing it does keeps running if the navigation is superseded.
    async enter() {
      if (live.status === 'stopping') await live.stop();
      // A4 is shared with Recording analysis, which may have changed it since this view was built.
      const shared = currentA4();
      if (shared !== a4) { a4 = shared; el.a4.value = String(a4); syncA4ro(); clearA4Error(); }
      const snap = live.snapshot();
      // 6.6: a session that Overview started (requesting or listening) is kept; anything else starts clean.
      // A failed start owned by 'voice' (from Overview's button) keeps its message.
      if (snap.status !== 'requesting' && snap.status !== 'listening') {
        if (!(snap.status === 'error' && snap.owner === 'voice')) live.reset();
        resetView();
      }
      render();
      // 3.0 Denied row: the Permissions API can say 'denied' before she presses anything.
      try {
        navigator.permissions?.query({ name: 'microphone' as PermissionName })
          .then((p) => { if (p.state === 'denied') live.markDenied(); })
          .catch(() => { /* not reported by this browser */ });
      } catch { /* not reported by this browser */ }
    },
    // The old route stays visible (showing "Stopping…") until this settles; the commit observer then turns off
    // the loop and Space. Not touching `visible` here keeps Voice live if a newer navigation comes straight back.
    async leave() {
      await live.stop();
      live.reset(); // the next visit starts at Idle (VA-01)
    },
  };
}
