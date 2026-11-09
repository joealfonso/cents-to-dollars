// Recording analysis (#/file): the drawing itself, read back from canvas pixels. Source: design/M2-DESIGN.md 2.1
// (drawing rules, pitch axis is log frequency, cents axis fixed -50..+50, spectrogram averages when columns < frames,
// captions), 2.2 (click sets the nearest frame), 3.2 (spectrogram caption), 3.3 (A4 announcement), specs/M2.md 4.2.7, F-27.
//
// Expected values come from the pipeline's own result for the same bytes (parseWav + analyseTake, run in Node), never
// from the app. Mark colours are read from the computed design tokens (--signal, --surface-plot, --plot-energy), per theme.
// The y calibration of the pitch and cents canvases is fitted from two steady segments (the axis range is not
// specified, only that it is log-frequency and linear in cents), then every frame is checked against that fit.
import { test, expect, type Page } from '@playwright/test';
import { parseWav } from '../../src/take/wav.ts';
import { analyseTake } from '../../src/take/analyse.ts';
import { tone, encodeWav } from '../take.helpers.ts';
import { openFileRoute, pick, waitDone, filePath, parseClock } from './file.util.ts';

const THEMES = ['editorial', 'loud'] as const;
type Theme = (typeof THEMES)[number];

async function setTheme(page: Page, theme: Theme) {
  await page.addInitScript((t) => { try { localStorage.setItem('centstodollars.theme', t); } catch { /* ignore */ } }, theme);
}

async function wholeTake(page: Page) {
  const b = page.getByRole('button', { name: 'Whole take' });
  if ((await b.count()) && !(await b.isDisabled()) && (await b.getAttribute('aria-disabled')) !== 'true') await b.click();
}

// ---------------------------------------------------------------- fixture: two steady pitches, a gap, a vibrato section

const SR = 48000;
const A_HZ = 220 * 2 ** (30 / 1200); // 30 cents sharp of A3
const B_HZ = 330 * 2 ** (-30 / 1200); // 30 cents flat of E4 (28 after rounding of the nearest note)
const sil = (s: number) => new Float64Array(Math.round(SR * s));
function pitchFixture() {
  const parts = [
    sil(0.3),
    tone({ sr: SR, dur: 1.0, f0: A_HZ }),
    sil(0.5),
    tone({ sr: SR, dur: 1.0, f0: B_HZ }),
    sil(0.4),
    tone({ sr: SR, dur: 1.2, f0: 261.6256, vibRate: 5.5, vibCents: 45 }),
  ];
  const out = new Float64Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  const bytes = encodeWav({ sampleRate: SR, format: 'pcm16', channels: [out] });
  const w = parseWav(bytes);
  return { bytes, r: analyseTake(w.samples, w.sampleRate), dur: w.samples.length / w.sampleRate };
}
const semis = (f: number) => 12 * Math.log2(f / 440);
function dev(f: number) {
  const c = 1200 * Math.log2(f / 440);
  const n = Math.round(c / 100);
  let d = c - 100 * n;
  if (d >= 50) d -= 100;
  return d;
}
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

/** Pixels in a canvas that are within `tol` per channel of the token colour: columns -> list of y. */
async function markColumns(page: Page, canvasId: string, token: string, tol = 48) {
  return page.evaluate(([id, tok, tl]) => {
    const c = document.getElementById(id as string) as HTMLCanvasElement;
    const probe = document.createElement('canvas').getContext('2d')!;
    probe.fillStyle = '#000';
    probe.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(tok as string).trim();
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const cols: number[][] = Array.from({ length: c.width }, () => []);
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (Math.abs(d[i] - r) <= (tl as number) && Math.abs(d[i + 1] - g) <= (tl as number) && Math.abs(d[i + 2] - b) <= (tl as number)) cols[x].push(y);
    }
    return { w: c.width, h: c.height, cols, rgb: [r, g, b], cssW: c.getBoundingClientRect().width };
  }, [canvasId, token, tol] as const);
}

/**
 * Checks one canvas against the pipeline: every voiced frame has a mark at its own y (from a two-segment linear fit
 * of y against `value`), and every mark pixel lies on some voiced frame's mark. A joined line, a min-max bar or an
 * averaged mark would leave pixels that no frame explains.
 */
function checkMarks(
  m: Awaited<ReturnType<typeof markColumns>>, r: ReturnType<typeof pitchFixture>['r'], dur: number,
  value: (f0: number) => number, label: string,
) {
  const W = m.w;
  const xOf = (t: number) => (t / dur) * W;
  const voiced: number[] = [];
  for (let i = 0; i < r.frameCount; i++) if (r.f0[i] > 0) voiced.push(i);
  expect(voiced.length, 'precondition: voiced frames').toBeGreaterThan(300);
  const yMedian = (lo: number, hi: number) => {
    const ys: number[] = []; const vs: number[] = [];
    for (const i of voiced) {
      if (r.t[i] < lo || r.t[i] > hi) continue;
      vs.push(value(r.f0[i]));
      const x = Math.round(xOf(r.t[i]));
      for (let c = x - 1; c <= x + 1; c++) if (m.cols[c]) ys.push(...m.cols[c]);
    }
    expect(ys.length, `${label}: mark pixels found in segment ${lo}-${hi} s (mark colour ${m.rgb})`).toBeGreaterThan(0);
    return { y: median(ys), v: median(vs) };
  };
  const a = yMedian(0.5, 1.1), b = yMedian(2.0, 2.6);
  expect(Math.abs(b.v - a.v), 'precondition: the two segments differ in value').toBeGreaterThan(5);
  const slope = (b.y - a.y) / (b.v - a.v);
  expect(slope, `${label}: higher value is higher on screen (y decreases)`).toBeLessThan(0);
  const yOf = (f: number) => a.y + slope * (value(f) - a.v);
  const missing: string[] = [];
  for (const i of voiced) {
    const x = xOf(r.t[i]), y = yOf(r.f0[i]);
    let hit = false;
    for (let c = Math.floor(x) - 2; c <= Math.ceil(x) + 2 && !hit; c++) hit = (m.cols[c] ?? []).some((py) => Math.abs(py + 0.5 - y) <= 2.5);
    if (!hit) missing.push(`frame ${i} t=${r.t[i].toFixed(3)} f0=${r.f0[i].toFixed(2)} expected near (${x.toFixed(1)}, ${y.toFixed(1)})`);
  }
  expect(missing.slice(0, 8), `${label}: ${missing.length} voiced frames have no mark at their own value`).toEqual([]);
  const near: Map<number, number[]> = new Map();
  for (const i of voiced) { const c = Math.round(xOf(r.t[i])); (near.get(c) ?? near.set(c, []).get(c)!).push(yOf(r.f0[i])); }
  const stray: string[] = [];
  m.cols.forEach((ys, x) => {
    for (const py of ys) {
      let ok = false;
      for (let c = x - 3; c <= x + 3 && !ok; c++) ok = (near.get(c) ?? []).some((fy) => Math.abs(py + 0.5 - fy) <= 3);
      if (!ok) stray.push(`(${x},${py})`);
    }
  });
  expect(stray.slice(0, 12), `${label}: ${stray.length} mark-coloured pixels that no frame explains (joined or averaged marks)`).toEqual([]);
  // The silent gaps: no mark at all between the last voiced frame of a run and the first of the next, minus the mark size.
  let gaps = 0;
  for (let k = 1; k < voiced.length; k++) {
    const t0 = r.t[voiced[k - 1]], t1 = r.t[voiced[k]];
    if (t1 - t0 < 0.2) continue;
    gaps++;
    for (let x = Math.ceil(xOf(t0)) + 3; x <= Math.floor(xOf(t1)) - 3; x++) expect(m.cols[x], `${label}: gap column ${x} (${((x / W) * dur).toFixed(2)} s) must be empty`).toEqual([]);
  }
  expect(gaps, 'precondition: the fixture has silent gaps').toBeGreaterThanOrEqual(2);
}

for (const theme of THEMES) {
  test(`F-27 pixels (${theme}): pitch figure has a mark at each frame's own F0 and nothing in the gaps`, async ({ page }) => {
    const { bytes, r, dur } = pitchFixture();
    await setTheme(page, theme);
    await openFileRoute(page);
    await pick(page, filePath('pix.wav', bytes));
    await waitDone(page);
    await wholeTake(page);
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(theme);
    const m = await markColumns(page, 'fa-fig-pitch', '--signal');
    checkMarks(m, r, dur, semis, `pitch/${theme}`);
  });

  test(`F-27 pixels (${theme}): cents figure has a mark at each frame's own deviation and nothing in the gaps`, async ({ page }) => {
    const { bytes, r, dur } = pitchFixture();
    await setTheme(page, theme);
    await openFileRoute(page);
    await pick(page, filePath('pix.wav', bytes));
    await waitDone(page);
    await wholeTake(page);
    const m = await markColumns(page, 'fa-fig-cents', '--signal');
    checkMarks(m, r, dur, dev, `cents/${theme}`);
  });
}

// ---------------------------------------------------------------- spectrogram averaging

test('F-27 / 2.1: where frames outnumber columns, a spectrogram column is the mean power of its frames, not one of them', async ({ page }) => {
  test.setTimeout(120000);
  // 2nd harmonic of f0 sits exactly on FFT bin 43 (43 * 48000 / 2048 = 1007.8 Hz x 2), so the sampled row has one bin.
  const f0 = (43 * SR) / 2048 / 2;
  const dur = 30;
  const a = tone({ sr: SR, dur, f0, harmonics: [1, 0.7], amp: 0.05 });
  for (let i = 0; i < a.length; i++) if (Math.floor(i / SR / 0.5) % 2 === 1) a[i] = 0; // 0.5 s on, 0.5 s off
  const bytes = encodeWav({ sampleRate: SR, format: 'pcm16', channels: [a] });
  const w = parseWav(bytes);
  const r = analyseTake(w.samples, w.sampleRate);
  const B = r.specBins;
  const bin = 43;
  await openFileRoute(page);
  await pick(page, filePath('spec.wav', bytes));
  await waitDone(page);
  await wholeTake(page);
  const durS = w.samples.length / w.sampleRate;
  const shot = await page.evaluate(() => {
    const c = document.getElementById('fa-fig-spec') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const cs = getComputedStyle(document.documentElement);
    const probe = document.createElement('canvas').getContext('2d')!;
    const rgb = (tok: string) => { probe.fillStyle = '#000'; probe.fillStyle = cs.getPropertyValue(tok).trim(); probe.fillRect(0, 0, 1, 1); return Array.from(probe.getImageData(0, 0, 1, 1).data.slice(0, 3)); };
    return { w: c.width, h: c.height, data: Array.from(d), surface: rgb('--surface-plot'), energy: rgb('--plot-energy') };
  });
  const { w: W, h: H } = shot;
  expect(r.frameCount / W, 'precondition: several frames per column').toBeGreaterThan(2);
  // Row for FFT bin 43 on the 0 to 4 kHz axis (0 Hz at the bottom row).
  const binPerHz = 2048 / SR;
  const rows: number[] = [];
  for (let y = 0; y < H; y++) if (Math.round(((H - 1 - y) / (H - 1)) * 4000 * binPerHz) === bin) rows.push(y);
  expect(rows.length, 'precondition: a pixel row maps to bin 43').toBeGreaterThan(0);
  const y = rows[rows.length >> 1];
  const [s, e] = [shot.surface, shot.energy];
  const den = [0, 1, 2].reduce((n, k) => n + (e[k] - s[k]) ** 2, 0);
  expect(den, 'surface and energy colours differ').toBeGreaterThan(1000);
  const levelAt = (x: number) => { const i = (y * W + x) * 4; return [0, 1, 2].reduce((n, k) => n + (shot.data[i + k] - s[k]) * (e[k] - s[k]), 0) / den; };
  // Brightness from raw power: -20 to 60 dB (the legacy page mapping carried over by the design, DESIGN.md 2.10).
  const level = (p: number) => Math.max(0, Math.min(1, (10 * Math.log10(p + 1e-12) + 20) / 80));
  const cols: number[][] = Array.from({ length: W }, () => []);
  for (let i = 0; i < r.frameCount; i++) { const x = Math.min(W - 1, Math.floor((r.t[i] / durS) * W)); cols[x].push(i); }
  const onLevels = [] as number[];
  for (let i = 0; i < r.frameCount; i++) onLevels.push(level(r.spectrum[i * B + bin]));
  expect(Math.max(...onLevels), 'precondition: the loud frames are not saturated').toBeLessThan(0.93);
  expect(Math.max(...onLevels), 'precondition: the loud frames are visibly bright').toBeGreaterThan(0.3);
  const TOL = 0.03; // ramp has 256 steps and channels round to integers: under 0.01; the rest is margin for the bin/row choice.
  const bad: string[] = [];
  let discriminating = 0;
  for (let x = 0; x < W; x++) {
    const fr = cols[x];
    if (fr.length < 2) continue;
    const ls = fr.map((i) => onLevels[i]);
    const mean = level(fr.reduce((n, i) => n + r.spectrum[i * B + bin], 0) / fr.length);
    const got = levelAt(x);
    if (Math.abs(got - mean) > TOL) bad.push(`col ${x}: ${fr.length} frames, mean level ${mean.toFixed(3)}, drawn ${got.toFixed(3)}`);
    if (Math.max(...ls) - Math.min(...ls) > 0.3 && Math.abs(mean - Math.max(...ls)) > 3 * TOL && Math.abs(mean - Math.min(...ls)) > 3 * TOL && Math.abs(mean - ls[0]) > 3 * TOL) discriminating++;
  }
  expect(discriminating, 'precondition: columns where the mean differs from the loudest, quietest and first frame').toBeGreaterThanOrEqual(5);
  expect(bad.slice(0, 8), `${bad.length} columns are not the mean of their frames`).toEqual([]);
});

// Controls: the checker must reject a joined line and a min-max bar drawn in the mark colour.
test('F-27 pixels control: the pitch check rejects a line joining the runs and a bar through a column', async ({ page }) => {
  const { bytes, r, dur } = pitchFixture();
  await openFileRoute(page);
  await pick(page, filePath('pix.wav', bytes));
  await waitDone(page);
  await wholeTake(page);
  const draw = (kind: 'line' | 'bar') => page.evaluate((k) => {
    const c = document.getElementById('fa-fig-pitch') as HTMLCanvasElement;
    const g = c.getContext('2d')!;
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--signal').trim();
    if (k === 'line') g.fillRect(c.width * 0.33, c.height * 0.5, c.width * 0.12, 3);
    else g.fillRect(c.width * 0.1, 0, 3, c.height);
  }, kind);
  checkMarks(await markColumns(page, 'fa-fig-pitch', '--signal'), r, dur, semis, 'clean');
  await draw('line');
  const joined = await markColumns(page, 'fa-fig-pitch', '--signal');
  expect(() => checkMarks(joined, r, dur, semis, 'joined')).toThrow();
  await page.reload();
  await pick(page, filePath('pix.wav', bytes));
  await waitDone(page);
  await wholeTake(page);
  await draw('bar');
  const bar = await markColumns(page, 'fa-fig-pitch', '--signal');
  expect(() => checkMarks(bar, r, dur, semis, 'bar')).toThrow();
});

// ---------------------------------------------------------------- click mapping

/** The drawn plot area: the pitch canvas box (its edges are where the time axis starts and ends). */
async function plotEdges(page: Page) {
  return page.locator('#fa-fig-pitch').evaluate((el) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const f = (p: string) => parseFloat(cs.getPropertyValue(p)) || 0;
    return { left: r.left + f('border-left-width') + f('padding-left'), right: r.right - f('border-right-width') - f('padding-right'), top: r.top, h: r.height, border: f('border-left-width') };
  });
}

for (const theme of THEMES) {
  test(`2.2 click mapping (${theme}): the left and right content edges select the first and last frame (within one frame)`, async ({ page }) => {
    const { bytes, r } = pitchFixture();
    await setTheme(page, theme);
    await openFileRoute(page);
    await pick(page, filePath('click.wav', bytes));
    await waitDone(page);
    await wholeTake(page);
    const cur = page.locator('#fa-cursor');
    await cur.scrollIntoViewIfNeeded();
    const dt = r.t[1] - r.t[0];
    const tol = dt + 0.011; // one frame, plus the rounding of aria-valuenow
    const e = await plotEdges(page);
    const y = e.top + e.h / 2;
    await page.mouse.click(e.left + 0.5, y);
    await expect.poll(async () => Math.abs(Number(await cur.getAttribute('aria-valuenow')) - r.t[0]), { message: 'left content edge selects the first frame' }).toBeLessThanOrEqual(tol);
    await page.mouse.click(e.right - 0.5, y);
    await expect.poll(async () => Math.abs(Number(await cur.getAttribute('aria-valuenow')) - r.t[r.frameCount - 1]), { message: 'right content edge selects the last frame' }).toBeLessThanOrEqual(tol);
    // A few pixels in from each edge must still be the same frame region, never a jump to the middle.
    await page.mouse.click(e.left + 0.5, y);
    const first = Number(await cur.getAttribute('aria-valuenow'));
    expect(first).toBeLessThanOrEqual(r.t[0] + tol);
  });

  test(`2.2 click mapping (${theme}): after zoom and pan, a click on the drawn end of a run and the drawn start of the next run select those frames`, async ({ page }) => {
    const { bytes, r } = pitchFixture();
    await setTheme(page, theme);
    await openFileRoute(page);
    await pick(page, filePath('click2.wav', bytes));
    await waitDone(page);
    await wholeTake(page);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    // Run ends and starts from the pipeline's own voiced frames (gaps longer than 0.2 s).
    const ends: number[] = [], starts: number[] = [];
    let prev = -1;
    for (let i = 0; i < r.frameCount; i++) {
      if (!(r.f0[i] > 0)) continue;
      if (prev >= 0 && r.t[i] - r.t[prev] > 0.2) { ends.push(r.t[prev]); starts.push(r.t[i]); }
      prev = i;
    }
    expect(ends.length, 'precondition: two gaps').toBeGreaterThanOrEqual(2);
    const runs = async () => {
      const m = await markColumns(page, 'fa-fig-pitch', '--signal');
      const filled = m.cols.map((c) => c.length > 0);
      const out: { a: number; b: number }[] = [];
      let x = 0;
      while (x < filled.length) {
        if (!filled[x]) { x++; continue; }
        let b = x; let hole = 0;
        for (let k = x; k < filled.length; k++) { if (filled[k]) { b = k; hole = 0; } else if (++hole > 12) break; }
        out.push({ a: x, b }); x = b + 1;
      }
      return { m, runs: out };
    };
    let got = await runs();
    for (let i = 0; i < 8 && got.runs.length < 2; i++) { await page.getByRole('button', { name: 'Later' }).click(); got = await runs(); }
    expect(got.runs.length, 'a gap between two runs can be brought into view by zoom and pan').toBeGreaterThanOrEqual(2);
    const { a: _a, b: endX } = got.runs[0];
    const startX = got.runs[1].a;
    const cur = page.locator('#fa-cursor');
    const canvas = page.locator('#fa-fig-pitch');
    await canvas.scrollIntoViewIfNeeded();
    // Page coordinates of canvas column `col`, at the vertical middle of the pitch canvas (read fresh after the scroll).
    const at = async (col: number) => canvas.evaluate((c, k) => { const b = (c as HTMLCanvasElement).getBoundingClientRect(); return { x: b.left + ((k + 0.5) / (c as HTMLCanvasElement).width) * b.width, y: b.top + b.height / 2 }; }, col);
    const dt = r.t[1] - r.t[0];
    const tol = 2 * dt + 0.011;
    const p1 = await at(endX - 1);
    await page.mouse.click(p1.x, p1.y);
    await page.waitForTimeout(100);
    const v1 = Number(await cur.getAttribute('aria-valuenow'));
    const k = ends.findIndex((t) => Math.abs(t - v1) <= tol);
    expect(k, `click on the drawn end of a run (canvas column ${endX}) selected ${v1} s; run ends are ${ends.map((t) => t.toFixed(3))}`).toBeGreaterThanOrEqual(0);
    const p2 = await at(startX + 1);
    await page.mouse.click(p2.x, p2.y);
    await page.waitForTimeout(100);
    const v2 = Number(await cur.getAttribute('aria-valuenow'));
    expect(Math.abs(v2 - starts[k]), `click on the drawn start of the next run selected ${v2} s, expected about ${starts[k].toFixed(3)} s`).toBeLessThanOrEqual(tol);
    void parseClock;
  });
}

// ---------------------------------------------------------------- A4 announcement after leave

test('3.3: changing A4 and leaving the route in the same task leaves #fa-status empty and never announces afterwards', async ({ page }) => {
  await openFileRoute(page);
  await pick(page, filePath('a4leave.wav', pitchFixture().bytes));
  await waitDone(page);
  await page.evaluate(() => {
    (window as any).__late = [];
    const mo = new MutationObserver(() => {
      const t = (document.getElementById('fa-status')?.textContent ?? '').trim();
      if (t && (window as any).__left) (window as any).__late.push(t);
    });
    mo.observe(document.getElementById('fa-status')!, { subtree: true, childList: true, characterData: true });
    (window as any).__mo = mo;
  });
  await page.evaluate(() => {
    const input = (document.querySelector('input#fa-a4, #fa-a4 input') as HTMLInputElement);
    input.value = '442';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    location.hash = '#/tools';
  });
  await expect(page.locator('section[data-route="tools"]')).toBeVisible();
  // The leave has resolved. Writes before this point (the announcement and the hook clearing it) are allowed.
  await page.evaluate(() => { (window as any).__mo.takeRecords(); (window as any).__left = true; });
  await page.waitForTimeout(800); // a deferred announcement (next frame, timer) would land here
  expect(await page.locator('#fa-status').textContent(), '#fa-status after the leave').toBe('');
  expect(await page.evaluate(() => (window as any).__late), 'no text was written to #fa-status after the leave').toEqual([]);
});
