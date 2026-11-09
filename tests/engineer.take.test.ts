// Engineer's own checks for round-2 review flags (not test-writer's suite).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readM4aDuration } from '../src/take/headers.ts';
import { MAX_DURATION_S, MAX_COMPRESSED_BYTES, DURATION_SLACK_S } from '../src/take/limits.ts';

function box(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  return out;
}
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
function mvhd(timescale: number, duration: number): Uint8Array {
  const b = new Uint8Array(100); const dv = new DataView(b.buffer);
  dv.setUint32(12, timescale); dv.setUint32(16, duration); // version 0: flags, ctime, mtime, timescale, duration
  return box('mvhd', b);
}
function mehd(duration: number): Uint8Array {
  const b = new Uint8Array(8); new DataView(b.buffer).setUint32(4, duration);
  return box('mehd', b);
}
const ftyp = box('ftyp', new TextEncoder().encode('isomiso6'));

test('readM4aDuration: mvhd duration is used when non-zero', () => {
  assert.equal(readM4aDuration(cat(ftyp, box('moov', mvhd(1000, 600_064)))), 600.064);
});

test('readM4aDuration: fragmented MP4 with mvhd duration 0 falls back to mvex/mehd', () => {
  assert.equal(readM4aDuration(cat(ftyp, box('moov', cat(mvhd(48000, 0), box('mvex', mehd(48000 * 700)))))), 700);
});

test('readM4aDuration: mvhd 0 and no mehd is unknown (null), not 0 s', () => {
  assert.equal(readM4aDuration(cat(ftyp, box('moov', mvhd(48000, 0)))), null);
});

test('limits: compressed byte cap is 600 s at 512 kbit/s plus 1 MiB; slack is 1 s', () => {
  assert.equal(MAX_COMPRESSED_BYTES, (MAX_DURATION_S * 512000) / 8 + 1024 * 1024);
  assert.equal(DURATION_SLACK_S, 1);
});

test('run_ts.ts take: a bad file is recorded and the rest of the directory still runs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eng-take-'));
  const out = mkdtempSync(join(tmpdir(), 'eng-take-out-'));
  writeFileSync(join(dir, 'a_bad.wav'), new TextEncoder().encode('not a wav at all'));
  // 16-bit mono 48 kHz, 0.1 s of silence
  const n = 4800, w = new Uint8Array(44 + 2 * n), dv = new DataView(w.buffer);
  const s = (o: number, t: string) => { for (let i = 0; i < 4; i++) w[o + i] = t.charCodeAt(i); };
  s(0, 'RIFF'); dv.setUint32(4, 36 + 2 * n, true); s(8, 'WAVE'); s(12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 48000, true); dv.setUint32(28, 96000, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); s(36, 'data'); dv.setUint32(40, 2 * n, true);
  writeFileSync(join(dir, 'b_good.wav'), w);
  const r = spawnSync('node', ['tools/run_ts.ts', 'take', dir, out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const summary = JSON.parse(r.stdout.trim().split('\n').pop()!);
  assert.equal(summary.errors.length, 1);
  assert.equal(summary.errors[0].code, 'not-wav');
  assert.equal(JSON.parse(readFileSync(join(out, 'b_good.json'), 'utf8')).status, 'no-pitch');
  assert.equal(JSON.parse(readFileSync(join(out, 'a_bad.json'), 'utf8')).error.code, 'not-wav');
});
