# VALIDATION.md

M1 measurement core, updated for M1.1 (continuity tracker, section 4.4). Run on 2026-11-08 on this Mac. Definitions are in MEASUREMENT.md.
Every number here is reproduced by `./validate.sh` (raw numbers in `results/summary.json`, tables in `results/tables.md`).
"Browser tracker" means `src/dsp/*` as run by the AudioWorklet: YIN plus the continuity step (MEASUREMENT.md 1.5). It comes in two decoding modes: **whole take** (post-take analysis) and **live** (8-frame lookahead, what the worklet runs). "Plain YIN" is the M1 tracker, kept for comparison. The code was run in Node over all fixtures and in Chrome 152 through a real `AudioWorkletNode` in an `OfflineAudioContext` (`results/browser_selftest.json`); the two agree.

For practice and study. Not a diagnostic or medical device.

## 1. Results against the criteria

| # | Criterion | Threshold | Result | Verdict |
|---|---|---|---|---|
| 1 | Synthetic tones 130 to 1050 Hz, 48 kHz, browser tracker | median <= 5 c, P95 <= 15 c, 0 octave errors | median 0.027 c, P95 0.228 c, max 0.39 c, 0 octave errors (9,689 frames, 60 tones) | **Pass** |
| 1b | Same, 44.1 kHz | same | median 0.039 c, P95 0.369 c, max 0.50 c, 0 octave errors | **Pass** |
| 2 | Synthetic vibrato 4.5 to 7.5 Hz, plus or minus 30 to 100 c, browser tracker | rate error <= 0.3 Hz, extent error <= 10%, every case | worst rate error 0.0014 Hz, worst extent error 4.33%, 0 of 84 cases failing | **Pass** |
| 3 | Real recordings: browser tracker vs Praat | within 10 c on >= 95% of jointly voiced frames | **Not run on her recordings (none exist).** On Vocadito, used as a stand-in: **96.46%** whole take, **96.28%** live (plain YIN in M1: 94.36%) | **Pass on the stand-in**, with caveats (section 4.4) |
| 4 | Annotated datasets with mir_eval | report only, no threshold given | Vocadito, 40 tracks, whole take: RPA 0.923, RCA 0.930, VR 0.932, VFA 0.089, OA 0.919 (plain YIN: RPA 0.912) | Reported (section 5) |
| 5 | Calibration through her mic chain | report offset, no threshold given | **Not run: needs her mic chain.** Digital path only: mean signed error +0.07 c (48 kHz sines) | Pending her setup |
| 6 | Latency, loopback sound to displayed pitch | report ms, no threshold given | **Acoustic loopback not run.** Algorithmic part, live tracker: 76.0 ms to within 50 c, 81.3 ms to within 10 c (plain YIN: 33.3 and 38.7 ms) | Partial |

Criteria 1 and 2 give identical numbers for plain YIN, whole take and live: on clean synthetic tones the continuity step never changes a choice.

Reference path, scored on the same synthetic criteria:

| Criterion | pYIN (librosa) | Praat ac (Parselmouth) |
|---|---|---|
| 1, tones 48 kHz | median 0.64 c, P95 10.64 c, 0 octave: pass | median 0.004 c, P95 0.024 c, 0 octave: pass |
| 2, vibrato | **Fail: 20 of 84 cases** exceed 10% extent error (worst -19.4%) | worst rate error 0.0001 Hz, worst extent error 5.44%: pass |

## 2. Synthetic steady tones

60 tones per set: every 12-TET note C3 to C6 at A4 = 440, the endpoints 130 and 1050 Hz, and 21 log-uniform off-grid frequencies. 1 s each. |error| in cents, pooled over frames.

| Set | Method | Frames | Voicing recall | Median | P95 | Max | Gross >50c | Octave >600c |
|---|---|---|---|---|---|---|---|---|
| tone_sine_48k | browser tracker | 9689 | 1.0000 | 0.027 | 0.228 | 0.39 | 0 | 0 |
| tone_sine_48k | pYIN | 9660 | 1.0000 | 0.637 | 10.637 | 12.86 | 0 | 0 |
| tone_sine_48k | Praat | 9660 | 1.0000 | 0.004 | 0.024 | 0.04 | 0 | 0 |
| tone_sine_44k | browser tracker | 8904 | 1.0000 | 0.039 | 0.369 | 0.50 | 0 | 0 |
| tone_sine_44k | pYIN | 8880 | 1.0000 | 0.637 | 10.637 | 12.86 | 0 | 0 |
| tone_sine_44k | Praat | 8880 | 1.0000 | 0.004 | 0.015 | 0.03 | 0 | 0 |

Extra sets, not part of the thresholds:

| Set | Method | Median | P95 | Max | Octave |
|---|---|---|---|---|---|
| tone_harm_48k (40 partials, 1/k) | browser tracker | 0.130 | 0.987 | 1.75 | 0 |
| tone_harm_48k | pYIN | 0.637 | 4.714 | 5.53 | 0 |
| tone_harm_48k | Praat | 0.000 | 0.001 | 0.00 | 0 |
| tone_noise20_48k (white noise, 20 dB SNR) | browser tracker (whole take and live) | 1.189 | 4.790 | 10.89 | 0 |
| tone_noise20_48k | plain YIN (M1) | 1.223 | 5.756 | 18.19 | 0 |
| tone_noise20_48k | pYIN | 0.637 | 10.652 | 30.64 | 0 |
| tone_noise20_48k | Praat | 1.670 | 5.931 | 10.69 | 0 |
| tone_high_48k (C#6 to A6, 1109 to 1760 Hz) | browser tracker | 0.452 | 0.982 | 0.99 | 0 |
| tone_high_48k | pYIN | 0.637 | 0.637 | 0.64 | 0 |
| tone_high_48k | Praat | 0.001 | 0.002 | 0.00 | 0 |

Worst plain-YIN files in noise (M1): 146.8 Hz (P95 12.8 c, max 18.2 c), 164.8 Hz (P95 10.9 c), 196.0 Hz (P95 10.4 c). Low notes suffer most in white noise because fewer periods fit in the 21 ms window.

pYIN's P95 of about 10.6 cents on clean sines is its 10-cent pitch grid, not an error in our harness. Its worst files are 176.4 Hz (max 12.9 c) and 130 Hz (11.4 c).

## 3. Synthetic vibrato

84 cases: carriers 220, 440 and 880 Hz; rates 4.5, 5.0, 5.5, 6.0, 6.5, 7.0 and 7.5 Hz; extents plus or minus 30, 50, 75 and 100 cents; 3 s each. All three trackers' contours go through the same `analyzeVibrato` (MEASUREMENT.md section 3).

| Set | Method | Detected | Rate err median | Rate err max | Extent err median | Extent err max | Mean signed extent err | Failing |
|---|---|---|---|---|---|---|---|---|
| vib_sine_48k | browser tracker | 84/84 | 0.0002 Hz | 0.0014 Hz | 2.69% | 4.33% | -2.77% | 0 |
| vib_sine_48k | pYIN | 84/84 | 0.0156 Hz | 0.0640 Hz | 7.58% | 19.40% | -5.94% | **20** |
| vib_sine_48k | Praat | 84/84 | 0.0000 Hz | 0.0001 Hz | 3.50% | 5.44% | -3.59% | 0 |
| vib_harm_48k (8 harmonic cases) | browser tracker | 8/8 | 0.0002 Hz | 0.0006 Hz | 2.18% | 4.11% | -2.27% | 0 |
| vib_harm_48k | pYIN | 8/8 | 0.0206 Hz | 0.0407 Hz | 6.49% | 9.26% | -2.80% | 0 |
| vib_harm_48k | Praat | 8/8 | 0.0000 Hz | 0.0001 Hz | 3.37% | 5.36% | -3.47% | 0 |

The browser tracker under-reads extent by about 3% on average. The worst cases are all at 7.5 Hz on the 220 Hz carrier (-4.33%, -4.32%, -4.32% for extents 50, 100 and 75 c), which matches the window-averaging attenuation predicted in MEASUREMENT.md section 3. Frame-level contour error during vibrato: median 0.94 c, P95 3.03 c, max 4.89 c.

**Failing reference cases (pYIN), carrier / rate / extent / extent error:**
220 Hz: 4.5/30 +14.2%, 6.0/30 -14.1%, 6.5/30 -12.0%, 6.5/75 -11.4%, 7.0/30 -12.7%, 7.0/75 -11.2%, 7.5/30 -12.8%, 7.5/75 -11.7%, 7.5/100 -13.7%.
440 Hz: 7.0/30 -11.0%, 7.0/75 -11.4%, 7.5/30 -12.6%, 7.5/75 -12.5%, 7.5/100 -13.8%.
880 Hz: 7.0/50 -17.5%, 7.0/75 -12.5%, 7.5/30 -13.7%, 7.5/50 -18.2%, 7.5/75 -19.4%, 7.5/100 -14.8%.
The pattern (small extents and fast rates fail) fits the 10-cent grid plus Viterbi smoothing. This matters for the reference path only: pYIN should not be used as the vibrato reference for her recordings. Praat should be used instead.

## 4. Real singing: agreement with Praat

### 4.1 Her recordings

Not run. `./data/raw/` does not exist. The pipeline is ready: `./validate.sh raw` runs the browser tracker and Praat on every WAV in `data/raw/` at its original sample rate and adds `raw_praat_agreement` to `results/summary.json`.

### 4.2 Stand-in: Vocadito (40 tracks of solo singing, 44.1 kHz)

| Comparison | Jointly voiced frames | Within 10 c | Within 50 c | Median abs | P95 abs | Octave disagreements |
|---|---|---|---|---|---|---|
| Browser tracker, whole take, vs Praat (M1.1) | 88,735 | **96.46%** | 98.86% | 1.04 c | 7.91 c | 965 |
| Browser tracker, live, vs Praat (M1.1) | 88,735 | **96.28%** | 98.67% | 1.04 c | 8.09 c | 1,130 |
| Plain YIN vs Praat (M1) | 88,735 | 94.36% | 96.78% | 1.08 c | 11.53 c | 2,582 |
| pYIN vs Praat (for scale) | 96,633 | 78.97% | 95.74% | 4.23 c | 42.30 c | 1,921 |

**Verdict (M1.1): passes the 95% threshold on the stand-in, by 1.46 points (whole take) and 1.28 points (live).** In M1, plain YIN failed by 0.64 points. Read section 4.4 before relying on this: the parameters were tuned on half of this dataset, and one track got worse.

Worst tracks, whole take (share within 10 c): vocadito_34 74.8%, vocadito_6 90.3%, vocadito_29 91.3%, vocadito_30 93.2%, vocadito_26 93.7%.
Worst tracks, plain YIN (M1): vocadito_34 57.1%, vocadito_21 86.1%, vocadito_26 87.4%, vocadito_30 88.1%, vocadito_2 88.3%.

### 4.3 Why plain YIN failed (M1), and what was tried

The octave disagreements were checked against Vocadito's human-corrected annotation:

| Octave disagreement frames | Count |
|---|---|
| Browser tracker one octave high (2,447) or low (135) relative to Praat | 2,582 |
| Annotation sides with the browser tracker (Praat is wrong) | 1,246 |
| Annotation sides with Praat (browser tracker is wrong) | 1,274 |
| Neither within 50 c of the annotation | 23 |

So about half the shortfall is Praat's own octave-down errors (almost all on vocadito_34: 1,077 frames). The other half is a real browser-tracker failure: **octave-up errors** on tracks 2, 21, 17, 15, 23 and 30. On those frames the YIN threshold accepts a dip at half the true period (d' about 0.11 to 0.15) while the dip at the true period is 15 to 50 times deeper.

An octave guard was tried: if the dip near 2 x tau is below `octaveRatio` x the current dip, move to it. To avoid tuning on the test data, the parameter was chosen on tracks 1 to 20 and evaluated once on tracks 21 to 40:

| Split | octaveRatio | RPA vs annotation | Octave-error frames |
|---|---|---|---|
| dev (1 to 20) | 0 (off) | 0.9328 | 707 |
| dev (1 to 20) | 0.3 (best on dev) | 0.9436 | 201 |
| test (21 to 40) | 0 (off) | 0.9143 | 1,045 |
| test (21 to 40) | 0.3 | 0.9139 | 1,063 |

On held-out tracks it fixed octave-up errors (568 to 309 frames) but caused as many new octave-down errors on clean, very periodic notes (vocadito_29: 5 to 166; vocadito_37: 18 to 63). A second condition (fire only on shallow dips) made dev results worse, so there was no basis to keep it. **The guard is shipped off.** The held-out tracks were inspected once while diagnosing, so the second attempt's numbers were not used to choose anything.

The recommended next step, choosing among YIN's candidate dips using continuity across frames, was done in M1.1 (section 4.4).

### 4.4 M1.1: continuity across frames

**Method.** MEASUREMENT.md section 1.5. Each voiced frame keeps up to 6 YIN dips; a Viterbi pass picks one per frame, trading dip depth against jumps between frames. Voicing and the frequency value of each dip are unchanged from plain YIN. Code: `src/dsp/continuity.ts`.

**Tuning protocol.** All parameters were chosen on Vocadito tracks 1 to 20 (`tools/continuity_sweep.ts dev`), then frozen, then run once on tracks 21 to 40. Honest caveat: tracks 21 to 40 were looked at during the M1 octave-guard diagnosis, so they are not a pristine held-out set. Her recordings will be the first truly unseen test.

On dev, a 48-point grid showed the result depends mostly on wDown (the cost of moving below the YIN pick). The single best dev score (wDown 0.02, wJump 1, RPA 0.9469) sat on a cliff: its neighbours had 3 to 4 times more octave-down errors. I chose the middle of the stable plateau instead (wDown 0.04 to 0.07, wJump 1.5 to 3, wUp 0.05 to 0.2 all gave dev RPA 0.9464 to 0.9466): wDown 0.05, wJump 2, wUp 0.1.

Frame counts below compare each tracker frame with the nearest annotation frame (the `continuity_sweep.ts` rule), so RPA differs slightly from mir_eval's 10 ms grid in section 5. "Octave up/down" = frames more than 600 c above/below the annotation.

| Split | Tracker | RPA vs annotation | Octave up | Octave down | Within 10 c of Praat |
|---|---|---|---|---|---|
| dev (1 to 20) | plain YIN | 0.9328 | 648 | 59 | 95.90% |
| dev (1 to 20) | live (lag 8) | 0.9453 | 59 | 91 | 97.24% |
| dev (1 to 20) | whole take | 0.9466 | 81 | 8 | 97.33% |
| test (21 to 40) | plain YIN | 0.9143 | 568 | 477 | 92.88% |
| test (21 to 40) | live (lag 8) | 0.9201 | 14 | **947** | 95.29% |
| test (21 to 40) | whole take | 0.9215 | 17 | **883** | 95.59% |

(`results/continuity_dev.txt`, `results/continuity_test.txt`.)

**What improved.** Octave-up errors, the failure diagnosed in 4.3, nearly vanish on held-out tracks (568 to 17 frames). Track 21, the worst octave-up track, goes from 339 frames to fewer than 20.

**What got worse: octave-down errors on held-out tracks rose from 477 to 883 frames, 791 of them on vocadito_34.** On that track plain YIN already locks, on some frames, onto a deep dip at **one third** of the sung frequency (for example 88.8 Hz under a 268 Hz note, d' 0.026). The continuity step then extends that reading across the rest of the note, because staying on it is cheaper than jumping. Elsewhere: vocadito_33 goes from 51 to 43 frames (whole take) but 70 (live), and vocadito_37 gains 95 frames in live mode only. The error is a known weakness of costing jumps: a confident wrong reading early in a note pulls its neighbours along. Fixing it would mean tuning on test data, so I did not. It is listed as an open item.

**Is the Praat pass real, or agreement on shared mistakes?** Praat itself reads vocadito_34 an octave and more too low, so some new agreement there could be agreement on a shared error. Audit (`py/praat_audit.py`, `results/praat_audit.json`, frames where the annotation is voiced, annotation decides who is right within 50 c):

| Tracker | Joint frames | Within 10 c of Praat | Where Praat is right: within 10 c | Excluding vocadito_34 | Agree with Praat but both wrong |
|---|---|---|---|---|---|
| plain YIN | 85,755 | 94.97% | 96.44% | 96.20% | 460 |
| live | 85,755 | 96.92% | 97.92% | 97.68% | 891 |
| whole take | 85,755 | 97.10% | 98.08% | 97.82% | 912 |

The gain holds on the frames where Praat is right (96.44% to 98.08%) and with vocadito_34 removed, so it is not explained by shared errors. Shared wrong answers did double (460 to 912 frames, about 1% of frames).

**Live lookahead.** Dev results by lag (frames of 5.8 ms at 44.1 kHz), whole-take weights:

| Lag (frames) | 0 | 2 | 4 | 8 | 16 | 32 | whole take |
|---|---|---|---|---|---|---|---|
| dev RPA | 0.9072 | 0.9429 | 0.9441 | 0.9453 | 0.9462 | 0.9467 | 0.9466 |
| dev octave down | 1,871 | 203 | 150 | 91 | 51 | 14 | 8 |

Lag 0 (decide at once from the past only) is worse than plain YIN. Lag 8 keeps most of the gain for about 43 ms of extra delay; it is the shipped live default, pending her view (section 11).

**Synthetic checks.** Tones and vibrato are bit-identical to plain YIN (criteria 1 and 2). The 20 dB noise set improves (P95 5.76 to 4.79 c, max 18.19 to 10.89 c), because a few noisy frames now take a neighbouring dip that matches the note.

## 5. Annotated dataset: Vocadito with mir_eval

40 tracks, mean over tracks, mir_eval 0.8.2 defaults (50-cent tolerance, 10 ms grid).

| Method | Voicing recall | Voicing false alarm | Raw pitch acc. | Raw chroma acc. | Overall acc. |
|---|---|---|---|---|---|
| Browser tracker, whole take (M1.1) | 0.932 | 0.089 | 0.923 | 0.930 | 0.919 |
| Browser tracker, live (M1.1) | 0.932 | 0.089 | 0.922 | 0.930 | 0.918 |
| Plain YIN (M1) | 0.932 | 0.089 | 0.912 | 0.922 | 0.912 |
| pYIN | 0.996 | 0.368 | 0.983 | 0.985 | 0.865 |
| Praat | 0.975 | 0.187 | 0.954 | 0.970 | 0.907 |

Read with care:
- **Vocadito's F0 annotations were made by correcting pYIN output in Tony** (per the dataset paper), so pYIN's pitch accuracy is biased upward here.
- The browser tracker trades recall for few false alarms (threshold 0.15). Most of its RPA gap is frames it calls unvoiced; RCA minus RPA (about 1 point) is the octave-error share.
- Worst tracks by RPA (M1 numbers): plain YIN vocadito_34 0.729, 21 0.756, 30 0.786, 23 0.815, 26 0.823. Praat vocadito_34 0.472, 15 0.682, 17 0.710. pYIN vocadito_34 0.916.

## 6. Spectrogram and band ratio

| Check | Result |
|---|---|
| Peak frequency of 120 steady sines (both rates), parabolic interpolation | median error 1.02 c, max 4.36 c |
| Peak level of a 0.5 amplitude sine (expected -6.02 dBFS) | -1.38 to -0.00 dB from expected (Hann scalloping, at most 1.42 dB in theory) |
| Band ratio L_SF on 6 harmonic tones with known partials (f0 262 and 523.25 Hz; 2.5 to 3.5 kHz gain 0.25, 1, 4) | max error 0.00013 dB; expected range -28.9 to -1.0 dB |

The band-ratio check confirms the arithmetic and band-edge handling. It does not show that L_SF tracks a singer's formant in a real soprano voice (MEASUREMENT.md section 5).

## 7. Calibration

**Not run.** It needs a reference sine at a known frequency played through her microphone, interface and room. The test page has the procedure (Calibration section, 5 s measurement, reports median F0 and offset in cents).

Digital path only (no microphone): the browser tracker's mean signed error on clean 48 kHz sines is +0.07 c, and +0.09 c at 44.1 kHz. That is the floor that any acoustic offset will be measured against. A real offset would come mainly from sample-clock error in the interface. Clock errors of tens of ppm amount to well under 1 cent.

## 8. Latency

| Component | Value | How |
|---|---|---|
| Algorithmic, live tracker (tone onset to first final frame within 50 c) | 76.0 ms | latency fixture at 48 kHz; Node and Chrome worklet agree |
| Algorithmic, live tracker (to within 10 c) | 81.3 ms | Node |
| of which: continuity lookahead | 42.7 ms | 8 frames x 5.33 ms |
| Algorithmic, plain YIN (M1), to within 50 c / 10 c | 33.3 / 38.7 ms | Node and Chrome |
| Hop quantization | up to 5.3 ms | included above |
| Device input and output latency, message passing, screen refresh | **not measured** | needs acoustic loopback |
| Full loopback, sound to displayed pitch | **not measured** | test page "Loopback latency" section, run on her Mac with speakers on |

Compute load: the tracker runs 49 to 59 times faster than real time in Node with the spectrum on, so the live worklet uses roughly 2% of one core.

## 9. Thresholds I think need a decision (none were changed)

1. **Tone range 130 to 1050 Hz may be too narrow.** A soprano's working top is often around C6 to F6 (1047 to 1397 Hz), and higher for coloratura. I tested C#6 to A6 as an extra set (all pass, max 0.99 c). Proposal: extend the scored range to her actual top note once she gives it.
2. **Pure sines are an easy case.** All three trackers pass criterion 1 with wide margins, so it does not separate them. Proposal: score the harmonic and 20 dB noise sets against the same thresholds too. On today's numbers all three would still pass (worst P95 is pYIN at 10.65 c in noise), so this adds coverage without changing any verdict.
3. **"Agree with Praat" treats Praat as ground truth, but it is not.** On Vocadito, Praat is wrong on about half of the octave disagreements. Proposal: keep the 95% criterion, and for frames that disagree by more than 50 c, adjudicate against a manual check (or annotations where they exist) and report both numbers.
4. **The Praat criterion now passes, but it is the wrong instrument for the remaining errors.** After M1.1 the largest single shortfall (vocadito_34) is a case where both trackers are wrong in the same direction. A tracker could raise its Praat score by copying Praat's mistakes. Proposal as in item 3: report agreement on frames where an annotation or manual check says Praat is right, alongside the raw number.
5. **No thresholds exist for mir_eval, calibration or latency.** Suggested starting points for discussion, not applied: RPA >= 0.95 on annotated solo singing; |calibration offset| <= 1 c; loopback latency median <= 100 ms. These are proposals without a cited basis.

## 10. Not done in M1, by design

- No hub, no themed screens, no Dexie storage, no helper. The test page at `index.html` is bare. It links the shared `src/styles/tokens.css` (both themes as one token set) and carries the footer.
- MusicXML scores, repertoire and teacher notes: none exist yet. Nothing was built for them.

## 10b. Open technical items after M1.1

- Octave-down propagation on vocadito_34 (section 4.4): one confident subharmonic reading drags a whole note down. Candidate fixes to try against her recordings, not against Vocadito tracks 21 to 40: a cost on long jumps that scales with how isolated a reading is, or restarting the path at large dips in the d' value.
- The candidate limits (6 dips, d' < 0.5) were not tuned.

## 11. Stopped at M1.1. Open questions for her

1. **Reference pitch:** A4 = 440 or 442 Hz? Does it change by venue or ensemble? (Every cents reading moves 7.85 c between the two.)
2. **Voice type and working range:** lowest and highest notes she sings in practice and in performance. This sets the F0 search range, the scored test range (section 9.1), and whether the 2.5 to 3.5 kHz band is meaningful for her voice.
3. **Mic and interface:** which microphone and audio interface, at what sample rate, and in which room(s)? Needed for calibration (section 7), loopback latency (section 8), and the -50 dBFS voicing gate.
4. **After a take, what does she want to know?** For example: pitch accuracy per note against the score, vibrato rate and extent over a phrase, how steady a sustained note is, or energy in the 2.5 to 3.5 kHz band. This decides which measurements reach the first designed screen.

5. **Live readout: fast or steady?** The live pitch can appear about 33 ms after she sings (plain YIN, more octave slips) or about 76 ms after (with the 8-frame lookahead, far fewer slips). A third option shows the fast value at once and corrects it 43 ms later, which may look like flicker. Which does she prefer while singing? Post-take analysis always uses the whole-take decoding.

Also needed before the Praat agreement check can run on real material:
6. The recordings themselves in `./data/raw/` (original sample rate, WAV), with mic and room noted for each take.
7. Permission to keep them local-only in this project folder (they are git-ignored).
