## Synthetic steady tones (pooled frames, |error| in cents)

| Set | Method | Frames | Voicing recall | Median | P95 | Max | Gross >50c | Octave >600c |
|---|---|---|---|---|---|---|---|---|
| tone_sine_48k | whole take (YIN + continuity) | 9689 | 1.0000 | 0.027 | 0.228 | 0.39 | 0 | 0 |
| tone_sine_48k | live (plain YIN) | 9689 | 1.0000 | 0.027 | 0.228 | 0.39 | 0 | 0 |
| tone_sine_48k | pYIN (librosa) | 9660 | 1.0000 | 0.637 | 10.637 | 12.86 | 0 | 0 |
| tone_sine_48k | Praat ac (Parselmouth) | 9660 | 1.0000 | 0.004 | 0.024 | 0.04 | 0 | 0 |
| tone_sine_44k | whole take (YIN + continuity) | 8904 | 1.0000 | 0.039 | 0.369 | 0.50 | 0 | 0 |
| tone_sine_44k | live (plain YIN) | 8904 | 1.0000 | 0.039 | 0.369 | 0.50 | 0 | 0 |
| tone_sine_44k | pYIN (librosa) | 8880 | 1.0000 | 0.637 | 10.637 | 12.86 | 0 | 0 |
| tone_sine_44k | Praat ac (Parselmouth) | 8880 | 1.0000 | 0.004 | 0.015 | 0.03 | 0 | 0 |
| tone_harm_48k | whole take (YIN + continuity) | 9689 | 1.0000 | 0.130 | 0.987 | 1.75 | 0 | 0 |
| tone_harm_48k | live (plain YIN) | 9689 | 1.0000 | 0.130 | 0.987 | 1.75 | 0 | 0 |
| tone_harm_48k | pYIN (librosa) | 9660 | 1.0000 | 0.637 | 4.714 | 5.53 | 0 | 0 |
| tone_harm_48k | Praat ac (Parselmouth) | 9660 | 1.0000 | 0.000 | 0.001 | 0.00 | 0 | 0 |
| tone_noise20_48k | whole take (YIN + continuity) | 9689 | 1.0000 | 1.189 | 4.790 | 10.89 | 0 | 0 |
| tone_noise20_48k | live (plain YIN) | 9689 | 1.0000 | 1.223 | 5.756 | 18.19 | 0 | 0 |
| tone_noise20_48k | pYIN (librosa) | 9660 | 1.0000 | 0.637 | 10.652 | 30.64 | 0 | 0 |
| tone_noise20_48k | Praat ac (Parselmouth) | 9660 | 1.0000 | 1.670 | 5.931 | 10.69 | 0 | 0 |
| tone_high_48k | whole take (YIN + continuity) | 1449 | 1.0000 | 0.452 | 0.982 | 0.99 | 0 | 0 |
| tone_high_48k | live (plain YIN) | 1449 | 1.0000 | 0.452 | 0.982 | 0.99 | 0 | 0 |
| tone_high_48k | pYIN (librosa) | 1449 | 1.0000 | 0.637 | 0.637 | 0.64 | 0 | 0 |
| tone_high_48k | Praat ac (Parselmouth) | 1449 | 1.0000 | 0.001 | 0.002 | 0.00 | 0 | 0 |

## Synthetic vibrato

| Set | Method | Cases | Detected | Rate err median (Hz) | Rate err max (Hz) | Extent err median | Extent err max | Mean signed extent err | Failing cases |
|---|---|---|---|---|---|---|---|---|---|
| vib_sine_48k | whole take (YIN + continuity) | 84 | 84 | 0.0002 | 0.0014 | 2.69% | 4.33% | -2.77% | 0 |
| vib_sine_48k | live (plain YIN) | 84 | 84 | 0.0002 | 0.0014 | 2.69% | 4.33% | -2.77% | 0 |
| vib_sine_48k | pYIN (librosa) | 84 | 84 | 0.0156 | 0.0640 | 7.58% | 19.40% | -5.94% | 20 |
| vib_sine_48k | Praat ac (Parselmouth) | 84 | 84 | 0.0000 | 0.0001 | 3.50% | 5.44% | -3.59% | 0 |
| vib_harm_48k | whole take (YIN + continuity) | 8 | 8 | 0.0002 | 0.0006 | 2.18% | 4.11% | -2.27% | 0 |
| vib_harm_48k | live (plain YIN) | 8 | 8 | 0.0002 | 0.0006 | 2.18% | 4.11% | -2.27% | 0 |
| vib_harm_48k | pYIN (librosa) | 8 | 8 | 0.0206 | 0.0407 | 6.49% | 9.26% | -2.80% | 0 |
| vib_harm_48k | Praat ac (Parselmouth) | 8 | 8 | 0.0000 | 0.0001 | 3.37% | 5.36% | -3.47% | 0 |

## Criterion 3: Praat agreement, within 10 c on >= 95% of jointly voiced frames (Vocadito stand-in)

| Path | Within 10 c | Joint voiced frames | Verdict |
|---|---|---|---|
| whole take (YIN + continuity) | 96.46% | 88735 | pass |
| live (plain YIN) | 94.36% | 88735 | fail |

## M2.1 parity (F-01 to F-03) and vibrato spans (F-24 to F-26)

| Criterion | Detail | Verdict |
|---|---|---|
| F-01 | 68 files, 0 sample mismatches | pass |
| F-02 | 39702 frames, 0 start and 0 voiced mismatches | pass |
| F-03 | 33166 voiced frames, 0 outside 0.001 c, max 0 c | pass |
| F-24 | vib_long_48k: 20 spans scored, 0 failing | pass |
| F-25 | vib_change_48k: 12 spans scored, 0 failing | pass |
| F-26 | steady_long_48k: 36 spans scored, 0 failing | pass |
