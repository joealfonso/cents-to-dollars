// M1 test page wiring: live pitch readout, spectrogram, setup checks, hover explanations.

import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource/geist/latin-400.css';
import '@fontsource/geist/latin-500.css';
import '@fontsource/geist/latin-600.css';
import '@fontsource/geist-mono/latin-400.css';
import '@fontsource/geist-mono/latin-500.css';

import { startLive, loadTracker, makeTrackerNode, type LiveSession } from '../audio/capture.ts';
import type { WorkletFrame } from '../audio/tracker.worklet.ts';
import { nearestNote, centsBetween, DEFAULT_A4 } from '../dsp/pitch.ts';
import { analyzeVibrato, type ContourFrame } from '../dsp/vibrato.ts';
import { SF_BAND } from '../dsp/spectrum.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fx = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
const signed = (x: number, d = 1) => (Number.isFinite(x) ? `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(d)}` : 'n/a');

// A4 input: 400 to 480 Hz. An invalid entry keeps the last valid value (fixes `Number(v) || 440`, which accepted 4 Hz).
let a4Valid = DEFAULT_A4;
function a4() { return a4Valid; }
const a4Ok = (el: HTMLInputElement) => el.value.trim() !== '' && Number(el.value) >= 400 && Number(el.value) <= 480;
{
  const el = $<HTMLInputElement>('a4');
  const err = $('a4-error');
  if (a4Ok(el)) a4Valid = Number(el.value); // browsers can restore a typed value on reload without firing change
  // While typing: use the value as soon as it is valid, so readings never lag the field.
  el.addEventListener('input', () => { if (a4Ok(el)) { a4Valid = Number(el.value); if (err.textContent) err.textContent = ''; } });
  el.addEventListener('change', () => {
    if (a4Ok(el)) { a4Valid = Number(el.value); err.textContent = ''; return; }
    el.value = String(a4Valid); // the field holds a valid value again; the message says what happened
    err.textContent = `Enter 400 to 480 Hz. Kept ${a4Valid} Hz.`;
  });
}

// Discrete-run status for CSS. Never called for #live-readout.
function setState(el: HTMLElement, state: 'working' | 'done' | 'error') {
  if (el.dataset.state === state) { delete el.dataset.state; void el.offsetWidth; } // force reflow so a repeated state replays its animation
  el.dataset.state = state;
}
// One polite region for the setup checks: says "running" once and the result once, not every progress tick.
function announce(text: string) { const el = $('check-announce'); el.textContent = ''; window.setTimeout(() => { el.textContent = text; }, 50); }

// Result block: one plain sentence, optional label/value rows, optional raw numbers behind a disclosure.
type Row = [label: string, value: string, note?: string];
function showResult(el: HTMLElement, summary: string, rows: Row[] = [], raw?: string) {
  const nodes: Node[] = [];
  const p = document.createElement('p');
  p.className = 'r-summary';
  p.textContent = summary;
  nodes.push(p);
  announce(summary);
  let i = 1;
  if (rows.length) {
    const dl = document.createElement('dl');
    dl.className = 'r-rows';
    for (const [label, value, note] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      dt.style.setProperty('--i', String(i++));
      const dd = document.createElement('dd');
      dd.textContent = value;
      dd.style.setProperty('--i', String(i));
      if (note) { const s = document.createElement('small'); s.textContent = note; dd.append(s); }
      dl.append(dt, dd);
    }
    nodes.push(dl);
  }
  if (raw) {
    const d = document.createElement('details');
    d.className = 'r-raw';
    d.style.setProperty('--i', String(i + 1));
    const s = document.createElement('summary');
    s.textContent = 'Show raw numbers';
    const pre = document.createElement('pre');
    pre.textContent = raw;
    d.append(s, pre);
    nodes.push(d);
  }
  el.replaceChildren(...nodes);
}

// ---------------------------------------------------------------- live
let live: LiveSession | null = null;
// One entry per frame, plain YIN F0 (0 when unvoiced).
type HistoryEntry = ContourFrame & { voiced: boolean; eSf: number; eRef: number };
const history: HistoryEntry[] = [];
const canvas = $<HTMLCanvasElement>('spectrogram');
const g = canvas.getContext('2d')!;
const SPEC_TOP_HZ = 4000;
const VIB_WINDOW_S = 2.5;
let pending: WorkletFrame[] = []; // spectrogram columns not yet drawn

// Spectrogram colours come from tokens, not hard-coded values.
function toRgb(c: string): [number, number, number] {
  g.fillStyle = '#000';
  g.fillStyle = c;
  const s = String(g.fillStyle);
  if (s[0] === '#') return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  const m = s.match(/[\d.]+/g);
  return m ? [Number(m[0]), Number(m[1]), Number(m[2])] : [0, 0, 0];
}
function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
  const surface = v('--surface-plot', '#FBFAF6');
  const a = toRgb(surface), b = toRgb(v('--plot-energy', '#141413'));
  const ramp = Array.from({ length: 256 }, (_, i) => {
    const t = i / 255;
    return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
  });
  return { surface, ramp, f0: v('--signal', '#E4401B'), band: v('--plot-band', 'rgba(228,64,27,0.35)') };
}
let pal = readPalette();

function drawColumns() {
  if (!live) return;
  const fs = live.ctx.sampleRate;
  const W = canvas.width, H = canvas.height;
  let cols = pending.splice(0);
  if (cols.length > W) cols = cols.slice(-W); // keep only what fits; getImageData width must stay > 0
  if (cols.length && cols.length < W) {
    const img = g.getImageData(cols.length, 0, W - cols.length, H);
    g.putImageData(img, 0, 0);
  }
  cols.forEach((f, i) => {
    const x = W - cols.length + i;
    g.fillStyle = pal.surface;
    g.fillRect(x, 0, 1, H);
    if (f.power) {
      for (let y = 0; y < H; y++) {
        const hz = ((H - 1 - y) / (H - 1)) * SPEC_TOP_HZ;
        const k = Math.round((hz * 2048) / fs);
        const p = f.power[k] ?? 0;
        const db = 10 * Math.log10(p + 1e-12);
        const v = Math.max(0, Math.min(1, (db + 20) / 80)); // -20..60 dB relative to raw FFT power
        if (v > 0) { g.fillStyle = pal.ramp[Math.round(v * 255)]; g.fillRect(x, y, 1, 1); }
      }
    }
    // singer's formant band guide lines
    g.fillStyle = pal.band;
    for (const hz of SF_BAND) g.fillRect(x, Math.round(H - 1 - (hz / SPEC_TOP_HZ) * (H - 1)), 1, 1);
    // F0 mark, with a halo in the plot colour so it reads on mid-grey energy
    if (f.voiced) {
      const y = Math.round(H - 1 - (f.f0 / SPEC_TOP_HZ) * (H - 1));
      g.fillStyle = pal.surface;
      g.fillRect(x, y - 3, 2, 7);
      g.fillStyle = pal.f0;
      g.fillRect(x, y - 2, 2, 5);
    }
  });
}

function clearCanvas() {
  pal = readPalette();
  g.fillStyle = pal.surface;
  g.fillRect(0, 0, canvas.width, canvas.height);
}

// Update helpers: write only when the text changes, so nothing reflows every frame for no reason.
function setText(el: HTMLElement, text: string) { if (el.textContent !== text) el.textContent = text; }
function setStat(id: string, value: string | null, unit: string, empty: string) {
  const el = $(id);
  const key = value === null ? `e:${empty}` : `${value}|${unit}`;
  if (el.dataset.key === key) return;
  if (value !== null && el.hasAttribute('data-empty')) replay(el, 'arrive');
  el.dataset.key = key;
  el.toggleAttribute('data-empty', value === null);
  if (value === null) { el.textContent = empty; return; }
  const s = document.createElement('small');
  s.textContent = unit;
  el.replaceChildren(document.createTextNode(value), s);
}

const NOTE_WORDS: Record<string, string> = { '#': ' sharp' };
let lastNote: { name: string; cents: number; f0: number; target: number } | null = null;

function renderNote(name: string | null, stale: boolean) {
  const el = $('note-name');
  const key = `${name}|${stale}`;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.toggleAttribute('data-stale', stale);
  if (!name) { el.setAttribute('data-empty', ''); el.removeAttribute('data-arrive'); el.textContent = 'No pitch yet'; return; }
  if (el.hasAttribute('data-empty')) replay(el, 'arrive'); // empty to first note only; later note changes are instant
  el.removeAttribute('data-empty');
  const m = name.match(/^([A-G])(#?)(-?\d+)$/);
  if (!m) { el.textContent = name; return; }
  const glyph = document.createElement('span');
  glyph.setAttribute('aria-hidden', 'true');
  const oct = document.createElement('span');
  oct.className = 'oct';
  oct.textContent = m[3];
  glyph.append(document.createTextNode(m[1] + (m[2] ? '\u266F' : '')), oct);
  const spoken = document.createElement('span');
  spoken.className = 'visually-hidden';
  spoken.textContent = `${m[1]}${NOTE_WORDS[m[2]] ?? ''} ${m[3]}${stale ? ', last heard' : ''}`;
  el.replaceChildren(glyph, spoken);
}
// Restart a one-shot CSS animation keyed by a data attribute.
function replay(el: HTMLElement, attr: string) { el.removeAttribute(`data-${attr}`); void el.offsetWidth; el.setAttribute(`data-${attr}`, ''); }
// Swap a word with a rise-in. Labels and status words only, never live numbers.
function swapText(el: HTMLElement, text: string) {
  if (el.textContent === text) return;
  el.textContent = text;
  el.dataset.swap = el.dataset.swap === 'a' ? 'b' : 'a';
}

function renderOffset(cents: number | null, stale: boolean) {
  const el = $('note-offset');
  const r = cents === null ? null : Math.round(cents);
  const key = `${r}|${stale}`;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  if (r === null) { el.removeAttribute('data-dir'); el.textContent = ''; return; }
  if (!el.textContent) replay(el, 'arrive');
  if (r === 0) { el.dataset.dir = 'on'; el.textContent = 'On the note (0 cents)'; return; }
  const dir = r < 0 ? 'flat' : 'sharp';
  el.dataset.dir = stale ? 'stale' : dir;
  const n = document.createElement('span');
  n.className = 'num';
  n.textContent = `${Math.abs(r)} ${Math.abs(r) === 1 ? 'cent' : 'cents'} `;
  const d = document.createElement('span');
  d.className = 'dir';
  d.textContent = dir;
  el.replaceChildren(n, d);
}

function renderMeter(cents: number | null, stale: boolean) {
  const marker = $('cents-marker');
  const meter = $('cents-meter');
  meter.toggleAttribute('data-stale', stale);
  if (cents === null) {
    marker.hidden = true;
    setLabel('Flat to sharp meter. No pitch yet.');
    return;
  }
  marker.hidden = false;
  const c = Math.max(-50, Math.min(50, cents));
  const left = `${50 + c}%`;
  if (marker.style.left !== left) marker.style.left = left;
  const r = Math.round(cents);
  setLabel(`Flat to sharp meter. ${r === 0 ? 'On the note' : `${Math.abs(r)} cents ${r < 0 ? 'flat' : 'sharp'}`}.`);
  function setLabel(t: string) { const tr = $('cents-meter-track'); if (tr.getAttribute('aria-label') !== t) tr.setAttribute('aria-label', t); }
}

function renderReadout() {
  const newest = history[history.length - 1];
  if (!newest) return;
  const voiced = newest.f0 > 0;
  if (voiced) {
    const n = nearestNote(newest.f0, a4());
    lastNote = { name: n.name, cents: n.cents, f0: newest.f0, target: n.targetHz };
  }
  const stale = !voiced;
  renderNote(lastNote?.name ?? null, stale && !!lastNote);
  renderOffset(lastNote ? lastNote.cents : null, stale);
  renderMeter(lastNote ? lastNote.cents : null, stale);
  if (voiced && lastNote) speakNote(lastNote.name, lastNote.cents);
  setText($('note-hint'), !lastNote
    ? 'Listening. Sing a steady note.'
    : stale
      ? 'Last note heard. Sing again to update.'
      : `${lastNote.name.replace('#', '\u266F')} is ${fx(lastNote.target, 1)} Hz at A4 = ${a4()} Hz.`);

  setStat('stat-pitch', voiced ? fx(newest.f0, 1) : null, 'Hz', 'No pitch right now');
  const recent = history.filter((h) => h.t > newest.t - VIB_WINDOW_S);
  const v = analyzeVibrato(recent);
  setStat('stat-vib-speed', v ? fx(v.rateHz, 1) : null, 'times per second', `None measured in the last ${VIB_WINDOW_S} s`);
  setStat('stat-vib-width', v ? `±${fx(v.extentCents, 0)}` : null, 'cents up and down', `None measured in the last ${VIB_WINDOW_S} s`);
  let eSf = 0, eRef = 0;
  for (const h of recent) if (h.voiced) { eSf += h.eSf; eRef += h.eRef; }
  const ring = eSf > 0 && eRef > 0 ? 10 * Math.log10(eSf / eRef) : NaN;
  setStat('stat-ring', Number.isFinite(ring) ? signed(ring, 1) : null, 'dB, last 2.5 s', `No singing in the last ${VIB_WINDOW_S} s`);

  // Technical details: the full measurement, in its own vocabulary.
  const lines: string[] = [];
  if (voiced) {
    const n = nearestNote(newest.f0, a4());
    lines.push(`F0        ${fx(newest.f0, 2)} Hz`);
    lines.push(`Note      ${n.name}  ${n.cents >= 0 ? '+' : ''}${fx(n.cents, 1)} cents from ${fx(n.targetHz, 2)} Hz (A4 = ${a4()} Hz)`);
  } else {
    lines.push('F0        unvoiced');
  }
  lines.push(v ? `Vibrato   rate ${fx(v.rateHz, 2)} Hz, extent ±${fx(v.extentCents, 1)} cents (last ${VIB_WINDOW_S} s)` : `Vibrato   not detected in last ${VIB_WINDOW_S} s`);
  lines.push(Number.isFinite(ring) ? `Band      2.5 to 3.5 kHz vs 0.05 to 2 kHz: ${fx(ring, 1)} dB (last ${VIB_WINDOW_S} s, voiced frames)` : 'Band      no voiced frames');
  lines.push(`Input     ${live?.stream.getAudioTracks()[0]?.label || 'unknown'} at ${live?.ctx.sampleRate} Hz, base latency ${fx((live?.ctx.baseLatency ?? NaN) * 1000, 1)} ms`);
  setText($('live-readout'), lines.join('\n'));
}

// Screen readers: note and direction, at most once every 1.5 s and only when the note or direction changes.
let spokenKey = '', spokenAt = 0;
function speakNote(name: string, cents: number) {
  const r = Math.round(cents);
  const key = `${name}|${Math.sign(r)}`;
  const now = performance.now();
  if (key === spokenKey || now - spokenAt < 1500) return;
  spokenKey = key; spokenAt = now;
  const dir = r === 0 ? 'on the note' : `${Math.abs(r)} cents ${r < 0 ? 'flat' : 'sharp'}`;
  $('readout-announce').textContent = `${name.replace('#', ' sharp ')}, ${dir}`;
}

let rafId = 0;
const frameWaiters: ((f: WorkletFrame, drawnAt: number) => void)[] = [];
let undrawn: WorkletFrame[] = [];
function loop(ts: number) {
  rafId = requestAnimationFrame(loop); // re-arm first so a throw below cannot freeze the display
  try {
    drawColumns();
    renderReadout();
    const frames = undrawn.splice(0);
    for (const w of frameWaiters) for (const f of frames) w(f, ts);
  } catch (e) {
    console.error('loop error', e);
  }
}

type ToggleState = 'idle' | 'busy' | 'live' | 'stopping';
function setLiveUi(on: boolean, label: string, toggle: ToggleState = on ? 'live' : 'idle') {
  swapText($('mic-pill-text'), on ? 'Listening' : 'Not listening');
  swapText($('live-state-label'), label);
  const t = $<HTMLButtonElement>('live-toggle');
  t.dataset.state = toggle;
  t.disabled = toggle === 'busy' || toggle === 'stopping';
}

let starting: Promise<LiveSession> | null = null;
async function ensureLive() {
  if (live) return live;
  if (starting) return starting; // a second click while the permission prompt is open starts nothing new
  const toggleHadFocus = document.activeElement === $('live-toggle');
  starting = (async () => {
    history.length = 0;
    pending = []; undrawn = [];
    lastNote = null;
    setLiveUi(false, 'Waiting for permission', 'busy');
    const session = await startLive({
      onFrame: (m) => {
        history.push({ t: m.t, f0: m.voiced ? m.f0 : 0, voiced: m.voiced, eSf: m.eSf, eRef: m.eRef });
        if (history.length > 4000) history.splice(0, history.length - 4000);
        // Cap the queues: rAF stops while the tab is hidden but the worklet keeps posting.
        pending.push(m);
        if (pending.length > canvas.width) pending.splice(0, pending.length - canvas.width);
        undrawn.push(m);
        if (undrawn.length > canvas.width) undrawn.splice(0, undrawn.length - canvas.width);
      },
    });
    live = session;
    clearCanvas();
    $('spec-wrap').dataset.drawn = '';
    renderNote(null, false);
    renderOffset(null, false);
    renderMeter(null, false);
    setText($('note-hint'), 'Listening. Sing a steady note.');
    document.documentElement.dataset.live = 'on';
    $('live-status').textContent = 'Listening.';
    setLiveUi(true, 'Listening');
    if (toggleHadFocus) $('live-toggle').focus(); // the button is disabled while busy, which can drop focus
    rafId = requestAnimationFrame(loop);
    return session;
  })();
  try { return await starting; }
  catch (e) {
    // Whoever started it (the toggle or a setup check), the header and toggle end in a truthful state.
    const msg = micErrorText(e);
    setLiveUi(false, 'Could not start');
    setText($('note-hint'), msg);
    $('live-status').textContent = msg;
    $('live-readout').textContent = `Could not start: ${e}`;
    if (toggleHadFocus) $('live-toggle').focus();
    throw e;
  }
  finally { starting = null; }
}

export async function stopLive() {
  // A start still waiting on the permission prompt would open the mic after we leave: wait for it, then stop.
  // If the start failed, ensureLive has already reset the UI; never throw from the router leave hook.
  if (starting) { try { await starting; } catch { return; } }
  if (!live) return;
  const s = live;
  const hadFocus = document.activeElement === $('live-toggle');
  setLiveUi(true, 'Stopping', 'stopping');
  try { await s.stop(); }
  catch (e) {
    console.error('stop failed', e);
    s.stream.getTracks().forEach((t) => t.stop()); // release the mic even if closing the context failed
  }
  cancelAnimationFrame(rafId);
  drawColumns();
  renderReadout();
  live = null;
  document.documentElement.dataset.live = 'off';
  $('live-status').textContent = 'Stopped listening.';
  setLiveUi(false, 'Stopped');
  if (hadFocus) $('live-toggle').focus();
  if (lastNote) {
    // The last reading stays visible but muted, so it is not mistaken for a live one.
    renderNote(lastNote.name, true);
    renderOffset(lastNote.cents, true);
    renderMeter(lastNote.cents, true);
    setText($('note-hint'), 'Stopped. Press Start to listen again.');
  }
}

function micErrorText(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError') return 'Listening is blocked for this page. In your browser’s site settings, allow Microphone for this site, then press Start again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'This laptop or phone has no microphone the browser can use. Check your sound settings, then press Start again.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'Another app is using the sound input. Close it, then press Start again.';
  if (!window.isSecureContext) return 'The microphone only works on a secure page. Open http://127.0.0.1:5173.';
  return 'The app could not start listening.';
}

$('live-toggle').addEventListener('click', () => {
  if (live) { void stopLive(); return; }
  ensureLive().catch(() => { /* ensureLive already reported it */ });
});

// While a mic check runs, opening or closing the setup panel would shift the live panel mid-measurement.
function lockSetup(on: boolean) {
  for (const b of document.querySelectorAll<HTMLButtonElement>('#setup-toggle, .setup-close')) b.disabled = on;
}

// ---------------------------------------------------------------- calibration (mic accuracy)
$('cal-run').addEventListener('click', async () => {
  lockSetup(true);
  const input = $<HTMLInputElement>('cal-hz');
  const ref = Number(input.value);
  const out = $('cal-readout');
  if (!(input.value.trim() !== '' && ref >= 60 && ref <= 2000)) {
    input.setAttribute('aria-invalid', 'true');
    showResult(out, 'Enter a test tone between 60 and 2000 Hz.');
    setState(out, 'error');
    lockSetup(false);
    return;
  }
  input.removeAttribute('aria-invalid');
  try {
    const s = await ensureLive();
    out.textContent = 'Listening to the test tone for 5 seconds…';
    announce('Pitch accuracy check running for 5 seconds.');
    setState(out, 'working');
    const t0 = s.ctx.currentTime;
    await new Promise((r) => setTimeout(r, 5000));
    const f = history.filter((h) => h.f0 > 0 && h.t >= t0).map((h) => h.f0).sort((a, b) => a - b);
    if (f.length < 50) {
      showResult(out, `Couldn’t hear the test tone clearly (${f.length} of 50 readings needed). Check that it is playing and loud enough.`);
      setState(out, 'error');
      return;
    }
    const med = f[f.length >> 1];
    const c = f.map((x) => centsBetween(x, med)).map(Math.abs).sort((a, b) => a - b);
    const off = centsBetween(med, ref);
    const p95 = c[Math.floor(0.95 * c.length)];
    const summary = Math.abs(off) < 0.005
      ? 'Your setup reads the test tone exactly (0.00 cents).'
      : `Your setup reads ${fx(Math.abs(off), 2)} cents ${off < 0 ? 'flat' : 'sharp'} of the test tone.`;
    showResult(out, summary, [
      ['Test tone', `${ref} Hz`],
      ['App heard', `${fx(med, 3)} Hz`, `median of ${f.length} readings`],
      ['Difference', `${signed(off, 2)} cents`],
      ['Steadiness', `${fx(p95, 2)} cents`, '95% of readings were this close to the median'],
      ['Sample rate', `${s.ctx.sampleRate} Hz`],
    ], [
      `Reference         ${ref} Hz`,
      `Median measured   ${fx(med, 3)} Hz over ${f.length} frames`,
      `Offset            ${fx(off, 2)} cents`,
      `Frame spread      P95 |dev from median| ${fx(p95, 2)} cents`,
      `Context rate      ${s.ctx.sampleRate} Hz`,
    ].join('\n'));
    setState(out, 'done');
  } catch (e) { showResult(out, `Could not run: ${micErrorText(e)}`, [], String(e)); setState(out, 'error'); }
  finally { lockSetup(false); }
});

// ---------------------------------------------------------------- loopback latency (screen delay)
$('loop-run').addEventListener('click', async () => {
  lockSetup(true);
  const out = $('loop-readout');
  try {
    const s = await ensureLive();
    const results: number[] = [];
    for (let i = 0; i < 10; i++) {
      out.textContent = `Beep ${i + 1} of 10…`;
      if (i === 0) { setState(out, 'working'); announce('Screen delay check running.'); }
      const T = s.ctx.currentTime + 0.3;
      const osc = s.ctx.createOscillator();
      const amp = s.ctx.createGain();
      osc.frequency.value = 440;
      amp.gain.value = 0.3;
      osc.connect(amp).connect(s.ctx.destination);
      osc.start(T);
      osc.stop(T + 0.4);
      const ts = s.ctx.getOutputTimestamp();
      // performance-clock time at which sample T reaches the output device
      const outPerf = (ts.performanceTime ?? 0) + (T - (ts.contextTime ?? 0)) * 1000;
      const drawn = await new Promise<number | null>((resolve) => {
        const timer = setTimeout(() => { frameWaiters.splice(frameWaiters.indexOf(w), 1); resolve(null); }, 1500);
        const w = (f: WorkletFrame, drawnAt: number) => {
          if (f.voiced && Math.abs(centsBetween(f.f0, 440)) < 50 && f.readyAt / s.ctx.sampleRate > T) {
            clearTimeout(timer); frameWaiters.splice(frameWaiters.indexOf(w), 1); resolve(drawnAt);
          }
        };
        frameWaiters.push(w);
      });
      if (drawn !== null) results.push(drawn - outPerf);
      await new Promise((r) => setTimeout(r, 600));
    }
    if (!results.length) { showResult(out, 'No beep was heard. Turn the speaker volume up a little and try again.'); setState(out, 'error'); return; }
    results.sort((a, b) => a - b);
    const med = results[results.length >> 1];
    showResult(out, `Typical delay: ${fx(med, 0)} ms from the speaker to the pitch being drawn.`, [
      ['Beeps heard', `${results.length} of 10`],
      ['Median', `${fx(med, 1)} ms`],
      ['Fastest to slowest', `${fx(results[0], 1)} to ${fx(results[results.length - 1], 1)} ms`],
      ['Audio system', `${fx(s.ctx.baseLatency * 1000, 1)} ms in, ${fx(s.ctx.outputLatency * 1000, 1)} ms out`, 'as reported by the browser'],
    ], [
      `Bursts detected   ${results.length} of 10`,
      `Median            ${fx(med, 1)} ms`,
      `Range             ${fx(results[0], 1)} to ${fx(results[results.length - 1], 1)} ms`,
      `Context           ${s.ctx.sampleRate} Hz, base latency ${fx(s.ctx.baseLatency * 1000, 1)} ms, output latency ${fx(s.ctx.outputLatency * 1000, 1)} ms`,
    ].join('\n'));
    setState(out, 'done');
  } catch (e) { showResult(out, `Could not run: ${micErrorText(e)}`, [], String(e)); setState(out, 'error'); }
  finally { lockSetup(false); }
});

// ---------------------------------------------------------------- offline self-test (built-in accuracy test)
interface Entry { id: string; set: string; file: string; sr: number; dur: number; f0: number; rate: number; extent: number; onset_sample?: number }

const SET_LABEL: Record<string, string> = {
  tone_sine_48k: 'Steady tones, 48 kHz',
  tone_sine_44k: 'Steady tones, 44.1 kHz',
  vib_sine_48k: 'Tones with vibrato',
  latency: 'Reaction time',
};

function truthAt(e: Entry, t: number) {
  return e.extent === 0 ? e.f0 : e.f0 * Math.pow(2, (e.extent / 1200) * Math.sin(2 * Math.PI * e.rate * t));
}

async function renderFixture(e: Entry): Promise<WorkletFrame[]> {
  const buf = await (await fetch(`/fixtures/synthetic/${e.file}`)).arrayBuffer();
  const len = Math.round(e.dur * e.sr);
  const ctx = new OfflineAudioContext(1, len, e.sr);
  await loadTracker(ctx);
  const audio = await ctx.decodeAudioData(buf);
  const frames: WorkletFrame[] = [];
  const node = makeTrackerNode(ctx, { onFrame: (f) => frames.push(f) });
  node.port.postMessage({ type: 'spectrum', enabled: false });
  const src = ctx.createBufferSource();
  src.buffer = audio;
  src.connect(node).connect(ctx.destination);
  src.start();
  await ctx.startRendering();
  // Counts 'frame' messages. The worklet runs in 128-sample blocks and emits a frame once 2048 samples
  // are in and 256 have passed since the last, so with len a multiple of 128 there are exactly
  // floor((len - 2048) / 256) + 1 frames (same as FrameAnalyzer.run).
  const expected = Math.floor((len - 2048) / 256) + 1;
  const t0 = performance.now();
  while (frames.length < expected && performance.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 20));
  if (frames.length < expected) throw new Error(`${e.id}: got ${frames.length} of ${expected} frames before timeout`);
  return frames.sort((a, b) => a.start - b.start);
}

function pct(a: number[], q: number) { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; }

async function selfTest() {
  const out = $('self-readout');
  let started = false; // set busy after the first progress write so the start is announced
  const man = await (await fetch('/fixtures/synthetic/manifest.json')).json();
  const entries: Entry[] = man.entries;
  const report: Record<string, unknown> = {};
  const lines: string[] = [];
  const rows: Row[] = [];
  const toneMedians: string[] = [];
  let octaves = 0;
  for (const set of ['tone_sine_48k', 'tone_sine_44k']) {
    const errs: number[] = [];
    let frames = 0;
    const files = entries.filter((x) => x.set === set);
    for (const [i, e] of files.entries()) {
      out.textContent = `${SET_LABEL[set]}: file ${i + 1} of ${files.length}…`;
      if (!started) { started = true; setState(out, 'working'); announce('Built-in accuracy test running.'); }
      for (const f of await renderFixture(e)) {
        if (f.t < 0.07 || f.t > e.dur - 0.07) continue;
        frames++;
        if (f.voiced) errs.push(Math.abs(centsBetween(f.f0, truthAt(e, f.t))));
      }
    }
    const r = { frames, voiced: errs.length, median: pct(errs, 0.5), p95: pct(errs, 0.95), max: Math.max(...errs), octave: errs.filter((x) => x > 600).length };
    report[set] = r;
    toneMedians.push(fx(r.median, 3));
    octaves += r.octave;
    rows.push([SET_LABEL[set], `${fx(r.median, 3)} cents typical`, `worst 5%: ${fx(r.p95, 3)} cents, ${r.octave} octave mistakes in ${r.voiced} readings`]);
    lines.push(`${set.padEnd(16)} frames ${r.frames} voiced ${r.voiced} median ${fx(r.median, 3)} p95 ${fx(r.p95, 3)} max ${fx(r.max, 2)} octave ${r.octave}`);
  }
  const vib = entries.filter((x) => x.set === 'vib_sine_48k');
  let worstRate = 0, worstExt = 0, fails = 0;
  for (const [i, e] of vib.entries()) {
    out.textContent = `${SET_LABEL.vib_sine_48k}: file ${i + 1} of ${vib.length}…`;
    const fr = await renderFixture(e);
    const v = analyzeVibrato(fr.map((f) => ({ t: f.t, f0: f.voiced ? f.f0 : 0 })));
    if (!v) { fails++; continue; }
    const re = Math.abs(v.rateHz - e.rate), ee = Math.abs(v.extentCents - e.extent) / e.extent;
    worstRate = Math.max(worstRate, re); worstExt = Math.max(worstExt, ee);
    if (re > 0.3 || ee > 0.1) fails++;
  }
  report.vibrato = { cases: vib.length, worstRateErrHz: worstRate, worstExtentRelErr: worstExt, failing: fails };
  rows.push([SET_LABEL.vib_sine_48k, `${vib.length - fails} of ${vib.length} read correctly`, `speed within 0.3 Hz and width within 10%. Worst: ${fx(worstRate, 3)} Hz, ${fx(100 * worstExt, 2)}%`]);
  lines.push(`vib_sine_48k     cases ${vib.length} worst rate err ${fx(worstRate, 4)} Hz worst extent err ${fx(100 * worstExt, 2)}% failing ${fails}`);
  out.textContent = `${SET_LABEL.latency}…`;
  const lat = entries.find((x) => x.set === 'latency')!;
  const lf = await renderFixture(lat);
  const first = lf.find((f) => f.voiced && Math.abs(centsBetween(f.f0, 440)) <= 50 && f.readyAt > lat.onset_sample!);
  const latMs = first ? ((first.readyAt - lat.onset_sample!) / lat.sr) * 1000 : NaN;
  report.algorithmicLatencyMs = latMs;
  rows.push([SET_LABEL.latency, `${fx(latMs, 1)} ms`, 'from the start of a note to the first reading within 50 cents']);
  lines.push(`latency          onset to first frame within 50 cents: ${fx(latMs, 2)} ms (worklet, offline render, plain YIN)`);
  report.userAgent = navigator.userAgent;
  (window as unknown as { __selfTest: unknown }).__selfTest = report;
  showResult(out, `Done. Typical error on steady tones: ${toneMedians.join(' and ')} cents (48 and 44.1 kHz), with ${octaves} octave ${octaves === 1 ? 'mistake' : 'mistakes'}.`, rows, lines.join('\n'));
  setState(out, 'done');
}

$('self-run').addEventListener('click', () => selfTest().catch((e) => {
  showResult($('self-readout'), 'The test could not run. The test files are only available on the dev server (npx vite), generated with py/synth.py.', [], String(e));
  setState($('self-readout'), 'error');
}));

// ---------------------------------------------------------------- hover and tap explanations
// Shown on hover or keyboard focus, pinned by click or tap, dismissed with Escape (WCAG 1.4.13).
const tips: { wrap: HTMLElement; close: () => void; place: () => void }[] = [];
for (const wrap of document.querySelectorAll<HTMLElement>('.term-wrap')) {
  const btn = wrap.querySelector<HTMLButtonElement>('.term');
  const tip = wrap.querySelector<HTMLElement>('.tip');
  if (!btn || !tip) continue;
  let pinned = false;
  let hideTimer = 0;
  const place = () => {
    tip.style.setProperty('--tip-x', '0px');
    const r = tip.getBoundingClientRect();
    const gutter = 16;
    const vw = document.documentElement.clientWidth; // not innerWidth: an overflowing tip would inflate it
    let shift = 0;
    if (r.right > vw - gutter) shift = vw - gutter - r.right;
    if (r.left + shift < gutter) shift = gutter - r.left;
    tip.style.setProperty('--tip-x', `${Math.round(shift)}px`);
  };
  const show = () => { clearTimeout(hideTimer); if (!('open' in wrap.dataset)) { place(); wrap.dataset.open = ''; } };
  const close = () => { clearTimeout(hideTimer); pinned = false; delete wrap.dataset.open; };
  // Stays open while pinned, hovered or focused (WCAG 1.4.13: hoverable and persistent).
  const hideSoon = () => {
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      if (pinned || wrap.matches(':hover') || document.activeElement === btn) return;
      delete wrap.dataset.open;
    }, 300);
  };
  wrap.addEventListener('mouseenter', show);
  wrap.addEventListener('mouseleave', hideSoon);
  btn.addEventListener('focus', show);
  btn.addEventListener('blur', hideSoon); // clicking the tip text blurs the button; the hover check keeps it open
  btn.addEventListener('click', () => { pinned = !pinned; if (pinned) show(); else close(); });
  tips.push({ wrap, close, place });
}
// Place every tip once (and on resize) so hidden tips never extend past the viewport.
const placeAll = () => { for (const t of tips) t.place(); };
placeAll();
window.addEventListener('resize', placeAll);
void document.fonts?.ready.then(placeAll);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') for (const t of tips) t.close(); });
document.addEventListener('pointerdown', (e) => { for (const t of tips) if (!t.wrap.contains(e.target as Node)) t.close(); });

// ---------------------------------------------------------------- optional setup checks
// Disclosure opened from the intro button. Opening replays the .enter animations (display none -> block restarts them);
// closing fades out, then hides. Only transform and opacity animate (motion rule 4).
{
  const setup = $('setup');
  const toggle = $('setup-toggle') as HTMLButtonElement;
  const closeBtn = setup.querySelector<HTMLButtonElement>('.setup-close');
  // The toggle's name stays "Check your setup"; aria-expanded, the chevron and the fill carry the state.
  let gen = 0; // each call bumps this so a stale close can't hide or cut short a later open or close
  const setOpen = async (open: boolean) => {
    const my = ++gen;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      if ('closing' in setup.dataset) { delete setup.dataset.closing; setup.hidden = true; void setup.offsetWidth; } // re-hide and flush so .enter replays
      setup.hidden = false;
      placeAll();
      return;
    }
    if (setup.hidden) return;
    setup.dataset.closing = '';
    const anims = setup.getAnimations().filter((a) => (a as CSSAnimation).animationName === 'setup-out');
    // Fallback timer: a frozen timeline (background tab) must not leave the section stuck mid-fade.
    const done = Promise.all(anims.map((a) => a.finished.catch(() => undefined)));
    await Promise.race([done, new Promise((r) => setTimeout(r, 1000))]);
    if (my !== gen) return;
    setup.hidden = true;
    delete setup.dataset.closing;
  };
  toggle.addEventListener('click', () => void setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  closeBtn?.addEventListener('click', () => { void setOpen(false); toggle.focus(); });
}
