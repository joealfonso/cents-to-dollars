// Web Audio capture: microphone (processing off) into the pitch-tracker AudioWorklet.

import workletUrl from './tracker.worklet.ts?worker&url';
import type { WorkletMessage, WorkletFrame } from './tracker.worklet.ts';

export interface TrackerHandlers {
  /** Every frame, right after analysis: plain YIN F0, voicing, levels, spectrum. */
  onFrame?: (f: WorkletFrame) => void;
}

export async function loadTracker(ctx: BaseAudioContext): Promise<void> {
  await ctx.audioWorklet.addModule(workletUrl);
}

export function makeTrackerNode(ctx: BaseAudioContext, h: TrackerHandlers): AudioWorkletNode {
  const node = new AudioWorkletNode(ctx, 'pitch-tracker', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  node.port.onmessage = (e: MessageEvent<WorkletMessage>) => {
    if (e.data?.type === 'frame') h.onFrame?.(e.data);
  };
  return node;
}

export interface LiveSession {
  ctx: AudioContext;
  stream: MediaStream;
  node: AudioWorkletNode;
  /** Releases the mic and closes the context. */
  stop: () => Promise<void>;
}

export async function startLive(h: TrackerHandlers): Promise<LiveSession> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  // Anything that fails after getUserMedia must release the mic and the context before rethrowing,
  // or the browser's mic indicator stays on and every retry leaks another stream.
  let made: AudioContext | null = null;
  try {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    made = ctx;
    await loadTracker(ctx);
    const src = ctx.createMediaStreamSource(stream);
    const node = makeTrackerNode(ctx, h);
    const mute = ctx.createGain();
    mute.gain.value = 0; // keep the graph pulling without sending the mic to the speakers
    src.connect(node).connect(mute).connect(ctx.destination);
    return {
      ctx, stream, node,
      stop: async () => {
        stream.getTracks().forEach((t) => t.stop());
        await ctx.close();
      },
    };
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    if (made) await made.close().catch(() => { /* already closed or never ran */ });
    throw e;
  }
}
