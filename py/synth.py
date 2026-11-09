"""Synthetic test signals with known F0, vibrato rate and vibrato extent.

Writes 32-bit float WAVs plus fixtures/synthetic/manifest.json with the exact parameters.
Ground truth instantaneous frequency (MEASUREMENT.md section 6):

    f(t) = f0 * 2 ** ((E / 1200) * sin(2 * pi * r * t))

where E is the plus-or-minus extent in cents and r the rate in Hz (E = 0 for steady tones).
Phase is the running integral of f(t), so the waveform frequency equals f(t) at every sample.
Every set is deterministic (fixed seed).

usage: .venv/bin/python py/synth.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "fixtures" / "synthetic"
FADE_S = 0.02
AMP = 0.5
rng = np.random.default_rng(20261108)


def inst_freq(t: np.ndarray, f0: float, rate: float, extent: float) -> np.ndarray:
    if extent == 0:
        return np.full_like(t, f0)
    return f0 * 2.0 ** ((extent / 1200.0) * np.sin(2 * np.pi * rate * t))


def render(sr: int, dur: float, f0: float, rate=0.0, extent=0.0, harmonics=None, snr_db=None) -> np.ndarray:
    n = int(round(sr * dur))
    t = np.arange(n) / sr
    f = inst_freq(t, f0, rate, extent)
    phase = 2 * np.pi * np.concatenate([[0.0], np.cumsum(f[:-1]) / sr])
    if harmonics is None:
        x = np.sin(phase)
    else:
        x = np.zeros(n)
        for k, a in harmonics:
            # skip partials that would cross Nyquist at the top of the vibrato
            if k * f0 * 2 ** (abs(extent) / 1200) >= 0.45 * sr:
                continue
            x += a * np.sin(k * phase + rng.uniform(0, 2 * np.pi))
    x = AMP * x / np.max(np.abs(x))
    if snr_db is not None:
        p_sig = np.mean(x ** 2)
        x = x + rng.normal(0, np.sqrt(p_sig / 10 ** (snr_db / 10)), n)
    nf = int(FADE_S * sr)
    ramp = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, nf))
    x[:nf] *= ramp
    x[-nf:] *= ramp[::-1]
    return x.astype(np.float32)


def expected_band_ratio_db(f0: float, harmonics, band=(2500, 3500), ref=(50, 2000)) -> float:
    num = sum(a * a for k, a in harmonics if band[0] <= k * f0 < band[1])
    den = sum(a * a for k, a in harmonics if ref[0] <= k * f0 < ref[1])
    return float(10 * np.log10(num / den))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    entries = []

    def add(set_name: str, sr: int, dur: float, f0: float, rate=0.0, extent=0.0, harmonics=None, snr_db=None, **extra):
        idx = sum(1 for e in entries if e["set"] == set_name)
        fid = f"{set_name}_{idx:03d}"
        rel = f"{set_name}/{fid}.wav"
        (OUT / set_name).mkdir(exist_ok=True)
        sf.write(OUT / rel, render(sr, dur, f0, rate, extent, harmonics, snr_db), sr, subtype="FLOAT")
        entries.append(dict(id=fid, set=set_name, file=rel, sr=sr, dur=dur, f0=f0, rate=rate, extent=extent,
                            harmonics=None if harmonics is None else [[k, a] for k, a in harmonics],
                            snr_db=snr_db, fade_s=FADE_S, **extra))

    # Steady tones over the threshold range 130 to 1050 Hz: every 12-TET note C3..C6 (A4 = 440),
    # both range endpoints, and 21 log-uniform off-grid frequencies.
    semis = [440 * 2 ** ((m - 69) / 12) for m in range(48, 85)]  # C3 .. C6
    offgrid = list(np.exp(rng.uniform(np.log(130), np.log(1050), 21)))
    tone_freqs = sorted(semis + [130.0, 1050.0] + offgrid)
    harm = [(k, 1.0 / k) for k in range(1, 41)]

    for f in tone_freqs:
        add("tone_sine_48k", 48000, 1.0, float(f))
    for f in tone_freqs:
        add("tone_sine_44k", 44100, 1.0, float(f))
    # Extra robustness sets (not part of the pass thresholds)
    for f in tone_freqs:
        add("tone_harm_48k", 48000, 1.0, float(f), harmonics=harm)
    for f in tone_freqs:
        add("tone_noise20_48k", 48000, 1.0, float(f), snr_db=20.0)
    # Above the threshold range, for a soprano top (C#6 .. A6). Reported, not scored against thresholds.
    for m in range(85, 94):
        add("tone_high_48k", 48000, 1.0, 440 * 2 ** ((m - 69) / 12))

    # Vibrato grid: rates 4.5..7.5 Hz, extents plus or minus 30..100 cents, three carrier pitches.
    for f0 in (220.0, 440.0, 880.0):
        for rate in (4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 7.5):
            for ext in (30.0, 50.0, 75.0, 100.0):
                add("vib_sine_48k", 48000, 3.0, f0, rate, ext)
    for rate in (4.5, 5.5, 6.5, 7.5):
        for ext in (30.0, 100.0):
            add("vib_harm_48k", 48000, 3.0, 440.0, rate, ext, harmonics=harm)

    # Singer's formant band ratio: harmonic tones with a known gain applied to partials in 2.5-3.5 kHz.
    # f0 chosen so no partial lies within 90 Hz of a band edge (limits window leakage across edges).
    for f0 in (262.0, 523.25):
        for g in (0.25, 1.0, 4.0):
            hs = [(k, (1.0 / k) * (g if 2500 <= k * f0 < 3500 else 1.0)) for k in range(1, 41) if k * f0 < 20000]
            add("sf_48k", 48000, 1.0, f0, harmonics=hs, sf_gain=g, expected_sf_db=expected_band_ratio_db(f0, hs))

    # Latency: 0.5 s silence then a 440 Hz tone (onset sample recorded).
    n_sil = 24000
    x = np.concatenate([np.zeros(n_sil, np.float32), render(48000, 1.0, 440.0)])
    x[n_sil:n_sil + 48] *= np.linspace(0, 1, 48, dtype=np.float32)  # 1 ms ramp instead of the 20 ms fade
    (OUT / "latency").mkdir(exist_ok=True)
    sf.write(OUT / "latency/latency_440.wav", x, 48000, subtype="FLOAT")
    entries.append(dict(id="latency_440", set="latency", file="latency/latency_440.wav", sr=48000, dur=1.5,
                        f0=440.0, rate=0.0, extent=0.0, harmonics=None, snr_db=None, fade_s=0.0, onset_sample=n_sil))

    (OUT / "manifest.json").write_text(json.dumps({"generator": "py/synth.py", "amp": AMP, "entries": entries}, indent=1))
    by_set = {}
    for e in entries:
        by_set[e["set"]] = by_set.get(e["set"], 0) + 1
    print(json.dumps(by_set))


if __name__ == "__main__":
    main()
