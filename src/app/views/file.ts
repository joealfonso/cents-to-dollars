// Recording analysis, #/file (M2.1). Screen design: design/M2-DESIGN.md sections 2.1 to 2.3 and 3; behaviour
// and criteria: specs/M2.md section 4 (F-01 to F-30); pipeline: specs/M2.1-API.md (src/file/client.ts).
//
// One job at a time. Each open takes a token; progress, results and errors from an older token are dropped,
// and the client also cancels the old Worker (F-16). Leaving the route aborts the job before the leave
// resolves, so no progress arrives afterwards (F-17). Progress values only go up and reach 100 only in Done
// (F-18). The file name is only ever set with textContent (F-21). A4 changes recompute cents and note names
// from the stored F0 with centsSeries, with no new Worker job (F-22, F-23).
//
// Not built here: "Measure a held note" (3.5) belongs to M2.3a/E1, which is not built. Option A rate refusal
// (Q1 decided Option B). The clipped-sample count (CUTTABLE, the samples do not come back from the Worker).

import { parseHash, type Route } from '../router.ts';
import { analyseFile, type AnalysedFile } from '../../file/client.ts';
import { TakeError } from '../../take/errors.ts';
import { MAX_DURATION_S, MAX_FILE_BYTES, MAX_COMPRESSED_BYTES } from '../../take/limits.ts';
import { precheckFile } from '../../file/decode.ts';
import { centsSeries } from '../../take/cents.ts';
import { VIB_WINDOW_S, VIB_STEP_S } from '../../take/analyse.ts';
import { DEFAULT_YIN } from '../../dsp/yin.ts';
import { SF_BAND, REF_BAND } from '../../dsp/spectrum.ts';
import { nearestNote } from '../../dsp/pitch.ts';
import { savedA4, setField } from '../fields.ts';
import { MINUS, signedFixed, noteGlyph, splitNote } from '../readout.ts';
import { SPEC_TOP_HZ, readSpecPalette, onSpecPaletteChange, type SpecPalette } from '../spectrogram.ts';
import {
  FIG_H, vibRowLayout, nearestFrame, pitchRange, pitchLabels, drawPitch, drawCents, centsY, deviation,
  vibAxis, drawVibrato, drawSpectrogram, drawOverview, timeTicks, semis, type View, type VibAxis,
} from '../take-figures.ts';
import '../../styles/file.css';

// ---------------------------------------------------------------- constants

/**
 * PLACEHOLDER (OPEN D5, M2-DESIGN.md 3.4): the default visible span, s. A take up to this long opens whole;
 * a longer one opens on this many seconds from the first voiced frame. 10 s keeps a 5 to 7 Hz vibrato a few
 * pixels per cycle on a 375px screen. Needs her typical take length.
 */
export const FILE_VIEW_DEFAULT_S = 10;

/** The method label (F-28), verbatim in both themes. */
const METHOD = 'Whole take (YIN + continuity)';

/** V-07 (resampled rates) and V-08 (MP3, AAC) have no verified numbers in VALIDATION.md yet, so the notes
 *  say "unverified" (spec 2.1). Set to true in the change that lands the verified numbers. */
const V07_VERIFIED = false;
const V08_VERIFIED = false;

const A4_KEY = 'centstodollars.a4';
const A4_MIN = 400;
const A4_MAX = 480;
/** Pixel move that turns a click on the figures into a drag (2.2). Drags are reserved for span selection (3.5). */
const DRAG_PX = 4;
/** Height of one axis label line, for thinning the pitch labels. */
const LABEL_PX = 16;

// ---------------------------------------------------------------- formatting

const fx = (x: number, d: number) => x.toFixed(d).replace(/^-/, MINUS);

/** m:ss with `d` decimals on the seconds. */
function clock(s: number, d: number): string {
  const p = 10 ** d;
  const tot = Math.round(s * p) / p;
  const m = Math.floor(tot / 60);
  const sec = tot - m * 60;
  return `${m}:${sec.toFixed(d).padStart(d ? d + 3 : 2, '0')}`;
}

/** A limit in plain words: 600 -> "10 minutes". */
function limitText(s: number): string {
  if (s % 60 === 0) { const m = s / 60; return `${m} ${m === 1 ? 'minute' : 'minutes'}`; }
  return `${clock(s, 0)} (m:ss)`;
}

const mb = (bytes: number) => (bytes / 1e6).toFixed(1);

function centsWords(dev: number): string {
  const n = Math.abs(Math.round(dev) || 0);
  if (n === 0) return '0 cents';
  return `${n} ${n === 1 ? 'cent' : 'cents'} ${dev < 0 ? 'flat' : 'sharp'}`;
}

// ---------------------------------------------------------------- markup

const kv = (label: string, id: string, empty = '', withNote = false) => `
      <div class="kv"><dt class="kv-label">${label}</dt><dd class="kv-body"><span class="kv-value" id="${id}">${empty}</span>${withNote ? `<span class="fa-kv-note" id="${id}-note" hidden></span>` : ''}</dd></div>`;

const infoItem = (label: string, body: string, k: string) => `
        <div class="fa-i" data-k="${k}"><dt class="fa-i-label">${label}</dt><dd class="fa-i-body">${body}</dd></div>`;

const fig = (n: number, title: string, cap: string, canvasId: string, extra = '') => `
      <figure class="fa-fig" data-fig="${canvasId}">
        <figcaption class="fa-fig-head"><span class="fa-fig-title">Fig. ${n} ${title}</span><span class="fa-fig-cap">${cap}</span></figcaption>
        ${extra}
        <div class="fa-plot">
          <div class="fa-yaxis" data-axis="${canvasId}" aria-hidden="true"></div>
          <div class="fa-cwrap" data-wrap="${canvasId}">
            <canvas id="${canvasId}" role="img"></canvas>
            <span class="fa-cline" aria-hidden="true" hidden></span>
            <div class="fa-nopitch" hidden><p>No pitch found in this recording</p></div>
          </div>
        </div>
      </figure>`;

const btn = (id: string, label: string) => `<button type="button" class="btn btn-ghost fa-vbtn" id="${id}">${label}</button>`;

const limitsLine = MAX_DURATION_S > 0 && MAX_FILE_BYTES > 0
  ? `<p class="prose" id="fa-limits">Up to ${limitText(MAX_DURATION_S)} and ${mb(MAX_FILE_BYTES)} MB.</p>` : '';

const html = `
<div class="shell route fa-route" data-state="empty">
  <header class="page-header">
    <div class="ph-text">
      <p class="eyebrow fa-crumb"><a class="link" href="#/tools">Tools</a> / Recording analysis</p>
      <h1 id="fa-title" tabindex="-1">Recording analysis</h1>
      <p class="lede">Open a recording from this computer. It is analysed in this browser and never uploaded.</p>
    </div>
    <div class="ph-action">
      <button type="button" class="btn btn-primary" id="fa-open">Open an audio file</button>
      <input type="file" id="fa-input" class="visually-hidden" tabindex="-1" aria-hidden="true" accept=".wav,.wave,.mp3,.m4a,.mp4,.aac,audio/wav,audio/x-wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/aac">
    </div>
  </header>

  <div class="fa-content" id="fa-content">
    <p class="fa-line" id="fa-cleared" hidden>The last recording was cleared when you left this page. Nothing is saved.</p>
    <p class="fa-line fa-notice" id="fa-notice" hidden></p>

    <section class="panel fa-info-panel" id="fa-info-panel" aria-labelledby="fa-info-title" hidden>
      <h2 class="visually-hidden" id="fa-info-title">File</h2>
      <dl class="fa-info" id="fa-info">${infoItem('File', '<span class="fa-i-value fa-name" id="fa-info-name"></span>', 'name')}${infoItem('Duration', '<span class="fa-i-value" id="fa-info-dur"></span>', 'dur')}${infoItem('Sample rate', '<span class="fa-i-value" id="fa-info-rate"></span><span class="fa-i-note" id="fa-info-rate-note" hidden></span><a class="link fa-i-note" id="fa-info-rate-link" href="/VALIDATION.md" hidden>How resampling affects accuracy</a>', 'rate')}${infoItem('Channels', '<span class="fa-i-value" id="fa-info-ch"></span>', 'ch')}${infoItem('Method', `<span class="fa-i-value" id="fa-info-method">${METHOD}</span>`, 'method')}${infoItem('<label for="fa-a4">A4</label>', `
          <span class="fa-a4" role="group" aria-label="Reference A4">
            <button type="button" class="btn fa-step" id="fa-a4-dec" aria-label="Lower A4 by 1 hertz">${MINUS}</button>
            <input class="fa-a4-input" id="fa-a4" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" aria-describedby="fa-a4-unit fa-a4-error">
            <span class="fa-a4-unit" id="fa-a4-unit">Hz</span>
            <button type="button" class="btn fa-step" id="fa-a4-inc" aria-label="Raise A4 by 1 hertz">+</button>
          </span>`, 'a4')}
      </dl>
      <p class="fa-a4-error" id="fa-a4-error" role="status"></p>
      <p class="fa-marker" id="fa-notes-marker" hidden><button type="button" class="fa-linkbtn" id="fa-notes-link"></button></p>
    </section>

    <div class="fa-grid">
      <section class="panel fa-main" id="fa-main" aria-labelledby="fa-empty-title">
        <div class="strip fa-figs-strip" id="fa-figs-strip" hidden><h2 class="strip-title" id="fa-figs-title">Figures</h2><span class="strip-meta">${METHOD}</span></div>

        <div class="fa-body fa-drop" id="fa-body-empty">
          <h2 class="panel-title" id="fa-empty-title">Open a recording</h2>
          <p class="prose">Choose a WAV, MP3 or M4A file, or drop it here.</p>
          ${limitsLine}
          <p class="prose">It stays on this computer.</p>
        </div>

        <div class="fa-body progress" id="fa-body-progress" hidden>
          <h2 class="visually-hidden" id="fa-progress-title">Progress</h2>
          <p class="progress-text" id="fa-progress-text"></p>
          <div class="progress-bar" id="fa-progress" role="progressbar" aria-label="Analysis progress" aria-valuemin="0" aria-valuemax="100" data-mode="indeterminate"><span class="progress-fill" id="fa-progress-fill"></span></div>
          <p class="progress-why" id="fa-progress-why" hidden>The plots appear when the whole recording is analysed. Each pitch is chosen with the whole take in view, so there is nothing to show part way.</p>
          <p class="progress-actions"><button type="button" class="btn btn-ghost" id="fa-cancel">Cancel</button></p>
        </div>

        <div class="fa-body" id="fa-body-msg" hidden>
          <h2 class="visually-hidden" id="fa-msg-title">Result</h2>
          <p class="fa-message" id="fa-message" hidden></p>
          <div class="fa-error" id="fa-error" hidden>
            <p class="fa-error-text" id="fa-error-text"></p>
            <p class="prose" id="fa-error-extra" hidden></p>
            <details class="disclosure fa-error-more" id="fa-error-details" hidden><summary>Details</summary><pre class="fa-error-raw" id="fa-error-raw"></pre></details>
          </div>
        </div>

        <div class="fa-body fa-stack" id="fa-figs" hidden>
          <div class="fa-ov-row" id="fa-ov-row">
            <span class="fa-axis-spacer" aria-hidden="true"></span>
            <div class="fa-ov-wrap" id="fa-overview-wrap" title="Whole take. Click or drag to move the view.">
              <canvas id="fa-overview" aria-hidden="true"></canvas>
              <span class="fa-ov-rect" id="fa-ov-rect" aria-hidden="true"></span>
            </div>
          </div>
          <div class="fa-viewbar" id="fa-view">
            <p class="fa-view-text" id="fa-view-text" aria-live="off"></p>
            <div class="fa-view-btns" role="group" aria-label="View">${btn('fa-earlier', 'Earlier')}${btn('fa-later', 'Later')}${btn('fa-zoom-in', 'Zoom in')}${btn('fa-zoom-out', 'Zoom out')}${btn('fa-whole', 'Whole take')}</div>
          </div>
          <p class="fa-cursor-line" id="fa-cursor-line"></p>
          <div class="fa-plots" id="fa-plots">
            ${fig(1, 'Pitch', 'Each dot is one moment of your pitch.', 'fa-fig-pitch')}
            ${fig(2, 'Cents', 'How far each moment is from the nearest note. Above the middle line is sharp, below is flat.', 'fa-fig-cents')}
            ${fig(3, 'Vibrato', 'How fast and how wide your vibrato is over time. Hollow dots: no vibrato found there.', 'fa-fig-vib')}
            ${fig(4, 'Spectrogram', '<span class="v-paper">Brightness shows how strong each frequency is. Orange dots are your pitch.</span><span class="v-loud">Brightness shows how strong each frequency is. Pink dots are your pitch.</span>', 'fa-fig-spec')}
            <div class="fa-taxis-row"><span class="fa-axis-spacer" aria-hidden="true"></span><div class="fa-taxis" id="fa-taxis" aria-hidden="true"></div></div>
            <div class="fa-cursor" id="fa-cursor" role="slider" tabindex="0" aria-label="Time cursor" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"></div>
          </div>
          <ul class="fa-legend" role="list">
            <li><span class="fa-sw fa-sw-f0" aria-hidden="true"></span>F0</li>
            <li><span class="fa-sw fa-sw-band" aria-hidden="true"></span>${fx(SF_BAND[0] / 1000, 1)} to ${fx(SF_BAND[1] / 1000, 1)} kHz band</li>
          </ul>
          <details class="disclosure fa-figs-about" id="fa-figs-about">
            <summary>About these figures</summary>
            <dl class="kv-list">
              ${kv('Pitch', 'fa-cap-pitch')}${kv('Cents', 'fa-cap-cents')}${kv('Vibrato', 'fa-cap-vib')}${kv('Spectrogram', 'fa-cap-spec', 'Zoomed out, each column is the average of the frames it covers.')}
            </dl>
          </details>
        </div>
      </section>

      <section class="panel fa-readings" id="fa-readings" aria-labelledby="fa-readings-title" hidden>
        <div class="strip"><h2 class="strip-title" id="fa-readings-title">Readings at cursor</h2></div>
        <dl class="kv-list">${kv('Time', 'fa-r-time')}${kv('Note', 'fa-r-note')}${kv('Pitch', 'fa-r-pitch')}${kv('Off by', 'fa-r-offby')}${kv('Vibrato', 'fa-r-vib', '', true)}
        </dl>
        <details class="disclosure fa-r-details" id="fa-r-details">
          <summary>Details</summary>
          <dl class="kv-list">${kv('F0', 'fa-d-f0')}${kv('Deviation', 'fa-d-dev')}${kv('Level', 'fa-d-level')}${kv(`Energy ${fx(SF_BAND[0] / 1000, 1)} to ${fx(SF_BAND[1] / 1000, 1)} kHz vs ${fx(REF_BAND[0] / 1000, 2)} to ${REF_BAND[1] / 1000} kHz`, 'fa-d-band')}
          </dl>
        </details>
      </section>

      <section class="panel fa-about" id="fa-about" aria-labelledby="fa-about-title" hidden>
        <div class="strip"><h2 class="strip-title" id="fa-about-title">About this analysis</h2></div>
        <div class="pbody">
          <div class="fa-notes" id="fa-notes-box" hidden>
            <h3 class="fa-notes-title" id="fa-notes-title" tabindex="-1">Notes on this file</h3>
            <ul class="fa-notes-list" id="fa-notes" role="list"></ul>
          </div>
          <p class="prose" id="fa-nopitch-reasons" hidden>Common causes: silence, singing below the voicing gate (${fx(DEFAULT_YIN.silenceDb, 0)} dBFS), or stereo channels that cancel when mixed.</p>
          <p class="prose">Times count from the start of the decoded audio. MP3 and M4A files can start slightly later than the original recording because of the encoder.</p>
          <p class="prose">If the octave looks wrong, compare the pitch marks with the lowest strong band in the spectrogram.</p>
          <p class="prose"><a class="link" href="/MEASUREMENT.md">MEASUREMENT.md</a> and <a class="link" href="/VALIDATION.md">VALIDATION.md</a> (dev server only, opens raw text)</p>
        </div>
      </section>

      <details class="panel disclosure fa-details" id="fa-details" hidden>
        <summary>Details</summary>
        <dl class="kv-list">${kv('Analysis window', 'fa-x-window')}${kv('Hop', 'fa-x-hop')}${kv('Frames', 'fa-x-frames')}${kv('Frames with a pitch', 'fa-x-voiced')}${kv('Voicing gate', 'fa-x-gate', `${fx(DEFAULT_YIN.silenceDb, 0)} dBFS`)}${kv('Vibrato window', 'fa-x-vib', `${VIB_WINDOW_S} s, a new one every ${VIB_STEP_S} s`)}${kv('Display range', 'fa-x-range', `0 to ${SPEC_TOP_HZ / 1000} kHz`)}
        </dl>
      </details>
    </div>

    <div class="fa-drop-overlay" id="fa-drop-overlay" aria-hidden="true" hidden><p>Drop the file to analyse it</p></div>
  </div>
  <p class="visually-hidden" id="fa-status" role="status"></p>
</div>`;

// ---------------------------------------------------------------- types

type State = 'empty' | 'decoding' | 'analysing' | 'done' | 'nopitch' | 'cancelled' | 'error';

interface Take {
  file: AnalysedFile;
  lossy: boolean;
  cents: Float64Array;
  range: { lo: number; hi: number } | null;
  vibAxes: { speed: VibAxis | null; width: VibAxis | null };
  band: number;
  voicedCount: number;
}

// ---------------------------------------------------------------- view

export function fileRoute(root: HTMLElement): Route {
  root.innerHTML = html;
  root.setAttribute('aria-labelledby', 'fa-title');

  const $ = <T extends HTMLElement = HTMLElement>(id: string) => {
    const el = root.querySelector<T>(`#${id}`);
    if (!el) throw new Error(`file view: #${id} missing`);
    return el;
  };
  const route = root.querySelector<HTMLElement>('.fa-route')!;
  const el = {
    open: $<HTMLButtonElement>('fa-open'), input: $<HTMLInputElement>('fa-input'),
    content: $('fa-content'), cleared: $('fa-cleared'), notice: $('fa-notice'), status: $('fa-status'),
    infoPanel: $('fa-info-panel'), name: $('fa-info-name'), dur: $('fa-info-dur'), rate: $('fa-info-rate'),
    rateNote: $('fa-info-rate-note'), rateLink: $('fa-info-rate-link'), ch: $('fa-info-ch'),
    a4: $<HTMLInputElement>('fa-a4'), a4Dec: $<HTMLButtonElement>('fa-a4-dec'), a4Inc: $<HTMLButtonElement>('fa-a4-inc'),
    a4Error: $('fa-a4-error'), marker: $('fa-notes-marker'), markerLink: $<HTMLButtonElement>('fa-notes-link'),
    main: $('fa-main'), figsStrip: $('fa-figs-strip'),
    bodyEmpty: $('fa-body-empty'), bodyProgress: $('fa-body-progress'), bodyMsg: $('fa-body-msg'), figs: $('fa-figs'),
    progressText: $('fa-progress-text'), progress: $('fa-progress'), progressFill: $('fa-progress-fill'),
    progressWhy: $('fa-progress-why'), cancel: $<HTMLButtonElement>('fa-cancel'),
    message: $('fa-message'), error: $('fa-error'), errorText: $('fa-error-text'), errorExtra: $('fa-error-extra'),
    errorDetails: $<HTMLDetailsElement>('fa-error-details'), errorRaw: $('fa-error-raw'),
    ovRow: $('fa-ov-row'), ovWrap: $('fa-overview-wrap'), overview: $<HTMLCanvasElement>('fa-overview'), ovRect: $('fa-ov-rect'),
    viewText: $('fa-view-text'), earlier: $<HTMLButtonElement>('fa-earlier'), later: $<HTMLButtonElement>('fa-later'),
    zoomIn: $<HTMLButtonElement>('fa-zoom-in'), zoomOut: $<HTMLButtonElement>('fa-zoom-out'), whole: $<HTMLButtonElement>('fa-whole'),
    cursorLine: $('fa-cursor-line'), plots: $('fa-plots'), cursor: $('fa-cursor'), taxis: $('fa-taxis'),
    pitch: $<HTMLCanvasElement>('fa-fig-pitch'), cents: $<HTMLCanvasElement>('fa-fig-cents'),
    vib: $<HTMLCanvasElement>('fa-fig-vib'), spec: $<HTMLCanvasElement>('fa-fig-spec'),
    capPitch: $('fa-cap-pitch'), capCents: $('fa-cap-cents'), capVib: $('fa-cap-vib'),
    readings: $('fa-readings'), rTime: $('fa-r-time'), rNote: $('fa-r-note'), rPitch: $('fa-r-pitch'), rOffby: $('fa-r-offby'),
    rVib: $('fa-r-vib'), rVibNote: $('fa-r-vib-note'),
    dF0: $('fa-d-f0'), dDev: $('fa-d-dev'), dLevel: $('fa-d-level'), dBand: $('fa-d-band'),
    about: $('fa-about'), notesBox: $('fa-notes-box'), notesTitle: $('fa-notes-title'), notes: $('fa-notes'), reasons: $('fa-nopitch-reasons'),
    details: $('fa-details'), xWindow: $('fa-x-window'), xHop: $('fa-x-hop'), xFrames: $('fa-x-frames'), xVoiced: $('fa-x-voiced'),
    overlay: $('fa-drop-overlay'),
  };
  const axisOf = (id: string) => root.querySelector<HTMLElement>(`[data-axis="${id}"]`)!;
  const wrapOf = (id: string) => root.querySelector<HTMLElement>(`[data-wrap="${id}"]`)!;
  const canvases = [el.pitch, el.cents, el.vib, el.spec];
  const clines = canvases.map((c) => wrapOf(c.id).querySelector<HTMLElement>('.fa-cline')!);
  const noPitchOverlays = [el.pitch, el.cents, el.vib].map((c) => wrapOf(c.id).querySelector<HTMLElement>('.fa-nopitch')!);

  const setText = (e: HTMLElement, t: string) => { if (e.textContent !== t) e.textContent = t; };
  const setHidden = (e: HTMLElement, h: boolean) => { if (e.hidden !== h) e.hidden = h; };

  // ------------------------------------------------ state
  let state: State = 'empty';
  let token = 0;
  let ctl: AbortController | null = null;
  let take: Take | null = null;
  let fileName = '';
  let fileCleared = false;
  let lastPct = -1;
  let announcedQuarter = 0;
  let a4 = savedA4();
  let view: View = { t0: 0, t1: 1 };
  let cursor = 0; // frame index
  let pal: SpecPalette = readSpecPalette();
  let specKey = '';
  let overviewKey = '';
  /** Bumped for every analysed take, so caches keyed on it never show an older take. */
  let takeSeq = 0;

  // ------------------------------------------------ announcements (#fa-status)
  let sayTimer = 0;
  function say(text: string) {
    window.clearTimeout(sayTimer);
    if (el.status.textContent !== text) { el.status.textContent = text; return; }
    el.status.textContent = '';
    sayTimer = window.setTimeout(() => { el.status.textContent = text; }, 100);
  }

  // ------------------------------------------------ state rendering
  /** The panel body crossfades on a state change (7), except the figures, which appear instantly. */
  function showBody(which: HTMLElement | null) {
    for (const b of [el.bodyEmpty, el.bodyProgress, el.bodyMsg, el.figs]) {
      const show = b === which;
      if (show && b.hidden && b !== el.figs) { b.classList.remove('fa-enter'); void b.offsetWidth; b.classList.add('fa-enter'); }
      setHidden(b, !show);
    }
    const title = which === el.figs ? 'fa-figs-title' : which === el.bodyEmpty ? 'fa-empty-title' : which === el.bodyProgress ? 'fa-progress-title' : 'fa-msg-title';
    el.main.setAttribute('aria-labelledby', title);
  }

  function setState(s: State) {
    // A control that is about to be hidden would drop focus to the page; give it to the open button instead.
    const active = document.activeElement;
    state = s;
    route.dataset.state = s;
    const busy = s === 'decoding' || s === 'analysing';
    const hasTake = s === 'done' || s === 'nopitch';
    const opened = s !== 'empty' && s !== 'cancelled';
    setText(el.open, opened ? 'Open another file' : 'Open an audio file');
    el.open.classList.toggle('btn-primary', !opened);
    el.open.classList.toggle('btn-ghost', opened);
    setHidden(el.infoPanel, !(busy || hasTake));
    setHidden(el.figsStrip, !hasTake);
    showBody(s === 'empty' ? el.bodyEmpty : busy ? el.bodyProgress : hasTake ? el.figs : el.bodyMsg);
    setHidden(el.readings, !hasTake);
    setHidden(el.about, !hasTake);
    setHidden(el.details, !hasTake);
    setHidden(el.reasons, s !== 'nopitch');
    if (active instanceof HTMLElement && active !== document.body && !active.checkVisibility?.()) el.open.focus({ preventScroll: true });
  }

  function clearTake() {
    take = null;
    specKey = '';
    overviewKey = '';
    for (const c of canvases.concat(el.overview)) { c.width = 0; c.height = 0; }
  }

  // ------------------------------------------------ file strip
  function paintInfo(f: AnalysedFile | null) {
    setText(el.name, fileName);
    const known = !!f;
    for (const k of ['dur', 'rate', 'ch'] as const) setHidden(root.querySelector<HTMLElement>(`.fa-i[data-k="${k}"]`)!, !known);
    setHidden(root.querySelector<HTMLElement>('.fa-i[data-k="a4"]')!, !(state === 'done' || state === 'nopitch'));
    setHidden(root.querySelector<HTMLElement>('.fa-i[data-k="method"]')!, state === 'decoding');
    if (!f) { setHidden(el.marker, true); return; }
    setText(el.dur, clock(f.durationS, 2));
    setText(el.rate, `${f.sampleRate} Hz`);
    const resampled = f.nativeRate === null || f.nativeRate !== f.sampleRate;
    let note = '';
    if (f.rateSource === 'resampled-unknown') note = `Resampled to ${f.sampleRate / 1000} kHz, file rate unknown.`;
    else if (resampled && f.nativeRate !== null) note = `Resampled from ${f.nativeRate} Hz to ${f.sampleRate / 1000} kHz.`;
    else if (f.rateSource === 'header') note = 'From the file. Not resampled.';
    setText(el.rateNote, note);
    setHidden(el.rateNote, !note);
    setHidden(el.rateLink, !resampled);
    setText(el.ch, f.channels === 1 ? '1' : `${f.channels}, mixed to one by averaging`);
  }

  function paintNotes(t: Take) {
    const f = t.file;
    const items: [string, string][] = [];
    if (f.rateSource === 'not-confirmed') items.push(['fa-rate-unconfirmed', 'File rate not confirmed. This M4A file does not state its rate for certain.']);
    if (t.lossy && !V08_VERIFIED) items.push(['fa-lossy-note', 'Accuracy on MP3 and AAC files is unverified.']);
    if ((f.rateSource === 'resampled' || f.rateSource === 'resampled-unknown' || f.nativeRate !== f.sampleRate) && !V07_VERIFIED) {
      items.push(['fa-resample-note', 'Accuracy after resampling is unverified.']);
    }
    el.notes.replaceChildren(...items.map(([id, text]) => {
      const li = document.createElement('li');
      li.id = id;
      li.textContent = text;
      return li;
    }));
    setHidden(el.notesBox, !items.length);
    setHidden(el.marker, !items.length);
    setText(el.markerLink, `${items.length} ${items.length === 1 ? 'note' : 'notes'} about this file`);
  }

  el.markerLink.addEventListener('click', () => {
    el.notesTitle.scrollIntoView({ block: 'center' });
    el.notesTitle.focus({ preventScroll: true });
  });

  function paintDetails(t: Take) {
    const r = t.file.result;
    const N = DEFAULT_YIN.bufferSize;
    setText(el.xWindow, `${N} samples (${fx((N / r.sampleRate) * 1000, 1)} ms)`);
    setText(el.xHop, `${r.hop} samples (${fx((r.hop / r.sampleRate) * 1000, 2)} ms)`);
    setText(el.xFrames, String(r.frameCount));
    setText(el.xVoiced, String(t.voicedCount));
    setText(el.capPitch, `Each mark is one analysis frame, ${fx((r.hop / r.sampleRate) * 1000, 1)} ms. Marks are never joined or averaged, so an octave jump shows as marks an octave away.`);
    setText(el.capVib, `Each mark is one ${VIB_WINDOW_S} s window, placed at its middle. Windows start every ${VIB_STEP_S} s and overlap. Windows that cross a note change are not checked by the validation.`);
    paintCentsCaption();
    setText(el.dBand, Number.isFinite(t.band) ? `${signedFixed(t.band, 1)} dB, whole take, frames with a pitch` : 'No frames with a pitch');
  }
  function paintCentsCaption() {
    setText(el.capCents, `Cents from the nearest equal-tempered note at A4 = ${a4} Hz. The marks jump from +50 to ${MINUS}50 when the nearest note changes.`);
  }

  // ------------------------------------------------ progress (2.3)
  function progressIndeterminate(text: string) {
    el.progress.dataset.mode = 'indeterminate';
    el.progress.removeAttribute('aria-valuenow');
    el.progress.setAttribute('aria-valuetext', text);
    el.progressFill.style.transform = '';
    setText(el.progressText, text);
    setHidden(el.progressWhy, true);
  }
  /** Sets the bar from one progress message. Never goes down, never shows 100 before Done (F-18). */
  function progressValue(fraction: number) {
    const p = Math.max(lastPct, Math.min(99, Math.floor(fraction * 100)));
    if (p === lastPct && el.progress.dataset.mode === 'determinate') return;
    lastPct = p;
    el.progress.dataset.mode = 'determinate';
    el.progress.setAttribute('aria-valuenow', String(p));
    el.progress.setAttribute('aria-valuetext', `Analysing, ${p} percent`);
    el.progressFill.style.transform = `scaleX(${p / 100})`;
    setText(el.progressText, `Analysing, ${p}%`);
    setHidden(el.progressWhy, false);
    const q = Math.floor(p / 25);
    if (q > announcedQuarter && q < 4) { announcedQuarter = q; say(`Analysing, ${q * 25} percent`); }
  }

  // ------------------------------------------------ open a file
  async function openFile(file: File) {
    ctl?.abort();
    const my = ++token;
    const ac = new AbortController();
    ctl = ac;
    clearTake();
    fileName = file.name;
    lastPct = -1;
    announcedQuarter = 0;
    setHidden(el.cleared, true);
    setHidden(el.notice, true);
    setState('decoding');
    paintInfo(null);
    progressIndeterminate(`Decoding ${file.name}…`);
    say('Decoding');
    // Lossy or not, for the MP3 and AAC note: anything analysed that is not RIFF/WAVE is MP3, M4A or AAC.
    const lossyP = file.slice(0, 12).arrayBuffer()
      .then((b) => { const s = String.fromCharCode(...new Uint8Array(b)); return !(s.startsWith('RIFF') && s.slice(8, 12) === 'WAVE'); })
      .catch(() => false);
    let phase: 'decoding' | 'analysing' = 'decoding';
    try {
      const f = await analyseFile(file, {
        signal: ac.signal,
        onProgress: (fraction, ph) => {
          if (my !== token) return;
          if (ph === 'analysing') {
            if (phase !== 'analysing') {
              phase = 'analysing';
              setState('analysing');
              paintInfo(null);
              say('Analysing');
            }
            progressValue(fraction);
          }
        },
      });
      const lossy = await lossyP;
      if (my !== token) return;
      ctl = null;
      done(f, lossy);
    } catch (err) {
      if (my !== token) return;
      ctl = null;
      fail(err);
    }
  }

  function done(f: AnalysedFile, lossy: boolean) {
    const r = f.result;
    if (r.status === 'too-short') {
      const N = DEFAULT_YIN.bufferSize;
      showError(`This recording is too short to analyse. It needs at least ${N} samples, about ${Math.round((N / r.sampleRate) * 1000)} ms at ${r.sampleRate} Hz.`);
      return;
    }
    a4 = savedA4();
    el.a4.value = String(a4);
    clearA4Error();
    let voicedCount = 0, eSf = 0, eRef = 0;
    for (let i = 0; i < r.frameCount; i++) if (r.f0[i] > 0) { voicedCount++; eSf += r.eSf[i]; eRef += r.eRef[i]; }
    takeSeq++;
    take = {
      file: f, lossy,
      cents: centsSeries(r.f0, a4),
      range: pitchRange(r, a4),
      vibAxes: { speed: vibAxis(r.vibrato, 'rateHz', 1), width: vibAxis(r.vibrato, 'extentCents', 10) },
      band: eSf > 0 && eRef > 0 ? 10 * Math.log10(eSf / eRef) : NaN,
      voicedCount,
    };
    // 100% only here, in Done (F-18). The block is hidden right after.
    el.progress.dataset.mode = 'determinate';
    el.progress.setAttribute('aria-valuenow', '100');
    el.progress.setAttribute('aria-valuetext', 'Analysing, 100 percent');
    el.progressFill.style.transform = 'scaleX(1)';
    const noPitch = r.status === 'no-pitch';
    setState(noPitch ? 'nopitch' : 'done');
    paintInfo(f);
    paintNotes(take);
    paintDetails(take);
    for (const o of noPitchOverlays) setHidden(o, !noPitch);
    // Initial view (3.4) and cursor (2.2): the first voiced frame, or 0.
    let first = -1;
    for (let i = 0; i < r.frameCount; i++) if (r.f0[i] > 0) { first = i; break; }
    cursor = first >= 0 ? first : 0;
    const dur = f.durationS;
    if (dur <= FILE_VIEW_DEFAULT_S) setView(0, dur);
    else setView(first >= 0 ? r.t[first] : 0, FILE_VIEW_DEFAULT_S);
    el.cursor.setAttribute('aria-valuemax', fx(dur, 2));
    drawAll();
    say(noPitch ? 'Done. No pitch found.' : `Done. ${clock(dur, 2)} analysed.`);
  }

  function showError(text: string, raw?: string, extra?: string, typeError = false) {
    setState('error');
    setHidden(el.message, true);
    setHidden(el.error, false);
    setText(el.errorText, text);
    if (typeError) el.errorText.id = 'fa-type-error'; else el.errorText.id = 'fa-error-text';
    setText(el.errorExtra, extra ?? '');
    setHidden(el.errorExtra, !extra);
    setText(el.errorRaw, raw ?? '');
    setHidden(el.errorDetails, !raw);
    el.errorDetails.open = false;
    say(text);
  }

  function fail(err: unknown) {
    const code = err instanceof TakeError ? err.code : 'analysis-failed';
    const raw = err instanceof Error ? err.message : String(err);
    switch (code) {
      case 'cancelled':
        setState('cancelled');
        setHidden(el.error, true);
        setHidden(el.message, false);
        setText(el.message, 'Analysis cancelled. Nothing was kept.');
        say('Analysis cancelled. Nothing was kept.');
        return;
      case 'too-large': {
        const size = lastFileSize;
        // The decoder also refuses, as too large, an MP3 or M4A whose length cannot be read before decoding and
        // that is over MAX_COMPRESSED_BYTES (src/file/decode.ts). Saying the general limit there would be false.
        if (size <= MAX_FILE_BYTES) showError(`This file is ${mb(size)} MB. The limit is ${mb(MAX_COMPRESSED_BYTES)} MB for an MP3 or M4A file that does not state its length.`);
        else showError(`This file is ${mb(size)} MB. The limit is ${mb(MAX_FILE_BYTES)} MB.`);
        return;
      }
      case 'too-long': {
        // The pipeline carries the length on the error when it knows it; without it, say only the limit.
        const d = err instanceof TakeError ? err.durationS : undefined;
        const lead = d !== undefined ? `This recording is ${clock(d, 2)}.` : 'This recording is longer than the limit.';
        showError(`${lead} The limit is ${limitText(MAX_DURATION_S)}. Trim it and open it again.`);
        return;
      }
      case 'unsupported-type':
        showError('This file type is not supported. Open a WAV, MP3 or M4A file.', undefined, undefined, true);
        return;
      case 'out-of-memory':
        showError('This file is too large for this browser to analyse.');
        return;
      case 'decode-failed': case 'not-wav': case 'corrupt': case 'unsupported-format': case 'unsupported-rate':
        showError('This file could not be read as audio. It may be damaged or protected.', raw);
        return;
      default:
        showError('The analysis stopped with an error.', raw, 'If this keeps happening, tell Joseph and include the text under Details.');
    }
  }

  /** Stops the running job (if any) and invalidates its late messages. */
  function stopJob() {
    token++;
    ctl?.abort();
    ctl = null;
  }

  let lastFileSize = 0;
  async function accept(file: File) {
    // A new pick replaces whatever was running or shown (F-16), refused or not. Refusals that need only the
    // header come from src/file/decode.ts (the same check decodeFile runs), so a refused file never shows
    // the Decoding state (3.3).
    stopJob();
    const my = token;
    const refusal = await precheckFile(file);
    if (my !== token) return; // a newer pick or a leave came first
    lastFileSize = file.size;
    if (refusal) {
      clearTake();
      fileName = file.name;
      setHidden(el.cleared, true);
      setHidden(el.notice, true);
      fail(refusal);
      return;
    }
    void openFile(file);
  }

  el.open.addEventListener('click', () => el.input.click());
  el.input.addEventListener('change', () => {
    const f = el.input.files?.[0];
    el.input.value = ''; // the same file can be picked again
    if (f) void accept(f);
  });
  // Cancel shows Cancelled at once: decoding cannot be interrupted, so waiting for the client's rejection could
  // leave "Decoding…" on screen. The job's late messages are dropped by its token.
  el.cancel.addEventListener('click', () => {
    if (state !== 'decoding' && state !== 'analysing') return;
    stopJob();
    fail(new TakeError('cancelled', 'cancelled by the Cancel button'));
  });

  // ------------------------------------------------ drag and drop (3.3, 1.6). main.ts cancels the browser default.
  let dragDepth = 0;
  const carriesFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
  root.addEventListener('dragenter', (e) => {
    if (!carriesFiles(e)) return;
    dragDepth++;
    setHidden(el.overlay, false);
    el.content.dataset.drag = 'on';
  });
  root.addEventListener('dragleave', (e) => {
    if (!carriesFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) endDrag();
  });
  function endDrag() {
    dragDepth = 0;
    setHidden(el.overlay, true);
    delete el.content.dataset.drag;
  }
  root.addEventListener('drop', (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    endDrag();
    const files = e.dataTransfer?.files;
    if (!files || !files.length) return;
    if (files.length > 1) {
      setText(el.notice, 'Drop one file at a time. Nothing was opened.');
      setHidden(el.notice, false);
      say('Drop one file at a time. Nothing was opened.');
      return;
    }
    void accept(files[0]);
  });

  // ------------------------------------------------ A4 stepper (DESIGN.md 2.8, M2-DESIGN.md 3.3)
  el.a4.value = String(a4);
  let a4Invalid = false;
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
  /** Recomputes cents and note names from the stored F0 (F-22, F-23). No Worker job. */
  function recomputeForA4() {
    if (!take) return;
    const r = take.file.result;
    take.cents = centsSeries(r.f0, a4);
    take.range = pitchRange(r, a4);
    paintCentsCaption();
    drawPitchFigs();
    drawCentsFig();
    paintCursor();
  }
  function applyA4(v: number) {
    const changed = v !== a4;
    a4 = v;
    el.a4.value = String(v);
    clearA4Error();
    if (!changed) return;
    try { localStorage.setItem(A4_KEY, String(v)); } catch { /* keep it for this visit */ }
    setField('a4', { status: 'info', value: `${v} Hz` });
    // A leave or a new file in the meantime bumps the token: then there is nothing to update or announce.
    // The hash is checked too: a navigation started in the same task runs the leave hook only after this
    // frame, and nothing should be announced once she has asked to go elsewhere.
    const my = token;
    requestAnimationFrame(() => {
      if (my !== token || !take || parseHash(location.hash).name !== 'file') return;
      recomputeForA4();
      say(`Reference A4 = ${v} Hz. Cents and note names updated.`);
    });
  }
  function validateA4() {
    const v = parseA4(el.a4.value);
    if (v === null) {
      a4Invalid = true;
      setText(el.a4Error, `Enter a value from ${A4_MIN} to ${A4_MAX} Hz`);
      el.a4.setAttribute('aria-invalid', 'true');
      return;
    }
    applyA4(v);
  }
  el.a4.addEventListener('change', validateA4);
  el.a4.addEventListener('blur', () => { if (a4Invalid || el.a4.value !== String(a4)) validateA4(); });
  el.a4.addEventListener('keydown', (e) => { if (e.key === 'Enter') validateA4(); });
  const step = (d: number) => applyA4(Math.round(Math.min(A4_MAX, Math.max(A4_MIN, a4 + d)) * 10) / 10);
  el.a4Dec.addEventListener('click', () => step(-1));
  el.a4Inc.addEventListener('click', () => step(1));

  // ------------------------------------------------ view: span, zoom and pan (3.4)
  const duration = () => take?.file.durationS ?? 0;
  const minSpan = () => Math.min(VIB_WINDOW_S, duration());
  function setView(t0: number, span: number) {
    const dur = duration();
    span = Math.max(minSpan(), Math.min(dur, span));
    t0 = Math.max(0, Math.min(dur - span, t0));
    view = { t0, t1: t0 + span };
  }
  const cursorT = () => (take && take.file.result.frameCount ? take.file.result.t[cursor] : 0);
  function zoom(factor: number) {
    if (!take) return;
    const span = view.t1 - view.t0;
    const c = cursorT();
    const anchor = c >= view.t0 && c <= view.t1 ? c : (view.t0 + view.t1) / 2;
    const next = Math.max(minSpan(), Math.min(duration(), span * factor));
    setView(anchor - (anchor - view.t0) * (next / span), next);
    drawAll();
  }
  function pan(by: number) {
    if (!take) return;
    setView(view.t0 + by, view.t1 - view.t0);
    drawAll();
  }
  const isOff = (b: HTMLButtonElement) => b.getAttribute('aria-disabled') === 'true';
  el.earlier.addEventListener('click', () => { if (!isOff(el.earlier)) pan(-(view.t1 - view.t0) / 2); });
  el.later.addEventListener('click', () => { if (!isOff(el.later)) pan((view.t1 - view.t0) / 2); });
  el.zoomIn.addEventListener('click', () => { if (!isOff(el.zoomIn)) zoom(0.5); });
  el.zoomOut.addEventListener('click', () => { if (!isOff(el.zoomOut)) zoom(2); });
  el.whole.addEventListener('click', () => { if (!isOff(el.whole) && take) { setView(0, duration()); drawAll(); } });

  // Overview strip: click or drag to centre the view there (2.1 item 1). Pointer only; the buttons are the keyboard path.
  let ovDrag = false;
  function ovMove(clientX: number) {
    if (!take) return;
    const rect = el.overview.getBoundingClientRect(); // the canvas, inside the border
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration();
    const span = view.t1 - view.t0;
    setView(t - span / 2, span);
    scheduleDraw(); // pointer moves can come faster than frames; draw once per frame
  }
  el.ovWrap.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; ovDrag = true; el.ovWrap.setPointerCapture?.(e.pointerId); ovMove(e.clientX); });
  el.ovWrap.addEventListener('pointermove', (e) => { if (ovDrag) ovMove(e.clientX); });
  const ovEnd = () => { ovDrag = false; };
  el.ovWrap.addEventListener('pointerup', ovEnd);
  el.ovWrap.addEventListener('pointercancel', ovEnd);

  // ------------------------------------------------ time cursor (2.2)
  function setCursor(i: number, follow = true) {
    if (!take) return;
    const r = take.file.result;
    if (!r.frameCount) return;
    cursor = Math.max(0, Math.min(r.frameCount - 1, i));
    const t = r.t[cursor];
    const span = view.t1 - view.t0;
    if (follow && t < view.t0) { setView(t, span); drawAll(); return; }
    if (follow && t > view.t1) { setView(t - span, span); drawAll(); return; }
    paintCursor();
  }
  const frameAtTime = (t: number) => (take ? nearestFrame(take.file.result, t) : 0);
  el.cursor.addEventListener('keydown', (e) => {
    if (!take || e.altKey || e.ctrlKey || e.metaKey) return;
    const span = view.t1 - view.t0;
    const t = cursorT();
    switch (e.key) {
      case 'ArrowLeft': case 'ArrowDown':
        setCursor(e.shiftKey ? frameAtTime(t - 1) : cursor - 1); break;
      case 'ArrowRight': case 'ArrowUp':
        setCursor(e.shiftKey ? frameAtTime(t + 1) : cursor + 1); break;
      case 'PageUp': case 'PageDown': {
        const d = e.key === 'PageUp' ? span : -span;
        setView(view.t0 + d, span);
        setCursor(frameAtTime(t + d), false);
        drawAll();
        break;
      }
      case 'Home': setCursor(0); break;
      case 'End': setCursor(take.file.result.frameCount - 1); break;
      case '+': case '=': zoom(0.5); break;
      case '-': case '_': zoom(2); break;
      default: return;
    }
    e.preventDefault();
  });
  // A click sets the cursor to the nearest frame. A drag of more than DRAG_PX is reserved for selecting a span
  // (3.5, not built), so it does nothing yet. The wheel is left to the page (2.2).
  let down: { x: number; y: number } | null = null;
  el.cursor.addEventListener('pointerdown', (e) => { if (e.button === 0) down = { x: e.clientX, y: e.clientY }; });
  el.cursor.addEventListener('pointerup', (e) => {
    if (!down || !take) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_PX;
    down = null;
    if (moved) return;
    // Map against a figure canvas (the content box inside the plot border, 4px in Loud), the same box the marks,
    // the cursor lines and the time axis use. Clicks on the border clamp to the ends of the view.
    const rect = el.pitch.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const t = view.t0 + frac * (view.t1 - view.t0);
    setCursor(frameAtTime(t), false);
  });
  el.cursor.addEventListener('pointercancel', () => { down = null; });

  /** Text for the cursor: the cursor line, the slider's valuetext, Readings at cursor and their Details. */
  function paintCursor() {
    if (!take) return;
    const r = take.file.result;
    const noPitch = r.status === 'no-pitch';
    const i = cursor;
    const t = r.frameCount ? r.t[i] : 0;
    const f0 = r.frameCount ? r.f0[i] : 0;
    const ts = fx(t, 2);
    const span = view.t1 - view.t0;
    // cursor line through the figures
    const inView = t >= view.t0 && t <= view.t1;
    const left = `${((t - view.t0) / span) * 100}%`;
    for (const c of clines) { setHidden(c, !inView); if (c.style.left !== left) c.style.left = left; }
    el.cursor.setAttribute('aria-valuenow', ts);
    setText(el.rTime, `${ts} s`);
    setText(el.dLevel, r.frameCount ? `${fx(r.rmsDb[i], 1)} dBFS` : 'No frames');
    if (f0 > 0) {
      const n = nearestNote(f0, a4);
      const dev = deviation(take.cents[i]).dev;
      const glyph = noteGlyph(n.name);
      const words = centsWords(dev);
      setText(el.cursorLine, `At ${ts} s: ${glyph}, ${fx(f0, 1)} Hz, ${words}`);
      el.cursor.setAttribute('aria-valuetext', `${ts} seconds. ${splitNote(n.name).spoken}, ${fx(f0, 1)} hertz, ${words}.`);
      setText(el.rNote, glyph);
      setText(el.rPitch, `${fx(f0, 1)} Hz`);
      setText(el.rOffby, Math.round(dev) === 0 ? `0 cents from ${glyph}` : `${words} of ${glyph}`);
      setText(el.dF0, `${fx(f0, 2)} Hz`);
      setText(el.dDev, `${signedFixed(dev, 1)} c from ${glyph} (${fx(n.targetHz, 2)} Hz)`);
    } else {
      setText(el.cursorLine, `At ${ts} s: no pitch`);
      el.cursor.setAttribute('aria-valuetext', `${ts} seconds. No pitch.`);
      setText(el.rNote, 'No pitch at this time');
      const np = noPitch ? 'No pitch at this time' : 'No pitch';
      setText(el.rPitch, np);
      setText(el.rOffby, np);
      setText(el.dF0, np);
      setText(el.dDev, np);
    }
    // Vibrato: the window whose middle is nearest the cursor (3.2).
    const ws = r.vibrato;
    let vib = 'No window covers this time', vibNote = '';
    if (noPitch) vib = 'No pitch at this time';
    else if (ws.length) {
      const k = Math.max(0, Math.min(ws.length - 1, Math.round((t - VIB_WINDOW_S / 2) / VIB_STEP_S)));
      const w = ws[k];
      if (t >= w.t0 && t <= w.t1) {
        const range = `${fx(w.t0, 1)} to ${fx(w.t1, 1)} s`;
        if (w.rateHz === null || w.extentCents === null) vib = `No vibrato found in the window ${range}`;
        else { vib = `${fx(w.rateHz, 1)} per second, ±${fx(w.extentCents, 0)} cents`; vibNote = `window ${range}`; }
      }
    }
    setText(el.rVib, vib);
    setText(el.rVibNote, vibNote);
    setHidden(el.rVibNote, !vibNote);
  }

  // ------------------------------------------------ drawing
  const compact = () => window.matchMedia?.('(max-width: 599px)').matches ?? false;

  function sizeFigures() {
    const h = compact() ? FIG_H.compact : FIG_H.wide;
    const set = (c: HTMLCanvasElement, px: number) => { const v = `${px}px`; const w = wrapOf(c.id); if (w.style.height !== v) w.style.height = v; const a = axisOf(c.id); if (a.style.height !== v) a.style.height = v; };
    set(el.pitch, h.pitch); set(el.cents, h.cents); set(el.vib, h.vibRow * 2); set(el.spec, h.spec);
    const ov = `${h.overview}px`;
    if (el.ovWrap.style.height !== ov) el.ovWrap.style.height = ov;
    return h;
  }

  function figLabel(what: string) {
    return `${what}, ${clock(view.t0, 1)} to ${clock(view.t1, 1)}. Values are in the time cursor and Readings at cursor.`;
  }

  function axisLabels(box: HTMLElement, labels: { text: string; top: number; align?: 'top' | 'bottom' | 'mid' }[]) {
    const key = labels.map((l) => `${l.text}@${l.top.toFixed(1)}${l.align ?? ''}`).join('|');
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.replaceChildren(...labels.map((l) => {
      const s = document.createElement('span');
      s.textContent = l.text;
      s.style.top = `${l.top}px`;
      s.dataset.align = l.align ?? 'mid';
      return s;
    }));
  }

  function drawPitchFigs() {
    if (!take) return;
    const h = sizeFigures();
    const r = take.file.result;
    drawPitch(el.pitch, r, view, a4, take.range, pal);
    // The overview shows the whole take, so pan, zoom and the cursor never change it. Repaint it only when the
    // take, A4, the palette or its size changes (the view rectangle over it is an HTML element).
    const ovKey = `${takeSeq}|${a4}|${palSeq}|${el.overview.clientWidth}|${el.overview.clientHeight}|${window.devicePixelRatio || 1}`;
    if (ovKey !== overviewKey && drawOverview(el.overview, r, duration(), a4, take.range, pal)) overviewKey = ovKey;
    const labels = take.range ? pitchLabels(take.range, h.pitch, LABEL_PX).map(({ s, topPx }) => ({ text: noteGlyph(nearestNote(a4 * 2 ** (s / 12), a4).name), top: topPx })) : [];
    axisLabels(axisOf(el.pitch.id), labels);
  }
  function drawCentsFig() {
    if (!take) return;
    const h = sizeFigures();
    drawCents(el.cents, take.file.result, view, take.cents, pal);
    axisLabels(axisOf(el.cents.id), [
      { text: 'Sharp +50', top: centsY(50, h.cents) },
      { text: '0', top: centsY(0, h.cents) },
      { text: `Flat ${MINUS}50`, top: centsY(-50, h.cents) },
    ]);
  }

  function drawAll() {
    if (!take || el.figs.hidden) return;
    const r = take.file.result;
    const h = sizeFigures();
    const dur = duration();
    const span = view.t1 - view.t0;
    drawPitchFigs();
    drawCentsFig();
    drawVibrato(el.vib, r.vibrato, view, h.vibRow, take.vibAxes, pal);
    const key = `${view.t0}|${view.t1}|${el.spec.clientWidth}|${el.spec.clientHeight}|${palSeq}`;
    if (key !== specKey) { specKey = key; drawSpectrogram(el.spec, r, view, pal); }
    // vibrato axis: per row the max and min ticks, the row name and the "None found" baseline label
    const L = vibRowLayout(h.vibRow);
    const vl: { text: string; top: number; align?: 'top' | 'bottom' | 'mid' }[] = [];
    const rows: [string, VibAxis | null, (x: number) => string][] = [
      ['Speed', take.vibAxes.speed, (x) => `${fx(x, 1)}/s`],
      ['Width', take.vibAxes.width, (x) => `±${fx(x, 0)} c`],
    ];
    rows.forEach(([, ax, f], ri) => {
      const top = ri * h.vibRow;
      if (ax) {
        if (ax.hi !== ax.lo) { vl.push({ text: f(ax.hi), top: top + L.valTop, align: 'top' }); vl.push({ text: f(ax.lo), top: top + L.valBottom }); }
        else vl.push({ text: f(ax.hi), top: top + (L.valTop + L.valBottom) / 2 });
      }
      vl.push({ text: 'None found', top: top + L.baseline });
    });
    axisLabels(axisOf(el.vib.id), vl);
    // row names sit in the plot, in the empty band between the values and the baseline
    const vwrap = wrapOf(el.vib.id);
    if (!vwrap.querySelector('.fa-vib-names')) {
      const names = document.createElement('div');
      names.className = 'fa-vib-names';
      names.setAttribute('aria-hidden', 'true');
      names.innerHTML = '<span data-row="0">Speed, per second</span><span data-row="1">Width, ± cents</span>';
      vwrap.appendChild(names);
    }
    vwrap.querySelectorAll<HTMLElement>('.fa-vib-names span').forEach((s) => { s.style.top = `${Number(s.dataset.row) * h.vibRow + L.valBottom + 3}px`; });
    axisLabels(axisOf(el.spec.id), [4, 3, 2, 1, 0].map((k) => ({ text: k === 4 ? '4 kHz' : String(k), top: (1 - k / 4) * h.spec, align: k === 4 ? 'top' : k === 0 ? 'bottom' : 'mid' })));
    // time axis
    const ticks = timeTicks(view, Math.max(2, Math.floor(el.taxis.clientWidth / 80)));
    const tkey = `${view.t0}|${view.t1}|${ticks.join(',')}`;
    if (el.taxis.dataset.key !== tkey) {
      el.taxis.dataset.key = tkey;
      const dec = span < 20 ? 1 : 0;
      el.taxis.replaceChildren(...ticks.map((t) => {
        const s = document.createElement('span');
        s.textContent = clock(t, dec);
        const pos = (t - view.t0) / span;
        s.style.left = `${pos * 100}%`;
        s.dataset.align = pos < 0.06 ? 'start' : pos > 0.94 ? 'end' : 'mid';
        return s;
      }));
    }
    // view bar, overview rectangle, labels
    setText(el.viewText, `Showing ${clock(view.t0, 1)} to ${clock(view.t1, 1)} of ${clock(dur, 1)}`);
    const whole = view.t0 <= 0 && view.t1 >= dur;
    setHidden(el.ovRow, whole);
    el.ovRect.style.left = `${(view.t0 / dur) * 100}%`;
    el.ovRect.style.width = `${(span / dur) * 100}%`;
    el.earlier.setAttribute('aria-disabled', String(view.t0 <= 0));
    el.later.setAttribute('aria-disabled', String(view.t1 >= dur));
    el.zoomIn.setAttribute('aria-disabled', String(span <= minSpan() + 1e-9));
    el.zoomOut.setAttribute('aria-disabled', String(whole));
    el.whole.setAttribute('aria-disabled', String(whole));
    el.pitch.setAttribute('aria-label', figLabel('Pitch over time'));
    el.cents.setAttribute('aria-label', figLabel('Cents from the nearest note over time'));
    el.vib.setAttribute('aria-label', figLabel('Vibrato speed and width over time'));
    el.spec.setAttribute('aria-label', figLabel(`Spectrogram 0 to ${SPEC_TOP_HZ / 1000} kHz with pitch marks, over time`));
    paintCursor();
  }

  // Redraw on resize (also fires when the route becomes visible), on theme change and on forced colours.
  let palSeq = 0;
  let rafId = 0;
  const scheduleDraw = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => { rafId = 0; drawAll(); });
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(scheduleDraw).observe(el.plots);
  window.addEventListener('resize', scheduleDraw);
  onSpecPaletteChange(() => { pal = readSpecPalette(); palSeq++; scheduleDraw(); });

  setState('empty');

  return {
    title: 'Recording analysis',
    nav: 'tools',
    enter() {
      // "No file, after leaving" (3.3): shown once, then the flag clears.
      setHidden(el.cleared, !fileCleared);
      fileCleared = false;
      setHidden(el.notice, true);
      const saved = savedA4();
      if (saved !== a4) { a4 = saved; el.a4.value = String(a4); recomputeForA4(); }
      pal = readSpecPalette();
      palSeq++;
    },
    // Stop the worker, discard buffers and results (1.3). No storage.
    async leave() {
      const hadFile = state === 'decoding' || state === 'analysing' || state === 'done' || state === 'nopitch';
      stopJob();
      clearTake();
      fileName = '';
      endDrag();
      window.clearTimeout(sayTimer);
      el.status.textContent = '';
      setState('empty');
      if (hadFile) fileCleared = true;
    },
  };
}
