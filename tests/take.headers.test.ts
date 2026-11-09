// M2.1 container and rate sniffing. Written from specs/M2.md 4.3, 4.6 (F-06, F-07) and 4.8, and specs/M2.1-API.md.
//   F-06  readMp3Rate: 44100 and 48000, including files with an ID3v2 tag
//   F-07  readM4aRate: 44100 and 48000 for AAC-LC, "not confirmed" for HE-AAC with implicit SBR
// Fixtures are built byte by byte (tests/take.helpers.ts cites the MPEG audio and ISO BMFF layouts), and
// when `lame` / `afconvert` exist, real encoder output is checked too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  mp3Frames, mp3FramesLowRate, mp3XingFrame, adts, id3v2, concat, MP3_BAD_BITRATE_HEADER, MP3_RESERVED_RATE_HEADER, m4a, asc, tone, encodeWav,
  tmpDir, writeFile, haveBinary, rng,
} from './take.helpers.ts';

const hdrMod = () => import('../src/take/headers.ts');

// ------------------------------------------------------------------ MP3

test('F-06: readMp3Rate returns 44100 and 48000 for bare MPEG-1 Layer III frames', async () => {
  const { readMp3Rate } = await hdrMod();
  assert.equal(readMp3Rate(mp3Frames(44100)), 44100);
  assert.equal(readMp3Rate(mp3Frames(48000)), 48000);
  assert.equal(readMp3Rate(mp3Frames(32000)), 32000);
});

test('F-06: readMp3Rate skips an ID3v2 tag (v2.3 and v2.4, with and without footer)', async () => {
  const { readMp3Rate } = await hdrMod();
  for (const rate of [44100, 48000] as const) {
    const frames = mp3Frames(rate);
    for (const opts of [{ major: 3 as const }, { major: 4 as const }, { major: 4 as const, footer: true }]) {
      const tag = id3v2(new Uint8Array(300), opts);
      assert.equal(readMp3Rate(concat([tag, frames])), rate, `${rate} Hz, ID3v2.${opts.major}${opts.footer ? ' + footer' : ''}`);
    }
  }
});

test('F-06: readMp3Rate does not read a header-looking pattern inside the ID3v2 tag body', async () => {
  const { readMp3Rate } = await hdrMod();
  // Tag body holds a perfectly formed 48 kHz frame header (and a few follow-on frames); the real audio is 44.1 kHz.
  const decoy = mp3Frames(48000, 3);
  const body = concat([new Uint8Array(20), decoy, new Uint8Array(20)]);
  assert.equal(readMp3Rate(concat([id3v2(body), mp3Frames(44100)])), 44100);
  // And the other way round, so a reader that always answers one value cannot pass both.
  assert.equal(readMp3Rate(concat([id3v2(concat([new Uint8Array(20), mp3Frames(44100, 3)])), mp3Frames(48000)])), 48000);
});

test('F-06: readMp3Rate takes the first VALID frame (skips sync-looking bytes with a bad bitrate or reserved rate index)', async () => {
  const { readMp3Rate } = await hdrMod();
  const junk = (h: number[]) => concat([new Uint8Array(5), new Uint8Array(h), new Uint8Array(10)]);
  assert.equal(readMp3Rate(concat([junk(MP3_BAD_BITRATE_HEADER), mp3Frames(48000)])), 48000);
  assert.equal(readMp3Rate(concat([junk(MP3_RESERVED_RATE_HEADER), mp3Frames(44100)])), 44100);
});

test('F-06: readMp3Rate returns null when there is no MPEG audio frame', async () => {
  const { readMp3Rate } = await hdrMod();
  assert.equal(readMp3Rate(new Uint8Array(0)), null);
  assert.equal(readMp3Rate(new Uint8Array(2000)), null);
  assert.equal(readMp3Rate(id3v2(new Uint8Array(100))), null, 'a tag with nothing after it');
  const rand = rng(11);
  // Random bytes with every 0xFF forced to 0x00 can contain no sync word.
  assert.equal(readMp3Rate(Uint8Array.from({ length: 4000 }, () => { const v = Math.floor(rand() * 256); return v === 255 ? 0 : v; })), null);
});

const lameOk = haveBinary('lame');
for (const rate of [44100, 48000]) {
  test(`F-06: readMp3Rate on real lame output at ${rate} Hz, bare and with an ID3v2 tag`, { skip: lameOk ? false : 'lame binary not installed' }, async () => {
    const { readMp3Rate } = await hdrMod();
    const dir = tmpDir('take-lame-');
    const wav = writeFile(dir, 'in.wav', encodeWav({ sampleRate: rate, channels: [tone({ sr: rate, dur: 0.6, f0: 220 })], format: 'pcm16' }));
    // --resample keeps lame from picking its own output rate; -b 128 CBR.
    const bare = join(dir, 'bare.mp3');
    let r = spawnSync('lame', ['--quiet', '-b', '128', '--resample', String(rate / 1000), '--noreplaygain', wav, bare]);
    assert.equal(r.status, 0, String(r.stderr));
    assert.equal(readMp3Rate(readFileSync(bare)), rate, 'bare');
    const tagged = join(dir, 'tagged.mp3');
    r = spawnSync('lame', ['--quiet', '-b', '128', '--resample', String(rate / 1000), '--add-id3v2', '--tt', 'a title that makes the tag non-trivial', '--ta', 'artist', wav, tagged]);
    assert.equal(r.status, 0, String(r.stderr));
    const bytes = readFileSync(tagged);
    assert.equal(String.fromCharCode(bytes[0], bytes[1], bytes[2]), 'ID3', 'lame wrote an ID3v2 tag');
    assert.equal(readMp3Rate(bytes), rate, 'tagged');
  });
}

// ------------------------------------------------------------------ M4A

test('F-07: readM4aRate returns 44100 and 48000 for AAC-LC and confirms them', async () => {
  const { readM4aRate } = await hdrMod();
  for (const rate of [44100, 48000]) {
    const got = readM4aRate(m4a({ rate, asc: asc('lc', rate) }));
    assert.deepEqual(got, { rate, confirmed: true }, `${rate} Hz AAC-LC`);
  }
});

test('F-07: readM4aRate finds the esds when mdat comes before moov, and for mono', async () => {
  const { readM4aRate } = await hdrMod();
  assert.deepEqual(readM4aRate(m4a({ rate: 48000, asc: asc('lc', 48000, 1), channels: 1, mdatFirst: true })), { rate: 48000, confirmed: true });
  assert.deepEqual(readM4aRate(m4a({ rate: 44100, asc: asc('lc', 44100), mdatFirst: true })), { rate: 44100, confirmed: true });
});

test('F-07: HE-AAC with implicit SBR (AAC-LC config at the half rate, no extension) is flagged not confirmed', async () => {
  const { readM4aRate } = await hdrMod();
  // The file says AAC-LC at 24 kHz; an HE-AAC decoder outputs 48 kHz. Nothing in the header says so (implicit signalling).
  const got = readM4aRate(m4a({ rate: 24000, asc: asc('lc', 24000) }));
  assert.ok(got, 'a rate is read');
  assert.equal(got.confirmed, false, 'implicit SBR is possible, so the rate is not confirmed');
});

test('4.3: for implicit-SBR HE-AAC the header rate (24000) is what is reported, not a guessed doubled rate', async () => {
  const { readM4aRate } = await hdrMod();
  const got = readM4aRate(m4a({ rate: 24000, asc: asc('lc', 24000) }));
  assert.equal(got?.rate, 24000);
});

test('4.3: explicit SBR signalling uses the doubled (output) rate and counts as confirmed', async () => {
  const { readM4aRate } = await hdrMod();
  // AudioSpecificConfig with AOT 5 (SBR): core 24 kHz, extension (output) 48 kHz. Sample entry says 24000 as many muxers do.
  const got = readM4aRate(m4a({ rate: 24000, asc: asc('sbr-explicit', 48000) }));
  assert.deepEqual(got, { rate: 48000, confirmed: true });
  const got2 = readM4aRate(m4a({ rate: 22050, asc: asc('sbr-explicit', 44100) }));
  assert.deepEqual(got2, { rate: 44100, confirmed: true });
});

test('F-07: readM4aRate returns null for bytes that are not an MP4 with an audio sample entry', async () => {
  const { readM4aRate } = await hdrMod();
  assert.equal(readM4aRate(new Uint8Array(0)), null);
  assert.equal(readM4aRate(new Uint8Array(500)), null);
  const full = m4a({ rate: 44100, asc: asc('lc', 44100) });
  assert.equal(readM4aRate(full.subarray(0, 40)), null, 'truncated inside ftyp/moov header');
  const rand = rng(5);
  assert.equal(readM4aRate(Uint8Array.from({ length: 800 }, () => Math.floor(rand() * 256))), null);
});

const afOk = haveBinary('afconvert', ['-h']);
for (const rate of [44100, 48000]) {
  test(`F-07: readM4aRate on real afconvert AAC-LC output at ${rate} Hz`, { skip: afOk ? false : 'afconvert not available' }, async (t) => {
    const { readM4aRate } = await hdrMod();
    const dir = tmpDir('take-af-');
    const wav = writeFile(dir, 'in.wav', encodeWav({ sampleRate: rate, channels: [tone({ sr: rate, dur: 0.6, f0: 220 })], format: 'pcm16' }));
    const out = join(dir, 'out.m4a');
    const r = spawnSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '128000', wav, out], { encoding: 'utf8' });
    if (r.status !== 0) {
      // Inside the Claude Code Bash sandbox afconvert lists no AAC encoder ("format 'aac' is unknown"); it works outside it.
      t.skip(`afconvert could not encode AAC here: ${String(r.stderr).split('\n')[0]}`);
      return;
    }
    assert.deepEqual(readM4aRate(readFileSync(out)), { rate, confirmed: true });
  });
}


test('F-06: readMp3Rate reads the rate when the first frame is a Xing or Info frame (VBR/CBR header), alone or followed by audio', async () => {
  const { readMp3Rate } = await hdrMod();
  for (const rate of [44100, 48000] as const) {
    for (const tag of ['Xing', 'Info'] as const) {
      assert.equal(readMp3Rate(concat([mp3XingFrame(rate, tag), mp3Frames(rate, 3)])), rate, `${tag} then frames, ${rate}`);
      assert.equal(readMp3Rate(mp3XingFrame(rate, tag)), rate, `${tag} frame alone, ${rate}`);
      assert.equal(readMp3Rate(concat([id3v2(new Uint8Array(64)), mp3XingFrame(rate, tag), mp3Frames(rate, 2)])), rate, `ID3 + ${tag}, ${rate}`);
    }
  }
});

test('4.3: readMp3Rate returns the MPEG-2 and MPEG-2.5 rates (22.05, 24, 16 kHz and 11.025, 12, 8 kHz)', async () => {
  const { readMp3Rate } = await hdrMod();
  for (const rate of [22050, 24000, 16000, 11025, 12000, 8000] as const) {
    assert.equal(readMp3Rate(mp3FramesLowRate(rate)), rate, `${rate} Hz`);
  }
});

// ADTS (.aac raw stream): sync 0xFFF1, rate from sampling_frequency_index. Spec 4.3: a rate that can be read is never treated as unknown.
test('4.3: an ADTS stream has its rate read from the header (44.1 and 48 kHz confirmed), not treated as unknown', async () => {
  const { readM4aRate, sniffContainer } = await hdrMod();
  for (const rate of [44100, 48000]) {
    const bytes = adts(rate);
    assert.deepEqual(readM4aRate(bytes), { rate, confirmed: true }, `${rate} Hz ADTS`);
    assert.notEqual(sniffContainer(bytes), 'unknown', `${rate} Hz ADTS is recognised as a container`);
  }
});

test('4.3: an ADTS stream with a core rate of 24 kHz or less and no SBR signalled is flagged not confirmed; 32 kHz is confirmed', async () => {
  const { readM4aRate } = await hdrMod();
  assert.deepEqual(readM4aRate(adts(24000)), { rate: 24000, confirmed: false });
  assert.deepEqual(readM4aRate(adts(22050)), { rate: 22050, confirmed: false });
  assert.deepEqual(readM4aRate(adts(32000)), { rate: 32000, confirmed: true });
});

test('4.3 boundary (specs/M2.1-API.md decision): M4A AAC-LC core of 24 kHz or less is not confirmed, above it is confirmed', async () => {
  const { readM4aRate } = await hdrMod();
  assert.deepEqual(readM4aRate(m4a({ rate: 24000, asc: asc('lc', 24000) })), { rate: 24000, confirmed: false });
  assert.deepEqual(readM4aRate(m4a({ rate: 22050, asc: asc('lc', 22050) })), { rate: 22050, confirmed: false });
  assert.deepEqual(readM4aRate(m4a({ rate: 16000, asc: asc('lc', 16000) })), { rate: 16000, confirmed: false });
  assert.deepEqual(readM4aRate(m4a({ rate: 32000, asc: asc('lc', 32000) })), { rate: 32000, confirmed: true });
  assert.deepEqual(readM4aRate(m4a({ rate: 44100, asc: asc('lc', 44100) })), { rate: 44100, confirmed: true });
});

test('4.3: readM4aRate on real afconvert ADTS output reads the rate', { skip: afOk ? false : 'afconvert not available' }, async (t) => {
  const { readM4aRate } = await hdrMod();
  for (const rate of [44100, 48000]) {
    const dir = tmpDir('take-adts-');
    const wav = writeFile(dir, 'in.wav', encodeWav({ sampleRate: rate, channels: [tone({ sr: rate, dur: 0.6, f0: 220 })], format: 'pcm16' }));
    const out = join(dir, 'out.aac');
    const r = spawnSync('afconvert', ['-f', 'adts', '-d', 'aac', '-b', '128000', wav, out], { encoding: 'utf8' });
    if (r.status !== 0) { t.skip(`afconvert could not encode ADTS here: ${String(r.stderr).split('\n')[0]}`); return; }
    assert.deepEqual(readM4aRate(readFileSync(out)), { rate, confirmed: true }, `${rate} Hz`);
  }
});

// ------------------------------------------------------------------ container sniffing

test('sniffContainer identifies containers by magic bytes', async () => {
  const { sniffContainer } = await hdrMod();
  const wav = encodeWav({ sampleRate: 48000, channels: [new Float64Array(100)], format: 'pcm16' });
  assert.equal(sniffContainer(wav), 'wav');
  assert.equal(sniffContainer(mp3Frames(44100)), 'mp3');
  assert.equal(sniffContainer(concat([id3v2(new Uint8Array(50)), mp3Frames(44100)])), 'mp3', 'ID3v2 then frames');
  assert.equal(sniffContainer(m4a({ rate: 44100, asc: asc('lc', 44100) })), 'm4a');
  assert.equal(sniffContainer(new Uint8Array(0)), 'unknown');
  assert.equal(sniffContainer(new Uint8Array(100)), 'unknown');
  assert.equal(sniffContainer(new TextEncoder().encode('hello, this is text')), 'unknown');
});
