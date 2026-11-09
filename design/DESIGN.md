# DESIGN.md: Cents to Dollars, M1 screens

Status: spec, not built. Revision 2 (persona review and owner answers folded in, changelog at the end). The engineer builds from this. Settled items are marked **FINAL**, owner questions **OPEN**, and items that can be dropped under time pressure **CUTTABLE**.

For practice and study. Not a diagnostic or medical device. That line appears in the footer of every screen and is never removed.

M1 runs on the dev server only (`npx vite`, owner decision). There is no production build. The document links and the self-test fixtures only exist on the dev server, and the UI says so where it uses them.

## 0. Problem and user

**User.** One classically trained singer ("her" in VALIDATION.md section 11), practising alone with a microphone, standing 1 to 2 m from the screen while singing. Her voice type, range, mic, interface and room are unknown (VALIDATION.md section 11). A second user is Joseph, who runs the setup checks on her machine. There are no persona files yet (`docs/research/personas/` does not exist), so the user model comes from VALIDATION.md and from the persona review of revision 1.

**Problem.** M1 measures pitch, but the only way to see it is a monospace text dump on a test page. From where she stands she cannot read the note, whether she is flat or sharp, or whether the app can hear her at all.

**Assumption that carries the hero design.** She reads the screen from 1 to 2 m away. Test: watch one real practice session. If she sits at the desk, the hero can shrink. Nothing else changes.

**Decision.** One shared structure with two themes, Paper (the default) and Loud. Four real routes (Overview, Tools, Voice analysis, Methods) plus Not found and a temporary `#/legacy`, all in one HTML document with hash routing. Every value comes from a real measurement and otherwise shows an explicit empty state.

**Not doing, and why.**
- No sessions, saving, notes, "Stop and save" or take summary (average cents and the like). Nothing is stored, and a take summary would be a new derived measurement that M1 has not defined or validated.
- No "Open an audio file": not built.
- No helper, storage or "Last used" badges: none of them exist.
- No search or filter on Tools: four rows do not need them.
- No confidence meter: `aperiodicity` is not validated as confidence.
- No "in tune" or "out of tune" wording. MEASUREMENT.md section 2 defines cents as distance from the equal-tempered note. FLAT and SHARP describe a direction, not a judgement.
- No validation numbers copied into the UI. The self-test criteria are read from `results/summary.json` (section 7.4).

---

## 1. Design language

### 1.1 Principles

1. **A number means a measurement happened.** Empty states use words ("No pitch yet", "Not run this visit"), never a dash or a zero.
2. **Plain words on the singing screen, technical words behind "Details".** She sees Note, Pitch, Vibrato speed and Vibrato width. F0, dBFS, the gate, P95, the window and the tracker sit in collapsed disclosures.
3. **The current pitch is read first,** and it is readable from 2 m: note, a FLAT or SHARP cue, cents, and a meter, at the top of the screen with no scrolling.
4. **One structure, two skins: no change to markup, order or states between themes.** Wrapper elements that one theme needs (for example the blue plot frame) exist in both themes and are inert in Paper. Where the two themes show different text (for example "c" against "CENTS"), both variants are in the DOM and CSS shows one (section 1.2).
5. **Calm by default, loud by choice.** Paper is the default. On her first visit, Overview asks which look she wants (section 2.1).

### 1.2 Theme mechanics (FINAL)

- Root attribute `<html data-theme="editorial">` (Paper) or `data-theme="loud"`. These values already exist in `tokens.css`. Visible labels are **Paper** and **Loud**. The default is not labelled "Clinical": the word suggests a medical device.
- What a theme may change: token values (section 1.3 to 1.7), and the component treatments listed in section 1.8. Nothing else.
- **Dual text variants.** When the themes need different words, render both, each with a class: `<span class="v-paper">c</span><span class="v-loud">CENTS</span>`. CSS hides the inactive one with `display: none`, which also removes it from the accessibility tree. Accessible names that must not change between themes go in `aria-label` on the parent. Uppercase is always `text-transform`, never different DOM text.
- **Inert wrappers.** In Paper, `.plot-frame` and `.chip-tilt` have no padding, border, shadow or transform. In Loud they get the frame and tilt. They exist in both themes.
- Persistence: `localStorage` key `centstodollars.theme`, values `editorial` or `loud`, read and written inside try/catch. Unknown value or storage error: `editorial`, and keep working for the visit with no message.
- Apply before first paint: a small inline script in `<head>` sets `data-theme` from storage.
- Theme change dispatches `document.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }))`. The spectrogram re-reads its colours from tokens on that event (section 6).
- `prefers-reduced-motion: reduce`: every `--tilt-*` is `0deg`, every `--dur-*` is `0ms`, `--move-enter` is `0px`, no smooth scrolling. This follows the owner's rule ("no rotation or transition when set"). Today `tokens.css` keeps 100 to 120ms fades under reduced motion. That has to change to 0ms, or the owner confirms that fades are allowed (**OPEN 1**).
- `html[data-motion="off"]` (set by the automation harness) stays exactly as it is in `tokens.css` today.
- `forced-colors: active`: status dots and meter fills get a 1px `CanvasText` border. Focus uses `CanvasText`, as in the current `index.html`.

### 1.3 Colour tokens

| Token | Paper (`editorial`) | Loud | Use |
|---|---|---|---|
| `--bg` | `#F2F0EA` | `#FFD60A` | page background |
| `--panel` | `#FBFAF6` | `#FFFFFF` | panel surface |
| `--ink` | `#141413` | `#0A0A0A` | text, borders, primary button fill |
| `--ink-2` (new) | `#3B3A36` | `#0A0A0A` | prose inside panels |
| `--muted` | **`#686761`** (now `#6B6A64`) | `#0A0A0A` | labels, secondary values, not-built rows |
| `--rule` | `#D6D3CA` | `#0A0A0A` | inner dividers only, never a control boundary |
| `--hover` (new) | `#ECE9E0` | `#FFD60A` | row hover and selected row |
| `--signal` | `#E4401B` | `#FF5BA7` | graphics: F0 marks, live dot, active nav marker, Paper focus ring |
| `--signal-text` (new) | **`#C2360F`** | `#0A0A0A` | text, or a fill behind text, in the signal role |
| `--ok` | `#2F6B4F` | `#2EE59D` | "within tolerance", "passed" (dot, border, Loud chip fill) |
| `--accent-2` | `#2F6B4F` | `#5B7CFF` | Loud: the plot frame |
| `--surface-plot` | `#FBFAF6` | **`#0A0A0A`** (now `#5B7CFF`) | plot background. In Loud, blue moves to the frame |
| `--plot-energy` (new) | `#141413` | `#FFD60A` | spectrogram energy ramp, from `--surface-plot` to this colour |
| `--plot-band` (new) | `rgba(228,64,27,0.35)` | `#5B7CFF` | 2.5 and 3.5 kHz guide lines |
| `--on-ink` (new) | `#F2F0EA` | `#FFD60A` | text on ink fills |
| `--state-working` | `var(--ink)` | `var(--ink)` | kept |
| `--state-done` | `var(--ok)` | `var(--ink)` | kept |
| `--state-error` | `#B3261E` | `var(--ink)` | error text and icon. Paper 5.74:1 on bg, 6.26:1 on panel |
| `--focus` | `var(--signal)` | `var(--ink)` | kept, contrast in 1.4 |

### 1.4 Contrast check (WCAG 2.2 AA)

Ratios are computed from sRGB relative luminance. Text needs 4.5:1. Large text and non-text UI need 3:1.

**Paper**

| Pair | Ratio | Verdict |
|---|---|---|
| ink on bg / panel | 16.2 / 17.7 | pass |
| ink-2 on panel | 10.9 | pass |
| reference muted `#6B6A64` on hover `#ECE9E0` | **4.47** | **fail**, so muted becomes `#686761` |
| `#686761` on bg / panel / hover | 4.98 / 5.43 / 4.67 | pass |
| `#A8A69D` on bg (reference disabled nav) | **2.14** | **fail**, not used for text |
| `#9A988F` on panel / white (reference placeholders) | **2.77 / 2.89** | **fail**, not used |
| `#E4401B` as text on bg / panel | **3.65 / 3.98** | **fail** for text, so text uses `--signal-text` |
| bg / white / ink text on `#E4401B` | **3.65 / 4.16 / 4.43** | **fail**: no text on `#E4401B`. The primary hover fill becomes `#C2360F` |
| `#E4401B` as graphic or focus ring on bg / panel / hover | 3.65 / 3.98 / 3.43 | pass (3:1) |
| `#C2360F` on bg / panel; bg text on `#C2360F` | 4.81 / 5.25; 4.81 | pass |
| `--ok` on bg / panel | 5.52 / 6.03 | pass |
| `--state-error` `#B3261E` on bg / panel | 5.74 / 6.26 | pass |
| `#D6D3CA` on white (reference input border) | **1.50** | **fail** as a boundary, so inputs get an ink border |
| `#E4401B` F0 mark on mid-grey spectrogram pixels | about 1:1 | **fail**, fixed with a 1px `--surface-plot` halo |

**Loud**

| Pair | Ratio | Verdict |
|---|---|---|
| ink on yellow / yellow on ink / ink on white | 14.0 / 14.0 / 19.8 | pass |
| ink on pink / green / blue | 6.89 / 12.1 / 5.44 | pass |
| white on blue | **3.64** | **fail**: no text on blue |
| pink text on white | **2.87** | **fail**, so Loud `--signal-text` is ink |
| pink / blue / green fill next to yellow | 2.04 / 2.58 / 1.16 | **fail** for 1.4.11, so every coloured fill keeps a 4px ink border |
| pink F0 / yellow energy / blue frame against an ink plot | 6.89 / 14.0 / 5.44 | pass |

### 1.5 Type

Line heights sit on the 4px grid. Numbers use `font-variant-numeric: tabular-nums`. Labels are sentence case in the DOM and uppercase through CSS.

**Paper**

| Token | Family | Size / line height | Weight | Tracking | Use |
|---|---|---|---|---|---|
| `--t-hero` | Newsreader | clamp(104px, 30cqi, 200px) / 1 | 350 | -0.02em | note letter |
| `--t-cue` (new) | Geist | 32 / 36 (compact 24 / 28) | 600 | 0.02em, upper | FLAT, SHARP, WITHIN |
| `--t-chip` | Geist Mono | 32 / 36 (compact 24 / 28) | 500 | 0 | cents chip |
| `--t-display-1` | Newsreader | 40 / 44 (compact 32 / 36; on Voice analysis compact 24 / 28) | 350 | -0.02em | h1 |
| `--t-display-2` | Newsreader | 26 / 32 | 350 | -0.01em | h2, empty readout text |
| `--t-display-3` | Newsreader | 24 / 28 | 350 | 0 | large values, A4 stepper value |
| `--t-hint` (new) | Geist | 18 / 24 | 500 | 0 | "I can't hear you" hint |
| `--t-body` | Geist | 14 / 20 | 400, strong 500 | 0 | body, table cells |
| `--t-body-s` | Geist | 13 / 20 | 400 | 0 | secondary text, smallest size for information |
| `--t-label` | Geist Mono | 11 / 16 | 400 | 0.05em, upper | strips, labels, nav |
| `--t-mono` | Geist Mono | 13 / 20 | 400 | 0 | numeric cells |
| `--t-caption` | Newsreader italic | 14 / 20 | 400 | 0 | figure captions |

**Loud**

| Token | Family | Size / line height | Weight |
|---|---|---|---|
| `--t-hero` | Archivo Black | clamp(112px, 36cqi, 230px) / 1, -0.04em | 400 |
| `--t-cue` | Archivo Black | 36 / 40 (compact 28 / 32), upper | 400 |
| `--t-chip` | Archivo Black | 36 / 40 (compact 28 / 32), upper | 400 |
| `--t-display-1` | Archivo Black | 56 / 56 (compact 36 / 40; Voice analysis compact 28 / 32), upper | 400 |
| `--t-display-2` / `-3` | Archivo Black | 28 / 32 | 400 |
| `--t-hint` | Archivo | 20 / 28 | 700 |
| `--t-body` | Archivo | 16 / 24 | 500, strong 700 |
| `--t-body-s` | Archivo | 14 / 20 | 500 |
| `--t-label` | Archivo Black | 14 / 20, upper, 0.02em | 400 |
| `--t-mono` | Archivo | 16 / 24 | 700 |
| `--t-caption` | Archivo | 14 / 20 | 500 |

The cue, the chip and the tolerance text are at least 24px in every theme and at every width (persona review item 4).

**Fonts (FINAL, owner approved self-hosting with @fontsource).** Import only the Latin subset and only these weights:

| Package | Weights and styles | Used for |
|---|---|---|
| `@fontsource-variable/newsreader` | variable `wght` and `opsz`, normal and italic | Paper display (350), captions (italic) |
| `@fontsource/geist` | 400, 500, 600 | Paper UI |
| `@fontsource/geist-mono` | 400, 500 | Paper labels, chip, numbers |
| `@fontsource/archivo` | 500, 700 | Loud UI |
| `@fontsource/archivo-black` | 400 | Loud display, labels, chip |

The engineer checks the exact package names and CSS entry points on npm before installing. If Geist is published under another name (for example `geist-sans`), use that one. Import only from `src/app/fonts.ts`, so the whole font set lives in one file. Use `font-display: swap`. Fallback stacks stay in the tokens: Newsreader to `Georgia, serif`; Geist to `system-ui, sans-serif`; Geist Mono to `ui-monospace, monospace`; Archivo Black to `"Arial Black", system-ui, sans-serif`; Archivo to `system-ui, sans-serif`. Check whether Newsreader and Archivo Black have "♯" and tabular figures (**OPEN 6**).

### 1.6 Spacing (4px base, shared)

| Token | px |
|---|---|
| `--s-1` to `--s-16` | 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 (`--s-1`, `-2`, `-3`, `-4`, `-5`, `-6`, `-8`, `-10`, `-12`, `-16`) |

| Layout token | Paper | Loud | Reason |
|---|---|---|---|
| `--gap-panel` | 20 | 32 | Loud shadows (10px) and tilt need room |
| `--gutter` wide / compact | 32 / 16 | 48 / 16 | 16px at 375 in both themes |
| `--strip-pad` | 8 16 | 12 16 | |
| `--row-pad` | 12 16 | 12 16 | |
| `--control-h` wide / compact | 40 / 44 | 48 / 48 | 44px touch minimum on compact |

Breakpoints: compact under 600px, medium 600 to 959px, wide from 960px. Content max width 1440px. Reference widths: 375 and 1280, and every screen also reflows at 320 with no horizontal scroll.

### 1.7 Borders, shadows, tilt, motion, focus

| Token | Paper | Loud |
|---|---|---|
| `--border-w` | 1px | 4px |
| `--divider-w` (new) | 1px `--rule` | 2px ink |
| `--radius` | 0 | 0 |
| `--shadow-panel` (new, replaces `--shadow`) | none | 10px 10px 0 ink (compact 6px 6px 0) |
| `--shadow-chip` (new) | none | 5px 5px 0 ink |
| `--shadow-button` (new) | none | 6px 6px 0 ink |
| `--tilt-a` (new, replaces `--tilt`) hero panel | 0deg | 1deg (compact 0.5deg) |
| `--tilt-b` (new) plot frame | 0deg | -0.8deg (compact 0deg) |
| `--tilt-chip` (new) status chip | 0deg | 2deg |
| `--focus-w` / `--focus-offset` (new) | 2px / 2px | 4px / 4px |
| `--dur-*`, `--ease-*`, `--move-enter`, `--btn-*-shift` | as in `tokens.css` today | as in `tokens.css` today |

Never animated: readout digits, cue, chip, meter marker, level bar. Entrance animations (`--dur-enter`) never apply to the hero or the canvas. Transforms can create scrollable overflow, so the page wrapper gets `overflow-x: clip` and tilts stay at or below 1deg.

Focus: `outline: var(--focus-w) solid var(--focus); outline-offset: var(--focus-offset)` on `:focus-visible`, keeping the transparent-at-rest pattern from the current `index.html`.

### 1.8 Theme treatment list (the only per-theme differences besides token values)

| Component | Paper | Loud |
|---|---|---|
| Nav active item | `--signal` 2px underline and 6px square | ink block, `--on-ink` text |
| Not-built tag | text only, muted | dashed 2px ink border |
| Panel strip | transparent, ink bottom border | ink fill, `--on-ink` text |
| Cents unit | `.v-paper` "c" | `.v-loud` "CENTS" |
| Plot frame `.plot-frame` | inert | `--accent-2` fill, 16px padding, 4px border, `--shadow-panel`, `--tilt-b` |
| Hero panel | ruled, no tilt | `--shadow-panel`, `--tilt-a` |
| Status chip `.chip-tilt` | inert | pink fill, `--shadow-chip`, `--tilt-chip` |
| Cents chip within tolerance | `--ok` border and text | `--ok` fill, ink text |
| Buttons | flat | `--shadow-button`, press shift |
| Fonts and case | Newsreader, Geist, Geist Mono | Archivo Black, Archivo, more uppercase |

**CUTTABLE:** the Loud tilt and shadow pass (the rows using `--tilt-*` and `--shadow-*`). Without it, Loud ships with its colours, fonts and 4px borders, and every other row of this table still applies.

### 1.9 Token mapping against the current `tokens.css`

Read from the file as it stands now. `index.html` (the legacy harness) uses several of these tokens, so nothing is dropped until `#/legacy` is removed after Phase C.

| Current token | Action | Notes |
|---|---|---|
| `--bg`, `--panel`, `--ink`, `--rule`, `--ok`, `--accent-2` | kept | values unchanged |
| `--muted` | kept, Paper value changed | `#6B6A64` becomes `#686761` |
| `--signal` | kept | update the comment: no "Sample data" tag, and it is the Paper focus ring |
| `--surface-plot` | kept, Loud value changed | `#5B7CFF` becomes `#0A0A0A` |
| `--font-display`, `--font-ui`, `--font-label` | kept | add the fallbacks from section 1.5 |
| `--size-title` | renamed to `--t-display-1` size | keep as an alias until Phase C |
| `--size-ui` | renamed to `--t-body` size | alias until Phase C |
| `--size-label` | renamed to `--t-label` size | alias until Phase C |
| `--border-w`, `--radius` | kept | |
| `--shadow` | renamed to `--shadow-panel` | alias until Phase C |
| `--tilt` | renamed to `--tilt-a` | alias until Phase C. Add `--tilt-b` and `--tilt-chip` |
| `--dur-fast`, `--dur-base`, `--dur-enter`, `--dur-sweep`, `--dur-done`, `--stagger` | kept | reduced-motion values change to 0ms (OPEN 1) |
| `--ease-standard`, `--ease-enter`, `--ease-spring` | kept | |
| `--move-enter`, `--btn-hover-shift`, `--btn-press-shift` | kept | |
| `--state-working`, `--state-done`, `--state-error`, `--state-bar-h` | kept | used by result blocks (`data-state`) |
| `--focus` | kept | add `--focus-w` and `--focus-offset` |
| `html[data-motion="off"]` block | kept as is | automation hook |
| `html[data-live]` (in `index.html`) | kept as the hook for the mic indicator | set by `live.ts` |
| none | dropped | no current token is dropped |

New tokens: `--ink-2`, `--hover`, `--signal-text`, `--plot-energy`, `--plot-band`, `--on-ink`, `--t-*`, `--s-*`, `--gap-panel`, `--gutter`, `--strip-pad`, `--row-pad`, `--control-h`, `--divider-w`, `--shadow-panel`, `--shadow-chip`, `--shadow-button`, `--tilt-a`, `--tilt-b`, `--tilt-chip`, `--focus-w`, `--focus-offset`.

---

## 2. Components

### 2.1 App header, nav, theme switch and first-visit choice

- Brand link "Cents to Dollars" (to `#/`). Nav items: Overview, Tools, Sessions, Methods. Sessions is a non-focusable `<span>` with a visible "Not built yet" tag. Active item: `aria-current="page"`. Voice analysis marks Tools as active.
- Mic indicator: shown while `html[data-live="on"]`. A `--signal` dot and "Mic on", in a `role="status"` region.
- Theme switch: `<fieldset>` with legend "Theme" and two radios, Paper and Loud.
- **First-visit choice (FINAL):** when `centstodollars.theme` is absent, Overview shows an inline panel above the page header. "How should it look? Paper is calm, for reading. Loud is big, for singing across the room." Two buttons: "Keep Paper" and "Switch to Loud". Either one stores the choice and closes the panel. It is not modal, so "Start singing" still works and Paper stays in effect until she picks.
  Reason: it keeps the owner's Paper default. Screen width does not predict viewing distance (a phone on a music stand and a laptop across the room both happen), so defaulting to Loud below 768px would guess wrong in both directions. Shown only on Overview, so it never pushes down the Voice analysis hero.
- Wide: one row, 56px. Compact: brand and theme switch on row 1, nav on row 2 (which may wrap to a second line).
- A skip link "Skip to content" comes before the header.

### 2.2 Page header

Eyebrow or breadcrumb, h1 (`tabindex="-1"`, focused on route change), optional lede (max 62ch), optional action.

### 2.3 Panel

`<section aria-labelledby>`, strip (title on the left, meta on the right), body. Treatments in section 1.8.

### 2.4 Key-value row

Label, value, unit, optional note line. Empty state: a reason in words ("No pitch", "None found in the last 2.5 s"). Pending: "Measuring…". Error: "Could not measure" plus the reason. Hook convention in section 7.3.

### 2.5 Table row

Grid row with dividers. A row that is a link gets hover. A selected row gets `--hover` and a 3px `--signal` inset bar. A not-built row: muted text, hollow dot, "Not built yet", not a link. On compact, rows stack as key-value blocks, with no horizontal scroll.

### 2.6 Status dot and label

The label always states the status. Live: filled `--signal`. Ok: filled `--ok`. Idle, not run or not built: hollow ring. Error: hollow square with "!" in `--state-error`.

### 2.7 Buttons

Primary (ink fill, `--on-ink` text, Paper hover `--signal-text`), ghost (border only), hero toggle (full panel width, 56px tall, `--t-cue` size in Loud), disabled (`disabled`, muted, and a reason next to it when it is not obvious), busy (disabled plus a label change, no spinner). Always `<button type="button">`, at least `--control-h` tall.

### 2.8 Number inputs and the A4 stepper

- **A4 stepper (next to the hero, FINAL).** Label "A4". A "−" button (`aria-label="Lower A4 by 1 hertz"`), the input `#va-a4` (`inputmode="decimal"`, range 400 to 480, step 0.1, `--t-display-3`, 7ch wide), "Hz", and a "+" button. Buttons are 48px square. The buttons change the value by 1 Hz. Typing allows 0.1 Hz.
- Validation on `change` and blur. Out of range or empty: the error line `#va-a4-error` says "Enter a value from 400 to 480 Hz", `aria-invalid="true"` is set, and the last valid value stays in use. A valid change applies on the next frame and is announced ("Reference A4 = {a4} Hz"). Saved to `centstodollars.a4`.
- `#m-cal-hz`: 60 to 2000 (the tracker's F0 search range), error line `#m-cal-hz-error` "Enter a value from 60 to 2000 Hz".
- Both inputs fix a current bug: `Number(value) || 440` accepts 4 Hz and silently turns 0 into 440.

### 2.9 Big pitch readout (the hero)

Read first, because it answers "what note am I on, and which way am I off".

Anatomy, top to bottom:
1. **Strip:** label "Note". On the right, the status chip in `.chip-tilt`: Idle, Waiting for permission, Listening, No pitch, Stopped, Microphone blocked, Error.
2. **Note block:** letter in `--t-hero`. Accidental at 0.45em aligned to the top and octave number at 0.45em aligned to the bottom, so the width does not change between naturals and sharps. Accessible name "A sharp 4".
3. **Direction cue and cents** on one line, both at least 24px:
   - Cue `#readout-dir`: an inline SVG arrow (`aria-hidden`) plus a word. Below the note: a left-pointing arrow and "FLAT". Above it: "SHARP" and a right-pointing arrow. Within tolerance: "WITHIN ±{tol} c" with an `--ok` dot. Arrows point the same way the meter marker sits (flat is left), which avoids the up/down ambiguity of "go up" against "you are low". It shows where she is, not what to do.
   - Cents chip `#readout-cents`: signed integer with a real minus sign. 0 shows as "0", never "-0". Unit through dual text ("c" or "CENTS").
   - Never colour alone: the word changes in every state.
4. **Cents meter** `#cents-meter`: track from −50 to +50 c, ticks at −50, 0 and +50, a tolerance zone `#cents-tol-zone`, and a marker at least 8px wide and as tall as the track (24px in Paper, 32px in Loud). `role="img"` with a throttled label. With no pitch, the marker is hidden and the track label says "No pitch".
5. **Caption:** "Nearest note in equal temperament" (`--t-body-s`).
6. **A4 stepper** (section 2.8).
7. **Hint line** `#readout-gate-hint`, `--t-hint`: "I can't hear you. Move closer or turn the input up." Shown while `rmsDb` has stayed below `DEFAULT_YIN.silenceDb` for `GATE_HINT_MS` (1000 ms, tunable, **OPEN 3**).
8. **Level bar** `#level-meter`: thin and unlabelled on the singer's screen (`aria-hidden`). The number and the gate value are in Details.
9. **Toggle** `#live-toggle`: "Start listening" or "Stop listening", plus the line "Space bar also starts and stops" (hidden when the shortcut is off).

Constants (all in `src/app/readout-constants.ts`, each with a comment that it is a display choice and not validated):
- `TOLERANCE_CENTS = 10`: needs her number (**OPEN 2**). Not a setting in M1.
- `HOLD_FULL_MS = 1000`: after the last voiced frame, the note stays at full strength for this long. Then it dims to `--muted`, gets the label `#readout-last` "Last:" in front, and the status chip changes to "No pitch" (**OPEN 3**).
- `GATE_HINT_MS = 1000`.

Update policy: the hero redraws every animation frame from the newest frame, with no smoothing. Smoothing would hide octave slips, and the plain-YIN live path has them (VALIDATION.md section 4).

Screen readers: the hero is not a live region. `#readout-announce` (visually hidden, `role="status"`) announces state changes at once, and note changes at most once per second ("A 4, 12 cents sharp").

Container: `container-type: inline-size` on the hero, so `--t-hero` can use `cqi`.

### 2.10 Spectrogram frame

`.plot-frame` wrapper (inert in Paper), strip ("Spectrogram" on the left; "0 to 4 kHz, last {span} s" on the right, with span = 960 × hop / fs computed, not typed), canvas `#va-spectrogram` (bitmap 960 × 300; CSS height 300px wide, 200px compact), HTML axis labels, legend ("F0" and "2.5 to 3.5 kHz band"), caption "Brightness is energy. Orange marks are the pitch the app measured." (Loud: "Pink marks…" as dual text).
- Colours come from tokens. F0 marks get a 1px `--surface-plot` halo. Colours are re-read on `themechange` (section 6).
- `role="img"`, label "Spectrogram 0 to 4 kHz with pitch marks. The readings are listed as text in the Readings panel."
- States: empty (overlay "Not listening. The plot fills from the right when you start."), live, stopped (frozen, with a "Stopped" chip), error (overlay with the hero error message).

### 2.11 Disclosures

`<details>` and `<summary>`, closed by default, open state not remembered. Used for "Details" (technical readings), "Setup" (input info and settings), "Technical checks" (Overview) and error "Details" (raw error text). The summary is at least `--control-h` tall.

### 2.12 Result block (Methods checks)

Strip (title, status), purpose, requirements, inputs, action, progress line (`role="status"`), results, method note. `data-state="working|done|error"` drives the existing `--state-*` bar. States: Not run this visit, Needs microphone, Running, Done, Done with a warning, Could not run, Cancelled.

### 2.13 Footer

"For practice and study. Not a diagnostic or medical device." and "Audio stays in this browser and is not saved." No "sample data" text anywhere.

---

## 3. Screens

### 3.0 Shared microphone states and copy

The table is mapped from the rejection `name` of `startLive`.

| State | Trigger | Chip | Message | Action |
|---|---|---|---|---|
| Idle | nothing started | Idle | "Press Start listening and sing a steady note. Audio stays in this browser and is not saved." | Start listening |
| Requesting | `getUserMedia` pending | Waiting for permission | "Your browser is asking to use the microphone. Choose Allow." | "Waiting for permission…" (disabled) |
| Denied | `NotAllowedError`, or the Permissions API says `denied` | Microphone blocked | "Microphone access is blocked for this page. Allow it in the browser's site settings, then press Try again." | Try again |
| No device | `NotFoundError`, `OverconstrainedError` | No microphone | "No microphone found. Connect one or switch on your audio interface, then press Try again." | Try again |
| Busy | `NotReadableError`, `AbortError` | Microphone unavailable | "The microphone could not be opened. Another app may be using it. Close it, then press Try again." | Try again |
| Insecure | `!isSecureContext` or no `mediaDevices` | Not available | "The microphone only works on a secure page. Open http://127.0.0.1:5173." | none |
| Analyser failed | AudioWorklet missing or `addModule` failed | Error | "This browser could not start the audio analyser." plus a Details disclosure `#readout-error-details` | Try again |
| Ended | the audio track fires `ended` | Microphone stopped | "The microphone stopped. It may have been unplugged. Press Start listening to continue." | Start listening |

### 3.1 Overview (`#/`)

Read first: the h1 and the single primary action. Everything else is optional.

- First-visit theme choice (section 2.1), only while no theme is stored.
- Page header: h1 "Cents to Dollars". Lede "See the note you are singing, how many cents sharp or flat you are, and your vibrato. Runs in this browser; audio is not saved or uploaded." **One primary button "Start singing"** `#ov-start`. Its click handler calls `live.start({ owner: 'voice' })` inside the click, which keeps the user gesture for the AudioContext, then sets `location.hash = '#/voice'`. Secondary text link "Setup checks" to `#/methods`.
- Disclosure **Technical checks** (collapsed), rows using the `data-field` convention: Microphone permission, Browser audio, Secure page, Reference pitch (A4), Calibration, Loopback latency, Self-test. Values as in section 7.5.
- Panel **Not built yet**: Aural skills, Source separation, Repertoire register, Sessions. Muted, no links.
- 1280: header, page header with the button on the right, disclosure and Not built yet side by side (7 and 5 columns). 375: everything stacked, button full width.

### 3.2 Tools (`#/tools`) **CUTTABLE**

Index table (No., Tool, What it does, Input, Status): 01 Voice analysis, Ready, row links to `#/voice`; 02 to 04 Not built yet. A detail panel for Voice analysis lists its plain outputs and requirements (from section 7.5), with "Open voice analysis →".
If cut: the nav "Tools" item becomes "Voice analysis" (to `#/voice`), and Overview's Not built yet panel carries the unbuilt tools. Nothing else changes.

### 3.3 Voice analysis (`#/voice`)

Read first: note, then the FLAT/SHARP cue and cents, then the meter, then the status chip. The spectrogram and readings are for checking and study.

**No scroll for the hero (FINAL).** The whole hero, from the strip to the toggle, is inside the first viewport at 1280 × 800 and at 375 × 667:

| Budget | 375 × 667 | 1280 × 800 |
|---|---|---|
| App header | 88 (nav wrapping to 2 lines: 112) | 56 |
| Page header (compact h1, breadcrumb hidden below 600) | 52 | 96 |
| Hero: strip, note, cue and chip, meter, caption, A4, hint slot, level, toggle, padding | 452 maximum | 560 maximum |
| Total | 616 (640 with nav wrapping) | 712 |

The hint slot is reserved space (24px) so the hint does not push the toggle. If the fonts make the hero taller than the budget, the note size gives way first (the `cqi` clamp minimum applies, then the engineer lowers it) and the toggle never leaves the viewport.

Layout 1280: page header (breadcrumb "Tools / Voice analysis", h1 "Voice analysis"); hero in 5 columns and spectrogram in 7 (equal height); below them, Readings in 5 and How to read this in 7; Setup disclosure in 12. No settings strip above the hero.
Layout 375: page header; hero; spectrogram; Readings; Setup; How to read this.

**Readings panel** (plain labels):
- Pitch `#m-pitch`: "{f0} Hz" (1 decimal). Empty: "No pitch".
- Off by `#m-offby`: "{n} cents {flat|sharp} of {note}". Empty: "No pitch".
- Vibrato speed `#m-vib-speed`: "{r} per second" (1 decimal), note "last 2.5 s". Empty: "No vibrato found in the last 2.5 s".
- Vibrato width `#m-vib-width`: "±{e} cents", note "up and down from the middle". Empty: same as speed.
- Disclosure **Details** (collapsed): F0 `#d-f0` "{f0} Hz" (2 decimals); Deviation `#d-dev` "{±c.c} c from {note} ({target} Hz)"; Vibrato extent peak to peak `#d-vib-p2p`; Energy 2.5 to 3.5 kHz vs 0.05 to 2 kHz `#d-band` "{x} dB, last 2.5 s, voiced frames" (empty "No voiced frames in the last 2.5 s"); Input level `#d-level` "{x} dBFS"; Voicing gate `#d-gate` "{silenceDb} dBFS".

**Setup disclosure** (collapsed): Input `#s-input`, Sample rate `#s-rate`, Base latency `#s-latency`, Analysis window `#s-window`, Display range `#s-range`, Live tracker `#s-tracker` "Plain YIN (no lookahead)", Space bar shortcut `#s-space` (a switch, On by default, saved to `centstodollars.space`). Sources in section 7.5.

**How to read this:** "Cents are the distance from the nearest equal-tempered note at your A4. Singers often tune away from equal temperament, so a few cents is not a mistake." / "If the octave looks wrong, compare the orange marks with the lowest strong band in the spectrogram. The live view sometimes jumps an octave; this is a known limit (VALIDATION.md section 4)." / Links to MEASUREMENT.md and VALIDATION.md, labelled "(dev server only, opens raw text)".

**Space bar (FINAL, M1).** On `#/voice` only: `keydown` with `code === 'Space'`, no modifiers, not `repeat`, and the event target is not an input, textarea, select, button, link, summary, radio or contenteditable element. Then `preventDefault()` (no page scroll) and toggle. On a focused button, Space already activates that button, which is why buttons are excluded. The shortcut can be turned off in Setup (WCAG 2.1.4 caution). Reason: she stands away from the keyboard, and Space is the largest key she can reach without looking.

### 3.4 Methods (`#/methods`, deep links `#/methods/calibration`, `/latency`, `/self-test`)

Framed as setup. Nav label "Methods". Eyebrow "Setup". h1 "Methods and setup checks". Lede "Run these once on a new microphone, interface or computer. You do not need them to sing."

- **Calibration** (`#m-cal-*`): purpose, requirements, input `#m-cal-hz`, "Measure for 5 s", running "Measuring, {n} s left". Done: Reference, Median measured (3 decimals, "{count} voiced frames"), Offset (2 decimals), Frame spread P95, Sample rate, and "No pass threshold is set yet." Warning: "Too few voiced frames ({n} of 50 needed). Check that the reference is playing and loud enough."
- **Loopback latency** (`#m-loop-*`): "Speakers on, not headphones. Set the volume low first. Keep this tab visible." "Play 10 test tones", "Tone {i} of 10". Done: Tones detected, Median, Range, Context. "No pass threshold is set yet." Warnings as in revision 1.
- **Self-test** (`#m-self-*`): "Runs the synthetic test files through the same AudioWorklet offline and scores them against the known pitch. Does not use the microphone. Needs the dev server." Progress "File {i} of {total}: {set}". Done: a table with verdicts from the single criteria source (section 7.4). Could not run: "Test files not found at /fixtures/synthetic/. Start the dev server (npx vite) and generate them with py/synth.py." Sets `window.__selfTest = report` on a completed run only.
- **Documents**: MEASUREMENT.md and VALIDATION.md links, "(dev server only, opens raw text)".
- 1280: Calibration and Loopback side by side (6 and 6), Self-test 12, Documents 12. 375: stacked. The self-test table turns into one block per set.

### 3.5 Not found and `#/legacy`

- Not found: h1 "Page not found", "There is no page at this address.", "Go to Overview".
- `#/legacy` (temporary, Phase A until Phase C passes): the current test page markup, moved unchanged into `<section data-route="legacy">`, with its original IDs and its styles scoped under `[data-route="legacy"]`. Not in the nav. Removed after Phase C passes its acceptance criteria.

---

## 4. Uncertainty: when the tracker is wrong or has no answer

- **No answer:** an unvoiced frame produces no number. The last note stays at full strength for `HOLD_FULL_MS`, then it is muted and labelled "Last:". Vibrato and the band ratio say why they are empty. Nothing is interpolated.
- **Wrong answer:** the live path is plain YIN, which slips octaves (VALIDATION.md section 4: 94.36% agreement with Praat, below the 95% criterion). The octave number is shown large. The F0 marks on the spectrogram make a slip visible, and "How to read this" says how to check it.
- **Correction:** a live reading cannot be edited; it is a measurement. She corrects the inputs (A4, the input level through the gate hint, calibration). Correcting saved takes waits for Sessions.
- **Rejected:** a confidence bar from `aperiodicity`, smoothing, and a take summary.

---

## 5. Accessibility baseline (FINAL)

Landmarks and skip link. One h1 per route. On route change: update `document.title` ("Voice analysis | Cents to Dollars"; Overview "Cents to Dollars") and focus the h1. Everything works from the keyboard. Contrast as in section 1.4, focus as in section 1.7, targets at or above `--control-h`. Colour is never the only signal. Live regions: `#readout-announce` (throttled), the mic indicator, check progress and results, input errors through `aria-describedby`. The canvas has `role="img"` and its readings exist as text. Reduced motion and forced colours as in section 1.2. Reflow at 320px, text resize to 200%.

---

## 6. Session ownership (FINAL)

One module, `src/app/live.ts`, owns the microphone. Nothing else calls `startLive`.

1. **State:** `idle | requesting | listening | stopping | stopped | error(kind)`, plus `owner: 'voice' | 'calibration' | 'latency' | null` and a counter `token`.
2. **start({ owner })**
   - In `requesting` or `listening`: return the pending or current session. A double click starts nothing new.
   - In `stopping`: wait for the stop to finish, then start.
   - Otherwise: `const my = ++token`, set the state to `requesting`, `await startLive(...)`.
   - When the result arrives and `my !== token` (a stop or a route change happened meanwhile): call `session.stop()` on the late session at once, drop it, leave the state unchanged. Late rejections with a stale token are ignored.
3. **stop()** is idempotent and returns one shared promise.
   - In `requesting`: `token++` (the late result is then stopped by rule 2) and state `idle`.
   - In `listening`: state `stopping`, `await session.stop()`, state `stopped`, `data-live="off"`.
   - The audio track `ended` event moves the state to `error(ended)` and releases the session.
4. **Checks** each get an `AbortController`. Only one check runs at a time.
   - Calibration: the 5 s wait races the abort signal. On abort the result is Cancelled, no numbers.
   - Loopback: the abort is checked before each tone. On abort the current oscillator stops, the waiter is removed and the result is Cancelled.
   - **Self-test can be cancelled at file boundaries.** An `OfflineAudioContext` render cannot be stopped, so the file in flight finishes and is discarded. A cancelled run never writes `window.__selfTest`, which keeps the last complete report.
   - A check that started the mic (`owner` calibration or latency) stops it when it settles, whatever the outcome.
5. **Router.** On `hashchange` it takes a navigation number `nav = ++navSeq` and runs the leave hooks of the current route in order:
   - leaving `voice`: `await live.stop()`;
   - leaving `methods`: abort the running check, await its settle, `await live.stop()` if a check owns the mic;
   - leaving `legacy`: `await legacy.stopLive()` (an exported function added to the legacy main.ts).

   Only if `nav === navSeq` after the awaits does it show the new route. A faster second navigation wins. While the leave hooks run, the old route stays visible with its button showing "Stopping…".
6. **Entering `voice`:** if no session is `requesting` or `listening` (Overview's "Start singing" may have started one), reset the view: clear the history and the "Last" reading, clear the canvas to `--surface-plot` and show the empty overlay. Otherwise keep the session and start drawing.
7. **Returning to Methods after a cancel:** the block shows "Cancelled because you left the page.", no numbers, and the Run button. Overview shows "Cancelled" for that check.
8. **Deep links while a check runs:** a hash change inside Methods (for example to `#/methods/self-test` while calibration runs) is not a leave. It scrolls to and focuses that panel's heading, and the check keeps running. Other check buttons stay disabled with "Another check is running." A hash change to another route is a leave (rule 5).
9. **themechange:** the spectrogram renderer re-reads `--surface-plot`, `--plot-energy`, `--plot-band` and `--signal` and uses them from the next column. Columns already drawn keep their colours.
10. **Hidden tab:** queues stay capped at the canvas width, as the current main.ts already does.

---

## 7. Hooks for the rewire (no change to `src/dsp/`)

### 7.1 Message shape (FINAL)

The live tracker is **plain YIN**. Checked against the docs as they stand now: MEASUREMENT.md section 1 ("live path … plain YIN, no continuity step") and VALIDATION.md line 13 ("Live (the AudioWorklet): plain YIN"). `DEFAULT_CONTINUITY.lag` is `Infinity` (whole take only). The UI accepts exactly one message, `WorkletFrame` from `src/audio/tracker.worklet.ts`:

`{ type: 'frame', start, readyAt, t, f0 (Hz, 0 when unvoiced), voiced, aperiodicity, rmsDb, eSf, eRef, power? }`

Each frame is final when it arrives. There is no second message and no flush.

### 7.2 Files

`src/app/main.ts` (entry), `router.ts`, `theme.ts`, `fonts.ts`, `live.ts`, `checks.ts`, `criteria.ts`, `readout-constants.ts`, `views/*.ts`. The pure computations from `src/testpage/main.ts` move unchanged. The legacy `src/testpage/main.ts` stays for `#/legacy` with two changes: it loads through a dynamic `import()` on the first visit to `#/legacy`, and it exports `stopLive`.

### 7.3 Element IDs and hooks

New screens use new IDs, so they do not collide with the legacy section, which keeps `a4`, `live-start`, `live-stop`, `live-dot`, `live-status`, `live-readout`, `spectrogram`, `cal-hz`, `cal-run`, `cal-readout`, `loop-run`, `loop-readout`, `self-run`, `self-readout`.

| ID | Element | Replaces (legacy) |
|---|---|---|
| `main`, `[data-route]` | router | none |
| `mic-indicator`, `theme-switch`, `theme-choice` | header, first-visit choice | `live-dot`, `live-status` |
| `ov-start` | Overview primary button | none |
| `va-a4`, `va-a4-dec`, `va-a4-inc`, `va-a4-error` | A4 stepper and its error line | `a4` |
| `live-toggle` | hero toggle, `data-state="idle|busy|live"` | `live-start`, `live-stop` |
| `readout-status` | hero status chip | part of `live-readout` |
| `readout-note`, `readout-acc`, `readout-oct` | note block | part of `live-readout` |
| `readout-last` | "Last:" label | none |
| `readout-dir` | FLAT/SHARP/WITHIN cue | none |
| `readout-cents` | cents chip | part of `live-readout` |
| `cents-meter`, `cents-tol-zone`, `cents-marker` | meter, tolerance zone, marker | none |
| `level-meter` | level bar | none |
| `readout-gate-hint` | "I can't hear you" line | none |
| `readout-error`, `readout-error-details` | error message and its Details | the `live-readout` "Could not start" text |
| `readout-announce` | throttled `role="status"` | `live-readout` `aria-live` |
| `va-spectrogram` | canvas | `spectrogram` |
| `m-pitch`, `m-offby`, `m-vib-speed`, `m-vib-width` | Readings | part of `live-readout` |
| `d-f0`, `d-dev`, `d-vib-p2p`, `d-band`, `d-level`, `d-gate` | Details | part of `live-readout` |
| `s-input`, `s-rate`, `s-latency`, `s-window`, `s-range`, `s-tracker`, `s-space` | Setup disclosure | part of `live-readout` |
| `m-cal-hz`, `m-cal-hz-error`, `m-cal-run`, `m-cal-status`, `m-cal-progress`, `m-cal-results` | Calibration | `cal-hz`, `cal-run`, `cal-readout` |
| `m-loop-run`, `m-loop-status`, `m-loop-progress`, `m-loop-results` | Loopback | `loop-run`, `loop-readout` |
| `m-self-run`, `m-self-status`, `m-self-progress`, `m-self-results` | Self-test | `self-run`, `self-readout` |

**Setup rows: a `data-field` convention.** Every Overview "Technical checks" row and every Tools requirement row is `<div class="kv" data-field="{name}">` with children `.kv-dot`, `.kv-label`, `.kv-value` and an optional `.kv-action`. One function `setField(name, { status, value, action })` updates every element with that `data-field` (Overview and Tools can show the same field). Field names: `mic-permission`, `browser-audio`, `secure`, `a4`, `calibration`, `latency`, `selftest`.

### 7.4 Self-test criteria: one source (FINAL)

The criteria are `THRESH` in `py/score.py`, written to `results/summary.json` under `thresholds` (`tone_median` 5.0, `tone_p95` 15.0, `tone_octave` 0, `vib_rate` 0.3, `vib_extent_rel` 0.1). `src/app/criteria.ts` does `import { thresholds } from '../../results/summary.json'` (Vite named JSON import, so only that key ships) and exports them. It also checks at load that each expected key is a finite number. If one is missing, the self-test shows "Could not run: criteria not found in results/summary.json" and no verdicts. There is no second copy of the numbers. The latency row has no threshold in `thresholds`, so it shows "No threshold". Units: tone values are cents, `vib_rate` is Hz, `vib_extent_rel` is a fraction (shown as a percentage).

### 7.5 Field audit: each Setup, Details and Methods field and its real source

| Field | Source in code | Status |
|---|---|---|
| Input device | `session.stream.getAudioTracks()[0].label` (`src/audio/capture.ts` `LiveSession.stream`) | real |
| Sample rate | `session.ctx.sampleRate` | real |
| Base latency | `session.ctx.baseLatency` (may be undefined: "Not reported by this browser") | real |
| Output latency (loopback context) | `session.ctx.outputLatency` | real |
| Analysis window 2048 samples | `DEFAULT_YIN.bufferSize` (`src/dsp/yin.ts`), import it, do not type 2048 | real |
| Hop 256 | `DEFAULT_HOP` (`src/dsp/analyzer.ts`) | real (used for the span label) |
| Display range 0 to 4 kHz | `SPEC_TOP_HZ` (UI constant, from main.ts) | real UI constant |
| Live tracker "Plain YIN" | no exported value. The worklet only says it in a comment | **needs a code change outside `src/dsp`:** export `LIVE_TRACKER = 'plain-yin'` from `src/audio/capture.ts`. If that is not wanted, remove the `s-tracker` row |
| Voicing gate | `DEFAULT_YIN.silenceDb` | real |
| Input level | `frame.rmsDb` | real |
| A4 | `#va-a4`, default `DEFAULT_A4` (`src/dsp/pitch.ts`) | real setting |
| Tolerance 10 c | `TOLERANCE_CENTS` | **no source**, display constant, needs her number |
| Hold 1000 ms, gate hint 1000 ms | `readout-constants.ts` | **no source**, display constants |
| Vibrato window 2.5 s | UI constant (from main.ts) using `analyzeVibrato` and `DEFAULT_VIBRATO` | real UI constant |
| Band edges | `SF_BAND`, `REF_BAND` (`src/dsp/spectrum.ts`) | real |
| Mic permission | `navigator.permissions.query({ name: 'microphone' })` (may throw: "Not reported by this browser") | real |
| Browser audio | `'audioWorklet' in AudioContext.prototype` | real |
| Secure page | `window.isSecureContext` | real |
| Calibration: 5 s, 50-frame minimum, P95 | constants in `checks.ts` (from main.ts) | real |
| Loopback: 10 tones, 440 Hz, gain 0.3, 1500 ms timeout | constants in `checks.ts` (from main.ts) | real |
| Self-test sets and counts | `fixtures/synthetic/manifest.json` (dev server only) | real |
| Self-test criteria | `results/summary.json` `thresholds` (section 7.4) | real |
| Calibration, latency and self-test results on Overview | in-memory results from `checks.ts`, this visit only | real |
| Helper, storage, "Last used", "Open an audio file", Notes, take summary | none | **removed** |

### 7.6 Bugs to fix in the move (none in `src/dsp/`)

A4 and the calibration frequency are not validated. The canvas is not cleared on a new start. The spectrogram colours are hard-coded (`#fff`, `#E4401B`, `rgba(228,64,27,0.25)`). The calibration and loopback checks leave the mic running after they finish.

---

## 8. Implementation phases

After each phase: code-reviewer on the diff, test-writer against this spec (section 9 for Phase B), a11y-auditor on the built UI. Before Phase A: run the design-review-card (CLAUDE.md).

**Phase A, no audio.** Install the font packages. Tokens per section 1.9. `components.css`. Theme init, switch, first-visit choice, `themechange`. Shell (header, nav, footer, skip link). Hash router with leave hooks and the navigation number. Overview (the `data-field` checks that need no mic), Tools (**CUTTABLE**), Not found. Move the test page to `#/legacy` with its IDs and `window.__selfTest` working. Any automation must now open `/#/legacy` (**OPEN 5**). Exit: `npm run typecheck` passes, and the legacy self-test still runs and sets `window.__selfTest`.

**Phase B, Voice analysis.** `live.ts` with session ownership (section 6) and error mapping. Hero, A4 stepper, Space bar, spectrogram with token colours and halo, Readings, Details, Setup, How to read this. Overview "Start singing". Exit: every criterion in section 9 passes.

**Phase C, Methods.** `checks.ts` with AbortSignals, `criteria.ts`, result blocks, cancellation on leave, deep links. Exit: calibration, loopback and self-test reproduce the legacy page's numbers on the same machine, and `window.__selfTest` is set by Methods. Then remove `#/legacy` and the token aliases.

**Phase D, polish, CUTTABLE.** Loud tilt and shadow pass. Checks at 1280, 375 and 320, reduced motion, forced colours.

---

## 9. Acceptance criteria: Voice analysis (one assertion per row)

"Frame" means a `WorkletFrame` message. Tests can drive `live.ts` with fake frames and a stubbed `startLive`.

| # | Given | When | Then |
|---|---|---|---|
| VA-01 | the route `#/voice` is entered with no active session | the view renders | `#readout-status` text is "Idle" |
| VA-02 | idle | the view renders | `#readout-note` shows "No pitch yet" and no digits appear anywhere in the hero except A4 |
| VA-03 | idle | the view renders | `#live-toggle` text is "Start listening" |
| VA-04 | idle | the view renders | the canvas overlay text is "Not listening. The plot fills from the right when you start." |
| VA-05 | idle | the toggle is clicked and `startLive` is pending | `#readout-status` is "Waiting for permission" |
| VA-06 | requesting | the view renders | `#live-toggle` is disabled with text "Waiting for permission…" |
| VA-07 | requesting | the toggle is clicked again | `startLive` has been called exactly once |
| VA-08 | requesting | the route changes away and `startLive` then resolves | the late session's `stop()` has been called |
| VA-09 | requesting | the route changes away and `startLive` then resolves | `html[data-live]` is "off" |
| VA-10 | idle | `startLive` rejects with `NotAllowedError` | `#readout-status` is "Microphone blocked" |
| VA-11 | denied | the view renders | `#live-toggle` text is "Try again" |
| VA-12 | idle | `startLive` rejects with `NotFoundError` | `#readout-status` is "No microphone" |
| VA-13 | idle | `startLive` rejects with `NotReadableError` | `#readout-status` is "Microphone unavailable" |
| VA-14 | `isSecureContext` is false | the view renders | `#live-toggle` is not shown and the insecure message is shown |
| VA-15 | idle | `startLive` rejects with any other error | `#readout-error-details` contains the error text |
| VA-16 | `startLive` resolved | the view renders | `#readout-status` is "Listening" |
| VA-17 | listening | the view renders | `html[data-live]` is "on" |
| VA-18 | listening, only unvoiced frames so far | the view renders | `#readout-note` shows no note name |
| VA-19 | listening, unvoiced frames with `rmsDb` below `DEFAULT_YIN.silenceDb` for 999 ms | the view renders | `#readout-gate-hint` is hidden |
| VA-20 | the same, for 1000 ms or more | the view renders | `#readout-gate-hint` text is "I can't hear you. Move closer or turn the input up." |
| VA-21 | listening | a voiced frame with f0 = 440 Hz at A4 = 440 arrives | `#readout-note`, `#readout-acc` and `#readout-oct` read "A", "", "4" |
| VA-22 | listening | a voiced frame 20 cents below the nearest note arrives | `#readout-dir` contains "FLAT" |
| VA-23 | listening | a voiced frame 20 cents above arrives | `#readout-dir` contains "SHARP" |
| VA-24 | listening | a voiced frame within `TOLERANCE_CENTS` arrives | `#readout-dir` contains "WITHIN" |
| VA-25 | listening | a voiced frame with deviation −0.4 c arrives | `#readout-cents` shows "0" (not "-0" or "−0") |
| VA-26 | listening | a voiced frame with deviation −12.6 c arrives | `#readout-cents` shows "−13" with U+2212 |
| VA-27 | listening with pitch | the view renders | `#cents-marker` computed width is at least 8px |
| VA-28 | listening with pitch | the view renders | `#readout-dir` and `#readout-cents` computed font sizes are at least 24px |
| VA-29 | listening with pitch | unvoiced frames follow for 999 ms | `#readout-last` is hidden |
| VA-30 | the same, for 1000 ms or more | the view renders | `#readout-last` is visible and `#readout-status` is "No pitch" |
| VA-31 | listening, 2.5 s without vibrato | the view renders | `#m-vib-speed` text is "No vibrato found in the last 2.5 s" |
| VA-32 | listening | A4 is set to 4 in `#va-a4` | `#va-a4-error` is visible |
| VA-33 | the same | the next voiced frame arrives | cents are computed with the previous valid A4 |
| VA-34 | listening | `#va-a4-inc` is clicked at 440 | the value is 441 and `localStorage['centstodollars.a4']` is "441" |
| VA-35 | listening, focus on the page body | Space is pressed | `live.stop()` has been called |
| VA-36 | listening, focus in `#va-a4` | Space is pressed | `live.stop()` has not been called |
| VA-37 | the Space shortcut is off in Setup | Space is pressed on the body | the toggle state does not change |
| VA-38 | listening | the toggle is clicked twice quickly | `session.stop()` has been called exactly once |
| VA-39 | stopping | the view renders | `#live-toggle` is disabled with text "Stopping…" |
| VA-40 | stopped | the view renders | `#readout-status` is "Stopped" |
| VA-41 | listening | the route changes to `#/methods` | the new route is shown only after `stop()` resolves |
| VA-42 | stopped | `#/voice` is entered again | the canvas is cleared and the empty overlay is shown |
| VA-43 | listening | the audio track fires `ended` | `#readout-status` is "Microphone stopped" |
| VA-44 | listening | the theme changes | the next drawn column uses the new `--surface-plot` colour |
| VA-45 | listening | 60 frames with different notes arrive within 1 s | `#readout-announce` changed at most once |
| VA-46 | 1280 × 800 viewport, listening with pitch | the page is at scroll 0 | the bottom of `#live-toggle` is inside the viewport |
| VA-47 | 375 × 667 viewport, listening with pitch | the page is at scroll 0 | the bottom of `#live-toggle` is inside the viewport |
| VA-48 | 320px wide viewport | any state | `document.documentElement.scrollWidth` is at most 320 |
| VA-49 | any state | the view renders | the footer contains "For practice and study. Not a diagnostic or medical device." |

---

## 10. Open questions for the owner

1. **Reduced motion and fades.** Your rule was "no transition when reduced motion is set". `tokens.css` currently keeps 100 to 120ms fades in that mode. The spec sets 0ms. Keep the fades or not?
2. **Tolerance.** "WITHIN ±10 c" has no source. Her number is needed, and possibly a setting later.
3. **Timings.** `HOLD_FULL_MS` and `GATE_HINT_MS` are both 1000 ms. Tune them with her.
4. **The `s-tracker` row.** It needs one exported constant in `src/audio/capture.ts`. Add it, or drop the row?
5. **Automation harness.** Whatever produced `results/browser_selftest.json` must open `/#/legacy` during Phases A and B, and Methods after Phase C. Where does that harness live? I could not find it in the repo.
6. **Glyphs.** Newsreader and Archivo Black need checks for "♯" and tabular figures. If either is missing, use "#" and fixed-width digit boxes.
7. **Device picker** for an audio interface (needs `deviceId` in `capture.ts`). Not in M1 unless she needs it.
8. **Personas.** `docs/research/personas/` does not exist.

Closed in this revision: fonts (self-host with @fontsource), app name (Cents to Dollars), production build (dev server only), live tracker (plain YIN), Space bar (in M1), first-visit theme (ask on Overview).

---

## Changelog (revision 2)

- Principle 1.1.4 rewritten: no change to markup, order or states. Wrappers exist in both themes and are inert in Paper. Dual text variants toggled by CSS. Added the treatment list (1.8) and the token mapping against the current `tokens.css` (1.9). Nothing dropped; four tokens renamed with aliases until Phase C.
- Added section 6, Session ownership (token, late results, double click, stopping, AbortSignals, cancelling self-test at file boundaries, router awaits stop, cancelled-on-return, deep links, `themechange`, canvas clear on entry).
- Section 7 ID table completed with new IDs (no clash with `#/legacy`), plus the `data-field` convention. Tools and the Loud tilt/shadow pass marked CUTTABLE.
- Hero: FLAT/SHARP cue with arrow, marker at least 8px, cue and chip at least 24px, colour never alone. Hold at full strength for `HOLD_FULL_MS` (1000 ms) before dimming. Gate hint copy changed. A4 stepper next to the hero, saved. Tolerance stays a constant.
- No-scroll hero budgets at 1280 × 800 and 375 × 667. Settings moved into a collapsed Setup disclosure. Technical readings moved into Details. Plain labels on the singing screen.
- Space bar in M1, with an off switch. First-visit theme choice on Overview.
- Overview: one "Start singing" button, Technical checks collapsed. Methods framed as setup.
- Live tracker pinned to plain YIN, checked against MEASUREMENT.md and VALIDATION.md. One message shape (`frame`).
- Field audit table (7.5). Self-test criteria imported from `results/summary.json`.
- Phases A to D, `#/legacy` kept until Phase C passes, `window.__selfTest` preserved.
- Section 9: 49 numbered acceptance criteria.
- Owner answers folded in: @fontsource packages and weights, name "Cents to Dollars" (titles, header, h1, storage keys), dev server only.
