// M2.1 browser criteria about jobs and side effects, driven through src/file/client.ts via the harness page:
//   F-16  a second job's results never surface for the first
//   F-20  from pick to Done: no fetch, XHR, sendBeacon or WebSocket send, and no localStorage, sessionStorage or IndexedDB write
import { test, expect, type Page } from '@playwright/test';
import { tone, encodeWav, b64 } from '../take.helpers.ts';
import { HARNESS_URL, runFile, medianVoicedF0, type JobState } from './take.util.ts';

async function open(page: Page) {
  await page.goto(HARNESS_URL);
  await page.waitForFunction(() => (window as any).takeHarnessReady === true, null, { timeout: 15000 });
}

const wavOf = (sr: number, dur: number, f0: number) => encodeWav({ sampleRate: sr, format: 'pcm16', channels: [tone({ sr, dur, f0 })] });
const state = (page: Page, id: string) => page.evaluate((i) => (window as any).takeHarness.jobState(i), id) as Promise<JobState>;
const wait = (page: Page, id: string, ms: number) => page.evaluate(([i, t]) => (window as any).takeHarness.waitJob(i, t), [id, ms] as const) as Promise<JobState>;
const startJob = (page: Page, id: string, bytes: Uint8Array, name: string) =>
  page.evaluate(([i, d, n]) => (window as any).takeHarness.startJob(i, d, n, 'audio/wav'), [id, b64(bytes), name] as const);

// ---------------------------------------------------------------- F-16

test('F-16: pick B while A is analysing and cancel A: A never delivers a result or progress after the cancel; B gets only its own', async ({ page }) => {
  await open(page);
  await startJob(page, 'A', wavOf(48000, 45, 220), 'a.wav');
  // Wait until A is genuinely mid-analysis (some progress, not settled).
  await expect.poll(async () => (await state(page, 'A')).progress.length, { timeout: 20000 }).toBeGreaterThan(0);
  const before = await state(page, 'A');
  expect(before.settled, 'precondition: A is still analysing when B is picked (make A longer if this fails)').toBe('pending');
  await page.evaluate(() => (window as any).takeHarness.abortJob('A'));
  const atAbort = await state(page, 'A');
  await startJob(page, 'B', wavOf(48000, 2, 440), 'b.wav');
  const b = await wait(page, 'B', 30000);
  expect(b.error, JSON.stringify(b.error)).toBeNull();
  expect(b.settled).toBe('fulfilled');
  expect(Math.abs(1200 * Math.log2(medianVoicedF0(b.summary!.f0!, b.summary!.voiced!) / 440))).toBeLessThan(5);
  const a = await wait(page, 'A', 3000);
  expect(a.settled, 'a cancelled job must not resolve with a result').not.toBe('fulfilled');
  expect(a.summary, 'no result for A').toBeNull();
  expect(a.progress.length, 'A got no progress after it was cancelled').toBe(atAbort.progress.length);
  expect(a.progressAfterAbort).toBe(0);
});

test('F-16: two jobs running at once never swap results (A never receives B\'s frames, and the reverse)', async ({ page }) => {
  await open(page);
  const aBytes = wavOf(48000, 20, 220);
  await startJob(page, 'A', aBytes, 'a.wav');
  await startJob(page, 'B', wavOf(48000, 2, 440), 'b.wav');
  const b = await wait(page, 'B', 40000);
  const a = await wait(page, 'A', 40000);
  expect(b.settled, `B: ${JSON.stringify(b.error)}`).toBe('fulfilled');
  expect(Math.abs(1200 * Math.log2(medianVoicedF0(b.summary!.f0!, b.summary!.voiced!) / 440)), 'B reads 440 Hz').toBeLessThan(5);
  expect(b.summary!.frameCount, 'B has its own 2 s of frames').toBeLessThan(400);
  // A may be superseded (rejected) by B or finish on its own, but if it resolves it must be A's data, never B's.
  if (a.settled === 'fulfilled') {
    expect(Math.abs(1200 * Math.log2(medianVoicedF0(a.summary!.f0!, a.summary!.voiced!) / 220)), 'A reads 220 Hz').toBeLessThan(5);
    expect(a.summary!.frameCount, 'A has its own 20 s of frames').toBeGreaterThan(3000);
  } else {
    expect(a.summary).toBeNull();
  }
});

// ---------------------------------------------------------------- F-20

const MONITOR = () => {
  const mon: any = { armed: false, fetch: [] as string[], xhr: [] as string[], beacon: [] as string[], ws: [] as string[], storage: [] as string[], idb: [] as string[] };
  (window as any).__mon = mon;
  const note = (k: string, v: string) => { if (mon.armed) mon[k].push(v); };
  const f = window.fetch.bind(window);
  window.fetch = (...a: Parameters<typeof fetch>) => { note('fetch', String(a[0])); return f(...a); };
  const xs = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...a: any[]) { note('xhr', 'send'); return xs.apply(this, a as any); };
  const bc = navigator.sendBeacon?.bind(navigator);
  navigator.sendBeacon = (...a: Parameters<typeof navigator.sendBeacon>) => { note('beacon', String(a[0])); return bc ? bc(...a) : false; };
  const ws = WebSocket.prototype.send;
  WebSocket.prototype.send = function (this: WebSocket, ...a: any[]) { note('ws', 'send'); return ws.apply(this, a as any); };
  for (const m of ['setItem', 'removeItem', 'clear'] as const) {
    const orig = Storage.prototype[m] as (...x: any[]) => void;
    (Storage.prototype as any)[m] = function (this: Storage, ...a: any[]) { note('storage', `${m}:${a[0] ?? ''}`); return orig.apply(this, a); };
  }
  for (const m of ['open', 'deleteDatabase'] as const) {
    const orig = IDBFactory.prototype[m] as (...x: any[]) => any;
    (IDBFactory.prototype as any)[m] = function (this: IDBFactory, ...a: any[]) { note('idb', `${m}:${a[0] ?? ''}`); return orig.apply(this, a); };
  }
};

const NET_TYPES = new Set(['fetch', 'xhr', 'websocket', 'eventsource', 'ping']);

async function snapshot(page: Page) {
  return page.evaluate(async () => ({
    local: JSON.stringify(Object.entries(localStorage).sort()),
    session: JSON.stringify(Object.entries(sessionStorage).sort()),
    idb: JSON.stringify(((await indexedDB.databases?.()) ?? []).map((d) => d.name).sort()),
  }));
}

test('F-20 control: the monitor really sees fetch, XHR, sendBeacon, storage and IndexedDB use (so the real test can fail)', async ({ page }) => {
  await page.addInitScript(MONITOR);
  const requests: string[] = [];
  page.on('request', (r) => { if (NET_TYPES.has(r.resourceType())) requests.push(`${r.resourceType()} ${r.url()}`); });
  await open(page);
  await page.evaluate(async () => {
    (window as any).__mon.armed = true;
    await fetch('/');
    const x = new XMLHttpRequest(); x.open('GET', '/'); x.send();
    navigator.sendBeacon('/beacon', 'x');
    localStorage.setItem('probe', '1'); sessionStorage.setItem('probe', '1');
    indexedDB.open('probe-db');
    await new Promise((r) => setTimeout(r, 300));
  });
  const mon = await page.evaluate(() => (window as any).__mon);
  expect(mon.fetch.length).toBeGreaterThan(0);
  expect(mon.xhr.length).toBeGreaterThan(0);
  expect(mon.beacon.length).toBeGreaterThan(0);
  expect(mon.storage.length).toBe(2);
  expect(mon.idb.length).toBe(1);
  expect(requests.some((r) => r.startsWith('fetch'))).toBe(true);
  expect(requests.some((r) => r.startsWith('xhr'))).toBe(true);
  expect((await snapshot(page)).local).toContain('probe');
});

test('F-20: analysing a file makes no network send and no storage write', async ({ page }) => {
  await page.addInitScript(MONITOR);
  const requests: string[] = [];
  const wsFrames: string[] = [];
  let armed = false;
  page.on('request', (r) => { if (armed && NET_TYPES.has(r.resourceType())) requests.push(`${r.resourceType()} ${r.method()} ${r.url()}`); });
  page.on('websocket', (ws) => { ws.on('framesent', () => { if (armed) wsFrames.push(ws.url()); }); });
  await open(page);
  const bytes = encodeWav({ sampleRate: 48000, format: 'pcm16', channels: [tone({ sr: 48000, dur: 3, f0: 220, vibRate: 5.5, vibCents: 50 })] });
  const before = await snapshot(page);
  await page.evaluate(() => { (window as any).__mon.armed = true; });
  armed = true;
  const got = await runFile(page, bytes, 'take.wav', 'audio/wav');
  expect(got.error, JSON.stringify(got.error)).toBeNull();
  expect(got.settled).toBe('fulfilled');
  expect(got.summary!.status).toBe('ok');
  await page.waitForTimeout(500); // late sends would show up here
  armed = false;
  const mon = await page.evaluate(() => (window as any).__mon);
  const after = await snapshot(page);
  expect(mon.fetch, 'fetch calls on the page').toEqual([]);
  expect(mon.xhr, 'XHR sends').toEqual([]);
  expect(mon.beacon, 'sendBeacon calls').toEqual([]);
  expect(mon.ws, 'WebSocket sends on the page').toEqual([]);
  expect(wsFrames, 'WebSocket frames sent').toEqual([]);
  expect(requests, 'fetch/XHR/ping/websocket requests seen by the browser (page and Worker)').toEqual([]);
  expect(mon.storage, 'Storage writes').toEqual([]);
  expect(mon.idb, 'IndexedDB open/delete calls').toEqual([]);
  expect(after, 'storage contents unchanged').toEqual(before);
});
