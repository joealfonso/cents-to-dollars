"""Reference F0 trackers: pYIN (librosa) and Praat autocorrelation (Parselmouth).

Writes frames JSON in the same format as tools/run_ts.ts:
    { method, file, sampleRate, hop, t: [...], f0: [...] }   f0 = 0 when unvoiced

Settings (MEASUREMENT.md section 7):
  pYIN : librosa.pyin, fmin 60, fmax 2000, frame_length 2048, hop 256 samples, centred frames,
         other parameters librosa defaults.
  Praat: Sound.to_pitch_ac (Praat "To Pitch (ac)"), time step 256 samples, pitch floor 60 Hz,
         pitch ceiling 2000 Hz, other parameters Praat defaults.
Audio is read at its original sample rate; nothing is resampled.

usage:
  .venv/bin/python py/reference.py <wav file or directory> <out_base_dir> [--methods pyin,praat] [--shard i/n]
  -> <out_base_dir>/pyin/<name>.json and <out_base_dir>/praat/<name>.json
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import soundfile as sf

HOP = 256
FMIN, FMAX = 60.0, 2000.0


def load(path: Path) -> tuple[np.ndarray, int]:
    x, sr = sf.read(path, dtype="float64", always_2d=True)
    return x.mean(axis=1), sr


def run_pyin(x: np.ndarray, sr: int) -> dict:
    import librosa

    f0, vflag, _ = librosa.pyin(x, fmin=FMIN, fmax=FMAX, sr=sr, frame_length=2048, hop_length=HOP, center=True)
    t = librosa.times_like(f0, sr=sr, hop_length=HOP)
    f0 = np.where(vflag & np.isfinite(f0), f0, 0.0)
    return {"t": t.round(6).tolist(), "f0": f0.round(5).tolist()}


def run_praat(x: np.ndarray, sr: int) -> dict:
    import parselmouth

    snd = parselmouth.Sound(x, sampling_frequency=sr)
    p = snd.to_pitch_ac(time_step=HOP / sr, pitch_floor=FMIN, pitch_ceiling=FMAX)
    f0 = p.selected_array["frequency"]  # 0 for unvoiced
    return {"t": np.asarray(p.xs()).round(6).tolist(), "f0": np.asarray(f0).round(5).tolist()}


def process(args: tuple[str, str, list[str]]) -> str:
    wav, out_base, methods = args
    x, sr = load(Path(wav))
    name = Path(wav).stem
    for m in methods:
        res = run_pyin(x, sr) if m == "pyin" else run_praat(x, sr)
        out = {"method": m, "file": wav, "sampleRate": sr, "hop": HOP, **res}
        d = Path(out_base) / m
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{name}.json").write_text(json.dumps(out))
    return name


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("out_base")
    ap.add_argument("--methods", default="pyin,praat")
    ap.add_argument("--shard", default="0/1", help="i/n: process every n-th file starting at i (run n processes for parallelism)")
    a = ap.parse_args()
    p = Path(a.input)
    wavs = sorted(str(f) for f in (p.rglob("*.wav") if p.is_dir() else [p]))
    methods = a.methods.split(",")
    si, sn = (int(v) for v in a.shard.split("/"))
    mine = wavs[si::sn]
    for i, w in enumerate(mine, 1):
        name = process((w, a.out_base, methods))
        if i % 25 == 0 or i == len(mine):
            print(f"shard {a.shard}: {i}/{len(mine)} {name}", flush=True)


if __name__ == "__main__":
    main()
