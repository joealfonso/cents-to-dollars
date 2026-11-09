#!/bin/sh
# Re-runs every M1 check. Results land in results/; VALIDATION.md quotes results/summary.json.
#   ./validate.sh            synthetic + Vocadito
#   ./validate.sh raw        also her recordings in ./data/raw (browser tracker vs Praat)
set -e
cd "$(dirname "$0")"
export NUMBA_CACHE_DIR="$PWD/.numba-cache"
PY=.venv/bin/python
$PY py/synth.py
for mode in yin cont live; do
  d=ts; [ $mode = yin ] && d=tsyin; [ $mode = live ] && d=tslive
  node tools/run_ts.ts track fixtures/synthetic results/$d $mode
  node tools/run_ts.ts track datasets/vocadito/Audio results/vocadito/$d $mode
done
for i in 0 1 2 3 4 5 6 7; do
  ( $PY py/reference.py fixtures/synthetic results --shard $i/8 >/dev/null
    $PY py/reference.py datasets/vocadito/Audio results/vocadito --shard $i/8 >/dev/null ) &
done
wait
if [ "$1" = "raw" ]; then
  [ -d data/raw ] || { echo "data/raw does not exist"; exit 1; }
  node tools/run_ts.ts track data/raw results/raw/ts cont
  node tools/run_ts.ts track data/raw results/raw/tslive live
  node tools/run_ts.ts track data/raw results/raw/tsyin yin
  $PY py/reference.py data/raw results/raw --methods praat
fi
$PY py/score.py
$PY py/praat_audit.py  # writes results/praat_audit.json
# M1.1 continuity dev/test sweep (VALIDATION.md 4.4): plain YIN, live lag 8, whole take.
SWEEP='[null,{"lag":8},{"lag":1e9}]'
node tools/continuity_sweep.ts dev "$SWEEP" > results/continuity_dev.txt
node tools/continuity_sweep.ts test "$SWEEP" > results/continuity_test.txt
