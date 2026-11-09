// Bare M1 test page wiring. No designed UI.

import { startLive, loadTracker, makeTrackerNode, type LiveSession } from '../audio/capture.ts';
import type { WorkletMeter, WorkletF0 } from '../audio/tracker.worklet.ts';
import { DEFAULT_CONTINUITY } from '../dsp/continuity.ts';
import { nearestNote, centsBetween } from '../dsp/pitch.ts';
import { analyzeVibrato, type ContourFrame } from '../dsp/vibrato.ts';
import { SF_BAND } from '../dsp/spectrum.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const a4 = () => Number($<HTMLInputElement>('a4').value) || 440;
const fx = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');

// ---------------------------------------------------------------- live
let live: LiveSession | null = null;
// One entry per frame, created from its 'meter' message (immediate). f0 is NaN until the frame's
// continuity-tracked F0 is final (its 'f0' message, up to DEFAULT_CONTINUITY.lag frames later).
type HistoryEntry = ContourFrame & { voiced: boolean; eSf: number; eRef: number };
const history: HistoryEntry[] = [];
const awaitingF0 = new Map<number, HistoryEntry>(); // keyed on frame start sample
const isFinal = (h: HistoryEntry) => !Number.isNaN(h.f0);
const canvas = $<HTMLCanvasElement>('spectrogram');
const g = canvas.getContext('2d')!;
const SPEC_TOP_HZ = 4000;
let pending: WorkletMeter[] = []; // spectrogram columns not yet drawn
let pendingF0: WorkletF0[] = []; // F0 marks not yet drawn
let colCount = 0; // columns drawn so far
const colOf = new Map<number, number>(); // frame start sample -> column number, until its F0 mark is drawn

function drawColumns() {
  if (!live) return;
  const fs = live.ctx.sampleRate;
  const W = canvas.width, H = canvas.height;
  const cols = pending.splice(0);
  if (cols.length) {
    const img = g.getImageData(cols.length, 0, W - cols.length, H);
    g.putImageData(img, 0, 0);
  }
  cols.forEach((f, i) => {
    const x = W - cols.length + i;
    colOf.set(f.start, colCount++);
    g.fillStyle = '#fff';
    g.fillRect(x, 0, 1, H);
    if (f.power) {
      for (let y = 0; y < H; y++) {
        const hz = ((H - 1 - y) / (H - 1)) * SPEC_TOP_HZ;
        const k = Math.round((hz * 2048) / fs);
        const p = f.power[k] ?? 0;
        const db = 10 * Math.log10(p + 1e-12);
        const v = Math.max(0, Math.min(1, (db + 20) / 80)); // -20..60 dB relative to raw FFT power
        const c = Math.round(255 * (1 - v));
        g.fillStyle = `rgb(${c},${c},${c})`;
        g.fillRect(x, y, 1, 1);
      }
    }
    // singer's formant band guide lines
    g.fillStyle = 'rgba(228,64,27,0.25)';
    for (const hz of SF_BAND) g.fillRect(x, Math.round(H - 1 - (hz / SPEC_TOP_HZ) * (H - 1)), 1, 1);
  });
  // F0 marks land on their frame's column, which has scrolled left by the frames drawn since.
  g.fillStyle = '#E4401B';
  for (const f of pendingF0.splice(0)) {
    const col = colOf.get(f.start);
    if (col === undefined) continue;
    colOf.delete(f.start);
    const x = W - colCount + col;
    if (f.voiced && x >= 0) g.fillRect(x, Math.round(H - 1 - (f.f0 / SPEC_TOP_HZ) * (H - 1)) - 1, 2, 3);
  }
}

function renderReadout() {
  // F0, note and vibrato use the newest final frames; the band ratio uses every frame up to now.
  const newest = history[history.length - 1];
  let li = history.length - 1;
  while (li >= 0 && !isFinal(history[li])) li--;
  const last = li >= 0 ? history[li] : null;
  if (!newest) return;
  const lines: string[] = [];
  if (!last) {
    lines.push('F0        pending');
  } else if (last.f0 > 0) {
    const n = nearestNote(last.f0, a4());
    lines.push(`F0        ${fx(last.f0, 2)} Hz`);
    lines.push(`Note      ${n.name}  ${n.cents >= 0 ? '+' : ''}${fx(n.cents, 1)} cents (A4 = ${a4()} Hz)`);
  } else {
    lines.push('F0        unvoiced');
  }
  const recent = history.filter((h) => h.t > newest.t - 2.5);
  const v = analyzeVibrato(recent.filter(isFinal));
  lines.push(v ? `Vibrato   rate ${fx(v.rateHz, 2)} Hz, extent plus or minus ${fx(v.extentCents, 1)} cents (last 2.5 s)` : 'Vibrato   not detected in last 2.5 s');
  let eSf = 0, eRef = 0;
  for (const h of recent) if (h.voiced) { eSf += h.eSf; eRef += h.eRef; }
  lines.push(eSf > 0 && eRef > 0 ? `Band 2.5 to 3.5 kHz vs 0.05 to 2 kHz   ${fx(10 * Math.log10(eSf / eRef), 1)} dB (last 2.5 s, voiced frames)` : 'Band ratio   no voiced frames');
  lines.push(`Input     ${live?.stream.getAudioTracks()[0]?.label || 'unknown'} at ${live?.ctx.sampleRate} Hz, base latency ${fx((live?.ctx.baseLatency ?? NaN) * 1000, 1)} ms`);
  $('live-readout').textContent = lines.join('\n');
}

let rafId = 0;
const frameWaiters: ((f: WorkletF0, drawnAt: number) => void)[] = [];
let undrawn: WorkletF0[] = [];
function loop(ts: number) {
  drawColumns();
  renderReadout();
  const frames = undrawn.splice(0);
  for (const w of frameWaiters) for (const f of frames) w(f, ts);
  rafId = requestAnimationFrame(loop);
}

async function ensureLive() {
  if (live) return live;
  history.length = 0;
  awaitingF0.clear();
  colOf.clear();
  pending = []; pendingF0 = []; undrawn = [];
  live = await startLive({
    onMeter: (m) => {
      const h: HistoryEntry = { t: m.t, f0: NaN, voiced: m.voiced, eSf: m.eSf, eRef: m.eRef };
      history.push(h);
      awaitingF0.set(m.start, h);
      if (history.length > 4000) history.splice(0, history.length - 4000);
      pending.push(m);
    },
    onF0: (f) => {
      const h = awaitingF0.get(f.start);
      if (h) { h.f0 = f.voiced ? f.f0 : 0; awaitingF0.delete(f.start); }
      pendingF0.push(f);
      undrawn.push(f);
    },
  });
  $<HTMLButtonElement>('live-start').disabled = true;
  $<HTMLButtonElement>('live-stop').disabled = false;
  rafId = requestAnimationFrame(loop);
  return live;
}

async function stopLive() {
  await live?.stop(); // flushes the tracker first, so the last frames' F0 arrive before close
  cancelAnimationFrame(rafId);
  drawColumns();
  renderReadout();
  live = null;
  $<HTMLButtonElement>('live-start').disabled = false;
  $<HTMLButtonElement>('live-stop').disabled = true;
}

$('live-start').addEventListener('click', () => ensureLive().catch((e) => ($('live-readout').textContent = `Could not start: ${e}`)));
$('live-stop').addEventListener('click', () => void stopLive());

// ---------------------------------------------------------------- calibration
$('cal-run').addEventListener('click', async () => {
  const ref = Number($<HTMLInputElement>('cal-hz').value);
  const out = $('cal-readout');
  try {
    const s = await ensureLive();
    out.textContent = 'Measuring for 5 s...';
    const t0 = s.ctx.currentTime;
    await new Promise((r) => setTimeout(r, 5000));
    const f = history.filter((h) => h.f0 > 0 && h.t >= t0).map((h) => h.f0).sort((a, b) => a - b);
    if (f.length < 50) { out.textContent = `Too few voiced frames (${f.length}). Is the reference playing?`; return; }
    const med = f[f.length >> 1];
    const c = f.map((x) => centsBetween(x, med)).map(Math.abs).sort((a, b) => a - b);
    out.textContent = [
      `Reference         ${ref} Hz`,
      `Median measured   ${fx(med, 3)} Hz over ${f.length} frames`,
      `Offset            ${fx(centsBetween(med, ref), 2)} cents`,
      `Frame spread      P95 |dev from median| ${fx(c[Math.floor(0.95 * c.length)], 2)} cents`,
      `Context rate      ${s.ctx.sampleRate} Hz`,
    ].join('\n');
  } catch (e) { out.textContent = `Could not run: ${e}`; }
});

// ---------------------------------------------------------------- loopback latency
$('loop-run').addEventListener('click', async () => {
  const out = $('loop-readout');
  try {
    const s = await ensureLive();
    const results: number[] = [];
    for (let i = 0; i < 10; i++) {
      out.textContent = `Burst ${i + 1} of 10...`;
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
        const w = (f: WorkletF0, drawnAt: number) => {
          if (f.voiced && Math.abs(centsBetween(f.f0, 440)) < 50 && f.readyAt / s.ctx.sampleRate > T) {
            clearTimeout(timer); frameWaiters.splice(frameWaiters.indexOf(w), 1); resolve(drawnAt);
          }
        };
        frameWaiters.push(w);
      });
      if (drawn !== null) results.push(drawn - outPerf);
      await new Promise((r) => setTimeout(r, 600));
    }
    if (!results.length) { out.textContent = 'No burst was detected. Check speaker volume and microphone.'; return; }
    results.sort((a, b) => a - b);
    out.textContent = [
      `Bursts detected   ${results.length} of 10`,
      `Median            ${fx(results[results.length >> 1], 1)} ms`,
      `Range             ${fx(results[0], 1)} to ${fx(results[results.length - 1], 1)} ms`,
      `Context           ${s.ctx.sampleRate} Hz, base latency ${fx(s.ctx.baseLatency * 1000, 1)} ms, output latency ${fx(s.ctx.outputLatency * 1000, 1)} ms`,
    ].join('\n');
  } catch (e) { out.textContent = `Could not run: ${e}`; }
});

// ---------------------------------------------------------------- offline self-test
interface Entry { id: string; set: string; file: string; sr: number; dur: number; f0: number; rate: number; extent: number; onset_sample?: number }

function truthAt(e: Entry, t: number) {
  return e.extent === 0 ? e.f0 : e.f0 * Math.pow(2, (e.extent / 1200) * Math.sin(2 * Math.PI * e.rate * t));
}

async function renderFixture(e: Entry): Promise<WorkletF0[]> {
  const buf = await (await fetch(`/fixtures/synthetic/${e.file}`)).arrayBuffer();
  const len = Math.round(e.dur * e.sr);
  const ctx = new OfflineAudioContext(1, len, e.sr);
  await loadTracker(ctx);
  const audio = await ctx.decodeAudioData(buf);
  const frames: WorkletF0[] = [];
  const node = makeTrackerNode(ctx, { onF0: (f) => frames.push(f) });
  node.port.postMessage({ type: 'spectrum', enabled: false });
  const src = ctx.createBufferSource();
  src.buffer = audio;
  src.connect(node).connect(ctx.destination);
  src.start();
  await ctx.startRendering();
  // Counts 'f0' messages. The last voiced run's final `lag` frames are never settled in an offline render
  // (no flush is sent); they fall in the trimmed tail.
  const expected = Math.floor((len - 2048) / 256) - 1 - DEFAULT_CONTINUITY.lag;
  const t0 = performance.now();
  while (frames.length < expected && performance.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 20));
  return frames.sort((a, b) => a.start - b.start);
}

function pct(a: number[], q: number) { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; }

async function selfTest() {
  const out = $('self-readout');
  const man = await (await fetch('/fixtures/synthetic/manifest.json')).json();
  const entries: Entry[] = man.entries;
  const report: Record<string, unknown> = {};
  const lines: string[] = [];
  for (const set of ['tone_sine_48k', 'tone_sine_44k']) {
    const errs: number[] = [];
    let frames = 0;
    for (const e of entries.filter((x) => x.set === set)) {
      out.textContent = `${set}: ${e.id}`;
      for (const f of await renderFixture(e)) {
        if (f.t < 0.07 || f.t > e.dur - 0.07) continue;
        frames++;
        if (f.voiced) errs.push(Math.abs(centsBetween(f.f0, truthAt(e, f.t))));
      }
    }
    const r = { frames, voiced: errs.length, median: pct(errs, 0.5), p95: pct(errs, 0.95), max: Math.max(...errs), octave: errs.filter((x) => x > 600).length };
    report[set] = r;
    lines.push(`${set.padEnd(16)} frames ${r.frames} voiced ${r.voiced} median ${fx(r.median, 3)} p95 ${fx(r.p95, 3)} max ${fx(r.max, 2)} octave ${r.octave}`);
  }
  const vib = entries.filter((x) => x.set === 'vib_sine_48k');
  let worstRate = 0, worstExt = 0, fails = 0;
  for (const e of vib) {
    out.textContent = `vibrato: ${e.id}`;
    const fr = await renderFixture(e);
    const v = analyzeVibrato(fr.map((f) => ({ t: f.t, f0: f.voiced ? f.f0 : 0 })));
    if (!v) { fails++; continue; }
    const re = Math.abs(v.rateHz - e.rate), ee = Math.abs(v.extentCents - e.extent) / e.extent;
    worstRate = Math.max(worstRate, re); worstExt = Math.max(worstExt, ee);
    if (re > 0.3 || ee > 0.1) fails++;
  }
  report.vibrato = { cases: vib.length, worstRateErrHz: worstRate, worstExtentRelErr: worstExt, failing: fails };
  lines.push(`vib_sine_48k     cases ${vib.length} worst rate err ${fx(worstRate, 4)} Hz worst extent err ${fx(100 * worstExt, 2)}% failing ${fails}`);
  const lat = entries.find((x) => x.set === 'latency')!;
  const lf = await renderFixture(lat);
  const first = lf.find((f) => f.voiced && Math.abs(centsBetween(f.f0, 440)) <= 50 && f.readyAt > lat.onset_sample!);
  const latMs = first ? ((first.readyAt - lat.onset_sample!) / lat.sr) * 1000 : NaN;
  report.algorithmicLatencyMs = latMs;
  lines.push(`latency          onset to first final frame within 50 cents: ${fx(latMs, 2)} ms (worklet, offline render, ${DEFAULT_CONTINUITY.lag}-frame lookahead)`);
  report.userAgent = navigator.userAgent;
  (window as unknown as { __selfTest: unknown }).__selfTest = report;
  out.textContent = lines.join('\n');
}

$('self-run').addEventListener('click', () => selfTest().catch((e) => ($('self-readout').textContent = `Self-test failed: ${e}`)));
