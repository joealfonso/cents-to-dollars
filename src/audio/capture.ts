// Web Audio capture: microphone (processing off) into the pitch-tracker AudioWorklet.

import workletUrl from './tracker.worklet.ts?worker&url';
import type { WorkletMessage, WorkletMeter, WorkletF0 } from './tracker.worklet.ts';

export interface TrackerHandlers {
  /** Every frame, immediately after analysis: levels, voicing, plain YIN F0, spectrum. */
  onMeter?: (m: WorkletMeter) => void;
  /** Every frame, once its continuity-tracked F0 is final (DEFAULT_CONTINUITY.lag frames later at most). */
  onF0?: (f: WorkletF0) => void;
}

/** Time to wait for the worklet's flush acknowledgement before closing anyway. */
const FLUSH_TIMEOUT_MS = 250;

export async function loadTracker(ctx: BaseAudioContext): Promise<void> {
  await ctx.audioWorklet.addModule(workletUrl);
}

export function makeTrackerNode(ctx: BaseAudioContext, h: TrackerHandlers): AudioWorkletNode {
  const node = new AudioWorkletNode(ctx, 'pitch-tracker', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  node.port.onmessage = (e: MessageEvent<WorkletMessage>) => {
    if (e.data?.type === 'meter') h.onMeter?.(e.data);
    else if (e.data?.type === 'f0') h.onF0?.(e.data);
  };
  return node;
}

/**
 * Ask the worklet to finalize every pending frame. Resolves after the flushed 'f0' messages have been
 * delivered (they precede the 'flushed' acknowledgement on the same port), or after timeoutMs.
 */
export function flushTracker(node: AudioWorkletNode, timeoutMs = FLUSH_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const onAck = (e: MessageEvent<WorkletMessage>) => {
      if (e.data?.type !== 'flushed') return;
      clearTimeout(timer);
      node.port.removeEventListener('message', onAck);
      resolve(true);
    };
    const timer = setTimeout(() => {
      node.port.removeEventListener('message', onAck);
      resolve(false);
    }, timeoutMs);
    node.port.addEventListener('message', onAck);
    node.port.postMessage({ type: 'flush' });
  });
}

export interface LiveSession {
  ctx: AudioContext;
  stream: MediaStream;
  node: AudioWorkletNode;
  /** Flushes the tracker (so the tail of a sounding note is delivered), then releases the mic and closes. */
  stop: () => Promise<void>;
}

export async function startLive(h: TrackerHandlers): Promise<LiveSession> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  await loadTracker(ctx);
  const src = ctx.createMediaStreamSource(stream);
  const node = makeTrackerNode(ctx, h);
  const mute = ctx.createGain();
  mute.gain.value = 0; // keep the graph pulling without sending the mic to the speakers
  src.connect(node).connect(mute).connect(ctx.destination);
  return {
    ctx, stream, node,
    stop: async () => {
      if (ctx.state !== 'closed') await flushTracker(node);
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close();
    },
  };
}
