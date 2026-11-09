// Drawing for the take figure stack (M2-DESIGN.md 2.1): pitch, cents, vibrato over time and the spectrogram,
// on one time axis. Pure drawing plus the layout numbers the view needs for its HTML axis labels. The view
// (views/file.ts) owns the DOM, the cursor and the state.
//
// Drawing rules (2.1, FINAL): pitch marks are per frame, at the frame's own whole-take F0, never joined and
// never averaged (F-27). When several frames fall in one pixel column, each is drawn at its own y. Unvoiced
// frames draw nothing. The spectrogram is the only figure that averages: when a column covers several frames
// it shows their mean power. Nothing here animates.

import type { TakeResult, VibratoWindow } from '../take/analyse.ts';
import { DEFAULT_YIN } from '../dsp/yin.ts';
import {
  type SpecPalette, type Rgba, css, drawSpecColumn, drawSpecBands, drawSpecF0Halo, drawSpecF0Mark,
} from './spectrogram.ts';

export interface View { t0: number; t1: number }

/** Figure heights in CSS px (M2-DESIGN.md 2.1, design choice). Vibrato rows are taller than the design's 56
 *  so the Loud axis labels (max, min, "None found") do not overlap. */
export const FIG_H = {
  wide: { overview: 40, pitch: 200, cents: 120, vibRow: 72, spec: 200 },
  compact: { overview: 40, pitch: 160, cents: 100, vibRow: 72, spec: 160 },
};

/** Vertical layout of one vibrato row, in CSS px from its top. */
export function vibRowLayout(rowH: number) {
  return { valTop: 8, valBottom: 32, baseline: rowH - 14 };
}

// ---------------------------------------------------------------- frames in a span

/** Frame times are nearly uniform (each includes its own YIN lag), so an index estimate plus a margin is safe. */
const MARGIN = 16;

export function frameRange(r: TakeResult, a: number, b: number): [number, number] {
  const n = r.frameCount;
  if (!n) return [0, 0];
  const dt = r.hop / r.sampleRate;
  const lo = Math.max(0, Math.floor((a - r.t[0]) / dt) - MARGIN);
  const hi = Math.min(n, Math.ceil((b - r.t[0]) / dt) + MARGIN + 1);
  return [lo, Math.max(lo, hi)];
}

/** The frame whose time is nearest `time`. */
export function nearestFrame(r: TakeResult, time: number): number {
  const n = r.frameCount;
  if (!n) return 0;
  const [lo, hi] = frameRange(r, time, time);
  let best = Math.min(n - 1, Math.max(0, lo)), bestD = Infinity;
  for (let i = lo; i < hi; i++) {
    const d = Math.abs(r.t[i] - time);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// ---------------------------------------------------------------- shared canvas setup

/** Sizes the bitmap to the CSS box times devicePixelRatio. Returns the 2D context and the scale, or null when hidden. */
function prep(canvas: HTMLCanvasElement, dprScale = true): { g: CanvasRenderingContext2D; W: number; H: number; k: number } | null {
  const k = dprScale ? window.devicePixelRatio || 1 : 1;
  const W = Math.round(canvas.clientWidth * k), H = Math.round(canvas.clientHeight * k);
  if (!W || !H) return null;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.setTransform(1, 0, 0, 1, 0, 0);
  return { g, W, H, k };
}

function fill(g: CanvasRenderingContext2D, W: number, H: number, c: Rgba) {
  g.fillStyle = css(c, 1);
  g.fillRect(0, 0, W, H);
}

const mixRgb = (pal: SpecPalette, t: number) => [0, 1, 2].map((i) => Math.round(pal.surface[i] + (pal.energy[i] - pal.surface[i]) * t));

/** A line colour between the surface and the energy colour. Decorative lines only (gridlines, guides). */
function mix(pal: SpecPalette, t: number): string {
  return `rgb(${mixRgb(pal, t).join(',')})`;
}

/** WCAG 2.x relative luminance and contrast ratio. */
function luminance(c: number[]): number {
  const ch = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
}
function contrast(a: number[], b: number[]): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Lines that carry meaning (the cents zero line, the vibrato "None found" baseline) must reach 3:1 against
 * the plot (WCAG 1.4.11). They aim for INFO_LINE_CONTRAST, the lightest mix from the surface toward the
 * energy colour that reaches it, computed from the tokens on every palette read. With today's tokens:
 * Paper (#FBFAF6 to #141413) mix 0.59, 4.6:1; Loud (#0A0A0A to #FFD60A) mix 0.54, 4.56:1. The mix 0.45 it
 * replaces was 2.98:1 in Paper. Under forced colours the ends are Canvas and CanvasText, same search.
 */
export const INFO_LINE_CONTRAST = 4.5;
function infoLine(pal: SpecPalette): string {
  for (let t = 0.3; t < 1; t += 0.01) {
    const c = mixRgb(pal, t);
    if (contrast(c, pal.surface) >= INFO_LINE_CONTRAST) return `rgb(${c.join(',')})`;
  }
  return css(pal.energy, 1);
}

// ---------------------------------------------------------------- Fig. 1 pitch

/** Semitones above A4 for a frequency. */
export const semis = (hz: number, a4: number) => 12 * Math.log2(hz / a4);

/** The pitch axis range in semitones from A4: the take's voiced F0, padded to whole semitones (2.1 item 4). */
export function pitchRange(r: TakeResult, a4: number): { lo: number; hi: number } | null {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < r.frameCount; i++) {
    const f = r.f0[i];
    if (f > 0) { if (f < mn) mn = f; if (f > mx) mx = f; }
  }
  if (!Number.isFinite(mn)) return null;
  return { lo: Math.floor(semis(mn, a4)) - 1, hi: Math.ceil(semis(mx, a4)) + 1 };
}

/**
 * Draws square marks at whole device pixels, skipping a mark whose pixel (x, y) already has one in the same
 * column. Each drawn mark is still one frame's own value at its own y: nothing is averaged or joined, and a
 * skipped mark would have painted exactly the same pixels (F-27). At wide spans many frames share a column
 * and a y, so this removes most of the fillRect calls with no visible change.
 */
class MarkPainter {
  private g: CanvasRenderingContext2D;
  private s: number;
  private stamp: Uint32Array;
  private gen = 0;
  private col = NaN;
  constructor(g: CanvasRenderingContext2D, H: number, s: number) {
    this.g = g;
    this.s = s;
    this.stamp = new Uint32Array(Math.max(1, Math.ceil(H)) + 1);
  }
  mark(x: number, y: number) {
    const xi = Math.round(x - this.s / 2), yi = Math.round(y - this.s / 2);
    if (xi !== this.col) { this.col = xi; this.gen++; }
    const slot = Math.min(this.stamp.length - 1, Math.max(0, yi));
    if (this.stamp[slot] === this.gen) return;
    this.stamp[slot] = this.gen;
    this.g.fillRect(xi, yi, this.s, this.s);
  }
}

/** Marks for a pitch-like figure: the frame's own F0 at its own y. */
function pitchMarks(
  g: CanvasRenderingContext2D, r: TakeResult, v: View, W: number, H: number, k: number,
  yOf: (f0: number) => number, colour: string, size: number,
) {
  const [a, b] = frameRange(r, v.t0, v.t1);
  const span = v.t1 - v.t0;
  g.fillStyle = colour;
  const p = new MarkPainter(g, H, Math.max(1, Math.round(size * k)));
  for (let i = a; i < b; i++) {
    const f = r.f0[i];
    if (!(f > 0)) continue;
    const t = r.t[i];
    if (t < v.t0 || t > v.t1) continue;
    p.mark(((t - v.t0) / span) * W, yOf(f));
  }
}

export function drawPitch(canvas: HTMLCanvasElement, r: TakeResult, v: View, a4: number, range: { lo: number; hi: number } | null, pal: SpecPalette): void {
  const p = prep(canvas);
  if (!p) return;
  const { g, W, H, k } = p;
  fill(g, W, H, pal.surface);
  if (!range) return;
  const { lo, hi } = range;
  const yOfS = (s: number) => H - ((s - lo) / (hi - lo)) * H;
  // a gridline at every semitone; C a little stronger, as an octave anchor
  for (let s = lo; s <= hi; s++) {
    const isC = (((69 + s) % 12) + 12) % 12 === 0;
    g.fillStyle = mix(pal, isC ? 0.35 : 0.12);
    g.fillRect(0, Math.round(yOfS(s)) - Math.floor(k / 2), W, Math.max(1, Math.round(k)));
  }
  pitchMarks(g, r, v, W, H, k, (f) => yOfS(semis(f, a4)), css(pal.f0, 1), 3);
}

/** Natural-note labels for the pitch axis, thinned so they never overlap: every natural, else C, E and G, else C. */
export function pitchLabels(range: { lo: number; hi: number }, plotH: number, labelH: number): { s: number; topPx: number }[] {
  const per = plotH / (range.hi - range.lo);
  const pc = (s: number) => (((69 + s) % 12) + 12) % 12; // 0 = C
  const NATURAL = [0, 2, 4, 5, 7, 9, 11];
  const keep = per >= labelH ? NATURAL : per * 3 >= labelH ? [0, 4, 7] : [0];
  const out: { s: number; topPx: number }[] = [];
  for (let s = Math.ceil(range.lo); s <= Math.floor(range.hi); s++) {
    if (!keep.includes(pc(s))) continue;
    out.push({ s, topPx: plotH - (s - range.lo) * per });
  }
  return out;
}

// ---------------------------------------------------------------- Fig. 2 cents

/** Deviation in cents from the nearest equal-tempered note, in [-50, +50), from cents above A4 (as nearestNote). */
export function deviation(centsAboveA4: number): { dev: number; n: number } {
  let n = Math.round(centsAboveA4 / 100);
  let dev = centsAboveA4 - 100 * n;
  if (dev >= 50) { n += 1; dev -= 100; }
  return { dev, n };
}

/** Pixel inset of the +50 and -50 lines from the top and bottom, so marks at the edges are not cut. */
export const CENTS_PAD = 6;

export function drawCents(canvas: HTMLCanvasElement, r: TakeResult, v: View, cents: Float64Array, pal: SpecPalette): void {
  const p = prep(canvas);
  if (!p) return;
  const { g, W, H, k } = p;
  fill(g, W, H, pal.surface);
  const pad = CENTS_PAD * k, mid = H / 2, half = mid - pad;
  const yOf = (d: number) => mid - (d / 50) * half;
  const lw = Math.max(1, Math.round(k));
  g.fillStyle = mix(pal, 0.15);
  g.fillRect(0, Math.round(yOf(50)), W, lw);
  g.fillRect(0, Math.round(yOf(-50)), W, lw);
  g.fillStyle = infoLine(pal); // the zero line carries meaning: at least 3:1 (INFO_LINE_CONTRAST)
  g.fillRect(0, Math.round(mid), W, lw);
  const [a, b] = frameRange(r, v.t0, v.t1);
  const span = v.t1 - v.t0;
  g.fillStyle = css(pal.f0, 1);
  const marks = new MarkPainter(g, H, Math.max(1, Math.round(3 * k)));
  for (let i = a; i < b; i++) {
    const c = cents[i];
    if (!Number.isFinite(c)) continue;
    const t = r.t[i];
    if (t < v.t0 || t > v.t1) continue;
    marks.mark(((t - v.t0) / span) * W, yOf(deviation(c).dev));
  }
}

/** y of a cents value in CSS px, for the HTML tick labels. */
export function centsY(d: number, plotH: number): number {
  const mid = plotH / 2, half = mid - CENTS_PAD;
  return mid - (d / 50) * half;
}

// ---------------------------------------------------------------- Fig. 3 vibrato

export interface VibAxis { lo: number; hi: number }

/** Axis range that fits the found values, padded; null when nothing was found. */
export function vibAxis(ws: VibratoWindow[], key: 'rateHz' | 'extentCents', minSpan: number): VibAxis | null {
  let mn = Infinity, mx = -Infinity;
  for (const w of ws) {
    const x = w[key];
    if (x === null || !Number.isFinite(x)) continue;
    if (x < mn) mn = x;
    if (x > mx) mx = x;
  }
  if (!Number.isFinite(mn)) return null;
  const pad = Math.max(minSpan - (mx - mn), 0) / 2;
  return { lo: mn - pad, hi: mx + pad };
}

export function drawVibrato(
  canvas: HTMLCanvasElement, ws: VibratoWindow[], v: View, rowH: number,
  axes: { speed: VibAxis | null; width: VibAxis | null }, pal: SpecPalette,
): void {
  const p = prep(canvas);
  if (!p) return;
  const { g, W, H, k } = p;
  fill(g, W, H, pal.surface);
  const L = vibRowLayout(rowH);
  const span = v.t1 - v.t0;
  const ink = css(pal.energy, 1);
  const lw = Math.max(1, Math.round(k));
  const rows: ['rateHz' | 'extentCents', VibAxis | null][] = [['rateHz', axes.speed], ['extentCents', axes.width]];
  rows.forEach(([key, ax], ri) => {
    const top = ri * rowH * k;
    // row separator, the baseline (dashed) and the value-zone guides
    if (ri > 0) { g.fillStyle = mix(pal, 0.45); g.fillRect(0, Math.round(top), W, lw); }
    const base = top + L.baseline * k;
    g.strokeStyle = infoLine(pal); // the "None found" baseline carries meaning: at least 3:1
    g.lineWidth = lw;
    g.setLineDash([4 * k, 3 * k]);
    g.beginPath(); g.moveTo(0, Math.round(base) + 0.5); g.lineTo(W, Math.round(base) + 0.5); g.stroke();
    g.setLineDash([]);
    g.fillStyle = mix(pal, 0.12);
    g.fillRect(0, Math.round(top + L.valTop * k), W, lw);
    g.fillRect(0, Math.round(top + L.valBottom * k), W, lw);
    const yOf = (x: number) => {
      if (!ax || ax.hi === ax.lo) return top + ((L.valTop + L.valBottom) / 2) * k;
      return top + (L.valBottom - ((x - ax.lo) / (ax.hi - ax.lo)) * (L.valBottom - L.valTop)) * k;
    };
    const r = 3 * k;
    for (const w of ws) {
      const mid = (w.t0 + w.t1) / 2;
      if (mid < v.t0 || mid > v.t1) continue;
      const x = ((mid - v.t0) / span) * W;
      const val = w[key];
      g.beginPath();
      if (val === null) {
        g.arc(x, base, r, 0, Math.PI * 2);
        g.fillStyle = css(pal.surface, 1);
        g.fill();
        g.strokeStyle = ink;
        g.lineWidth = Math.max(1, 1.5 * k);
        g.stroke();
      } else {
        g.arc(x, yOf(val), r, 0, Math.PI * 2);
        g.fillStyle = ink;
        g.fill();
      }
    }
  });
}

// ---------------------------------------------------------------- Fig. 4 spectrogram

/**
 * Paints the visible span at one bitmap pixel per CSS pixel (the canvas is shown pixelated). A column that
 * covers several frames shows their mean power; a column between frames (zoomed in) shows the nearest frame.
 * F0 marks are drawn per frame at the frame's own F0 with the 1px halo, never averaged.
 */
export function drawSpectrogram(canvas: HTMLCanvasElement, r: TakeResult, v: View, pal: SpecPalette): void {
  const p = prep(canvas, false);
  if (!p) return;
  const { g, W, H } = p;
  const img = g.createImageData(W, H);
  const d = img.data, stride = W * 4;
  const B = r.specBins;
  const binPerHz = DEFAULT_YIN.bufferSize / r.sampleRate;
  const span = v.t1 - v.t0;
  const colOf = (t: number) => Math.floor(((t - v.t0) / span) * W);
  const acc = new Float32Array(W * B);
  const count = new Uint32Array(W);
  const [a, b] = frameRange(r, v.t0, v.t1);
  for (let i = a; i < b; i++) {
    const t = r.t[i];
    if (t < v.t0 || t > v.t1) continue;
    const x = Math.min(W - 1, colOf(t));
    const row = i * B, o = x * B;
    for (let q = 0; q < B; q++) acc[o + q] += r.spectrum[row + q];
    count[x]++;
  }
  const one = new Float32Array(B);
  for (let x = 0; x < W; x++) {
    let power: Float32Array | null = null;
    if (count[x] > 0) {
      power = acc.subarray(x * B, x * B + B);
      if (count[x] > 1) for (let q = 0; q < B; q++) power[q] /= count[x];
    } else if (r.frameCount) {
      const tc = v.t0 + ((x + 0.5) / W) * span;
      const i = nearestFrame(r, tc);
      if (Math.abs(r.t[i] - tc) <= r.hop / r.sampleRate) {
        one.set(r.spectrum.subarray(i * B, i * B + B));
        power = one;
      }
    }
    drawSpecColumn(d, x, stride, H, power, binPerHz, pal);
    drawSpecBands(d, x, stride, H, pal);
  }
  for (const pass of [drawSpecF0Halo, drawSpecF0Mark]) {
    for (let i = a; i < b; i++) {
      const f = r.f0[i], t = r.t[i];
      if (!(f > 0) || t < v.t0 || t > v.t1) continue;
      pass(d, Math.min(W - 1, colOf(t)), stride, H, f, pal);
    }
  }
  g.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------- overview strip

/** Paints the whole take. Returns false when the canvas has no size (hidden), so the caller retries later. */
export function drawOverview(canvas: HTMLCanvasElement, r: TakeResult, durationS: number, a4: number, range: { lo: number; hi: number } | null, pal: SpecPalette): boolean {
  const p = prep(canvas);
  if (!p) return false;
  const { g, W, H, k } = p;
  fill(g, W, H, pal.surface);
  if (!range) return true;
  const pad = 3 * k;
  const yOf = (f: number) => H - pad - ((semis(f, a4) - range.lo) / (range.hi - range.lo)) * (H - 2 * pad);
  pitchMarks(g, r, { t0: 0, t1: durationS }, W, H, k, yOf, css(pal.f0, 1), 1.5);
  return true;
}

// ---------------------------------------------------------------- time axis

/** Tick times for a span: a round step that gives at most `maxTicks` labels. */
export function timeTicks(v: View, maxTicks: number): number[] {
  const STEPS = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const span = v.t1 - v.t0;
  const step = STEPS.find((s) => span / s <= maxTicks) ?? STEPS[STEPS.length - 1];
  const out: number[] = [];
  for (let t = Math.ceil(v.t0 / step - 1e-9) * step; t <= v.t1 + 1e-9; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
}
