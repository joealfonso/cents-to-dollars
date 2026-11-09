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
import { savedA4, setField } from '../fields.ts';
import { TOLERANCE_CENTS, HOLD_FULL_MS, GATE_HINT_MS } from '../readout-constants.ts';
import {
  MINUS, signedFixed, centsLabel, noteGlyph, splitNote, directionFor, holdExpired, gateHintDue, shouldAnnounce, stableFor,
  type Announced,
} from '../readout.ts';
import { nearestNote } from '../../dsp/pitch.ts';
import { analyzeVibrato } from '../../dsp/vibrato.ts';
import { SF_BAND, REF_BAND } from '../../dsp/spectrum.ts';
import { DEFAULT_YIN } from '../../dsp/yin.ts';
import { DEFAULT_HOP } from '../../dsp/analyzer.ts';

// ---------------------------------------------------------------- UI constants (from the legacy main.ts)
const SPEC_TOP_HZ = 4000;
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

const A4_KEY = 'centstodollars.a4';
const SPACE_KEY = 'centstodollars.space';
const A4_MIN = 400;
const A4_MAX = 480;

// ---------------------------------------------------------------- states and copy (3.0)
type ViewState =
  | 'idle' | 'requesting' | 'listening' | 'stopping' | 'stopped'
  | 'denied' | 'nodevice' | 'busy' | 'insecure' | 'analyser' | 'ended';

interface Copy { chip: string; msg: string; action: string | null; error: boolean }
const COPY: Record<ViewState, Copy> = {
  idle: { chip: 'Idle', msg: 'Press Start listening and sing a steady note. Audio stays in this browser and is not saved.', action: 'Start listening', error: false },
  requesting: { chip: 'Waiting for permission', msg: 'Your browser is asking to use the microphone. Choose Allow.', action: 'Waiting for permission…', error: false },
  listening: { chip: 'Listening', msg: '', action: 'Stop listening', error: false },
  stopping: { chip: 'Listening', msg: '', action: 'Stopping…', error: false },
  stopped: { chip: 'Stopped', msg: '', action: 'Start listening', error: false },
  denied: { chip: 'Microphone blocked', msg: "Microphone access is blocked for this page. Allow it in the browser's site settings, then press Try again.", action: 'Try again', error: true },
  nodevice: { chip: 'No microphone', msg: 'No microphone found. Connect one or switch on your audio interface, then press Try again.', action: 'Try again', error: true },
  busy: { chip: 'Microphone unavailable', msg: 'The microphone could not be opened. Another app may be using it. Close it, then press Try again.', action: 'Try again', error: true },
  insecure: { chip: 'Not available', msg: 'The microphone only works on a secure page. Open http://127.0.0.1:5173.', action: null, error: true },
  analyser: { chip: 'Error', msg: 'This browser could not start the audio analyser.', action: 'Try again', error: true },
  ended: { chip: 'Microphone stopped', msg: 'The microphone stopped. It may have been unplugged. Press Start listening to continue.', action: 'Start listening', error: true },
};

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

const tolLeft = 50 - TOLERANCE_CENTS;
const gatePct = Math.max(0, Math.min(100, ((SILENCE_DB - LEVEL_MIN_DB) / -LEVEL_MIN_DB) * 100));

const kv = (label: string, id: string, empty: string, labelId = '') => `
      <div class="kv"><dt class="kv-label"${labelId ? ` id="${labelId}"` : ''}>${label}</dt><dd class="kv-body"><span class="kv-value" id="${id}">${empty}</span><span class="va-kv-note" id="${id}-note" hidden></span></dd></div>`;

const html = `
<div class="shell route va-route">
  <header class="page-header va-header">
    <div class="ph-text">
      <p class="eyebrow va-crumb"><a class="link" href="#/tools">Tools</a> / Voice analysis</p>
      <h1 id="va-title" tabindex="-1">Voice analysis</h1>
    </div>
  </header>

  <div class="va-grid">
    <section class="panel va-hero" id="va-hero" aria-labelledby="va-hero-title" data-has="none">
      <div class="strip">
        <h2 class="strip-title" id="va-hero-title">Note</h2>
        <span class="chip-tilt"><span class="va-status"><span class="dot" id="va-status-dot" aria-hidden="true"></span><span id="va-readout-status">Idle</span></span></span>
      </div>
      <div class="va-hero-body">
        <div class="va-note-slot">
          <p class="va-note" id="va-note-line" data-empty>
            <span class="va-glyphs" aria-hidden="true"><span class="va-last" id="va-readout-last" hidden>Last:</span><span class="va-letter" id="va-readout-note">No pitch yet</span><span class="va-ao"><span class="va-acc" id="va-readout-acc"></span><span class="va-oct" id="va-readout-oct"></span></span></span>
            <span class="visually-hidden" id="va-note-spoken">No pitch yet</span>
          </p>
          <p class="va-msg" id="va-readout-msg"></p>
          <div class="va-error" id="va-readout-error" hidden>
            <p class="va-error-text" id="va-readout-error-text"></p>
            <details class="disclosure va-error-more" id="va-readout-error-details" hidden><summary>Details</summary><pre class="va-error-raw" id="va-readout-error-raw"></pre></details>
          </div>
        </div>

        <div class="va-cue-row">
          <p class="va-dir" id="va-readout-dir"></p>
          <p class="va-chip"><span class="va-cents" id="va-readout-cents"></span><span class="va-unit">${UNIT}</span></p>
        </div>

        <div class="va-meter" id="va-cents-meter" role="img" aria-label="Cents meter: No pitch">
          <div class="va-track">
            <span class="va-tol" id="va-cents-tol-zone" style="left:${tolLeft}%;width:${2 * TOLERANCE_CENTS}%"></span>
            <span class="va-tick" style="left:0"></span><span class="va-tick va-tick-mid" style="left:50%"></span><span class="va-tick" style="left:100%"></span>
            <span class="va-marker" id="va-cents-marker" hidden></span>
          </div>
        </div>

        <div class="va-cap-row">
          <p class="va-caption">Nearest note in equal temperament</p>
          <div class="va-a4" role="group" aria-labelledby="va-a4-label">
            <label class="va-a4-label" id="va-a4-label" for="va-a4">A4</label>
            <button type="button" class="btn va-step" id="va-a4-dec" aria-label="Lower A4 by 1 hertz">${MINUS}</button>
            <input class="va-a4-input" id="va-a4" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" aria-describedby="va-a4-unit va-a4-error">
            <span class="va-a4-unit" id="va-a4-unit">Hz</span>
            <button type="button" class="btn va-step" id="va-a4-inc" aria-label="Raise A4 by 1 hertz">+</button>
          </div>
        </div>
        <p class="va-a4-error" id="va-a4-error" role="status"></p>

        <div class="va-hint-slot"><p class="va-hint" id="va-readout-gate-hint" hidden>I can't hear you. Move closer or turn the input up.</p></div>

        <div class="va-level" id="va-level-meter" aria-hidden="true"><span class="va-level-fill" id="va-level-fill"></span><span class="va-level-gate" style="left:${gatePct}%"></span></div>

        <button type="button" class="btn btn-primary va-toggle" id="va-live-toggle" data-state="idle">Start listening</button>
        <p class="va-space-hint" id="va-space-hint">Space bar also starts and stops</p>
      </div>
      <p class="visually-hidden" id="va-readout-announce" role="status"></p>
    </section>

    <section class="va-spec" aria-labelledby="va-spec-title">
      <div class="plot-frame">
        <div class="panel va-spec-panel">
          <div class="strip"><h2 class="strip-title" id="va-spec-title">Spectrogram</h2><span class="strip-meta" id="va-spec-span">0 to ${SPEC_TOP_HZ / 1000} kHz</span></div>
          <div class="va-plot">
            <div class="va-axis" aria-hidden="true"><span>${SPEC_TOP_HZ / 1000} kHz</span><span>3</span><span>2</span><span>1</span><span>0</span></div>
            <div class="va-canvas-wrap">
              <canvas id="va-spectrogram" width="960" height="300" role="img" aria-label="Spectrogram 0 to 4 kHz with pitch marks. The readings are listed as text in the Readings panel."></canvas>
              <div class="va-overlay" id="va-spec-overlay"><p id="va-spec-overlay-text">Not listening. The plot fills from the right when you start.</p></div>
              <span class="va-spec-chip" id="va-spec-stopped" hidden>Stopped</span>
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

    <section class="panel va-readings" aria-labelledby="va-readings-title">
      <div class="strip"><h2 class="strip-title" id="va-readings-title">Readings</h2></div>
      <dl class="kv-list">${kv('Pitch', 'va-m-pitch', 'No pitch')}${kv('Off by', 'va-m-offby', 'No pitch')}${kv('Vibrato speed', 'va-m-vib-speed', `No vibrato found in the last ${VIB_WINDOW_S} s`)}${kv('Vibrato width', 'va-m-vib-width', `No vibrato found in the last ${VIB_WINDOW_S} s`)}
      </dl>
      <details class="disclosure va-details" id="va-details">
        <summary>Details</summary>
        <dl class="kv-list">${kv('F0', 'va-d-f0', 'No pitch')}${kv('Deviation', 'va-d-dev', 'No pitch')}${kv('Vibrato extent, peak to peak', 'va-d-vib-p2p', `No vibrato found in the last ${VIB_WINDOW_S} s`)}${kv(`Energy ${fx(SF_BAND[0] / 1000, 1)} to ${fx(SF_BAND[1] / 1000, 1)} kHz vs ${fx(REF_BAND[0] / 1000, 2)} to ${REF_BAND[1] / 1000} kHz`, 'va-d-band', `No voiced frames in the last ${VIB_WINDOW_S} s`)}${kv('Input level', 'va-d-level', 'Not listening')}${kv('Voicing gate', 'va-d-gate', `${fx(SILENCE_DB, 0)} dBFS`)}
        </dl>
      </details>
    </section>

    <details class="panel disclosure va-setup" id="va-setup">
      <summary>Setup</summary>
      <dl class="kv-list">${kv('Input', 'va-s-input', 'Shown while listening')}${kv('Sample rate', 'va-s-rate', 'Shown while listening')}${kv('Base latency', 'va-s-latency', 'Shown while listening')}${kv('Analysis window', 'va-s-window', `${DEFAULT_YIN.bufferSize} samples`)}${kv('Display range', 'va-s-range', `0 to ${SPEC_TOP_HZ / 1000} kHz`)}
        <div class="kv"><dt class="kv-label" id="va-s-space-label">Space bar shortcut</dt><dd class="kv-body"><label class="va-switch"><input type="checkbox" role="switch" id="va-s-space" aria-labelledby="va-s-space-label" checked><span class="kv-value" id="va-s-space-text" aria-hidden="true">On</span></label></dd></div>
      </dl>
    </details>

    <section class="panel va-howto" aria-labelledby="va-howto-title">
      <div class="strip"><h2 class="strip-title" id="va-howto-title">How to read this</h2></div>
      <div class="pbody">
        <p class="prose">Cents are the distance from the nearest equal-tempered note at your A4. Singers often tune away from equal temperament, so a few cents is not a mistake.</p>
        <p class="prose">If the octave looks wrong, compare the orange marks with the lowest strong band in the spectrogram. The live view sometimes jumps an octave; this is a known limit (VALIDATION.md section 4).</p>
        <p class="prose"><a class="link" href="/MEASUREMENT.md">MEASUREMENT.md</a> and <a class="link" href="/VALIDATION.md">VALIDATION.md</a> (dev server only, opens raw text)</p>
      </div>
    </section>
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
    msg: $('va-readout-msg'), error: $('va-readout-error'), errorText: $('va-readout-error-text'),
    errorDetails: $<HTMLDetailsElement>('va-readout-error-details'), errorRaw: $('va-readout-error-raw'),
    dir: $('va-readout-dir'), cents: $('va-readout-cents'),
    meter: $('va-cents-meter'), marker: $('va-cents-marker'),
    a4: $<HTMLInputElement>('va-a4'), a4Dec: $<HTMLButtonElement>('va-a4-dec'), a4Inc: $<HTMLButtonElement>('va-a4-inc'),
    a4Error: $('va-a4-error'),
    hint: $('va-readout-gate-hint'), levelFill: $('va-level-fill'),
    toggle: $<HTMLButtonElement>('va-live-toggle'), spaceHint: $('va-space-hint'),
    announce: $('va-readout-announce'),
    canvas: $<HTMLCanvasElement>('va-spectrogram'), overlay: $('va-spec-overlay'), overlayText: $('va-spec-overlay-text'),
    specStopped: $('va-spec-stopped'), specSpan: $('va-spec-span'),
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
  const col = rg ? rg.createImageData(1, RING_H) : null;

  type Rgba = [number, number, number, number];
  function toRgba(c: string): Rgba {
    if (!rg) return [0, 0, 0, 1];
    rg.fillStyle = '#000';
    rg.fillStyle = c;
    const s = String(rg.fillStyle);
    if (s[0] === '#') return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 1];
    const m = s.match(/[\d.]+/g);
    return m ? [Number(m[0]), Number(m[1]), Number(m[2]), m[3] === undefined ? 1 : Number(m[3])] : [0, 0, 0, 1];
  }
  function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
    const surface = toRgba(v('--surface-plot', '#FBFAF6'));
    const energy = toRgba(v('--plot-energy', '#141413'));
    const ramp = Array.from({ length: 256 }, (_, i): Rgba => {
      const t = i / 255;
      return [0, 1, 2].map((k) => Math.round(surface[k] + (energy[k] - surface[k]) * t)).concat(1) as Rgba;
    });
    const band = toRgba(v('--plot-band', 'rgba(228,64,27,0.35)'));
    const sameAsSurface = [0, 1, 2].every((k) => band[k] === surface[k]);
    return { surface, ramp, f0: toRgba(v('--signal', '#E4401B')), band, bandHalo: sameAsSurface ? toRgba(v('--ink', '#0A0A0A')) : surface };
  }
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
    paint();
  }

  const rowOf = (hz: number) => Math.round(RING_H - 1 - (hz / SPEC_TOP_HZ) * (RING_H - 1));
  function put(d: Uint8ClampedArray, y: number, c: Rgba) {
    if (y < 0 || y >= RING_H) return;
    const i = y * 4, a = c[3];
    d[i] = Math.round(c[0] * a + d[i] * (1 - a));
    d[i + 1] = Math.round(c[1] * a + d[i + 1] * (1 - a));
    d[i + 2] = Math.round(c[2] * a + d[i + 2] * (1 - a));
    d[i + 3] = 255;
  }

  /** Writes the queued frames into the ring. Returns true if anything was drawn. */
  function drawColumns(): boolean {
    if (!rg || !col || !fs) { pendingCols = []; return false; }
    let cols = pendingCols.splice(0);
    if (!cols.length) return false;
    if (cols.length > RING_W) cols = cols.slice(-RING_W);
    const N = DEFAULT_YIN.bufferSize, d = col.data;
    for (const f of cols) {
      for (let y = 0; y < RING_H; y++) {
        let c = pal.surface;
        if (f.power) {
          const hz = ((RING_H - 1 - y) / (RING_H - 1)) * SPEC_TOP_HZ;
          const p = f.power[Math.round((hz * N) / fs)] ?? 0;
          const db = 10 * Math.log10(p + 1e-12);
          const v = Math.max(0, Math.min(1, (db + 20) / 80)); // -20..60 dB of raw FFT power, as on the legacy page
          if (v > 0) c = pal.ramp[Math.round(v * 255)];
        }
        const i = y * 4;
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
      }
      // Band lines get a 1px halo like the F0 mark so they read on mid-grey energy (1.4.11). In Loud the line
      // colour is the plot colour, so the halo there is ink.
      for (const hz of SF_BAND) { const y = rowOf(hz); put(d, y - 1, pal.bandHalo); put(d, y + 1, pal.bandHalo); put(d, y, pal.band); }
      if (f.voiced && f.f0 > 0) {
        // F0 mark with a 1px halo in the plot colour, so it reads on mid-grey energy (1.4)
        const y = rowOf(f.f0);
        put(d, y - 3, pal.surface); put(d, y + 3, pal.surface);
        for (let k = -2; k <= 2; k++) put(d, y + k, pal.f0);
      }
      rg.putImageData(col, ringX, 0);
      ringX = (ringX + 1) % RING_W;
    }
    return true;
  }

  // ------------------------------------------------ A4 stepper (2.8)
  let a4 = savedA4();
  let a4Invalid = false;
  el.a4.value = String(a4);
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
    clearA4Error();
    if (!changed) return;
    try { localStorage.setItem(A4_KEY, String(v)); } catch { /* keep it for this visit */ }
    setField('a4', { status: 'info', value: `${v} Hz` });
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
  el.a4.addEventListener('keydown', (e) => { if (e.key === 'Enter') validateA4(); });
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
    if (vs !== prevVs && prevVs !== null && vs !== 'idle' && vs !== 'stopping') {
      const c = COPY[vs];
      say(c.msg ? `${c.chip}. ${c.msg}` : c.chip);
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

    // note block, message, error
    setHidden(el.noteLine, copy.error);
    setHidden(el.error, !copy.error);
    setText(el.errorText, copy.error ? copy.msg : '');
    const showDetails = vs === 'analyser' && !!snap.detail;
    setHidden(el.errorDetails, !showDetails);
    setText(el.errorRaw, showDetails ? snap.detail : '');
    setText(el.msg, !copy.error && !reading ? copy.msg : '');
    setHidden(el.msg, copy.error || !!reading || !copy.msg);

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
    else if (dir === 'within') setHtml(el.dir, 'within', `<span class="va-ok-dot" aria-hidden="true"></span><span class="va-dir-word">Within ±${TOLERANCE_CENTS}</span> <span class="va-dir-unit">${UNIT}</span>`);
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
    setHidden(el.hint, !gate);
    const lvl = active && newest ? Math.max(0, Math.min(1, (newest.rmsDb - LEVEL_MIN_DB) / -LEVEL_MIN_DB)) : 0;
    const tf = `scaleX(${lvl.toFixed(3)})`;
    if (el.levelFill.style.transform !== tf) el.levelFill.style.transform = tf;

    // toggle
    const busy = vs === 'requesting' || vs === 'stopping';
    setHidden(el.toggle, copy.action === null);
    if (copy.action !== null) setText(el.toggle, copy.action);
    if (el.toggle.disabled !== busy) el.toggle.disabled = busy;
    setAttr(el.toggle, 'data-state', busy ? 'busy' : active ? 'live' : 'idle');
    setHidden(el.spaceHint, !spaceOn || copy.action === null);

    // spectrogram overlay, chip and span
    const overlay = active ? null : copy.error ? copy.msg : vs === 'stopped' ? null : 'Not listening. The plot fills from the right when you start.';
    setHidden(el.overlay, overlay === null);
    if (overlay !== null) setText(el.overlayText, overlay);
    setHidden(el.specStopped, vs !== 'stopped');
    setText(el.specSpan, fs && info ? `0 to ${SPEC_TOP_HZ / 1000} kHz, last ${fx((RING_W * DEFAULT_HOP) / fs, 1)} s` : `0 to ${SPEC_TOP_HZ / 1000} kHz`);

    // Readings and Details: the newest frame, and the last 2.5 s for vibrato and the band ratio
    const voicedNow = !!newest && newest.voiced && newest.f0 > 0;
    const nowNote = voicedNow ? nearestNote(newest.f0, a4) : null;
    setText(el.mPitch, nowNote && newest ? `${fx(newest.f0, 1)} Hz` : 'No pitch');
    if (nowNote) {
      const n = Math.abs(Math.round(nowNote.cents) || 0);
      const glyph = noteGlyph(nowNote.name);
      setText(el.mOffby, n === 0 ? `0 cents from ${glyph}` : `${n} ${n === 1 ? 'cent' : 'cents'} ${nowNote.cents < 0 ? 'flat' : 'sharp'} of ${glyph}`);
    } else setText(el.mOffby, 'No pitch');
    setText(el.dF0, nowNote && newest ? `${fx(newest.f0, 2)} Hz` : 'No pitch');
    setText(el.dDev, nowNote ? `${signedFixed(nowNote.cents, 1)} c from ${noteGlyph(nowNote.name)} (${fx(nowNote.targetHz, 2)} Hz)` : 'No pitch');

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
    const noVib = `No vibrato found in the last ${VIB_WINDOW_S} s`;
    setText(el.mVibSpeed, vib ? `${fx(vib.rateHz, 1)} per second` : noVib);
    setText(el.mVibWidth, vib ? `±${fx(vib.extentCents, 0)} cents` : noVib);
    setText(el.mVibSpeedNote, `last ${VIB_WINDOW_S} s`);
    setText(el.mVibWidthNote, 'up and down from the middle');
    setHidden(el.mVibSpeedNote, !vib);
    setHidden(el.mVibWidthNote, !vib);
    setText(el.dP2p, vib ? `${fx(vib.extentPeakToPeakCents, 1)} cents` : noVib);
    setText(el.dBand, Number.isFinite(band) ? `${signedFixed(band, 1)} dB, last ${VIB_WINDOW_S} s, voiced frames` : `No voiced frames in the last ${VIB_WINDOW_S} s`);
    setText(el.dLevel, active && newest && Number.isFinite(newest.rmsDb) ? `${fx(newest.rmsDb, 1)} dBFS` : 'Not listening');

    // Setup
    setText(el.sInput, info?.input ?? 'Shown while listening');
    setText(el.sRate, info?.rate ?? 'Shown while listening');
    setText(el.sLatency, info?.latency ?? 'Shown while listening');
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
