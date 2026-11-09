"""Score every tracker against the M1 criteria and write results/summary.json + results/tables.md.

Inputs (produced earlier):
  results/ts/*.json, results/pyin/*.json, results/praat/*.json      synthetic fixtures
  results/vocadito/{ts,pyin,praat}/*.json                           Vocadito tracks
  results/spectrum_check.json                                       tools/spectrum_check.ts
Optional:
  results/raw/{ts,praat}/*.json                                     her recordings, when ./data/raw exists

usage: .venv/bin/python py/score.py
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "results"
MAN = json.loads((ROOT / "fixtures/synthetic/manifest.json").read_text())
METHODS = {"ts": "whole take (YIN + continuity)", "tsyin": "live (plain YIN)", "pyin": "pYIN (librosa)", "praat": "Praat ac (Parselmouth)"}
EDGE_S = 0.07  # frames this close to either end (inside the 20 ms fades plus margin) are excluded
OCTAVE_CENTS = 600.0  # an estimate more than half an octave from truth counts as an octave error
GROSS_CENTS = 50.0

THRESH = dict(tone_median=5.0, tone_p95=15.0, tone_octave=0, vib_rate=0.3, vib_extent_rel=0.10,
              praat_within=10.0, praat_frac=0.95)


def frames(method: str, fid: str, base: Path = RES) -> dict | None:
    p = base / method / f"{fid}.json"
    return json.loads(p.read_text()) if p.exists() else None


def truth(e: dict, t: np.ndarray) -> np.ndarray:
    if e["extent"] == 0:
        return np.full_like(t, e["f0"])
    return e["f0"] * 2.0 ** ((e["extent"] / 1200.0) * np.sin(2 * np.pi * e["rate"] * t))


def frame_errors(e: dict, fr: dict) -> tuple[np.ndarray, int]:
    t = np.asarray(fr["t"], float)
    f = np.asarray(fr["f0"], float)
    keep = (t >= EDGE_S) & (t <= e["dur"] - EDGE_S)
    t, f = t[keep], f[keep]
    v = f > 0
    err = 1200 * np.log2(f[v] / truth(e, t[v]))
    return err, int(keep.sum())


def stats(err: np.ndarray) -> dict:
    a = np.abs(err)
    if a.size == 0:
        return dict(n=0)
    return dict(n=int(a.size), median=float(np.median(a)), p95=float(np.percentile(a, 95)), max=float(a.max()),
                mean_signed=float(err.mean()), gross=int((a > GROSS_CENTS).sum()), octave=int((a > OCTAVE_CENTS).sum()))


def score_tones(set_name: str) -> dict:
    out = {}
    entries = [e for e in MAN["entries"] if e["set"] == set_name]
    for m in METHODS:
        all_err, n_frames, per_file = [], 0, []
        for e in entries:
            fr = frames(m, e["id"])
            if fr is None:
                continue
            err, nf = frame_errors(e, fr)
            all_err.append(err)
            n_frames += nf
            s = stats(err)
            per_file.append(dict(id=e["id"], f0=e["f0"], voiced=s.get("n", 0) / max(nf, 1), **s))
        if not per_file:
            continue
        err = np.concatenate(all_err)
        s = stats(err)
        s["voicing_recall"] = float(err.size / max(n_frames, 1))
        s["files"] = len(per_file)
        worst = sorted(per_file, key=lambda r: -(r.get("p95") or 1e9))[:5]
        out[m] = dict(summary=s, worst=worst)
    return out


def run_vibrato(paths: list[str]) -> dict:
    res = {}
    for i in range(0, len(paths), 200):
        chunk = paths[i:i + 200]
        r = subprocess.run(["node", "tools/run_ts.ts", "vibrato", *chunk], cwd=ROOT, capture_output=True, text=True, check=True)
        res.update(json.loads(r.stdout))
    return res


def score_vibrato(set_name: str) -> dict:
    entries = [e for e in MAN["entries"] if e["set"] == set_name]
    out = {}
    for m in METHODS:
        paths = [str(RES / m / f"{e['id']}.json") for e in entries if (RES / m / f"{e['id']}.json").exists()]
        if not paths:
            continue
        vib = run_vibrato(paths)
        rows, contour = [], []
        for e in entries:
            p = str(RES / m / f"{e['id']}.json")
            if p not in vib:
                continue
            v = vib[p]
            fr = frames(m, e["id"])
            err, _ = frame_errors(e, fr)
            contour.append(err)
            if v is None:
                rows.append(dict(id=e["id"], f0=e["f0"], rate=e["rate"], extent=e["extent"], detected=False))
                continue
            rows.append(dict(id=e["id"], f0=e["f0"], rate=e["rate"], extent=e["extent"], detected=True,
                             rate_est=v["rateHz"], extent_est=v["extentCents"],
                             rate_err=v["rateHz"] - e["rate"], extent_rel_err=(v["extentCents"] - e["extent"]) / e["extent"]))
        det = [r for r in rows if r["detected"]]
        re_ = np.array([abs(r["rate_err"]) for r in det]) if det else np.array([np.nan])
        ee = np.array([abs(r["extent_rel_err"]) for r in det]) if det else np.array([np.nan])
        fails = [r for r in rows if not r["detected"] or abs(r["rate_err"]) > THRESH["vib_rate"] or abs(r["extent_rel_err"]) > THRESH["vib_extent_rel"]]
        out[m] = dict(
            summary=dict(cases=len(rows), detected=len(det), rate_err_median=float(np.median(re_)), rate_err_max=float(np.max(re_)),
                         extent_rel_err_median=float(np.median(ee)), extent_rel_err_max=float(np.max(ee)),
                         extent_signed_mean=float(np.mean([r["extent_rel_err"] for r in det])) if det else None,
                         failing=len(fails), contour=stats(np.concatenate(contour))),
            failing=fails, rows=rows)
    return out


def score_sf() -> dict:
    rows = []
    for e in MAN["entries"]:
        if e["set"] != "sf_48k":
            continue
        fr = frames("ts", e["id"])
        rows.append(dict(id=e["id"], f0=e["f0"], gain=e["sf_gain"], expected_db=e["expected_sf_db"], measured_db=fr["sfRatioDb"],
                         err_db=fr["sfRatioDb"] - e["expected_sf_db"]))
    return dict(rows=rows, max_abs_err_db=max(abs(r["err_db"]) for r in rows))


def score_spectrum() -> dict:
    rows = json.loads((RES / "spectrum_check.json").read_text())
    err = np.array([r["errCents"] for r in rows])
    lvl = np.array([r["peakDbfs"] - r["expectedDbfs"] for r in rows])
    return dict(n=len(rows), peak_err_cents_median=float(np.median(np.abs(err))), peak_err_cents_max=float(np.max(np.abs(err))),
                level_err_db_min=float(lvl.min()), level_err_db_max=float(lvl.max()))


def score_latency(m: str = "ts") -> dict:
    e = next(x for x in MAN["entries"] if x["set"] == "latency")
    fr = frames(m, e["id"])
    sr, onset = e["sr"], e["onset_sample"]
    hop, N = fr["hop"], 2048
    out = {}
    for tol in (50.0, 10.0):
        for i, f in enumerate(fr["f0"]):
            start = i * hop
            if f > 0 and abs(1200 * np.log2(f / e["f0"])) <= tol and start + N > onset:
                out[f"first_within_{int(tol)}c_ms"] = float((start + N - onset) / sr * 1000)
                break
    out["note"] = "time from tone onset until the first estimate within tolerance is final (end of the analysis buffer; live is plain YIN, no lookahead)"
    out["hop_ms"] = hop / sr * 1000
    out["buffer_ms"] = N / sr * 1000
    return out


def melody_eval(track_dir: Path, ann_dir: Path) -> dict:
    import mir_eval

    out = {}
    tracks = sorted(p.stem.replace("_f0", "") for p in ann_dir.glob("*_f0.csv"))
    for m in METHODS:
        per = []
        for tr in tracks:
            fr = frames(m, tr, track_dir)
            if fr is None:
                continue
            ref = np.loadtxt(ann_dir / f"{tr}_f0.csv", delimiter=",")
            sc = mir_eval.melody.evaluate(ref[:, 0], ref[:, 1], np.asarray(fr["t"], float), np.asarray(fr["f0"], float))
            per.append(dict(track=tr, **{k: float(v) for k, v in sc.items()}))
        if not per:
            continue
        keys = [k for k in per[0] if k != "track"]
        out[m] = dict(tracks=len(per), mean={k: float(np.mean([p[k] for p in per])) for k in keys},
                      worst_rpa=sorted(per, key=lambda p: p["Raw Pitch Accuracy"])[:5])
    return out


def praat_agreement(base: Path, a: str = "ts", b: str = "praat", tol_s: float = 0.003) -> dict:
    """Frame agreement: for each Praat frame, the nearest tracker frame within tol_s; both voiced."""
    per, all_d = [], []
    for pb in sorted((base / b).glob("*.json")):
        pa = base / a / pb.name
        if not pa.exists():
            continue
        A, B = json.loads(pa.read_text()), json.loads(pb.read_text())
        ta, fa = np.asarray(A["t"], float), np.asarray(A["f0"], float)
        tb, fb = np.asarray(B["t"], float), np.asarray(B["f0"], float)
        idx = np.clip(np.searchsorted(ta, tb), 1, len(ta) - 1)
        left = np.abs(ta[idx - 1] - tb) <= np.abs(ta[idx] - tb)
        idx = np.where(left, idx - 1, idx)
        close = np.abs(ta[idx] - tb) <= tol_s
        both = close & (fb > 0) & (fa[idx] > 0)
        d = 1200 * np.log2(fa[idx][both] / fb[both])
        all_d.append(d)
        va, vb = (fa[idx] > 0) & close, (fb > 0) & close
        per.append(dict(file=pb.stem, joint_voiced=int(both.sum()),
                        within10=float(np.mean(np.abs(d) <= 10)) if d.size else None,
                        median_abs=float(np.median(np.abs(d))) if d.size else None,
                        voicing_agreement=float(np.mean(va == vb)) if close.any() else None))
    if not per:
        return {}
    d = np.concatenate(all_d)
    a_ = np.abs(d)
    return dict(files=len(per), joint_voiced_frames=int(d.size), within10=float(np.mean(a_ <= 10)), within50=float(np.mean(a_ <= 50)),
                median_abs=float(np.median(a_)), p95_abs=float(np.percentile(a_, 95)), octave=int((a_ > OCTAVE_CENTS).sum()),
                mean_signed=float(d.mean()),
                worst=sorted([p for p in per if p["within10"] is not None], key=lambda p: p["within10"])[:5])


def score_vibrato_windows() -> dict:
    """M2.1 vibrato over time (specs/M2.md 4.6 F-24 to F-26) on results/take/*.json from `run_ts.ts take`.
    F-24 vib_long_48k: every span inside [EDGE_S, dur - EDGE_S] meets the M1 vibrato thresholds.
    F-25 vib_change_48k: every span inside one half (and inside the edge margin) meets them against that half's
    values; spans that straddle the change or an edge margin are counted but not scored.
    F-26 steady_long_48k: every span reports none found. A span with no vibrato found fails F-24 and F-25."""
    take = RES / "take"
    out = {}

    def check(e, w, rate, extent):
        if w["rateHz"] is None:
            return dict(id=e["id"], t0=w["t0"], t1=w["t1"], rate=rate, extent=extent, found=False)
        re_, ee = w["rateHz"] - rate, (w["extentCents"] - extent) / extent
        ok = abs(re_) <= THRESH["vib_rate"] and abs(ee) <= THRESH["vib_extent_rel"]
        return dict(id=e["id"], t0=w["t0"], t1=w["t1"], rate=rate, extent=extent, found=True, rate_est=w["rateHz"],
                    extent_est=w["extentCents"], rate_err=re_, extent_rel_err=ee, ok=ok)

    for crit, set_name in (("F-24", "vib_long_48k"), ("F-25", "vib_change_48k"), ("F-26", "steady_long_48k")):
        entries = [e for e in MAN["entries"] if e["set"] == set_name]
        rows, unscored, missing, total = [], 0, [], 0
        for e in entries:
            p = take / f"{e['id']}.json"
            if not p.exists():
                missing.append(e["id"])
                continue
            j = json.loads(p.read_text())
            if "error" in j:  # run_ts.ts take recorded a failure for this file
                missing.append(e["id"])
                continue
            dur = j["durationS"]
            for w in j["vibrato"]:
                total += 1
                if crit == "F-26":
                    rows.append(dict(id=e["id"], t0=w["t0"], t1=w["t1"], found=w["rateHz"] is not None, rate_est=w["rateHz"],
                                     extent_est=w["extentCents"], ok=w["rateHz"] is None))
                    continue
                segs = e.get("segments") or [dict(t0=0.0, t1=dur, rate=e["rate"], extent=e["extent"])]
                seg = next((s for s in segs if w["t0"] >= max(s["t0"], EDGE_S) - 1e-9 and w["t1"] <= min(s["t1"], dur - EDGE_S) + 1e-9), None)
                if seg is None:
                    unscored += 1
                    continue
                r = check(e, w, seg["rate"], seg["extent"])
                r["ok"] = r.get("ok", False)
                rows.append(r)
        found = [r for r in rows if r["found"]]
        fails = [r for r in rows if not r["ok"]]
        summ = dict(set=set_name, files=len(entries) - len(missing), missing=missing, spans_total=total, spans_scored=len(rows),
                    spans_not_scored=unscored, spans_found=len(found), spans_failing=len(fails),
                    verdict="pass" if rows and not fails and not missing else "fail")
        if crit != "F-26" and found:
            summ.update(rate_err_max=float(max(abs(r["rate_err"]) for r in found)),
                        extent_rel_err_max=float(max(abs(r["extent_rel_err"]) for r in found)),
                        rate_err_median=float(np.median([abs(r["rate_err"]) for r in found])),
                        extent_rel_err_median=float(np.median([abs(r["extent_rel_err"]) for r in found])))
        out[crit] = dict(summary=summ, failing=fails)
    out["span_s"] = 2.5
    out["step_s"] = 0.5
    out["edge_s"] = EDGE_S
    out["thresholds"] = dict(rate_hz=THRESH["vib_rate"], extent_rel=THRESH["vib_extent_rel"])
    return out


def fmt(x, nd=2):
    return "n/a" if x is None else (f"{x:.{nd}f}" if isinstance(x, float) else str(x))


def main() -> None:
    subprocess.run(["node", "tools/spectrum_check.ts"], cwd=ROOT, check=True)
    S = dict(thresholds=THRESH)
    S["tones"] = {s: score_tones(s) for s in ("tone_sine_48k", "tone_sine_44k", "tone_harm_48k", "tone_noise20_48k", "tone_high_48k")}
    S["vibrato"] = {s: score_vibrato(s) for s in ("vib_sine_48k", "vib_harm_48k")}
    S["sf"] = score_sf()
    S["spectrum"] = score_spectrum()
    S["latency"] = {"live": score_latency("tsyin")}
    voc = RES / "vocadito"
    S["vocadito_mir_eval"] = melody_eval(voc, ROOT / "datasets/vocadito/Annotations/F0")
    S["vocadito_praat_agreement"] = {m: praat_agreement(voc, m) for m in ("ts", "tsyin")}
    S["vocadito_pyin_vs_praat"] = praat_agreement(voc, "pyin", "praat")
    S["raw_praat_agreement"] = {m: praat_agreement(RES / "raw", m) for m in ("ts", "tsyin")} if (RES / "raw").exists() else None
    # Criterion 3 (Praat agreement >= praat_frac within praat_within cents), explicit per path.
    paths = {"whole_take": ("ts", "whole take (YIN + continuity)"), "live": ("tsyin", "live (plain YIN)")}
    S["criterion3"] = {}
    for name, (m, label) in paths.items():
        row = dict(label=label, method=m, threshold=THRESH["praat_frac"], within_cents=THRESH["praat_within"])
        for src, agree in (("vocadito", S["vocadito_praat_agreement"].get(m)), ("raw", (S["raw_praat_agreement"] or {}).get(m))):
            if agree:
                row[src] = dict(within10=agree["within10"], joint_voiced_frames=agree["joint_voiced_frames"],
                                verdict="pass" if agree["within10"] >= THRESH["praat_frac"] else "fail")
        S["criterion3"][name] = row
    # M2.1 (specs/M2.md 4.7): Node parity from tools/m2_parity.ts, vibrato spans from run_ts.ts take.
    par = RES / "m2_parity.json"
    parity = json.loads(par.read_text()) if par.exists() else None
    if parity is not None:
        parity = {k: v for k, v in parity.items() if k != "perFile"}  # per-file rows stay in results/m2_parity.json
    S["m2"] = dict(parity=parity, vibrato_windows=score_vibrato_windows())
    (RES / "summary.json").write_text(json.dumps(S, indent=1))

    L = []
    L.append("## Synthetic steady tones (pooled frames, |error| in cents)\n")
    L.append("| Set | Method | Frames | Voicing recall | Median | P95 | Max | Gross >50c | Octave >600c |")
    L.append("|---|---|---|---|---|---|---|---|---|")
    for sname, d in S["tones"].items():
        for m, r in d.items():
            s = r["summary"]
            L.append(f"| {sname} | {METHODS[m]} | {s['n']} | {s['voicing_recall']:.4f} | {fmt(s.get('median'),3)} | {fmt(s.get('p95'),3)} | {fmt(s.get('max'),2)} | {s.get('gross')} | {s.get('octave')} |")
    L.append("\n## Synthetic vibrato\n")
    L.append("| Set | Method | Cases | Detected | Rate err median (Hz) | Rate err max (Hz) | Extent err median | Extent err max | Mean signed extent err | Failing cases |")
    L.append("|---|---|---|---|---|---|---|---|---|---|")
    for sname, d in S["vibrato"].items():
        for m, r in d.items():
            s = r["summary"]
            L.append(f"| {sname} | {METHODS[m]} | {s['cases']} | {s['detected']} | {s['rate_err_median']:.4f} | {s['rate_err_max']:.4f} | {100*s['extent_rel_err_median']:.2f}% | {100*s['extent_rel_err_max']:.2f}% | {100*s['extent_signed_mean']:+.2f}% | {s['failing']} |")
    L.append("\n## Criterion 3: Praat agreement, within 10 c on >= 95% of jointly voiced frames (Vocadito stand-in)\n")
    L.append("| Path | Within 10 c | Joint voiced frames | Verdict |")
    L.append("|---|---|---|---|")
    for r in S["criterion3"].values():
        v = r.get("vocadito")
        if v:
            L.append(f"| {r['label']} | {100*v['within10']:.2f}% | {v['joint_voiced_frames']} | {v['verdict']} |")
    L.append("\n## M2.1 parity (F-01 to F-03) and vibrato spans (F-24 to F-26)\n")
    L.append("| Criterion | Detail | Verdict |")
    L.append("|---|---|---|")
    par = S["m2"]["parity"]
    if par:
        L.append(f"| F-01 | {par['f01']['files']} files, {par['f01']['sampleMismatches']} sample mismatches | {par['f01']['verdict']} |")
        L.append(f"| F-02 | {par['f02']['frames']} frames, {par['f02']['startMismatches']} start and {par['f02']['voicedMismatches']} voiced mismatches | {par['f02']['verdict']} |")
        L.append(f"| F-03 | {par['f03']['voicedFrames']} voiced frames, {par['f03']['framesOutsideTol']} outside {par['toleranceCents']} c, max {par['f03']['maxAbsCents']:.3g} c | {par['f03']['verdict']} |")
    else:
        L.append("| F-01 to F-03 | results/m2_parity.json missing | fail |")
    for crit in ("F-24", "F-25", "F-26"):
        s_ = S["m2"]["vibrato_windows"][crit]["summary"]
        L.append(f"| {crit} | {s_['set']}: {s_['spans_scored']} spans scored, {s_['spans_failing']} failing | {s_['verdict']} |")
    (RES / "tables.md").write_text("\n".join(L) + "\n")
    print("\n".join(L))


if __name__ == "__main__":
    main()
