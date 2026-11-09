// Methods, #/methods and the deep links #/methods/calibration, /latency and /self-test (DESIGN.md 2.12, 3.4, 6).
// Three checks in result blocks. One runs at a time, each with its own AbortController; leaving Methods aborts
// the running check, waits for it to settle and stops the mic if a check owns it. A hash change inside Methods
// is not a leave: it scrolls to and focuses that block's heading and the check keeps running.
//
// The mic belongs to live.ts (owners 'calibration' and 'latency'). The math is in checks.ts, the criteria in
// criteria.ts (results/summary.json), the offline render in src/audio/offline.ts (loaded on the first run).
// IDs use the m- prefix from DESIGN.md 7.3; the legacy page in the DOM keeps cal-hz, cal-run and the rest.

import type { Route } from '../router.ts';
import { live, type LiveErrorKind } from '../live.ts';
import { setField, type FieldName, type FieldStatus } from '../fields.ts';
import { MINUS, signedFixed } from '../readout.ts';
import { THRESHOLDS } from '../criteria.ts';
import {
  CAL_DEFAULT_HZ, CAL_HZ_MAX, CAL_HZ_MIN, CAL_MIN_FRAMES, CAL_MS, LOOP_MATCH_CENTS, LOOP_TONES, SELF_EDGE_S, SET_LABEL, SELF_LAT_MATCH_CENTS,
  parseCalHz, runCalibration, runLoopback, runSelfTest,
  type CalibrationResult, type LoopbackResult, type Outcome, type SelfTestResult, type Thresholds, type ToneSetReport, type Verdict,
} from '../checks.ts';
import '../../styles/methods.css';

type Kind = 'calibration' | 'latency' | 'selftest';
type BlockStatus = 'Not run this visit' | 'Needs microphone' | 'Running' | 'Done' | 'Done with a warning' | 'Could not run' | 'Cancelled';

const NO_THRESHOLD = 'No pass threshold is set yet.';
const DEV_ONLY = '(dev server only, opens raw text)';
const INSECURE_MSG = 'The microphone only works on a secure page. Open http://127.0.0.1:5173.';
const ANOTHER = 'Another check is running.';
const CANCELLED_MSG = 'Cancelled because you left the page.';
/** leave() waits this long for a check to settle, then goes on without it (a hung render must not freeze navigation). */
const LEAVE_CAP_MS = 3000;

const MIC_MSG: Record<LiveErrorKind, string> = {
  denied: "Microphone access is blocked for this page. Allow it in the browser's site settings, then run the check again.",
  nodevice: 'No microphone found. Connect one or switch on your audio interface, then run the check again.',
  busy: 'The microphone could not be opened. Another app may be using it. Close it, then run the check again.',
  insecure: INSECURE_MSG,
  analyser: 'This browser could not start the audio analyser.',
  ended: 'The microphone stopped during the check. It may have been unplugged. Run the check again.',
};

/** Fixed decimals with a real minus sign. Not finite: null, so the caller says why there is no number. */
const fx = (x: number, d: number): string | null => (Number.isFinite(x) ? x.toFixed(d).replace(/^-/, MINUS) : null);
const pctText = (frac: number) => `${+(frac * 100).toFixed(2)}%`;

// ---------------------------------------------------------------- markup
const html = `
<div class="shell route m-route">
  <header class="page-header">
    <div class="ph-text">
      <p class="eyebrow">Setup</p>
      <h1 id="methods-title" tabindex="-1">Methods and setup checks</h1>
      <p class="lede">Run these once on a new microphone, interface or computer. You do not need them to sing.</p>
    </div>
  </header>

  <div class="m-grid">
    <section class="panel m-check m-half" id="m-cal" aria-labelledby="m-cal-title">
      <div class="strip">
        <h2 class="strip-title" id="m-cal-title" tabindex="-1">Calibration</h2>
        <span class="m-status"><span class="dot" id="m-cal-dot" aria-hidden="true"></span><span id="m-cal-status">Not run this visit</span></span>
      </div>
      <div class="pbody">
        <p class="prose">Checks how closely your setup reads a tone of known pitch. Play a steady reference tone into the microphone, enter its frequency, and measure for ${CAL_MS / 1000} s.</p>
        <p class="m-req">Needs the microphone and a steady reference tone, for example from a tone generator.</p>
        <p class="m-field">
          <label for="m-cal-hz">Reference</label>
          <input class="m-input" id="m-cal-hz" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="${CAL_DEFAULT_HZ}" aria-describedby="m-cal-hz-unit m-cal-hz-error">
          <span class="m-unit" id="m-cal-hz-unit">Hz, ${CAL_HZ_MIN} to ${CAL_HZ_MAX}</span>
        </p>
        <p class="m-error" id="m-cal-hz-error" role="status"></p>
        <p class="m-action"><button type="button" class="btn btn-primary" id="m-cal-run" aria-describedby="m-cal-reason">Measure for ${CAL_MS / 1000} s</button><span class="m-reason" id="m-cal-reason" hidden></span></p>
        <p class="m-progress" id="m-cal-progress" role="status"></p>
        <p class="m-detail" id="m-cal-detail"></p>
        <div class="m-results" id="m-cal-results"></div>
        <p class="m-method">Method: the median of the voiced frames in the ${CAL_MS / 1000} s window. Offset is 1200 × log2(median ÷ reference) in cents. Frame spread P95 is the 95th percentile of each frame's distance from that median. At least ${CAL_MIN_FRAMES} voiced frames are needed.</p>
      </div>
    </section>

    <section class="panel m-check m-half" id="m-loop" aria-labelledby="m-loop-title">
      <div class="strip">
        <h2 class="strip-title" id="m-loop-title" tabindex="-1">Loopback latency</h2>
        <span class="m-status"><span class="dot" id="m-loop-dot" aria-hidden="true"></span><span id="m-loop-status">Not run this visit</span></span>
      </div>
      <div class="pbody">
        <p class="prose">Measures the delay from a test tone leaving the speakers to its pitch being drawn on screen.</p>
        <p class="m-req">Speakers on, not headphones. Set the volume low first. Keep this tab visible.</p>
        <p class="m-action"><button type="button" class="btn btn-primary" id="m-loop-run" aria-describedby="m-loop-reason">Play ${LOOP_TONES} test tones</button><span class="m-reason" id="m-loop-reason" hidden></span></p>
        <p class="m-progress" id="m-loop-progress" role="status"></p>
        <p class="m-detail" id="m-loop-detail"></p>
        <div class="m-results" id="m-loop-results"></div>
        <p class="m-method">Method: each tone is 440 Hz. The delay runs from the time the tone reaches the output device, as the browser reports it, to the first drawn frame within ${LOOP_MATCH_CENTS} cents of 440 Hz. Median and range over the tones detected.</p>
      </div>
    </section>

    <section class="panel m-check" id="m-self" aria-labelledby="m-self-title">
      <div class="strip">
        <h2 class="strip-title" id="m-self-title" tabindex="-1">Self-test</h2>
        <span class="m-status"><span class="dot" id="m-self-dot" aria-hidden="true"></span><span id="m-self-status">Not run this visit</span></span>
      </div>
      <div class="pbody">
        <p class="prose">Runs the synthetic test files through the same AudioWorklet offline and scores them against the known pitch. Does not use the microphone. Needs the dev server.</p>
        <p class="m-req">The test files are served from /fixtures/synthetic/ by the dev server only (npx vite), and are generated with py/synth.py.</p>
        <p class="m-action"><button type="button" class="btn btn-primary" id="m-self-run" aria-describedby="m-self-reason">Run the self-test</button><span class="m-reason" id="m-self-reason" hidden></span></p>
        <p class="m-progress" id="m-self-progress" role="status"></p>
        <p class="m-detail" id="m-self-detail"></p>
        <div class="m-results" id="m-self-results"></div>
        <p class="m-method">Method: verdicts use the thresholds in results/summary.json, written by py/score.py. Steady-tone frames within ${Math.round(SELF_EDGE_S * 1000)} ms of either end of a file are skipped. A file that is rendering cannot be stopped, so leaving the page cancels the run after that file and keeps no numbers.</p>
      </div>
    </section>

    <section class="panel m-docs" aria-labelledby="m-docs-title">
      <div class="strip"><h2 class="strip-title" id="m-docs-title">Documents</h2></div>
      <div class="pbody">
        <p class="prose"><a class="link" href="/MEASUREMENT.md">MEASUREMENT.md</a> defines every measurement. <a class="link" href="/VALIDATION.md">VALIDATION.md</a> has the full results, including what fails. Both ${DEV_ONLY}.</p>
      </div>
    </section>
  </div>
</div>`;

// ---------------------------------------------------------------- DOM helpers
function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string | null, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
}

type Row = [label: string, value: string, note?: string];
function kvList(rows: Row[]): HTMLElement {
  const dl = h('dl', 'kv-list');
  for (const [label, value, note] of rows) {
    const body = h('dd', 'kv-body', h('span', 'kv-value', value));
    if (note) body.append(h('span', 'm-kv-note', note));
    dl.append(h('div', 'kv', h('dt', 'kv-label', label), body));
  }
  return dl;
}
function msg(text: string, tone: 'error' | null = null): HTMLElement {
  const p = h('p', 'm-msg', text);
  if (tone) p.dataset.tone = tone;
  return p;
}
function rawDetails(text: string): HTMLElement {
  return h('details', 'disclosure', h('summary', null, 'Details'), h('pre', 'm-raw', text));
}

// ---------------------------------------------------------------- view
export function methodsRoute(root: HTMLElement): Route {
  root.innerHTML = html;
  root.setAttribute('aria-labelledby', 'methods-title');

  const $ = <T extends HTMLElement = HTMLElement>(id: string) => {
    const el = root.querySelector<T>(`#${id}`);
    if (!el) throw new Error(`methods view: #${id} missing`);
    return el;
  };

  interface Block {
    kind: Kind; field: FieldName; sub: string; needsMic: boolean;
    section: HTMLElement; title: HTMLElement; status: HTMLElement; dot: HTMLElement;
    run: HTMLButtonElement; reason: HTMLElement; progress: HTMLElement; detail: HTMLElement; results: HTMLElement;
    idle: string; busy: string;
  }
  const block = (kind: Kind, p: string, field: FieldName, sub: string, needsMic: boolean, busy: string): Block => {
    const run = $<HTMLButtonElement>(`${p}-run`);
    return {
      kind, field, sub, needsMic,
      section: $(p), title: $(`${p}-title`), status: $(`${p}-status`), dot: $(`${p}-dot`),
      run, reason: $(`${p}-reason`), progress: $(`${p}-progress`), detail: $(`${p}-detail`), results: $(`${p}-results`),
      idle: run.textContent ?? '', busy,
    };
  };
  const blocks: Record<Kind, Block> = {
    calibration: block('calibration', 'm-cal', 'calibration', 'calibration', true, 'Measuring…'),
    latency: block('latency', 'm-loop', 'latency', 'latency', true, 'Playing tones…'),
    selftest: block('selftest', 'm-self', 'selftest', 'self-test', false, 'Running…'),
  };
  const calHz = $<HTMLInputElement>('m-cal-hz');
  const calErr = $('m-cal-hz-error');

  const insecure = () => !window.isSecureContext || !navigator.mediaDevices?.getUserMedia;

  function setStatus(b: Block, s: BlockStatus) {
    b.status.textContent = s;
    const state = s === 'Running' ? 'working'
      : s === 'Done' || s === 'Done with a warning' ? 'done'
        : s === 'Could not run' || s === 'Needs microphone' ? 'error' : null;
    if (state) b.section.dataset.state = state; else delete b.section.dataset.state;
    b.dot.className = `dot${s === 'Running' && b.needsMic ? ' dot-live' : s === 'Done' ? ' dot-ok' : state === 'error' ? ' dot-error' : ''}`;
  }

  function field(b: Block, status: FieldStatus, value: string) {
    setField(b.field, { status, value, action: { label: 'Setup checks', href: `#/methods/${b.sub}` } });
  }

  // ------------------------------------------------ one check at a time
  let running: { kind: Kind; ctrl: AbortController; done: Promise<void>; stopping: boolean; abandoned: boolean } | null = null;

  function syncButtons() {
    for (const b of Object.values(blocks)) {
      const mine = running?.kind === b.kind;
      let reason = '';
      if (!mine && running) reason = ANOTHER;
      else if (!running && b.needsMic && insecure()) reason = INSECURE_MSG;
      b.run.disabled = !!running || !!reason;
      b.run.textContent = mine ? (running?.stopping ? 'Stopping…' : b.busy) : b.idle;
      b.reason.textContent = reason;
      b.reason.hidden = !reason;
    }
    calHz.disabled = !!running;
  }

  function begin(b: Block, fn: (signal: AbortSignal, gone: () => boolean) => Promise<void>) {
    if (running) return;
    const ctrl = new AbortController();
    const r = { kind: b.kind, ctrl, done: Promise.resolve(), stopping: false, abandoned: false };
    running = r;
    b.results.replaceChildren();
    setStatus(b, 'Running');
    field(b, 'idle', 'Running');
    syncButtons();
    // An abandoned run (leave() stopped waiting for it) never paints: the block may belong to a later visit.
    r.done = fn(ctrl.signal, () => r.abandoned)
      .catch((e) => { console.error('check failed', e); if (!r.abandoned) showError(b, 'The check could not run.', String(e)); })
      .finally(() => {
        if (r.abandoned) return;
        if (running === r) running = null;
        syncButtons();
        // The button was disabled while busy, which drops focus; give it back if nothing else took it.
        if (document.activeElement === document.body && !root.hidden) b.run.focus();
      });
  }

  // ------------------------------------------------ shared outcome handling
  function showCancelled(b: Block) {
    setStatus(b, 'Cancelled');
    b.progress.textContent = '';
    b.detail.textContent = '';
    b.results.replaceChildren(msg(CANCELLED_MSG));
    field(b, 'idle', 'Cancelled');
  }
  function showError(b: Block, text: string, detail: string, status: BlockStatus = 'Could not run') {
    setStatus(b, status);
    b.progress.textContent = status === 'Needs microphone' ? 'Needs microphone.' : 'Could not run.';
    b.detail.textContent = '';
    b.results.replaceChildren(msg(text, 'error'), ...(detail ? [rawDetails(detail)] : []));
    field(b, 'error', status);
  }
  function showWarning(b: Block, text: string) {
    setStatus(b, 'Done with a warning');
    b.progress.textContent = `Done with a warning. ${text}`;
    b.detail.textContent = '';
    b.results.replaceChildren(msg(text, 'error'));
    field(b, 'idle', 'Done with a warning');
  }
  /** Handles every outcome except 'done'. Returns the result when there is one. */
  function settle<R>(b: Block, o: Outcome<R>): R | null {
    if (o.kind === 'done') return o.result;
    if (o.kind === 'cancelled') showCancelled(b);
    else if (o.kind === 'warning') showWarning(b, o.message);
    else if (o.kind === 'mic') {
      const needs = o.error === 'denied' || o.error === 'nodevice' || o.error === 'insecure';
      showError(b, MIC_MSG[o.error], o.error === 'analyser' ? o.detail : '', needs ? 'Needs microphone' : 'Could not run');
    } else showError(b, 'The check could not run.', o.detail);
    return null;
  }

  // ------------------------------------------------ calibration
  function validateCal(): number | null {
    const v = parseCalHz(calHz.value);
    if (v === null) {
      calErr.textContent = `Enter a value from ${CAL_HZ_MIN} to ${CAL_HZ_MAX} Hz`;
      calHz.setAttribute('aria-invalid', 'true');
      return null;
    }
    calErr.textContent = '';
    calHz.removeAttribute('aria-invalid');
    return v;
  }
  calHz.addEventListener('change', validateCal);
  calHz.addEventListener('blur', () => { if (calHz.hasAttribute('aria-invalid')) validateCal(); });
  calHz.addEventListener('keydown', (e) => { if (e.key === 'Enter') validateCal(); });

  blocks.calibration.run.addEventListener('click', () => {
    const b = blocks.calibration;
    const refHz = validateCal();
    if (refHz === null) { calHz.focus(); return; }
    begin(b, async (signal, gone) => {
      // The live region says it once; the countdown goes to the non-live line.
      b.progress.textContent = `Measuring for ${CAL_MS / 1000} s.`;
      b.detail.textContent = 'Starting the microphone…';
      const o = await runCalibration({ live, signal, refHz, onProgress: (n) => { if (!gone()) b.detail.textContent = `Measuring, ${n} s left`; } });
      if (gone()) return;
      const r = settle(b, o);
      if (r) showCalibration(b, r);
    });
  });

  function showCalibration(b: Block, r: CalibrationResult) {
    const off = signedFixed(r.offsetCents, 2);
    setStatus(b, 'Done');
    b.detail.textContent = '';
    b.progress.textContent = `Done. Offset ${off} cents from ${r.refHz} Hz.`;
    b.results.replaceChildren(
      kvList([
        ['Reference', `${r.refHz} Hz`],
        ['Median measured', `${fx(r.medianHz, 3)} Hz`, `${r.count} voiced frames`],
        ['Offset', `${off} cents`],
        ['Frame spread P95', `${fx(r.p95Cents, 2)} cents`],
        ['Sample rate', `${r.sampleRate} Hz`],
      ]),
      h('p', 'm-nothreshold', NO_THRESHOLD),
    );
    field(b, 'info', `Offset ${off} cents at ${r.refHz} Hz. ${NO_THRESHOLD}`);
  }

  // ------------------------------------------------ loopback
  blocks.latency.run.addEventListener('click', () => {
    const b = blocks.latency;
    begin(b, async (signal, gone) => {
      b.progress.textContent = `Playing ${LOOP_TONES} test tones.`;
      b.detail.textContent = 'Starting the microphone…';
      const o = await runLoopback({ live, signal, onProgress: (i, n) => { if (!gone()) b.detail.textContent = `Tone ${i} of ${n}`; } });
      if (gone()) return;
      const r = settle(b, o);
      if (r) showLoopback(b, r);
    });
  });

  function showLoopback(b: Block, r: LoopbackResult) {
    const ms = (s: number | undefined) => (s === undefined ? 'not reported by this browser' : `${fx(s * 1000, 1)} ms`);
    setStatus(b, 'Done');
    b.detail.textContent = '';
    b.progress.textContent = `Done. Median ${fx(r.medianMs, 1)} ms over ${r.detected} of ${r.of} tones.`;
    b.results.replaceChildren(
      kvList([
        ['Tones detected', `${r.detected} of ${r.of}`],
        ['Median', `${fx(r.medianMs, 1)} ms`],
        ['Range', `${fx(r.minMs, 1)} to ${fx(r.maxMs, 1)} ms`],
        ['Context', `${r.sampleRate} Hz, base latency ${ms(r.baseLatency)}, output latency ${ms(r.outputLatency)}`],
      ]),
      h('p', 'm-nothreshold', NO_THRESHOLD),
    );
    field(b, 'info', `Median ${fx(r.medianMs, 1)} ms, ${r.detected} of ${r.of} tones. ${NO_THRESHOLD}`);
  }

  // ------------------------------------------------ self-test
  blocks.selftest.run.addEventListener('click', () => {
    const b = blocks.selftest;
    begin(b, async (signal, gone) => {
      const th = THRESHOLDS;
      if (!th) { showError(b, 'Could not run: criteria not found in results/summary.json', ''); return; }
      b.progress.textContent = 'Running the self-test.';
      b.detail.textContent = 'Loading the test files…';
      const off = await import('../../audio/offline.ts');
      if (gone()) return;
      let lastLabel = '';
      const o: Outcome<SelfTestResult> = await runSelfTest({
        signal, thresholds: th, loadManifest: () => off.loadManifest(signal), render: (e) => off.renderFixture(e, signal), userAgent: navigator.userAgent,
        onProgress: (i, n, label) => {
          if (gone()) return;
          b.detail.textContent = `File ${i} of ${n}: ${label}`;
          // Announced only when the set changes (4 times), not per file.
          if (label !== lastLabel) { lastLabel = label; b.progress.textContent = `Running: ${label}.`; }
        },
      });
      if (gone()) return;
      if (o.kind === 'error' && o.reason === 'fixtures') {
        showError(b, 'Test files not found at /fixtures/synthetic/. Start the dev server (npx vite) and generate them with py/synth.py.', o.detail);
        return;
      }
      const r = settle(b, o);
      if (!r) return;
      // A completed run only: a cancelled one never gets here, so the last complete report stays.
      (window as unknown as { __selfTest: unknown }).__selfTest = r.report;
      showSelfTest(b, r, th);
    });
  });

  function showSelfTest(b: Block, r: SelfTestResult, th: Thresholds) {
    const rep = r.report;
    const verdicts: Verdict[] = [r.verdicts.tone_sine_48k, r.verdicts.tone_sine_44k, r.verdicts.vibrato];
    const met = verdicts.filter((v) => v === 'pass').length;
    const all = met === verdicts.length;

    const tone = (t: ToneSetReport) => {
      const med = fx(t.median, 3), p95 = fx(t.p95, 3);
      return med === null || p95 === null
        ? `No voiced frames in ${t.frames} frames`
        : `median ${med} c, P95 ${p95} c, ${t.octave} octave ${t.octave === 1 ? 'error' : 'errors'} in ${t.voiced} voiced frames`;
    };
    const toneCrit = `median at most ${th.tone_median} c, P95 at most ${th.tone_p95} c, octave errors at most ${th.tone_octave}`;
    const v = rep.vibrato;
    const lat = fx(rep.algorithmicLatencyMs, 1);
    const rows: [set: string, result: string, criterion: string, verdict: Verdict | null][] = [
      [SET_LABEL.tone_sine_48k, tone(rep.tone_sine_48k), toneCrit, r.verdicts.tone_sine_48k],
      [SET_LABEL.tone_sine_44k, tone(rep.tone_sine_44k), toneCrit, r.verdicts.tone_sine_44k],
      [SET_LABEL.vib_sine_48k,
        `${v.cases - v.failing} of ${v.cases} cases read correctly. Worst rate error ${fx(v.worstRateErrHz, 3)} Hz, worst extent error ${pctText(v.worstExtentRelErr)}`,
        `every case: rate within ${th.vib_rate} Hz, extent within ${pctText(th.vib_extent_rel)}`, r.verdicts.vibrato],
      [SET_LABEL.latency,
        lat === null ? `No frame within ${SELF_LAT_MATCH_CENTS} cents after the onset` : `${lat} ms from the onset to the first frame within ${SELF_LAT_MATCH_CENTS} cents`,
        'No threshold', null],
    ];

    const head = h('thead', null, h('tr', null, ...['Test', 'Result', 'Criterion', 'Verdict'].map((t) => { const cell = h('th', null, t); cell.scope = 'col'; return cell; })));
    const body = h('tbody', null);
    for (const [set, result, crit, verdict] of rows) {
      const name = h('th', null, set);
      name.scope = 'row';
      const vd = h('span', 'm-verdict', verdict === 'pass' ? 'Pass' : verdict === 'fail' ? 'Fail' : 'No threshold');
      if (verdict) vd.dataset.verdict = verdict;
      body.append(h('tr', null,
        name,
        h('td', null, h('span', 'ck', 'Result'), result),
        h('td', null, h('span', 'ck', 'Criterion'), crit),
        h('td', null, h('span', 'ck', 'Verdict'), vd)));
    }
    const table = h('table', 'm-table', h('caption', 'visually-hidden', 'Self-test results'), head, body);

    setStatus(b, all ? 'Done' : 'Done with a warning');
    b.detail.textContent = '';
    b.progress.textContent = `Done. ${met} of ${verdicts.length} criteria met.`;
    b.results.replaceChildren(h('div', 'm-table-wrap', table));
    field(b, all ? 'ok' : 'error', all ? `Pass: ${met} of ${verdicts.length} criteria met` : `Fail: ${verdicts.length - met} of ${verdicts.length} criteria not met`);
  }

  // ------------------------------------------------ initial state
  if (insecure()) for (const b of [blocks.calibration, blocks.latency]) setStatus(b, 'Needs microphone');
  syncButtons();

  const targets: Record<string, Block> = { calibration: blocks.calibration, latency: blocks.latency, 'self-test': blocks.selftest };

  return {
    title: 'Methods',
    nav: 'methods',
    // Deep links: the router scrolls to and focuses the block heading (6.8). Nothing here touches a running check.
    focusTarget: (sub) => (Object.prototype.hasOwnProperty.call(targets, sub) ? targets[sub].title : null),
    // 6.5: abort the running check, await its settle, then stop the mic if a check still owns it.
    async leave() {
      const r = running;
      if (r) {
        r.stopping = true;
        syncButtons();
        r.ctrl.abort();
        // A render that never settles must not freeze navigation: wait up to the cap, then abandon the run.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const capped = new Promise<'late'>((res) => { timer = setTimeout(() => res('late'), LEAVE_CAP_MS); });
        const outcome = await Promise.race([r.done.then(() => 'settled' as const), capped]);
        clearTimeout(timer);
        if (outcome === 'late' && !r.abandoned) {
          r.abandoned = true;
          if (running === r) running = null;
          const b = Object.values(blocks).find((x) => x.kind === r.kind);
          if (b) showCancelled(b);
          syncButtons();
        }
      }
      const s = live.snapshot();
      if (s.owner === 'calibration' || s.owner === 'latency') {
        await live.stop();
        live.reset();
      }
    },
  };
}
