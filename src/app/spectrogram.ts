// One spectrogram renderer for the live view (#/voice, DESIGN.md 2.10) and the take figures (#/file,
// M2-DESIGN.md 2.1). The live view scrolls one column per frame into a ring; the take view paints a whole
// visible span at once, averaging frames when there are more frames than columns. Both write pixels through
// the same functions here: the palette from tokens (re-read on themechange and when forced colours switch),
// the power-to-brightness mapping, the 2.5 and 3.5 kHz band lines with their halo, and the F0 mark with its
// 1px halo. Only how columns are laid out differs, and that stays in each view.
//
// Forced colours (M2-DESIGN.md 6): canvases do not follow system colours by themselves, so in
// `forced-colors: active` the palette is Canvas for the surface and CanvasText for energy, marks and lines.

import { SF_BAND } from '../dsp/spectrum.ts';

/** Top of the display range, Hz. Bottom is 0. */
export const SPEC_TOP_HZ = 4000;

export type Rgba = [number, number, number, number];

export interface SpecPalette {
  surface: Rgba;
  /** 256 steps from the surface to the energy colour. */
  ramp: Rgba[];
  f0: Rgba;
  band: Rgba;
  bandHalo: Rgba;
  /** The energy colour itself, for marks on the take figures. */
  energy: Rgba;
  forced: boolean;
}

let scratch: CanvasRenderingContext2D | null = null;

/** Any CSS colour to RGBA, through a 1x1 canvas so named, hex and rgb() forms all parse. */
export function toRgba(c: string): Rgba {
  if (!scratch) scratch = document.createElement('canvas').getContext('2d');
  if (!scratch) return [0, 0, 0, 1];
  scratch.fillStyle = '#000';
  scratch.fillStyle = c;
  const s = String(scratch.fillStyle);
  if (s[0] === '#') return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 1];
  const m = s.match(/[\d.]+/g);
  return m ? [Number(m[0]), Number(m[1]), Number(m[2]), m[3] === undefined ? 1 : Number(m[3])] : [0, 0, 0, 1];
}

const forcedQuery = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(forced-colors: active)') : null);

/** System colours resolved by the browser, read from a probe element (canvas fillStyle does not take them everywhere). */
function systemColours(): { canvas: string; text: string } {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;color:CanvasText;background-color:Canvas';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const out = { canvas: cs.backgroundColor || '#fff', text: cs.color || '#000' };
  probe.remove();
  return out;
}

function rampOf(surface: Rgba, energy: Rgba): Rgba[] {
  return Array.from({ length: 256 }, (_, i): Rgba => {
    const t = i / 255;
    return [0, 1, 2].map((k) => Math.round(surface[k] + (energy[k] - surface[k]) * t)).concat(1) as Rgba;
  });
}

/** Colours from tokens (DESIGN.md 2.10), or system colours under forced colours. */
export function readSpecPalette(): SpecPalette {
  if (forcedQuery()?.matches) {
    const sys = systemColours();
    const surface = toRgba(sys.canvas), text = toRgba(sys.text);
    return { surface, ramp: rampOf(surface, text), f0: text, band: text, bandHalo: surface, energy: text, forced: true };
  }
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
  const surface = toRgba(v('--surface-plot', '#FBFAF6'));
  const energy = toRgba(v('--plot-energy', '#141413'));
  const band = toRgba(v('--plot-band', 'rgba(228,64,27,0.35)'));
  const sameAsSurface = [0, 1, 2].every((k) => band[k] === surface[k]);
  return {
    surface, ramp: rampOf(surface, energy), f0: toRgba(v('--signal', '#E4401B')), band,
    bandHalo: sameAsSurface ? toRgba(v('--ink', '#0A0A0A')) : surface, energy, forced: false,
  };
}

/** Calls `cb` after a theme change and when forced colours turn on or off. The caller re-reads the palette. */
export function onSpecPaletteChange(cb: () => void): void {
  document.addEventListener('themechange', cb);
  forcedQuery()?.addEventListener?.('change', cb);
}

/** Brightness 0 to 1 for one FFT power value: -20 to 60 dB of raw power, as on the legacy page. */
export function powerLevel(p: number): number {
  const db = 10 * Math.log10(p + 1e-12);
  return Math.max(0, Math.min(1, (db + 20) / 80));
}

/** Row of a frequency in a column of H pixels, 0 Hz at the bottom row. */
export function specRowOf(hz: number, H: number): number {
  return Math.round(H - 1 - (hz / SPEC_TOP_HZ) * (H - 1));
}

/** Alpha-blends one pixel. `i` is the byte offset of the pixel. */
function blend(d: Uint8ClampedArray, i: number, c: Rgba) {
  const a = c[3];
  d[i] = Math.round(c[0] * a + d[i] * (1 - a));
  d[i + 1] = Math.round(c[1] * a + d[i + 1] * (1 - a));
  d[i + 2] = Math.round(c[2] * a + d[i + 2] * (1 - a));
  d[i + 3] = 255;
}

function put(d: Uint8ClampedArray, x: number, stride: number, H: number, y: number, c: Rgba) {
  if (y < 0 || y >= H) return;
  blend(d, y * stride + x * 4, c);
}

/**
 * Paints column `x` (H rows, `stride` bytes per row) from a power spectrum whose bin k is k / binPerHz Hz.
 * A null spectrum paints the surface. Bins past the end of `power` read as silence.
 */
export function drawSpecColumn(
  d: Uint8ClampedArray, x: number, stride: number, H: number,
  power: ArrayLike<number> | null, binPerHz: number, pal: SpecPalette,
): void {
  for (let y = 0; y < H; y++) {
    let c = pal.surface;
    if (power) {
      const hz = ((H - 1 - y) / (H - 1)) * SPEC_TOP_HZ;
      const v = powerLevel(power[Math.round(hz * binPerHz)] ?? 0);
      if (v > 0) c = pal.ramp[Math.round(v * 255)];
    }
    const i = y * stride + x * 4;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
}

/** The 2.5 and 3.5 kHz band lines, each with a 1px halo so they read on mid-grey energy (1.4.11). */
export function drawSpecBands(d: Uint8ClampedArray, x: number, stride: number, H: number, pal: SpecPalette): void {
  for (const hz of SF_BAND) {
    const y = specRowOf(hz, H);
    put(d, x, stride, H, y - 1, pal.bandHalo); put(d, x, stride, H, y + 1, pal.bandHalo); put(d, x, stride, H, y, pal.band);
  }
}

/** The halo of an F0 mark, in the plot colour. Draw every halo in a column before its marks. */
export function drawSpecF0Halo(d: Uint8ClampedArray, x: number, stride: number, H: number, f0: number, pal: SpecPalette): void {
  const y = specRowOf(f0, H);
  put(d, x, stride, H, y - 3, pal.surface); put(d, x, stride, H, y + 3, pal.surface);
}

/** An F0 mark, 5 rows tall, at the frame's own F0. */
export function drawSpecF0Mark(d: Uint8ClampedArray, x: number, stride: number, H: number, f0: number, pal: SpecPalette): void {
  const y = specRowOf(f0, H);
  for (let k = -2; k <= 2; k++) put(d, x, stride, H, y + k, pal.f0);
}

/** CSS rgba() for a palette colour, for 2D context drawing. */
export function css(c: Rgba, alpha = c[3]): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}
