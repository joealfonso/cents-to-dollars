// Test-only harness for the M2.1 browser criteria (specs/M2.md 4.6: F-04, F-08, F-09, F-11, F-16, F-20).
// Loads src/file/client.ts (analyseFile, specs/M2.1-API.md) and exposes window.takeHarness so Playwright can drive it
// without any UI. The shape analyseFile resolves to is not fixed by the API note, so results are read defensively:
// the TakeResult is the object that has typed-array `f0`, and the decode facts (rateSource, nativeRate, channels,
// durationS, sampleRate) are looked up on the result and one level below it.

type Json = Record<string, unknown>;

interface JobRecord {
  id: string;
  controller: AbortController;
  progress: number[];
  progressAfterAbort: number;
  aborted: boolean;
  settled: 'pending' | 'fulfilled' | 'rejected';
  summary: Json | null;
  error: Json | null;
  done: Promise<void>;
}

const jobs = new Map<string, JobRecord>();

function bytesFromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function isTyped(v: unknown): v is ArrayLike<number> {
  return ArrayBuffer.isView(v) && !(v instanceof DataView);
}

function findTake(res: any): any {
  const cands = [res, res?.result, res?.take, res?.analysis, res?.data];
  for (const c of cands) if (c && isTyped(c.f0)) return c;
  for (const v of Object.values(res ?? {})) if (v && typeof v === 'object' && isTyped((v as any).f0)) return v;
  return null;
}

function lookup(res: any, key: string): unknown {
  const levels = [res, res?.result, res?.decoded, res?.decode, res?.meta, res?.info, res?.file, res?.take];
  for (const l of levels) if (l && typeof l === 'object' && key in l && (l as any)[key] !== undefined) return (l as any)[key];
  for (const v of Object.values(res ?? {})) if (v && typeof v === 'object' && !isTyped(v) && key in (v as object)) return (v as any)[key];
  return undefined;
}

function summarise(res: any): Json {
  const take = findTake(res);
  const s: Json = {
    shapeKeys: Object.keys(res ?? {}),
    foundTake: !!take,
    rateSource: lookup(res, 'rateSource') ?? null,
    nativeRate: lookup(res, 'nativeRate') ?? null,
    channels: lookup(res, 'channels') ?? null,
    durationS: lookup(res, 'durationS') ?? null,
    sampleRate: lookup(res, 'sampleRate') ?? null,
  };
  if (take) {
    s.status = take.status;
    s.frameCount = take.frameCount;
    s.hop = take.hop;
    s.start = Array.from(take.start as ArrayLike<number>);
    s.voiced = Array.from(take.voiced as ArrayLike<number>);
    s.f0 = Array.from(take.f0 as ArrayLike<number>);
    s.t = Array.from(take.t as ArrayLike<number>);
    s.takeSampleRate = take.sampleRate;
  }
  return s;
}

function describeError(e: unknown): Json {
  const x = e as any;
  return { name: x?.name ?? null, code: x?.code ?? null, message: String(x?.message ?? e) };
}

function start(id: string, b64: string, name: string, type: string, given?: File): JobRecord {
  const file = given ?? new File([bytesFromB64(b64) as BlobPart], name, { type });
  const controller = new AbortController();
  const rec: JobRecord = {
    id, controller, progress: [], progressAfterAbort: 0, aborted: false, settled: 'pending', summary: null, error: null,
    done: Promise.resolve(),
  };
  rec.done = (async () => {
    try {
      const { analyseFile } = await import('../../../src/file/client.ts');
      const res = await analyseFile(file, {
        signal: controller.signal,
        onProgress: (f: number) => {
          rec.progress.push(f);
          if (rec.aborted) rec.progressAfterAbort++;
        },
      } as any);
      rec.summary = summarise(res);
      rec.settled = 'fulfilled';
    } catch (e) {
      rec.error = describeError(e);
      rec.settled = 'rejected';
    }
  })();
  jobs.set(id, rec);
  return rec;
}

const api = {
  /** Start a job and return immediately. */
  startJob(id: string, b64: string, name: string, type = ''): void { start(id, b64, name, type); },
  abortJob(id: string): void {
    const j = jobs.get(id)!;
    j.aborted = true;
    j.controller.abort();
  },
  /** Wait until the job settles or `timeoutMs` passes, then report its state. */
  async waitJob(id: string, timeoutMs = 30000): Promise<Json> {
    const j = jobs.get(id)!;
    await Promise.race([j.done, new Promise((r) => setTimeout(r, timeoutMs))]);
    return api.jobState(id);
  },
  jobState(id: string): Json {
    const j = jobs.get(id)!;
    return {
      settled: j.settled, summary: j.summary, error: j.error, progress: j.progress.slice(), progressAfterAbort: j.progressAfterAbort,
    };
  },
  /** A zero-filled File of exactly `size` bytes (built from shared 1 MiB blobs, so it is cheap), analysed like any other. */
  async runSized(size: number, name: string, type = '', timeoutMs = 60000): Promise<Json> {
    const mib = new Blob([new Uint8Array(1 << 20)]);
    const parts: BlobPart[] = Array(Math.floor(size / (1 << 20))).fill(mib);
    parts.push(new Uint8Array(size % (1 << 20)));
    const file = new File(parts, name, { type });
    const id = `sized-${Math.random().toString(36).slice(2)}`;
    const rec = start(id, '', name, type, file);
    await Promise.race([rec.done, new Promise((r) => setTimeout(r, timeoutMs))]);
    return api.jobState(id);
  },
  /** Start, wait, and report in one call. */
  async run(b64: string, name: string, type = '', timeoutMs = 60000): Promise<Json> {
    const id = `run-${Math.random().toString(36).slice(2)}`;
    api.startJob(id, b64, name, type);
    return api.waitJob(id, timeoutMs);
  },
};

(window as unknown as { takeHarness: typeof api }).takeHarness = api;
(window as unknown as { takeHarnessReady: boolean }).takeHarnessReady = true;
