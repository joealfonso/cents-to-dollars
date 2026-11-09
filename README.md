# Cents to Dollars (M1.1: measurement core)

Local-first practice and study tools. M1 and M1.1 contain only the measurement core and a bare test page.
For practice and study. Not a diagnostic or medical device.

- `MEASUREMENT.md`: exact definition of every measurement, with sources.
- `VALIDATION.md`: results against the M1 criteria, failures included, and open questions.

## Run

    npm install --cache .npm-cache
    UV_CACHE_DIR=.uv-cache uv venv --python 3.12 .venv
    UV_CACHE_DIR=.uv-cache uv pip install --python .venv/bin/python numpy scipy librosa praat-parselmouth mir_eval soundfile
    ./validate.sh          # all checks (needs datasets/vocadito, see MEASUREMENT.md section 0)
    ./validate.sh raw      # also her recordings in data/raw/
    npx vite               # test page at http://127.0.0.1:5173

## Layout

- `src/dsp/`: tracker (YIN plus continuity across frames, `continuity.ts`), spectrum, cents, vibrato. Shared by the worklet and the offline runner.
- `src/audio/`: AudioWorklet processor and microphone capture.
- `src/styles/tokens.css`: one tokens file, two themes (editorial, loud).
- `src/testpage/`, `index.html`: bare test page (live, calibration, loopback latency, self-test).
- `tools/`: Node runners for the TS code (`run_ts.ts` with modes `yin`, `cont`, `live`; `spectrum_check.ts`; `octave_sweep.ts`; `continuity_sweep.ts` for the dev/test tuning in VALIDATION.md 4.4).
- `py/`: synthetic generator, pYIN and Praat references, scorer, `praat_audit.py` (how much Praat agreement is shared error).
