// M2.1 spike page (specs/M2.md 4.5). Not app code. Driven by tools/spike_m2_run.ts.
// Decode path for the spike: File.arrayBuffer() then decodeAudioData on an OfflineAudioContext
// created at 48000 Hz (the spec's WAV header parser is not built yet). Channel data goes to the
// Worker as transferables; if Chrome refuses to transfer an AudioBuffer's own channel arrays, each
// channel is copied once with copyFromChannel and the copy is transferred. The mode used is reported.
// The file ArrayBuffer and the AudioBuffer are dropped once the channels are posted. The Worker's
// result arrives by structured clone and is held here (as a result screen would) until release().

const SR = 48000;

interface Stats {
  samples: number; frames: number; decoded: number; voiced: number; f0Sum: number; binsPerColumn: number;
  mixMs: number; runMs: number; decodeAllMs: number; analysisMs: number; spectrumColumnsMs: number; postCloneMs: number;
}
type Msg = { kind: 'ready' } | { kind: 'result'; result: unknown } | { kind: 'stats'; stats: Stats } | { kind: 'error'; message: string };

const worker = new Worker(new URL('./m2-file.worker.ts', import.meta.url), { type: 'module' });
let ready = false;
let held: unknown = null;
const waiting = new Map<string, (m: Msg) => void>();
let fail: ((e: Error) => void) | null = null;
worker.onmessage = (e: MessageEvent) => {
  const m = e.data as Msg;
  if (m.kind === 'ready') { ready = true; return; }
  if (m.kind === 'error') { fail?.(new Error(`worker: ${m.message}`)); return; }
  waiting.get(m.kind)?.(m);
};
worker.onerror = (e: ErrorEvent) => { e.preventDefault(); fail?.(new Error(`worker onerror: ${e.message || 'unknown (possibly out of memory)'}`)); };
worker.onmessageerror = () => fail?.(new Error('worker messageerror: result could not be deserialized'));

async function runWithFallback(): Promise<unknown> {
  const input = document.getElementById('file') as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) throw new Error('no file selected');
  const failed = new Promise<never>((_, reject) => { fail = reject; });
  const gotResult = new Promise<Msg>((resolve) => waiting.set('result', resolve));
  const gotStats = new Promise<Msg>((resolve) => waiting.set('stats', resolve));
  const tStart = performance.now();
  let bytes: ArrayBuffer | null = await file.arrayBuffer();
  const tRead = performance.now();
  const ctx = new OfflineAudioContext(1, 1, SR);
  let buf: AudioBuffer | null = await ctx.decodeAudioData(bytes);
  bytes = null; // decodeAudioData detaches it; drop the reference too
  const tDecoded = performance.now();
  const info = { decodedRate: buf.sampleRate, decodedChannels: buf.numberOfChannels, decodedLength: buf.length };
  let chans: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
  let transferMode = 'transferred AudioBuffer.getChannelData buffers (no copy)';
  const tPost = performance.now();
  try {
    worker.postMessage({ kind: 'analyse', sampleRate: buf.sampleRate, channels: chans }, chans.map((x) => x.buffer));
  } catch {
    transferMode = 'copied each channel with copyFromChannel, then transferred the copies';
    chans = [];
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const x = new Float32Array(buf.length);
      buf.copyFromChannel(x, c);
      chans.push(x);
    }
    worker.postMessage({ kind: 'analyse', sampleRate: buf.sampleRate, channels: chans }, chans.map((x) => x.buffer));
  }
  buf = null; // drop the AudioBuffer so it can be collected
  chans = [];
  const tPosted = performance.now();
  const r = (await Promise.race([gotResult, failed])) as { kind: 'result'; result: unknown };
  const tResult = performance.now();
  held = r.result;
  const s = ((await Promise.race([gotStats, failed])) as { kind: 'stats'; stats: Stats }).stats;
  waiting.clear();
  fail = null;
  return {
    fileName: file.name, fileBytes: file.size, ...info, transferMode,
    readMs: tRead - tStart, decodeMs: tDecoded - tRead, postMs: tPosted - tPost,
    endToEndMs: tResult - tStart, holding: held !== null, worker: s,
  };
}

function release(): boolean {
  held = null;
  return true;
}

const w = window as unknown as Record<string, unknown>;
w.__spikeRun = runWithFallback;
w.__spikeRelease = release;
w.__spikeReady = () => ready;
