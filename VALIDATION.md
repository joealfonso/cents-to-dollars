# VALIDATION.md

**Status.** M1.1 is not done.
- Live view (plain YIN) fails criterion 3 at 94.36%.
- Post-take (whole take, YIN + continuity) passes at 96.46% on the Vocadito stand-in only. The margin is thin on the less-contaminated test split (95.59% under the sweep rule, `results/continuity_test.txt`).
- Part of that gain comes from agreeing with Praat's own octave-down errors: on vocadito_34, Praat agreement rose from 57.1% to 74.8% while RPA against the annotation fell from 0.729 to 0.609.
- Her recordings are the first real test. See sections 4.4 and 10b.

M1 measurement core, updated for M1.1 (continuity tracker, section 4.4). Run on 2026-11-08 on this Mac. Definitions are in MEASUREMENT.md.
Every number here comes from files that `./validate.sh` regenerates (`results/summary.json`, `results/tables.md`, `results/praat_audit.json`, `results/continuity_dev.txt`, `results/continuity_test.txt`) or from `results/browser_selftest.json`, written by the test page. Numbers that do not come from those files are marked "not in validate.sh output" and give the command that reproduced them.
"Browser tracker" means `src/dsp/*`. It has two paths:
- **Whole take** (post-take analysis): YIN plus the continuity step (MEASUREMENT.md 1.5), decoded over each voiced run.
- **Live** (the AudioWorklet): plain YIN, the M1 tracker. A fixed-lag live variant of the continuity step was built and rejected (section 4.5), so the live view does not use it.

The code was run in Node over all fixtures. The live path was also run in Chrome 152 through a real `AudioWorkletNode` in an `OfflineAudioContext` (`results/browser_selftest.json`, 2026-11-08); its numbers are identical to Node's. The live microphone, the Stop button and acoustic loopback were not exercised.

For practice and study. Not a diagnostic or medical device.

## 1. Results against the criteria

| # | Criterion | Threshold | Result | Verdict |
|---|---|---|---|---|
| 1 | Synthetic tones 130 to 1050 Hz, 48 kHz, browser tracker (whole take and live, identical) | median <= 5 c, P95 <= 15 c, 0 octave errors | median 0.027 c, P95 0.228 c, max 0.39 c, 0 octave errors (9,689 frames, 60 tones) | **Pass** |
| 1b | Same, 44.1 kHz | same | median 0.039 c, P95 0.369 c, max 0.50 c, 0 octave errors | **Pass** |
| 2 | Synthetic vibrato 4.5 to 7.5 Hz, plus or minus 30 to 100 c, browser tracker | rate error <= 0.3 Hz, extent error <= 10%, every case | worst rate error 0.0014 Hz, worst extent error 4.33%, 0 of 84 cases failing | **Pass** |
| 3 | Real recordings: browser tracker vs Praat | within 10 c on >= 95% of jointly voiced frames | **Not run on her recordings (none exist).** Vocadito stand-in, 88,735 jointly voiced frames, **whole take: 96.46%** | **Pass on stand-in only (see status).** Not run on her recordings; thin margin on the test split (95.59%); part of the gain is agreement with Praat's octave-down errors (section 4.4) |
| 3 (live) | Same, live path (plain YIN) | same | Vocadito stand-in, same frames: **94.36%** | **Fail** (0.64 points short) |
| 4 | Annotated datasets with mir_eval | report only, no threshold given | Vocadito, 40 tracks. Whole take: RPA 0.923, RCA 0.930, VR 0.932, VFA 0.089, OA 0.919 | Reported (section 5) |
| 4 (live) | Same, live path (plain YIN) | report only | RPA 0.912, RCA 0.922, VR 0.932, VFA 0.089, OA 0.912 | Reported (section 5) |
| 5 | Calibration through her mic chain | report offset, no threshold given | **Not run: needs her mic chain.** Digital path only: mean signed error +0.07 c (48 kHz sines) | Pending her setup |
| 6 | Latency, loopback sound to displayed pitch | report ms, no threshold given | **Acoustic loopback not run.** Algorithmic part, live path (plain YIN): 33.3 ms to within 50 c, 38.7 ms to within 10 c | Partial |

Criteria 1 and 2 give identical numbers for whole take and live: on the clean synthetic sets the continuity step never changes a choice. Criterion 3 is the only place the two paths differ on a threshold. Read the whole-take pass with section 4.4.

Reference path, scored on the same synthetic criteria:

| Criterion | pYIN (librosa) | Praat ac (Parselmouth) |
|---|---|---|
| 1, tones 48 kHz | median 0.64 c, P95 10.64 c, 0 octave: pass | median 0.004 c, P95 0.024 c, 0 octave: pass |
| 2, vibrato | **Fail: 20 of 84 cases** exceed 10% extent error (worst -19.4%) | worst rate error 0.0001 Hz, worst extent error 5.44%: pass |

## 2. Synthetic steady tones

60 tones per set: every 12-TET note C3 to C6 at A4 = 440, the endpoints 130 and 1050 Hz, and 21 log-uniform off-grid frequencies. 1 s each. |error| in cents, pooled over frames.

| Set | Method | Frames | Voicing recall | Median | P95 | Max | Gross >50c | Octave >600c |
|---|---|---|---|---|---|---|---|---|
| tone_sine_48k | browser tracker, whole take and live (identical) | 9689 | 1.0000 | 0.027 | 0.228 | 0.39 | 0 | 0 |
| tone_sine_48k | pYIN | 9660 | 1.0000 | 0.637 | 10.637 | 12.86 | 0 | 0 |
| tone_sine_48k | Praat | 9660 | 1.0000 | 0.004 | 0.024 | 0.04 | 0 | 0 |
| tone_sine_44k | browser tracker, whole take and live (identical) | 8904 | 1.0000 | 0.039 | 0.369 | 0.50 | 0 | 0 |
| tone_sine_44k | pYIN | 8880 | 1.0000 | 0.637 | 10.637 | 12.86 | 0 | 0 |
| tone_sine_44k | Praat | 8880 | 1.0000 | 0.004 | 0.015 | 0.03 | 0 | 0 |

Extra sets, not part of the thresholds:

| Set | Method | Median | P95 | Max | Octave |
|---|---|---|---|---|---|
| tone_harm_48k (40 partials, 1/k) | browser tracker, whole take and live (identical) | 0.130 | 0.987 | 1.75 | 0 |
| tone_harm_48k | pYIN | 0.637 | 4.714 | 5.53 | 0 |
| tone_harm_48k | Praat | 0.000 | 0.001 | 0.00 | 0 |
| tone_noise20_48k (white noise, 20 dB SNR) | whole take (YIN + continuity) | 1.189 | 4.790 | 10.89 | 0 |
| tone_noise20_48k | live (plain YIN) | 1.223 | 5.756 | 18.19 | 0 |
| tone_noise20_48k | pYIN | 0.637 | 10.652 | 30.64 | 0 |
| tone_noise20_48k | Praat | 1.670 | 5.931 | 10.69 | 0 |
| tone_high_48k (C#6 to A6, 1109 to 1760 Hz) | browser tracker, whole take and live (identical) | 0.452 | 0.982 | 0.99 | 0 |
| tone_high_48k | pYIN | 0.637 | 0.637 | 0.64 | 0 |
| tone_high_48k | Praat | 0.001 | 0.002 | 0.00 | 0 |

Worst files in noise, live (plain YIN): 146.8 Hz (P95 12.8 c, max 18.2 c), 164.8 Hz (P95 10.9 c), 196.0 Hz (P95 10.4 c). Low notes suffer most in white noise because fewer periods fit in the 21 ms window. With the continuity step (whole take) the worst file's P95 is 7.04 c.

pYIN's P95 of about 10.6 cents on clean sines is its 10-cent pitch grid, not an error in our harness. Its worst files are 176.4 Hz (max 12.9 c) and 130 Hz (11.4 c).

## 3. Synthetic vibrato

84 cases: carriers 220, 440 and 880 Hz; rates 4.5, 5.0, 5.5, 6.0, 6.5, 7.0 and 7.5 Hz; extents plus or minus 30, 50, 75 and 100 cents; 3 s each. The contours of every path and reference go through the same `analyzeVibrato` (MEASUREMENT.md section 3).

| Set | Method | Detected | Rate err median | Rate err max | Extent err median | Extent err max | Mean signed extent err | Failing |
|---|---|---|---|---|---|---|---|---|
| vib_sine_48k | browser tracker, whole take and live (identical) | 84/84 | 0.0002 Hz | 0.0014 Hz | 2.69% | 4.33% | -2.77% | 0 |
| vib_sine_48k | pYIN | 84/84 | 0.0156 Hz | 0.0640 Hz | 7.58% | 19.40% | -5.94% | **20** |
| vib_sine_48k | Praat | 84/84 | 0.0000 Hz | 0.0001 Hz | 3.50% | 5.44% | -3.59% | 0 |
| vib_harm_48k (8 harmonic cases) | browser tracker, whole take and live (identical) | 8/8 | 0.0002 Hz | 0.0006 Hz | 2.18% | 4.11% | -2.27% | 0 |
| vib_harm_48k | pYIN | 8/8 | 0.0206 Hz | 0.0407 Hz | 6.49% | 9.26% | -2.80% | 0 |
| vib_harm_48k | Praat | 8/8 | 0.0000 Hz | 0.0001 Hz | 3.37% | 5.36% | -3.47% | 0 |

The browser tracker under-reads extent by about 3% on average. The worst cases are all at 7.5 Hz on the 220 Hz carrier (-4.33%, -4.32%, -4.32% for extents 50, 100 and 75 c), which matches the window-averaging attenuation predicted in MEASUREMENT.md section 3. Frame-level contour error during vibrato (84 sine cases, 45,052 frames; same for both paths): median 0.94 c, P95 3.03 c, max 4.89 c.

**Failing reference cases (pYIN), carrier / rate / extent / extent error:**
220 Hz: 4.5/30 +14.2%, 6.0/30 -14.1%, 6.5/30 -12.0%, 6.5/75 -11.4%, 7.0/30 -12.7%, 7.0/75 -11.2%, 7.5/30 -12.8%, 7.5/75 -11.7%, 7.5/100 -13.7%.
440 Hz: 7.0/30 -11.0%, 7.0/75 -11.4%, 7.5/30 -12.6%, 7.5/75 -12.5%, 7.5/100 -13.8%.
880 Hz: 7.0/50 -17.5%, 7.0/75 -12.5%, 7.5/30 -13.7%, 7.5/50 -18.2%, 7.5/75 -19.4%, 7.5/100 -14.8%.
The pattern (small extents and fast rates fail) fits the 10-cent grid plus Viterbi smoothing. This matters for the reference path only: pYIN should not be used as the vibrato reference for her recordings. Praat should be used instead.

## 4. Real singing: agreement with Praat

### 4.1 Her recordings

Not run. `./data/raw/` does not exist. The pipeline is ready: `./validate.sh raw` runs both browser-tracker paths and Praat on every WAV in `data/raw/` at its original sample rate and adds `raw_praat_agreement` to `results/summary.json`. Her recordings are the first genuinely held-out test for everything below.

### 4.2 Stand-in: Vocadito (40 tracks of solo singing, 44.1 kHz)

| Comparison | Jointly voiced frames | Within 10 c | Within 50 c | Median abs | P95 abs | Octave disagreements |
|---|---|---|---|---|---|---|
| Browser tracker, **whole take** (YIN + continuity) vs Praat | 88,735 | **96.46%** | 98.86% | 1.04 c | 7.91 c | 965 |
| Browser tracker, **live** (plain YIN) vs Praat | 88,735 | **94.36%** | 96.78% | 1.08 c | 11.53 c | 2,582 |
| pYIN vs Praat (for scale) | 96,633 | 78.97% | 95.74% | 4.23 c | 42.30 c | 1,921 |

**Verdict per path (`criterion3` in `results/summary.json`):**
- **Whole take: pass on the stand-in**, 96.46% against the 95% threshold (1.46 points over).
- **Live: fail**, 94.36% (0.64 points under). The live view runs plain YIN, which is the M1 result.

Read section 4.4 before relying on the whole-take pass: the weights were tuned on half of this dataset, and part of the gain in raw agreement is agreement with Praat's own octave-down errors on vocadito_34.

Worst tracks, whole take (share within 10 c of Praat): vocadito_34 74.8%, vocadito_6 90.3%, vocadito_29 91.3%, vocadito_30 93.2%, vocadito_26 93.7%.
Worst tracks, live (plain YIN): vocadito_34 57.1%, vocadito_21 86.1%, vocadito_26 87.4%, vocadito_30 88.1%, vocadito_2 88.3%.

### 4.3 Why plain YIN failed (M1), and what was tried

M1 history; the full tables are in Appendix A.1. Against Vocadito's human-corrected annotation, the 2,582 octave disagreements between plain YIN and Praat split about evenly: roughly half are Praat's own octave-down errors (almost all on vocadito_34), and half are YIN octave-up errors on tracks 2, 21, 17, 15, 23 and 30, where the YIN threshold accepts a dip at half the true period. These counts are not in `./validate.sh` output and were not re-run.

An octave guard (move to the dip near 2 x tau if it is deeper by a ratio) was chosen on tracks 1 to 20 and evaluated once on 21 to 40. It cut octave-up errors on held-out tracks but caused as many new octave-down errors on clean periodic notes. **The guard is shipped off.** The recommended next step, choosing among YIN's dips using continuity across frames, was done in M1.1 (section 4.4).

### 4.4 M1.1: continuity across frames (whole take)

**Illustration (vocadito_34).** Whole-take RPA against the annotation is lower than plain YIN's (0.609 against 0.729) while its agreement with Praat is higher (74.8% against 57.1%, section 4.2). Praat is also octave-down on this track, so the whole-take tracker moved toward Praat and away from the annotation.

**The raw Praat number counts agreeing with Praat's mistakes.** A tracker can raise its criterion 3 score by sharing Praat's octave-down errors, and on this track the whole-take path did. The audit below separates that part out.

**Method.** MEASUREMENT.md section 1.5. Each voiced frame keeps up to 6 YIN dips; a Viterbi pass picks one per frame, trading dip depth against jumps between frames. Voicing and the frequency value of each dip are unchanged from plain YIN. Code: `src/dsp/continuity.ts`. It is used for whole-take analysis only (`node tools/run_ts.ts track <in> <out> cont`).

**Tuning protocol, and why the test split is not clean.** Weights were chosen on Vocadito tracks 1 to 20 (dev, `tools/continuity_sweep.ts dev`), then frozen and run on tracks 21 to 40 (test). **Tracks 21 to 40 are not a clean held-out set:** they were already inspected during the M1 octave-guard diagnosis (section 4.3), so I knew where the octave-up errors were. Her recordings will be the first genuinely unseen test.

On dev, a 48-point grid showed the result depends mostly on wDown (the cost of moving below the YIN pick). The single best dev score (wDown 0.02, wJump 1, RPA 0.9469) sat on a cliff: its neighbours had 3 to 4 times more octave-down errors. I chose the middle of the stable plateau instead (wDown 0.04 to 0.07, wJump 1.5 to 3, wUp 0.05 to 0.2 all gave dev RPA 0.9464 to 0.9466): wDown 0.05, wJump 2, wUp 0.1. The grid results are from the tuning session and are not in `./validate.sh` output.

**Split results.** Frame counts compare each tracker frame with the nearest annotation frame (the `continuity_sweep.ts` rule), so RPA differs slightly from mir_eval's 10 ms grid in section 5. "Octave up/down" = frames more than 600 c above/below the annotation. "Within 10 c of Praat" here is over all jointly voiced frames, as in criterion 3, but only on the tracks of that split.

| Split | Tracker | RPA vs annotation | Octave up | Octave down | Within 10 c of Praat |
|---|---|---|---|---|---|
| dev (1 to 20) | plain YIN (live) | 0.9328 | 648 | 59 | 95.90% |
| dev (1 to 20) | whole take | 0.9466 | 81 | 8 | 97.33% |
| test (21 to 40) | plain YIN (live) | 0.9143 | 568 | 477 | 92.88% |
| test (21 to 40) | whole take | 0.9215 | 17 | **883** | 95.59% |
| all 40 (mir_eval, section 5) | plain YIN (live) | 0.912 | | | |
| all 40 (mir_eval, section 5) | whole take | 0.923 | | | |

(`results/continuity_dev.txt`, `results/continuity_test.txt`, `results/summary.json` `vocadito_mir_eval`.)

**What improved.** Octave-up errors, the failure diagnosed in 4.3, nearly vanish on the test split (568 to 17 frames). On dev they fall from 648 to 81.

**What got worse: octave-down errors against the annotation on test rose from 477 to 883 frames, 791 of them on vocadito_34** (plain YIN has 343 octave-down frames on that track). On vocadito_34 Praat is also an octave or more too low, so the whole-take tracker and Praat now share the error. The step extends a low reading across a note because staying on it is cheaper than jumping, a known weakness of costing jumps: a confident wrong reading pulls its neighbours along. vocadito_33 goes from 51 to 43 octave-down frames. Fixing the vocadito_34 behaviour would mean tuning on test data, so I did not. It is listed as an open item (section 10b).

**RPA against the annotation moved much less than agreement with Praat.** On test, RPA rose 0.0072 (0.9143 to 0.9215) while within-10-c agreement with Praat rose 2.71 points (92.88% to 95.59%, sweep rule). The RPA gain is real but small; the Praat-agreement gain is larger (see the paragraph above on shared mistakes). The annotation itself is pYIN output corrected by hand in Tony (section 5), so it is not an independent ground truth either.

**Audit: how much of the Praat agreement is real.** `py/praat_audit.py` (`results/praat_audit.json`) restricts to frames where the annotation is voiced (so its frame counts differ from criterion 3's 88,735) and counts a tracker or Praat value as right when it is within 50 c of the annotation. "Within 10 c where Praat is right" is the agreement measured only on frames where Praat is right per the annotation. "Agree with Praat but both wrong" counts frames within 10 c of Praat where both are more than 50 c from the annotation.

| Split | Tracker | Joint frames | Within 10 c of Praat (raw) | Within 10 c where Praat is right | Agree with Praat, both wrong | Octave up / down vs annotation |
|---|---|---|---|---|---|---|
| dev (1 to 20) | plain YIN (live) | 42,772 | 96.39% | 96.47% | 65 | 648 / 59 |
| dev (1 to 20) | whole take | 42,772 | 97.85% | 97.96% | 55 | 81 / 8 |
| test (21 to 40) | plain YIN (live) | 42,983 | 93.57% | 96.42% | 395 | 568 / 477 |
| test (21 to 40) | whole take | 42,983 | 96.36% | 98.21% | 857 | 17 / 883 |
| all 40 | plain YIN (live) | 85,755 | 94.97% | 96.44% | 460 | 1,216 / 536 |
| all 40 | whole take | 85,755 | 97.10% | 98.08% | 912 | 98 / 891 |
| test, excluding vocadito_34 (19 tracks) | plain YIN (live) | 40,284 | 96.01% | 96.47% | 84 | 552 / 134 |
| test, excluding vocadito_34 | whole take | 40,284 | 97.79% | 98.27% | 80 | 17 / 92 |
| all 40, excluding vocadito_34 (39 tracks) | plain YIN (live) | 83,056 | 96.20% | 96.47% | 149 | 1,200 / 193 |
| all 40, excluding vocadito_34 | whole take | 83,056 | 97.82% | 98.11% | 135 | 98 / 100 |

For scale, Praat itself has 1,903 octave-down frames against the annotation on test and 282 once vocadito_34 is excluded (1,937 on all 40, 316 without vocadito_34), so about 1,600 of its octave-down frames are on that one track.

How to read it:
- **The gain is not only shared errors.** Where Praat is right, whole take agrees with it on 98.08% of frames against 96.44% for plain YIN. With vocadito_34 excluded, raw agreement is 97.82% against 96.20%. Both are above the 95% threshold, so the whole-take pass does not depend on vocadito_34.
- **Part of the raw gain is shared errors.** On test, raw agreement rose 2.79 points (93.57% to 96.36%); excluding vocadito_34 it rose 1.78 points. Roughly one point of the test gain therefore comes from the one track where both trackers are low. Frames where both are wrong and agree on test go from 395 to 857, and excluding vocadito_34 they go from 84 to 80, so the increase is on that track.
- **Octave-down against the annotation got worse on test (477 to 883 frames) even though octave-up nearly vanished.** The net octave-error count on test fell (1,045 to 900) but the remaining errors are in one direction and concentrated in one track.
- The audit and the sweep use different frame rules (annotation-voiced frames and a 50 c rule against nearest-annotation frames), which is why the within-10-c figures differ slightly between the two tables.

**Synthetic checks.** Tones and vibrato are bit-identical between whole take and plain YIN (criteria 1 and 2). The 20 dB noise set improves under whole take (P95 5.76 to 4.79 c, max 18.19 to 10.89 c), because a few noisy frames now take a neighbouring dip that matches the note.

### 4.5 Live variant with lookahead: built, tested, not shipped

A fixed-lag version of the continuity step (8-frame lag, about 43 ms extra delay) is kept in `src/dsp/continuity.ts` with tests (`tests/continuity.test.ts`, run by `npm test`), but the worklet does not use it. After a bug fix (results from the buggy version are discarded), it locked onto octave-down picks: over all 40 tracks it has RPA 0.9192 against 0.9237 for plain YIN, with 2,325 octave-down frames against 536. Raw Praat agreement rose slightly (94.44% to 94.89%) but stays under 95%, so that number is the wrong one to read here. Joseph decided the live view stays plain YIN. These numbers are not in `./validate.sh` output; commands and full tables are in Appendix A.2.

## 5. Annotated dataset: Vocadito with mir_eval

40 tracks, mean over tracks, mir_eval 0.8.2 defaults (50-cent tolerance, 10 ms grid).

The RPA values in the sweep tables (4.4, Appendix A.2; for example 0.9237 and 0.9342) differ from the mir_eval values here (0.912 and 0.923) because of how they are averaged. `tools/continuity_sweep.ts` pools every annotation-voiced frame over all tracks on the tracker's own frame grid (each tracker frame compared with its nearest annotation frame), so long tracks weigh more. `py/score.py` calls `mir_eval.melody.evaluate` per track on mir_eval's grid and takes the mean over tracks, so each track weighs the same.

| Method | Voicing recall | Voicing false alarm | Raw pitch acc. | Raw chroma acc. | Overall acc. |
|---|---|---|---|---|---|
| Browser tracker, whole take (YIN + continuity) | 0.932 | 0.089 | 0.923 | 0.930 | 0.919 |
| Browser tracker, live (plain YIN, the M1 tracker) | 0.932 | 0.089 | 0.912 | 0.922 | 0.912 |
| pYIN | 0.996 | 0.368 | 0.983 | 0.985 | 0.865 |
| Praat | 0.975 | 0.187 | 0.954 | 0.970 | 0.907 |

Read with care:
- **Vocadito's F0 annotations were made by correcting pYIN output in Tony** (per the dataset paper), so pYIN's pitch accuracy is biased upward here.
- The browser tracker trades recall for few false alarms (threshold 0.15). Most of its RPA gap is frames it calls unvoiced; RCA minus RPA is the octave-error share: about 0.7 points for whole take and 1.0 point for live (plain YIN). Voicing is identical for the two paths, so the whole-take gain is all in pitch.
- Worst tracks by RPA: whole take vocadito_34 0.609, 30 0.841, 23 0.852, 4 0.859, 26 0.869. Live (plain YIN) vocadito_34 0.729, 21 0.756, 30 0.786, 23 0.815, 26 0.823. Praat vocadito_34 0.472, 15 0.682, 17 0.710. pYIN vocadito_34 0.916.

## 6. Spectrogram and band ratio

| Check | Result |
|---|---|
| Peak frequency of 120 steady sines (both rates), parabolic interpolation | median error 1.02 c, max 4.36 c |
| Peak level of a 0.5 amplitude sine (expected -6.02 dBFS) | -1.38 to -0.00 dB from expected (Hann scalloping, at most 1.42 dB in theory) |
| Band ratio L_SF on 6 harmonic tones with known partials (f0 262 and 523.25 Hz; 2.5 to 3.5 kHz gain 0.25, 1, 4) | max error 0.00013 dB; expected range -28.9 to -1.0 dB |

The band-ratio check confirms the arithmetic and band-edge handling. It does not show that L_SF tracks a singer's formant in a real soprano voice (MEASUREMENT.md section 5).

## 7. Calibration

**Not run.** It needs a reference sine at a known frequency played through her microphone, interface and room. The test page has the procedure (Calibration section, 5 s measurement, reports median F0 and offset in cents).

Digital path only (no microphone): the browser tracker's mean signed error on clean 48 kHz sines is +0.07 c, and +0.09 c at 44.1 kHz. That is the floor that any acoustic offset will be measured against. A real offset would come mainly from sample-clock error in the interface. The size follows from cents = 1200 x log2(1 + ppm x 1e-6): 10 ppm is 0.017 c, 50 ppm is about 0.087 c, 100 ppm is 0.173 c (computed with `python3`, not in validate.sh output). A sample-clock error would have to reach several thousand ppm to approach 10 c.

## 8. Latency

| Component | Value | How |
|---|---|---|
| Algorithmic, live path (plain YIN), tone onset to first final frame within 50 c | 33.3 ms | latency fixture at 48 kHz; Node and Chrome worklet agree (`results/browser_selftest.json`) |
| Algorithmic, live path, to within 10 c | 38.7 ms | Node (`latency.live` in `results/summary.json`) |
| Hop quantization | up to 5.3 ms | included above |
| Device input and output latency, message passing, screen refresh | **not measured** | needs acoustic loopback |
| Full loopback, sound to displayed pitch | **not measured** | test page "Loopback latency" section, run on her Mac with speakers on |

The whole-take path is not a live path and has no latency figure. The 8-frame lookahead variant (section 4.5) would have added 8 x 5.33 ms = 42.7 ms to the live numbers; it is not shipped.

Compute load: the tracker runs 49 to 59 times faster than real time in Node with the spectrum on, so the live worklet uses roughly 2% of one core.

## 9. Thresholds I think need a decision (none were changed)

1. **Tone range 130 to 1050 Hz may be too narrow.** A soprano's working top is often around C6 to F6 (1047 to 1397 Hz), and higher for coloratura. I tested C#6 to A6 as an extra set (all pass, max 0.99 c). Proposal: extend the scored range to her actual top note once she gives it.
2. **Pure sines are an easy case.** Every tracker passes criterion 1 with wide margins, so it does not separate them. Proposal: score the harmonic and 20 dB noise sets against the same thresholds too. On today's numbers every tracker would still pass (worst P95 is pYIN at 10.65 c in noise), so this adds coverage without changing any verdict.
3. **"Agree with Praat" treats Praat as ground truth, but it is not.** On Vocadito, Praat is wrong on about half of the octave disagreements (M1 count, section 4.3), and `praat_audit.json` shows 1,937 octave-down frames against the annotation over 40 tracks, about 1,600 of them on vocadito_34. Proposal: keep the 95% criterion, and for frames that disagree by more than 50 c, adjudicate against a manual check (or annotations where they exist) and report both numbers.
4. **The Praat criterion passes for the whole take, but it is the wrong instrument for the remaining errors.** The largest single shortfall (vocadito_34) is a case where both trackers are wrong in the same direction, and the whole-take path agrees with Praat there more than plain YIN does. A tracker could raise its Praat score by copying Praat's mistakes. Proposal: report agreement on frames where an annotation or manual check says Praat is right (section 4.4, 98.08% whole take against 96.44% plain YIN) alongside the raw number, and decide which one the 95% threshold applies to. This would be an additional report, not a replacement for the raw number. I have not changed the threshold; the live path fails criterion 3 as written.
5. **No thresholds exist for mir_eval, calibration or latency.** Suggested starting points for discussion, not applied: RPA >= 0.95 on annotated solo singing; |calibration offset| <= 1 c; loopback latency median <= 100 ms. These are proposals without a cited basis.

## 10. Not done in M1, by design

- No hub, no themed screens, no Dexie storage, no helper. The test page at `index.html` is bare. It links the shared `src/styles/tokens.css` (both themes as one token set) and carries the footer.
- MusicXML scores, repertoire and teacher notes: none exist yet. Nothing was built for them.

## 10b. Open technical items after M1.1

- Octave-down propagation on vocadito_34 (section 4.4): a confident low reading carries across a note. Candidate fixes to try against her recordings, not against Vocadito tracks 21 to 40: a cost on long jumps that scales with how isolated a reading is, or restarting the path at large dips in the d' value.
- The live path (plain YIN) fails criterion 3 on the stand-in (94.36%). A fixed-lag variant did not fix it (section 4.5). Any other live approach needs a design that does not commit to octave-down picks, to be tested on her recordings.
- The candidate limits (6 dips, d' < 0.5) were not tuned.
- **Detecting octave-down errors on her recordings.** Praat can share the error, so agreement with Praat cannot detect it. The check is manual: listen to, or annotate, the frames where the whole-take tracker and Praat agree but sit at or below the bottom of her stated range (question 2) or an octave below the surrounding phrase. A fix is likely a structural decoder change (a cost term or a restart rule), not a weight retune.

## 11. Stopped at M1.1. Open questions for her

1. **Reference pitch:** A4 = 440 or 442 Hz? Does it change by venue or ensemble? (Every cents reading moves 7.85 c between the two.)
2. **Voice type and working range:** lowest and highest notes she sings in practice and in performance. This sets the F0 search range, the scored test range (section 9.1), and whether the 2.5 to 3.5 kHz band is meaningful for her voice.
3. **Mic and interface:** which microphone and audio interface, at what sample rate, and in which room(s)? Needed for calibration (section 7), loopback latency (section 8), and the -50 dBFS voicing gate.
4. **After a take, what does she want to know?** For example: pitch accuracy per note against the score, vibrato rate and extent over a phrase, how steady a sustained note is, or energy in the 2.5 to 3.5 kHz band. This decides which measurements reach the first designed screen.

5. **Live readout: fast or steady?** The live view shows plain YIN, about 33 ms after she sings, and on the stand-in it disagrees with Praat by an octave on 2,582 frames against 965 for the whole-take path (section 4.2), with 94.36% agreement within 10 c, below the 95% threshold. The 8-frame lookahead variant was rejected on Vocadito (section 4.5). Are octave slips of that size acceptable in the live readout, given that post-take analysis (whole take, YIN + continuity) corrects most of them?

6. **The same take in two views.** Live (plain YIN) and post-take (YIN + continuity) can disagree, including by an octave, which changes the note name. What should the post-take report do with the live trace: replace it, show both, or discard it? Should a take be labelled as reprocessed?

Also needed before the Praat agreement check can run on real material:
7. The recordings themselves in `./data/raw/` (original sample rate, WAV), with mic and room noted for each take.
8. Permission to keep them local-only in this project folder (they are git-ignored).

## Appendix A: tuning history

### A.1 M1 octave-guard history (from section 4.3)

Counts come from the M1 diagnosis and are not in `./validate.sh` output, except the octave-guard table, which `tools/octave_sweep.ts` reproduces (`node tools/octave_sweep.ts dev 0 0 0.3`, then `test`; run again on 2026-11-08 with the same numbers). The annotation-side counts were not re-run.

Octave disagreements checked against Vocadito's human-corrected annotation:

| Octave disagreement frames | Count |
|---|---|
| Browser tracker one octave high (2,447) or low (135) relative to Praat | 2,582 |
| Annotation sides with the browser tracker (Praat is wrong) | 1,246 |
| Annotation sides with Praat (browser tracker is wrong) | 1,274 |
| Neither within 50 c of the annotation | 23 |

About half the shortfall is Praat's own octave-down errors (almost all on vocadito_34: 1,077 frames). The other half is YIN octave-up errors on tracks 2, 21, 17, 15, 23 and 30, where the YIN threshold accepts a dip at half the true period (d' about 0.11 to 0.15) while the dip at the true period is 15 to 50 times deeper.

Octave guard: if the dip near 2 x tau is below `octaveRatio` x the current dip, move to it. The parameter was chosen on tracks 1 to 20 and evaluated once on tracks 21 to 40:

| Split | octaveRatio | RPA vs annotation | Octave-error frames |
|---|---|---|---|
| dev (1 to 20) | 0 (off) | 0.9328 | 707 |
| dev (1 to 20) | 0.3 (best on dev) | 0.9436 | 201 |
| test (21 to 40) | 0 (off) | 0.9143 | 1,045 |
| test (21 to 40) | 0.3 | 0.9139 | 1,063 |

On held-out tracks it fixed octave-up errors (568 to 309 frames) but caused as many new octave-down errors on clean, very periodic notes (vocadito_29: 5 to 166; vocadito_37: 18 to 63). A second condition (fire only on shallow dips) made dev results worse, so there was no basis to keep it. The held-out tracks were inspected once while diagnosing, so the second attempt's numbers were not used to choose anything. The 309, 166, 63 and per-track counts were not re-run.

### A.2 Fixed-lag live variant (from section 4.5)

The first version had a bug: committed choices were not conditioned on when later frames were decoded, which produced octave jumps never costed. Its results are discarded.

Results of the fixed variant, from `node tools/continuity_sweep.ts` run on 2026-11-08 with the whole-take weights (**not in `./validate.sh` output**; `validate.sh` runs only plain YIN and whole take). Reproduce with `node tools/continuity_sweep.ts all '[null,{"lag":8},{"lag":1e9}]'` and the `dev` and `test` splits. RPA here is the pooled sweep rule (section 5).

| Variant (all 40 tracks) | RPA vs annotation | Octave up | Octave down | Within 10 c of Praat (sweep rule) |
|---|---|---|---|---|
| plain YIN | 0.9237 | 1,216 | 536 | 94.44% |
| fixed lag 8 | 0.9192 | 52 | 2,325 | 94.89% |
| whole take | 0.9342 | 98 | 891 | 96.49% |

On test alone, lag 8 gives RPA 0.9009 and 1,837 octave-down frames (plain YIN 477, whole take 883). On dev, by lag:

| Lag (frames of 5.8 ms at 44.1 kHz) | 0 | 2 | 4 | 8 | 16 | 32 | whole take |
|---|---|---|---|---|---|---|---|
| dev RPA | 0.9072 | 0.9129 | 0.9215 | 0.9371 | 0.9432 | 0.9463 | 0.9466 |
| dev octave down | 1,871 | 1,620 | 1,219 | 488 | 194 | 32 | 8 |

Plain YIN on dev is RPA 0.9328 with 59 octave-down frames. On dev, lags 0 to 4 are worse than plain YIN on RPA; lag 8 and above are better on RPA but still have more octave-down frames (488 at lag 8). On the test split lag 8 is worse than plain YIN on RPA (0.9009 against 0.9143), and over all 40 tracks it is worse too (0.9192 against 0.9237). Lag 8 raises raw agreement with Praat slightly (94.44% to 94.89%) but stays under 95%, while adding 1,789 octave-down frames against the annotation.
