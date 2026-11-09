# M2-DESIGN.md: Cents to Dollars, M2 screens

Status: design spec, not built. Revision 3, matching `specs/M2.md` revision 2, with the-user-who-hates-this review folded in (changelog at the end). Branch `m2`. The build spec is `specs/M2.md` (behaviour, states, criteria, OPEN Q1 to Q15). It wins on any conflict with this document. The design language, tokens, themes, components and principles are `design/DESIGN.md` (M1) and are not repeated here. Marking as in DESIGN.md: **FINAL** settled, **OPEN** needs the owner, **CUTTABLE** can be dropped. New design questions are numbered **D1, D2, ...** (section 10). Spec questions keep their numbers (**Q1** to **Q14**).

For practice and study. Not a diagnostic or medical device. The footer line stays on every screen. No "in tune" or "out of tune" wording anywhere; FLAT and SHARP only describe a direction. No score, grade, percentage or pass/fail on sung exercises (spec section 2).

Every constant named here (`MAX_DURATION_S`, `VIB_WINDOW_S`, `MIN_HOLD_S`, `TONE_S`, and so on) is read from code or `summary.json` `m2_params`. The UI never types the number. Copy templates use `{placeholders}`.

---

## 0. Problem, user, assumptions

**User.** The same singer as M1: classically trained, practising alone, voice type and range unknown. She stands 1 to 2 m from the screen while singing. Joseph runs setup and supplies validation files. `docs/research/personas/` does not exist, so the user model is the spec section 1 and DESIGN.md section 0.

**Problems M2 solves, by screen.**
- Recording analysis: she has takes on her phone and no way to look at them. She needs to see what pitch she sang over time, how far from the note, and her vibrato, measured with the better whole-take method.
- Interval recognition: she has no ear training. She needs to hear two notes and name the interval.
- Sung exercises: she has no guided task. She needs to sing a defined task and get defined measures back, with no judgement.

**Assumptions that carry decisions.**
1. On the singing screens (Sustain, Pitch match) she reads from 1 to 2 m, same as M1. This carries the single-slot layout and the large phase cue. Test: watch one session, as in DESIGN.md section 0.
2. On Recording analysis and Interval recognition she sits at the desk with mouse or keyboard. This carries the dense figure stack and normal-size text. Test: same session. If she listens to intervals from across the room, the answer buttons need the Loud sizes in both themes.
3. Her longest realistic take is 10 minutes (owner, 2026-11-08), so the file view must work at that length. Her typical take is still assumed short (a phrase or an exercise). This carries the default zoom (section 3.4). Test: ask for her typical take length (D5).

**Not doing in M2, and why.**
- No take summary on the file view (spec non-goal). The file view shows measurements over time only.
- No live pitch trace during exercises. The live path and the whole-take result can differ by an octave (VALIDATION.md Q6). Showing two pictures of the same take invites her to trust the wrong one. The live hero stays (spec 6.2.1), the trace does not.
- No history of trials or takes. Results last until the next take or leaving the route (spec 6.2.4).
- No confidence display. `aperiodicity` is not validated as confidence (DESIGN.md section 0).
- No animated zoom, pan or cursor (section 7).

---

## 1. Routes and navigation

### 1.1 Route table (FINAL unless marked)

| Hash | RouteName | Title (`document.title` prefix) | Nav marker | Breadcrumb | h1 |
|---|---|---|---|---|---|
| `#/file` | `file` | Recording analysis | Tools | Tools / Recording analysis | Recording analysis |
| `#/aural` | `aural` | Interval recognition | Tools | Tools / Aural skills | Interval recognition |
| `#/exercises` | `exercises` | Sung exercises | Tools | Tools / Sung exercises | Sung exercises |
| `#/exercises/sustain` | `ex-sustain` | Sustain a note | Tools | Tools / Sung exercises / Sustain a note | Sustain a note |
| `#/exercises/match` | `ex-match` | Pitch match | Tools | Tools / Sung exercises / Pitch match | Pitch match |
| `#/exercises/range` | `ex-range` | Range sweep | Tools | ... / Range sweep | Range sweep (**CUTTABLE**, E3) |
| `#/exercises/interval` | `ex-interval` | Sing an interval | Tools | ... / Sing an interval | Sing an interval (**CUTTABLE**, E4) |

Any other path under these heads (`#/file/x`, `#/exercises/nope`) is Not found. A cut exercise's hash is Not found, not a placeholder page.

**M2.3a fallback (spec section 3).** If Phase B slips, M2.3a ships Sustain on files only. That needs no new route: it is the "Measure a held note" panel on `#/file` (section 3.5). The `#/exercises` routes do not exist in M2.3a and resolve to Not found. Tools row 06 becomes a Not built yet row (section 1.4). This is a reason the file version of Sustain lives on the file view: the fallback costs no extra screen.

### 1.2 Router changes (in `src/app/router.ts`, no change to its navigation-number logic)

- Add the RouteNames above to the union and to `PATHS`. `parseHash` today accepts a sub path only for `methods`. It also needs to map `exercises/{sustain|match|range|interval}` to its own RouteName.
- **Each exercise is its own RouteName, so moving between them is a leave (FINAL).** That differs on purpose from Methods deep links (DESIGN.md 6.8), where a sub hash is not a leave. Methods deep links scroll inside one page. Exercises own the mic and the tone player, and switching exercises must stop both, so the existing leave hook machinery has to run.
- Breadcrumb segments are links except the last.

### 1.3 Leave hooks

The old route stays visible until the hook settles, and its main button shows "Stopping…" (DESIGN.md 6.5).

| Route | Leave hook |
|---|---|
| `file` | Stop the worker, discard buffers and results, set an in-memory flag `fileCleared` if a file was open (section 3.3, "No file, after leaving"). No storage. |
| `aural` | Stop any playing tone (T-13), reset the count, close or suspend the output context. |
| `ex-sustain`, `ex-match`, cut exercises | Cancel the trial, take or speaker check, stop the tone, `await live.stop()`, stop the analysis worker (E-28). Returning shows the step it left with one line, only if something was running (DESIGN.md 6.7 pattern): "Your last take was stopped when you left the page.", "Your last trial was stopped when you left the page." or "The speaker check was stopped when you left the page." A check that completed this visit stays valid after a leave, because it is about the devices, not the route. |
| `exercises` (index) | none |

`live.ts` gains the owners `'exercise'` and `'speakercheck'` from its first version (spec section 3). DESIGN.md section 6 needs that change before Phase B is built. The tone player is one module (`src/app/tones.ts`, engineer's naming) used by `aural`, `ex-match` and `ex-interval`.

### 1.4 Tools index (`#/tools`)

Row numbers are identifiers and do not change, so "Tools 02, Aural skills" in the spec stays true.

| No. | Tool | What it does | Input | Status | Links to |
|---|---|---|---|---|---|
| 01 | Voice analysis | Note, cents sharp or flat, vibrato and spectrogram from the microphone | Microphone | readiness | `#/voice` |
| 02 | Aural skills | Interval recognition | Speakers or headphones | readiness | `#/aural` |
| 03 | Source separation | unchanged | Audio file | Not built yet | none |
| 04 | Repertoire register | unchanged | None | Not built yet | none |
| 05 | Recording analysis | Pitch, cents, vibrato and spectrogram of an audio file | Audio file | readiness | `#/file` |
| 06 | Sung exercises | Sustain a note and Pitch match | Microphone, speakers or headphones | readiness | `#/exercises` |

In M2.3a, row 06 is "Not built yet" with no link, and its description reads "Sustain a note and Pitch match. Sustain on a recording is in 05."

- The 02 description changes from "Interval recognition and pitch matching" to "Interval recognition". Pitch match needs the mic and lives in 06. **Reason:** the mic boundary becomes a route boundary. Aural skills never asks for the mic (T-15), so the permission prompt and the mic indicator are predictable from the page she is on. Rejected: Pitch match inside Aural skills, which would put a mic prompt on a page that is otherwise output-only.
- Rows stay in number order, so built and unbuilt rows interleave. Rejected: sorting built rows first, which would make the numbers jump.
- **The Voice analysis detail panel (DESIGN.md 3.2) is replaced (D1).** With four built tools, one fixed detail panel for 01 reads as if 01 were selected. The table goes full width (12 columns). Each tool's requirements move into that tool's own Setup disclosure. Readiness per row:
  - 01 and 06: secure page and AudioWorklet (as `voiceStatus()` today). The mic is asked for later.
  - 02: an `AudioContext` exists. Otherwise "Not available in this browser".
  - 05: `Worker` and `decodeAudioData` exist. Otherwise "Not available in this browser".
- Lede: "Four tools are ready. The others are planned and not built yet." The count is computed from the table.

### 1.5 Overview (`#/`)

- The one primary action stays "Start singing" (DESIGN.md 3.1). Overview keeps a single primary button.
- The "Not built yet" panel drops Aural skills and keeps Source separation, Repertoire register and Sessions.
- A new panel **More tools** (col-5, above Not built yet) has three link rows: "Open a recording" (`#/file`), "Interval recognition" (`#/aural`), "Sung exercises" (`#/exercises`). Each row has a one-line description. Rejected: adding these as buttons in the page header, which would compete with "Start singing".
- Technical checks gain one row, `data-field="speakercheck"` "Speaker and microphone". It appears **only after she has opened Pitch match this visit** (an in-memory flag, nothing stored). Before that it is absent, not "Not run". **Reason (review):** a row that says "Not run" on every visit reads as a standing to-do for someone who may never use Pitch match. Values: "Not run yet", "Hears the speaker", "Does not hear the speaker", "Inconclusive" or "Devices changed, run again", and the action link "Run it" to `#/exercises/match`. No numbers on this row, because the delay lives in the check's Details (5.4). Not shown in M2.3a.

### 1.6 Dropped files on other routes (FINAL)

If a file is dropped on any route other than `#/file`, the browser opens it in the tab by default. That leaves the app and stops a running mic session. Every route calls `preventDefault()` on `dragover` and `drop` for files. Only `#/file` accepts the file. Other routes ignore it with no message.

---

## 2. New shared components

### 2.1 Take figure stack (`.take-figs`), used by Recording analysis and every exercise result

One panel, strip "Figures", then from top to bottom:

1. **Overview strip** (`.tf-overview`): the whole take's pitch marks at small height, with a viewport rectangle showing the visible span. Click or drag it to move the view. Hidden when the whole take is visible.
2. **View bar**: "Showing {t0} to {t1} of {duration}" (`aria-live="off"`, plain text). Buttons: "Earlier", "Later", "Zoom in", "Zoom out", "Whole take". All are `<button>` with text, `--control-h` tall.
3. **Cursor line** (`#fa-cursor-line`): one line of text directly above the plots: "At {t} s: {note}, {hz} Hz, {n} cents {flat|sharp}" or "At {t} s: no pitch". **Reason:** at 375 the full readings panel is below the plots, and she must see the value while she moves the cursor.
4. **Fig. 1 Pitch** (`#fa-fig-pitch`): whole-take F0 per frame on a log frequency axis. Gridlines at every semitone, labelled at each natural note (C4, D4, ...). The y range fits the voiced F0 of the take, padded to whole semitones. An octave slip therefore stretches the axis and stays visible.
5. **Fig. 2 Cents** (`#fa-fig-cents`): per frame, cents from the nearest equal-tempered note at the current A4. Fixed axis −50 to +50 with ticks at −50, 0 and +50. "Flat" label at the bottom edge, "Sharp" at the top.
6. **Fig. 3 Vibrato** (`#fa-fig-vib`): two thin rows sharing the time axis. Row "Speed" (per second) and row "Width" (± cents). One mark per window at the window's middle. A window with no vibrato is a hollow mark on a "None found" baseline, never a zero. Axis ranges fit the found values, with labelled ticks.
7. **Fig. 4 Spectrogram** (`#fa-fig-spec`): 0 to 4 kHz, whole-take F0 marks with the 1px halo, band guide lines, colours from tokens (DESIGN.md 2.10).
8. A **time axis** under the stack, labelled in m:ss.s, and one **cursor line** drawn through all figures.

**Order, and why.** Pitch first, because the first question about a recording is "what did I sing". Cents second, "how far from the note". Vibrato third. Spectrogram last: it is the check for octave slips, as on Voice analysis, where "How to read this" sends her to it. Rejected: F0 drawn only over the spectrogram (the reference Fig. 01). On a linear 0 to 4 kHz axis the singing range sits in the bottom strip and a semitone is a pixel or two.

**Drawing rules (FINAL).**
- Pitch marks are per frame, never joined by lines and never averaged (spec 4.2.7, F-27). When several frames fall in one pixel column, each frame's mark is drawn at its own y. A min to max bar is not used, because it paints values no frame has.
- Unvoiced frames draw nothing. Gaps stay gaps.
- Spectrogram: when there are fewer columns than frames, each column is the mean power of the frames it covers. The caption says so (spec 4.2.7, a design choice).
- Colours are re-read on `themechange` and the visible figures are redrawn. A post-take plot is static, so a full redraw is correct here. On the live spectrogram only new columns change (DESIGN.md 6.9).

**Captions.** Each figure has a plain caption on the primary view (`--t-caption`) and a technical caption in the closed disclosure "About these figures" under the stack (DESIGN.md principle 2). Dual text where colour words differ between themes (Loud: "Pink" for "Orange").

| Figure | Plain caption (primary view) | Technical caption (About these figures) |
|---|---|---|
| Pitch | "Each dot is one moment of your pitch." | "Each mark is one analysis frame, {hop_ms} ms. Marks are never joined or averaged, so an octave jump shows as marks an octave away." |
| Cents | "How far each moment is from the nearest note. Above the middle line is sharp, below is flat." | "Cents from the nearest equal-tempered note at A4 = {a4} Hz. The marks jump from +50 to −50 when the nearest note changes." |
| Vibrato | "How fast and how wide your vibrato is over time. Hollow dots: no vibrato found there." | "Each mark is one {VIB_WINDOW_S} s window, placed at its middle. Windows start every {VIB_STEP_S} s and overlap. Windows that cross a note change are not checked by the validation." |
| Spectrogram | "Brightness shows how strong each frequency is. Orange dots are your pitch." | "Zoomed out, each column is the average of the frames it covers." |

Spec 4.2.7 says the spectrogram averaging is "stated in the caption". Putting it in the technical caption is listed in D20 for the spec owner.

**Heights** (design choice, cheap to change): overview 40px. Pitch 200px (compact 160). Cents 120 (100). Vibrato 2 × 56 (2 × 48). Spectrogram 200 (160).

### 2.2 Time cursor (the text path through the plots)

The spec requires that clicking or focusing a time shows that frame's values as text (spec 4.1).

- One element, `#fa-cursor`, with `role="slider"` and `tabindex="0"`, covers the figure stack. It is one tab stop for all four figures. Its accessible name is "Time cursor". It also has `aria-valuemin="0"`, `aria-valuemax="{duration}"`, `aria-valuenow="{t}"` and `aria-valuetext`:
  - voiced: "{t} seconds. {note spoken, e.g. A sharp 4}, {hz} hertz, {n} cents {flat|sharp}."
  - unvoiced: "{t} seconds. No pitch."
  - The vibrato window is not in the valuetext, because it would make every arrow press long. It is in the readings panel.
- **Keys (FINAL):** Left and Right move one frame. Shift with Left or Right moves 1 s (design choice). PageUp and PageDown move one visible span. Home and End go to the first and last frame. If the cursor leaves the visible span, the view pans so the cursor is at its edge. Plus and Minus zoom around the cursor, as shortcuts that duplicate the buttons.
- **Pointer:** a click sets the cursor to the nearest frame. A drag of more than 4px selects a span (section 3.5). Wheel input does nothing, so the page scroll is never hijacked. Rejected: wheel zoom, which traps page scroll on a long page.
- Initial position: the first voiced frame, or 0 if none.

### 2.3 Progress block (`.progress`)

Text line (`role="status"`), an optional bar (`role="progressbar"`, `aria-valuenow`, `aria-valuetext` "Analysing, {p} percent"), and a Cancel button.
- Indeterminate (decoding has no progress events): no bar value. The `working` state bar from motion-testpage.md item 4 shows. It sweeps, because the mic is off on `#/file` (rule 3 allows a sweep when live is off). Under reduced motion it is the static bar.
- Determinate: the fill width is set from each progress message with **no transition**, so the bar never shows a value the worker did not send. It reaches 100% only in Done (F-18).
- Announcements: the start of each phase, each quarter, and the end (design choice). Not every message.

### 2.4 Exercise result block (`.ex-result`)

Used by Sustain on the mic, Sustain on a file span, Pitch match, and the cut exercises.
- The strip carries the title and "Measured after the take (whole take)" (E-29). It is always visible, never behind Details. If the take was resampled (Option B), the strip also carries "Resampled from {rate} Hz" (E-31).
- Rows are key-value rows (DESIGN.md 2.4), with values in `--t-display-3` so they read from 2 m.
- Details disclosure: technical values and the parameters from `m2_params`.
- It contains none of: "in tune", "out of tune", "good", "bad", "pass", "fail" (E-29). Neutral notices use the panel style, never `--state-error`.
- `data-state="done"` plays the one-shot done bar (motion-testpage.md item 4). The text is fully visible at t=0.

### 2.5 Phase cue (Pitch match and Sing an interval)

A word in `--t-hero` size: "Listen", then "Wait", then "Sing", then "Measuring". Under it, a three-segment timeline labelled Listen, Wait and Sing, with the current segment marked by fill and by a text label "Now". In the Sing segment, a remaining-time bar and the text "{n} s left".
- Phase boundaries come from the audio clock in context sample frames (spec 14). Listen runs from s_on to s_off. Wait runs from s_off to the start of the sing window: s_off + L_rt + `GUARD_S`, with L_rt measured by the speaker and microphone check (5.4), or s_off + `GUARD_S` when the check found that the mic does not hear the speaker. Sing lasts `SING_S`, or `SING_S` + `LATENCY_MARGIN_S` in the headphones case. The "{n} s left" countdown uses the real window length. Display timers do not drive any of this. `outputLatency` and `baseLatency` are never used (spec section 9 lock). The cue changes at once, with no fade, because a fade would delay "Sing".
- The remaining-time bar is drawn from the audio clock every animation frame, with no CSS transition. Under reduced motion, the bar is replaced by the "{n} s left" text, stepping once a second.

### 2.6 Target note picker

A native `<select>`. The first option is "Any note (nearest)". Then MIDI 48 to 84, each labelled "{note} ({hz} Hz)" at the current A4. Hz is recomputed when A4 changes. Spoken names come from the option text: "G4 (392.0 Hz)". The range matches the tone generator bounds (T-10). Her range is unknown (Q7), so the picker is not narrowed.

---

## 3. Recording analysis (`#/file`, M2.1)

### 3.1 Read order

1. h1 and the "Open an audio file" button. Before a file is open, nothing else matters.
2. After Done: the file strip (which file, how long, which method). She checks she opened the right take before reading any plot.
3. The cursor line and Fig. 1, then Fig. 2. Vibrato and the spectrogram are for study and checking.
4. Readings at cursor, then Measure a held note.

### 3.2 Layout

**1280.** Page header: breadcrumb, h1, lede "Open a recording from this computer. It is analysed in this browser and never uploaded." Header action: primary button "Open an audio file" (`#fa-open`, the label of a visually hidden `<input type="file" id="fa-input">`). After a file is open, the button becomes ghost style and reads "Open another file".
Below the header:
- **File strip** (12 columns, `<dl>` in one row that wraps): File (name), Duration, Sample rate, Channels, Method, and the A4 stepper (`#fa-a4`, same component as DESIGN.md 2.8).
- **Figures** (8 columns) and **Readings at cursor** (4 columns, sticky at the top of the viewport while the figures scroll).
- **Measure a held note** (8 columns) and **About this analysis** (4 columns).
- **Details** disclosure (12 columns).

**375.** Header (button full width), file strip as stacked key-value rows, Figures (the cursor line carries the values), Readings at cursor, Measure a held note, About this analysis, Details. Nothing scrolls sideways at 320. The figures resample to the width.

**File strip values.**
- File: the name as literal text (`textContent`, F-21), wrapping with `overflow-wrap: anywhere`. No truncation, because two takes often differ only at the end of the name.
- Duration: "{m:ss.ss}" of the decoded audio (spec 4.8).
- Sample rate: the analysis rate and how it was obtained (spec 4.1, 4.3). One value line plus one plain note line:

  | Case | Value | Note line |
  |---|---|---|
  | 44.1 or 48 kHz, read from the header | "{rate} Hz" | "From the file. Not resampled." |
  | M4A at 44.1 or 48 kHz where implicit SBR is possible | "{rate} Hz" | the neutral marker (below). The full text goes in "Notes on this file" |
  | Option B, other rate | "48000 Hz" | "Resampled from {rate} Hz to 48 kHz." |
  | Option B, unknown rate | "48000 Hz" | "Resampled to 48 kHz, file rate unknown." |

  The Option B rows also link "How resampling affects accuracy" to VALIDATION.md (dev server only). Its "unverified" line is in Notes on this file (below). Under Option A these rows never appear, because the file is refused (3.3). "Resampled" and "not confirmed" are words, never only a colour or an icon.
- Channels: "1" or "{n}, mixed to one by averaging".
- Method: "Whole take (YIN + continuity)" (F-28), verbatim in both themes.
- **Neutral marker (review).** When "Notes on this file" (in About this analysis) has at least one entry, the strip carries one line: "{n} notes about this file", a link to that list. It has no warning colour or icon. **Reason:** caveats about the file format sat on the strip next to the file name, where they read like an error before she has seen any plot. The Resampled line stays on the strip, because spec 4.1 and F-09 require the screen to show how the rate was obtained.

**Notes on this file** (a list inside About this analysis, shown only when it has entries):
- M4A that may use implicit SBR: "File rate not confirmed. This M4A file does not state its rate for certain." Spec 4.3 calls this "the label". Moving it off the strip is in D20.
- MP3 or M4A/AAC, while V-08 has no verified numbers in VALIDATION.md: "Accuracy on MP3 and AAC files is unverified." (spec section 8 and the 2.1 rule: unverified, never passed). Removing it is a code change made when V-08 lands.
- Option B, while V-07 has no verified numbers: "Accuracy after resampling is unverified."

**Readings at cursor** (plain labels, DESIGN.md principle 2):
- Time: "{t} s".
- Note: "{note}", or "No pitch at this time".
- Pitch: "{hz} Hz" (1 decimal), or "No pitch".
- Off by: "{n} cents {flat|sharp} of {note}", or "No pitch".
- Vibrato: "{r} per second, ±{e} cents", with the note "window {a} to {b} s". The window shown is the one whose middle is nearest the cursor. Empty: "No vibrato found in the window {a} to {b} s". Before the first full window: "No window covers this time".
- Details (collapsed): F0 (2 decimals), deviation "{±c.c} c from {note} ({target} Hz)", level "{rmsDb} dBFS". If built (**CUTTABLE**, spec 4.4): the band ratio for the take.

**About this analysis** (prose, `--ink-2`):
- Notes on this file (above), when present.
- "Times count from the start of the decoded audio. MP3 and M4A files can start slightly later than the original recording because of the encoder." (spec 4.8)
- "If the octave looks wrong, compare the pitch marks with the lowest strong band in the spectrogram." (DESIGN.md wording)
- Links to MEASUREMENT.md and VALIDATION.md, "(dev server only, opens raw text)".

**Details disclosure:** analysis window `DEFAULT_YIN.bufferSize` samples, hop `DEFAULT_HOP`, frame count, voiced frame count, voicing gate `DEFAULT_YIN.silenceDb`, vibrato window and step, display range `SPEC_TOP_HZ`. All imported, none typed. If built (**CUTTABLE**, spec 4.8): clipped samples "{n} samples at full scale".

### 3.3 States (all FINAL except where Q1 or Q2 decides)

Messages appear in the panel that holds the figures in Done, so the page does not jump between states. The file strip shows whatever is already known.

**Limits (spec 4.5).** `MAX_DURATION_S` and `MAX_FILE_BYTES` are set from the measurement spike, which is task 1 of M2.1, under the Q2 budgets. The values of revision 1 are dropped. This design never types a limit. Every limit in the copy below is formatted from the constant at runtime, so changing the constant after the spike changes no screen design. The UI cannot ship before the spike, because the spike comes first in M2.1. If a constant is still unset in a dev build, the limits line is left out rather than showing a placeholder number.

**Q1 DECIDED 2026-11-08: Option B.** Build the Option B rows only. The Option A rows below stay for the record and are not built. Under Option A the "Sample rate not supported" row applies to other and unknown rates. Under Option B that row does not exist: those files go through Decoding and Analysing as usual, and the file strip carries the Resampled line (3.2). The engineer builds only the chosen option (spec 4.3). Both are designed here, so the decision changes no layout.

| State | Trigger | Shows | Actions | Announced (`#fa-status`) |
|---|---|---|---|---|
| No file | first visit to the route | Drop zone panel: h2 "Open a recording". "Choose a WAV, MP3 or M4A file, or drop it here." "Up to {MAX_DURATION_S formatted} and {MAX_FILE_BYTES as MB} MB." "It stays on this computer." No figures, no file strip. | Open an audio file | none |
| No file, after leaving | entering with `fileCleared` set | As No file, plus a line above the drop zone: "The last recording was cleared when you left this page. Nothing is saved." Shown once, then the flag clears. | Open an audio file | none |
| Drag over | a drag that carries files enters the route section | An overlay on the content area (not on the header): dashed `--ink` border at `--border-w` × 2, text "Drop the file to analyse it". Existing content stays under it at reduced opacity. | drop | none (drag is pointer-only, and the button is the keyboard path) |
| Several files dropped | `files.length > 1` | The previous state stays. Notice: "Drop one file at a time. Nothing was opened." | none | the notice |
| Too large | `file.size > MAX_FILE_BYTES`, before decoding (F-12) | Error: "This file is {size} MB. The limit is {MAX_FILE_BYTES} MB." | Open another file | the error |
| File type not supported | not WAV, MP3 or M4A/AAC (spec 4.1 state list). Trigger boundary: D17 | "This file type is not supported. Open a WAV, MP3 or M4A file." | Open another file | the message |
| Sample rate not supported (Option A only) | header rate not 44.1 or 48 kHz, or rate unknown, before decoding (F-09, F-10) | The spec copy, split into its two cases: "This file's sample rate ({rate} Hz) is not supported yet. Export it at 44.1 or 48 kHz." With an unknown rate: "This file's sample rate is unknown, so it is not supported yet. Export it at 44.1 or 48 kHz." Then one plain how-to line for a phone voice memo (review). Where to find the rate or export setting differs by phone and recording app, so the exact steps are **OPEN (D21)**. Until they are known, the line is: "If this came from a phone, look for a quality or format setting in the recording app, or ask Joseph to convert it." Nothing is decoded, no figures. | Open another file | the message |
| Decoding | file accepted | File strip: name only. Progress block, indeterminate: "Decoding {name}…" | Cancel | "Decoding" |
| Analysing | decode done, worker running | File strip: name, duration, rate with its note line (including Resampled under Option B), channels, method. Progress: "Analysing, {p}%". Beside the bar, in the progress block (review): "The plots appear when the whole recording is analysed. Each pitch is chosen with the whole take in view, so there is nothing to show part way." | Cancel | phase start, quarters. Under Option B the first announcement includes "Resampled from {rate} Hz to 48 kHz" |
| Done | worker finished, at least one voiced frame | Everything in 3.2. Cursor at the first voiced frame. Focus does not move. | all | "Done. {duration} analysed." |
| Done, no pitch found | finished, zero voiced frames (F-15) | File strip. Spectrogram drawn. The other figures show the overlay "No pitch found in this recording". Readings: "No pitch at this time" everywhere. No note name or cents anywhere. Measure a held note is replaced by one line: "There is no pitch to measure." Reasons line: "Common causes: silence, singing below the voicing gate ({silenceDb} dBFS), or stereo channels that cancel when mixed." | Open another file | "Done. No pitch found." |
| Cancelled | Cancel pressed | "Analysis cancelled. Nothing was kept." No figures. | Open an audio file | the message |
| Could not decode | decode or WAV parse fails, including DRM (F-11, spec 4.8) | "This file could not be read as audio. It may be damaged or protected." Details: the raw error text. | Open another file | the message |
| Too long | duration > `MAX_DURATION_S` (F-13). Checked from the header where it states a duration, otherwise after decoding | "This recording is {duration}. The limit is {MAX_DURATION_S formatted}. Trim it and open it again." No figures, no partial results. | Open another file | the message |
| Too short | fewer than `DEFAULT_YIN.bufferSize` samples (F-14) | "This recording is too short to analyse. It needs at least {bufferSize} samples, about {ms} ms at {rate} Hz." | Open another file | the message |
| Out of memory | decode or analysis throws a memory error | Spec copy: "This file is too large for this browser to analyse." (spec 4.8) | Open another file | the message |
| Analysis failed | worker error (reachable, not in the spec list) | "The analysis stopped with an error." Details: the raw text. "If this keeps happening, tell Joseph and include the text under Details." (REVIEW-CARD follow-up 4) | Open another file | the message |

- **Permission denied:** not applicable. No permission is involved. Cancelling the file picker leaves the current state unchanged, with no message.
- **New file while busy or Done (F-16):** the new file replaces the old one at once. Old results are removed from the screen before decoding starts, and late messages from the old worker are dropped by a job number. There is no confirmation, because nothing is saved and reopening a file costs one click.
- **A4 change in Done (F-22, F-23):** cents, note names, the pitch grid labels, the cursor line and the readings update in the next frame, with no re-analysis and no progress block. Announced: "Reference A4 = {a4} Hz. Cents and note names updated."
- **Theme change in Done:** figures redraw with the new tokens.

### 3.4 Zoom defaults (D5)

The visible span starts as the whole take if the duration is at most `FILE_VIEW_DEFAULT_S`. Otherwise it is the first `FILE_VIEW_DEFAULT_S` from the first voiced frame. `FILE_VIEW_DEFAULT_S` is a display constant, value OPEN (D5). Zoom steps halve or double the span. The limits are one `VIB_WINDOW_S` at the narrowest and the whole take at the widest. **Reason:** at the whole-take width, a long file puts a large fraction of a second in each pixel and vibrato disappears. Rejected: always opening at the whole take, which hides the very thing she came to look at.

### 3.5 Measure a held note (E1 on a file or a span)

The spec allows E1 input from "an uploaded file or a selected span of one" (6.1). It lives on this screen because the file is already open and analysed. Rejected: a file input on the Sustain screen, which would make her open and analyse the same file twice.

- Panel strip: "Measure a held note". Prose: "Measures one held note: how long it lasted, where its middle sits, drift and vibrato. Uses the longest held note inside the span."
- Span controls: "From" and "To" number inputs in seconds (`#fa-span-from`, `#fa-span-to`, 2 decimals, 0 to the duration). Buttons "Start at cursor", "End at cursor" and "Whole take". A pointer drag on the figures sets both. The span is shaded on every figure, its edges are drawn as lines, and the "From" and "To" values are text, so colour is never the only carrier. Invalid input (From ≥ To, or out of range): an error line "Enter a span inside 0 to {duration} s, with From before To". The last valid span stays.
- Target note picker (2.6).
- Button "Measure held note" (`#fa-sus-run`). The result is an `.ex-result` (section 5.2 rows) under the controls. The hold segment and the trims are marked on the figures as a bracket labelled "Measured" with its times. That bracket is how she checks which note was used.
- Whether the span is re-analysed as its own take or the whole-file frames inside it are used is **OPEN (D3)**, a spec question. The answer changes the states. Re-analysis adds an "Analysing the span" progress state. Slicing is instant. E-11a (same numbers as the Node scoring module on the same samples) is easiest to meet if the span's samples are re-analysed as a take, which argues for re-analysis, but the spec does not say so.
- Panel states: Ready (controls, no result), Measuring (progress block, only with re-analysis), Result, "No sustained note found" (same copy as 5.2, built from `m2_params`), Analysis failed (as 3.3). It is not shown in "Done, no pitch found".
- **M2.3a (spec section 3):** this panel is the whole of M2.3a. It ships with M2.1 if Phase B slips, using the 5.2 result rows and `.ex-result` with no mic code. The result strip carries "Measured after the take (whole take)" in M2.3a too. E-11b (the mic path gives the same numbers) waits for the full M2.3.
- Changing the span, the target or A4 after a result: the result stays, with a line "Span, target or A4 changed. Press Measure held note to update." It does not recompute on its own, so a number on screen always matches a run she started.
- **Range sweep on a file (CUTTABLE, E3):** if built, a second button "Find lowest and highest held notes" with the E3 result (section 5.6).

---

## 4. Interval recognition (`#/aural`, M2.2, Tool 02)

### 4.1 Read order and layout

Read first: the question panel's status phrase and its one button. Then the answer buttons. The count is secondary, and is not styled as a score.

**1280.** Page header (breadcrumb "Tools / Aural skills", h1 "Interval recognition", lede "Listen to two notes and name the interval. Uses your speakers or headphones. Does not use the microphone."). **Question** panel in 7 columns, and **Settings** plus **How it works** in 5.
**375.** Question, then Settings, then How it works. The answer grid is 3 columns at compact and 4 at wide. Buttons are at least `--control-h` tall at compact (44px).

**Question panel.**
- Strip: "Question" on the left. On the right, the count `#ar-count`: "Matched {correct} of {answered} this visit". Before any answer: "No answers yet", not "0 of 0" (principle 1).
- Status line `#ar-state` in `--t-display-2`: the state phrase from 4.2.
- Playing indicator: two note blocks, "1" and "2". Harmonic mode has one block, "Both". A block is filled while its tone sounds, with start and end taken from the audio clock. `aria-hidden`, because the sound is the content.
- Main button `#ar-play` (primary): "Play a question", then "Playing…", then "Play again".
- Answer grid `#ar-answers` (`role="group"`, `aria-labelledby` the status line): one `<button>` per enabled interval, in size order. Labels: "Minor 2nd", "Major 2nd", "Minor 3rd", "Major 3rd", "Perfect 4th", "Tritone", "Perfect 5th", "Minor 6th", "Major 6th", "Minor 7th", "Major 7th", "Octave". The short form (m2, M2, ..., P8) is a second line in `--t-label`, `aria-hidden`. Intervals not in the set are not shown. **Reason:** an answer that is never asked can only be a miss. Rejected: disabled placeholders for stable positions.
- Feedback `#ar-feedback` (Answered state only):
  - match: "Match. The interval was a {name}."
  - no match: "The interval was a {name}. You chose a {name}."
  - On the buttons, the played interval gets a text tag "Played" and her choice gets "Your answer" (both tags if they are the same button). Colour is never the only signal.
  - **CUTTABLE (D6):** "Notes: {lower} then {upper}" (or "together"). This is information from the generator, not a measurement.
- "Next question" `#ar-next` (primary, Answered only). It plays the next question inside the click.

**Settings panel** (a disclosure, closed). Every change applies from the next question (T-14) and does not reset the count.
- Intervals: 12 checkboxes in a fieldset, "Intervals to ask". At least one: error line "Choose at least one interval". The last valid set stays.
- Direction: radio group, "Rising", "Falling", "Together". The spec lists three directions and the generator draws only k and the lower note, so I read direction as a single choice. Whether it should be a mix is **OPEN (D8)**.
- Lower note: two selects, "From" and "To", MIDI 48 to 84, validated so that both notes stay inside 48 to 84 (T-10). Error line: "Choose a range where the upper note stays at or below C6", with the bound computed from the largest enabled interval.
- Tone timbre: shown only if Q6 makes it her choice.
- A4 stepper `#ar-a4` (shared value).
- Read-only text: "Each note lasts {TONE_LEN} s, with {GAP} s between." Whether these are editable is **OPEN (D9)**.
- Defaults come from the spec's design-choice values. Final values are Q7.

**How it works:** "Set the volume low before the first question. The notes are equal-tempered at A4 = {a4} Hz. The count is for this visit only and is not saved."

### 4.2 States

| State | Status line | `#ar-play` | Answers | Notes |
|---|---|---|---|---|
| Ready | "Press Play a question." | "Play a question" | hidden | the first tone starts inside the click (spec 5.1) |
| Playing | "Listen." | "Playing…", `aria-disabled` | shown, `aria-disabled` | focus stays on `#ar-play`. Nothing is announced while tones play, so speech does not cover the notes |
| Waiting for answer | "Which interval?" | "Play again" | enabled | announced once, after the last tone ends |
| Replaying | "Listen." | "Playing…" | `aria-disabled` | the same frequencies, the count unchanged (T-11) |
| Answered | feedback text | "Play again" (same question, count unchanged) | `aria-disabled`, with tags | focus moves to `#ar-next`. Feedback announced |
| Audio error | "Sound could not start in this browser." | "Try again" | hidden | text: "Check that speakers or headphones are connected, then press Try again." Details: the raw error. No question counted (T-16) |

- Answer buttons are enabled only after playback ends. **Reason:** an answer before both notes have sounded is a guess and still enters the count. This is cheap to reverse if she finds it slow.
- `aria-disabled` rather than `disabled`, so focus is never dropped from a button that becomes inactive.
- Hidden tab: playback continues and nothing advances on its own (spec 5.5).
- Loading: none. The tone render is synchronous and short. If it is not (engineer finds it slow), Playing covers it.
- Permission denied: not applicable (no mic, T-15). The mic indicator stays off.

### 4.3 Keyboard path

Tab order: h1, `#ar-play`, the answer buttons in size order, `#ar-next` (when shown), Settings summary, then the settings controls. Enter or Space activates the focused button. There are no single-key shortcuts in M2 (D12). Single-key shortcuts need an off switch (WCAG 2.1.4), and Tab plus Enter already works. Space has no global meaning on this route, unlike `#/voice`.

---

## 5. Sung exercises (M2.3)

### 5.0 Exercises index (`#/exercises`), CUTTABLE

Page header (h1 "Sung exercises", lede "Sing a short task, then see measures taken from the whole take after you stop. Nothing is saved."). A row list: Sustain a note (link), Pitch match (link, with a status line from the `speakercheck` field: "Needs the speaker and microphone check first" or "Speaker and microphone checked this visit"). Range sweep and Sing an interval appear as links if built, otherwise as "Not built yet" rows. No headphones note here. It appears once, in Pitch match Ready (review).
If cut, the Tools row 06 becomes two rows, 06 Sustain a note and 07 Pitch match, linking directly. The breadcrumbs drop the middle segment.

### 5.1 Shared exercise screen structure (FINAL)

**One slot.** Each exercise has one main panel, **Take** (`#ex-*-slot`), whose body is always the current step: Ready instructions, then the live hero (Sustain) or the phase cue (Pitch match), then Measuring, then the Result. The start button sits at the bottom of the slot in every step.
**Reason:** she is 1 to 2 m away. The place she looks at never changes, and whatever is in it is the current step, at every width. Rejected: hero and result side by side, which at 375 pushes the result below the fold while she is across the room.

**No-scroll budget (FINAL):** at 1280 × 800 and 375 × 667, the slot from its strip to the bottom of its start button is in the first viewport in every step, the same rule as VA-46 and VA-47. In Result, the result rows and the button fit. The take figures below the slot may scroll.

Below the slot:
- **This take** (`.take-figs`, section 2.1): Fig. 1 and Fig. 2 only, plus the spectrogram in a closed disclosure "Spectrogram". The hold segment is shaded and bracketed "Measured {a} to {b} s". Trimmed edges get a lighter shade labelled "Trimmed". **CUTTABLE**: if cut, the result Details carries "Measured from {a} to {b} s of the take" as text.
- **Setup** disclosure: input device, sample rate (with "Resampled from {rate} Hz" under Option B), the speaker check summary and "Run the check again" (Pitch match only), A4 stepper, Space bar switch (shared `centstodollars.space`), and a "Turn microphone off" ghost button.
- **How to read this:** "Measures come from the whole take after you stop, using the more careful method. The live note during the take uses the fast live method and can differ, sometimes by an octave. If the octave looks wrong, compare with the spectrogram." Links to MEASUREMENT.md sections 13 and 14.

**Microphone lifetime (D11).** The mic starts on the first Start in the route (inside the click, through `live.start({ owner: 'exercise' })`) and stays open between takes until she leaves or presses "Turn microphone off". Samples are kept only between Start and the end of the take. **Reason:** no permission or start-up delay before each trial, and the same latency across trials. The header mic indicator shows the whole time.

**Space bar (FINAL):** on `ex-sustain` and `ex-match`, the same rule as DESIGN.md 3.3: no modifiers, not repeat, and not inside a control. Sustain: start or stop the take. Pitch match: start a trial in Ready or Result, cancel it while running. The line "Space bar also starts and stops" sits under the button, hidden when the switch is off.

**Mic states:** DESIGN.md 3.0 applies in the slot, with the same chip names and copy. The Idle message is replaced by the exercise's Ready text.

**Input sample rate (spec 6.2 step 3, E-31; Q1 decides which).** The rate is known once the mic context runs, so this state appears right after Requesting, on the first Start.
- 44.1 or 48 kHz: nothing shown in the slot. Setup shows the rate.
- **Option A:** a slot state "Rate not supported", chip "Not available". Spec copy: "Your audio input runs at {rate} Hz. Exercises need 44.1 or 48 kHz." Plus the next action in plain words: "Change the input's sample rate in your computer's sound settings, then press Try again." The mic is stopped. Button "Try again". No take starts.
- **Option B:** no extra state. The exercise context runs at 48 kHz. The result strip carries "Resampled from {rate} Hz" (2.4), and Setup shows "48000 Hz, resampled from {rate} Hz".

**Take length.** A mic take stops on its own at `MAX_DURATION_S`, the file limit from the spike, because the capture is analysed by the same pipeline. The spike measures files, not mic capture, so whether the same limit fits a mic take is **OPEN (D18)**.

### 5.2 Sustain a note (`#/exercises/sustain`, E1)

**Read order.** Taking: note, cue, cents (M1 hero order), then elapsed time. Result: the rows in spec order, all at equal weight. The spec does not say which measure matters most to her (Q13). **OPEN (D10):** if she answers Q13, one row may become the large one.

**Slot by step.**

| Step | Content | Button `#ex-sus-toggle` | Announced |
|---|---|---|---|
| Ready | "Choose a note or leave Any note, press Start take, then sing one note and hold it. Press Stop take when you finish." Target picker (2.6) `#ex-sus-target`. | "Start take" | none |
| Requesting, Denied, No device, Busy, Insecure, Analyser failed, Ended | DESIGN.md 3.0 rows | as 3.0 | as 3.0 |
| Taking | Compact M1 hero: chip "Recording take", note, FLAT/SHARP cue, cents chip, meter (nearest note, plain YIN, unchanged M1 behaviour). Above it: "Target: {note}" or "Target: any note". Elapsed "Take {m:ss}". Gate hint slot. Level bar. | "Stop take" | "Take started" |
| Take limit | The take reaches `MAX_DURATION_S` (D18) | stops on its own and goes to Measuring. Line: "The take stopped at the {MAX_DURATION_S formatted} limit." | the line |
| Stopping | | "Stopping…", disabled | none |
| Measuring | Progress block, "Measuring the take…" (bar if it runs longer than a quarter second, design choice) | "Start take", disabled until done | "Measuring" |
| Result | `.ex-result`, rows below | "Start take" (a new take replaces this result) | "Result ready" plus the first row |
| No sustained note found | Heading "No sustained note found" (the spec's state name, kept for E-08). Under it, what happened, in the app's voice (review): "The app did not hear one steady note long enough to measure. Hold one note for at least {MIN_HOLD_S + ONSET_TRIM_S + RELEASE_TRIM_S} s." No numbers other than that one, which is a requirement, not a measurement. | "Start take" | the message |
| Stopped by leaving | entering after a leave mid-take: "Your last take was stopped when you left the page." | "Start take" | none |
| Analysis failed | "The measurement stopped with an error." Details. "Tell Joseph and include the text under Details." | "Start take" | the message |

**Result rows** (plain labels. Technical names from the spec are in brackets for the engineer, not on screen). Each row has a one-line plain gloss under the value, in `--t-body-s` (review). The gloss says what the number means, never whether it is good, and states no tolerance (Q9 stays open):
- Held for (hold duration): "{s} s" (2 decimals). Gloss: "How long the note lasted, from when it started to when it stopped."
- Middle of the note (centre offset): cue word plus value, "{n} cents flat of G4", "{n} cents sharp of G4" or "0 cents from G4". The note is the target, or the nearest note when Any note. With Any note, the row note says "Nearest note to your median" (E-10). Gloss: "Where the middle of the held note sits, compared with {note}."
- Nearest note (only if |centre offset| > 50 c): "Nearest note: {note}". Gloss: "The note your held pitch was closest to."
- Drift: "Rising {x} cents per second" or "Falling {x} cents per second" (1 decimal), "0.0 cents per second" at zero. "Rising" and "falling" describe direction like FLAT and SHARP. Gloss: "How much the pitch crept up or down while you held the note."
- Vibrato speed: "{r} per second". Gloss: "How many times a second the pitch goes up and down." Vibrato width: "±{e} cents". Gloss: "How far the pitch goes above and below its middle." Empty: "No vibrato found in the held note".
- Details: target "{note}, {hz} Hz", median F0 "{hz} Hz" (2 decimals), measured span "{a} to {b} s", frames used "{n}", trims and minimum hold from `m2_params`, method "Whole take (YIN + continuity)", A4.

**A4 or target change after a result:** same rule as 3.5. The result stays, with "A4 or target changed. Start a new take to measure with it." No silent recompute.

### 5.3 Pitch match (`#/exercises/match`, E2)

**Read order.** In a trial: the phase word, nothing else. In Result: match offset (cue word and cents), then octave, then the reference note. The offset row comes first here because Pitch match has only one primary measure in the spec (14). The leak notice, when present, sits above the rows, because it changes how she should read them.

**No live pitch during a trial (D2, recommendation).** During Listen, Wait and Sing the slot shows the phase cue and the level bar only. No note, no cents. The reference note name stays hidden until the result. **Reason:** this exercise trains matching by ear. A live note on screen turns it into matching by eye, and the reference name lets absolute pitch stand in for listening. The spec says the live readout is plain YIN "as everywhere live" (6.2.1). It does not say a readout must show here. This needs the owner.

**Slot by step.**

| Step | Content | Button `#ex-match-run` | Announced |
|---|---|---|---|
| Check needed | The speaker and microphone check has not run this visit, or was invalidated. The check's steps (5.4) take the slot. | "Run the check", with "Start trial" disabled under it | as 5.4 |
| Ready | "Press Start trial. You will hear a note for {TONE_S} s. When Sing appears, sing the same note and hold it." Then the one headphones line on any M2 screen (review: say it once, here): "Headphones work best. With speakers, the microphone also hears the note." Reference choice (D4). Above the button, the check line: "Speaker check done this visit. Run again". No numbers; they are in the check's Details. | "Start trial" | none |
| Mic states, input rate | DESIGN.md 3.0 and 5.1 | as 3.0 | as 3.0 |
| Devices changed mid-trial | On `devicechange` during Listen, Wait or Sing, the trial is cancelled, because its timing used the old devices' delay. "Your audio devices changed. Run the speaker and microphone check again." The slot returns to Check needed. | "Run the check" | the message |
| Listen | phase cue "Listen", the timeline at segment 1 | "Cancel trial" | none (the tone is the cue) |
| Wait | "Wait", segment 2. One short line under the word (review): "A short pause so the note can fade and the microphone hears only you." | "Cancel trial" | none |
| Sing | "Sing", segment 3, "{n} s left" | "Cancel trial" | "Sing" (one word, see D13) |
| Measuring | Progress block "Measuring…" | disabled | "Measuring" |
| Result | `.ex-result` | "Next trial" | "Result ready" plus the offset row |
| No sustained note found | Heading "No sustained note found" (spec wording, E-22). Under it, what happened, in the app's voice (review): "The app did not hear a steady note between Sing and the end. Start when Sing appears and hold one note for at least {MIN_HOLD_S_match + trims} s." The app's copy never says "I", so the reviewer's "I didn't hear" becomes "The app did not hear". No numbers besides the requirement (E-22). | "Next trial" | the message |
| Cancelled | "Trial cancelled. Nothing was measured." (Cancel or Space) | "Start trial" | the message |
| Stopped by leaving | "Your last trial was stopped when you left the page." | "Start trial" | none |
| Audio error | as 4.2 Audio error | "Try again" | the message |

**Result rows.**
- Leak notice (when the flag is set, spec 14). Neutral panel style, no error colour, no icon that reads as a warning. The rows still show. No headphones advice here, because Ready already has it (review).
  - Flag with the sub-flag (the sound matched the reference): "The microphone heard the speaker while the reference played. This is not about your singing."
  - Flag without the sub-flag: "The microphone picked up sound while the reference played. If you started singing before Sing appeared, that can cause this." The reviewer's "This is not about your singing" is not used here. Without the sub-flag the sound may be her own early singing (E-18), so the sentence could be false.
  - Spec 6.3 gives fixed wording for both notices, including "Headphones avoid this". The changed wording is listed in D20 for the spec owner.
- Match offset: "{n} cents flat of the reference" or "{n} cents sharp of the reference" or "0 cents from the reference". A real minus sign is not used here, because the cue word carries the sign.
- Octave: "Same octave", "An octave below", "An octave above", "{k} octaves below" or "{k} octaves above". It is a separate row and never merged into the offset. Whether an octave-displaced match is presented as equivalent is **Q10**, carried, and this design does not decide it.
- Reference: "{note} ({hz} Hz)".
- Details: interval to reference "{c} c" (signed, real minus), median sung F0, sing window "{a} to {b} s after the tone started", delay used "{ms} ms, measured by the speaker check" (with "the longest of the check's delays, because they varied" when the spread warning applied) or "Not measured (the microphone does not hear the speaker). Singing time extended by {LATENCY_MARGIN_S} s.", the guard and the window from `m2_params`, method.

**Reference note choice (D4).** The spec defines the tone but not how the reference note is chosen. Placeholder design: a select "Reference note" with "Random from {range}" (the default, using the interval lower-note range from Q7) and the notes MIDI 48 to 84. Needs the owner.

**Not doing:** "Play the reference again" after a result. It is not in the spec and would play a tone with the mic open between trials. Listed as a question in D4.

### 5.4 Speaker and microphone check (spec 6.4, the gate for Pitch match)

**Problem.** Pitch match times the singing window from the real delay between the speaker and the mic on her setup (L_rt). Browsers do not report that delay reliably, so the app measures it. The check also says whether the mic hears the speaker. That is the leak risk.

**Where it lives (decision; D14 asks whether it also goes in Methods).** It runs in the Pitch match slot, as the step before Ready. **Reason:** it must run every visit and after every device change (unless Q15 allows remembering it). Sending her to Methods and back each time is a detour on the way to the exercise she came for. The slot is also where she looks. Rejected: a Methods-only block, which suits a one-time setup check but not one that runs every visit. Overview Technical checks shows its status (1.5).

**The gate (E-27, FINAL).** Until the check has a usable result this visit with the current devices, the slot shows the check. Under the check's button, "Start trial" is present but `disabled`, with the reason next to it: "Run the speaker and microphone check first" (spec copy). Space does nothing in this step. She may be at the desk setting the volume, and a stray Space should not start test tones.

**Opening line (review), first in every step:** "So the app knows when to listen for you." The strip title stays "Speaker and microphone check".

**Primary view and Details (review, DESIGN.md principle 2).** The primary view carries the opening line, one plain verdict sentence, and the buttons. Every number (delay in ms and in samples, the delay per note, spread, notes heard, speaker level at the microphone in dBFS, the method note "Measured from {n} short notes at {rate} Hz", and the CUTTABLE pitch offset) is in a closed "Details" disclosure under the verdict. Rejected: rows of ms and dBFS on the primary view. They answer Joseph's question, not hers, and the verdict sentence is what decides whether she can start.

**Steps** (in the slot, same no-scroll budget as 5.1):

| Step | Primary view | Buttons | Announced |
|---|---|---|---|
| Not run this visit | Opening line. "The app plays {CHECK_BURSTS} short notes and listens for them. Use the speakers or headphones you will sing with, at the volume you will use, and stay quiet for about {total check time, computed} s." | "Run the check" (primary). "Start trial" disabled with the reason | none |
| Mic states, input rate | DESIGN.md 3.0 and 5.1 (Option A refusal applies here too) | as 3.0 | as 3.0 |
| Running | "Note {i} of {CHECK_BURSTS}. Stay quiet." Static working bar (mic is on, so no sweep, motion-testpage.md rule 3). | "Cancel check" | "Check started" only. Nothing per note, because screen reader speech through speakers would be captured and could be detected as a note onset |
| Hears the speaker | Spec verdict words: "The microphone hears the speaker." Plain line: "Pitch match will wait for the delay before it listens." Details as above. No headphones advice here (Ready has it). | "Start trial" enabled. "Run the check again" (ghost) | "Check done. The microphone hears the speaker." |
| Hears the speaker, spread warning | As above, plus a neutral plain line: "The delay changed from note to note, so Pitch match will allow for the longest one." The spread and longest delay in ms are in Details (spec 6.4). | as above | as above, plus the line |
| Does not hear the speaker | Spec verdict words: "The microphone does not hear the speaker." Plain line: "That is normal with headphones. Pitch match will listen right after the note, for a little longer." The length (`LATENCY_MARGIN_S`) is in Details. | "Start trial" enabled. "Run the check again" | "Check done. The microphone does not hear the speaker." |
| Inconclusive | Spec verdict words: "Inconclusive, run again." Plain line: "Not enough of the notes were heard. Turn the volume up a little and keep the room quiet." Notes heard is in Details. | "Run the check again" (primary). "Start trial" stays disabled (D16) | the verdict |
| Cancelled | "Check cancelled. Nothing was measured." (Cancel) | "Run the check" | the message |
| Stopped by leaving | "The speaker check was stopped when you left the page." (E-28) | "Run the check" | none |
| Audio error | as 4.2 Audio error | "Try again" | the message |
| Devices changed | On `devicechange`, or a change of the selected device: "Your audio devices changed. Run the check again." The previous result is removed from the screen. Gate closed. | "Run the check" | the message |

- **The result is about devices, not about her.** The verdicts are the spec's words, with no "good", "bad", "pass" or "fail". Hearing the speaker is not an error. The trial still runs, and the leak flag (5.3) reports per trial.
- **Stale result line,** always under a result: "This check applies to the speakers and microphone in use when it ran." (spec 6.7: some browsers fire no `devicechange`.)
- **CUTTABLE extra (spec 6.4):** a Details row "Pitch of the notes as heard: {c} cents from what was played", with no threshold, and the note "Measured like Calibration in Methods".
- **Mic ownership:** the check runs as owner `speakercheck`, and trials run as `exercise`. On this route the handover must not prompt for permission again or stop the mic between the check and the first trial. That is a requirement on the DESIGN.md section 6 update.
- **Q15, carried (OPEN).** Until Q15 is answered, nothing is stored (E-30). The check runs on every visit and the steps above are complete. If Q15 allows remembering: only the delay, spread, verdict and date are stored (no audio), and Ready shows "Speaker check from an earlier visit, {date}. Run again". Whether the devices are the same as on that visit cannot be confirmed without comparing device IDs, which needs mic permission first. That sub-question goes with Q15.
- **Overlap with M1 Loopback latency (D15).** Methods already has a loopback latency check with a different procedure and different numbers. Two latency numbers on two screens are likely to confuse her.

### 5.5 Uncertainty and correction (both exercises)

- **No answer:** "No sustained note found" with the one requirement that was not met. No partial numbers.
- **Wrong answer:** an octave slip in the whole-take result can move the median an octave (spec 6.7). The result then shows a large offset with "Nearest note", or an unexpected octave row. The take figures show which frames were used, and How to read this sends her to the spectrogram.
- **Leakage:** the leak notice says so in neutral words. A sung note that copies the reference inside the sing window cannot be told apart from leakage (spec 14). The screen does not claim it can. Headphones are recommended once, in Pitch match Ready (review).
- **Correction:** results cannot be edited, because they are measurements. She can choose a target (Sustain), choose a span on a file (3.5), take again, or use headphones.

### 5.6 Range sweep (`#/exercises/range`, CUTTABLE, E3)

The same slot structure. Ready: "Press Start take, then slide or step from your lowest comfortable note to your highest. Press Stop take when you finish." Result rows: "Lowest held note: {note} at {t} s", "Highest held note: {note} at {t} s". Each time is a button that moves the take figures' cursor there. A fixed line, always shown: "Check the lowest note by ear. The method can read a note an octave too low." (spec 17). Also offered on a file (3.5).

### 5.7 Sing an interval (`#/exercises/interval`, CUTTABLE, E4)

Pitch match with the same check gate (5.4, one check result shared by both routes this visit) and one added Ready line: "Sing a {interval name} {above|below} the note you hear." Results are measured against the target. The rows say "of the target" instead of "of the reference". The interval is chosen per trial. How is not defined in the spec (D4 covers it).

---

## 6. Accessibility (FINAL baseline, DESIGN.md section 5 applies to every new route)

- One h1 per route, focused on route change. `document.title` per 1.1. Skip link unchanged.
- **Focus never moves on its own when a result arrives** on the singing screens, because she may be across the room and a moved focus scrolls the page. The result is announced instead. The exceptions are within a user action: after an interval answer, focus goes to `#ar-next`. After "Next question", focus returns to `#ar-play`.
- **Focus order, Recording analysis:** h1, `#fa-open`, A4 controls, view bar buttons, `#fa-cursor`, Readings Details summary, span inputs and buttons, target, `#fa-sus-run`, result Details, About links, Details summary.
- **Focus order, Sustain and Pitch match:** h1, the slot's controls (target or reference select, then the main button), result Details summary, This take (view bar, cursor), Setup summary, How to read links.
- **Focus order, the speaker check step in Pitch match:** h1, "Run the check" (or "Cancel check" while running), the disabled "Start trial" with its reason (reached through `aria-describedby` on the slot, because a disabled button is not focusable), the check result Details summary, "Run the check again". When the check completes, focus stays where it was and the verdict is announced.
- **Screen reader labels.**
  - Each figure canvas: `role="img"` with a label naming the figure, the visible span, and where the text is: "Pitch over time, {t0} to {t1}. Values are in the time cursor and Readings at cursor."
  - `#fa-cursor`: section 2.2.
  - Progress: section 2.3.
  - Interval answers: the button text is the full name. The tags "Played" and "Your answer" are part of the button's text, so they are in its accessible name.
  - The phase timeline is `aria-hidden`. The phase is announced (5.3) and is in the button state.
  - The live hero in Sustain keeps `#readout-announce` throttling (DESIGN.md 2.9), with ids prefixed `ex-sus-`.
- **Announcements during audio.** No announcements while a reference tone or a check note plays, and none per note during the speaker check (speech could be detected as a note onset). During a take or sing window only the single words in the tables. With speakers, screen reader speech can reach the mic and be measured (D13). The only on-screen headphones advice is the Pitch match Ready line.
- **Colour never alone:** span shading has edge lines and text values. Hold brackets have labels. Hollow vibrato marks sit on a labelled baseline. Answer tags are words. Phase segments carry "Now".
- **Forced colours:** canvases do not follow system colours by themselves. In `forced-colors: active`, the figure renderer uses `CanvasText` for marks and `Canvas` for the surface. This is a new requirement for the M2 figures. The M1 spectrogram should match it.
- **Targets:** every control at least `--control-h`. Answer buttons are 44px tall at compact.
- **Reflow:** 320px with no horizontal scroll on every new route. Text at 200% wraps the file strip and the answer grid, and never clips the figures' axis labels (HTML labels, not canvas text).

---

## 7. Motion (polished, and nothing distorts a reading)

Uses only the existing tokens (`--dur-fast`, `--dur-base`, `--dur-enter`, `--dur-done`, `--dur-sweep`, `--ease-*`, `--move-enter`). No new durations. Reduced motion follows whatever DESIGN.md **OPEN 1** settles. Note: `tokens.css` today still clamps to 100 to 120ms fades under reduced motion, which OPEN 1 asks about. Everything below gives a reduced-motion version, and none of them needs a fade to be understood.

| Element | Motion | Reduced motion |
|---|---|---|
| Route entrance | existing staggered entrance, excluding canvases and the slot's live content | as DESIGN.md |
| File states (drop zone, progress, done panel) | the panel body crossfades at `--dur-base`. Canvases appear instantly when drawn | instant |
| Drag-over overlay | opacity in `--dur-fast` | instant |
| Indeterminate decode | `working` sweep (mic is off on this route) | static bar |
| Progress fill | none, value set per message | same |
| Result reveal (`.ex-result`, Sustain on a file) | one-shot done bar. Text visible at t=0 | opacity only, or instant |
| Interval feedback tags | fade in at `--dur-base` | instant |
| Interval playing blocks | on and off at tone edges from the audio clock, no tween | same (they are state, not decoration) |
| Next question, Next trial | slot content crossfade at `--dur-fast` | instant |
| Leak notice, spread warning | slides in `--move-enter` with opacity, once | instant |
| Speaker check running | static working bar (mic on, rule 3) | same |
| Check result to Ready | slot content crossfade at `--dur-fast` | instant |

**Never animated (FINAL):** every number. The live hero (as M1). The phase word and timeline, which change on the audio clock with no fade. The remaining-time bar, drawn from the audio clock with no transition. Figures, cursor, zoom and pan, which are instant, because an animated rescale shows axes that do not match the marks. The count `#ar-count`. While `html[data-live="on"]` (Sustain and Pitch match takes), no infinite animation anywhere (motion-testpage.md rule 3). Only the one-shot transitions above.

---

## 8. Element IDs (new, no clash with M1 or `#/legacy`)

| Prefix and IDs | What |
|---|---|
| `fa-open`, `fa-input`, `fa-status`, `fa-progress`, `fa-cancel`, `fa-error`, `fa-error-details` | file open, status, progress, errors |
| `fa-info`, `fa-info-name`, `fa-info-dur`, `fa-info-rate`, `fa-info-ch`, `fa-info-method`, `fa-lossy-note` | file strip |
| `fa-a4`, `fa-a4-dec`, `fa-a4-inc`, `fa-a4-error` | A4 stepper |
| `fa-figs`, `fa-overview`, `fa-view`, `fa-cursor`, `fa-cursor-line`, `fa-fig-pitch`, `fa-fig-cents`, `fa-fig-vib`, `fa-fig-spec` | figure stack |
| `fa-r-time`, `fa-r-note`, `fa-r-pitch`, `fa-r-offby`, `fa-r-vib`, `fa-d-f0`, `fa-d-dev`, `fa-d-level`, `fa-d-band` | readings at cursor |
| `fa-span-from`, `fa-span-to`, `fa-span-error`, `fa-sus-target`, `fa-sus-run`, `fa-sus-result` | measure a held note |
| `ar-state`, `ar-play`, `ar-answers`, `ar-feedback`, `ar-next`, `ar-count`, `ar-error`, `ar-a4`, `ar-set-intervals`, `ar-set-dir`, `ar-set-from`, `ar-set-to`, `ar-set-error` | interval recognition |
| `ex-sus-slot`, `ex-sus-status`, `ex-sus-target`, `ex-sus-toggle`, `ex-sus-elapsed`, `ex-sus-result`, `ex-sus-mic-off` | Sustain (hero ids prefixed `ex-sus-readout-*`) |
| `ex-match-slot`, `ex-match-status`, `ex-match-ref`, `ex-match-phase`, `ex-match-left`, `ex-match-run`, `ex-match-run-reason`, `ex-match-leak`, `ex-match-result`, `ex-match-mic-off` | Pitch match |
| `ex-chk-run`, `ex-chk-cancel`, `ex-chk-status`, `ex-chk-progress`, `ex-chk-verdict`, `ex-chk-results`, `ex-chk-warning`, `ex-chk-stale`, `ex-chk-error` | speaker and microphone check |
| `ex-rate-error` | input rate refusal (Option A), both exercises |
| `fa-info-rate-note`, `fa-rate-error`, `fa-type-error` | file rate note line, rate refusal (Option A), file type error |

The engineer can add IDs. These are the ones tests and the a11y-auditor will reference.

---

## 9. Spec OPEN questions and where they land in the UI (carried, not answered)

| Q | Where it shows |
|---|---|
| Q1 rates (DECIDED, Option B) | Not built, Option A: the "Sample rate not supported" file state (3.3) and the exercise "Rate not supported" state (5.1). Option B: the Resampled note lines in the file strip (3.2), the result strip (2.4) and Setup. Both are designed, and only the chosen one is built |
| Q2 budgets | the constants come from the spike (spec 4.5). They appear in the drop zone limits line, Too large, Too long and the exercise take limit, always formatted from the constant |
| Q3 browser results | the lossy and resampling notes say "unverified" until V-07 and V-08 have verified numbers (spec 2.1). The N and B tags change no screen otherwise. No M2 screen shows a pass verdict |
| Q4 encoder | same lossy note |
| Q5 browser | none in the UI |
| Q6 timbre | a Settings radio, only if it becomes her choice |
| Q7 interval set and range | Settings defaults, the Pitch match reference range (D4) |
| Q8 just intervals | not designed (proposed non-goal) |
| Q9 tolerances | none. No WITHIN cue on exercise results until answered |
| Q10 octave matches | the Octave row stays separate |
| Q11 drift threshold | none in the UI (report only) |
| Q12 labelling takes | none in the UI |
| Q13 what she wants after a take | the result hierarchy (D10) |
| Q14 timing and check constants | read from `m2_params`, shown in Details |
| Q15 remembering the check | 5.4: designed for "every visit" now. The "from an earlier visit" line is designed in case Q15 allows it. Context for the owner: M2-REVIEW-CARD follow-up 5 asks whether a check on every visit turns Pitch match into a chore. From the-user-who-hates-this review (ranked first of its flags): a check gated on every visit, with a locked Start trial each time, is where she quits Pitch match. Not decided here |

---

## 10. New OPEN design questions

- **D1.** Tools index: drop the fixed Voice analysis detail panel and go to a full-width table, with requirements on each tool page (1.4)? And numbers 05 and 06 for the new tools?
- **D2.** Hide the live note and the reference name during a Pitch match trial (recommended), or show the M1 hero while she sings (5.3)? Context from the-user-who-hates-this review (ranked second): with no note, no cents, a hidden reference and a countdown, she cannot tell whether the app hears her until the result, so the trial feels graded in secret. It suggested a "heard you" signal during Sing that does not reveal the pitch, and a line on screen saying the note is hidden so she matches by ear.
- **D3.** (Spec gap) E1 on a file span: re-analyse the span as its own take, or use the whole-file frames inside it? The continuity step looks at the whole take, so the two can differ, and E-11a does not say which one is meant (3.5).
- **D4.** (Spec gap) How the Pitch match reference note is chosen (random from a range, her pick, or both), and the same for the E4 interval. Also whether she can replay the reference after a result.
- **D5.** `FILE_VIEW_DEFAULT_S`, the default visible span on the file view. Needs her typical take length (assumption 3).
- **D6.** Show the two note names after an interval answer? CUTTABLE, not a measurement.
- **D8.** (Spec gap) Interval direction: one choice (as designed) or a mix drawn per question?
- **D9.** Are tone length and gap settings she can change, or fixed text?
- **D10.** Which Sustain measure, if any, gets the large type. It waits on Q13.
- **D11.** Keep the mic open between takes on an exercise route (as designed) or stop it after each take?
- **D12.** Single-key shortcuts for interval answers (needs an off switch)? Not in M2 as designed.
- **D13.** Screen reader announcements during a take can be captured by the mic through speakers. Keep the single-word announcements and recommend headphones (as designed), or stay silent during takes?

- **D14.** The speaker and microphone check runs inside Pitch match (as designed). Should it also be a Methods block, for example for Joseph's setup visit?
- **D15.** The new check and the M1 Loopback latency check in Methods both measure a speaker-to-mic delay, with different procedures. Keep both, relabel one, or retire Loopback once the new check exists?
- **D16.** (Spec gap) Does "Inconclusive" count as "the check has run" for the E-27 gate? As designed, it does not, and Pitch match stays disabled. The spec only says the check must have run. Context from the-user-who-hates-this review: if her room is never quiet enough, Inconclusive locks her out of Pitch match with no way round, which is where she quits.
- **D17.** (Spec gap) When does "File type not supported" apply, compared with spec 4.3's "any other container: rate unknown, treated as an other-rate file"? Under Option B those two rules disagree for, say, an OGG file. As designed: the type check runs first, so any file that is not WAV, MP3 or M4A/AAC gets "File type not supported".
- **D18.** Mic take length on Sustain: reuse `MAX_DURATION_S` from the file spike (as designed), or measure a separate limit for mic capture?

- **D19.** The interval tally `#ar-count`, "Matched {correct} of {answered} this visit" (spec 5.1 copy "{correct} of {answered}"). Keep it as designed in 4.1, or change how or whether it shows? Context from the-user-who-hates-this review (ranked third): a running "Matched x of y" reads as a score and makes ear practice feel like an exam. It suggested making the tally hideable or shown only on request. Not decided here. The spec requires the count (T-12), so dropping it would be a spec change.
- **D20.** (Spec owner) Wording and placement in this design that now differs from fixed text in `specs/M2.md`, after the review. Each needs the spec owner's agreement, or the spec is updated to match:
  - Leak notices (5.3): new wording, and no "Headphones avoid this" (spec 6.3).
  - "File rate not confirmed" is now in Notes on this file, with a marker on the strip (spec 4.3 calls it "the label").
  - The spectrogram averaging note is now in the technical caption behind a disclosure (spec 4.2.7: "stated in the caption").
  - "No sustained note found" is kept as the heading, with an added line that says what happened. E-08 and E-22 still match.
- **D21.** MOOT, because Q1 chose Option B and the refusal is not built. How to change the sample rate or export setting on her phone's voice memo app, for the Option A refusal line (3.3). It differs by phone and app. Needs her phone model and app (and Q1 = Option A).

(There is no D7. A draft question was settled in 4.2.)

Also carried from DESIGN.md: OPEN 1 (reduced motion and fades), which applies to every M2 transition. I also noticed that `tokens.css` Loud `--surface-plot` is still `#5B7CFF`, while DESIGN.md 1.3 sets `#0A0A0A`. That needs reconciling before the M2 figures use it.

## 11. Before building

- Run the design-review-card on this document (CLAUDE.md, before a new screen). Then review-as with the user who hates this for UI, and the cross-functional eng lead before the build.
- After each milestone: a11y-auditor on the built screens, plus a real screen reader pass on the time cursor and the interval answers (REVIEW-CARD follow-up 2).
- M2.3 cannot start until DESIGN.md section 9 (VA-01 to VA-49) passes (spec section 3 gate). Before Phase B is built, DESIGN.md section 6 needs the `exercise` and `speakercheck` owners, the raw-sample capture path, and a handover between the two owners with no second permission prompt (5.4). That is a designer task on DESIGN.md, not part of this document.
- If Phase B slips, M2.3a ships as the "Measure a held note" panel on `#/file` only (3.5).

---

## Changelog

**Revision 3** (the-user-who-hates-this review, no behaviour questions decided):
1. Speaker check (5.4): an opening line on why ("So the app knows when to listen for you."). The primary view is the verdict sentence and a plain line. Delay, dBFS, notes heard, spread and the pitch offset moved to Details, and the announcements no longer read numbers. The Ready check line and the Overview row have no numbers.
2. Overview (1.5): the Speaker and microphone row appears only after she has opened Pitch match this visit.
3. Headphones advice appears once, in Pitch match Ready. It is removed from the exercises index, the check results, the leak notices and the a11y note. Leak notice with the sub-flag: "This is not about your singing." Without the sub-flag that sentence is not used, because the sound may be her own early singing (E-18). Spec wording differences are in D20.
4. Pitch match: Wait has a one-line reason. "No sustained note found" stays as the heading, and a line says what happened, in the app's voice ("The app did not hear…", never "I"). The same pattern is used in Sustain.
5. Recording analysis: the Option A refusal has a how-to line for phone memos, with the exact steps OPEN (D21). The "nothing to show until the whole take is analysed" reason moved beside the progress bar.
6. File strip: "File rate not confirmed" and the MP3/AAC "unverified" line moved into Notes on this file (About this analysis), with a neutral "{n} notes about this file" marker on the strip. The Resampled line stays, because the spec requires it.
7. Figure captions: plain captions on the primary view, technical captions in "About these figures".
8. Sustain result rows each have a plain one-line gloss, with no tolerance or judgement (Q9 open).
9. "Cancelled because you left the page." is replaced by "Your last take / trial was stopped when you left the page." and "The speaker check was stopped when you left the page." Cancel by button keeps "cancelled".
10. Review context added to D2, D16 and Q15, and new D19 (interval tally). The reviewer's text was not available, so these are marked gaps. New D20 (spec-wording differences) and D21 (phone how-to).

**Revision 2** (follows `specs/M2.md` revision 2):
1. Sample rate (spec 4.3, Q1). The file strip shows the analysis rate and how it was obtained, including "File rate not confirmed" for M4A files that may use implicit SBR. Both Q1 options are designed. Option A adds the "Sample rate not supported" file state with the spec copy, and an exercise "Rate not supported" state. Option B adds the Resampled lines on the file strip, the result strip and Setup. Added the "File type not supported" state (D17). Updated the out-of-memory copy to the spec's.
2. Limits (spec 4.5). `MAX_DURATION_S` and `MAX_FILE_BYTES` come from the spike. All limit copy is formatted from the constants. The 10-minute example is removed. The mic take limit is now D18.
3. Speaker and microphone check (spec 6.4). New section 5.4: where it lives, the E-27 gate with the spec copy, every step and state, invalidation by device changes, the stale-result line, and Q15 carried with a design for both answers. Pitch match timing now uses the measured delay or the headphones rule, never `outputLatency` or `baseLatency`. A device change mid-trial cancels the trial. Added an Overview Technical checks row, IDs, focus order and motion rows. New D14, D15 and D16.
4. M2.3a fallback. Sustain on files only is the existing "Measure a held note" panel on `#/file`. In M2.3a, exercise routes do not exist and Tools row 06 is Not built yet. E-11 is split into E-11a and E-11b.
5. N and B tags change no screen. Unverified B results show as "unverified" in the lossy and resampling notes, never as passed.
6. Criterion numbers and spec section references updated to revision 2. Sections 5.4 to 5.6 are renumbered 5.5 to 5.7.

Revision 3.1 (2026-11-08): Q1 decided, Option B. Option A states (file "Sample rate not supported", exercise "Rate not supported", `fa-rate-error`, `ex-rate-error`) are not built. D21 is moot.

Revision 3.2 (2026-11-08): longest take is 10 minutes (spec Q2, part decided). Assumption 3 updated. D5 still needs her typical take length.
