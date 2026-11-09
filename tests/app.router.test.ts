// createRouter against a stub DOM, from DESIGN.md 6.5 (leave hooks awaited, latest navigation wins),
// 2.1 (aria-current), 5 (title, focus h1 on route change).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

function def(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

const NAMES = ['overview', 'tools', 'voice', 'methods', 'notfound', 'legacy'] as const;
type N = (typeof NAMES)[number];

interface Sec { hidden: boolean; h1: { focused: number; tabIndex: number; hasAttribute(a: string): boolean; focus(): void } }
let sections: Record<string, Sec>;
let navEls: Array<{ dataset: { nav: string }; attrs: Map<string, string>; setAttribute(k: string, v: string): void; removeAttribute(k: string): void; scrollIntoView(): void }>;
let listeners: Array<() => void>;
const doc: Record<string, unknown> = { title: '' };
const loc = { hash: '' };

function build() {
  sections = {};
  for (const n of NAMES) {
    const h1 = { focused: 0, tabIndex: 0, hasAttribute: (a: string) => a === 'tabindex' && h1.tabIndex === -1, focus() { h1.focused++; } };
    sections[n] = { hidden: true, h1 };
  }
  navEls = ['overview', 'tools', 'methods'].map((n) => {
    const attrs = new Map<string, string>();
    return { dataset: { nav: n }, attrs, setAttribute: (k: string, v: string) => void attrs.set(k, v), removeAttribute: (k: string) => void attrs.delete(k), scrollIntoView() {} };
  });
  listeners = [];
  doc.title = '';
}
doc.querySelector = (sel: string) => {
  const m = /data-route="(\w+)"/.exec(sel);
  const s = m && sections[m[1]];
  return s ? { get hidden() { return s.hidden; }, set hidden(v: boolean) { s.hidden = v; }, querySelector: () => s.h1 } : null;
};
doc.querySelectorAll = (sel: string) => (sel === '[data-nav]' ? navEls : []);
def('document', doc);
def('location', loc);
def('window', { addEventListener: (_: string, f: () => void) => void listeners.push(f), scrollTo() {} });

const { createRouter, APP_NAME } = await import('../src/app/router.ts');

const tick = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const visible = () => NAMES.filter((n) => !sections[n].hidden);
const deferred = () => { let res!: () => void; const p = new Promise<void>((r) => (res = r)); return { p, res }; };
const navigate = async (hash: string) => { loc.hash = hash; for (const l of listeners) l(); await tick(); };

type Log = string[];
function routes(log: Log, over: Partial<Record<N, Partial<import('../src/app/router.ts').Route>>> = {}) {
  const r = {} as Record<N, import('../src/app/router.ts').Route>;
  for (const n of NAMES) {
    r[n] = {
      title: n === 'overview' ? APP_NAME : `T-${n}`,
      nav: n === 'overview' || n === 'tools' || n === 'methods' ? n : undefined,
      enter: (sub) => { log.push(`enter:${n}:${sub}`); },
      leave: async () => { log.push(`leave:${n}`); },
      ...over[n],
    };
  }
  return r;
}

const origError = console.error;
beforeEach(() => { build(); loc.hash = ''; console.error = () => {}; });
test.afterEach(() => { console.error = origError; });

async function startAt(hash: string, r: ReturnType<typeof routes>) {
  loc.hash = hash;
  const router = createRouter(r);
  router.start();
  await tick();
  return router;
}

test('first load shows only the matching route and does not move focus', async () => {
  const router = await startAt('#/voice', routes([]));
  assert.deepEqual(visible(), ['voice']);
  assert.equal(router.current, 'voice');
  assert.equal(sections.voice.h1.focused, 0);
});

test('empty hash shows overview; unknown hash shows notfound; prototype key shows notfound', async () => {
  await startAt('', routes([]));
  assert.deepEqual(visible(), ['overview']);
  build();
  await startAt('#/nope', routes([]));
  assert.deepEqual(visible(), ['notfound']);
  build();
  await startAt('#/constructor', routes([]));
  assert.deepEqual(visible(), ['notfound']);
});

test('route change sets the title, focuses the new h1, and moves aria-current', async () => {
  await startAt('', routes([]));
  assert.equal(doc.title, APP_NAME);
  await navigate('#/methods');
  assert.equal(doc.title, `T-methods | ${APP_NAME}`);
  assert.equal(sections.methods.h1.focused, 1);
  assert.equal(navEls.find((e) => e.dataset.nav === 'methods')!.attrs.get('aria-current'), 'page');
  assert.equal(navEls.filter((e) => e.attrs.has('aria-current')).length, 1);
});

test('a route with nav "tools" (as Voice analysis should) marks Tools current', async () => {
  const r = routes([], { voice: { nav: 'tools' } });
  await startAt('#/voice', r);
  assert.equal(navEls.find((e) => e.dataset.nav === 'tools')!.attrs.get('aria-current'), 'page');
  assert.equal(navEls.filter((e) => e.attrs.has('aria-current')).length, 1);
});

test('a route with no nav item clears aria-current from all', async () => {
  await startAt('#/tools', routes([]));
  await navigate('#/nope');
  assert.equal(navEls.filter((e) => e.attrs.has('aria-current')).length, 0);
});

test('the leave hook of the old route is awaited before the next route is entered or shown', async () => {
  const log: Log = [];
  const gate = deferred();
  const r = routes(log, { voice: { leave: async () => { log.push('leave:start'); await gate.p; log.push('leave:end'); } } });
  await startAt('#/voice', r);
  log.length = 0;
  await navigate('#/tools');
  assert.deepEqual(log, ['leave:start'], 'enter must not run while leave is pending');
  assert.deepEqual(visible(), ['voice'], 'old route stays visible while leaving');
  gate.res();
  await tick();
  assert.deepEqual(log, ['leave:start', 'leave:end', 'enter:tools:']);
  assert.deepEqual(visible(), ['tools']);
});

test('overlapping navigation: the latest wins, the superseded route is never entered or shown', async () => {
  const log: Log = [];
  const gate = deferred();
  const r = routes(log, { voice: { leave: async () => { await gate.p; } } });
  const router = await startAt('#/voice', r);
  log.length = 0;
  await navigate('#/tools');
  await navigate('#/methods/self-test');
  gate.res();
  await tick();
  assert.equal(router.current, 'methods');
  assert.deepEqual(visible(), ['methods']);
  assert.ok(!log.some((l) => l.startsWith('enter:tools')), `tools entered: ${log}`);
  assert.ok(log.includes('enter:methods:self-test'));
  assert.equal(doc.title, `T-methods | ${APP_NAME}`);
});

test('overlapping navigation: going back to the current route while leaving keeps that route', async () => {
  const gate = deferred();
  const r = routes([], { voice: { leave: async () => { await gate.p; } } });
  const router = await startAt('#/voice', r);
  await navigate('#/tools');
  await navigate('#/voice');
  gate.res();
  await tick();
  assert.equal(router.current, 'voice');
  assert.deepEqual(visible(), ['voice']);
});

test('the leave hook runs once even when two navigations overlap', async () => {
  const log: Log = [];
  const gate = deferred();
  const r = routes(log, { voice: { leave: async () => { log.push('leave'); await gate.p; } } });
  await startAt('#/voice', r);
  await navigate('#/tools');
  await navigate('#/methods');
  gate.res();
  await tick();
  assert.equal(log.filter((l) => l === 'leave').length, 1);
});

test('a leave hook that rejects still changes the route', async () => {
  const r = routes([], { voice: { leave: async () => { throw new Error('boom'); } } });
  const router = await startAt('#/voice', r);
  await navigate('#/tools');
  assert.equal(router.current, 'tools');
  assert.deepEqual(visible(), ['tools']);
});

test('a leave hook that throws synchronously still changes the route', async () => {
  const r = routes([], { voice: { leave: (() => { throw new Error('sync boom'); }) as never } });
  const router = await startAt('#/voice', r);
  await navigate('#/tools');
  assert.equal(router.current, 'tools');
  assert.deepEqual(visible(), ['tools']);
});

test('an enter hook that throws still shows the route', async () => {
  const r = routes([], { tools: { enter: () => { throw new Error('enter boom'); } } });
  const router = await startAt('', r);
  await navigate('#/tools');
  assert.equal(router.current, 'tools');
});

test('a hash change inside Methods is not a leave: the hook does not run, enter gets the sub path, no route swap', async () => {
  const log: Log = [];
  const router = await startAt('#/methods', routes(log));
  log.length = 0;
  await navigate('#/methods/self-test');
  assert.deepEqual(log, ['enter:methods:self-test']);
  assert.equal(router.current, 'methods');
  assert.deepEqual(visible(), ['methods']);
});

test('leaving a route runs only that route leave hook', async () => {
  const log: Log = [];
  await startAt('#/tools', routes(log));
  log.length = 0;
  await navigate('#/voice');
  assert.deepEqual(log, ['leave:tools', 'enter:voice:']);
});

test('#/legacy/x shows notfound, not legacy', async () => {
  const router = await startAt('#/legacy/x', routes([]));
  assert.equal(router.current, 'notfound');
});
