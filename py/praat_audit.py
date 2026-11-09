"""Audit of the Praat-agreement criterion on Vocadito: how much agreement is agreement on a shared error.
For each Praat frame matched to a tracker frame (same rule as score.py: nearest tracker frame within 3 ms,
both voiced), the annotation decides who is right (within 50 c). The annotation sample used is the nearest one,
and frames with no annotation sample within ANN_TOL_S are skipped (annotation grid is 5.8 ms).
Also counts octave errors vs the annotation (more than 600 c above / below) on each variant's own frames.
Splits: dev = tracks 1-20 (where parameters were chosen), test = 21-40, all, and test / all without vocadito_34.
Writes results/praat_audit.json."""
import json
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
VOC = ROOT / "results/vocadito"
ANN = ROOT / "datasets/vocadito/Annotations/F0"
MATCH_TOL_S = 0.003  # tracker frame to Praat frame, as in score.py
ANN_TOL_S = 0.006  # frame to nearest annotation sample
VARIANTS = ("ts", "tsyin")  # whole take (YIN + continuity), live (plain YIN)
SPLITS = {
    "dev": lambda n: n <= 20,
    "test": lambda n: n > 20,
    "all": lambda n: True,
    "test_excl34": lambda n: n > 20 and n != 34,
    "all_excl34": lambda n: n != 34,
}


def near(ta, tb):
    idx = np.clip(np.searchsorted(ta, tb), 1, len(ta) - 1)
    left = np.abs(ta[idx - 1] - tb) <= np.abs(ta[idx] - tb)
    return np.where(left, idx - 1, idx)


def ann_at(ref, t):
    """Annotation F0 at times t, and a mask of times that have an annotation sample within ANN_TOL_S."""
    j = near(ref[:, 0], t)
    return ref[j, 1], np.abs(ref[j, 0] - t) <= ANN_TOL_S


def octaves(t, f, ref):
    rf, ok = ann_at(ref, t)
    m = ok & (rf > 0) & (f > 0)
    e = 1200 * np.log2(f[m] / rf[m])
    return int(m.sum()), int((e > 600).sum()), int((e < -600).sum())


def track_stats(stem):
    """Per-track counts for every variant."""
    ref = np.loadtxt(ANN / f"{stem}_f0.csv", delimiter=",")
    B = json.loads((VOC / "praat" / f"{stem}.json").read_text())
    tb, fb = np.asarray(B["t"]), np.asarray(B["f0"])
    rfb, okb = ann_at(ref, tb)
    st = {}
    for m in VARIANTS:
        A = json.loads((VOC / m / f"{stem}.json").read_text())
        ta, fa = np.asarray(A["t"]), np.asarray(A["f0"])
        i = near(ta, tb)
        both = (np.abs(ta[i] - tb) <= MATCH_TOL_S) & (fb > 0) & (fa[i] > 0) & okb & (rfb > 0)
        fa_b, fb_b, rf_b = fa[i][both], fb[both], rfb[both]
        d = np.abs(1200 * np.log2(fa_b / fb_b))
        pr_ok = np.abs(1200 * np.log2(fb_b / rf_b)) <= 50
        tr_ok = np.abs(1200 * np.log2(fa_b / rf_b)) <= 50
        n_ref, up, down = octaves(ta, fa, ref)
        st[m] = dict(
            joint=int(both.sum()), within10=int((d <= 10).sum()),
            both_wrong_agree=int(((d <= 10) & ~pr_ok & ~tr_ok).sum()),
            praat_right_joint=int(pr_ok.sum()), praat_right_within10=int(((d <= 10) & pr_ok).sum()),
            octave_frames=n_ref, octave_up=up, octave_down=down,
        )
    n_ref, up, down = octaves(tb, fb, ref)
    st["praat"] = dict(octave_frames=n_ref, octave_up=up, octave_down=down)
    return st


def ratio(a, b):
    return a / b if b else None


per_track = {int(p.stem.split("_")[1]): track_stats(p.stem) for p in sorted((VOC / "praat").glob("vocadito_*.json"))}
out = {
    "notes": {
        "match": f"Praat frame to nearest tracker frame within {MATCH_TOL_S * 1000:g} ms, both voiced (score.py rule); "
                 f"nearest annotation sample within {ANN_TOL_S * 1000:g} ms and voiced, else frame skipped.",
        "right": "a tracker or Praat value is right when within 50 c of the annotation",
        "octave": "octave_up / octave_down = frames of that variant (its own frame grid) more than 600 c above / below "
                  "the annotation, among octave_frames = frames where both it and the annotation are voiced",
        "splits": "dev = vocadito 1-20, test = 21-40",
    },
    "splits": {},
}
for split, keep in SPLITS.items():
    tracks = [n for n in per_track if keep(n)]
    res = {"tracks": len(tracks)}
    for m in VARIANTS + ("praat",):
        agg = {}
        for n in tracks:
            for k, v in per_track[n][m].items():
                agg[k] = agg.get(k, 0) + v
        if m != "praat":
            agg["within10_frac"] = ratio(agg["within10"], agg["joint"])
            agg["within10_where_praat_right"] = ratio(agg["praat_right_within10"], agg["praat_right_joint"])
        res[m] = agg
    out["splits"][split] = res
(ROOT / "results/praat_audit.json").write_text(json.dumps(out, indent=1))
for split, res in out["splits"].items():
    print(f"{split} ({res['tracks']} tracks)")
    for m in VARIANTS + ("praat",):
        a = res[m]
        w = f" joint={a['joint']} within10={a['within10_frac']:.4f} where_praat_right={a['within10_where_praat_right']:.4f} " \
            f"both_wrong_agree={a['both_wrong_agree']}" if m != "praat" else ""
        print(f"  {m:7s}{w} octave up/down={a['octave_up']}/{a['octave_down']} of {a['octave_frames']}")
