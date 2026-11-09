// Shared helpers for tests/browser/file.*.spec.ts (Recording analysis screen, #/file).
// Written from design/M2-DESIGN.md (sections 1.6, 2, 3, 6, 7, 8) and specs/M2.md 4.6, not from the view code.
// Only element IDs from design section 8 are used. Not a spec file (no .spec.ts suffix).
import type { Page, Locator } from '@playwright/test';
import { mkdtempSync, writeFileSync, openSync, ftruncateSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tone, encodeWav } from '../take.helpers.ts';

export const FILE_ROUTE = '/#/file';
export const FOOTER_LINE = 'For practice and study. Not a diagnostic or medical device.';

const scratch = mkdtempSync(join(tmpdir(), 'file-spec-'));
export const scratchDir = scratch;

// ---------------------------------------------------------------- generated files

export function wavBytes(opts: { sr?: number; dur: number; f0?: number; channels?: 1 | 2; vibRate?: number; vibCents?: number }): Uint8Array {
  const sr = opts.sr ?? 48000;
  const a = tone({ sr, dur: opts.dur, f0: opts.f0 ?? 220, vibRate: opts.vibRate, vibCents: opts.vibCents });
  const chans = opts.channels === 2 ? [a, a] : [a];
  return encodeWav({ sampleRate: sr, format: 'pcm16', channels: chans });
}

/** Mono 16-bit PCM WAV header (44 bytes). */
function header(sr: number, samples: number): Buffer {
  const h = Buffer.alloc(44);
  const dataBytes = samples * 2;
  h.write('RIFF', 0); h.writeUInt32LE(36 + dataBytes, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(dataBytes, 40);
  return h;
}

const cache = new Map<string, string>();

/** A long mono 16-bit WAV with a steady 3-harmonic tone, written to disk (fast, small). Returns its path. */
export function longWavPath(seconds: number, sr = 48000, f0 = 220): string {
  const key = `${seconds}-${sr}-${f0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const n = Math.round(seconds * sr);
  const data = Buffer.alloc(n * 2);
  let p = 0;
  const w = (2 * Math.PI * f0) / sr;
  for (let i = 0; i < n; i++) {
    p += w;
    const v = ((Math.sin(p) + 0.5 * Math.sin(2 * p) + 0.25 * Math.sin(3 * p)) / 1.75) * 0.5;
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const path = join(scratch, `long-${key}.wav`);
  writeFileSync(path, Buffer.concat([header(sr, n), data]));
  cache.set(key, path);
  return path;
}

/** Digital silence of the given length, 48 kHz mono 16-bit, written to disk. */
export function silentWavPath(seconds: number, sr = 48000): string {
  const key = `silent-${seconds}-${sr}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const n = Math.round(seconds * sr);
  const path = join(scratch, `${key}.wav`);
  writeFileSync(path, Buffer.concat([header(sr, n), Buffer.alloc(n * 2)]));
  cache.set(key, path);
  return path;
}

/** A sparse file of exactly `bytes` bytes (zeros). Never read by a correct app when it is over the limit. */
export function sparseFilePath(bytes: number, name: string): string {
  const path = join(scratch, name);
  const fd = openSync(path, 'w');
  ftruncateSync(fd, bytes);
  closeSync(fd);
  return path;
}

export function filePath(name: string, bytes: Uint8Array | Buffer): string {
  const path = join(scratch, name);
  writeFileSync(path, bytes);
  return path;
}

// ---------------------------------------------------------------- page instrumentation

/**
 * Init script. Records, into window.__fa:
 *   hist     every distinct snapshot of #fa-progress / #fa-status (text, aria-valuetext, visibility, done flag)
 *   workers  Worker constructions;  posts  Worker.postMessage calls;  msgs  messages received from any Worker
 *   tasks    long tasks (start, duration);  doneAt  time of the first snapshot whose status starts with "Done."
 *   decodes  OfflineAudioContext constructions and decodeAudioData calls
 */
export const INSTRUMENT = () => {
  const H: any = ((window as any).__fa = { hist: [], workers: 0, posts: 0, msgs: 0, tasks: [], doneAt: null, pickAt: 0, decodes: 0 });
  let last = '';
  const snap = () => {
    const q = (s: string) => document.querySelector(s) as HTMLElement | null;
    // Design 2.3: the progress block holds the text line, the progressbar and Cancel. Section 8 names it #fa-progress,
    // but #fa-progress may be the progressbar itself. Either way the block is the smallest ancestor of the bar that
    // also contains #fa-cancel; its text is the Decoding / Analysing line.
    const p0 = q('#fa-progress');
    const bar = (p0?.getAttribute('role') === 'progressbar' ? p0 : p0?.querySelector('[role="progressbar"]')) as HTMLElement | null;
    const cancel = q('#fa-cancel');
    let prog: HTMLElement | null = bar ?? p0;
    while (prog && cancel && !prog.contains(cancel) && prog.parentElement) prog = prog.parentElement;
    if (prog && cancel && !prog.contains(cancel)) prog = bar ?? p0;
    const st = (q('#fa-status')?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const e = {
      progress: prog ? (prog.textContent ?? '').replace(/\s+/g, ' ').trim() : null,
      progressVisible: !!prog && !prog.hidden && prog.getClientRects().length > 0 && getComputedStyle(prog).visibility !== 'hidden',
      valuetext: bar?.getAttribute('aria-valuetext') ?? null,
      valuenow: bar?.getAttribute('aria-valuenow') ?? null,
      status: st,
      done: /^Done\./.test(st),
    };
    const k = JSON.stringify(e);
    if (k === last) return;
    last = k;
    const t = performance.now();
    H.hist.push({ ...e, t });
    if (e.done && H.doneAt === null) H.doneAt = t;
  };
  new MutationObserver(snap).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  const W = window.Worker;
  (window as any).Worker = class extends W {
    constructor(...a: ConstructorParameters<typeof Worker>) {
      super(...a);
      H.workers++;
      this.addEventListener('message', () => { H.msgs++; });
    }
    postMessage(...a: any[]) { H.posts++; return (super.postMessage as any)(...a); }
  };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) H.tasks.push({ s: e.startTime, d: e.duration }); }).observe({ type: 'longtask', buffered: true });
  } catch { /* longtask unsupported: the F-19 test asserts it is supported */ }
  const oac = (window as any).OfflineAudioContext;
  if (oac) {
    (window as any).OfflineAudioContext = class extends oac { constructor(...a: any[]) { super(...a); H.decodes++; } };
  }
  const dad = (window as any).BaseAudioContext?.prototype?.decodeAudioData;
  if (dad) (window as any).BaseAudioContext.prototype.decodeAudioData = function (...a: any[]) { H.decodes++; return dad.apply(this, a); };
};

export interface Hist {
  progress: string | null; progressVisible: boolean; valuetext: string | null; valuenow: string | null; status: string; done: boolean; t: number;
}
export const fa = (page: Page) => page.evaluate(() => (window as any).__fa) as Promise<{
  hist: Hist[]; workers: number; posts: number; msgs: number; tasks: { s: number; d: number }[]; doneAt: number | null; pickAt: number; decodes: number;
}>;

export async function openFileRoute(page: Page, instrument = true): Promise<void> {
  if (instrument) await page.addInitScript(INSTRUMENT);
  await page.goto(FILE_ROUTE);
  await page.locator('#fa-open').waitFor({ state: 'visible', timeout: 15000 });
}

export async function pick(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  await page.evaluate(() => { const f = (window as any).__fa; if (f) f.pickAt = performance.now(); });
  await page.locator('#fa-input').setInputFiles(file as any);
}

export const status = (page: Page): Locator => page.locator('#fa-status');
export async function waitDone(page: Page, timeout = 60000): Promise<void> {
  await page.locator('#fa-status').filter({ hasText: /^\s*Done\./ }).waitFor({ state: 'attached', timeout });
}

/** Dispatch real DragEvents carrying files at an element. Returns defaultPrevented per event type. */
export async function dropFiles(
  page: Page,
  target: string,
  files: { name: string; b64: string; type?: string }[],
  types: string[] = ['dragenter', 'dragover', 'drop'],
): Promise<Record<string, boolean>> {
  return page.evaluate(([sel, fs, ts]) => {
    const el = (sel === 'h1:visible' ? [...document.querySelectorAll('h1')].find((e) => e.getClientRects().length > 0) : document.querySelector(sel as string)) as HTMLElement;
    const dt = new DataTransfer();
    for (const f of fs as any[]) {
      const bin = atob(f.b64); const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      dt.items.add(new File([u], f.name, { type: f.type ?? '' }));
    }
    const out: Record<string, boolean> = {};
    for (const t of ts as string[]) {
      const ev = new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt });
      el.dispatchEvent(ev);
      out[t] = ev.defaultPrevented;
    }
    return out;
  }, [target, files, types] as const);
}

export const toB64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

/** "1:05.25" or "0:03.00" style or plain seconds to seconds. Returns NaN if it is neither. */
export function parseClock(s: string): number {
  const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(s.trim());
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return /^\d+(\.\d+)?$/.test(s.trim()) ? Number(s) : NaN;
}
