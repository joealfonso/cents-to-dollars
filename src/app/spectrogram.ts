// Shared spectrogram renderer (DESIGN.md 2.10; specs/M2.md section 3: one renderer, never two). Voice analysis
// draws one column per live frame into its ring; Recording analysis draws the whole take, one column per
// canvas pixel, where each column is the mean power of the frames it covers (M2-DESIGN.md 2.1). Both write
// RGBA pixels with these functions, so the colour mapping, band lines and F0 marks are the same on both.
//
// Colours come from tokens and are re-read by the caller on themechange. In forced-colors mode the surface
// is Canvas, the energy and band lines are CanvasText and the F0 marks are Highlight, so the pitch marks stay
// distinct from the band lines (M2-DESIGN.md section 6, a11y review).

import { SF_BAND } from '../dsp/spectrum.ts';

export const SPEC_TOP_HZ = 4000;

export type Rgba = [number, number, number, number];
export interface SpecPalette { surface: Rgba; ramp: Rgba[]; f0: Rgba; band: Rgba; bandHalo: Rgba }

/** Any CSS colour to RGBA, through a 2D context's fillStyle parser. */
export function toRgba(ctx: CanvasRenderingContext2D | null, c: string): Rgba {
  if (!ctx) return [0, 0, 0, 1];
  ctx.fillStyle = '#000';
  ctx.fillStyle = c;
  const s = String(ctx.fillStyle);
  if (s[0] === '#') return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 1];
  const m = s.match(/[\d.]+/g);
  return m ? [Number(m[0]), Number(m[1]), Number(m[2]), m[3] === undefined ? 1 : Number(m[3])] : [0, 0, 0, 1];
}

export const forcedColors = () => !!window.matchMedia?.('(forced-colors: active)').matches;

/** Reads the plot colours from tokens on <html>. `ctx` is any 2D context, used only to parse colours. */
export function readSpecPalette(ctx: CanvasRenderingContext2D | null): SpecPalette {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
  const forced = forcedColors();
  const surface = toRgba(ctx, forced ? 'Canvas' : v('--surface-plot', '#FBFAF6'));
  const energy = toRgba(ctx, forced ? 'CanvasText' : v('--plot-energy', '#141413'));
  const ramp = Array.from({ length: 256 }, (_, i): Rgba => {
    const t = i / 255;
    return [0, 1, 2].map((k) => Math.round(surface[k] + (energy[k] - surface[k]) * t)).concat(1) as Rgba;
  });
  const band = toRgba(ctx, forced ? 'CanvasText' : v('--plot-band', 'rgba(228,64,27,0.35)'));
  const sameAsSurface = [0, 1, 2].every((k) => band[k] === surface[k]);
  return {
    surface, ramp,
    f0: toRgba(ctx, forced ? 'Highlight' : v('--signal', '#E4401B')),
    band,
    bandHalo: sameAsSurface ? toRgba(ctx, v('--ink', '#0A0A0A')) : surface,
  };
}

/** Row of a frequency in a column of H rows, 0 Hz at the bottom and SPEC_TOP_HZ at the top. */
export const specRowOf = (hz: number, H: number) => Math.round(H - 1 - (hz / SPEC_TOP_HZ) * (H - 1));

/** Blends colour c into pixel (x, y) of an image W pixels wide and H rows tall. */
export function putPixel(d: Uint8ClampedArray, W: number, H: number, x: number, y: number, c: Rgba): void {
  if (y < 0 || y >= H) return;
  const i = (y * W + x) * 4, a = c[3];
  d[i] = Math.round(c[0] * a + d[i] * (1 - a));
  d[i + 1] = Math.round(c[1] * a + d[i + 1] * (1 - a));
  d[i + 2] = Math.round(c[2] * a + d[i + 2] * (1 - a));
  d[i + 3] = 255;
}

/**
 * Fills column x of an image W wide and H tall with the energy shades for `power` (FFT power per bin, bin k at
 * k fs / N Hz), or the plot surface when power is null. Then draws the band guide lines with their halo.
 * Bins past the end of `power` read as its last bin.
 */
export function fillSpecColumn(
  d: Uint8ClampedArray, W: number, H: number, x: number, pal: SpecPalette,
  power: ArrayLike<number> | null, N: number, fs: number,
): void {
  for (let y = 0; y < H; y++) {
    let c = pal.surface;
    if (power && power.length) {
      const hz = ((H - 1 - y) / (H - 1)) * SPEC_TOP_HZ;
      const p = power[Math.min(power.length - 1, Math.round((hz * N) / fs))] ?? 0;
      const db = 10 * Math.log10(p + 1e-12);
      const v = Math.max(0, Math.min(1, (db + 20) / 80)); // -20..60 dB of raw FFT power, as on the legacy page
      if (v > 0) c = pal.ramp[Math.round(v * 255)];
    }
    const i = (y * W + x) * 4;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  // Band lines get a 1px halo like the F0 mark so they read on mid-grey energy (1.4.11). In Loud the line
  // colour is the plot colour, so the halo there is ink.
  for (const hz of SF_BAND) {
    const y = specRowOf(hz, H);
    putPixel(d, W, H, x, y - 1, pal.bandHalo); putPixel(d, W, H, x, y + 1, pal.bandHalo); putPixel(d, W, H, x, y, pal.band);
  }
}

/** F0 mark at f0 Hz in column x: 2 * half + 1 rows of the signal colour with a 1px surface halo (1.4). */
export function putF0Mark(d: Uint8ClampedArray, W: number, H: number, x: number, f0: number, pal: SpecPalette, half = 2): void {
  const y = specRowOf(f0, H);
  putPixel(d, W, H, x, y - half - 1, pal.surface); putPixel(d, W, H, x, y + half + 1, pal.surface);
  for (let k = -half; k <= half; k++) putPixel(d, W, H, x, y + k, pal.f0);
}
