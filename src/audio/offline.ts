// Offline render of one synthetic fixture through the same AudioWorklet the live path uses (DESIGN.md 3.4
// Self-test). Copied from renderFixture in src/testpage/main.ts, which stays for #/legacy; keep the two in step
// until #/legacy is removed. The only change: a missing file is reported as FixtureMissingError, because the
// dev server answers a missing path with index.html (200, text/html) rather than a 404.

import { loadTracker, makeTrackerNode } from './capture.ts';
import type { WorkletFrame } from './tracker.worklet.ts';

/** One row of fixtures/synthetic/manifest.json (written by py/synth.py). */
export interface FixtureEntry {
  id: string; set: string; file: string; sr: number; dur: number; f0: number; rate: number; extent: number; onset_sample?: number;
}

export const FIXTURE_BASE = '/fixtures/synthetic/';

/** The fixture files are not where the dev server serves them. */
export class FixtureMissingError extends Error {
  constructor(what: string) { super(`Not found: ${FIXTURE_BASE}${what}`); this.name = 'FixtureMissingError'; }
}

async function fetchFixture(path: string, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try { res = await fetch(`${FIXTURE_BASE}${path}`, { signal }); } catch (e) {
    if (signal?.aborted) throw e; // a cancel, not a missing file
    throw new FixtureMissingError(path);
  }
  if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) throw new FixtureMissingError(path);
  return res;
}

export async function loadManifest(signal?: AbortSignal): Promise<FixtureEntry[]> {
  const res = await fetchFixture('manifest.json', signal);
  let man: { entries?: unknown };
  try { man = await res.json(); } catch { throw new FixtureMissingError('manifest.json'); }
  if (!Array.isArray(man.entries)) throw new FixtureMissingError('manifest.json');
  return man.entries as FixtureEntry[];
}

export async function renderFixture(e: FixtureEntry, signal?: AbortSignal): Promise<WorkletFrame[]> {
  const buf = await (await fetchFixture(e.file, signal)).arrayBuffer();
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
