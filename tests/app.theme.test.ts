// theme.ts, from DESIGN.md 1.2: default Paper ("editorial"), key centstodollars.theme, storage errors never
// throw or show a message, 'themechange' dispatched on a real change only.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const KEY = 'centstodollars.theme';
let store: Map<string, string>;
let getThrows = false;
let setThrows = false;
let events: Array<{ type: string; detail: unknown }>;
const root = { dataset: {} as Record<string, string | undefined> };

function def(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
def('localStorage', {
  getItem(k: string) { if (getThrows) throw new Error('denied'); return store.has(k) ? store.get(k)! : null; },
  setItem(k: string, v: string) { if (setThrows) throw new Error('quota'); store.set(k, v); },
});
def('document', {
  documentElement: root,
  querySelectorAll: () => [],
  dispatchEvent(e: CustomEvent) { events.push({ type: e.type, detail: e.detail }); return true; },
});

const theme = await import('../src/app/theme.ts');

beforeEach(() => {
  store = new Map(); getThrows = false; setThrows = false; events = [];
  delete root.dataset.theme;
});

test('default is editorial when nothing is stored and nothing is set', () => {
  assert.equal(theme.storedTheme(), null);
  assert.equal(theme.currentTheme(), 'editorial');
});

test('an invalid data-theme attribute reads as editorial', () => {
  root.dataset.theme = 'neon';
  assert.equal(theme.currentTheme(), 'editorial');
});

for (const bad of ['neon', '', 'Loud', 'LOUD', 'clinical', 'null', ' loud']) {
  test(`invalid stored value ${JSON.stringify(bad)} falls back (storedTheme null, initTheme gives editorial)`, () => {
    store.set(KEY, bad);
    assert.equal(theme.storedTheme(), null);
    root.dataset.theme = 'garbage';
    theme.initTheme();
    assert.equal(root.dataset.theme, 'editorial');
  });
}

test('valid stored values are read, and initTheme applies them', () => {
  store.set(KEY, 'loud');
  assert.equal(theme.storedTheme(), 'loud');
  theme.initTheme();
  assert.equal(root.dataset.theme, 'loud');
  store.set(KEY, 'editorial');
  assert.equal(theme.storedTheme(), 'editorial');
});

test('localStorage.getItem throwing does not throw and gives editorial', () => {
  getThrows = true;
  assert.doesNotThrow(() => theme.storedTheme());
  assert.equal(theme.storedTheme(), null);
  assert.doesNotThrow(() => theme.initTheme());
  assert.equal(theme.currentTheme(), 'editorial');
});

test('setTheme writes the documented key and value', () => {
  theme.setTheme('loud');
  assert.equal(store.get(KEY), 'loud');
  assert.equal(root.dataset.theme, 'loud');
});

test('localStorage.setItem throwing does not throw, and the theme still holds for the visit', () => {
  setThrows = true;
  assert.doesNotThrow(() => theme.setTheme('loud'));
  assert.equal(theme.currentTheme(), 'loud');
  assert.equal(events.length, 1);
});

test('themechange fires on a real change with detail.theme, bubbles from document', () => {
  theme.setTheme('loud');
  assert.deepEqual(events, [{ type: 'themechange', detail: { theme: 'loud' } }]);
  theme.setTheme('editorial');
  assert.equal(events.length, 2);
  assert.deepEqual(events[1], { type: 'themechange', detail: { theme: 'editorial' } });
});

test('themechange does not fire when the theme is set to what it already is', () => {
  theme.setTheme('loud');
  events.length = 0;
  theme.setTheme('loud');
  assert.equal(events.length, 0);
});

test('setting editorial on a fresh default page (already editorial) does not fire, but still stores the choice', () => {
  theme.setTheme('editorial');
  assert.equal(events.length, 0);
  assert.equal(store.get(KEY), 'editorial');
});

test('hasChosenTheme: true after a pick even when storage throws (first-visit panel closes)', () => {
  setThrows = true; getThrows = true;
  theme.setTheme('editorial');
  assert.equal(theme.hasChosenTheme(), true);
});
