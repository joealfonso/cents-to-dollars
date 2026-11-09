// Length and size limits for file analysis (specs/M2.md 4.5, F-12, F-13).
//
// MAX_DURATION_S: spec 4.5 sets it to the longest tested duration that completes within the memory and
// time budgets. With the real pipeline (results/m2_take_memory.json, 2026-11-09) every 600 s file fits the
// placeholder budgets (worst renderer footprint peak 765 MB of 1e9 bytes, worst analysis 15.4 s of 60 s),
// and 600 s is the longest duration tested. The budgets are still placeholders (OPEN Q2).
export const MAX_DURATION_S = 600;

// MAX_FILE_BYTES: the largest file a MAX_DURATION_S take can be in the format the analysis is validated
// for at its largest common encoding: 48 kHz, 2 channels, 32-bit float WAV, which is
// 600 s x 48000 x 2 channels x 4 bytes = 230,400,000 bytes of samples, plus 1 MiB for the header and any
// metadata chunks. Compressed MP3 and M4A takes of 600 s are far smaller (about 15 MB in the spike).
// Consequence: some WAVs under 600 s are refused by bytes alone, before any reading: at 600 s, a 64-bit
// float stereo WAV, any WAV with more than 2 channels of 32-bit samples, and 88.2 or 96 kHz stereo WAVs in
// 24 or 32-bit (a 96 kHz stereo 16-bit WAV of 600 s, 230.4 MB, still fits). Those cases are shorter
// takes in bigger encodings; the largest measured WAV is 115 MB (600 s stereo 16-bit), so files between
// that and this limit are allowed but their memory is not measured.
export const MAX_FILE_BYTES = MAX_DURATION_S * 48000 * 2 * 4 + 1024 * 1024;

// Allowance on every compressed-file duration check, from the header (Xing/Info/VBRI frame counts, MP4
// mvhd or mehd, ADTS frame count) and after decoding. Encoders add priming and padding: Chrome trims it when
// the file carries gapless metadata (the 600 s spike files decode to exactly 600 s), but a file without it
// decodes 25 to 50 ms long, and header counts include a few extra frames. Her longest take is 10:00, so
// 600 s plus encoder padding must pass. 1 s covers that with margin. WAV durations are exact and get no slack.
export const DURATION_SLACK_S = 1;

// MAX_COMPRESSED_BYTES: for an MP3 or M4A whose duration cannot be read before decoding (an MP3 with no
// Xing/Info/VBRI frame, whose duration is only an estimate from size and bitrate, or an MP4 whose mvhd and
// mehd give no duration, as in some fragmented files), the file size is the only bound on what decoding
// would allocate. 600 s at 512 kbit/s is 38,400,000 bytes; 512 kbit/s is above the MP3 maximum (320 kbit/s)
// and above usual AAC settings for stereo voice (up to 320 kbit/s), so any 600 s take at a real bitrate
// fits. 1 MiB covers tags and cover art. A larger file of unknown duration is refused before decoding as
// 'too-large'; a smaller one is decoded and its decoded length checked.
export const MAX_COMPRESSED_BYTES = (MAX_DURATION_S * 512000) / 8 + 1024 * 1024;
