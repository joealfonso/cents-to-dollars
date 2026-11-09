# Cents to Dollars (M1.1: measurement core)

Local-first practice and study tools. M1 and M1.1 contain only the measurement core and a bare test page.
For practice and study. Not a diagnostic or medical device.

M2 (planned, not built, branch `m2`): open an audio file and analyse the take, reference tones and interval recognition, and sung exercises (Sustain a note, Pitch match).

- `specs/M2.md`: M2 build spec, milestones M2.1 to M2.3, numbered acceptance criteria, OPEN owner questions in section 10.
- `design/M2-DESIGN.md`: M2 screens. `design/M2-REVIEW-CARD.md`: pre-build review follow-ups.
- `MEASUREMENT.md`: exact definition of every measurement, with sources.
- `VALIDATION.md`: results against the M1 criteria, failures included, and open questions.

## Run

    npm install --cache .npm-cache
    UV_CACHE_DIR=.uv-cache uv venv --python 3.12 .venv
    UV_CACHE_DIR=.uv-cache uv pip install --python .venv/bin/python numpy scipy librosa praat-parselmouth mir_eval soundfile
    ./validate.sh          # all checks (needs datasets/vocadito, see MEASUREMENT.md section 0)
    ./validate.sh raw      # also her recordings in data/raw/
    npm test               # unit tests for the continuity step (27 tests)
    npx vite               # test page at http://127.0.0.1:5173

## Layout

- `src/dsp/`: tracker (YIN, plus a continuity step across frames in `continuity.ts`), spectrum, cents, vibrato. Shared by the worklet and the offline runner.
- `src/audio/`: AudioWorklet processor and microphone capture.
- `src/styles/tokens.css`: one tokens file, two themes (editorial, loud).
- `src/testpage/`, `index.html`: bare test page (live, calibration, loopback latency, self-test).
- `tools/`: Node runners for the TS code (`run_ts.ts` with modes `yin` and `cont`; `spectrum_check.ts`; `octave_sweep.ts`; `continuity_sweep.ts` for the dev/test tuning in VALIDATION.md 4.4).
- `py/`: synthetic generator, pYIN and Praat references, scorer, `praat_audit.py` (how much Praat agreement is shared error).

## Live and post-take tracking

- **Live view** (AudioWorklet): plain YIN, one pitch per frame, no lookahead. On the Vocadito stand-in it agrees with Praat within 10 c on 94.36% of jointly voiced frames, below the 95% criterion (VALIDATION.md section 4.2).
- **Post-take analysis** (whole take): YIN plus the continuity step, which picks among each frame's YIN dips with a Viterbi pass (MEASUREMENT.md section 1.5). 96.46% on the same stand-in, with caveats in VALIDATION.md section 4.4.
- `node tools/run_ts.ts track <in> <out> yin` runs the live method over files, `... cont` runs the whole-take method (default).
