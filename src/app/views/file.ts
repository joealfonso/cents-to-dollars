// Recording analysis, #/file (M2-DESIGN.md 2.1 to 2.3, 3.1 to 3.4, 3.6, 6, 7, 8; specs/M2.md 4.1 to 4.8).
// The pipeline is src/file/client.ts (analyseFile, cancelAnalysis): decode, then parse or mix and analyse in a
// Worker. This view owns the states, the file strip, the take figure stack, the time cursor, Readings at
// cursor, About this analysis and Details. Nothing is stored except the existing A4 key, and nothing leaves
// the browser (F-20). The file name is only ever set as text (F-21).
//
// Jobs: every file pick takes a new view job number. Progress, results and errors from an older job are
// dropped, so a superseded or cancelled file never reaches the screen (F-16, F-17).
//
// A4 (F-22, F-23): F0 is kept from the result; cents come from centsSeries(f0, a4) and are recomputed on an
// A4 change, with no new Worker job. Pitch marks are drawn per frame at that frame's whole-take F0, never
// joined or averaged (spec 4.2 step 7, F-27).
//
// Measure a held note (3.5) is M2.3a and not built. Its seam: the panel goes in the grid between Readings at
// cursor and About this analysis (.fa-grid, 8 columns), and a pointer drag of more than DRAG_PX on the time
// cursor is left free for its span selection (onCursorPointerUp ignores drags today).

import type { Route } from '../router.ts';
import { analyseFile, cancelAnalysis, type AnalysedFile, type DecodedInfo } from '../../file/client.ts';
import { TakeError } from '../../take/errors.ts';
import { centsSeries } from '../../take/cents.ts';
import { VIB_WINDOW_S, VIB_STEP_S } from '../../take/analyse.ts';
import { MAX_DURATION_S, MAX_FILE_BYTES, MAX_COMPRESSED_BYTES } from '../../take/limits.ts';
import { sniffContainer, type Container } from '../../take/headers.ts';
import { DEFAULT_YIN } from '../../dsp/yin.ts';
import { SF_BAND } from '../../dsp/spectrum.ts';
import { nearestNote } from '../../dsp/pitch.ts';
import { currentA4, setA4 } from '../fields.ts';
import { MINUS, noteGlyph, splitNote, signedFixed } from '../readout.ts';
import { SPEC_TOP_HZ, readSpecPalette, fillSpecColumn, putF0Mark, forcedColors, type SpecPalette } from '../spectrogram.ts';
import {
  DRAG_PX, fmtDuration, fmtClock, fmtLimit, fmtMB, fx, centsWord, frameNear, defaultSpan, clampSpan, zoomSpan,
  panToInclude, minSpan, deviationOf, pitchAxis, semitoneName, niceTicks, timeStep, windowAt, type Span,
} from '../take-view.ts';
import '../../styles/file.css';

// ---------------------------------------------------------------- constants
const N = DEFAULT_YIN.bufferSize;
const SILENCE_DB = DEFAULT_YIN.silenceDb;
const METHOD = 'Whole take (YIN + continuity)';
const A4_MIN = 400;
const A4_MAX = 480;
const REANNOUNCE_DELAY_MS = 100;
/** Debounce for announcing the visible span after zoom or pan buttons (display choice). */
const VIEW_ANNOUNCE_MS = 500;
/** Gap between the two vibrato rows and the height of the "None found" baseline band, CSS px. */
const VIB_GAP_PX = 8;
const VIB_NONE_PX = 14;

const TIPS: string[] = [
  'Export a WAV file at 44.1 or 48 kHz. It is analysed as it is, with no resampling.',
  'Other rates, such as 96 kHz, also open. They are converted to 48 kHz, and the file strip says so.',
  'WAV is the format the measurements were checked on. MP3 and M4A files also open, and their accuracy has not been checked yet.',
  'Turn off noise suppression, automatic gain, pitch correction and effects in the recording app. They change the sound that is measured.',
];
// Item 5 is formatted from MAX_DURATION_S, and left out if the constant is unset (3.6).
if (Number.isFinite(MAX_DURATION_S) && MAX_DURATION_S > 0) TIPS.push(`Keep the recording to ${fmtLimit(MAX_DURATION_S)} or less.`);

const limitsLine = Number.isFinite(MAX_DURATION_S) && Number.isFinite(MAX_FILE_BYTES)
  ? `<p class="prose" id="fa-limits">Up to ${fmtLimit(MAX_DURATION_S)} and ${fmtMB(MAX_FILE_BYTES)} MB.</p>`
  : '';

// ---------------------------------------------------------------- markup
const kv = (label: string, id: string) =>
  `<div class="kv"><dt class="kv-label">${label}</dt><dd class="kv-body"><span class="kv-value" id="${id}"></span><span class="fa-kv-note" id="${id}-note" hidden></span></dd></div>`;

const html = `
<div class="shell route fa-route">
  <header class="page-header">
    <div class="ph-text">
      <p class="eyebrow fa-crumb"><a class="link" href="#/tools">Tools</a> / Recording analysis</p>
      <h1 id="fa-title" tabindex="-1">Recording analysis</h1>
      <p class="lede">Open a recording from this computer. It is analysed in this browser and never uploaded.</p>
    </div>
    <div class="ph-action">
      <button type="button" class="btn btn-primary" id="fa-open">Open an audio file</button>
      <input type="file" id="fa-input" class="visually-hidden" tabindex="-1" aria-hidden="true" accept=".wav,.wave,.mp3,.m4a,.mp4,.aac,audio/*">
    </div>
  </header>

  <div class="fa-content" id="fa-content">
    <p class="fa-notice" id="fa-notice" hidden></p>

    <section class="panel fa-info" id="fa-info" aria-labelledby="fa-info-title" hidden>
      <h2 class="visually-hidden" id="fa-info-title">This recording</h2>
      <dl class="fa-info-list">
        <div class="fa-info-item fa-info-file"><dt class="label">File</dt><dd id="fa-info-name"></dd></div>
        <div class="fa-info-item" data-known="take"><dt class="label">Duration</dt><dd id="fa-info-dur"></dd></div>
        <div class="fa-info-item" data-known="take"><dt class="label">Sample rate</dt><dd><span id="fa-info-rate"></span><span class="fa-info-note" id="fa-info-rate-note" hidden></span><a class="link fa-info-note" id="fa-info-rate-link" href="/VALIDATION.md" hidden>How resampling affects accuracy (dev server only)</a></dd></div>
        <div class="fa-info-item" data-known="take"><dt class="label">Channels</dt><dd id="fa-info-ch"></dd></div>
        <div class="fa-info-item" data-known="take"><dt class="label">Method</dt><dd id="fa-info-method">${METHOD}</dd></div>
        <div class="fa-info-item fa-info-a4" data-known="take"><dt class="label" id="fa-a4-label">A4</dt><dd>
          <div class="va-a4 fa-a4" role="group" aria-labelledby="fa-a4-label">
            <button type="button" class="btn va-step" id="fa-a4-dec" aria-label="Lower A4 by 1 hertz">${MINUS}</button>
            <input class="va-a4-input" id="fa-a4" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" aria-labelledby="fa-a4-label" aria-describedby="fa-a4-unit fa-a4-error">
            <span class="va-a4-unit" id="fa-a4-unit">Hz</span>
            <button type="button" class="btn va-step" id="fa-a4-inc" aria-label="Raise A4 by 1 hertz">+</button>
          </div>
          <p class="va-a4-error" id="fa-a4-error" role="status"></p>
        </dd></div>
      </dl>
      <p class="fa-marker" data-known="take" hidden><button type="button" class="fa-link-btn" id="fa-lossy-note"></button></p>
    </section>

    <div class="fa-grid">
      <section class="panel fa-main" id="fa-figs" aria-labelledby="fa-figs-title">
        <div class="strip"><h2 class="strip-title" id="fa-figs-title">Open a recording</h2><span class="strip-meta" id="fa-figs-meta"></span></div>

        <div class="fa-state fa-empty" id="fa-empty">
          <p class="fa-cleared" id="fa-cleared" hidden>The last recording was cleared when you left this page. Nothing is saved.</p>
          <p class="prose">Choose a WAV, MP3 or M4A file, or drop it here.</p>
          ${limitsLine}
          <p class="prose">It stays on this computer.</p>
          <div class="fa-tips-block" id="fa-tips-block">
            <h3 class="fa-h3" id="fa-tips-title">Recording tips</h3>
            <ul class="fa-tips-list" id="fa-tips-list" aria-labelledby="fa-tips-title">${TIPS.map((t) => `<li>${t}</li>`).join('')}</ul>
          </div>
        </div>

        <div class="fa-state progress" id="fa-progress" data-mode="indeterminate" hidden>
          <p class="progress-text" id="fa-progress-text"></p>
          <div class="progress-bar" id="fa-progress-bar" role="progressbar" aria-label="Analysis progress" aria-valuemin="0" aria-valuemax="100"><span class="progress-fill" id="fa-progress-fill"></span></div>
          <p class="progress-why" id="fa-progress-why" hidden>The plots appear when the whole recording is analysed. Each pitch is chosen with the whole take in view, so there is nothing to show part way.</p>
          <button type="button" class="btn" id="fa-cancel">Cancel</button>
        </div>

        <div class="fa-state fa-msg" id="fa-msg" hidden>
          <p class="fa-error" id="fa-error" hidden></p>
          <p class="fa-error" id="fa-type-error" hidden>This file type is not supported. Open a WAV, MP3 or M4A file.</p>
          <p class="prose" id="fa-message" hidden></p>
          <p class="prose" id="fa-error-hint" hidden>If this keeps happening, tell Joseph and include the text under Error details.</p>
          <details class="disclosure fa-error-details" id="fa-error-details" hidden><summary>Error details</summary><pre class="fa-error-raw" id="fa-error-raw"></pre></details>
        </div>

        <div class="fa-take" id="fa-take" hidden>
          <div class="fa-row fa-ovw-row" id="fa-overview" aria-hidden="true">
            <span></span>
            <div class="fa-ovw"><canvas id="fa-ovw-canvas"></canvas><span class="fa-ovw-view" id="fa-ovw-view"></span></div>
          </div>
          <div class="fa-viewbar" id="fa-view">
            <p class="fa-view-text" id="fa-view-text" aria-live="off"></p>
            <div class="fa-view-btns">
              <button type="button" class="btn btn-ghost" id="fa-earlier">Earlier</button>
              <button type="button" class="btn btn-ghost" id="fa-later">Later</button>
              <button type="button" class="btn btn-ghost" id="fa-zoom-in">Zoom in</button>
              <button type="button" class="btn btn-ghost" id="fa-zoom-out">Zoom out</button>
              <button type="button" class="btn btn-ghost" id="fa-whole">Whole take</button>
            </div>
          </div>
          <p class="fa-cursor-line" id="fa-cursor-line"></p>

          <div class="fa-stack" id="fa-stack">
            <figure class="fa-fig">
              <figcaption class="fa-cap"><span class="fa-fig-no">Fig. 1 Pitch.</span> Each dot is one moment of your pitch.</figcaption>
              <div class="fa-row"><div class="fa-yaxis" id="fa-pitch-axis" aria-hidden="true"></div>
                <div class="fa-plot fa-plot-pitch"><canvas id="fa-fig-pitch" role="img"></canvas><span class="fa-cline"></span><div class="fa-nopitch" hidden><p>No pitch found in this recording</p></div></div></div>
            </figure>
            <figure class="fa-fig">
              <figcaption class="fa-cap"><span class="fa-fig-no">Fig. 2 Cents.</span> How far each moment is from the nearest note. Above the middle line is sharp, below is flat.</figcaption>
              <div class="fa-row"><div class="fa-yaxis" aria-hidden="true"><span style="top:0%">+50</span><span style="top:50%">0</span><span style="top:100%">${MINUS}50</span></div>
                <div class="fa-plot fa-plot-cents"><canvas id="fa-fig-cents" role="img"></canvas><span class="fa-in fa-in-top" aria-hidden="true">Sharp</span><span class="fa-in fa-in-bottom" aria-hidden="true">Flat</span><span class="fa-cline"></span><div class="fa-nopitch" hidden><p>No pitch found in this recording</p></div></div></div>
            </figure>
            <figure class="fa-fig">
              <figcaption class="fa-cap"><span class="fa-fig-no">Fig. 3 Vibrato.</span> How fast and how wide your vibrato is over time. Hollow dots: no vibrato found there.</figcaption>
              <div class="fa-row"><div class="fa-yaxis" id="fa-vib-axis" aria-hidden="true"></div>
                <div class="fa-plot fa-plot-vib"><canvas id="fa-fig-vib" role="img"></canvas><span class="fa-in fa-in-top" aria-hidden="true">Speed, per second</span><span class="fa-in fa-in-mid" aria-hidden="true">Width, ± cents</span><span class="fa-cline"></span><div class="fa-nopitch" hidden><p>No pitch found in this recording</p></div></div></div>
            </figure>
            <figure class="fa-fig">
              <figcaption class="fa-cap"><span class="fa-fig-no">Fig. 4 Spectrogram.</span> <span class="v-paper">Brightness shows how strong each frequency is. Orange dots are your pitch.</span><span class="v-loud">Brightness shows how strong each frequency is. Pink dots are your pitch.</span></figcaption>
              <div class="fa-row"><div class="fa-yaxis" aria-hidden="true"><span style="top:0%">${SPEC_TOP_HZ / 1000} kHz</span><span style="top:25%">3</span><span style="top:50%">2</span><span style="top:75%">1</span><span style="top:100%">0</span></div>
                <div class="fa-plot fa-plot-spec"><canvas id="fa-fig-spec" role="img"></canvas><span class="fa-cline"></span></div></div>
              <ul class="fa-legend" role="list">
                <li><span class="fa-sw fa-sw-f0" aria-hidden="true"></span>Your pitch</li>
                <li><span class="fa-sw fa-sw-band" aria-hidden="true"></span>${fx(SF_BAND[0] / 1000, 1)} and ${fx(SF_BAND[1] / 1000, 1)} kHz guide lines</li>
              </ul>
            </figure>
            <div class="fa-row fa-taxis-row"><span></span><div class="fa-taxis" id="fa-taxis" aria-hidden="true"></div></div>
            <div class="fa-cursor" id="fa-cursor" role="slider" tabindex="0" aria-label="Time cursor" aria-valuemin="0"></div>
          </div>

          <p class="prose fa-reasons" id="fa-reasons" hidden>Common causes: silence, singing below the voicing gate (${fx(SILENCE_DB, 0)} dBFS), or stereo channels that cancel when mixed.</p>

          <details class="disclosure fa-figs-about" id="fa-figs-about">
            <summary>About these figures</summary>
            <div class="pbody">
              <p class="prose"><strong>Pitch.</strong> <span id="fa-tc-pitch"></span></p>
              <p class="prose"><strong>Cents.</strong> <span id="fa-tc-cents"></span></p>
              <p class="prose"><strong>Vibrato.</strong> Each mark is one ${VIB_WINDOW_S} s window, placed at its middle. Windows start every ${VIB_STEP_S} s and overlap. Windows that cross a note change are not checked by the validation.</p>
              <p class="prose"><strong>Spectrogram.</strong> Zoomed out, each column is the average of the frames it covers.</p>
            </div>
          </details>
        </div>
      </section>

      <section class="panel fa-readings" id="fa-readings" aria-labelledby="fa-readings-title" hidden>
        <div class="strip"><h2 class="strip-title" id="fa-readings-title">Readings at cursor</h2></div>
        <dl class="kv-list">${kv('Time', 'fa-r-time')}${kv('Note', 'fa-r-note')}${kv('Pitch', 'fa-r-pitch')}${kv('Off by', 'fa-r-offby')}${kv('Vibrato', 'fa-r-vib')}</dl>
        <details class="disclosure fa-r-details" id="fa-r-details">
          <summary>Details of these readings</summary>
          <dl class="kv-list">${kv('F0', 'fa-d-f0')}${kv('Deviation', 'fa-d-dev')}${kv('Level', 'fa-d-level')}</dl>
        </details>
      </section>

      <section class="panel fa-about" id="fa-about" aria-labelledby="fa-about-title" hidden>
        <div class="strip"><h2 class="strip-title" id="fa-about-title">About this analysis</h2></div>
        <div class="pbody">
          <div class="fa-notes-block" id="fa-notes-block" hidden>
            <h3 class="fa-h3" id="fa-notes-title" tabindex="-1">Notes on this file</h3>
            <ul class="fa-notes" id="fa-notes" aria-labelledby="fa-notes-title"></ul>
          </div>
          <p class="prose">Times count from the start of the decoded audio. MP3 and M4A files can start slightly later than the original recording because of the encoder.</p>
          <p class="prose">If the octave looks wrong, compare the pitch marks with the lowest strong band in the spectrogram.</p>
          <details class="disclosure fa-tips" id="fa-tips"><summary id="fa-tips-summary">Recording tips</summary><div class="pbody" id="fa-tips-slot"></div></details>
          <p class="prose"><a class="link" href="/MEASUREMENT.md">MEASUREMENT.md</a> and <a class="link" href="/VALIDATION.md">VALIDATION.md</a> (dev server only, opens raw text)</p>
        </div>
      </section>

      <details class="panel disclosure fa-details" id="fa-details" hidden>
        <summary>Details of this analysis</summary>
        <dl class="kv-list">${kv('Analysis window', 'fa-x-window')}${kv('Hop', 'fa-x-hop')}${kv('Frames', 'fa-x-frames')}${kv('Voiced frames (whole take)', 'fa-x-voiced')}${kv('Voicing gate', 'fa-x-gate')}${kv('Vibrato window', 'fa-x-vib')}${kv('Display range', 'fa-x-range')}</dl>
      </details>
    </div>

    <div class="fa-drop" id="fa-drop" hidden><p class="fa-drop-text">Drop the file to analyse it</p></div>
  </div>
  <p class="visually-hidden" id="fa-status" role="status"></p>
</div>`;

// ---------------------------------------------------------------- view
type FaState = 'empty' | 'decoding' | 'analysing' | 'done' | 'nopitch' | 'cancelled' | 'error';
interface ErrView { text: string; type?: boolean; raw?: string; hint?: boolean }

export function fileRoute(root: HTMLElement): Route {
  root.innerHTML = html;
  root.setAttribute('aria-labelledby', 'fa-title');

  const $ = <T extends HTMLElement = HTMLElement>(id: string) => {
    const e = root.querySelector<T>(`#${id}`);
    if (!e) throw new Error(`file view: #${id} missing`);
    return e;
  };
  const el = {
    open: $<HTMLButtonElement>('fa-open'), input: $<HTMLInputElement>('fa-input'),
    content: $('fa-content'), notice: $('fa-notice'), drop: $('fa-drop'), status: $('fa-status'),
    info: $('fa-info'), name: $('fa-info-name'), dur: $('fa-info-dur'), rate: $('fa-info-rate'),
    rateNote: $('fa-info-rate-note'), rateLink: $('fa-info-rate-link'), ch: $('fa-info-ch'), marker: $('fa-lossy-note'),
    a4: $<HTMLInputElement>('fa-a4'), a4Dec: $<HTMLButtonElement>('fa-a4-dec'), a4Inc: $<HTMLButtonElement>('fa-a4-inc'), a4Error: $('fa-a4-error'),
    figsTitle: $('fa-figs-title'), figsMeta: $('fa-figs-meta'),
    empty: $('fa-empty'), cleared: $('fa-cleared'), tipsBlock: $('fa-tips-block'), tipsList: $('fa-tips-list'),
    progress: $('fa-progress'), progressText: $('fa-progress-text'), bar: $('fa-progress-bar'), fill: $('fa-progress-fill'),
    why: $('fa-progress-why'), cancel: $<HTMLButtonElement>('fa-cancel'),
    msg: $('fa-msg'), error: $('fa-error'), typeError: $('fa-type-error'), message: $('fa-message'), hint: $('fa-error-hint'),
    errorDetails: $<HTMLDetailsElement>('fa-error-details'), errorRaw: $('fa-error-raw'),
    take: $('fa-take'), ovwRow: $('fa-overview'), ovw: $<HTMLCanvasElement>('fa-ovw-canvas'), ovwView: $('fa-ovw-view'),
    viewText: $('fa-view-text'),
    earlier: $<HTMLButtonElement>('fa-earlier'), later: $<HTMLButtonElement>('fa-later'),
    zoomIn: $<HTMLButtonElement>('fa-zoom-in'), zoomOut: $<HTMLButtonElement>('fa-zoom-out'), whole: $<HTMLButtonElement>('fa-whole'),
    cursorLine: $('fa-cursor-line'), stack: $('fa-stack'), cursor: $('fa-cursor'),
    pitch: $<HTMLCanvasElement>('fa-fig-pitch'), cents: $<HTMLCanvasElement>('fa-fig-cents'),
    vib: $<HTMLCanvasElement>('fa-fig-vib'), spec: $<HTMLCanvasElement>('fa-fig-spec'),
    pitchAxis: $('fa-pitch-axis'), vibAxis: $('fa-vib-axis'), taxis: $('fa-taxis'), reasons: $('fa-reasons'),
    tcPitch: $('fa-tc-pitch'), tcCents: $('fa-tc-cents'),
    readings: $('fa-readings'), rTime: $('fa-r-time'), rNote: $('fa-r-note'), rPitch: $('fa-r-pitch'), rOffby: $('fa-r-offby'),
    rVib: $('fa-r-vib'), rVibNote: $('fa-r-vib-note'), dF0: $('fa-d-f0'), dDev: $('fa-d-dev'), dLevel: $('fa-d-level'),
    about: $('fa-about'), notesBlock: $('fa-notes-block'), notes: $('fa-notes'), notesTitle: $('fa-notes-title'), tipsSlot: $('fa-tips-slot'),
    details: $('fa-details'),
    xWindow: $('fa-x-window'), xHop: $('fa-x-hop'), xFrames: $('fa-x-frames'), xVoiced: $('fa-x-voiced'),
    xGate: $('fa-x-gate'), xVib: $('fa-x-vib'), xRange: $('fa-x-range'),
  };
  const clines = Array.from(root.querySelectorAll<HTMLElement>('.fa-cline'));
  const noPitchOverlays = Array.from(root.querySelectorAll<HTMLElement>('.fa-nopitch'));
  const takeOnly = Array.from(el.info.querySelectorAll<HTMLElement>('[data-known="take"]'));

  const setText = (e: HTMLElement, t: string) => { if (e.textContent !== t) e.textContent = t; };
  const setHidden = (e: HTMLElement, h: boolean) => { if (e.hidden !== h) e.hidden = h; };
  const setAttr = (e: HTMLElement, k: string, v: string) => { if (e.getAttribute(k) !== v) e.setAttribute(k, v); };

  // ------------------------------------------------ model
  let state: FaState = 'empty';
  let job = 0;
  let abort: AbortController | null = null;
  let fileName = '';
  let take: AnalysedFile | null = null;
  /** Rate, channels and duration: from onDecoded during Analysing, then from the result (3.3). */
  let meta: DecodedInfo | null = null;
  let container: Container = 'unknown';
  let cents: Float64Array | null = null;
  let axis: { lo: number; hi: number } | null = null;
  let span: Span = { v0: 0, v1: 0 };
  let cursor = 0;
  let pct = -1;
  let quarter = 0;
  let errView: ErrView | null = null;
  let message = '';
  let fileCleared = false;
  let showCleared = false;

  // Overview drag: pointer moves arrive faster than frames, so the newest x is applied once per animation frame.
  // Declared early because discard() cancels a queued frame.
  let ovwX: number | null = null;
  let ovwRaf = 0;
  function cancelOvwFrame() {
    if (ovwRaf) cancelAnimationFrame(ovwRaf);
    ovwRaf = 0;
    ovwX = null;
  }

  // ------------------------------------------------ announcements (#fa-status)
  let annTimer = 0;
  /** Pending view-span announcement (announceView); cleared by discard() so it never speaks for a new take. */
  let viewAnnTimer = 0;
  function say(text: string) {
    window.clearTimeout(annTimer);
    if (el.status.textContent !== text) { el.status.textContent = text; return; }
    el.status.textContent = '';
    annTimer = window.setTimeout(() => { el.status.textContent = text; }, REANNOUNCE_DELAY_MS);
  }

  // ------------------------------------------------ A4 stepper (DESIGN.md 2.8, shared value with Voice analysis)
  let a4 = currentA4();
  let a4Invalid = false;
  el.a4.value = String(a4);
  function parseA4(raw: string): number | null {
    const s = raw.trim().replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const v = Number(s);
    return v >= A4_MIN && v <= A4_MAX ? v : null;
  }
  function applyA4(v: number) {
    const changed = v !== a4;
    a4 = v;
    el.a4.value = String(v);
    a4Invalid = false;
    el.a4.removeAttribute('aria-invalid');
    setText(el.a4Error, '');
    if (!changed) return;
    setA4(v); // shared with Voice analysis for this visit, saved when storage allows
    if (take && (state === 'done' || state === 'nopitch')) {
      // F-23: cents and note names from the stored F0. No Worker job, no progress block.
      cents = centsSeries(take.result.f0, a4);
      axis = pitchAxis(take.result.f0, a4);
      setText(el.tcCents, centsCaption());
      schedule({ pitch: true, cents: true, ovw: true });
      renderCursor();
      say(`Reference A4 = ${v} Hz. Cents and note names updated.`);
    } else say(`Reference A4 = ${v} Hz`);
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
  const stepA4 = (d: number) => applyA4(Math.round(Math.min(A4_MAX, Math.max(A4_MIN, a4 + d)) * 10) / 10);
  el.a4Dec.addEventListener('click', () => stepA4(-1));
  el.a4Inc.addEventListener('click', () => stepA4(1));

  // ------------------------------------------------ opening a file
  el.open.addEventListener('click', () => el.input.click());
  el.input.addEventListener('change', () => {
    const f = el.input.files?.[0];
    el.input.value = ''; // so the same file can be opened again
    if (f) void openFile(f);
  });

  /** Drops the current take and any running job. Late messages from the old job are ignored by number. */
  function discard() {
    job++;
    window.clearTimeout(viewAnnTimer);
    cancelOvwFrame();
    abort?.abort();
    abort = null;
    take = null;
    meta = null;
    for (const e of [el.dur, el.rate, el.rateNote, el.ch, el.marker]) setText(e, '');
    cents = null;
    axis = null;
    errView = null;
    message = '';
    pct = -1;
    quarter = 0;
  }

  async function openFile(file: File) {
    discard();
    const my = job;
    const ctl = new AbortController();
    abort = ctl;
    fileName = file.name;
    showCleared = false;
    setHidden(el.notice, true);
    state = 'decoding';
    renderState();
    say('Decoding');
    try {
      const got = await analyseFile(file, {
        signal: ctl.signal,
        onProgress: (f, phase) => { if (my === job) onProgress(f, phase); },
        onDecoded: (info) => { if (my === job) meta = info; },
      });
      if (my !== job) return;
      let c: Container = 'unknown';
      try { c = sniffContainer(new Uint8Array(await file.slice(0, 65536).arrayBuffer())); } catch { /* notes only */ }
      if (my !== job) return;
      container = c;
      onResult(got);
    } catch (e) {
      if (my !== job) return;
      onError(e, file);
    } finally {
      if (abort === ctl) abort = null;
    }
  }

  function onProgress(f: number, phase: 'decoding' | 'analysing') {
    if (phase === 'decoding') return; // decoding has no progress events (2.3)
    if (state === 'decoding') {
      state = 'analysing';
      renderState();
      // Under Option B the first announcement says how the rate was obtained (3.3).
      say(resampled() ? `Analysing. ${rateNote()}` : 'Analysing');
    }
    // Non-decreasing, and below 100 until Done (F-18).
    const p = Math.min(99, Math.max(pct, Math.floor(f * 100)));
    if (p === pct) return;
    pct = p;
    renderProgress();
    const q = Math.floor(p / 25);
    if (q > quarter && q < 4) { quarter = q; say(`Analysing, ${q * 25} percent`); }
  }

  function onResult(got: AnalysedFile) {
    const r = got.result;
    meta = got;
    if (r.status === 'too-short') {
      take = got; // the strip shows what is known
      const ms = Math.round((N / got.sampleRate) * 1000);
      showError({ text: `This recording is too short to analyse. It needs at least ${N} samples, about ${ms} ms at ${got.sampleRate} Hz.` });
      return;
    }
    take = got;
    cents = centsSeries(r.f0, a4);
    axis = pitchAxis(r.f0, a4);
    let first = -1;
    for (let i = 0; i < r.frameCount; i++) if (r.f0[i] > 0) { first = i; break; }
    cursor = first >= 0 ? first : 0;
    span = defaultSpan(got.durationS, first >= 0 ? r.t[first] : null);
    pct = 100;
    renderProgress(); // 100% only in Done (F-18); the block is hidden from here on
    state = r.status === 'no-pitch' ? 'nopitch' : 'done';
    fillInfo();
    fillAbout();
    renderState();
    schedule({ pitch: true, cents: true, vib: true, spec: true, ovw: true });
    renderCursor();
    say(state === 'nopitch' ? 'Done. No pitch found.' : `Done. ${fmtDuration(got.durationS)} analysed. Figures are below.`);
  }

  function onError(e: unknown, file: File) {
    const code = e instanceof TakeError ? e.code : 'analysis-failed';
    const raw = e instanceof Error ? e.message : String(e);
    if (code === 'cancelled') { showCancelled(); return; }
    switch (code) {
      case 'too-large':
        showError({
          text: file.size > MAX_FILE_BYTES
            ? `This file is ${fmtMB(file.size, 1)} MB. The limit is ${fmtMB(MAX_FILE_BYTES)} MB.`
            : `This file is ${fmtMB(file.size, 1)} MB. The limit is ${fmtMB(MAX_COMPRESSED_BYTES)} MB for an MP3 or M4A file that does not state its length.`,
        });
        return;
      case 'unsupported-type':
        showError({ text: '', type: true });
        return;
      case 'too-long': {
        // TakeError carries no duration field; the pipeline's message has "take is {s} s".
        const m = /take is ([\d.]+) s/.exec(raw);
        showError({
          text: m
            ? `This recording is ${fmtDuration(Number(m[1]))}. The limit is ${fmtLimit(MAX_DURATION_S)}. Trim it and open it again.`
            : `This recording is longer than the limit of ${fmtLimit(MAX_DURATION_S)}. Trim it and open it again.`,
        });
        return;
      }
      case 'out-of-memory':
        showError({ text: 'This file is too large for this browser to analyse.' });
        return;
      case 'unsupported-rate': {
        // The browser refused the decode rate; the file is not damaged. decode.ts names the rate in its message.
        const m = /decode at (\d+) Hz/.exec(raw);
        showError({ text: `This browser could not decode this file at ${m ? `${m[1]} Hz` : 'its sample rate'}. Export it as WAV at 44.1 or 48 kHz and open it again.`, raw });
        return;
      }
      case 'decode-failed': case 'not-wav': case 'unsupported-format': case 'corrupt':
        showError({ text: 'This file could not be read as audio. It may be damaged or protected.', raw });
        return;
      default:
        showError({ text: 'The analysis stopped with an error.', raw, hint: true });
    }
  }

  function showError(v: ErrView) {
    errView = v;
    state = 'error';
    renderState();
    say(v.type ? el.typeError.textContent ?? '' : v.text);
  }

  function showCancelled() {
    discard();
    message = 'Analysis cancelled. Nothing was kept.';
    state = 'cancelled';
    renderState();
    say(message);
  }

  el.cancel.addEventListener('click', () => {
    if (state !== 'decoding' && state !== 'analysing') return;
    cancelAnalysis();
    showCancelled();
    el.open.focus(); // the Cancel button is gone; within her action, so focus may move (6)
  });

  // ------------------------------------------------ drag and drop (3.3 Drag over, 1.6 other routes)
  // Every route: a dropped file must not open in the tab (that would leave the app). Only this route accepts it.
  const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
  let dragDepth = 0;
  const showDrop = (on: boolean) => { setHidden(el.drop, !on); el.content.toggleAttribute('data-drag', on); };
  document.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (root.hidden) return;
    dragDepth++;
    showDrop(true);
  });
  document.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = root.hidden ? 'none' : 'copy';
  });
  document.addEventListener('dragleave', (e) => {
    if (!hasFiles(e) || root.hidden) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) showDrop(false);
  });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    showDrop(false);
    if (root.hidden) return; // other routes ignore it with no message
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    if (files.length > 1) {
      const t = 'Drop one file at a time. Nothing was opened.';
      setText(el.notice, t);
      setHidden(el.notice, false);
      say(t);
      return;
    }
    void openFile(files[0]);
  });

  // ------------------------------------------------ state rendering (3.3)
  function renderState() {
    // Focus inside this route that is about to be hidden (Cancel at Done or an error, the cursor or the notes
    // link when a new file is picked) is parked on #fa-open. Focus is not moved in any other case (6).
    const focused = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement : null;
    renderStateInner();
    if (focused && focused !== el.open && focused.closest('[hidden]')) el.open.focus({ preventScroll: true });
  }
  function renderStateInner() {
    const busy = state === 'decoding' || state === 'analysing';
    const done = state === 'done' || state === 'nopitch';
    el.content.dataset.state = state;

    const fresh = state === 'empty' || state === 'cancelled';
    setText(el.open, fresh ? 'Open an audio file' : 'Open another file');
    el.open.classList.toggle('btn-primary', fresh);
    el.open.classList.toggle('btn-ghost', !fresh);

    setText(el.figsTitle, state === 'empty' ? 'Open a recording' : done ? 'Figures' : 'Recording');
    setHidden(el.empty, state !== 'empty');
    setHidden(el.cleared, !showCleared);
    if (state === 'empty') placeTips(true);

    setHidden(el.progress, !busy);
    if (busy) renderProgress();

    const showMsg = state === 'error' || state === 'cancelled';
    setHidden(el.msg, !showMsg);
    const ev = state === 'error' ? errView : null;
    setHidden(el.error, !ev || !!ev.type);
    setText(el.error, ev && !ev.type ? ev.text : '');
    setHidden(el.typeError, !ev?.type);
    setHidden(el.message, state !== 'cancelled');
    setText(el.message, state === 'cancelled' ? message : '');
    setHidden(el.hint, !ev?.hint);
    setHidden(el.errorDetails, !ev?.raw);
    setText(el.errorRaw, ev?.raw ?? '');
    if (!ev?.raw) el.errorDetails.open = false;

    // File strip: whatever is known (3.3). Name only while decoding; rate, channels and duration from Analysing.
    // The notes marker links to About this analysis, so it shows only when that panel does.
    const known = !!meta && (state === 'analysing' || done || state === 'error');
    setHidden(el.info, state === 'empty' || state === 'cancelled');
    setText(el.name, fileName); // textContent only (F-21)
    // A4 and the notes marker only in Done: 3.3 lists name, duration, rate, channels and method for Analysing, and
    // A4 has nothing to act on without figures.
    for (const e of takeOnly) {
      const doneOnly = e.classList.contains('fa-info-a4') || e.classList.contains('fa-marker');
      setHidden(e, !known || (doneOnly && !done) || (e.classList.contains('fa-marker') && !notesList().length));
    }
    if (known) fillInfo();

    setHidden(el.take, !done);
    setHidden(el.readings, !done);
    setHidden(el.about, !done);
    setHidden(el.details, !done);
    for (const o of noPitchOverlays) setHidden(o, state !== 'nopitch');
    setHidden(el.reasons, state !== 'nopitch');
    if (done) placeTips(false);
    setText(el.figsMeta, done && take ? `${fmtDuration(take.durationS)}` : '');
  }

  /** The tips list lives in the drop zone (No file) or in the closed Recording tips disclosure (Done), 3.6. */
  function placeTips(inDropZone: boolean) {
    const parent = inDropZone ? el.tipsBlock : el.tipsSlot;
    if (el.tipsList.parentElement !== parent) parent.appendChild(el.tipsList);
    el.tipsList.setAttribute('aria-labelledby', inDropZone ? 'fa-tips-title' : 'fa-tips-summary');
  }

  function renderProgress() {
    const analysing = state === 'analysing' || pct === 100;
    el.progress.dataset.mode = analysing ? 'determinate' : 'indeterminate';
    setText(el.progressText, analysing ? `Analysing, ${Math.max(0, pct)}%` : `Decoding ${fileName}…`);
    setHidden(el.why, !analysing);
    if (analysing && pct >= 0) {
      setAttr(el.bar, 'aria-valuenow', String(pct));
      setAttr(el.bar, 'aria-valuetext', `Analysing, ${pct} percent`);
      el.fill.style.transform = `scaleX(${pct / 100})`;
    } else {
      el.bar.removeAttribute('aria-valuenow');
      el.bar.removeAttribute('aria-valuetext');
      el.fill.style.transform = '';
    }
  }

  // ------------------------------------------------ file strip and About this analysis (3.2)
  function notesList(): string[] {
    if (!meta || !take) return [];
    const out: string[] = [];
    const lossy = container === 'mp3' || container === 'm4a' || container === 'aac';
    if (meta.rateSource === 'not-confirmed') out.push(`File rate not confirmed. This ${container === 'aac' ? 'AAC' : 'M4A'} file does not state its rate for certain.`);
    // Removed when V-08 and V-07 have verified numbers in VALIDATION.md (spec section 8, 2.1 rule).
    if (lossy) out.push('Accuracy on MP3 and AAC files is unverified.');
    if (resampled()) out.push('Accuracy after resampling is unverified.');
    return out;
  }
  const resampled = () => !!meta && (meta.rateSource === 'resampled' || meta.rateSource === 'resampled-unknown'
    || (meta.rateSource === 'not-confirmed' && meta.nativeRate !== meta.sampleRate));
  /** The note line under the sample rate (3.2 table). Empty for a not-confirmed rate that was not resampled. */
  function rateNote(): string {
    if (!meta) return '';
    if (meta.rateSource === 'header') return 'From the file. Not resampled.';
    if (meta.rateSource === 'resampled-unknown' || (meta.rateSource === 'not-confirmed' && meta.nativeRate === null)) return 'Resampled to 48 kHz, file rate unknown.';
    if (resampled()) return `Resampled from ${meta.nativeRate} Hz to 48 kHz.`;
    return '';
  }

  function fillInfo() {
    if (!meta) return;
    setText(el.dur, fmtDuration(meta.durationS));
    setText(el.rate, `${meta.sampleRate} Hz`);
    const note = rateNote();
    setText(el.rateNote, note);
    setHidden(el.rateNote, !note);
    setHidden(el.rateLink, !resampled());
    setText(el.ch, meta.channels === 1 ? '1' : `${meta.channels}, mixed to one by averaging`);
    const n = notesList().length;
    setText(el.marker, `${n} ${n === 1 ? 'note' : 'notes'} about this file`);
  }
  el.marker.addEventListener('click', () => {
    el.notesTitle.scrollIntoView({ block: 'start' });
    el.notesTitle.focus({ preventScroll: true });
  });

  function fillAbout() {
    if (!take) return;
    const r = take.result;
    const notes = notesList();
    el.notes.replaceChildren(...notes.map((t) => { const li = document.createElement('li'); li.textContent = t; return li; }));
    setHidden(el.notesBlock, !notes.length);
    const hopMs = (r.hop / r.sampleRate) * 1000;
    setText(el.tcPitch, `Each mark is one analysis frame, ${fx(hopMs, 1)} ms. Marks are never joined or averaged, so an octave jump shows as marks an octave away.`);
    setText(el.tcCents, centsCaption());
    let voiced = 0;
    for (let i = 0; i < r.frameCount; i++) if (r.f0[i] > 0) voiced++;
    setText(el.xWindow, `${N} samples (${fx((N / r.sampleRate) * 1000, 1)} ms)`);
    setText(el.xHop, `${r.hop} samples (${fx(hopMs, 1)} ms)`);
    setText(el.xFrames, String(r.frameCount));
    setText(el.xVoiced, String(voiced));
    setText(el.xGate, `${fx(SILENCE_DB, 0)} dBFS`);
    setText(el.xVib, `${VIB_WINDOW_S} s, starting every ${VIB_STEP_S} s`);
    setText(el.xRange, `0 to ${SPEC_TOP_HZ / 1000} kHz`);
  }
  const centsCaption = () => `Cents from the nearest equal-tempered note at A4 = ${a4} Hz. The marks jump from +50 to ${MINUS}50 when the nearest note changes.`;

  // ------------------------------------------------ geometry
  const dur = () => take?.durationS ?? 0;
  const spanLen = () => Math.max(1e-9, span.v1 - span.v0);
  const xFrac = (t: number) => (t - span.v0) / spanLen();
  const tOf = (i: number) => take?.result.t[i] ?? 0;
  const frameAt = (x: number) => (take ? frameNear(take.result.t, x, take.result.sampleRate, take.result.hop, N) : 0);

  function sizeCanvas(c: HTMLCanvasElement): { g: CanvasRenderingContext2D | null; W: number; H: number; dpr: number } {
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(c.clientWidth * dpr), H = Math.round(c.clientHeight * dpr);
    if (W && H && (c.width !== W || c.height !== H)) { c.width = W; c.height = H; }
    return { g: W && H ? c.getContext('2d') : null, W, H, dpr };
  }

  // ------------------------------------------------ colours (re-read on themechange and before every full draw)
  interface Colours { forced: boolean; surface: string; mark: string; ink: string; rule: string; muted: string; spec: SpecPalette }
  const scratch = document.createElement('canvas').getContext('2d');
  function readColours(): Colours {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
    const forced = forcedColors();
    return {
      forced,
      surface: forced ? 'Canvas' : v('--surface-plot', '#FBFAF6'),
      mark: forced ? 'Highlight' : v('--signal', '#E4401B'),
      ink: forced ? 'CanvasText' : v('--ink', '#141413'),
      rule: forced ? 'GrayText' : v('--rule', '#D6D3CA'),
      muted: forced ? 'CanvasText' : v('--muted', '#686761'),
      spec: readSpecPalette(scratch),
    };
  }
  let col = readColours();
  let colSeq = 0;
  const rereadColours = () => { col = readColours(); colSeq++; };

  // ------------------------------------------------ drawing (instant: no animated zoom, pan or cursor, 7)
  interface Parts { pitch?: boolean; cents?: boolean; vib?: boolean; spec?: boolean; ovw?: boolean }
  let pending: Parts = {};
  let raf = 0;
  function schedule(p: Parts) {
    pending = { ...pending, ...p };
    if (!raf) raf = requestAnimationFrame(flush);
  }
  function flush() {
    raf = 0;
    const p = pending;
    pending = {};
    if (!take || root.hidden || el.take.hidden) return;
    const t0 = performance.now();
    try {
      if (p.pitch) drawPitch();
      if (p.cents) drawCents();
      if (p.vib) drawVib();
      if (p.spec) drawSpec();
      if (p.ovw) drawOverview();
      renderAxes();
      renderView();
      renderCursorLines();
    } catch (e) { console.error('file view draw failed', e); }
    // One User Timing entry per redraw, "fa-redraw", with the parts drawn. Read with
    // performance.getEntriesByName('fa-redraw'). Display only, never stored.
    try { performance.measure('fa-redraw', { start: t0, end: performance.now(), detail: Object.keys(p).filter((k) => p[k as keyof Parts]).join(' ') }); } catch { /* User Timing L3 missing */ }
  }
  const all: Parts = { pitch: true, cents: true, vib: true, spec: true, ovw: true };

  /** Frame index range [a, b] whose times can fall in [t0, t1]. */
  function frameRange(t0: number, t1: number): [number, number] {
    const n = take?.result.frameCount ?? 0;
    if (!n || !take) return [0, -1];
    const r = take.result;
    const reach = Math.ceil(N / r.hop) + 1;
    const a = Math.max(0, Math.floor((t0 * r.sampleRate - N) / r.hop) - reach);
    const b = Math.min(n - 1, Math.ceil((t1 * r.sampleRate) / r.hop) + reach);
    return [a, b];
  }

  const yOfSemi = (s: number, H: number) => (axis ? ((axis.hi - s) / (axis.hi - axis.lo)) * H : H / 2);
  const semiOf = (f: number) => 12 * Math.log2(f / a4);

  function drawPitch() {
    const { g, W, H, dpr } = sizeCanvas(el.pitch);
    if (!g || !take) return;
    g.fillStyle = col.surface;
    g.fillRect(0, 0, W, H);
    if (!axis) return;
    g.fillStyle = col.rule;
    for (let s = axis.lo; s <= axis.hi; s++) {
      const y = Math.round(yOfSemi(s, H));
      g.fillRect(0, Math.min(H - 1, y), W, semitoneName(s).natural ? Math.max(1, Math.round(dpr)) : 1);
    }
    drawMarks(g, W, dpr, (i) => { const f = take!.result.f0[i]; return f > 0 ? yOfSemi(semiOf(f), H) : NaN; });
  }

  function drawCents() {
    const { g, W, H, dpr } = sizeCanvas(el.cents);
    if (!g || !take) return;
    g.fillStyle = col.surface;
    g.fillRect(0, 0, W, H);
    g.fillStyle = col.rule;
    g.fillRect(0, 0, W, 1);
    g.fillRect(0, H - 1, W, 1);
    if (col.forced) {
      // Forced colours: GrayText and dashed, so the zero line never reads as a row of marks.
      g.strokeStyle = 'GrayText';
      g.lineWidth = Math.max(1, Math.round(dpr));
      g.setLineDash([6 * dpr, 4 * dpr]);
      g.beginPath(); g.moveTo(0, Math.round(H / 2) + 0.5); g.lineTo(W, Math.round(H / 2) + 0.5); g.stroke();
      g.setLineDash([]);
    } else {
      g.fillStyle = col.muted;
      g.fillRect(0, Math.round(H / 2), W, Math.max(1, Math.round(dpr)));
    }
    const c = cents;
    if (!c) return;
    drawMarks(g, W, dpr, (i) => { const d = deviationOf(c[i]); return Number.isFinite(d) ? ((50 - d) / 100) * H : NaN; });
  }

  /** One square mark per voiced frame in view, centred on its own value: never joined, never averaged (F-27). */
  function drawMarks(g: CanvasRenderingContext2D, W: number, dpr: number, yOf: (i: number) => number) {
    if (!take) return;
    const t = take.result.t;
    const s = Math.max(2, Math.round(2.5 * dpr));
    const [a, b] = frameRange(span.v0, span.v1);
    g.fillStyle = col.mark;
    for (let i = a; i <= b; i++) {
      const y = yOf(i);
      if (!Number.isFinite(y)) continue; // unvoiced frames draw nothing; gaps stay gaps
      const fx0 = xFrac(t[i]);
      if (fx0 < 0 || fx0 > 1) continue;
      g.fillRect(fx0 * W - s / 2, y - s / 2, s, s);
    }
  }

  /** Vibrato rows: value ranges fit the found values; "none found" windows sit hollow on a labelled baseline. */
  function vibLayout(H: number, dpr: number) {
    const gap = VIB_GAP_PX * dpr, none = VIB_NONE_PX * dpr, rowH = (H - gap) / 2;
    const rows = [0, 1].map((k) => {
      const top = k * (rowH + gap);
      return { top, valTop: top + 4 * dpr, valBottom: top + rowH - none, base: top + rowH - none / 2 };
    });
    return { rows, rowH };
  }
  function vibRange(k: 0 | 1): { lo: number; hi: number } {
    const vals = (take?.result.vibrato ?? []).map((w) => (k === 0 ? w.rateHz : w.extentCents)).filter((v): v is number => v !== null);
    if (!vals.length) return k === 0 ? { lo: 4, hi: 8 } : { lo: 0, hi: 50 };
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = Math.max((hi - lo) * 0.15, k === 0 ? 0.25 : 5);
    lo -= pad; hi += pad;
    if (k === 1) lo = Math.max(0, lo);
    return { lo, hi };
  }
  function drawVib() {
    const { g, W, H, dpr } = sizeCanvas(el.vib);
    if (!g || !take) return;
    g.fillStyle = col.surface;
    g.fillRect(0, 0, W, H);
    const { rows } = vibLayout(H, dpr);
    const ranges = [vibRange(0), vibRange(1)];
    for (const r of rows) {
      g.fillStyle = col.rule; // decorative
      g.fillRect(0, Math.round(r.valBottom), W, 1);
      g.fillStyle = col.muted; // the labelled "None" baseline carries meaning, so it gets --muted contrast
      g.fillRect(0, Math.round(r.base), W, Math.max(1, Math.round(dpr)));
    }
    const rad = Math.max(2, Math.round(3 * dpr));
    g.lineWidth = Math.max(1, Math.round(dpr));
    for (const w of take.result.vibrato) {
      const fxm = xFrac((w.t0 + w.t1) / 2);
      if (fxm < 0 || fxm > 1) continue;
      const x = fxm * W;
      for (const k of [0, 1] as const) {
        const r = rows[k], v = k === 0 ? w.rateHz : w.extentCents, rg = ranges[k];
        g.beginPath();
        if (v === null) {
          g.arc(x, r.base, rad, 0, 2 * Math.PI);
          g.fillStyle = col.surface; g.fill();
          g.strokeStyle = col.ink; g.stroke();
        } else {
          const y = r.valBottom - ((v - rg.lo) / (rg.hi - rg.lo)) * (r.valBottom - r.valTop);
          g.arc(x, y, rad, 0, 2 * Math.PI);
          g.fillStyle = col.ink; g.fill();
        }
      }
    }
  }

  /** Spectrogram over the visible span. Fewer columns than frames: each column is the mean power of the frames
   *  it covers (spec 4.2 step 7, stated in the technical caption). F0 marks are per frame, at their own row. */
  function drawSpec() {
    const { g, W, H, dpr } = sizeCanvas(el.spec);
    if (!g || !take) return;
    const r = take.result, B = r.specBins, fs = r.sampleRate;
    const img = g.createImageData(W, H);
    const d = img.data;
    const sums = new Float64Array(W * B);
    const counts = new Uint32Array(W);
    const [a, b] = frameRange(span.v0, span.v1);
    for (let i = a; i <= b; i++) {
      const f = xFrac(r.t[i]);
      if (f < 0 || f >= 1) continue;
      const x = Math.floor(f * W);
      counts[x]++;
      const row = i * B, o = x * B;
      for (let k = 0; k < B; k++) sums[o + k] += r.spectrum[row + k];
    }
    const colPower = new Float64Array(B);
    for (let x = 0; x < W; x++) {
      if (counts[x]) {
        for (let k = 0; k < B; k++) colPower[k] = sums[x * B + k] / counts[x];
        fillSpecColumn(d, W, H, x, col.spec, colPower, N, fs);
      } else {
        // More columns than frames: the column shows the frame nearest its middle.
        const t = span.v0 + ((x + 0.5) / W) * spanLen();
        const i = frameAt(t);
        const ok = i >= 0 && t >= 0 && t <= dur() && Math.abs(r.t[i] - t) <= (r.hop / fs) * 2;
        fillSpecColumn(d, W, H, x, col.spec, ok ? r.spectrum.subarray(i * B, (i + 1) * B) : null, N, fs);
      }
    }
    const half = Math.max(1, Math.round(1.5 * dpr));
    const wMark = Math.max(1, Math.round(1.5 * dpr));
    for (let i = a; i <= b; i++) {
      const f0 = r.f0[i];
      if (!(f0 > 0)) continue;
      const fr = xFrac(r.t[i]);
      if (fr < 0 || fr >= 1) continue;
      const x0 = Math.floor(fr * W);
      for (let x = x0; x < Math.min(W, x0 + wMark); x++) putF0Mark(d, W, H, x, f0, col.spec, half);
    }
    g.putImageData(img, 0, 0);
  }

  /** The overview's pixels depend on the take, its size, A4 and the colours, never on the span: it is replotted
   *  only when one of those changes. A span change only moves .fa-ovw-view (renderView). */
  let ovwKey = '';
  function drawOverview() {
    const hiddenOvw = !take || span.v1 - span.v0 >= dur() - 1e-9;
    setHidden(el.ovwRow, hiddenOvw);
    if (hiddenOvw || !take) return;
    const { g, W, H } = sizeCanvas(el.ovw);
    if (!g) return;
    const key = `${job}|${W}x${H}|${a4}|${colSeq}`;
    if (key === ovwKey) return;
    ovwKey = key;
    g.fillStyle = col.surface;
    g.fillRect(0, 0, W, H);
    if (!axis) return;
    const r = take.result, D = dur();
    g.fillStyle = col.mark;
    for (let i = 0; i < r.frameCount; i++) {
      const f = r.f0[i];
      if (!(f > 0)) continue;
      g.fillRect((r.t[i] / D) * W, yOfSemi(semiOf(f), H) - 1, 1, 2);
    }
  }

  // ------------------------------------------------ HTML axes, view bar, cursor (7: no tweens)
  /** Minimum vertical distance between axis labels: the computed label line height, so it grows with text
   *  size (200% text) instead of a fixed px gap. */
  function labelGap(): number {
    const cs = getComputedStyle(el.pitchAxis);
    const lh = parseFloat(cs.lineHeight);
    return Number.isFinite(lh) && lh > 0 ? lh : (parseFloat(cs.fontSize) || 11) * 1.3;
  }

  function renderAxes() {
    if (!take) return;
    const gap = labelGap();
    // Pitch: a gridline at every semitone, labels at naturals, thinned so they never overlap.
    const ph = el.pitch.clientHeight;
    const labels: string[] = [];
    if (axis && ph) {
      let lastY = Infinity;
      for (let s = axis.lo; s <= axis.hi; s++) {
        const n = semitoneName(s);
        if (!n.natural) continue;
        const y = yOfSemi(s, ph);
        if (lastY - y < gap) continue;
        lastY = y;
        labels.push(`<span style="top:${((y / ph) * 100).toFixed(3)}%">${noteGlyph(n.name)}</span>`);
      }
    }
    const pk = labels.join('');
    if (el.pitchAxis.dataset.key !== pk) { el.pitchAxis.dataset.key = pk; el.pitchAxis.innerHTML = pk; }

    // Vibrato: two ticks per row and the "None" baseline label.
    const vh = el.vib.clientHeight;
    if (vh) {
      const { rows } = vibLayout(vh, 1);
      // "None" labels are placed first; a tick is kept only if it is at least one label line from every label
      // already placed, so ticks never overlap "None" or the other row (a11y #6).
      const placed: Array<{ y: number; html: string }> = rows.map((r) => ({ y: r.base, html: `<span class="fa-none" style="top:${((r.base / vh) * 100).toFixed(3)}%">None</span>` }));
      ([0, 1] as const).forEach((k) => {
        const r = rows[k], rg = vibRange(k);
        const ticks = niceTicks(rg.lo, rg.hi, 2).filter((v) => v >= rg.lo && v <= rg.hi);
        for (const v of ticks.slice(0, 3)) {
          const y = r.valBottom - ((v - rg.lo) / (rg.hi - rg.lo)) * (r.valBottom - r.valTop);
          if (placed.some((p) => Math.abs(p.y - y) < gap)) continue;
          placed.push({ y, html: `<span style="top:${((y / vh) * 100).toFixed(3)}%">${k === 0 ? fx(v, Number.isInteger(v) ? 0 : 1) : `±${fx(v, 0)}`}</span>` });
        }
      });
      const vk = placed.sort((a, b) => a.y - b.y).map((p) => p.html).join('');
      if (el.vibAxis.dataset.key !== vk) { el.vibAxis.dataset.key = vk; el.vibAxis.innerHTML = vk; }
    }

    // Time axis, m:ss.s.
    const tw = el.taxis.clientWidth;
    const step = timeStep(spanLen(), Math.max(2, Math.floor(tw / 90)));
    const ticks: string[] = [];
    for (let v = Math.ceil(span.v0 / step - 1e-9) * step; v <= span.v1 + 1e-9; v += step) {
      ticks.push(`<span style="left:${(xFrac(v) * 100).toFixed(3)}%">${fmtClock(v)}</span>`);
    }
    const tk = ticks.join('');
    if (el.taxis.dataset.key !== tk) { el.taxis.dataset.key = tk; el.taxis.innerHTML = tk; }

    const range = `${fmtClock(span.v0)} to ${fmtClock(span.v1)}`;
    const where = 'Values are in the time cursor and Readings at cursor.';
    setAttr(el.pitch, 'aria-label', `Pitch over time, ${range}. ${where}`);
    setAttr(el.cents, 'aria-label', `Cents over time, ${range}. ${where}`);
    setAttr(el.vib, 'aria-label', `Vibrato speed and width over time, ${range}. ${where}`);
    setAttr(el.spec, 'aria-label', `Spectrogram 0 to ${SPEC_TOP_HZ / 1000} kHz with pitch marks, ${range}. ${where}`);
  }

  function renderView() {
    if (!take) return;
    const D = dur();
    setText(el.viewText, `Showing ${fmtClock(span.v0)} to ${fmtClock(span.v1)} of ${fmtClock(D)}`);
    const whole = span.v0 <= 1e-9 && span.v1 >= D - 1e-9;
    const minLen = minSpan(D, VIB_WINDOW_S);
    const off = (b: HTMLButtonElement, v: boolean) => setAttr(b, 'aria-disabled', String(v));
    off(el.earlier, span.v0 <= 1e-9);
    off(el.later, span.v1 >= D - 1e-9);
    off(el.zoomIn, spanLen() <= minLen + 1e-9);
    off(el.zoomOut, whole);
    off(el.whole, whole);
    if (!el.ovwRow.hidden) {
      el.ovwView.style.left = `${(span.v0 / D) * 100}%`;
      el.ovwView.style.width = `${((span.v1 - span.v0) / D) * 100}%`;
    }
  }

  /** Returns true when the span changed. */
  function setSpan(s: Span): boolean {
    if (s.v0 === span.v0 && s.v1 === span.v1) return false;
    span = s;
    schedule(all);
    return true;
  }

  function renderCursorLines() {
    if (!take) return;
    const f = xFrac(tOf(cursor));
    const inView = f >= 0 && f <= 1;
    for (const c of clines) {
      setHidden(c, !inView);
      if (inView) c.style.left = `${(f * 100).toFixed(4)}%`;
    }
  }

  /** Cursor line, slider value and Readings at cursor for the current frame (2.2, 3.2). */
  function renderCursor() {
    if (!take) return;
    const r = take.result;
    const i = Math.max(0, Math.min(r.frameCount - 1, cursor));
    const t = r.t[i] ?? 0;
    const f0 = r.f0[i] ?? 0;
    const ts = fx(t, 3);
    setAttr(el.cursor, 'aria-valuemax', fx(dur(), 3));
    setAttr(el.cursor, 'aria-valuenow', ts);
    setText(el.rTime, `${ts} s`);
    if (f0 > 0) {
      const n = nearestNote(f0, a4);
      const glyph = noteGlyph(n.name);
      const c = Math.round(n.cents) || 0;
      const dir = c < 0 ? 'flat' : 'sharp';
      const amount = c === 0 ? '0 cents' : `${centsWord(Math.abs(c))} ${dir}`;
      setText(el.cursorLine, `At ${ts} s: ${glyph}, ${fx(f0, 1)} Hz, ${amount}`);
      setAttr(el.cursor, 'aria-valuetext', `${ts} seconds. ${splitNote(n.name).spoken}, ${fx(f0, 1)} hertz, ${amount}.`);
      setText(el.rNote, glyph);
      setText(el.rPitch, `${fx(f0, 1)} Hz`);
      setText(el.rOffby, c === 0 ? `0 cents from ${glyph}` : `${centsWord(Math.abs(c))} ${dir} of ${glyph}`);
      setText(el.dF0, `${fx(f0, 2)} Hz`);
      setText(el.dDev, `${signedFixed(n.cents, 1)} c from ${glyph} (${fx(n.targetHz, 2)} Hz)`);
    } else {
      setText(el.cursorLine, `At ${ts} s: no pitch`);
      setAttr(el.cursor, 'aria-valuetext', `${ts} seconds. No pitch.`);
      setText(el.rNote, 'No pitch at this time');
      setText(el.rPitch, 'No pitch');
      setText(el.rOffby, 'No pitch');
      setText(el.dF0, 'No pitch');
      setText(el.dDev, 'No pitch');
    }
    const lvl = r.rmsDb[i];
    setText(el.dLevel, Number.isFinite(lvl) ? `${fx(lvl, 1)} dBFS` : 'Not measured');

    // Vibrato: the window whose middle is nearest the cursor, among those that contain it.
    let vib = 'No window covers this time', note = '';
    if (state === 'nopitch') vib = 'No pitch at this time';
    else {
      const k = windowAt(r.vibrato, t);
      if (k >= 0) {
        const w = r.vibrato[k];
        if (w.rateHz !== null && w.extentCents !== null) {
          vib = `${fx(w.rateHz, 1)} per second, ±${fx(w.extentCents, 0)} cents`;
          note = `window ${fx(w.t0, 1)} to ${fx(w.t1, 1)} s`;
        } else vib = `No vibrato found in the window ${fx(w.t0, 1)} to ${fx(w.t1, 1)} s`;
      }
    }
    setText(el.rVib, vib);
    setText(el.rVibNote, note);
    setHidden(el.rVibNote, !note);
    renderCursorLines();
  }

  function moveCursor(i: number) {
    if (!take) return;
    cursor = Math.max(0, Math.min(take.result.frameCount - 1, i));
    const s = panToInclude(span, tOf(cursor), dur());
    setSpan(s);
    renderCursor();
  }

  // ------------------------------------------------ view bar (2.1)
  const center = () => { const t = tOf(cursor); return t >= span.v0 && t <= span.v1 ? t : (span.v0 + span.v1) / 2; };
  // View changes she asked for (buttons, + and -) are announced politely, debounced so repeated presses say
  // only the last span (a11y #5). Cursor moves that pan the view are not announced; the cursor value is.
  const announceView = () => {
    window.clearTimeout(viewAnnTimer);
    viewAnnTimer = window.setTimeout(() => {
      if (take && !root.hidden) say(`Showing ${fmtClock(span.v0)} to ${fmtClock(span.v1)} of ${fmtClock(dur())}`);
    }, VIEW_ANNOUNCE_MS);
  };
  const zoom = (factor: number) => { if (setSpan(zoomSpan(span, factor, center(), dur(), minSpan(dur(), VIB_WINDOW_S)))) announceView(); };
  const shift = (dir: number) => { if (setSpan(clampSpan(span.v0 + dir * spanLen(), span.v1 + dir * spanLen(), dur()))) announceView(); };
  const guard = (b: HTMLButtonElement, fn: () => void) => b.addEventListener('click', () => { if (b.getAttribute('aria-disabled') !== 'true' && take) fn(); });
  guard(el.earlier, () => shift(-1));
  guard(el.later, () => shift(1));
  guard(el.zoomIn, () => zoom(0.5));
  guard(el.zoomOut, () => zoom(2));
  guard(el.whole, () => { if (setSpan({ v0: 0, v1: dur() })) announceView(); });

  // ------------------------------------------------ time cursor keys and pointer (2.2)
  el.cursor.addEventListener('keydown', (e) => {
    if (!take || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = tOf(cursor);
    const k = e.key;
    let handled = true;
    if (k === 'ArrowRight' || k === 'ArrowUp') moveCursor(e.shiftKey ? frameAt(t + 1) : cursor + 1);
    else if (k === 'ArrowLeft' || k === 'ArrowDown') moveCursor(e.shiftKey ? frameAt(t - 1) : cursor - 1);
    else if (k === 'PageUp') { const len = spanLen(); moveCursor(frameAt(t + len)); }
    else if (k === 'PageDown') { const len = spanLen(); moveCursor(frameAt(t - len)); }
    else if (k === 'Home') moveCursor(0);
    else if (k === 'End') moveCursor(take.result.frameCount - 1);
    else if (k === '+' || k === '=') zoom(0.5);
    else if (k === '-' || k === '_') zoom(2);
    else handled = false;
    if (handled) e.preventDefault();
  });

  /** Time at a client x inside the plot column, or null outside it. */
  function timeAtClientX(clientX: number): number | null {
    const box = el.taxis.getBoundingClientRect();
    if (!box.width || clientX < box.left || clientX > box.right) return null;
    return span.v0 + ((clientX - box.left) / box.width) * spanLen();
  }
  let down: { x: number; y: number; id: number } | null = null;
  el.cursor.addEventListener('pointerdown', (e) => { if (e.button === 0) down = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
  el.cursor.addEventListener('pointercancel', () => { down = null; });
  el.cursor.addEventListener('pointerup', (e) => {
    const d = down;
    down = null;
    if (!d || d.id !== e.pointerId || !take) return;
    // A drag of more than DRAG_PX selects a span for Measure a held note (3.5, M2.3a, not built): ignored here.
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG_PX) return;
    const t = timeAtClientX(e.clientX);
    if (t === null) return;
    moveCursor(frameAt(t));
    el.cursor.focus({ preventScroll: true });
  });
  // Wheel input does nothing, so page scroll is never hijacked (2.2).

  // Overview strip: click or drag to move the view (2.1).
  let ovwDrag = false;
  const ovwTo = (clientX: number) => {
    const box = el.ovw.getBoundingClientRect();
    if (!box.width || !take) return;
    const c = ((clientX - box.left) / box.width) * dur();
    const len = spanLen();
    setSpan(clampSpan(c - len / 2, c + len / 2, dur()));
  };
  el.ovw.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; cancelOvwFrame(); ovwDrag = true; el.ovw.setPointerCapture?.(e.pointerId); ovwTo(e.clientX); });
  el.ovw.addEventListener('pointermove', (e) => {
    if (!ovwDrag) return;
    ovwX = e.clientX;
    if (!ovwRaf) ovwRaf = requestAnimationFrame(() => { ovwRaf = 0; if (ovwX !== null) ovwTo(ovwX); ovwX = null; });
  });
  const endOvw = () => { ovwDrag = false; cancelOvwFrame(); };
  el.ovw.addEventListener('pointerup', endOvw);
  el.ovw.addEventListener('pointercancel', endOvw);

  // ------------------------------------------------ resize and theme
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (take) schedule(all); }).observe(el.stack);
  window.addEventListener('resize', () => { if (take) schedule(all); }); // devicePixelRatio changes with browser zoom
  document.addEventListener('themechange', () => { rereadColours(); if (take) schedule(all); });
  window.matchMedia?.('(forced-colors: active)').addEventListener?.('change', () => { rereadColours(); if (take) schedule(all); });

  // Figures are drawn only while the route shows: redraw when it is committed (the router unhides the section).
  new MutationObserver(() => { if (!root.hidden && take) { rereadColours(); schedule(all); } })
    .observe(root, { attributes: true, attributeFilter: ['hidden'] });

  renderState();

  return {
    title: 'Recording analysis',
    nav: 'tools',
    enter() {
      // A4 is shared with Voice analysis; take whatever was saved last.
      a4 = currentA4();
      el.a4.value = String(a4);
      el.a4.removeAttribute('aria-invalid');
      setText(el.a4Error, '');
      if (fileCleared) { showCleared = true; fileCleared = false; } // shown once (3.3)
      else showCleared = false;
      rereadColours();
      renderState();
    },
    // Stop the worker, discard buffers and results, remember (in memory only) that a file was open (1.3).
    async leave() {
      // "If a file was open" (1.3): busy or done, or an error after decoding (too short, out of memory, analysis
      // failed), where the strip showed the recording. Errors before decoding (type, size, could not decode) had nothing open.
      const hadFile = state === 'decoding' || state === 'analysing' || state === 'done' || state === 'nopitch' || (state === 'error' && !!meta);
      cancelAnalysis();
      discard();
      fileName = '';
      container = 'unknown';
      if (hadFile) fileCleared = true;
      state = 'empty';
      setHidden(el.notice, true);
      showDrop(false);
      dragDepth = 0;
      renderState();
    },
  };
}
