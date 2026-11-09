## Synthetic steady tones (pooled frames, |error| in cents)

| Set | Method | Frames | Voicing recall | Median | P95 | Max | Gross >50c | Octave >600c |
|---|---|---|---|---|---|---|---|---|
| tone_sine_48k | browser tracker, whole take (YIN + continuity) | 9689 | 1.0000 | 0.027 | 0.228 | 0.39 | 0 | 0 |
| tone_sine_48k | browser tracker, live (YIN + continuity, 8-frame lag) | 9689 | 1.0000 | 0.027 | 0.228 | 0.39 | 0 | 0 |
| tone_sine_48k | plain YIN (M1 tracker) | 9689 | 1.0000 | 0.027 | 0.228 | 0.39 | 0 | 0 |
| tone_sine_48k | pYIN (librosa) | 9660 | 1.0000 | 0.637 | 10.637 | 12.86 | 0 | 0 |
| tone_sine_48k | Praat ac (Parselmouth) | 9660 | 1.0000 | 0.004 | 0.024 | 0.04 | 0 | 0 |
| tone_sine_44k | browser tracker, whole take (YIN + continuity) | 8904 | 1.0000 | 0.039 | 0.369 | 0.50 | 0 | 0 |
| tone_sine_44k | browser tracker, live (YIN + continuity, 8-frame lag) | 8904 | 1.0000 | 0.039 | 0.369 | 0.50 | 0 | 0 |
| tone_sine_44k | plain YIN (M1 tracker) | 8904 | 1.0000 | 0.039 | 0.369 | 0.50 | 0 | 0 |
| tone_sine_44k | pYIN (librosa) | 8880 | 1.0000 | 0.637 | 10.637 | 12.86 | 0 | 0 |
| tone_sine_44k | Praat ac (Parselmouth) | 8880 | 1.0000 | 0.004 | 0.015 | 0.03 | 0 | 0 |
| tone_harm_48k | browser tracker, whole take (YIN + continuity) | 9689 | 1.0000 | 0.130 | 0.987 | 1.75 | 0 | 0 |
| tone_harm_48k | browser tracker, live (YIN + continuity, 8-frame lag) | 9689 | 1.0000 | 0.130 | 0.987 | 1.75 | 0 | 0 |
| tone_harm_48k | plain YIN (M1 tracker) | 9689 | 1.0000 | 0.130 | 0.987 | 1.75 | 0 | 0 |
| tone_harm_48k | pYIN (librosa) | 9660 | 1.0000 | 0.637 | 4.714 | 5.53 | 0 | 0 |
| tone_harm_48k | Praat ac (Parselmouth) | 9660 | 1.0000 | 0.000 | 0.001 | 0.00 | 0 | 0 |
| tone_noise20_48k | browser tracker, whole take (YIN + continuity) | 9689 | 1.0000 | 1.189 | 4.790 | 10.89 | 0 | 0 |
| tone_noise20_48k | browser tracker, live (YIN + continuity, 8-frame lag) | 9689 | 1.0000 | 1.189 | 4.808 | 10.89 | 0 | 0 |
| tone_noise20_48k | plain YIN (M1 tracker) | 9689 | 1.0000 | 1.223 | 5.756 | 18.19 | 0 | 0 |
| tone_noise20_48k | pYIN (librosa) | 9660 | 1.0000 | 0.637 | 10.652 | 30.64 | 0 | 0 |
| tone_noise20_48k | Praat ac (Parselmouth) | 9660 | 1.0000 | 1.670 | 5.931 | 10.69 | 0 | 0 |
| tone_high_48k | browser tracker, whole take (YIN + continuity) | 1449 | 1.0000 | 0.452 | 0.982 | 0.99 | 0 | 0 |
| tone_high_48k | browser tracker, live (YIN + continuity, 8-frame lag) | 1449 | 1.0000 | 0.452 | 0.982 | 0.99 | 0 | 0 |
| tone_high_48k | plain YIN (M1 tracker) | 1449 | 1.0000 | 0.452 | 0.982 | 0.99 | 0 | 0 |
| tone_high_48k | pYIN (librosa) | 1449 | 1.0000 | 0.637 | 0.637 | 0.64 | 0 | 0 |
| tone_high_48k | Praat ac (Parselmouth) | 1449 | 1.0000 | 0.001 | 0.002 | 0.00 | 0 | 0 |

## Synthetic vibrato

| Set | Method | Cases | Detected | Rate err median (Hz) | Rate err max (Hz) | Extent err median | Extent err max | Mean signed extent err | Failing cases |
|---|---|---|---|---|---|---|---|---|---|
| vib_sine_48k | browser tracker, whole take (YIN + continuity) | 84 | 84 | 0.0002 | 0.0014 | 2.69% | 4.33% | -2.77% | 0 |
| vib_sine_48k | browser tracker, live (YIN + continuity, 8-frame lag) | 84 | 84 | 0.0002 | 0.0014 | 2.69% | 4.33% | -2.77% | 0 |
| vib_sine_48k | plain YIN (M1 tracker) | 84 | 84 | 0.0002 | 0.0014 | 2.69% | 4.33% | -2.77% | 0 |
| vib_sine_48k | pYIN (librosa) | 84 | 84 | 0.0156 | 0.0640 | 7.58% | 19.40% | -5.94% | 20 |
| vib_sine_48k | Praat ac (Parselmouth) | 84 | 84 | 0.0000 | 0.0001 | 3.50% | 5.44% | -3.59% | 0 |
| vib_harm_48k | browser tracker, whole take (YIN + continuity) | 8 | 8 | 0.0002 | 0.0006 | 2.18% | 4.11% | -2.27% | 0 |
| vib_harm_48k | browser tracker, live (YIN + continuity, 8-frame lag) | 8 | 8 | 0.0002 | 0.0006 | 2.18% | 4.11% | -2.27% | 0 |
| vib_harm_48k | plain YIN (M1 tracker) | 8 | 8 | 0.0002 | 0.0006 | 2.18% | 4.11% | -2.27% | 0 |
| vib_harm_48k | pYIN (librosa) | 8 | 8 | 0.0206 | 0.0407 | 6.49% | 9.26% | -2.80% | 0 |
| vib_harm_48k | Praat ac (Parselmouth) | 8 | 8 | 0.0000 | 0.0001 | 3.37% | 5.36% | -3.47% | 0 |
