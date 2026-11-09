# MEASUREMENT.md

Exact definitions of every quantity the voice analysis tool reports, as implemented in M1.
Code is the reference for anything this document leaves ambiguous; file paths are given per section.

For practice and study. Not a diagnostic or medical device. None of these quantities is a clinical measure, and the tool must never present them as one.

## 0. Status of inputs

| Input named in the brief | Status on 2026-11-08 |
|---|---|
| `./data/raw/` her recordings | **Does not exist.** No recordings anywhere in the project. Mic and room per take therefore unknown. |
| `./data/notes/` teacher notes | Does not exist. |
| `./data/repertoire/` | Does not exist. |
| `./data/scores/` MusicXML | Does not exist. |
| Vocadito | Exists. Zenodo record 5578807, license CC BY 4.0, open access, 58.5 MB. Downloaded to `datasets/vocadito/` and used. |
| VocalSet | Exists. Zenodo record 1442513 (v1.2), license CC BY 4.0, open access. 6.0 GB plus a 2.1 GB variant. Not downloaded: it has no F0 annotations, so it cannot feed mir_eval. Useful later as unannotated professional singing (it includes a vibrato technique class). |
| MIR-1K | Zenodo record 3532216 is **restricted** with no license listed. The mirlab.org mirror (`/dataset/public/MIR-1K.rar`) returned HTTP 404. **Not used.** |
| Design reference files | Read (Clinical3Landing, Clinical3Tools, Clinical3Analysis, LoudPitch). They fix the defaults shown in the UI: reference A4 = 440 Hz, window 2048 samples, display range 0 to 4 kHz. M1 builds no themed screen. |

Because none of her material exists yet, every definition below uses defaults that her answers may change (section 10).

## 1. Fundamental frequency, F0 (Hz)

**Definition.** For each analysis frame, F0 = fs / tau, where fs is the input sample rate in Hz and tau is a fractional lag in samples at one of the dips of the YIN normalized difference (sections 1.2 and 1.5). Which dip is used is decided by the continuity step in section 1.5 (since M1.1). Unvoiced frames have no F0 (stored as 0).

Code: `src/dsp/yin.ts`, continuity step in `src/dsp/continuity.ts`, frame scheduling in `src/dsp/analyzer.ts`, live path in `src/audio/tracker.worklet.ts`. The worklet and the offline Node runner call the same `FrameAnalyzer`.

### 1.1 Frame layout

| Parameter | Value | Meaning |
|---|---|---|
| fs | native rate of the input, never resampled | 48000 or 44100 Hz in practice |
| N (buffer) | 2048 samples | 42.7 ms at 48 kHz, 46.4 ms at 44.1 kHz |
| W (integration window) | 1024 samples | 21.3 ms at 48 kHz |
| H (hop) | 256 samples | 5.33 ms at 48 kHz, 187.5 frames per second |
| Lag range | tau_min = floor(fs / 2000), tau_max = min(N - W, ceil(fs / 60)) | F0 search range 60 to 2000 Hz (lower limit 60 Hz at 48 kHz is set by fs/60 = 800 < N - W = 1024) |

### 1.2 Procedure (de Cheveigne and Kawahara 2002, steps 2 to 5)

For a buffer x[0..N-1]:

1. Difference function, for tau = 0..N-W:
   d(tau) = sum over j = 0..W-1 of (x[j] - x[j + tau])^2.
   Computed exactly as e(0) + e(tau) - 2 r(tau), where e(tau) is the energy of x[tau..tau+W-1] (prefix sums) and r(tau) = sum x[j] x[j+tau] is taken from an FFT cross-correlation of size N. No circular wrap occurs because j + tau <= N - 1.
2. Cumulative mean normalized difference: d'(0) = 1; d'(tau) = d(tau) * tau / (sum over k = 1..tau of d(k)).
3. Absolute threshold: the smallest tau in [tau_min, tau_max] with d'(tau) < 0.15, then advanced while d' keeps decreasing (to the bottom of that dip). If no tau is below 0.15 the frame is **unvoiced**.
4. Parabolic interpolation of d' through (tau - 1, tau, tau + 1) gives the fractional lag. Shifts larger than one sample are discarded.

Step 6 of the paper (best local estimate) is not used.

### 1.3 Voicing

A frame is voiced only if both hold:
- RMS of x[0..W-1] is at least -50 dBFS, and
- the threshold step found a dip (d'(tau) < 0.15).

The value d'(tau) at the chosen lag is stored as `aperiodicity` (0 = perfectly periodic).

An optional octave guard (`octaveRatio`, `octaveMinDip` in `yin.ts`) exists but is **off** (0). It was tried during validation and did not improve held-out data; see VALIDATION.md section 4.3.

### 1.4 Timestamp

Each frame's time is the midpoint of the samples the plain YIN estimate used: t = (s + (W + tau_0) / 2) / fs, where s is the absolute index of the buffer's first sample and tau_0 is the threshold pick (candidate 0 in section 1.5). The timestamp does not move when the continuity step picks another candidate; the true midpoint of the chosen dip differs by |tau_i - tau_0| / 2 samples, about 1.2 ms for an octave correction at 220 Hz (48 kHz). Keeping t fixed makes the three tracker variants share one time axis. Unvoiced frames use t = (s + W / 2) / fs. Plain YIN values are known at sample s + N; in the live tracker the frame is posted when its choice is final, at sample s + N + L x H at the latest (`readyAt` in the worklet, L in section 1.5).

### 1.5 Continuity across frames (M1.1)

Plain YIN picks each frame's dip on its own, and on real singing it sometimes picks the dip at half the true period (one octave high). M1.1 adds a choice among dips that looks at neighbouring frames. The idea follows pYIN (Mauch and Dixon 2014), which decodes YIN candidates with a hidden Markov model; **the costs below are this project's own, not pYIN's**.

Candidates, per voiced frame (voicing is unchanged from section 1.3):
- candidate 0 is the threshold pick from section 1.2, with frequency f_0 and dip value d_0;
- candidates 1..5 are the other local minima of d' in [tau_min, tau_max] with d' < 0.5, deepest first (at most 6 in total), each refined by the same parabolic interpolation.

For a run of consecutive voiced frames, a path picks one candidate (f_i, d_i) per frame. Its cost is

  sum over frames of [ wD x d_i + wDown x max(0, log2(f_0 / f_i)) + wUp x max(0, log2(f_i / f_0)) ] + sum over consecutive frames of wJump x |log2(f_b / f_a)|,

with wD = 1, wDown = 0.05, wUp = 0.1, wJump = 2 (units: d' and octaves). The cheapest path is found with the Viterbi algorithm. An unvoiced frame ends the run, so voicing decisions and candidate frequencies are exactly those of plain YIN; only the choice among candidates changes.

Decoding modes:
- **Whole take** (post-take analysis, offline runner default): each voiced run is decoded as a whole.
- **Live** (worklet): fixed-lag decoding with L = 8 frames. A frame's choice is final when 8 later frames are known (42.7 ms at 48 kHz, 46.4 ms at 44.1 kHz) or when its voiced run ends.
- **Plain YIN** (the M1 tracker): candidate 0 always. Kept for comparison (`node tools/run_ts.ts track <in> <out> yin`).

The four weights and L are engineering choices tuned on Vocadito tracks 1 to 20 only (VALIDATION.md section 4.4). They are not sourced.

## 2. Cents and note names

Code: `src/dsp/pitch.ts`.

**Reference.** A4 = A_ref Hz. Default A_ref = 440 Hz (ISO 16 standard tuning frequency, and the value in the design files). A_ref is a parameter everywhere and must be set from her answer (440 or 442). Changing 440 to 442 moves every cents reading by 1200 log2(442/440) = 7.85 cents.

**Cents between two frequencies.** c(f, f_ref) = 1200 log2(f / f_ref). Positive means f is above f_ref.

**Absolute pitch scale** (contours, vibrato): cents above A4, c_A4(f) = 1200 log2(f / A_ref).

**Nearest note and deviation** (the "A4 +3 cents" readout), 12-tone equal temperament:
- s = 12 log2(f / A_ref), n = round(s), deviation = 100 (s - n) cents.
- If deviation = +50 exactly, n is incremented so the deviation lies in [-50, +50).
- MIDI number m = 69 + n. Name uses scientific pitch notation: A4 = MIDI 69, middle C = C4 = MIDI 60, sharps spelled with #.
- Target frequency A_ref * 2^(n/12).

Equal temperament is the only tuning reference in M1. Singers often tune intervals away from equal temperament, so "+3 cents" means "3 cents above the equal-tempered note at this A4", not "out of tune".

## 3. Vibrato rate (Hz) and extent (cents)

Code: `src/dsp/vibrato.ts`. The same function scores this tracker, pYIN and Praat.

**Input.** A uniformly spaced F0 contour. The longest voiced run is analysed; unvoiced gaps of up to 3 frames are bridged by linear interpolation in cents. The run must be at least 0.5 s long.

**Procedure.**
1. Convert to cents (section 2; the reference cancels out).
2. Remove a least-squares straight line, and estimate the period P from the highest normalized autocorrelation peak at lags corresponding to 3 to 9 Hz (parabolic refinement). If the peak is below 0.3, no vibrato is reported.
3. Trend = centred moving average exactly one period P long (fractional edge weights), which has a spectral zero at the vibrato rate. Oscillation o(t) = cents(t) - trend(t). Frames without a full window are dropped.
4. Extrema: samples of o(t) that are the maximum or minimum within plus or minus P/4, alternating maximum and minimum, refined by parabolic interpolation in time and value. At least 4 extrema are required.

**Rate (Hz)** = (number of half cycles) / (2 x time from first to last extremum). A half cycle is one peak-to-trough or trough-to-peak interval.

**Extent (cents), stated as plus or minus.** Extent = half the median of |o(peak) - o(adjacent trough)| over all consecutive extrema. A vibrato swinging from -50 to +50 cents has extent plus or minus 50 cents. Peak-to-peak extent (2 x extent) is also returned as `extentPeakToPeakCents`, and any UI must label which one it shows.

**Known bias.** The 1024-sample integration window averages pitch over about 21 ms, which flattens fast vibrato. The expected attenuation of a sinusoidal modulation is roughly sin(pi r T) / (pi r T) with T the window length. At r = 7.5 Hz, T = 21.3 ms this is about 4%. Measured mean bias is -2.8% and worst case -4.3% (VALIDATION.md). No correction is applied.

## 4. Spectrogram

Code: `src/dsp/spectrum.ts`, columns posted by the worklet.

- Frame: the same N = 2048 sample buffer as F0, same hop H = 256.
- Window: periodic Hann, w[i] = 0.5 - 0.5 cos(2 pi i / N).
- Power per bin: P[k] = |X[k]|^2 for k = 0..N/2, bin centre f_k = k fs / N (23.4 Hz spacing at 48 kHz).
- Level in dBFS: 20 log10(2 |X[k]| / sum(w)), so a full-scale sine reads 0 dBFS at its peak bin. The peak bin of an off-centre sine reads up to 1.42 dB low (Hann scalloping); measured worst case -1.38 dB.
- Peak frequency (used only for checks): strongest bin, refined by parabolic interpolation on log power.
- Display range in the design: 0 to 4 kHz. The worklet sends bins up to 5 kHz.

## 5. Singer's formant band-energy ratio (dB)

Code: `bandRatioDb` in `src/dsp/spectrum.ts`.

**Definition.**

    L_SF = 10 log10( E[2500, 3500) / E[50, 2000) )  dB

where E[lo, hi) is the sum of P[k] over bins whose centre frequency f_k satisfies lo <= f_k < hi (section 4 spectra). For a take or a time span, P[k] is first summed over all **voiced** frames, and the ratio is taken once. Unvoiced frames are excluded. Higher (less negative) values mean relatively more energy in 2.5 to 3.5 kHz.

**Band edges are a project convention, not taken from one primary source.**
- The 2.5 to 3.5 kHz band matches the hatched band in the design ("about 2.5 to 3.5 kHz") and the region where Sundberg (1974) located the clustering of formants 3 to 5 that he called the singing formant. The cluster's frequency varies with voice type, so a fixed band is an approximation.
- The 50 Hz to 2 kHz reference band excludes rumble below 50 Hz and follows the 0 to 2 kHz low band of the singing power ratio (Omori et al. 1996).
- This is **not** the singing power ratio. SPR compares the strongest *peak* in 2 to 4 kHz with the strongest peak in 0 to 2 kHz. L_SF compares band *energies* and uses a narrower upper band. Values are not comparable with published SPR figures.

**Caveat for a soprano.** At high F0 the harmonics are far apart (above about 1 kHz, at most one harmonic falls inside a 1 kHz wide band), so L_SF can jump when a single harmonic enters or leaves the band. Whether sopranos show a singer's formant cluster at all is debated (for example Weiss, Brown and Morris 2001). The UI should therefore label this quantity by what it measures ("Energy 2.5 to 3.5 kHz relative to 0.05 to 2 kHz") and not claim it measures a singer's formant for every voice.

## 6. Synthetic ground truth

Code: `py/synth.py`, parameters in `fixtures/synthetic/manifest.json`.

Instantaneous frequency f(t) = f0 x 2^((E / 1200) sin(2 pi r t)), where E is the plus or minus extent in cents and r the rate in Hz (E = 0 for steady tones). Phase is the running sum of f(t)/fs, so the waveform's frequency equals f(t) at every sample. Harmonic variants use partial k with phase k x phase(t) plus a random offset and amplitude 1/k, with partials above 0.45 fs dropped. Every signal has 20 ms raised-cosine fades, peak amplitude 0.5, and is written as 32-bit float WAV at its stated rate. The generator is seeded and deterministic.

Band-ratio fixtures use known partial amplitudes, so the expected L_SF is computed in closed form from the partials that fall in each band. f0 = 262 and 523.25 Hz were chosen so that no partial lies within 90 Hz of a band edge.

## 7. Reference trackers

Code: `py/reference.py`. Versions: librosa 1.0.0, praat-parselmouth 0.4.7 (Praat 6.1.38), mir_eval 0.8.2, numpy 2.5.4.

- **pYIN** (Mauch and Dixon 2014): `librosa.pyin`, fmin 60, fmax 2000, frame_length 2048, hop 256, centred frames, other parameters at librosa defaults. Note: pYIN's default pitch grid has 10-cent resolution (`resolution = 0.1` semitone) before Viterbi decoding. This caps its precision on steady tones (median 0.64 cents but P95 10.6 cents).
- **Praat** (Boersma 1993) through Parselmouth (Jadoul et al. 2018): `Sound.to_pitch_ac` (Praat "To Pitch (ac)"), time step 256 samples, pitch floor 60 Hz, pitch ceiling 2000 Hz, other parameters at Praat defaults. With a 60 Hz floor Praat uses a longer analysis window than this tracker.

## 8. Scoring definitions

Code: `py/score.py`.

- **Frame error** (synthetic): e = 1200 log2(f_est(t) / f_true(t)) cents at each frame's own timestamp t. Frames within 70 ms of either end are excluded (inside the fades). Statistics are pooled over all frames of a set; per-file statistics are kept for failure listings.
- **Gross error**: |e| > 50 cents. **Octave error**: |e| > 600 cents (closer to another octave than to the true pitch class's octave).
- **Voicing recall** (synthetic): voiced frames / scored frames.
- **Vibrato errors**: rate error = rate_est - r (Hz). Extent error = (extent_est - E) / E, relative. A case passes when |rate error| <= 0.3 Hz and |extent error| <= 10%.
- **Praat agreement** (real singing): for each Praat frame, take the tracker frame nearest in time, which must be within 3 ms. Over frames where both call voiced, report the share with |1200 log2(f_tracker / f_praat)| <= 10 cents.
- **Annotated datasets**: mir_eval `melody.evaluate` (Raffel et al. 2014), which resamples to a 10 ms grid and reports Voicing Recall, Voicing False Alarm, Raw Pitch Accuracy (within 50 cents), Raw Chroma Accuracy (octave errors forgiven) and Overall Accuracy, as defined in Salamon et al. 2014. Values are the mean over tracks.
- **Calibration offset**: median F0 over at least 50 voiced frames of a 5 s steady reference sine through her microphone chain, reported as 1200 log2(median / f_reference) cents.
- **Algorithmic latency**: from the onset sample of a tone after silence to the moment the first estimate within 50 cents (and, separately, 10 cents) of the true pitch is final: the end of its analysis buffer, plus L x H for the live tracker.
- **Loopback latency**: from the time a scheduled burst reaches the output device (from `AudioContext.getOutputTimestamp`) to the `requestAnimationFrame` timestamp of the first drawn frame within 50 cents of 440 Hz. Median and range over 10 bursts.

## 9. Sources

Status key: **checked** = opened in this session; **not checked** = cited from prior knowledge, details (especially page numbers) need verification against the document before publication.

| Source | Used for | Status |
|---|---|---|
| de Cheveigne, A. and Kawahara, H. (2002). YIN, a fundamental frequency estimator for speech and music. JASA 111(4), 1917-1930. | Section 1 | not checked |
| Mauch, M. and Dixon, S. (2014). pYIN: A fundamental frequency estimator using probabilistic threshold distributions. Proc. IEEE ICASSP. | Sections 7 and 1.5 (idea of decoding YIN candidates over time; no parameters taken from it) | not checked |
| Forney, G. D. (1973). The Viterbi algorithm. Proceedings of the IEEE 61(3), 268-278. | Section 1.5, decoding | not checked |
| Boersma, P. (1993). Accurate short-term analysis of the fundamental frequency and the harmonics-to-noise ratio of a sampled sound. Proc. Institute of Phonetic Sciences, Univ. of Amsterdam, 17, 97-110. | Section 7 | not checked |
| Jadoul, Y., Thompson, B. and de Boer, B. (2018). Introducing Parselmouth: A Python interface to Praat. Journal of Phonetics 71, 1-15. | Section 7 | not checked |
| Raffel, C. et al. (2014). mir_eval: A transparent implementation of common MIR metrics. Proc. ISMIR. | Section 8 | not checked (library behaviour checked by running it) |
| Salamon, J., Gomez, E., Ellis, D. P. W. and Richard, G. (2014). Melody extraction from polyphonic music signals. IEEE Signal Processing Magazine 31(2), 118-134. | Metric definitions | not checked |
| Sundberg, J. (1987). The Science of the Singing Voice. Northern Illinois University Press. | Vibrato rate and extent as the measures of vibrato; extent as departure from the mean; singer's formant | not checked; no page numbers given because none were verified |
| Sundberg, J. (1974). Articulatory interpretation of the "singing formant". JASA 55(4), 838-844. | Location of the formant cluster | not checked |
| Prame, E. (1994). Measurements of the vibrato rate of ten singers. JASA 96(4), 1979-1984. | Rate from the F0 contour | not checked |
| Prame, E. (1997). Vibrato extent and intonation in professional Western lyric singing. JASA 102(1), 616-621. | Extent from the F0 contour | not checked; whether Prame reports extent as plus or minus or as peak to peak is **unverified**, so this project states its own convention (section 3) |
| Omori, K. et al. (1996). Singing power ratio: quantitative evaluation of singing voice quality. Journal of Voice 10(3), 228-235. | Section 5 comparison only | not checked |
| Weiss, R., Brown, W. S. and Morris, J. (2001). Singer's formant in sopranos: fact or fiction? Journal of Voice 15(4), 457-468. | Section 5 caveat | not checked |
| ISO 16:1975, Acoustics: standard tuning frequency. | A4 = 440 Hz default | not checked |
| Bittner, R. M. et al. (2021). vocadito: A dataset of solo vocals with f0, note, and lyric annotations. arXiv:2110.05580. | Dataset | checked (Zenodo record and license via the Zenodo API; README in the archive) |
| VocalSet, Zenodo 1442513; MIR-1K, Zenodo 3532216 | Dataset availability | checked (license and access fields via the Zenodo API) |

**Could not source:** the continuity weights wD, wDown, wUp, wJump, the candidate limits (6 candidates, d' < 0.5) and the live lag L = 8 in section 1.5 (tuned on data, VALIDATION.md 4.4); the specific band edges in section 5 (project convention); the 0.15 YIN threshold and -50 dBFS gate (engineering choices, validated empirically rather than sourced); the 0.3 autocorrelation and 3 to 9 Hz limits in the vibrato detector (engineering choices).

## 10. Defaults pending her answers

| Default | Depends on |
|---|---|
| A4 = 440 Hz | Reference pitch question (440 or 442) |
| F0 range 60 to 2000 Hz; thresholds tested 130 to 1050 Hz | Voice type and working range |
| -50 dBFS voicing gate | Her mic and interface gain |
| Live lookahead L = 8 frames (about 43 ms extra delay) | Whether she prefers a faster or a steadier live readout |
| Band edges 2.5 to 3.5 kHz vs 0.05 to 2 kHz | Voice type (section 5 caveat) |
