// fields.ts, from DESIGN.md 7.3/7.5: data-field rows; results of checks are in-memory for this visit only, so
// before any check runs the rows must say "Not run this visit" and show no number that was not measured.
import { test } from 'node:test';
import assert from 'node:assert/strict';

function def(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

class Row {
  dataset: Record<string, string>;
  value = { textContent: 'Checking…' };
  action = { children: [] as unknown[], replaceChildren(...c: unknown[]) { this.children = c; } };
  constructor(name: string) { this.dataset = { field: name, status: 'idle' }; }
  querySelector(sel: string) { return sel === '.kv-value' ? this.value : sel === '.kv-action' ? this.action : null; }
}
const rows: Row[] = ['mic-permission', 'browser-audio', 'secure', 'a4', 'calibration', 'latency', 'selftest'].flatMap((n) => [new Row(n), new Row(n)]);
const store = new Map<string, string>();
let permQuery: (() => Promise<unknown>) | undefined;

def('document', {
  querySelectorAll: (sel: string) => {
    const m = /^\[data-field="([\w-]+)"\]$/.exec(sel);
    if (m) return rows.filter((r) => r.dataset.field === m[1]);
    return sel === '[data-field]' ? rows : [];
  },
  createElement: () => ({ set href(_: string) {}, className: '', textContent: '' }),
});
def('localStorage', { getItem: (k: string) => (store.has(k) ? store.get(k)! : null), setItem() {} });
def('window', { isSecureContext: true, setTimeout, clearTimeout });
def('navigator', { permissions: { query: () => (permQuery ? permQuery() : new Promise(() => {})) } });

const f = await import('../src/app/fields.ts');
const val = (name: string) => rows.find((r) => r.dataset.field === name)!.value.textContent;
const row = (name: string) => rows.find((r) => r.dataset.field === name)!;

test('fieldRow markup has data-field, kv-dot, kv-label, kv-value, kv-action, and says Checking… not a number', () => {
  const html = f.fieldRow('calibration');
  assert.match(html, /data-field="calibration"/);
  for (const c of ['kv-dot', 'kv-label', 'kv-value', 'kv-action']) assert.match(html, new RegExp(c));
  assert.match(html, /Checking…/);
  assert.doesNotMatch(html.replace(/data-field="[^"]*"/, ''), /\d/);
});

test('getField is undefined for a check that has not run', () => {
  for (const n of ['calibration', 'latency', 'selftest'] as const) assert.equal(f.getField(n), undefined);
});

test('setField updates every row with that data-field, and only those', () => {
  f.setField('secure', { status: 'ok', value: 'Yes' });
  const both = rows.filter((r) => r.dataset.field === 'secure');
  assert.equal(both.length, 2);
  for (const r of both) { assert.equal(r.value.textContent, 'Yes'); assert.equal(r.dataset.status, 'ok'); }
  assert.equal(val('latency'), 'Checking…');
});

test('after the passive checks, calibration, loopback latency and self-test say "Not run this visit" with no digits', () => {
  f.runPassiveChecks();
  for (const n of ['calibration', 'latency', 'selftest']) {
    for (const r of rows.filter((x) => x.dataset.field === n)) {
      assert.equal(r.value.textContent, 'Not run this visit', n);
      assert.equal(r.dataset.status, 'idle', n);
      assert.doesNotMatch(r.value.textContent, /\d/, n);
    }
  }
});

test('a measured field is not invented: getField for the three checks stays "Not run this visit" status idle', () => {
  for (const n of ['calibration', 'latency', 'selftest'] as const) {
    assert.deepEqual([f.getField(n)!.status, f.getField(n)!.value], ['idle', 'Not run this visit']);
  }
});

test('A4 row shows the default 440 Hz when nothing valid is saved, and it is a setting (info), not a result', () => {
  assert.equal(val('a4'), '440 Hz');
  assert.equal(row('a4').dataset.status, 'info');
});

test('secure page row reflects isSecureContext (true -> Yes)', () => {
  assert.equal(val('secure'), 'Yes');
});

test('mic permission row shows no number while the Permissions API query is pending', () => {
  // The stubbed query never settles, so this is the pending state.
  assert.doesNotMatch(val('mic-permission'), /\d/);
});

test('savedA4 rejects out-of-range, blank and non-numeric values and returns the default', () => {
  for (const bad of ['399', '481', '', '  ', 'abc', 'NaN', '-440', 'Infinity']) {
    store.set('centstodollars.a4', bad);
    assert.equal(f.savedA4(), 440, JSON.stringify(bad));
  }
});

test('savedA4 accepts the range edges and values inside', () => {
  for (const [s, v] of [['400', 400], ['480', 480], ['442', 442], ['432.5', 432.5]] as const) {
    store.set('centstodollars.a4', s);
    assert.equal(f.savedA4(), v);
  }
});

test('savedA4 does not throw when storage throws', () => {
  def('localStorage', { getItem() { throw new Error('denied'); } });
  assert.doesNotThrow(() => f.savedA4());
  assert.equal(f.savedA4(), 440);
});

test('repaintFields applies the last known value to a row added later', () => {
  const late = new Row('selftest');
  late.value.textContent = 'Checking…';
  rows.push(late);
  f.repaintFields();
  assert.equal(late.value.textContent, 'Not run this visit');
});
