// The single owner of the microphone (DESIGN.md 6). Nothing else in src/app calls startLive.
//
// State: idle | requesting | listening | stopping | stopped | error(kind), plus the owner and a session token.
// - start() while requesting or listening returns the pending or current session; a double Start opens nothing.
// - start() while stopping waits for the stop, then starts.
// - Every start takes a new token. A getUserMedia result that arrives after a stop (token moved on) is stopped
//   at once and dropped; a late rejection with a stale token is ignored.
// - stop() is idempotent and returns one shared promise. In requesting it bumps the token and goes idle.
// - The audio track's 'ended' event, or the context closing from outside, moves the state to error(ended) and
//   releases the session. No frame within NO_FRAMES_MS of Listening moves it to error(analyser).
//
// capture.ts is loaded with a dynamic import so this module (and its state machine) loads in Node tests,
// which cannot resolve the worklet's ?worker&url import. Tests use createLive() with a stubbed start.

import type { LiveSession, TrackerHandlers } from '../audio/capture.ts';
import type { WorkletFrame } from '../audio/tracker.worklet.ts';

export type Owner = 'voice' | 'calibration' | 'latency';
export type LiveStatus = 'idle' | 'requesting' | 'listening' | 'stopping' | 'stopped' | 'error';
/** Rows of the DESIGN.md 3.0 table. 'analyser' is also the row for any error not named there. */
export type LiveErrorKind = 'denied' | 'nodevice' | 'busy' | 'insecure' | 'analyser' | 'ended';

export interface LiveSnapshot {
  status: LiveStatus;
  /** Set only when status is 'error'. */
  error: LiveErrorKind | null;
  /** The raw error text, for the error Details disclosure. Empty when there is none. */
  detail: string;
  /** Who asked for the mic. Kept in the error state so a view can tell whose start failed. */
  owner: Owner | null;
  session: LiveSession | null;
}

export type StartFn = (h: TrackerHandlers) => Promise<LiveSession>;

/** If no frame arrives this long after Listening, the session is treated as failed (no audio arriving). */
export const NO_FRAMES_MS = 2000;

/** Maps a startLive rejection to a row of the 3.0 table, by its `name`. */
export function errorKind(e: unknown): LiveErrorKind {
  const name = (e as { name?: unknown } | null)?.name;
  if (name === 'NotAllowedError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'nodevice';
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  return 'analyser';
}

function describe(e: unknown): string {
  try { return String(e); } catch { return 'Unknown error'; }
}

/** No secure context or no getUserMedia: the 'insecure' row. */
function insecure(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return !window.isSecureContext || !navigator.mediaDevices?.getUserMedia;
}

function htmlRoot(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.documentElement;
}

export function createLive(startFn: StartFn) {
  let status: LiveStatus = 'idle';
  let error: LiveErrorKind | null = null;
  let detail = '';
  let owner: Owner | null = null;
  let session: LiveSession | null = null;
  let token = 0;
  let pending: Promise<LiveSession | null> | null = null;
  let stopping: Promise<void> | null = null;
  let releasing: Promise<void> | null = null;
  const stateListeners = new Set<(s: LiveSnapshot) => void>();
  const frameListeners = new Set<(f: WorkletFrame) => void>();

  function snapshot(): LiveSnapshot {
    return { status, error, detail, owner, session };
  }

  function emit() {
    const s = snapshot();
    for (const l of stateListeners) {
      try { l(s); } catch (e) { console.error('live state listener failed', e); }
    }
  }

  function setLiveAttr(on: boolean) {
    const root = htmlRoot();
    if (root) root.dataset.live = on ? 'on' : 'off';
  }

  function fail(kind: LiveErrorKind, text: string, who: Owner | null) {
    status = 'error'; error = kind; detail = text; owner = who;
    emit();
  }

  /** Stops the tracks and closes the context. Never throws: the mic is released even if close() fails. */
  async function release(s: LiveSession) {
    try {
      await s.stop();
    } catch (e) {
      console.error('stopping the microphone failed', e);
      try { s.stream.getTracks().forEach((t) => t.stop()); } catch { /* nothing more to release */ }
    }
  }

  /** Drops a listening session into an error state and releases it. No-op if it is no longer the session. */
  function lose(s: LiveSession, kind: LiveErrorKind, text: string) {
    if (session !== s || status !== 'listening') return;
    token++; // frames still in flight from this session are dropped
    session = null;
    setLiveAttr(false);
    fail(kind, text, null);
    releasing = release(s).finally(() => { releasing = null; });
  }

  /**
   * Watches a new session for the ways it can die without a rejection:
   * - the audio track fires 'ended' (unplugged, revoked): error(ended);
   * - the AudioContext is closed from outside: treated like 'ended';
   * - the context is suspended or interrupted (autoplay policy, another app, iOS): resume() is tried;
   * - no frame within NO_FRAMES_MS of Listening: error(analyser), the closest 3.0 row, with the
   *   context state in Details, so the view never sits on "Listening" with nothing arriving.
   */
  function watch(s: LiveSession, gotFrame: () => boolean) {
    s.stream.getAudioTracks()[0]?.addEventListener('ended', () => lose(s, 'ended', ''));
    const ctx = s.ctx as Partial<AudioContext> | undefined;
    const resume = () => { try { void ctx?.resume?.()?.catch(() => { /* the watchdog reports it */ }); } catch { /* same */ } };
    resume();
    ctx?.addEventListener?.('statechange', () => {
      const st = ctx.state as string | undefined;
      if (st === 'closed') lose(s, 'ended', '');
      else if (st === 'suspended' || st === 'interrupted') resume();
    });
    const timer = setTimeout(() => {
      if (gotFrame()) return;
      lose(s, 'analyser', `No audio frames arrived within ${NO_FRAMES_MS / 1000} s of starting. AudioContext state: ${ctx?.state ?? 'unknown'}.`);
    }, NO_FRAMES_MS);
    (timer as { unref?: () => void }).unref?.(); // never keeps a Node test process alive
  }

  async function start({ owner: who }: { owner: Owner }): Promise<LiveSession | null> {
    if (status === 'requesting' && pending) return pending;
    if (status === 'listening') return session;
    if (status === 'stopping' && stopping) {
      await stopping;
      return start({ owner: who }); // re-check: another caller may have started meanwhile
    }
    if (insecure()) { fail('insecure', '', who); return null; }
    // The legacy test page owns its own mic and sets html[data-live]. The router stops it on leave, so this
    // only guards against both pages holding the mic if that ever fails.
    if (htmlRoot()?.dataset.live === 'on' && !session) {
      fail('busy', 'Another page in this app still has the microphone open.', who);
      return null;
    }

    const my = ++token;
    let frames = 0;
    status = 'requesting'; error = null; detail = ''; owner = who;
    emit();

    const p = (async (): Promise<LiveSession | null> => {
      let s: LiveSession;
      try {
        s = await startFn({
          onFrame: (f) => {
            if (my !== token) return;
            frames++;
            for (const l of frameListeners) {
              try { l(f); } catch (e) { console.error('live frame listener failed', e); }
            }
          },
        });
      } catch (e) {
        if (my !== token) return null; // stale: a stop happened while we waited
        pending = null;
        fail(errorKind(e), describe(e), who);
        return null;
      }
      if (my !== token) {
        // Late result after a stop or a route change: release it at once and leave the state alone.
        void release(s);
        return null;
      }
      pending = null;
      session = s;
      status = 'listening';
      setLiveAttr(true);
      watch(s, () => frames > 0);
      emit();
      return s;
    })();
    pending = p;
    return p;
  }

  function stop(): Promise<void> {
    if (stopping) return stopping;
    if (status === 'requesting') {
      token++; // the late result is stopped by start()
      pending = null;
      status = 'idle'; owner = null; error = null; detail = '';
      emit();
      return Promise.resolve();
    }
    if (status === 'listening' && session) {
      const s = session;
      status = 'stopping';
      emit();
      stopping = (async () => {
        await release(s);
        session = null;
        status = 'stopped'; owner = null;
        setLiveAttr(false);
        emit();
      })().finally(() => { stopping = null; });
      return stopping;
    }
    return releasing ?? Promise.resolve();
  }

  return {
    start,
    stop,
    /** Back to idle (or 'insecure') from idle, stopped or error. Does nothing while a session is active. */
    reset() {
      if (status !== 'idle' && status !== 'stopped' && status !== 'error') return;
      if (insecure()) { if (!(status === 'error' && error === 'insecure')) fail('insecure', '', null); return; }
      if (status === 'idle') return;
      status = 'idle'; error = null; detail = ''; owner = null;
      emit();
    },
    /** The Permissions API says 'denied' before any start (3.0 Denied row). Only applies while idle. */
    markDenied() {
      if (status === 'idle') fail('denied', '', null);
    },
    snapshot,
    get status() { return status; },
    get session() { return session; },
    /** Called on every state change. Returns an unsubscribe function. */
    subscribe(l: (s: LiveSnapshot) => void): () => void {
      stateListeners.add(l);
      return () => { stateListeners.delete(l); };
    },
    /** Called on every frame of the current session. Returns an unsubscribe function. */
    onFrame(l: (f: WorkletFrame) => void): () => void {
      frameListeners.add(l);
      return () => { frameListeners.delete(l); };
    },
  };
}

export type Live = ReturnType<typeof createLive>;

export const live: Live = createLive((h) => import('../audio/capture.ts').then((m) => m.startLive(h)));
