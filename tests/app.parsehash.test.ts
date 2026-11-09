// parseHash, from DESIGN.md 3.4/3.5 (routes, deep links, notfound) and the Phase A task list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash } from '../src/app/router.ts';

const cases: Array<[string, string, string]> = [
  ['', 'overview', ''],
  ['#', 'overview', ''],
  ['#/', 'overview', ''],
  ['#/tools', 'tools', ''],
  ['#/voice', 'voice', ''],
  ['#/methods', 'methods', ''],
  ['#/legacy', 'legacy', ''],
  ['#/tools/', 'tools', ''],
  ['#/voice//', 'voice', ''],
  ['#/methods/', 'methods', ''],
  ['#/methods/calibration', 'methods', 'calibration'],
  ['#/methods/latency', 'methods', 'latency'],
  ['#/methods/self-test', 'methods', 'self-test'],
  ['#/methods/self-test/', 'methods', 'self-test'],
];
for (const [hash, name, sub] of cases) {
  test(`parseHash(${JSON.stringify(hash)}) -> ${name}${sub ? ' / ' + sub : ''}`, () => {
    assert.deepEqual(parseHash(hash), { name, sub });
  });
}

const notfound = [
  '#/nope', '#/Tools', '#/sessions', '#/legacy/x', '#/voice/x', '#/tools/x', 'tools', '#tools', '#/nope/methods',
  '#/constructor', '#/__proto__', '#/toString', '#/hasOwnProperty', '#/valueOf', '#/isPrototypeOf',
  '#/constructor/', '#/__proto__/x',
];
for (const hash of notfound) {
  test(`parseHash(${JSON.stringify(hash)}) -> notfound`, () => {
    assert.deepEqual(parseHash(hash), { name: 'notfound', sub: '' });
  });
}
