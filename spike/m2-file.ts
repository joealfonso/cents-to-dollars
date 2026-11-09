// M2.1 spike page (specs/M2.md 4.5). Not app code. Driven by tools/spike_m2_run.ts.
// Decode path for the spike: File.arrayBuffer() then decodeAudioData on an OfflineAudioContext
// created at 48000 Hz (the spec's WAV header parser is not built yet). Channel data goes to the
// Worker as transferables; if Chrome refuses to transfer an AudioBuffer's own channel arrays, each
// channel is copied once with copyFromChannel and the copy is transferred. The mode used is reported.

const SR = 48000;

interface WorkerDone {
  kind: 'done'; samples: number; channels: number; frames: number; decoded: number; voiced: number; f0Sum: number;
  mixMs: number; runMs: number; decodeAllMs: number; analysisMs: number;
}

const worker = new Worker(new URL('./m2-file.worker.ts', import.meta.url), { type: 'module' });
let ready = false;
let pending: ((m: unknown) => void) | null = null;
worker.onmessage = (e: MessageEvent) => {
  const m = e.data as { kind: string };
  if (m.kind === 'ready') { ready = true; return; }
  const p = pending; pending = null;
  p?.(m);
};
function ask(msg: unknown): Promise<unknown> {
  return new Promise((resolve) => { pending = resolve; worker.postMessage(msg); });
}

// postMessage with a non-transferable buffer throws synchronously, so the fallback is detected and reported.
async function runWithFallback(): Promise<unknown> {
  const input = document.getElementById('file') as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) throw new Error('no file selected');
  const tStart = performance.now();
  const bytes = await file.arrayBuffer();
  const tRead = performance.now();
  const ctx = new OfflineAudioContext(1, 1, SR);
  let buf: AudioBuffer | null = await ctx.decodeAudioData(bytes);
  const tDecoded = performance.now();
  const info = { decodedRate: buf.sampleRate, decodedChannels: buf.numberOfChannels, decodedLength: buf.length };
  let chans: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
  let transferMode = 'transferred AudioBuffer.getChannelData buffers (no copy)';
  const msg = { kind: 'analyse', sampleRate: buf.sampleRate, channels: chans };
  const done = new Promise<unknown>((resolve) => { pending = resolve; });
  const tPost = performance.now();
  try {
    worker.postMessage(msg, chans.map((x) => x.buffer));
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
  const reply = (await done) as WorkerDone | { kind: 'error'; message: string };
  const tDone = performance.now();
  if (reply.kind === 'error') throw new Error(`worker: ${reply.message}`);
  return {
    fileName: file.name, fileBytes: file.size, ...info, transferMode,
    readMs: tRead - tStart, decodeMs: tDecoded - tRead, postMs: tPosted - tPost,
    endToEndMs: tDone - tStart, worker: reply,
  };
}
async function release(): Promise<unknown> {
  return ask({ kind: 'release' });
}

const w = window as unknown as Record<string, unknown>;
w.__spikeRun = runWithFallback;
w.__spikeRelease = release;
w.__spikeReady = () => ready;
