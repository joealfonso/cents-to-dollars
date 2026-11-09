// theme.ts, from DESIGN.md 1.2a and THM-02 to THM-04: Paper only. initTheme sets data-theme="editorial",
// ignores any stored value, removes the key, and never throws or logs when storage fails.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const KEY = 'centstodollars.theme';
let store: Map<string, string>;
let getThrows = false;
let removeThrows = false;
let setCalls: string[];
let consoleCalls: number;
const root = { dataset: {} as Record<string, string | undefined> };

function def(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
def('localStorage', {
  getItem(k: string) { if (getThrows) throw new Error('denied'); return store.has(k) ? store.get(k)! : null; },
  setItem(k: string, v: string) { setCalls.push(k); store.set(k, v); },
  removeItem(k: string) { if (removeThrows) throw new Error('denied'); store.delete(k); },
});
def('document', { documentElement: root, querySelectorAll: () => [], dispatchEvent: () => true });
for (const m of ['log', 'warn', 'error'] as const) {
  const orig = console[m];
  console[m] = (...a: unknown[]) => { consoleCalls++; orig(...a); };
}

const theme = await import('../src/app/theme.ts');

beforeEach(() => {
  store = new Map(); getThrows = false; removeThrows = false; setCalls = []; consoleCalls = 0;
  delete root.dataset.theme;
});

test('currentTheme is editorial when nothing is set', () => {
  assert.equal(theme.currentTheme(), 'editorial');
});

test('an invalid data-theme attribute reads as editorial', () => {
  root.dataset.theme = 'neon';
  assert.equal(theme.currentTheme(), 'editorial');
});

test('initTheme sets editorial on a bare page and currentTheme reports it', () => {
  theme.initTheme();
  assert.equal(root.dataset.theme, 'editorial');
  assert.equal(theme.currentTheme(), 'editorial');
});

test('initTheme overrides a wrong data-theme already on the element', () => {
  root.dataset.theme = 'loud';
  theme.initTheme();
  assert.equal(root.dataset.theme, 'editorial');
});

for (const v of ['loud', 'editorial', 'neon', '', 'Loud', 'null']) {
  test(`stored ${JSON.stringify(v)} is ignored: editorial applied, key removed (THM-02, THM-03)`, () => {
    store.set(KEY, v);
    theme.initTheme();
    assert.equal(root.dataset.theme, 'editorial');
    assert.equal(localStorage.getItem(KEY), null);
    assert.equal(store.has(KEY), false);
  });
}

test('initTheme leaves other storage keys alone', () => {
  store.set(KEY, 'loud');
  store.set('other.key', 'keep');
  theme.initTheme();
  assert.equal(store.get('other.key'), 'keep');
});

test('initTheme never writes to storage', () => {
  theme.initTheme();
  assert.deepEqual(setCalls, []);
});

test('localStorage.getItem throwing does not throw and gives editorial (THM-04)', () => {
  getThrows = true;
  assert.doesNotThrow(() => theme.initTheme());
  assert.equal(root.dataset.theme, 'editorial');
  assert.equal(theme.currentTheme(), 'editorial');
  assert.equal(consoleCalls, 0);
});

test('localStorage.removeItem throwing does not throw, shows no message, still gives editorial (THM-04)', () => {
  removeThrows = true;
  store.set(KEY, 'loud');
  assert.doesNotThrow(() => theme.initTheme());
  assert.equal(root.dataset.theme, 'editorial');
  assert.equal(consoleCalls, 0);
});

test('every storage call throwing still gives editorial', () => {
  getThrows = true; removeThrows = true;
  assert.doesNotThrow(() => theme.initTheme());
  assert.equal(root.dataset.theme, 'editorial');
});

test('the removed API is gone', () => {
  for (const name of ['storedTheme', 'setTheme', 'hasChosenTheme']) {
    assert.equal((theme as Record<string, unknown>)[name], undefined, name);
  }
});
