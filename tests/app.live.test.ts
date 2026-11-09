// createLive (src/app/live.ts) with a stubbed startLive, from DESIGN.md 6 Session ownership, 3.0 states and
// VA-05..VA-16, VA-38, VA-43. No DOM, no real microphone.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createLive, errorKind, type StartFn } from '../src/app/live.ts';

function def(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

interface FakeSession {
  stopCalls: number;
  endTrack(): void;
  [k: string]: unknown;
}
function fakeSession(opts: { stop?: () => Promise<void> } = {}): FakeSession {
  let endedCb: (() => void) | null = null;
  const track = {
    stopped: 0,
    addEventListener(type: string, cb: () => void) { if (type === 'ended') endedCb = cb; },
    stop() { track.stopped++; },
  };
  const s: FakeSession = {
    stopCalls: 0,
    ctx: {},
    node: {},
    stream: { getAudioTracks: () => [track], getTracks: () => [track] },
    stop: async () => { s.stopCalls++; await opts.stop?.(); },
    endTrack() { endedCb?.(); },
  };
  return s;
}

function deferred<T>() {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((r) => setImmediate(r));
const named = (name: string, msg = 'x') => Object.assign(new Error(msg), { name });

/** A start function whose result the test controls. */
function controlled() {
  const calls: Array<ReturnType<typeof deferred<any>> & { handlers: Parameters<StartFn>[0] }> = [];
  const startFn: StartFn = (h) => { const d = Object.assign(deferred<any>(), { handlers: h }); calls.push(d); return d.promise; };
  return { calls, startFn };
}

afterEach(() => { def('window', undefined); delete (globalThis as any).window; delete (globalThis as any).document; });

test('starts idle', () => {
  const l = createLive(async () => fakeSession() as any);
  assert.equal(l.status, 'idle');
  assert.equal(l.snapshot().session, null);
});

test('start moves to requesting, then listening when the session arrives (VA-05, VA-16)', async () => {
  const { calls, startFn } = controlled();
  const l = createLive(startFn);
  const p = l.start({ owner: 'voice' });
  assert.equal(l.status, 'requesting');
  const s = fakeSession();
  calls[0].resolve(s);
  assert.equal(await p, s);
  assert.equal(l.status, 'listening');
  assert.equal(l.session, s);
  assert.equal(l.snapshot().owner, 'voice');
});

test('double start while requesting calls startLive once and returns the same pending session (VA-07)', async () => {
  const { calls, startFn } = controlled();
  const l = createLive(startFn);
  const a = l.start({ owner: 'voice' });
  const b = l.start({ owner: 'voice' });
  assert.equal(calls.length, 1);
  const s = fakeSession();
  calls[0].resolve(s);
  assert.equal(await a, s);
  assert.equal(await b, s);
});

test('start while listening returns the current session and opens nothing new', async () => {
  let n = 0;
  const s = fakeSession();
  const l = createLive(async () => { n++; return s as any; });
  await l.start({ owner: 'voice' });
  assert.equal(await l.start({ owner: 'voice' }), s);
  assert.equal(n, 1);
});

test('a second owner cannot open a second mic while one holds it (rule 2): it gets the current session, owner unchanged', async () => {
  let n = 0;
  const s = fakeSession();
  const l = createLive(async () => { n++; return s as any; });
  await l.start({ owner: 'voice' });
  assert.equal(await l.start({ owner: 'calibration' }), s);
  assert.equal(n, 1);
  assert.equal(l.snapshot().owner, 'voice');
});

test('a second owner during requesting joins the pending start', async () => {
  const { calls, startFn } = controlled();
  const l = createLive(startFn);
  const a = l.start({ owner: 'latency' });
  const b = l.start({ owner: 'voice' });
  assert.equal(calls.length, 1);
  const s = fakeSession(); calls[0].resolve(s);
  assert.equal(await a, await b);
  assert.equal(l.snapshot().owner, 'latency');
});

test('stop during requesting: state is idle at once, the late session is stopped and dropped (VA-08, VA-09)', async () => {
  const { calls, startFn } = controlled();
  const l = createLive(startFn);
  const p = l.start({ owner: 'voice' });
  await l.stop();
  assert.equal(l.status, 'idle');
  const late = fakeSession();
  calls[0].resolve(late);
  assert.equal(await p, null);
  await tick();
  assert.equal(late.stopCalls, 1, 'late session must be stopped');
  assert.equal(l.status, 'idle', 'state unchanged by the late result');
  assert.equal(l.session, null);
  assert.equal(l.snapshot().owner, null);
});

test('html[data-live] stays off when a late session arrives after stop (VA-09)', async () => {
  const root = { dataset: {} as Record<string, string> };
  def('document', { documentElement: root });
  const { calls, startFn } = controlled();
  const l = createLive(startFn);
  const p = l.start({ owner: 'voice' });
  await l.stop();
  calls[0].resolve(fakeSession());
  await p; await tick();
  assert.notEqual(root.dataset.live, 'on');
});

test('html[data-live] is on while listening and off after stop (VA-17)', async () => {
  const root = { dataset: {} as Record<string, string> };
  def('document', { documentElement: root });
  const l = createLive(async () => fakeSession() as any);
  await l.start({ owner: 'voice' });
  assert.equal(root.dataset.live, 'on');
  await l.stop();
  assert.equal(root.dataset.live, 'off');
});

test('a late rejection after stop is ignored: state stays idle, no error', async () => {
  const { calls, startFn } = controlled();
  const l = createLive(startFn);
  const p = l.start({ owner: 'voice' });
  await l.stop();
  calls[0].reject(named('NotAllowedError'));
  assert.equal(await p, null);
  assert.equal(l.status, 'idle');
  assert.equal(l.snapshot().error, null);
});

test('frames of a stopped (stale) session are not delivered to listeners', async () => {
  const { calls, startFn } = controlled();
  const l = createLive(startFn);
  const seen: unknown[] = [];
  l.onFrame((f) => seen.push(f));
  const p = l.start({ owner: 'voice' });
  calls[0].handlers.onFrame?.({ n: 1 } as any);
  assert.equal(seen.length, 1, 'current token delivers');
  await l.stop();
  calls[0].handlers.onFrame?.({ n: 2 } as any);
  assert.equal(seen.length, 1, 'stale token dropped');
  calls[0].resolve(fakeSession()); await p;
});

test('stop is idempotent and awaitable: two clicks stop the session once (VA-38)', async () => {
  const gate = deferred<void>();
  const s = fakeSession({ stop: () => gate.promise });
  const l = createLive(async () => s as any);
  await l.start({ owner: 'voice' });
  const a = l.stop();
  const b = l.stop();
  assert.equal(l.status, 'stopping');
  assert.equal(a, b, 'one shared promise');
  let done = false; void a.then(() => { done = true; });
  await tick();
  assert.equal(done, false, 'awaiting stop waits for session.stop()');
  gate.resolve();
  await a;
  assert.equal(l.status, 'stopped');
  assert.equal(s.stopCalls, 1);
  await l.stop(); // again after finished
  assert.equal(s.stopCalls, 1);
  assert.equal(l.status, 'stopped');
});

test('stop when idle resolves and changes nothing', async () => {
  const l = createLive(async () => fakeSession() as any);
  await l.stop();
  assert.equal(l.status, 'idle');
});

test('stop() still resolves and the state ends stopped if session.stop() throws', async () => {
  const s = fakeSession({ stop: async () => { throw new Error('close failed'); } });
  const l = createLive(async () => s as any);
  await l.start({ owner: 'voice' });
  const origErr = console.error; console.error = () => {};
  try { await l.stop(); } finally { console.error = origErr; }
  assert.equal(l.status, 'stopped');
  assert.equal(l.session, null);
});

test('start while stopping waits for the stop to finish, then starts a new session', async () => {
  const gate = deferred<void>();
  const s1 = fakeSession({ stop: () => gate.promise });
  const s2 = fakeSession();
  const queue = [s1, s2];
  let n = 0;
  const l = createLive(async () => { n++; return queue.shift() as any; });
  await l.start({ owner: 'voice' });
  const stopP = l.stop();
  const startP = l.start({ owner: 'voice' });
  await tick();
  assert.equal(n, 1, 'no new start before the stop finished');
  gate.resolve();
  await stopP;
  assert.equal(await startP, s2);
  assert.equal(n, 2);
  assert.equal(l.status, 'listening');
});

test('can start again after stopped', async () => {
  let n = 0;
  const l = createLive(async () => { n++; return fakeSession() as any; });
  await l.start({ owner: 'voice' });
  await l.stop();
  await l.start({ owner: 'voice' });
  assert.equal(n, 2);
  assert.equal(l.status, 'listening');
});

// ---- 3.0 mapping
const MAP: Array<[string, string]> = [
  ['NotAllowedError', 'denied'],
  ['NotFoundError', 'nodevice'],
  ['OverconstrainedError', 'nodevice'],
  ['NotReadableError', 'busy'],
  ['AbortError', 'busy'],
  ['TypeError', 'analyser'],
  ['Error', 'analyser'],
];
for (const [name, kind] of MAP) {
  test(`rejection ${name} -> error(${kind}) (3.0, VA-10, VA-12, VA-13)`, async () => {
    const l = createLive(async () => { throw named(name, `boom ${name}`); });
    assert.equal(await l.start({ owner: 'voice' }), null);
    const s = l.snapshot();
    assert.equal(s.status, 'error');
    assert.equal(s.error, kind);
    assert.equal(s.owner, 'voice');
    assert.equal(l.status, 'error');
    assert.equal(errorKind(named(name)), kind);
  });
}

test('rejection with a non-Error value or null maps to the analyser/error row without throwing', async () => {
  assert.equal(errorKind(null), 'analyser');
  assert.equal(errorKind(undefined), 'analyser');
  assert.equal(errorKind('NotAllowedError'), 'analyser', 'a string has no .name');
  const l = createLive(async () => { throw 'plain string'; });
  await l.start({ owner: 'voice' });
  assert.equal(l.snapshot().error, 'analyser');
});

test('other errors keep the error text for #readout-error-details (VA-15)', async () => {
  const l = createLive(async () => { throw named('RangeError', 'addModule failed: 404'); });
  await l.start({ owner: 'voice' });
  assert.match(l.snapshot().detail, /addModule failed: 404/);
});

test('after an error the session is null and a retry (Try again) can start (VA-11)', async () => {
  let n = 0;
  const l = createLive(async () => { if (n++ === 0) throw named('NotAllowedError'); return fakeSession() as any; });
  await l.start({ owner: 'voice' });
  assert.equal(l.status, 'error');
  assert.equal(l.session, null);
  await l.start({ owner: 'voice' });
  assert.equal(l.status, 'listening');
  assert.equal(l.snapshot().error, null);
  assert.equal(l.snapshot().detail, '');
});

test('insecure context: no start, error(insecure), startLive never called (3.0, VA-14)', async () => {
  def('window', { isSecureContext: false });
  let n = 0;
  const l = createLive(async () => { n++; return fakeSession() as any; });
  assert.equal(await l.start({ owner: 'voice' }), null);
  assert.equal(n, 0);
  assert.equal(l.snapshot().error, 'insecure');
});

test('markDenied (Permissions API says denied) applies while idle only', async () => {
  const l = createLive(async () => fakeSession() as any);
  l.markDenied();
  assert.equal(l.snapshot().error, 'denied');
  const l2 = createLive(async () => fakeSession() as any);
  await l2.start({ owner: 'voice' });
  l2.markDenied();
  assert.equal(l2.status, 'listening');
});

// ---- track ended
test('track ended while listening -> error(ended) and the session is released (6.3, VA-43)', async () => {
  const root = { dataset: {} as Record<string, string> };
  def('document', { documentElement: root });
  const s = fakeSession();
  const l = createLive(async () => s as any);
  await l.start({ owner: 'voice' });
  s.endTrack();
  assert.equal(l.status, 'error');
  assert.equal(l.snapshot().error, 'ended');
  assert.equal(l.session, null);
  assert.equal(root.dataset.live, 'off');
  await l.stop();
  assert.equal(s.stopCalls, 1, 'released exactly once');
});

test('track ended notifies subscribers and stops frames from the old session', async () => {
  const { calls, startFn } = controlled();
  const l = createLive(startFn);
  const states: string[] = [];
  l.subscribe((s) => states.push(s.status));
  const seen: unknown[] = [];
  l.onFrame((f) => seen.push(f));
  const p = l.start({ owner: 'voice' });
  const s = fakeSession(); calls[0].resolve(s); await p;
  s.endTrack();
  calls[0].handlers.onFrame?.({} as any);
  assert.equal(seen.length, 0);
  assert.deepEqual(states.slice(-1), ['error']);
});

test('track ended after a stop does not move a stopped state to error', async () => {
  const s = fakeSession();
  const l = createLive(async () => s as any);
  await l.start({ owner: 'voice' });
  await l.stop();
  s.endTrack();
  assert.equal(l.status, 'stopped');
});

test('subscribe returns an unsubscribe; a throwing listener does not break others', async () => {
  const l = createLive(async () => fakeSession() as any);
  const seen: string[] = [];
  const origErr = console.error; console.error = () => {};
  const off = l.subscribe(() => { throw new Error('bad listener'); });
  l.subscribe((s) => seen.push(s.status));
  await l.start({ owner: 'voice' });
  off();
  console.error = origErr;
  assert.deepEqual(seen, ['requesting', 'listening']);
});
