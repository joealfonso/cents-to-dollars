// Recording analysis (#/file), behaviour during and after analysis. Source: design/M2-DESIGN.md 2.2, 2.3, 3.3, 6, 7 and
// specs/M2.md 4.6. Criteria: F-17, F-18, F-19, F-23, F-27, plus the keyboard path through the time cursor (2.2, 6)
// and reduced motion / no transitions on figures and the progress fill (2.3, 7).
//
// F-27 note: the design defines no data attribute or test hook that lists drawn marks. The test therefore reads the
// time cursor (aria-valuetext, #fa-cursor-line) for every frame and compares each reading with the pipeline's own
// result (parseWav + analyseTake, imported in Node) for the same bytes. A mark at a value that is not some frame's
// whole-take F0 would need a reading that is not in that list; the readings are the text twin of the marks (design 2.2).
import { test, expect, type Page } from '@playwright/test';
import { parseWav } from '../../src/take/wav.ts';
import { analyseTake } from '../../src/take/analyse.ts';
import { tone, encodeWav } from '../take.helpers.ts';
import { MAX_DURATION_S } from '../../src/take/limits.ts';
import { openFileRoute, pick, waitDone, fa, filePath, longWavPath, wavBytes } from './file.util.ts';

const toolsVisible = (page: Page) => expect(page.locator('section[data-route="tools"]')).toBeVisible();
const leave = async (page: Page) => { await page.evaluate(() => { location.hash = '#/tools'; }); await toolsVisible(page); };

function pcts(h: { progress: string | null; valuetext: string | null }): number | null {
  const a = /Analysing, (\d+(?:\.\d+)?)\s*(?:%|percent)/.exec(h.valuetext ?? '') ?? /Analysing, (\d+(?:\.\d+)?)\s*(?:%|percent)/.exec(h.progress ?? '');
  return a ? Number(a[1]) : null;
}

// ---------------------------------------------------------------- F-18

test('F-18: progress values never decrease and 100% appears only in Done', async ({ page }) => {
  test.setTimeout(120000);
  await openFileRoute(page);
  await pick(page, longWavPath(120));
  await waitDone(page);
  const f = await fa(page);
  const seq = f.hist.filter((h) => h.progressVisible).map((h) => ({ p: pcts(h), done: h.done })).filter((x) => x.p !== null) as { p: number; done: boolean }[];
  expect(seq.length, 'several determinate progress values were shown (precondition)').toBeGreaterThanOrEqual(3);
  for (let i = 1; i < seq.length; i++) expect(seq[i].p, `value ${i} (${seq[i].p}) after ${seq[i - 1].p}`).toBeGreaterThanOrEqual(seq[i - 1].p);
  const at100 = seq.filter((x) => x.p >= 100);
  expect(at100.filter((x) => !x.done), '100% shown outside Done').toEqual([]);
  // Also: no snapshot with 100 in the progress text while not done, whatever its visibility.
  expect(f.hist.filter((h) => !h.done && /\b100\s*(%|percent)/.test(`${h.progress} ${h.valuetext}`))).toEqual([]);
});

test('2.3 / 7: determinate progress fill has no transition', async ({ page }) => {
  test.setTimeout(120000);
  await openFileRoute(page);
  await pick(page, longWavPath(300));
  const bar = page.locator('#fa-progress[role="progressbar"], #fa-progress [role="progressbar"]').first();
  await expect.poll(async () => (await bar.getAttribute('aria-valuetext').catch(() => null)) ?? '', { timeout: 30000 }).toMatch(/^Analysing, \d+ percent$/);
  const bad = await page.evaluate(() => {
    const root = document.querySelector('#fa-progress[role="progressbar"], #fa-progress [role="progressbar"]')!;
    const out: string[] = [];
    for (const el of [root, ...root.querySelectorAll('*')]) {
      const cs = getComputedStyle(el);
      const d = cs.transitionDuration.split(',').map((x) => parseFloat(x) * (x.trim().endsWith('ms') ? 1 : 1000));
      if (d.some((x) => x > 0)) out.push(`${el.tagName}.${(el as HTMLElement).className}: ${cs.transitionProperty} ${cs.transitionDuration}`);
    }
    return out;
  });
  expect(bad, 'any element in the progress bar with a transition would show a value the worker did not send').toEqual([]);
  await page.locator('#fa-cancel').click();
});

// ---------------------------------------------------------------- F-17

test('F-17: leaving the route during analysis: no worker message and no progress change after the leave', async ({ page }) => {
  test.setTimeout(120000);
  await openFileRoute(page);
  await pick(page, longWavPath(300));
  await expect.poll(async () => (await fa(page)).msgs, { timeout: 30000, message: 'analysis is running (precondition)' }).toBeGreaterThan(0);
  expect((await fa(page)).hist.some((h) => h.done), 'precondition: not finished yet').toBe(false);
  await leave(page);
  const at = await fa(page);
  await page.waitForTimeout(4000); // the 300 s file needs several seconds more, so a live worker would keep talking
  const later = await fa(page);
  expect(later.msgs, 'worker messages after the leave resolved').toBe(at.msgs);
  expect(later.hist.length, 'progress/status snapshots after the leave resolved').toBe(at.hist.length);
  expect(later.hist.some((h) => h.done), 'no Done for a left route').toBe(false);
  // Back on the route: empty state, no results from the abandoned file.
  await page.evaluate(() => { location.hash = '#/file'; });
  await expect(page.locator('#fa-open')).toBeVisible();
  await expect(page.locator('#fa-figs')).toBeHidden();
  await expect(page.locator('#fa-info')).toBeHidden();
  await page.waitForTimeout(1000);
  expect((await fa(page)).msgs).toBe(at.msgs);
});

// ---------------------------------------------------------------- F-19

test('F-19: longest allowed file (600 s WAV): no main-thread task over 200 ms before Done', async ({ page }) => {
  test.setTimeout(300000);
  await openFileRoute(page);
  const supported = await page.evaluate(() => PerformanceObserver.supportedEntryTypes.includes('longtask'));
  expect(supported, 'Chrome long-task observer is available').toBe(true);
  const path = longWavPath(MAX_DURATION_S);
  await pick(page, path);
  await waitDone(page, 240000);
  const f = await fa(page);
  expect(f.doneAt, 'Done was observed').not.toBeNull();
  const during = f.tasks.filter((t) => t.s >= f.pickAt && t.s < f.doneAt!);
  const after = f.tasks.filter((t) => t.s >= f.doneAt!);
  test.info().annotations.push({ type: 'tasks', description: `during analysis: ${during.length} long tasks, max ${Math.max(0, ...during.map((t) => t.d)).toFixed(0)} ms; after Done: ${after.length}, max ${Math.max(0, ...after.map((t) => t.d)).toFixed(0)} ms` });
  const over = during.filter((t) => t.d > 200);
  expect(over, `long tasks over 200 ms between pick and Done: ${JSON.stringify(over)}`).toEqual([]);
});

// ---------------------------------------------------------------- shared F-27 / keyboard fixture

function fixtureBytes(): Uint8Array {
  const sr = 48000;
  const a = tone({ sr, dur: 1.4, f0: 220, vibRate: 5.5, vibCents: 40 });
  const gap = new Float64Array(Math.round(sr * 0.5));
  const b = tone({ sr, dur: 1.2, f0: 330 });
  const lead = new Float64Array(Math.round(sr * 0.4)); // leading silence, so the first voiced frame is not frame 0
  const out = new Float64Array(lead.length + a.length + gap.length + b.length);
  out.set(a, lead.length); out.set(b, lead.length + a.length + gap.length);
  return encodeWav({ sampleRate: sr, format: 'pcm16', channels: [out] });
}
function reference(bytes: Uint8Array) {
  const w = parseWav(bytes);
  return { r: analyseTake(w.samples, w.sampleRate), dur: w.samples.length / w.sampleRate };
}
// Cents are shown whole ("1 cent flat", "0 cents"): the design template says "{n} cents {flat|sharp}", the singular and the zero case are not specified.
const VOICED = /^([\d.]+) seconds\. (.+), ([\d.]+) hertz, (?:\d+ cents? (?:flat|sharp)|0 cents)\.$/;
const UNVOICED = /^([\d.]+) seconds\. No pitch\.$/;

async function openFixture(page: Page) {
  const bytes = fixtureBytes();
  await openFileRoute(page);
  await pick(page, filePath('fixture.wav', bytes));
  await waitDone(page);
  return reference(bytes);
}
const num = async (l: ReturnType<Page['locator']>, a: string) => Number(await l.getAttribute(a));

// ---------------------------------------------------------------- F-27

test('F-27: for every frame, the cursor shows that frame\'s whole-take F0 (voiced) or "No pitch" (unvoiced), nothing else', async ({ page }) => {
  test.setTimeout(120000);
  const { r } = await openFixture(page);
  expect(r.status).toBe('ok');
  const nVoiced = Array.from(r.f0).filter((x) => x > 0).length;
  expect(nVoiced, 'fixture has voiced frames (precondition)').toBeGreaterThan(100);
  expect(r.frameCount - nVoiced, 'fixture has unvoiced frames (precondition)').toBeGreaterThan(20);
  const rows = await page.evaluate(async (n) => {
    const el = document.querySelector('#fa-cursor') as HTMLElement;
    const raf = () => new Promise<void>((res) => requestAnimationFrame(() => res()));
    const key = (k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    const read = () => ({ now: el.getAttribute('aria-valuenow'), text: el.getAttribute('aria-valuetext') ?? '', line: document.querySelector('#fa-cursor-line')!.textContent ?? '' });
    el.focus();
    key('Home'); await raf(); await raf();
    const out = [read()];
    for (let i = 1; i < n; i++) {
      const prev = out[out.length - 1].now;
      key('ArrowRight');
      for (let k = 0; k < 10; k++) { await raf(); if (el.getAttribute('aria-valuenow') !== prev) break; }
      out.push(read());
    }
    return out;
  }, r.frameCount);
  expect(rows.length).toBe(r.frameCount);
  const bad: string[] = [];
  let seenVoiced = 0, seenUnvoiced = 0;
  rows.forEach((row, i) => {
    const f0 = r.f0[i];
    if (f0 > 0) {
      const m = VOICED.exec(row.text);
      if (!m || Math.abs(Number(m[3]) - f0) > 0.06) bad.push(`frame ${i}: want ${f0.toFixed(3)} Hz, got "${row.text}"`);
      else {
        seenVoiced++;
        const lm = /, ([\d.]+) Hz, /.exec(row.line);
        if (!lm || Math.abs(Number(lm[1]) - f0) > 0.06) bad.push(`frame ${i}: cursor line "${row.line}" disagrees with F0 ${f0.toFixed(3)}`);
      }
    } else {
      if (!UNVOICED.test(row.text)) bad.push(`frame ${i}: want No pitch, got "${row.text}"`);
      else {
        seenUnvoiced++;
        if (!/no pitch$/.test(row.line)) bad.push(`frame ${i}: cursor line "${row.line}" should end "no pitch"`);
      }
    }
    if (Math.abs(Number(row.now) - r.t[i]) > 0.011) bad.push(`frame ${i}: aria-valuenow ${row.now} is not frame time ${r.t[i].toFixed(4)}`);
  });
  expect(bad.slice(0, 15), `${bad.length} mismatching frames`).toEqual([]);
  expect(seenVoiced).toBe(nVoiced);
  expect(seenUnvoiced).toBe(r.frameCount - nVoiced);
});

// ---------------------------------------------------------------- Keyboard path (2.2, 6)

test('2.2: #fa-cursor is a slider named "Time cursor" with min, max and now; starts at the first voiced frame', async ({ page }) => {
  const { r, dur } = await openFixture(page);
  const s = page.getByRole('slider', { name: 'Time cursor' });
  await expect(s).toHaveCount(1);
  await expect(s).toHaveAttribute('id', 'fa-cursor');
  await expect(s).toHaveAttribute('tabindex', '0');
  await expect(s).toHaveAttribute('aria-valuemin', '0');
  expect(Math.abs((await num(s, 'aria-valuemax')) - dur)).toBeLessThanOrEqual(0.011);
  const first = Array.from(r.voiced).findIndex((v) => v === 1);
  expect(first, 'precondition: the fixture has a first voiced frame after frame 0').toBeGreaterThan(0);
  expect(Math.abs((await num(s, 'aria-valuenow')) - r.t[first])).toBeLessThanOrEqual(0.011);
  expect(await s.getAttribute('aria-valuetext')).toMatch(VOICED);
});

test('2.2 keys: Left/Right one frame, Shift 1 s, Home/End, Plus/Minus zoom; focus stays on the cursor', async ({ page }) => {
  const { r } = await openFixture(page);
  const s = page.locator('#fa-cursor');
  const dt = r.t[1] - r.t[0];
  const at = () => num(s, 'aria-valuenow');
  await s.focus();
  await page.keyboard.press('Home');
  await expect.poll(at).toBeLessThanOrEqual(r.t[0] + 0.011);
  const t0 = await at();
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Math.abs((await at()) - (t0 + 10 * dt))).toBeLessThanOrEqual(0.011);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => Math.abs((await at()) - (t0 + 9 * dt))).toBeLessThanOrEqual(0.011);
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => Math.abs((await at()) - (t0 + 1))).toBeLessThanOrEqual(0.011);
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(async () => Math.abs((await at()) - t0)).toBeLessThanOrEqual(0.011);
  await page.keyboard.press('End');
  await expect.poll(async () => Math.abs((await at()) - r.t[r.frameCount - 1])).toBeLessThanOrEqual(0.011);
  // Zoom shortcuts duplicate the buttons: the view text changes.
  const view = page.locator('#fa-view');
  const before = await view.textContent();
  await page.keyboard.press('+');
  await expect(view).not.toHaveText(before!);
  const zoomed = await view.textContent();
  await page.keyboard.press('-');
  await expect(view).not.toHaveText(zoomed!);
  expect(await page.evaluate(() => document.activeElement?.id), 'focus stays on the cursor').toBe('fa-cursor');
});

test('2.2 keys: PageUp and PageDown move the cursor one visible span in opposite directions', async ({ page }) => {
  // The design says "PageUp and PageDown move one visible span" and does not say which way each goes
  // (the ARIA slider pattern has Page Up increase). The test therefore accepts either mapping but not none.
  await openFixture(page);
  const s = page.locator('#fa-cursor');
  await s.focus();
  await page.keyboard.press('Home');
  const t0 = await num(s, 'aria-valuenow');
  await page.keyboard.press('PageDown');
  let key = 'PageDown', back = 'PageUp';
  await page.waitForTimeout(150);
  if (Math.abs((await num(s, 'aria-valuenow')) - t0) <= 0.011) {
    await page.keyboard.press('PageUp');
    key = 'PageUp'; back = 'PageDown';
  }
  await expect.poll(() => num(s, 'aria-valuenow'), { message: `${key} (or its pair) moves the cursor forward by about a visible span` }).toBeGreaterThan(t0 + 0.5);
  await page.keyboard.press(back);
  await expect.poll(async () => Math.abs((await num(s, 'aria-valuenow')) - t0), { message: `${back} returns` }).toBeLessThanOrEqual(0.011);
});

test('2.2 pointer: a click sets the cursor to the nearest frame (a value some frame has)', async ({ page }) => {
  const { r } = await openFixture(page);
  const s = page.locator('#fa-cursor');
  await s.scrollIntoViewIfNeeded();
  const box = (await s.boundingBox())!;
  const before = await num(s, 'aria-valuenow');
  const px = box.x + box.width * 0.75, py = box.y + box.height * 0.5;
  const hit = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName}#${e.id}.${(e as HTMLElement).className}` : 'none'; }, [px, py]);
  await page.mouse.click(px, py);
  test.info().annotations.push({ type: 'click-target', description: hit });
  await expect.poll(async () => Math.abs((await num(s, 'aria-valuenow')) - before), { message: `element under the click point: ${hit}` }).toBeGreaterThan(0.2);
  const now = await num(s, 'aria-valuenow');
  expect(Array.from(r.t).some((t) => Math.abs(t - now) <= 0.011), `${now} is a frame time`).toBe(true);
  expect(now, 'right part of the take').toBeGreaterThan(before);
});

test('2.2 wheel input does nothing to the cursor or the view', async ({ page }) => {
  await openFixture(page);
  const s = page.locator('#fa-cursor');
  await s.scrollIntoViewIfNeeded();
  const box = (await s.boundingBox())!;
  const [n0, v0] = [await s.getAttribute('aria-valuenow'), await page.locator('#fa-view').textContent()];
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(300);
  expect(await s.getAttribute('aria-valuenow')).toBe(n0);
  expect(await page.locator('#fa-view').textContent()).toBe(v0);
});

test('6: tab order is open button, A4 controls, view bar buttons, then the time cursor', async ({ page }) => {
  await openFixture(page);
  await page.locator('#fa-open').focus();
  const stops: string[] = [];
  for (let i = 0; i < 40; i++) {
    stops.push(await page.evaluate(() => { const a = document.activeElement as HTMLElement; return a ? `${a.id}|${(a.getAttribute('aria-label') ?? a.textContent ?? '').trim().slice(0, 20)}` : 'none'; }));
    if (stops[stops.length - 1].startsWith('fa-cursor|')) break;
    await page.keyboard.press('Tab');
  }
  const ids = stops.map((x) => x.split('|')[0]);
  const idx = (k: string) => ids.indexOf(k);
  expect(ids, 'reached the time cursor by Tab').toContain('fa-cursor');
  expect(idx('fa-open')).toBe(0);
  expect(idx('fa-a4-dec') > 0 && idx('fa-a4-inc') > idx('fa-a4-dec'), `A4 controls after the open button: ${stops}`).toBe(true);
  expect(idx('fa-cursor') > idx('fa-a4-inc')).toBe(true);
  const names = ['Earlier', 'Later', 'Zoom in', 'Zoom out', 'Whole take'];
  for (const n of names) {
    const i = stops.findIndex((x) => x.split('|')[1] === n);
    expect(i, `view bar button "${n}" is a tab stop: ${stops}`).toBeGreaterThan(-1);
    expect(i > idx('fa-a4-inc') && i < idx('fa-cursor'), `"${n}" sits between A4 and the cursor`).toBe(true);
  }
  // Only one tab stop for all four figures.
  expect(await page.locator('#fa-figs canvas[tabindex="0"], #fa-figs [tabindex="0"]:not(#fa-cursor)').count()).toBe(0);
});

// ---------------------------------------------------------------- F-23

test('F-23 / 3.3: changing A4 updates cents and note names with no new Worker job and no progress', async ({ page }) => {
  test.setTimeout(90000);
  await openFileRoute(page);
  await pick(page, filePath('a4.wav', wavBytes({ dur: 2, f0: 440 })));
  await waitDone(page);
  const dev = async () => {
    const t = ((await page.locator('#fa-d-dev').textContent()) ?? '').replace('−', '-');
    const m = /^([+-]?[\d.]+) c from/.exec(t.trim());
    expect(m, `#fa-d-dev: ${t}`).not.toBeNull();
    return Number(m![1]);
  };
  const before = await dev();
  const f0 = await fa(page);
  expect(f0.workers, 'one Worker job so far (precondition)').toBeGreaterThanOrEqual(1);
  const lineBefore = await page.locator('#fa-cursor-line').textContent();
  const input = page.locator('input#fa-a4, #fa-a4 input').first();
  await input.fill('442');
  await input.dispatchEvent('change');
  await input.press('Enter');
  await expect.poll(async () => Math.abs((await dev()) - (before - 7.85)), { timeout: 5000 }).toBeLessThanOrEqual(0.12);
  await expect(page.locator('#fa-cursor-line')).not.toHaveText(lineBefore!);
  await expect(page.locator('#fa-status')).toHaveText(/^Reference A4 = 442(\.0)? Hz\. Cents and note names updated\.$/);
  const f1 = await fa(page);
  expect(f1.workers, 'no new Worker constructed').toBe(f0.workers);
  expect(f1.posts, 'nothing posted to any Worker').toBe(f0.posts);
  expect(f1.msgs, 'no Worker replied').toBe(f0.msgs);
  expect(f1.hist.slice(f0.hist.length).some((h) => h.progressVisible), 'no progress block after the change').toBe(false);
  await expect(page.locator('#fa-progress')).toBeHidden();
});

// ---------------------------------------------------------------- Motion (7)

for (const mode of ['reduce', 'no-preference'] as const) {
  test(`7: no transitions or animations on the figures (reducedMotion=${mode}), zoom is instant`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: mode });
    await openFixture(page);
    const scan = () => page.evaluate(() => {
      const out: string[] = [];
      // The figures themselves: canvases, the four figure boxes, the overview, the cursor and everything inside them.
      // (View bar buttons and disclosure summaries are ordinary controls with their own hover transitions.)
      const roots = document.querySelectorAll('#fa-figs canvas, #fa-fig-pitch, #fa-fig-cents, #fa-fig-vib, #fa-fig-spec, #fa-overview, #fa-cursor');
      const set = new Set<Element>();
      roots.forEach((r) => { set.add(r); r.querySelectorAll('*').forEach((c) => set.add(c)); });
      for (const el of set) {
        const cs = getComputedStyle(el);
        const ms = (v: string) => v.split(',').map((x) => (x.trim().endsWith('ms') ? parseFloat(x) : parseFloat(x) * 1000));
        if (ms(cs.transitionDuration).some((x) => x > 0) || (cs.animationName !== 'none' && ms(cs.animationDuration).some((x) => x > 0)))
          out.push(`${el.tagName}#${el.id}.${(el as HTMLElement).className}: transition ${cs.transitionProperty} ${cs.transitionDuration}; animation ${cs.animationName} ${cs.animationDuration}`);
      }
      return out;
    });
    expect(await scan(), 'figures, canvases and the cursor never animate').toEqual([]);
    const view = page.locator('#fa-view');
    const before = await view.textContent();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    // Instant: the new span is in the DOM at once, with no tween (checked within a single frame budget).
    await expect(view).not.toHaveText(before!, { timeout: 250 });
    expect(await scan()).toEqual([]);
  });
}
