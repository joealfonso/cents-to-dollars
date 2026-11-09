# DESIGN.md: Cents to Dollars, M1 screens

Status: spec, not built. Revision 2 (persona review and owner answers folded in, changelog at the end). The engineer builds from this. Settled items are marked **FINAL**, owner questions **OPEN**, and items that can be dropped under time pressure **CUTTABLE**.

For practice and study. Not a diagnostic or medical device. That line appears in the footer of every screen and is never removed.

M1 runs on the dev server only (`npx vite`, owner decision). There is no production build. The document links and the self-test fixtures only exist on the dev server, and the UI says so where it uses them.

## 0. Problem and user

**User.** One classically trained opera singer ("her" in VALIDATION.md section 11), practising alone and unamplified. Opera uses no performance microphone or PA, so she does not sing into a mic. The app hears her through the built-in microphone of the laptop or phone, from wherever the device sits on the stand, while she stands 1 to 2 m from the screen. The tool exists to give her, and other singers, ways to improve. Her voice type and range, the device and its built-in microphone, and her room are unknown (VALIDATION.md section 11). A second user is Joseph, who runs the setup checks on her machine. There are no persona files yet (`docs/research/personas/` does not exist), so the user model comes from VALIDATION.md and from the persona review of revision 1.

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
- `prefers-reduced-motion: reduce`: every `--tilt-*` is `0deg`, every `--dur-*` is `0ms`, `--move-enter` is `0px`, no smooth scrolling. This follows the owner's rule ("no rotation or transition when set"). Today `tokens.css` keeps 100 to 120ms fades under reduced motion. That has to change to 0ms, or the owner confirms that fades are allowed (**OPEN 1**). Superseded by 1.7a ("Reduced motion"), which gives both options and the token mapping.
- `html[data-motion="off"]` (set by the automation harness) stays exactly as it is in `tokens.css` today.
- `forced-colors: active`: status dots and meter fills get a 1px `CanvasText` border. Focus uses `CanvasText`, as in the current `index.html`.

### 1.2a Theme selector removed, Paper only (FINAL, owner decision, revision 2.1)

This section overrides the parts of 1.1 (principle 5), 1.2 (persistence, apply before first paint, theme change event) and 2.1 (theme switch, first-visit choice) that let her choose a theme. Those sections are not rewritten, so read them through this one.

**Decision.** The app always renders `data-theme="editorial"` (Paper). She cannot choose a theme. There is no theme switch in the header or the Nav panel (2.1a), and no first-visit choice on Overview.

**Reason.** Owner decision. It also removes a control from the compact header, which is what lets the closed header shrink to one row (2.1a).

**Reversible on purpose.** The Loud tokens in `tokens.css`, every `:root[data-theme="loud"]` rule in the CSS files, the Loud fonts in `fonts.ts`, and the `.v-loud` dual-text spans stay in the codebase. They are dormant and unreachable. The engineer does not delete them. If Loud comes back, the compact nav needs a Loud pass (2.1a, open question 3).

**What goes.**
- `index.html`: the `<fieldset class="theme-switch" id="theme-switch">` and everything inside it (lines 51 to 57 today).
- `index.html` `<head>`: the inline script that reads `centstodollars.theme` (lines 7 to 11 today). `<html data-theme="editorial">` is already in the markup, so nothing is needed before first paint.
- `src/app/views/overview.ts`: the `#theme-choice` section ("How should it look?", "Paper is calm…", "Keep Paper", "Switch to Loud"), `syncChoice`, the `data-choose` click handlers, the `themechange` listener, the `syncChoice(root)` call in `enter()`, and the import from `theme.ts`.
- `src/app/theme.ts`: the radio wiring. `initTheme()` now sets `data-theme="editorial"` and calls `localStorage.removeItem('centstodollars.theme')` inside try/catch (storage errors are ignored, no message). Nothing reads the key any more. `setTheme`, `hasChosenTheme` and `storedTheme` lose their callers. The engineer may delete them or leave them unexported. Either is fine, because neither changes behaviour.
- CSS for markup that no longer exists: the `.theme-switch` rules in `app.css` (the base block, the compact `.theme-switch` lines, and the two forced-colors lines) and the `.theme-choice` rules in `components.css`. These style a deleted control, not the Loud theme, so they go. The Loud-scoped rules that mention `.theme-switch label` stay dormant with the rest of Loud.
- The `grid-area: theme` slot in every `.header-inner` template (2.1a gives the new templates).
- The `themechange` listener in `voice.ts` stays. It is harmless, and it is part of the dormant Loud path.

**Copy that must change.** I searched `index.html` and `src/app/views/*.ts` for "Loud", "Paper", "look" and "theme".

| Where | Today | Change |
|---|---|---|
| `src/app/views/about.ts` line 98 (privacy) | "The only things the site keeps are your choice of look, Paper or Loud, your tuning reference, and whether the space bar starts and stops listening, saved in this browser so they are there next time." | "The only things the site keeps are your tuning reference and whether the space bar starts and stops listening, saved in this browser so they are there next time." |
| `src/app/views/overview.ts` lines 37 to 43 | the "How should it look?" panel | deleted (above) |
| `index.html` lines 51 to 57 | "Theme", "Paper", "Loud" | deleted (above) |
| `src/app/views/about.ts` line 76, `voice.ts` lines 79 and 166 | `.v-paper` / `.v-loud` dual text | no change. Only the Paper text shows. The Loud spans are dormant |
| `about.ts` lines 60 and 67, `index.html` lines 212, 224 and 231 | "looks", "Quiet to loud", "lookahead" | no change. They do not mention the theme |

**Tests.** `tests/app.theme.test.ts` tests the behaviour from 1.2 that this section removes (stored theme read, default when absent). That is a spec change, not a failing test. test-writer rewrites it against THM-01 to THM-05 in 2.1a. Nobody edits it just to make it pass.

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

The cue, the chip and the tolerance text are at least 24px in every theme and at every width (persona review item 4). On Voice under 600, the cue word and the cents chip are 40px (3.6, revision 2.3a).

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

**Superseded in Paper (revision 2.3):** `--gap-panel`, `--strip-pad` and `--row-pad` give way to `--sec-gap`, `--sec-head-pad`, `--group-gap`, `--item-gap` and `--row-pad-y`, and compact type gets denser values. See 1.10 and the token table in 3.6. Phone landscape (height 500 or less) has its own layout in 3.6.

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
| `--dur-*`, `--ease-*`, `--move-enter`, `--btn-*-shift` | see 1.7a | see 1.7a |

Motion rules, tokens and the full never-animated list are in 1.7a. Never animated: readout digits, cue, chip, meter marker, level bar. Entrance animations (`--dur-enter`) never apply to the hero or the canvas. Transforms can create scrollable overflow, so the page wrapper gets `overflow-x: clip` and tilts stay at or below 1deg.

Focus: `outline: var(--focus-w) solid var(--focus); outline-offset: var(--focus-offset)` on `:focus-visible`, keeping the transparent-at-rest pattern from the current `index.html`. Headings that take focus from script (route h1, About and Methods section titles) follow 3.6 "Route focus": a ring only when the keyboard caused the navigation.

### 1.7a Motion standards (revision 2.2)

Status: built (revision 2.2). Rules marked **FINAL** are decided. **OWNER** marks the owner's call. This section is the single source for motion in the app. It overrides the motion notes in 1.2 (reduced motion), 1.7 (the motion row and "Never animated"), 1.9 (the motion token rows) and 2.1a (Motion); each of those now points here. It does not cover `#/legacy`, which another session owns under `design/motion-testpage.md`.

**User and problem.** The singer from section 0, mid-song, reading the screen from 1 to 2 m, often on a phone; and Joseph checking setup. The owner says the Nav panel (2.1a) opens "way too fast and sharp". The cause is visible in the code. The panel runs `--dur-base` (220ms) on `--ease-enter`, `cubic-bezier(.16, 1, .3, 1)`. Computed from that curve, about two thirds of the movement happens in the first 15% of the time, roughly the first 34ms, so the panel snaps. And the 245px of page under it jumps at once, because nothing animates the height. The wider problem: no rule ties timing to size. A 3px bar on About runs 680ms with an overshoot while the 245px Nav panel runs 220ms. Small things are heavy and large things are light, the wrong way round.

**Decision.** Four size classes (micro, small, medium, large), each with fixed tokens for enter duration, exit duration, easing and distance. An element's class comes from its rendered size. Larger classes are longer and start and land softer. Exits are about two thirds of enters. The readout never moves.

#### Principles (FINAL)

1. **Motion explains a change she caused**: what opened, where it came from, where it went. It is never decoration and never asks for her attention.
2. **The readout never animates and never waits.** The note, cue, cents chip, meter marker, level bar, status chip, gate hint, the hold dim and the spectrogram change on the frame the data arrives, with no transition. When they move, the movement is the data.
3. **Nothing moves on its own during a live reading.** While `html[data-live="on"]`, motion only runs in answer to her own input. Nothing starts by itself, nothing loops, and nothing animates layout (height), because layout work on every frame competes with the hero's rAF redraw on a phone.
4. **Mass follows size.** Large elements take longer, start slowly and land softly. Small elements are quick and light. Exits are faster than entrances: once she has closed something, it gets out of the way.
5. **Feedback first, motion second.** Press, focus and toggled states show on the same frame. Any motion that follows comes after she already has the answer.
6. **Transform and opacity only.** Layout is animated only through the two reveal patterns below.
7. **Reduced motion means no motion** (recommended, OWNER, see "Reduced motion").
8. **An element the user just dismissed leaves instantly; only what arrives animates.** Exits still apply to things that stay in view, like the Nav panel closing. A route change is the main case: the old view goes at once and only the new one moves, so the two never overlap (FINAL, coordinator).

#### Mass model (FINAL)

**Measure.** S = √(width × height) of the box that moves, in CSS px, at rest (fully open), at 375 × 667. One class per element at every width, so a component behaves the same on a phone and a laptop.

| Class | S | Area | Examples in this app | Enter | Exit | Enter easing | Exit easing | Distance |
|---|---|---|---|---|---|---|---|---|
| micro | under 32px | under 1,024 px² | link underline, nav underline, dot, chevron, arrow glyph, toc ink (opacity) | 120ms (100 to 140) | 80ms | `--ease-standard` | `--ease-standard` | 0 to 4px |
| small | 32 to 119px | 1,024 to 14,399 px² | chip, button, Nav button, toc ink glide (stepped up, rule 2) | 180ms (140 to 250) | 120ms | `--ease-decelerate` | `--ease-accelerate` | 6px |
| medium | 120 to 269px | 14,400 to 72,899 px² | list row, paragraph, panel content block | 300ms (250 to 340) | 200ms | `--ease-decelerate` | `--ease-accelerate` | 8px |
| large | 270px and up | 72,900 px² and up | Nav panel (375 × 245, S ≈ 303), disclosures, About "more" body, route view | 480ms (340 to 560) | 320ms | `--ease-settle` | `--ease-accelerate`; a collapse that moves content below uses `--ease-standard` | 12px |

**Formula behind the table.** Enter ≈ 100 + 1.25 × S ms, clamped to 100 to 560ms. At the class reference sizes S = 16, 64, 160 and 304 it gives 120, 180, 300 and 480ms, which are the tokens. Exit = two thirds of enter, rounded to 10ms (80, 120, 200, 320). Duration grows with the square root of the moving area. The ranges in brackets are the formula across each band; they explain the classes, they are not values to pick from. The engineer uses the class tokens and never computes a duration at runtime.

**Rules for choosing a class.**
1. Measure S at 375 wide, at rest. Look up the class. Use its tokens.
2. **Glides step up.** If the element translates more than 64px, use the next class up. Never more than one step.
3. **Parts tied to a parent's geometry use the parent's class**, for example a bar that grows with a body's height, or a rule at the edge of a sliding body.
4. **A shared component takes the class of its largest common instance**, so it behaves the same on every page. `.disclosure` is large: Technical checks (7 rows) and the Voice Details and Setup bodies are each about 343 × 300px at 375 (S ≈ 320, estimated from the row height; the engineer measures).
5. **Colour, fill and outline changes are feedback, not motion.** The hover and focus rules apply, not the class table.
6. **Thin lines (4px or less thick) that draw or scale in place are micro** whatever their length. A line has almost no mass. Rule 2 still applies when a line glides from one place to another.

The brief listed the arrow nudge under small. By rule 1 it is micro: the arrow glyph is about 10 × 18px (S ≈ 13). With button timing a 4px glyph would trail the hover. Its distance stays 4px, the top of the micro range.

#### Easing tokens (FINAL)

| Token | Value | Use | Shape (computed from the curve) |
|---|---|---|---|
| `--ease-standard` | `cubic-bezier(.2, 0, 0, 1)` (unchanged) | micro, in-place changes (rotate, scale of a line), and collapses that move content below | eases in and out |
| `--ease-decelerate` | `cubic-bezier(.2, .65, .25, 1)` | enter, small and medium | half the travel in the first 16% of the time. The current `--ease-enter` covers two thirds in 15% |
| `--ease-accelerate` | `cubic-bezier(.3, 0, .8, .15)` | exit: fading out, moving away | 18% of the travel at 54% of the time, then speeds up |
| `--ease-settle` | `cubic-bezier(.32, .1, .12, 1)` | enter, large | starts slowly (26% of the travel at 19% of the time), then lands over a long tail (80% at 46%, the last 20% over the remaining 54%). The slow start is the inertia; the tail is the soft landing |

**No overshoot in Paper.** Overshoot reads as play, and the eye goes to it. On a 4px nudge it cannot be seen anyway. On a large panel it is a wobble next to the readout. `--ease-spring` stays equal to `--ease-standard` in Paper, and `--ease-spring-soft` (y up to 1.4) leaves app code. If Loud returns, it may use `--ease-spring` on small elements only, with no control point above 1.3.

#### Properties and reveal patterns (FINAL)

Animate `transform` and `opacity`. Allowed exceptions, each named:
- Colour (`color`, `background-color`, `border-color`) on the hover exit only (see "Hover, focus and press").
- `background-size` for the `a.link` underline draw. A gradient is the only way to draw under text that wraps onto two lines. It is a 2px paint.
- `clip-path` for line draws (`.am-wave`).
- Height, through these two patterns only:

**Pattern A, in-flow panel (the Nav panel).** The panel is a one-column grid whose only child has `min-height: 0` and `overflow: clip`. Closed: `grid-template-rows: 0fr` and `visibility: hidden`, which takes it out of the tab order and the accessibility tree. Open: `1fr` and `visible`. `grid-template-rows` transitions on `--dur-reveal-in` and `--ease-settle` when opening, and on `--dur-reveal-out` and `--ease-standard` when closing, so the page below lands softly. Visibility changes at once on open, and at the end of the exit on close (`visibility 0s` with a delay equal to the exit duration). The child list fades in and slides from `translateY(calc(-1 * var(--move-large)))`. This works in every current engine, needs no measuring script, and reverses mid-way.

**Pattern B, `<details>`.** `::details-content` from `height: 0` to `auto` inside `@supports (interpolate-size: allow-keywords)`, as `components.css` does today, on `--dur-reveal-in` / `--dur-reveal-out`. Where it is not supported, the disclosure opens instantly. That is acceptable, because the content is the same.

**Out-of-flow overlays** (none today): `clip-path: inset()` or translate, plus a fade. Never height.

Never: `max-height` with a pixel guess, animated `width`, `margin`, `padding`, `top` or `left`, or scale on a box that contains text. One allowed case: the 1px `margin-bottom` on `details.disclosure > summary`, which moves with its body (rule 3).

`--dur-reveal-in` and `--dur-reveal-out` exist only for height. They equal the large tokens, and they are 0ms while `html[data-live="on"]` (principle 3). While live, the Nav panel and disclosures open with an instant layout change, and their contents still fade and slide.

#### Stagger (FINAL)

- Step `--stagger-step` 40ms. Cap `--stagger-max` 120ms: item 1 at 0, item 2 at 40, item 3 at 80, items 4 and later at 120.
- Only small or medium children that enter at her request (today: the About "more" paragraphs). A large element never staggers its children. The Nav rows move as one mass, because a stagger would add 120ms to the most frequent action in the app.
- No stagger while live (`--stagger-step` 0ms).

#### Hover, focus and press (FINAL)

- **Focus ring:** 0ms in and out. It shows on the frame focus arrives (WCAG 2.4.7). The transparent-at-rest outline stays, with no transition on `outline-*`.
- **Press (`:active`), toggled fills (the open Nav button), `aria-current`:** 0ms.
- **Hover colour or fill:** 0ms in, `--dur-micro-out` (80ms) `--ease-standard` out. Arriving is instant. Leaving leaves a short trail, so a thumb or cursor crossing rows does not flicker.
- **Motion caused by hover or focus** (underline draw, arrow nudge, wave): starts with no delay, on its class's enter token, and returns on its exit token. No `transition-delay` on hover anywhere. Hover motion sits behind `@media (hover: hover)`. `:focus-visible` gets the same motion, so keyboard users see what mouse users see.

#### Interruptions (FINAL)

- Anything she can toggle uses CSS transitions, not keyframe animations. A transition reverses from where it is, and the browser shortens the reversed transition in proportion to the distance covered. The current `nav-open` keyframe cannot reverse, so it goes.
- The attribute is the truth (`aria-expanded`, `open`, `aria-current`) and changes at once. Focus, ARIA and state never wait for `transitionend` or `animationend`.
- An entering element can be used from its first frame. An exiting element gets `pointer-events: none` from the start of its exit, so a tap never lands on a row that is leaving.
- No queueing: rapid toggles reverse the running transition, and the last state wins.
- Route changes: `router.ts` already skips the transition when a newer navigation starts. Keep that. It also skips it under reduced motion, `data-motion="off"` and while live, so those swap instantly.
- Closing the Nav panel by choosing a link is instant, with no exit. The route transition is the motion, and two in a row feel slow (as 2.1a decided). Closing with the Nav button, Escape or an outside tap plays the exit.

#### Never animated (FINAL)

On Voice analysis: the note block, `#readout-dir`, `#readout-cents`, the `#cents-meter` marker and tolerance zone, `#level-meter` and its fill (set per frame in `voice.ts`), `#readout-gate-hint`, `#readout-last` and the hold dim, the status chip, `#va-spectrogram`. Also the Methods result block bars (`.m-check[data-state]::before`) in every state, because calibration and loopback run with the mic on. Error and permission messages appear at once, never faded in, because they carry information.

#### Reduced motion (OWNER, resolves OPEN 1)

**Option A, recommended: no motion at all.** `--rm-dur` 0ms. Every `--dur-*` and `--stagger-*` token is 0ms, every `--move-*` token is 0px, tilts are 0deg, the router skips view transitions (it already does), and smooth scrolling becomes `auto` (`about.ts` already does this). Rotations (chevrons) are set to `transition: none` in their own rules, as `app.css` and `about.css` do today. What remains: instant state changes, which are never late.
Reasons: it is the owner's own rule ("no rotation or transition when set"). `theme.css` already behaves this way. Every state change in this app is also carried by text or shape, so a fade adds no information.

**Option B: opacity only, micro length.** `--rm-dur` 120ms. Every `--dur-*-in` token maps to `var(--rm-dur)`, every `--dur-*-out` token to 80ms, and every `--move-*` to 0px, so only opacity and colour still change, over at most 120ms. `--dur-reveal-*` stay 0ms (height is motion). Rotations stay `transition: none`. Reason to choose it: a fade softens the 245px push when the Nav panel opens, and fades are not vestibular motion.

Switching from A to B is six lines in the reduced-motion block of `theme.css`: `--rm-dur` to 120ms, and the five `--dur-*-out` tokens to 80ms. Nothing else changes.

#### Tokens (FINAL)

New tokens go in the Paper block of `theme.css` (the Phase A layer), so `tokens.css` and the legacy values stay untouched. Same values in the dormant Loud block.

| New token | Value | Live on | Reduced motion (A) | Replaces in app code |
|---|---|---|---|---|
| `--dur-micro-in` / `--dur-micro-out` | 120ms / 80ms | same | 0ms | `--dur-fast`; `--dur-base` on chevrons |
| `--dur-small-in` / `--dur-small-out` | 180ms / 120ms | same | 0ms | `--dur-base` on small things |
| `--dur-medium-in` / `--dur-medium-out` | 300ms / 200ms | same | 0ms | `--dur-base` and `--dur-slow` on content |
| `--dur-large-in` / `--dur-large-out` | 480ms / 320ms | same | 0ms | `--dur-enter`, `--dur-slow` on panels and views |
| `--dur-reveal-in` / `--dur-reveal-out` | `var(--dur-large-in)` / `var(--dur-large-out)` | **0ms** | 0ms | height and grid-row durations |
| `--move-micro` / `--move-small` / `--move-medium` / `--move-large` | 4 / 6 / 8 / 12px | same | 0px | `--move-enter`; the literal 4px and 10px |
| `--ease-standard` | unchanged | | | kept |
| `--ease-decelerate`, `--ease-accelerate`, `--ease-settle` | as above | | | `--ease-enter`, `--ease-spring-soft` |
| `--stagger-step` / `--stagger-max` | 40ms / 120ms | **0ms** | 0ms | `--stagger` |
| `--rm-dur` | 0ms (A) | | | kept, now the reduced-motion switch for every new token |

**Old names are frozen, not aliased.** `--dur-fast`, `--dur-base`, `--dur-enter`, `--dur-slow`, `--dur-tune`, `--dur-sweep`, `--dur-done`, `--stagger`, `--ease-enter`, `--ease-spring`, `--ease-spring-soft` and `--move-enter` keep their current values in `tokens.css` and `theme.css`. Only `legacy.css` uses them after this change. Reason: an alias would retime `#/legacy`, which another session owns. `--btn-hover-shift` and `--btn-press-shift` stay as distances inside the dormant `:root[data-theme="loud"]` rules. The old names are removed with `#/legacy` after Phase C. `html[data-motion="off"]` sets every new token to 0ms or 0px as well, and the global `!important` rule in `app.css` stays.

#### Audit: every animation in the app

Durations are Paper (`editorial`) values. "Hover" means hover or focus-visible.

| # | File, selector or function | Property | Now | Class | New |
|---|---|---|---|---|---|
| 1 | `app.css` `#nav-toggle[aria-expanded="true"] ~ #site-nav`, `@keyframes nav-open` | opacity, translateY −8px (keyframe); height not animated, so the page jumps | 220ms, `.16,1,.3,1`, open only; close instant | large (S ≈ 303) | Pattern A. Open: grid rows `--dur-reveal-in` 480ms settle; list transform 480ms settle from −12px; list opacity 300ms standard. Close (Nav button, Escape, outside tap): grid rows 320ms standard; opacity 120ms accelerate; transform 320ms accelerate to −12px. Close by link: instant. Keyframe removed. While live: grid rows 0ms |
| 2 | `app.css` `.nav-toggle-icon` | rotate 180° | 120ms standard | micro | 120ms in (open), 80ms out (close), standard |
| 3 | `app.css` `.nav-toggle`, `:hover`, `[aria-expanded="true"]` | background, colour | none (instant) | feedback | hover 0ms in, 80ms out; open fill 0ms |
| 4 | `app.css` `::view-transition-new(route)`, `route-rise` and `route-fade` | opacity, translateY 8px | 440ms, `.16,1,.3,1` | large | transform 480ms settle from 12px; opacity 300ms (`--dur-medium-in`) decelerate, visible from the first frames. None under reduced motion, `data-motion="off"` or live (the router skips the transition) |
| 5 | `app.css` `::view-transition-old(route)` | opacity | 220ms standard | dismissed (principle 8) | no animation: opacity 0 from the first frame, so the old view never overlaps the new one |
| 6 | `app.css` `::view-transition-group(route)`, `(footer)` | size and position | 440ms, `.16,1,.3,1` | large | 480ms settle |
| 7 | `links.css` `a.link` underline | background-size (draw in from left, retract right) | 440ms, `.16,1,.3,1` | micro (thin line, rule 6) | 120ms in, 80ms out, standard |
| 8 | `links.css` `a.link` | colour | 120ms standard both ways | feedback | 0ms in, 80ms out |
| 9 | `links.css` `a.link .arrow`, `a.btn .arrow` | translateX 4px | 220ms, `.16,1,.3,1` | micro (S ≈ 13) | 120ms in, 80ms out, standard, `--move-micro` 4px |
| 10 | `links.css` `.nav a::after` (600px and up) | scaleX underline | 220ms, `.16,1,.3,1` | micro | 120ms in, 80ms out, standard |
| 11 | `links.css` Loud `a.link`, Loud `.nav a` | background-size | 220ms, `.16,1,.3,1` | micro | dormant (1.2a). Migrate to the micro tokens only if Loud returns |
| 12 | `components.css` `.btn` | background-color, colour, box-shadow | 120ms standard | feedback | 0ms in, 80ms out |
| 13 | `components.css` `.btn` transform (Loud press and hover shift) | translate | 120ms `--ease-spring` | small | dormant. Base rule moves to `--dur-small-in`, standard |
| 14 | `components.css` `details.disclosure > summary::after` | rotate chevron | 220ms standard | micro | 120ms open, 80ms close, standard |
| 15 | `components.css` `details.disclosure::details-content` | height, opacity, content-visibility | height 440ms `.16,1,.3,1`; opacity 220ms standard | large (rule 4) | Pattern B. Open: height 480ms settle; opacity 300ms standard. Close: height 320ms standard; opacity 120ms accelerate; content-visibility matches height. While live: height 0ms |
| 16 | `components.css` `details.disclosure > summary` | margin-bottom 1px | 440ms, `.16,1,.3,1` | large (rule 3) | 480ms settle open, 320ms standard close |
| 17 | `components.css` `details.disclosure > summary::before` | opacity of the rule | in 220ms, out 440ms, standard | micro in, large out (rule 3) | in 120ms standard; out 320ms standard (fades with the slide) |
| 18 | `about.css` `.about-more::details-content` | height, content-visibility | 680ms, `.16,1,.3,1` | large (body about 343 × 260, S ≈ 299, estimate) | as row 15. If the engineer measures S under 270 for every instance, medium: 300ms / 200ms |
| 19 | `about.css` `.about-more::before` | scaleY of the 3px side bar | 680ms, `.16,1,.3,1` | same as its body (rule 3) | 480ms settle open, 320ms standard close |
| 20 | `about.css` `.about-more[open] .about-more-body > *`, `am-rise` | opacity, translateY 10px, stagger 70ms | 680ms, `.16,1,.3,1` | medium (paragraph) | 300ms decelerate, 8px, delays 0, 40, 80ms. While live: no stagger |
| 21 | `about.css` `.am-wave` | clip-path draw | 680ms, `.16,1,.3,1` | micro (8px line, rule 6) | 120ms in, 80ms out, standard |
| 22 | `about.css` `.am-wave path` | scaleY flatten on open | 680ms `--ease-spring-soft` (overshoot) | micro | 120ms standard, no overshoot |
| 23 | `about.css` `.about-more > summary::after` | rotate and 2px hover nudge | 220ms `--ease-spring-soft` | micro | 120ms in, 80ms out, standard |
| 24 | `about.css` `.about-more > summary` (Paper) | padding-left, colour | 220ms standard | feedback | padding-left: remove the transition (layout property, and nothing changes the padding). Colour: 0ms in, 80ms out |
| 25 | `about.css` `.about-toc-chip` | colour | 220ms standard | feedback | 0ms in, 80ms out |
| 26 | `about.css` `.about-toc-ink`, set by `wireToc` in `about.ts` | translateX and scaleX glide | 680ms `--ease-spring-soft` (overshoot) | small (thin line, glide over 64px, rule 2) | 180ms decelerate, no overshoot |
| 27 | `about.css` `.about-toc-ink` | opacity | 220ms standard | micro | 120ms in, 80ms out. Built: 120ms both ways, because `about.ts` sets the opacity inline and CSS cannot tell in from out. Accepted (coordinator) |
| 28 | `about.ts` `wireToc`: `toc.scrollTo` and `section.scrollIntoView` with `behavior: 'smooth'` | scroll | browser-defined | not tokenised | keep; only on her tap; `auto` under reduced motion (already) |
| 29 | `voice.ts` level fill (`el.levelFill.style.transform`, per frame) | transform | no transition | never animated | stays 0ms. Must not lag the data |
| 30 | Voice hero readout, cue, chip, meter, hint, hold dim, status chip, spectrogram (`voice.css`, `voice.ts`) | none | none | never animated | stays none |
| 31 | `methods.css` `.m-check[data-state]::before` | none (static bar) | none | never animated | stays none |
| 32 | `overview.css` | none | none | | uses the shared disclosure (row 15) and buttons (row 12) |
| 33 | `legacy.css`, all `[data-route="legacy"]` rules (buttons, focus, tips, live dot, state bars, entrance, setup, toggle, tune line, swap, note arrive, reveal, cards), and `src/testpage/main.ts` | many | old tokens | **owned by another session** (`design/motion-testpage.md`) | not changed. Keeps the frozen old tokens. That session may adopt 1.7a |
| 34 | `app.css` `html[data-motion="off"]` rule; `theme.css` and `tokens.css` reduced-motion blocks | switches | | | kept. Add the new tokens to both switches |

#### States

| State | Motion | Status |
|---|---|---|
| Idle, mic off | as the audit table | FINAL |
| Live (`data-live="on"`) | no height animation, no stagger, nothing starts without her input, nothing loops; the readout never animates | FINAL |
| Mid-animation toggle | the transition reverses from where it is, shortened | FINAL |
| Nav closed by a link | instant, route transition plays | FINAL |
| Reduced motion | Option A: everything instant | OWNER |
| `data-motion="off"` | everything instant (automation) | FINAL |
| No `interpolate-size` (disclosures) or no View Transitions (routes) | instant open or swap, same content | FINAL |
| Forced colours | motion unchanged; colours as in 1.2 | FINAL |
| Error, permission denied, loading | messages appear at once, never faded | FINAL |
| Script failed | CSS transitions still run on hover; nothing depends on script for motion | FINAL |

#### Rejected alternatives

- **Durations computed per element at runtime from its measured size.** They would vary with width and content, cannot be tested against fixed values, and need script. Four classes of tokens can be tested.
- **Spring physics** (a JS spring, or a spring sampled into `linear()`). Springs overshoot, and a long `linear()` point list cannot be reviewed by eye. `--ease-settle` gives mass with no bounce.
- **Keep the keyframe and only lengthen it.** The page below would still jump 245px, and a keyframe cannot reverse.
- **Alias the old tokens to the new values.** It would retime `#/legacy`, which another session owns.
- **Stagger the Nav rows.** It adds 120ms to the most frequent action, and the panel reads as one object.
- **Animate the Nav close after a link tap.** Two motions back to back, which 2.1a already rejected.

#### Acceptance criteria (one assertion each)

Paper, live off, no reduced motion, unless stated. Token values are read with `getComputedStyle(document.documentElement).getPropertyValue(name).trim()`. Durations and easings are read from the element's computed `transition-duration` / `transition-timing-function` for the named property, or from `getAnimations()` effect timing. Browsers serialise curves as `cubic-bezier(0.2, 0, 0, 1)`; compare numerically.

- **MOT-01** At 375 and 1280, the eight `--dur-{micro,small,medium,large}-{in,out}` tokens are 120, 80, 180, 120, 300, 200, 480 and 320ms.
- **MOT-02** `--ease-standard`, `--ease-decelerate`, `--ease-accelerate` and `--ease-settle` equal `cubic-bezier(.2,0,0,1)`, `(.2,.65,.25,1)`, `(.3,0,.8,.15)` and `(.32,.1,.12,1)`.
- **MOT-03** `--move-micro`, `--move-small`, `--move-medium` and `--move-large` are 4, 6, 8 and 12px, and `--stagger-step` and `--stagger-max` are 40 and 120ms.
- **MOT-04** For each class, the `-out` token is less than the `-in` token.
- **MOT-05** At 375, after the Nav button is clicked open, `#site-nav` has a `grid-template-rows` transition of 480ms with `--ease-settle`.
- **MOT-06** At 375, opening the panel gives its list a transform transition of 480ms on `--ease-settle`, starting from `translateY(-12px)`.
- **MOT-07** At 375, opening the panel gives its list an opacity transition of 300ms on `--ease-standard`.
- **MOT-08** At 375, closing with the Nav button gives `#site-nav` a `grid-template-rows` transition of 320ms on `--ease-standard`.
- **MOT-09** At 375, closing with the Nav button gives the list an opacity transition of 120ms on `--ease-accelerate`.
- **MOT-10** At 375, `#site-nav` has `pointer-events: none` from the first frame of a close.
- **MOT-11** At 375, clicking a panel link leaves `#site-nav` with no running transition and `visibility: hidden` within one animation frame.
- **MOT-12** At 375, closing the panel 100ms after opening it starts the close from the current height: the change in `#site-nav` height between the frame before the click and the frame after it is no larger than the largest change between two consecutive frames of the opening animation before the click.
- **MOT-13** `@keyframes nav-open` is not defined in any app stylesheet.
- **MOT-14** `.nav-toggle-icon` has a transform transition of 120ms when opening and 80ms when closing, both on `--ease-standard`.
- **MOT-15** On every focusable element in the app (not `#/legacy`), no computed transition includes an `outline` property with a duration above 0ms.
- **MOT-16** On every app element, every computed `transition-delay` that applies on hover or focus is 0s.
- **MOT-17** `a.link` hovered has a `background-size` transition of 120ms on `--ease-standard`, and 80ms after the pointer leaves.
- **MOT-18** `a.link` hovered has a colour transition of 0ms, and 80ms after the pointer leaves.
- **MOT-19** `a.link .arrow` hovered has a transform transition of 120ms on `--ease-standard` and ends at `translateX(4px)`.
- **MOT-20** At 1280, `.nav a::after` hovered has a transform transition of 120ms on `--ease-standard`.
- **MOT-21** `.btn` hovered has a `background-color` transition of 0ms, and 80ms after the pointer leaves.
- **MOT-22** Where `interpolate-size` is supported, opening `details.disclosure` gives `::details-content` a height transition of 480ms on `--ease-settle`.
- **MOT-23** Where `interpolate-size` is supported, closing `details.disclosure` gives `::details-content` a height transition of 320ms on `--ease-standard`.
- **MOT-24** `details.disclosure > summary::after` has a transform transition of 120ms on open and 80ms on close.
- **MOT-25** During a route change, `::view-transition-new(route)` has a transform animation of 480ms on `--ease-settle` starting at `translateY(12px)`, and an opacity animation of 300ms on `--ease-decelerate` starting at 0.
- **MOT-26** During a route change, `::view-transition-old(route)` has no animation and computed opacity 0 from the first frame.
- **MOT-26a** With `data-live="on"`, a route change produces no `::view-transition-*` animation.
- **MOT-27** Opening an `.about-more` gives `.about-more::before` a transform transition of 480ms on `--ease-settle`.
- **MOT-28** Opening an `.about-more` runs `am-rise` on its body children for 300ms on `--ease-decelerate`, with delays of 0, 40 and 80ms.
- **MOT-29** `.about-toc-ink` has a transform transition of 180ms on `--ease-decelerate`.
- **MOT-30** No computed transition or animation timing function on any app element (not `#/legacy`) is a `cubic-bezier` with a y value above 1 or below 0.
- **MOT-31** No app animation (not `#/legacy`) has a delay above 120ms.
- **MOT-32** On `#/voice`, idle and live, every element listed in "Never animated" has all computed `transition-duration` values at 0s and an empty `getAnimations()`.
- **MOT-33** On `#/methods`, `.m-check::before` has an empty `getAnimations()` and 0s transitions in the working, done and error states.
- **MOT-34** With `data-live="on"`, `--dur-reveal-in`, `--dur-reveal-out` and `--stagger-step` are 0ms.
- **MOT-35** With `data-live="on"`, opening the Voice Details disclosure starts no height transition.
- **MOT-36** With `data-live="on"` and no input for 5 s on `#/voice`, `document.getAnimations()` returns no animation outside `#/legacy`.
- **MOT-37** Under `prefers-reduced-motion: reduce`, every `--dur-*` and `--stagger-*` token is 0ms and every `--move-*` token is 0px (Option A).
- **MOT-38** Under `prefers-reduced-motion: reduce`, opening the Nav panel, opening a disclosure, changing route and tapping a toc chip produce an empty `document.getAnimations()`.
- **MOT-39** With `html[data-motion="off"]`, every `--dur-*` and `--stagger-*` token is 0ms.
- **MOT-40** No stylesheet in `src/styles/` other than `legacy.css`, `tokens.css` and `theme.css` references `--dur-fast`, `--dur-base`, `--dur-enter`, `--dur-slow`, `--stagger`, `--ease-enter`, `--ease-spring-soft` or `--move-enter`.
- **MOT-41** No app stylesheet (not `legacy.css`) lists `height`, `max-height`, `width`, `margin`, `padding`, `top` or `left` in a `transition` or keyframe, except `height` on `::details-content`, `grid-template-rows` on `#site-nav`, and `margin-bottom` on `details.disclosure > summary`.
- **MOT-42** On `#/legacy`, `--dur-base` is 220ms, `--dur-enter` 440ms and `--ease-enter` `cubic-bezier(.16,1,.3,1)`, unchanged.

#### Open questions

1. **Reduced motion (OWNER, OPEN 1 in section 10).** Option A (nothing moves) or Option B (opacity-only fades up to 120ms). I recommend A.
2. **NAV-07 and Pattern A. Resolved (coordinator).** NAV-07 is amended: the closed panel is rendered at zero height with `visibility: hidden` and `inert`, out of the tab order and the accessibility tree.
3. **Is 480ms right for the Nav panel?** It comes from the formula, not from watching her use it. Cheap to change (one token). Try 420, 480 and 560 on a phone with the owner. No research needed.
4. **Sizes are estimates.** The S values for the disclosures and About "more" bodies come from row heights and type tokens. The engineer measures at 375. Only row 18 could change class.
5. **`#/legacy`.** It keeps its own motion until Phase C removes it. Whether its session adopts 1.7a is that session's call.

### 1.8 Theme treatment list (the only per-theme differences besides token values)

| Component | Paper | Loud |
|---|---|---|
| Nav active item | `--signal` 2px underline and 6px square | ink block, `--on-ink` text |
| Not-built tag | text only, muted | dashed 2px ink border |
| Panel strip | transparent, ink bottom border. **Superseded in Paper by 1.10:** no strips; tier-1 section heads | ink fill, `--on-ink` text |
| Cents unit | `.v-paper` "c" | `.v-loud` "CENTS" |
| Plot frame `.plot-frame` | inert | `--accent-2` fill, 16px padding, 4px border, `--shadow-panel`, `--tilt-b` |
| Hero panel | ruled, no tilt. **Superseded by 1.10:** `--panel` surface with no border, full-bleed at compact (3.6) | `--shadow-panel`, `--tilt-a` |
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
| `--dur-fast`, `--dur-base`, `--dur-enter`, `--dur-sweep`, `--dur-done`, `--stagger` | kept | reduced-motion values change to 0ms (OPEN 1). Superseded by 1.7a: frozen for `#/legacy`, app code moves to the 1.7a tokens |
| `--ease-standard`, `--ease-enter`, `--ease-spring` | kept | see 1.7a: `--ease-enter` and `--ease-spring` frozen for `#/legacy` |
| `--move-enter`, `--btn-hover-shift`, `--btn-press-shift` | kept | see 1.7a: replaced by `--move-*` in app code |
| `--state-working`, `--state-done`, `--state-error`, `--state-bar-h` | kept | used by result blocks (`data-state`) |
| `--focus` | kept | add `--focus-w` and `--focus-offset` |
| `html[data-motion="off"]` block | kept as is | automation hook |
| `html[data-live]` (in `index.html`) | kept as the hook for the mic indicator | set by `live.ts` |
| none | dropped | no current token is dropped |

New tokens: `--ink-2`, `--hover`, `--signal-text`, `--plot-energy`, `--plot-band`, `--on-ink`, `--t-*`, `--s-*`, `--gap-panel`, `--gutter`, `--strip-pad`, `--row-pad`, `--control-h`, `--divider-w`, `--shadow-panel`, `--shadow-chip`, `--shadow-button`, `--tilt-a`, `--tilt-b`, `--tilt-chip`, `--focus-w`, `--focus-offset`.

### 1.10 Visual weight (revision 2.3)

Status: spec, not built. Paper only (1.2a). Applies at every width. 3.6 (mobile layout) builds on it. Where this section and 1.8, 2.3, 2.4, 2.5, 2.10, 2.11 or 2.12 disagree, this section wins; each of those points here.

**User and problem.** The singer from section 0, and Joseph checking setup. Owner feedback: "the style of nesting sections with borders also creates a very busy experience. We need a way to reduce the UI weight." The 375 screenshots show why. Every section is a 1px ink box with a mono strip and a second ink line under the strip, so each section costs three heavy lines before any content. On Voice, the A4 stepper, the meter, the level bar, the canvas and the canvas overlay are boxes inside the hero box or the spectrogram box, two levels deep. Lines carry all the hierarchy, so a heading, a control and a container all look equally loud, and nothing tells her what matters.

**Decision.** Lines mark structure once, not three times. Sections are separated by one rule and space, not enclosed. Boxes are kept for things she operates or reads as a measurement (inputs, the meter, the plot), and a box never sits inside another box. Hierarchy comes from type size, weight and space. Hairlines only appear between rows of scannable data.

**Reason.** Removing the enclosing box takes away four lines per section and the padding inside it, so the page gets shorter and calmer without losing grouping, because space groups as well as a line does. Keeping boxes for controls and two data frames means a box always means "you can use this" or "this is a measured graphic", which is a signal, not decoration.

Revision 2.3a (persona review, "the singer who hates this"): boxes were about to stop meaning "tappable", because the Nav button and the A4 buttons lost theirs while the cents chip kept one. Fixed below by the **tap-affordance rule**, and the Voice hero gets ink edges so it holds up on a glary stand. System messages follow 2.14.

#### Definitions (FINAL, used by the WGT criteria)

- **Visible border side:** a side whose computed border width is above 0, style is not `none` or `hidden`, colour alpha is above 0, and colour differs from the element's own computed background colour. (So the primary button, whose border equals its fill, has no visible border.) Checked on the element and on its `::before` and `::after`. Focus outlines are not borders.
- **Box:** an element (or pseudo-element) with visible borders on 3 or 4 sides.
- **Rule:** an element with a visible border on 1 or 2 sides. An **ink rule** uses `--ink`; a **hairline** uses `--rule`.
- **Surface:** a non-control element whose computed background differs from its parent's, used to group (for example `--panel` on `--bg`).
- **Control:** `a`, `button`, `input`, `select`, `summary`, or `label` wrapping an input.
- **Data frame:** the boundary of a measured graphic. Exactly these two: the cents meter track `.va-track` and the plot area `.va-canvas-wrap`. (The cents chip `.va-chip` is no longer one: it is a filled readout with no border, revision 2.3a.)

#### Border budget (FINAL)

| Allowed | Line | Where |
|---|---|---|
| App header bottom | 1px ink rule | once per page |
| Tier-1 section top | 1px ink rule | one per top-level section, top edge only (the "notebook rule") |
| Tier-2 group top, disclosure summary top | 1px hairline | inside a section, or between collapsed reference rows |
| Data rows | 1px hairline, bottom only | `.kv` rows, the tool index rows, the self-test table. Only where rows are scannable data |
| Controls with an outline: text inputs, ghost buttons, the Nav button, the A4 − and + | 1px ink box | they are controls, and the boundary identifies them (WCAG 1.4.11, and the tap-affordance rule below) |
| Data frames | 1px ink box | the meter track, the plot area |
| Voice hero edges | 2px ink rules, top and bottom | the instrument's edges (revision 2.3a, "Surfaces") |
| System message rule | 3px left rule (2.14) | one per message callout |
| Footer top | 1px hairline | once per page |
| Result state bar (Methods) | 3px fill bar (`--state-bar-h`) | replaces the section's top rule while a check has a state |

**Tap-affordance rule (FINAL, revision 2.3a).** Anything she can tap looks tappable at rest, with no hover needed (touch has no hover). Every target has at least one of these at rest: an ink fill (primary button), a 1px ink outline (ghost button, Nav button, A4 − and +, inputs), an underline (links, About TOC chips, the tool name in a linked index row), or a 12px chevron on a full-width row with a hairline above (disclosure summaries). The other way round: **nothing that is not tappable has an outline.** The status chip, the cents chip and the spectrogram state text have no border. A box therefore means "you can use this", except the two data frames, which are plainly graphics.

Not allowed:
- **A box inside a box.** No box has a box as an ancestor, at any width, in any state (WGT-01). A control or data frame may sit on a surface, never inside another box.
- **Container boxes.** No section, panel, card, list or group is a box. Grouping is space, a rule above, or (once per screen) a surface.
- **Two lines in a row.** A heading never has a rule above and below it. The rule goes above; space goes below.
- **Side bars as decoration.** The 2px ink left bars on Overview "Good to know" notes go. The 3px `--signal` inset bar on the selected tool row stays, because it is a state, not structure.
- **Borders on things that are not tappable.** The status chip (`#readout-status`) and the cents chip (`#readout-cents`) have no border, and the spectrogram "Stopped" chip goes (its state moves to the spectrogram meta line, 2.14). A border would make them look like buttons.
- **Overlays on plots.** Nothing is drawn over the plot area or the meter except the data (2.14).

#### Section heads replace strips (FINAL)

Today every panel opens with `.strip`: an uppercase 11px mono title on a bar with an ink line under it. It is the same weight for "Note", "Readings", "Tool index" and "Who it's for", so the label tells her nothing about importance.

Two tiers instead:

| Tier | Use | Markup | Look |
|---|---|---|---|
| 1, section | top-level sections of a page: "What it shows you", "Calibration", "Who it's for", "Voice analysis" detail on Tools | `<section class="sec">` with `<header class="sec-head"><h2 class="sec-title">` and optional `<span class="sec-meta">` | 1px ink rule on the section's top edge, then `--sec-head-pad`, then the h2 in `--t-display-2` (Newsreader), sentence case. Meta (a status) sits right, on the h2's baseline, in `--t-label` |
| 2, group | labelled groups inside a section, and the instrument labels on Voice ("Readings", "Spectrogram") | `<div class="group">` with `<h2 class="group-label">` (or h3 inside a tier-1 section) | 1px hairline on top, 8px, then the label in `--t-label` (mono, uppercase through CSS, `--muted`) |

**Mono labels stay only where they carry meaning:** status values ("Not run this visit", "Idle"), units and axis labels, column heads in the tool index, the "Last:" label, the nav, tier-2 instrument labels, and the dt labels in "Good to know" (they are short category tags). Section titles and disclosure summaries become sentence-case text: Newsreader for tier-1 titles, Geist 14/20 weight 500 for summaries.

#### Hierarchy through space, size and weight (FINAL)

Read order on any page: h1, then the primary action, then tier-1 titles, then content, then tier-2 labels and meta. Each step down is smaller, lighter or quieter in colour, and is never told apart by a line alone.

| Level | Token (wide / compact) | Space above |
|---|---|---|
| h1 | `--t-display-1` 40/44 / 28/32 (Voice compact 20/24) | page header padding |
| tier-1 title | `--t-display-2` 26/32 / 22/28 | `--sec-gap` 48 / 32, then the rule, then `--sec-head-pad` |
| item title (features, steps, About items) | `--t-display-3` 24/28 / 20/24 for About; new `--t-h3` Geist 600 15/20 for Overview features and steps | `--item-gap` 20 / 16 |
| body | `--t-body` 14/20 | |
| tier-2 label, meta | `--t-label` 11/16 mono, `--muted` | `--group-gap` 24 / 20 |

Token values for compact are in 3.6 ("Type and spacing tokens").

#### Lists: space first, hairlines only for data (FINAL)

| List | Today | After |
|---|---|---|
| Overview "What it shows you" (4 items) | vertical and horizontal dividers inside a box | no lines. 4 columns at 960 and up with 32px gaps, 2 columns at 600 to 959, 1 column under 600, `--item-gap` between items |
| Overview "How to use it" (5 steps) | dividers between steps | no lines. The red step number column carries the rhythm |
| Overview "Not built yet", Tools not-built rows | dividers | no lines on Overview (it is a list of names). Tools index keeps hairlines (it is a table) |
| About items | dividers and disclosure rules | no dividers between items; the "How X is measured" disclosure keeps its hairline summary rule |
| `.kv` lists (Readings Details, Setup, Technical checks, Tools details, Methods results) | hairline between rows, 16px inline padding | hairline between rows kept (scannable label and value), inline padding 0, so values align with the page gutter |
| Self-test table | hairlines | kept |

#### Surfaces (FINAL)

A `--panel` surface replaces a box where a group must read as one object apart from the page flow. **At most one surface per screen.** Today that is only the Voice hero, the instrument she reads from 2 m. It is full-bleed at compact (3.6). Not surfaces: the selected tool row (`--hover`, a state), the Voice action bar (`--bg`, it covers content), the Nav panel.

**The hero needs edges (revision 2.3a).** `--panel` on `--bg` is about 1.09:1 (computed as in 1.4), which disappears on a stand in glare. So the hero gets **2px `--ink` rules on its top and bottom edges** and keeps the `--panel` fill. Two opposite sides are rules, not a box (Definitions), so nothing inside it breaks the nesting rule, and the full-bleed hero at compact reads as a band across the screen. Rejected: a darker fill (for example `--hover`). It lowers the contrast of muted text and of the meter's tolerance zone, which already uses `--hover`, and a fill edge is still weak in glare. Rejected: side rules too. At compact the hero is full-bleed, so side rules would sit on the screen edge and do nothing.

#### What survives from the Clinical3 references

I re-read `design/reference/Clinical3Landing.dc.html`, `Clinical3Analysis.dc.html` and `Clinical3Tools.dc.html`. Their character is the ruled lab notebook: thin ink lines, mono labels, tabular figures, signal orange used sparingly. Most of that is in the type and the rules, not in the boxes.

| Device in the reference | Keep or drop | Why |
|---|---|---|
| 1px ink rule under the app header | keep | it anchors the page; one line |
| 11px mono uppercase labels for meta, column heads and status | keep, only where they carry meaning (above) | the strongest "instrument" cue, and cheap in ink |
| `#D6D3CA` hairlines between table rows | keep for data rows only | rows of data are what hairlines are for |
| mono column-head row above a table | keep on the tool index at 600 and up | it explains the columns; hidden at compact as today |
| stat cells: mono label above a large Newsreader value, separated by a vertical hairline ("Pitch / F0 / Vibrato") | keep, for Readings (3.6) | labelled measurements side by side without boxes |
| graph-paper gridlines inside the plot in `--rule` | keep as an idea for the spectrogram (not in this revision) | it is the plot's own frame of reference |
| 6px signal square for the current nav item | keep | shape plus colour |
| ink underline links that turn signal on hover | keep | |
| footer hairline with mono text | keep the hairline; footer text stays `--t-body-s` (readability) | |
| a 1px ink box around every section, an ink line under every section strip | **drop** | this is the weight the owner objects to |
| 14px padding inside every box | **drop** | content aligns to the page gutter instead |

#### Before and after, per component

| Component | Before (1280 and 375) | After, 1280 | After, 375 |
|---|---|---|---|
| Panel `.panel` | `--panel` fill, 1px ink box, 20px gap | `.sec`: no fill, no box, 1px ink top rule, 48px between sections | same, 32px between sections, full gutter width |
| Strip `.strip` | mono 11px title on a bar, ink line below | tier-1 head: Newsreader 26/32 title, optional mono meta on the right, no line below | Newsreader 22/28, meta wraps under the title if it does not fit |
| kv list `.kv-list` | hairline rows, 12px 16px padding; 1 column under 600 | hairline rows, 12px 0 padding, label 2fr and value 3fr | two columns while the list is at least 280px wide (container query), else stacked; 10px 0 padding |
| Disclosure `details.disclosure` | box (when a `.panel`), mono summary, 7px chevron, ink rule under the open summary | no box; summary is a full-width row with a hairline on top, Geist 14/20 weight 500, a **12px chevron** (2px stroke) on the right; the open body has no rule under the summary | same; summary 44px tall minimum |
| Tool rows `.itable` | hairline rows inside a box; selected row `--hover` and inset bar | hairline rows, no box, column heads kept; selected row unchanged; the tool name in a linked row is underlined at rest and the row ends with "→" | stacked rows: number, name and status on line 1, description line 2, "Input: …" line 3 in `--t-body-s` |
| Result blocks `.m-check` | box, mono strip with status, state bar on the box's top edge | tier-1 section; the state bar replaces the top rule while there is a state; title Newsreader, status as mono meta; the method note is a disclosure, open at 600 and up | same, method note closed |
| About items | box per section, mono strip, prose in padding | tier-1 sections with Newsreader titles; items inside are Newsreader 24/28 h3 with prose, no dividers | h3 20/24, `--item-gap` 16 |
| Overview cards (features, steps, notes, roadmap) | features in a box with cell dividers; steps in a box with dividers; notes with ink side bars; roadmap in two boxes | features as a 4-column list, no lines; steps as a disclosure, open at 600 and up; notes as a plain dl, mono dt; Technical checks and Not built yet as two disclosure rows under one tier-2 label | 1 column, steps and Not built yet closed |
| Voice hero | box with a strip ("Note" and status) | `--panel` surface with 2px ink rules top and bottom; status moves to the page header row; no "Note" label (the hero has `aria-label="Note"`) | full-bleed band (3.6) |
| Cents chip | 1px ink box | no border; `--hover` fill, ink text; within tolerance `--ok` fill with `--on-ink` text; stale `--hover` fill with `--muted` text | same, 40px type (3.6) |
| Spectrogram | box, strip, plot box inside, overlay box inside that | tier-2 label "Spectrogram" with the span and state meta; the plot area is the only box; **no overlay** (2.14) | same, plot 200px tall |
| A4 stepper | three 48px ink boxes in the hero | moves to the Setup disclosure (3.6); − and + are 32px squares with a 1px ink outline at rest and a 44px hit area; the input a 1px ink box; a read-only "A4 {a4} Hz" stays in the hero | same |
| Level bar | 6px bar with an ink border | 4px `--rule` track, `--ink` fill, no border | same |
| Nav button | 1px ink box, `--panel` fill | 1px ink outline kept (tap-affordance rule), no fill; open: ink fill (2.1a) | same |
| System messages | bordered boxes, sometimes inside the plot box, repeated in two places | one callout with a 3px left rule (2.14) | same |
| Footer | hairline, two lines | unchanged | one paragraph, `--t-body-s` (3.6) |

#### Count per screen, now and target

"Now" is my count from the 375 screenshots and the CSS (idle, Nav closed, disclosures in their default state), so treat it as approximate. The engineer runs the WGT counting script on the current build before changing anything, and records that as the baseline in the PR. Targets hold at 375 and 1280 in the same state.

| Screen | Boxes now | Boxes target | Nested boxes now | Target | Rules now | Rules target |
|---|---|---|---|---|---|---|
| Overview | 5 (4 panels, Nav button) | 1 (Nav) | 0 | 0 | about 19 | 8 or fewer |
| Tools | 3 (2 panels, Nav button) | 1 (Nav) | 0 | 0 | about 13 | 15 or fewer (re-budgeted, see below) |
| Voice, idle | 13 (5 panels, canvas, overlay, meter, level, Nav, −, input, +) | 3 (meter track, plot area, Nav); the A4 controls are inside the closed Setup | 7 | 0 | about 10 | 12 or fewer |
| Voice, with pitch | 14 | 3 (the cents chip has no border now) | 8 | 0 | about 10 | 12 or fewer |
| Voice, denied | 14 (adds the spectrogram error box) | 3 | 8 | 0 | about 10 | 13 or fewer (adds the message rule) |
| Methods | 6 (4 panels, input, Nav) | 5 (Nav, input, 3 ghost buttons) | 1 | 0 | about 8 | 10 or fewer |
| About | 7 (6 panels, Nav) | 1 (Nav) | 0 | 0 | about 14 | 13 or fewer |
| Not found | 1 (Nav) | 1 (Nav) | 0 | 0 | 2 | 2 |

**Tools re-budget (revision 2.3a, owner and coordinator).** The targets above assumed four tool rows. M2 added a fifth, "Recording analysis", which adds one hairline. Measured on the build: 13 rules at 375 and 15 at 1280 (1280 also counts the column-head rule and the current nav item's 2px underline). The Tools target is 15, the measured maximum, with no other change.

The Voice rule count goes up slightly while the box count goes down, because each removed box is replaced by at most one rule, and the hero gains its two edge rules.

#### Rejected alternatives

- **Keep the boxes and lighten their colour to `--rule`.** Overview already does this for its reference panels. The page still reads as a stack of boxes, and `--rule` boxes around controls fail 1.4.11 at 1.5:1.
- **Cards with shadows or radius.** New visual language, and shadows add weight in another form. Paper has radius 0 and no shadows (1.7).
- **Filled surfaces for every section.** Alternating fills turn into stripes, and at 1.09:1 they group weakly anyway. One surface per screen keeps it meaningful.
- **Remove all rules and rely on space only.** Loses the notebook character the references set, and long prose pages (About) need a visible section start when scrolling fast.

#### States

Visual weight does not change by state, except: the Methods state bar replaces the top rule while a check is working, done or errored; the cents chip fill appears only with pitch; the selected tool row keeps its fill and bar; a system message adds one callout with its left rule (2.14). Error, empty and permission messages add no box. **FINAL**, except the open questions below.

#### Acceptance criteria (one assertion each)

Headless Chrome, Paper, `data-motion="off"`, after `document.fonts.ready`, at 375 × 667 and 1280 × 800, on `#/`, `#/tools`, `#/voice`, `#/methods`, `#/about` and an unknown hash, idle, Nav closed, disclosures in their default state, unless stated. Counting uses the definitions above over `.app-header`, `main` and `.app-footer`.

- **WGT-01** On every route and width, no box has an ancestor that is a box, with disclosures closed and with every disclosure open.
- **WGT-02** On every route, the number of boxes that are neither controls nor data frames is 0.
- **WGT-03** On every route, the total box count is at most the "Boxes target" in the table above.
- **WGT-04** On every route, the rule count is at most the "Rules target" in the table above.
- **WGT-05** No element with class `strip` or `panel` is rendered inside `main` on the app routes.
- **WGT-06** Every `h2.sec-title` has a computed font family starting with "Newsreader" and a font size of at least 22px at 375 and 26px at 1280.
- **WGT-07** Every `.sec` has a visible top border of 1px in `--ink` and no visible border on its other three sides.
- **WGT-08** `.ov-feature`, `.ov-step`, `.ov-note`, `.about-item` and the Overview not-built items have no visible border on any side, on the element or its pseudo-elements.
- **WGT-09** Every `.kv` row, `.itable [role="row"]` and `.m-table tr` has no visible left, right or top border, and its bottom border, if any, is 1px in `--rule`.
- **WGT-10** On every route, at most one element that is neither a control nor a data frame nor inside a data frame has a computed background equal to `--panel`; on `#/voice` it is `.va-hero`, elsewhere there is none. (In Paper `--surface-plot` has the same value as `--panel`, hence the data-frame exclusion.)
- **WGT-11** At 375, `#nav-toggle` with `aria-expanded="false"` has a 1px `--ink` border on all four sides and a transparent background.
- **WGT-12** `#va-readout-status` and `#va-readout-cents` have no visible border in any state, and no `.va-spec-chip` element exists.
- **WGT-13** At 375, the vertical gap between the bottom of one `.sec` and the top border of the next is at least 32px; at 1280 at least 48px.
- **WGT-14** No `h2.sec-title` or `summary` in the app routes has computed `text-transform: uppercase`.
- **WGT-15** On `#/methods` after a completed calibration, `#m-cal` shows the done state bar and has no other visible top border.
- **WGT-16** Tap affordance at rest: with no hover and no focus, every visible `button`, `a`, `input` and `summary` in the app routes (except links in prose, which are underlined) has at least one of: a visible border on four sides, a background different from its parent's, a computed `text-decoration-line` including `underline`, or (summaries only) a `::after` chevron at least 12px wide.
- **WGT-17** No element that is not a control, a data frame or a system message callout has a visible border on 3 or 4 sides (restates WGT-02 for the tap-affordance rule, including the error and with-pitch states).
- **WGT-18** `.va-hero` has 2px `--ink` top and bottom borders and no visible left or right border, at 375 and 1280.
- **WGT-19** Every `details.disclosure > summary::after` chevron is at least 12 × 12px.
- **WGT-20** `#va-readout-cents`, when shown, has a background other than transparent and no visible border.

#### Open questions

1. **Ghost buttons on Methods. Decided (coordinator default, revision 2.3a):** ghost.
2. **Loud.** None of this has a Loud treatment. Loud is dormant (1.2a); it needs its own pass if it returns, because Loud's character is the boxes and shadows.
3. **Plot gridlines** in `--rule` (from the references) would help her read the spectrogram. Not in this revision; it touches the canvas renderer.

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

### 2.1a Compact navigation (revision 2.1)

Paper only (1.2a). This section overrides 2.1's "Compact: brand and theme switch on row 1, nav on row 2".

**User and problem.** The user is the singer from section 0, on a phone (a phone on a music stand is one of the cases 2.1 names), plus Joseph checking setup on the same phone. Below 600px the nav today is one row that scrolls sideways. At 375 and 320, Methods and About sit off-screen, items are cut in half at the edge ("SES|SIONS", "ME…"), and the only cue is a faint fade at the right edge. She cannot see that two of the five destinations exist.

**Decision.** Below 600px a "Nav" button in the header row opens a full-width panel under the header row. The panel lists all five nav items stacked as large rows. The panel is in the page flow: it pushes the page down and covers nothing. At 600px and up, the nav stays a full visible row as it is today, with no button.

**Reason.** All five destinations become visible in one tap, at full size, with no clipping. The closed header gets shorter than today (one row instead of three), which gives the Voice analysis hero back vertical space at 375 × 667. An in-flow panel needs no focus trap, no scroll lock and no stacking order, because it hides nothing.

**Rejected alternatives.**
- *Wrap the nav onto two lines, no button.* At 320 the five items at a 44px target need two nav lines. The header then grows to about 130px on every page, which breaks the 89px budget and pushes the hero down.
- *Bottom tab bar.* It takes about 56px off every screen at all times, sits where the hero's "Start listening" toggle lands at 375 × 667, and needs five slots, one of them a non-link.
- *Icon-only hamburger.* The owner asked for a visible label. A three-line icon alone is also a weaker cue than the word.
- *Overlay drawer or modal sheet with a focus trap and scroll lock.* That is a lot of machinery for four links. It hides the page, and it makes "Mic on" and the live hero disappear behind a sheet while she is singing.
- *Keep the scroll strip with better cues (arrows, snap points).* It still hides two of five items at 320, and arrows are two more small targets.
- *A `<select>` of pages.* It cannot show Sessions as a visible non-link row with its "Not built yet" tag, and it changes the page on change, which surprises keyboard users.

**Assumption.** On a phone she mostly stays on Voice analysis, and the nav is used now and then, so one extra tap is cheap. This choice is cheap to reverse and not tested on its own. Watching the practice session from section 0 will show it either way.

#### Breakpoints

| Width | Header | Nav |
|---|---|---|
| under 600 (compact) | one row: brand, mic indicator, Nav button | in the Nav panel, closed by default |
| 600 to 959 (medium) | row 1: brand, mic indicator. Row 2: nav | full row, all five items visible, no button |
| 960 and up (wide) | one row: brand, nav, mic indicator | full row, no button |

Templates, now that the `theme` slot is gone (1.2a): wide `"brand nav mic"`, medium `"brand mic" "nav nav"`, compact `"brand mic toggle" "nav nav nav"`.

**Why medium keeps the full row and does not switch.** With no theme switch, the Paper nav row (five items in 11px Geist Mono, 24px gaps, the "Not built yet" tag, the current-item square) measures about 450px, an estimate from the type tokens. At 600 the medium row has 536px inside the 32px gutters, so it fits with room to spare. The `flex-wrap: wrap` already on `.nav ul` is the fallback if text is enlarged: items wrap to a second line and are never clipped or scrolled. Medium keeps the nav on its own row rather than joining row 1, because putting brand, nav and "Mic on" on one row at around 800 would only fit while the mic is off, and the header would reflow the moment she starts singing. **Needs a measurement:** the engineer confirms in the browser that at 600 the nav row has no wrap and no overflow (NAV-03). If it does not fit, the compact breakpoint moves up to the measured width. The nav does not go back to scrolling.

#### Closed header row (compact)

Read order: the brand first (where am I), then "Mic on" when live (the one status that matters while she sings), then Nav at the right edge, where a thumb reaches it.

- Row: `min-height: 56px`, `align-items: center`, `column-gap: var(--s-3)` (12px), gutters 16px. The brand keeps 20/24 Newsreader with 8px block padding, `min-width: 0`, and may wrap.
- Mic indicator: in row 1 between the brand and Nav, `justify-self: end`. While the mic is off it is visually hidden and takes no space, but stays rendered so its `role="status"` still announces "Mic on" (same as today's compact rule). While live: the `--signal` dot and "MIC ON" in `--t-label`.
- Nav button: right edge. The visible label is "Nav" in `--t-label` (Geist Mono 11/16, uppercase through CSS), followed by a 12px chevron (inline SVG, `aria-hidden="true"`, stroke `currentColor`). It is at least 44 × 44, with 12px inline padding and an 8px gap between label and chevron, about 75px wide.

Height budget, estimated from the tokens (the engineer measures, NAV-04 and NAV-05 assert the limit):

| Width | Mic off | Mic on | Budget |
|---|---|---|---|
| 375 (343px inside gutters) | brand about 144 + Nav about 75 fit on one line, 56px row + 1px border = **57px** | + "MIC ON" about 59 = about 302px, fits, **57px** | 89 |
| 320 (288px inside) | about 231px, fits, **57px** | about 302px does not fit, so the brand wraps to two lines: 2 × 24 + 16 = 64px row, **65px** | 89 |

The 8px change at 320 when the mic turns on is accepted. The rejected fix was a dot with no word, because colour would then be the only signal. Today's compact rule added a whole row for "Mic on", so this is still smaller.

#### Open panel

- The `<nav id="site-nav">` that already holds the list becomes the panel. One copy of the nav, no duplicated links.
- It spans the full header width (grid row 2, `nav nav nav`) and sits inside the header, above the header's 1px ink bottom border. Its top edge is a 1px `--rule` divider.
- Rows, top to bottom in DOM order: Overview, Tools, Sessions, Methods, About. Each row is a full-width block, at least 48px tall, with 16px inline padding, separated by 1px `--rule` dividers. Labels use Geist Mono 13/20, uppercase, 0.05em tracking. The size steps up from the 11px row labels because the panel is the only thing she is reading at that moment.
- **Links:** `--ink` text. Hover: `--hover` row background. The links.css ink line that draws under nav items is turned off inside the panel (`.nav a::after { display: none }` at compact), because a full-width line would read as a divider.
- **Current page** (`aria-current="page"`, set by the router as today): the existing 6px `--signal` square before the label, plus a 2px `--signal` underline under the label text only (not the whole row), so it matches 1.8. The square is a shape cue, so colour is not the only signal. On Voice analysis, Tools is current (2.1). On Not found and `#/legacy`, no row is current.
- **Sessions:** the existing `<span class="nav-off">`, not focusable, not a link. Muted text (`--muted`, 4.98:1 on `--bg`), with the full "Not built yet" tag shown at the row's right edge (`justify-content: space-between`). No hover, `cursor: default`. The short "Soon" variant is removed (below).
- Panel height: 5 × 48 + dividers, about 245px. At 375 × 667 the page below is pushed down, not covered.

#### Interaction

- **Markup.** `<button type="button" id="nav-toggle" class="nav-toggle" aria-expanded="false" aria-controls="site-nav">`. It sits in the DOM right before `<nav id="site-nav">`, so the tab order is brand, Nav, then the panel rows. The mic indicator moves after the nav in the DOM. It is not focusable, so the visual order and the focus order stay consistent.
- **One source of truth:** `aria-expanded` on the button. CSS shows the panel on compact with `#nav-toggle[aria-expanded="true"] ~ #site-nav`. There is no second attribute to keep in sync. The button's name stays "Nav" in both states. State comes from `aria-expanded`, the chevron flip and the fill (below).
- **Toggle:** a click, Enter or Space flips `aria-expanded`. Focus stays on the button.
- **Escape:** while the panel is open and focus is on the button or inside the panel, Escape closes it and moves focus to the button. Escape pressed elsewhere on the page is not handled here.
- **Focus is not trapped.** The panel is a disclosure in the page flow, not a dialog. It covers nothing, so a trap would block Tab for no reason. Tab after About goes on into `<main>` and the panel stays open. Closing on focus-out was rejected, because it would shift the page under her while she tabs.
- **Outside click or tap:** a `click` anywhere outside `#nav-toggle` and `#site-nav` closes the panel. The click is not cancelled and still reaches its target. Nothing is covered, so whatever she tapped is what she saw. The listener runs on `click`, not `pointerdown`, so the page does not move before the click lands. Focus goes wherever the browser puts it.
- **Choosing a link:** a click on any panel link closes the panel. The hash change then runs the router as today, and the router focuses the new page's h1 (section 5). Focus does not go back to the button.
- **Choosing the current page's link** (for example Overview on `#/`): there is no `hashchange`, so the router does nothing. The panel closes and focus moves to the page h1 (`router.focusHeading()`), so focus never lands on a hidden element.
- **Route change from anywhere else** (Back button, the "Start singing" button, a deep link): `hashchange` closes the panel and leaves focus alone.
- **Resize past the breakpoint:** a `matchMedia('(max-width: 599px)')` change event sets `aria-expanded="false"`, so going wide hides the button and returning to compact starts closed. Focus is not moved, and wide shows the nav anyway.
- **No scroll lock.** The header is not sticky and the panel is in the page flow, so the page scrolls normally and the panel scrolls away with it. Scrolling does not close it.
- **Assistive tech while closed:** only `#site-nav` is removed: at compact it stays rendered at zero height with `inert` (from the first frame of a close) and `visibility: hidden` (once the exit ends), per 1.7a pattern A. The button, brand and mic status region stay in the accessibility tree. On medium and wide the nav is always shown, whatever `aria-expanded` says.
- **Owner of the behaviour:** a new module `src/app/nav.ts` exporting `initNav({ focusHeading })`, called from `main.ts` after the router starts. The router does not import it.

#### Paper treatment

- Nav button closed: `--panel` fill, 1px `--ink` border, `--ink` text (17.7:1). Hover: `--hover` fill. **Superseded by 1.10 and 3.6:** closed, 1px ink outline and no fill (tap-affordance rule), hit area at least 44 × 44; the open ink fill and chevron flip stay. In phone landscape the compact header applies at any width (3.6), so `nav.ts` uses the 3.6 media query; NAV-02 is asserted at desktop heights.
- Nav button open: `--ink` fill, `--on-ink` text (16.2:1), chevron turned 180°. The flipped chevron is a cue that holds up in forced colours, where fills are dropped.
- Rows as in "Open panel". No shadow, radius 0.
- Focus: `:focus-visible` uses `--focus-w` and `--focus` (2px `--signal`). Inside the panel the rows are full-bleed, so the ring is drawn inset (`outline-offset: -4px`) to avoid being clipped by `.page { overflow-x: clip }`. `--signal` against `--bg` / `--hover` is 3.65 / 3.43, which passes 3:1 (1.4).
- Contrast, all from 1.4: ink on bg 16.2, muted on bg 4.98, muted on hover 4.67, signal square on bg 3.65. Nothing new is introduced.
- Forced colours: the current square gets `forced-color-adjust: none; background: CanvasText`. The open button keeps its chevron flip and gets a 2px `CanvasText` border. Focus uses `CanvasText`, as today.

#### Motion

**Superseded by 1.7a** (audit row 1, MOT-05 to MOT-14). The panel is a large element: it opens over 480ms on `--ease-settle` with its height revealed, and closes over 320ms, except after a link tap, which stays instant. The notes below are the revision 2.1 behaviour, kept for history.

- Open: the panel plays `nav-open`, from `opacity: 0; transform: translateY(calc(-1 * var(--move-enter)))` to its rest position, over `var(--dur-base)` with `var(--ease-enter)`. It is a keyframe animation, so it runs when `display` changes from none, with no discrete-transition tricks.
- Close: instant. A close usually comes right before a route change, which already animates `<main>`. Two animations in a row would feel slow.
- Chevron: `transform` over `var(--dur-fast)` with `var(--ease-standard)`.
- Reduced motion: under `prefers-reduced-motion: reduce`, the panel animation and the chevron transition are set to `none` in this section's own rules. They do not rely on the `--dur-*` tokens, which still hold 100 to 120ms fades until OPEN 1 is decided. The existing `html[data-motion="off"]` rule already covers automation.

#### What to delete

From `index.html`:
- The whole inline `<script>` after `</nav>` that sets `data-more` (lines 34 to 49 today).
- `<span class="tag-short" aria-hidden="true">Soon</span>` inside Sessions. The panel has room for the full tag.

From `src/styles/app.css` (shared rules, not Loud-scoped):
- `.nav .tag-short { display: none; }` and its comment.
- `.nav ul { scrollbar-width: none; }`, `.nav ul::-webkit-scrollbar { display: none; }`, the `.nav::after` fade block, `.nav[data-more]::after`, and the comment above them.
- In the `@media (max-width: 599px)` block: the nav scroll-strip lines (`.nav { min-width: 0 }`, the `.nav ul` nowrap, overflow-x, scroll-padding, padding and margin rule, `.nav li { flex: none }`, and the nowrap, 13px `.nav a, .nav .nav-off` line), the `.tag-short` and `.tag-long` swap (`.nav .nav-off { position: relative }`, `.tag-short { display: inline }`, the visually-hidden `.tag-long` rule), `.nav .nav-off .tag-notbuilt { font-size: 12px }`, and the comments that describe the strip and the fade. The compact grid template is replaced by the one above.
- Kept, dormant: every `:root[data-theme="loud"]` nav rule, including the Loud medium scroll strip (lines 139 to 143 today). If Loud returns, that strip has no fade and no hidden scrollbar, so it needs re-specifying (open question 3).

From `src/app/router.ts`:
- In `start()`: the `focusin` listener on `.nav ul` that calls `scrollIntoView`, and its comment (lines 163 to 167 today).
- In `render()`: `a.scrollIntoView({ block: 'nearest', inline: 'nearest' })` and its comment (lines 153 to 154). The `aria-current` set and remove stay.

#### States

| State | What shows | Status |
|---|---|---|
| Compact, closed (default on load) | brand, Nav with `aria-expanded="false"`; nav at zero height, `visibility: hidden` and `inert` | FINAL |
| Compact, open | panel with five rows; Nav filled, chevron flipped | FINAL |
| Mic live, closed or open | "MIC ON" in row 1; at 320 the brand may wrap | FINAL |
| Current page | square and underline on that row; Tools on Voice analysis; no row current on Not found and `#/legacy` | FINAL |
| Sessions | muted, non-focusable row with "Not built yet" | FINAL until Sessions ships |
| Route leave in progress ("Stopping…", 6.5) | panel already closed by the link click; old route stays visible as specified in 6.5 | FINAL |
| Text enlarged to 200% | rows and the brand grow, the brand wraps, Nav keeps its label. On medium the nav wraps to a second line. No horizontal scroll at 320 | FINAL |
| Script failed to load | button does nothing and the nav stays hidden on compact. Accepted: every route is rendered by script, so there is no page to navigate to without it | FINAL |
| Empty, loading, permission denied | none apply. The nav is static and needs no permission. A blocked microphone does not change it | n/a |

#### Element IDs and classes

| Hook | Element | New or existing |
|---|---|---|
| `#nav-toggle`, `.nav-toggle` | Nav button, shown only under 600px | new |
| `.nav-toggle-label` | the "Nav" text | new |
| `.nav-toggle-icon` | chevron SVG, `aria-hidden="true"` | new |
| `#site-nav` | id added to the existing `<nav class="nav" aria-label="Main">` | id new |
| `.nav`, `.nav ul`, `[data-nav]`, `.nav-off`, `.tag-notbuilt`, `.tag-long` | as today | existing |
| `#mic-indicator` | unchanged, moved after `#site-nav` in the DOM, grid area `mic` | existing |
| `src/app/nav.ts`, `initNav({ focusHeading })` | toggle behaviour | new |
| `@keyframes nav-open` | open animation | removed by 1.7a (CSS transitions, pattern A) |

#### Acceptance criteria (one assertion each)

Widths are CSS px, Paper. "Compact" means 320 and 375.

- **NAV-01** At 320 and 375, `#nav-toggle` is visible, its accessible name is "Nav", and it has `aria-controls="site-nav"`.
- **NAV-02** At 600, 959 and 1280, `#nav-toggle` is not rendered (`display: none`).
- **NAV-03** At 600, 959 and 1280, all four links and the Sessions item in `#site-nav` sit fully inside the viewport, and `.nav ul` has `scrollWidth <= clientWidth`.
- **NAV-04** At 375, with `data-live` off and on, the `.app-header` height is at most 89px.
- **NAV-05** At 320, with `data-live` off and on, the `.app-header` height is at most 89px.
- **NAV-06** At 320 and 375 with `data-live="on"`, the brand, `#mic-indicator` and `#nav-toggle` bounding boxes do not overlap, and all three are in the first grid row.
- **NAV-07** On first load at compact, `#nav-toggle` has `aria-expanded="false"`, `#site-nav` is rendered at zero height (1.7a pattern A) with computed `visibility: hidden` and `inert`, and none of its links is focusable or in the accessibility tree. After a close, the same holds once the exit ends; `inert` applies from its first frame.
- **NAV-08** At compact, clicking `#nav-toggle` sets `aria-expanded="true"` and `#site-nav` becomes visible.
- **NAV-09** At compact with the panel open, the five items appear top to bottom in the order Overview, Tools, Sessions, Methods, About, each at full panel width.
- **NAV-10** At compact with the panel open, every link in `#site-nav` is at least 44px tall and the full panel width.
- **NAV-11** At compact, `#nav-toggle` is at least 44 × 44px.
- **NAV-12** At compact on `#/voice` with the panel open, the Tools link has `aria-current="page"` and no other link has it.
- **NAV-13** At compact with the panel open, the Sessions item is not focusable and its text includes "Not built yet".
- **NAV-14** At compact with the panel open, pressing Tab from `#nav-toggle` moves focus to the Overview link.
- **NAV-15** At compact with focus on a panel link, Escape sets `aria-expanded="false"` and focuses `#nav-toggle`.
- **NAV-16** At compact with the panel open, pressing Tab from the About link moves focus out of the header, and `aria-expanded` stays `"true"`.
- **NAV-17** At compact with the panel open, clicking the Methods link changes the hash to `#/methods`, sets `aria-expanded="false"`, and focuses the Methods h1.
- **NAV-18** At compact on `#/` with the panel open, clicking the Overview link sets `aria-expanded="false"` and focuses the Overview h1.
- **NAV-19** At compact with the panel open, a click on `<main>` sets `aria-expanded="false"`.
- **NAV-20** At compact with the panel open, a `hashchange` not caused by the panel (setting `location.hash` from script) sets `aria-expanded="false"`.
- **NAV-21** With the panel open at 375, resizing to 800 sets `aria-expanded="false"`, and resizing back to 375 shows `#site-nav` hidden.
- **NAV-22** At compact with the panel open, `document.documentElement` has no `overflow: hidden` and the page scrolls.
- **NAV-23** At compact with the panel closed, `#nav-toggle` and `#mic-indicator` are in the accessibility tree.
- **NAV-24** At compact with `prefers-reduced-motion: reduce`, opening the panel runs no animation on `#site-nav` (`getAnimations()` is empty).
- **NAV-25** At compact, a keyboard-focused panel link shows an outline of at least 2px whose box lies inside the viewport.
- **NAV-26** `index.html` contains no `data-more` script, and `.nav` never has a `data-more` attribute.
- **NAV-27** No element with class `tag-short` exists in the document.
- **NAV-28** At 320 at every route, `document.documentElement.scrollWidth <= 320`, with the panel open and closed.
- **NAV-29** axe-core reports no violations in `.app-header` at 375, with the panel open and closed.
- **THM-01** `index.html` contains no `#theme-switch` and no `input[name="theme"]`.
- **THM-02** With `centstodollars.theme` set to `loud` before load, `<html>` has `data-theme="editorial"` after load.
- **THM-03** After load, `localStorage.getItem('centstodollars.theme')` returns `null`.
- **THM-04** With `localStorage` throwing on every call, the app loads with `data-theme="editorial"` and no console error from `theme.ts`.
- **THM-05** Overview contains no `#theme-choice`, and the About page text contains neither "Paper" nor "Loud".

#### Open questions

1. **The medium fit is an estimate.** About 450px of nav in 536px at 600 comes from the type tokens, not from a measurement. NAV-03 settles it. If the row does not fit, the compact breakpoint moves up to the measured width. The nav does not go back to scrolling.
2. **The 320 wrap with the mic on.** The brand wrapping to two lines (57px to 65px) when she starts singing at 320 is a small layout shift. The alternative is shortening the label to a dot plus "MIC", which keeps a word. Owner's call, low stakes.
3. **Loud, if it returns.** The compact panel has no Loud treatment, and the dormant Loud medium scroll strip loses its fade. Both need a Loud pass before Loud ships again.

### 2.2 Page header

Eyebrow or breadcrumb, h1 (`tabindex="-1"`, focused on route change), optional lede (max 62ch), optional action.

### 2.3 Panel

`<section aria-labelledby>`, strip (title on the left, meta on the right), body. Treatments in section 1.8. **Superseded in Paper by 1.10:** panels become `.sec` sections (ink top rule, Newsreader title, no box) or tier-2 groups.

### 2.4 Key-value row

Label, value, unit, optional note line. Empty state: a reason in words ("No pitch", "None found in the last 2.5 s"). Pending: "Measuring…". Error: "Could not measure" plus the reason. Hook convention in section 7.3. Layout (no inline padding, two columns down to a 280px list) in 1.10 and 3.6; Voice Readings use the stat grid (3.6).

### 2.5 Table row

Grid row with dividers. A row that is a link gets hover. A selected row gets `--hover` and a 3px `--signal` inset bar. A not-built row: muted text, hollow dot, "Not built yet", not a link. On compact, rows stack as key-value blocks, with no horizontal scroll. Which lists keep hairlines: 1.10.

### 2.6 Status dot and label

The label always states the status. Live: filled `--signal`. Ok: filled `--ok`. Idle, not run or not built: hollow ring. Error: hollow square with "!" in `--state-error`.

### 2.7 Buttons

Primary (ink fill, `--on-ink` text, Paper hover `--signal-text`), ghost (border only), hero toggle (full panel width, 56px tall, `--t-cue` size in Loud), disabled (`disabled`, muted, and a reason next to it when it is not obvious), busy (disabled plus a label change, no spinner). Always `<button type="button">`, at least `--control-h` tall. Hit areas, the compact action bar (hero toggle 48px, fixed at the bottom of Voice under 600) and ghost buttons on Methods: 3.6.

### 2.8 Number inputs and the A4 stepper

- **A4 stepper (next to the hero, FINAL).** Label "A4". A "−" button (`aria-label="Lower A4 by 1 hertz"`), the input `#va-a4` (`inputmode="decimal"`, range 400 to 480, step 0.1, `--t-display-3`, 7ch wide), "Hz", and a "+" button. Buttons are 48px square. **Superseded by 3.6 (revision 2.3a):** the stepper moves into the Setup disclosure, with a Done button and Enter and blur commit; − and + are 32px squares with a 1px ink outline and 44 × 44 hit areas; the input is 44px tall; the hero keeps a read-only "A4 {a4} Hz". "Next to the hero" no longer applies. The buttons change the value by 1 Hz. Typing allows 0.1 Hz.
- Validation on `change` and blur. Out of range or empty: the error line `#va-a4-error` says "Enter a value from 400 to 480 Hz", `aria-invalid="true"` is set, and the last valid value stays in use. A valid change applies on the next frame and is announced ("Reference A4 = {a4} Hz"). Saved to `centstodollars.a4`.
- `#m-cal-hz`: 60 to 2000 (the tracker's F0 search range), error line `#m-cal-hz-error` "Enter a value from 60 to 2000 Hz".
- Both inputs fix a current bug: `Number(value) || 440` accepts 4 Hz and silently turns 0 into 440.

### 2.9 Big pitch readout (the hero)

Read first, because it answers "what note am I on, and which way am I off".

Anatomy, top to bottom. **Revised by 3.6 ("Voice analysis in detail") and 2.14:** no strip; the status chip moves to the page header row; system messages are one callout in the note slot (2.14); the cue and cents chip are 40px at compact and the chip has a fill, no border; the A4 stepper (6) moves to Setup and a read-only A4 stays; the caption (5) and the hint (7) share one slot; the level bar is 4px with no border; under 600 the toggle (9) sits in a fixed bottom bar, filled `--signal-text` with a live dot while listening, and the Space line is hidden.
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

(Paper, revision 2.3: the strip becomes a tier-2 label and the plot area is the only box, 1.10. Revision 2.3a: the overlay and the "Stopped" chip are removed; the empty, waiting and stopped states are words in the meta line, 2.14.) `.plot-frame` wrapper (inert in Paper), strip ("Spectrogram" on the left; "0 to 4 kHz, last {span} s" on the right, with span = 960 × hop / fs computed, not typed), canvas `#va-spectrogram` (bitmap 960 × 300; CSS height 300px wide, 200px compact), HTML axis labels, legend ("F0" and "2.5 to 3.5 kHz band"), caption "Brightness is energy. Orange marks are the pitch the app measured." (Loud: "Pink marks…" as dual text).
- Colours come from tokens. F0 marks get a 1px `--surface-plot` halo. Colours are re-read on `themechange` (section 6).
- `role="img"`, label "Spectrogram 0 to 4 kHz with pitch marks. The readings are listed as text in the Readings panel."
- States: empty (overlay "Not listening. The plot fills from the right when you start."), live, stopped (frozen, with a "Stopped" chip), error (overlay with the hero error message).

### 2.11 Disclosures

`<details>` and `<summary>`, closed by default, open state not remembered. Used for "Details" (technical readings), "Setup" (input info and settings), "Technical checks" (Overview) and error "Details" (raw error text). The summary is at least `--control-h` tall. Look (hairline on top, sentence-case label, no box) in 1.10; the `data-open-wide` default and the 44px minimum in 3.6.

### 2.12 Result block (Methods checks)

Strip (title, status), purpose, requirements, inputs, action, progress line (`role="status"`), results, method note. `data-state="working|done|error"` drives the existing `--state-*` bar. In Paper the block is a tier-1 section whose top rule becomes the state bar, and the method note is a disclosure (1.10, 3.6). States: Not run this visit, Needs microphone, Running, Done, Done with a warning, Could not run, Cancelled.

### 2.13 Footer

"For practice and study. Not a diagnostic or medical device." and "Audio stays in this browser and is not saved." No "sample data" text anywhere. Compact footer (one paragraph, at most 100px at 375, safe-area padding): 3.6.

### 2.14 System messages (revision 2.3a)

Status: spec, not built. Paper only. Every width. Supersedes the message parts of 2.9 (error text in the note block), 2.10 (the plot overlay and the "Stopped" chip), 2.12 (where check errors go) and the Message column of 3.0. 1.10 and 3.6 use it.

**User and problem.** The singer, alone, when something stops her from practising: the browser blocked listening, another app holds the input, the page is not secure. Owner: "system messaging needs to be treated differently. This is a direction to help." In the Voice denied state today, the full message appears twice: in the hero, and again in a bordered box drawn over the spectrogram that overflows the plot frame at narrow widths. That is a box inside a box, said twice, and broken at 320. It reads as an alarm, not as the next step.

**Decision.** One message per state, in one place: a single **callout** next to the primary action, saying what happened and then the fix as one clear step, with the action button right there. Everything else on the page stays quiet and neutral. The spectrogram, the readings and the meter show their ordinary empty state and never the error text. Nothing is drawn over a plot.

**Reason.** She has one thing to do, so the page should show it once, where her eye already is (the hero) and next to the button that does it. Repeating it turns help into noise, and an alarm style makes a settings problem feel like a fault in her voice or her phone.

**Rejected.**
- *A toast or snackbar.* It disappears before she has walked back to the stand, and fixed overlays fight the Voice action bar.
- *A modal dialog.* It blocks the page for a problem the page can't fix, and needs focus trapping for nothing.
- *Red error styling.* It is an alarm. `--state-error` stays only for field validation (a typed value she can fix in place).
- *The message in the spectrogram as well, "because it is empty anyway".* That is the duplication the owner asked to remove.

#### Message types

| Type | Examples | Placement | Visual | Tone | Announced |
|---|---|---|---|---|---|
| **Needs her action** (blocking) | Voice: denied, no device, busy, insecure, analyser failed, ended. Methods: the same per check, test files not found, criteria not found | Voice: in the hero, in the note slot, directly before the toggle. Methods: inside that check's section, directly above its Run button | callout, kind `action` | what happened, then the fix as a step that ends with the button's exact label | once, through the page's polite status region when the state begins (`#va-readout-announce` on Voice, the check's progress line on Methods). Never `role="alert"` |
| **Transient status** | Waiting for permission, Stopping, Running, Measuring for 5 s, File 3 of 12 | the button label (busy, disabled) and the status chip or status meta. Waiting for permission also gets an `info` callout, because she has to do something in the browser's own prompt | button text; status chip; `info` callout for permission only | short, present tense | the status chip change and the permission callout, once each |
| **Warning** (she can still continue) | Voice: too quiet (gate hint). Methods: too few voiced frames, no tone heard, no output timing | Voice: the shared caption and hint slot in the hero (3.6). Methods: in the check's results, above the numbers | Voice: hint text 18/24 with a 16px "!" icon, no rule (it appears and disappears live, so it must not move anything). Methods: callout, kind `warn` | what is wrong, then what to try | Voice: once each time it appears, at most once per 5 s. Methods: once |
| **Empty state** | Voice idle, no pitch, "No vibrato found in the last 2.5 s", not listening. Methods "Not run this visit". Readings "No pitch" | in place of the value it stands for | plain text: `--muted` for placeholders, `--ink-2` for the idle instruction; no rule, no icon | neutral, says why there is no number | no |
| **Confirmation** | A4 changed, check done, self-test pass | the value itself changes; Methods status meta "Done" with the `--ok` dot; the progress line | no callout | short past tense | yes, once (existing status regions) |
| **Field error** | A4 out of range, calibration frequency out of range | directly under the field, linked with `aria-describedby`, `aria-invalid="true"` | `--state-error` text, weight 500 | "Enter a value from 400 to 480 Hz" | yes (existing status region) |

#### The callout

One component, `.msg`, with `data-kind="action|warn|info"`.

- **Anatomy:** a 16px icon (inline SVG, `aria-hidden`), a title line (what happened, `--t-body` weight 500, `--ink`), a step line (how to fix, `--t-body`, `--ink-2`), and optionally a Details disclosure (raw error text, analyser failures only) and, on Methods, the Run button right under it. On Voice the action is the toggle, which is the next control after the callout in the DOM and on screen.
- **Treatment:** a **3px left rule**, 12px left padding, no fill, no other border. Rule colour: `--signal` for `action` and `warn` (3.65:1 on `--bg`, 3.98:1 on `--panel`, passing 3:1 as a graphic, 1.4); `--muted` for `info`. Icon: a circle with "!" for `action` and `warn`, a circle with "i" for `info`, both in `--ink`, so the kind never depends on colour alone. Text is never red and never uppercase.
- **Fits the border budget:** one rule, no box, so it can sit on the hero surface or in a section (1.10).
- **Size:** `max-width: 46ch`, wraps freely. At 320 the hero content is 288px wide; the longest action message (denied: title plus a three-line step) is about 84px tall and fits in the 120px note slot. The analyser message with its Details summary is about 104px.
- **No overlays:** a callout is always in the flow, never over the plot, the meter or the action bar.

#### Secondary areas while there is a message (FINAL)

| Area | Shows | Never shows |
|---|---|---|
| Spectrogram plot | the empty plot area with its axis labels and, after a stop, the frozen columns | any text over the plot |
| Spectrogram meta line (tier-2 label row) | "0 to 4 kHz, last {span} s" plus a state word in `--muted`: "Not listening", "Waiting for sound" (listening, no columns drawn yet), or "Stopped" | error text |
| Meter | the empty track, label "No pitch" for screen readers | error text |
| Readings | their own empty texts ("No pitch", "No vibrato found in the last 2.5 s") | error text |
| Status chip | the short state ("Listening blocked", "Can't listen") | the step |

#### Copy rules (FINAL)

1. **Title: what happened**, in one plain sentence, from her side ("Listening is blocked for this page."). No "error", "failed", "invalid" or "something went wrong". No blame.
2. **Step: how to fix it**, imperative, at most two short sentences, and it ends with the action's exact label ("then press Try again." on Voice, "then run the check again." on Methods). If there is no fix she can make, there is no step.
3. **Same voice everywhere:** second person, present tense, no "I", no exclamation marks, sentence case.
4. **Never tell her to use, connect or sing into a microphone.** She sings unamplified to the device's built-in input (section 0). Naming the browser's own permission setting, which browsers label "Microphone", is allowed, because that is the word she will see in the settings screen. Saying the device has no input the browser can use is a fact, not an instruction.
5. **Keep the meaning** of the current strings; the rewrite only splits them into title and step.

#### Copy: Voice (`voice.ts` `COPY`)

| State | Chip | Kind | Title | Step | Action |
|---|---|---|---|---|---|
| idle | Idle | empty | "Press Start listening and sing a steady note." (instruction, plain text) | "Audio stays in this browser and is not saved." | Start listening |
| requesting | Waiting for permission | info | "Your browser is asking if this page can listen." | "Choose Allow." | Waiting for permission… (disabled) |
| denied | Listening blocked | action | "Listening is blocked for this page." | "In your browser's site settings, allow Microphone for this site, then press Try again." | Try again |
| nodevice | Can't listen | action | "This laptop or phone has no microphone the browser can use." | "Check your sound settings, then press Try again." | Try again |
| busy | Can't listen | action | "Another app is using the sound input." | "Close it, then press Try again." | Try again |
| insecure | Not available | action | "Listening only works on a secure page." | "Open http://127.0.0.1:5173." (a link) | none |
| analyser | Can't listen | action | "This browser could not start the audio analyser." | "Press Try again." plus Details with the raw text | Try again |
| ended | Listening stopped | action | "Listening stopped." | "Press Start listening to continue." | Start listening |
| gate hint | Listening | warn (hint) | "Too quiet to hear." | "Move closer or turn the input up." | none |

The analyser chip changes from "Error" to "Can't listen" (rule 1). The gate hint changes from "I can't hear you. Move closer or turn the input up." (rule 3); VA-20 now expects "Too quiet to hear. Move closer or turn the input up." VA-04 now expects no overlay, and the spectrogram meta line to contain "Not listening". VA-10, VA-12 and VA-13 check the chip text in the table above.

#### Copy: Methods (`methods.ts`, `checks.ts`)

| State | Status meta | Kind | Title | Step |
|---|---|---|---|---|
| denied | Needs permission to listen | action | "Listening is blocked for this page." | "In your browser's site settings, allow Microphone for this site, then run the check again." |
| nodevice | Could not run | action | "This laptop or phone has no microphone the browser can use." | "Check your sound settings, then run the check again." |
| busy | Could not run | action | "Another app is using the sound input." | "Close it, then run the check again." |
| insecure | Needs permission to listen | action | "Listening only works on a secure page." | "Open http://127.0.0.1:5173." |
| analyser | Could not run | action | "This browser could not start the audio analyser." | "Run the check again." plus Details |
| ended | Could not run | action | "Listening stopped during the check." | "Run the check again." |
| self-test files missing | Could not run | action | "Test files not found at /fixtures/synthetic/." | "Start the dev server (npx vite) and generate them with py/synth.py." |
| criteria missing | Could not run | action | "Criteria not found in results/summary.json." | none (a developer problem; Details lists the missing keys) |
| cancelled | Cancelled | info | "Cancelled because you left the page." | none |
| calibration, too few frames | Done with a warning | warn | "Too few voiced frames ({n} of {min} needed)." | "Check that the reference is playing and loud enough." |
| loopback, no tone | Done with a warning | warn | "No tone was heard." | "Turn the speaker volume up a little and try again." |
| loopback, no timing | Done with a warning | warn | "This browser did not report output timing, so latency could not be measured." | none |

Overview's Technical checks rows keep their short field values (for example "Blocked. Allow it in the browser's site settings."). They are on another page, so they are not a repeat.

#### States

Every state above is **FINAL** except the open question below. Loading: there is no loading message; the transient row covers waiting. Permission denied: the denied rows. Empty: the empty rows. Forced colours: the left rule uses `CanvasText`, and the icon keeps its glyph.

#### Acceptance criteria (one assertion each)

Headless Chrome, Paper, at 320 × 568, 375 × 560 and 1280 × 800, `#/voice` with a stubbed `startLive`, and `#/methods` with stubbed checks.

- **MSG-01** In each Voice state denied, nodevice, busy, insecure, analyser and ended, the state's step text occurs exactly once in `document.body.innerText`.
- **MSG-02** In each of those states, the title text occurs exactly once in `document.body.innerText`.
- **MSG-03** In each of those states, exactly one `.msg` element is rendered on the page.
- **MSG-04** In each Voice state, no element with visible text intersects the bounding box of `.va-canvas-wrap` or `#va-cents-meter`, other than their own axis labels and tick labels.
- **MSG-05** No element with id `va-spec-overlay`, `va-spec-overlay-text` or `va-spec-stopped`, and no `.va-overlay`, exists.
- **MSG-06** In the denied state, the spectrogram meta line contains "Not listening" and not the denied title.
- **MSG-07** In each Voice action state, the `.msg` is inside `.va-hero`, and the next focusable element after it in DOM order is `#va-live-toggle` (or, for insecure, nothing in the hero).
- **MSG-08** In each Voice action state at 320 × 568, the `.msg` box lies inside `.va-hero` horizontally, and `.va-hero` has `scrollWidth <= clientWidth`.
- **MSG-09** `.msg` has a 3px left border and no visible top, right or bottom border.
- **MSG-10** `.msg[data-kind="action"]` and `[data-kind="warn"]` have a left border colour equal to `--signal`; `[data-kind="info"]` has `--muted`.
- **MSG-11** No `.msg` text has computed colour `--state-error` or `text-transform: uppercase`.
- **MSG-12** `.msg[data-kind="action"]` and `[data-kind="warn"]` contain an icon whose accessible tree is hidden and whose glyph differs from the `info` icon.
- **MSG-13** On entering the denied state, `#va-readout-announce` changes exactly once within 2 s, and its text contains the title.
- **MSG-14** No element on the app routes has `role="alert"`.
- **MSG-15** On `#/methods` with the calibration check denied, the `.msg` is inside `#m-cal`, immediately before the Run button's paragraph, and the step text occurs exactly once on the page.
- **MSG-16** On `#/methods`, a field error under `#m-cal-hz` has colour `--state-error` and is referenced by the input's `aria-describedby`.
- **MSG-17** No `.msg` step text contains the words "use a microphone", "connect a microphone", "plug in" or "sing into".
- **MSG-18** In each action state, the step text ends with the visible label of the action button in the same state (Voice) or with "run the check again." compared case-insensitively (Methods), except the rows whose step is a link or "none" (insecure, self-test files missing, criteria missing).
- **MSG-19** With `data-live="on"` and the gate hint shown and hidden repeatedly, `#va-live-toggle` does not move (its top changes by 0px).

#### Open question

1. **"Waiting for sound."** The spectrogram meta shows it while listening with no columns drawn yet. If that moment is too short to matter, drop it and keep "Not listening" for idle only. Low stakes.

---

## 3. Screens

### 3.0 Shared microphone states and copy

The table is mapped from the rejection `name` of `startLive`. **The Chip and Message columns are superseded by 2.14** (title and step copy, one callout in one place, matching the strings now in `voice.ts`). The triggers and actions stand.

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
- 1280: header, page header with the button on the right, disclosure and Not built yet side by side (7 and 5 columns). 375: everything stacked, button full width. **Superseded at 375 by 3.6** (order, collapsed How to use it and Not built yet, height target), and at every width by 1.10 (no boxes).

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

**The 375 column is superseded by 3.6** (status in the page header row, full-bleed hero, fixed action bar, vibrato readings above the fold). The 1280 column stands.

The hint slot is reserved space (24px) so the hint does not push the toggle. If the fonts make the hero taller than the budget, the note size gives way first (the `cqi` clamp minimum applies, then the engineer lowers it) and the toggle never leaves the viewport.

Layout 1280: page header (breadcrumb "Tools / Voice analysis", h1 "Voice analysis"); hero in 5 columns and spectrogram in 7 (equal height); below them, Readings in 5 and How to read this in 7; Setup disclosure in 12. No settings strip above the hero.
Layout 375: page header; hero; spectrogram; Readings; Setup; How to read this. **Superseded by 3.6:** the DOM order at every width becomes hero, Readings, spectrogram, How to read this, Setup, and the Readings rows start with vibrato. The 1280 grid placement above stays.

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
- 1280: Calibration and Loopback side by side (6 and 6), Self-test 12, Documents 12. 375: stacked. The self-test table turns into one block per set. Sections, ghost Run buttons and Method disclosures: 1.10 and 3.6.

### 3.5 Not found and `#/legacy`

- Not found: h1 "Page not found", "There is no page at this address.", "Go to Overview".
- `#/legacy` (temporary, Phase A until Phase C passes): the current test page markup, moved unchanged into `<section data-route="legacy">`, with its original IDs and its styles scoped under `[data-route="legacy"]`. Not in the nav. Removed after Phase C passes its acceptance criteria.

### 3.6 Mobile layout (revision 2.3)

Status: spec, not built. Revision 2.3a folds in the owner's answers, the persona review ("the singer who hates this") and 2.14 (system messages). Paper only. Covers widths 320 to 599, the change at 600, and phone landscape (in scope). Built on 1.10 (visual weight), which applies at every width. Where this section and 1.6, 2.1a, 2.7, 2.8, 2.9, 2.10, 2.13, 3.1, 3.3, 3.4 or 5 disagree for compact widths, this section wins; each of those points here. **Out of scope:** `#/legacy`, which another session owns. Nothing here changes `legacy.css`, `src/testpage/main.ts` or the legacy markup. One shared change touches it indirectly: the viewport meta, which the coordinator is clearing with that session.

**User and problem.** The singer from section 0, with a phone on the music stand 1 to 2 m away, singing unamplified; and Joseph checking setup on the same phone. Owner: "The mobile version is a mess. It all just stacks." The 375 screenshots (Overview 2694px tall, About 2954, Voice 1862, Tools 1733, Methods 1582) show every section as a full-width box with its own strip, one after another, at the same weight. On Voice, the readings sit about 1000px below the hero, the A4 stepper is three 48px boxes, and the h1 shows an orange focus box on arrival. Nothing on any page says "this is what matters now".

**Decision.** Each screen has one job and one primary action, and the first viewport is built around them. Mid-practice content (the readout, her vibrato numbers, Start and Stop) is at the top, at full size. Reference content (how it works, setup detail, roadmap) is shorter, quieter, and collapsed where it is long. On Voice, Start and Stop live in a fixed bar at the bottom of the screen. Touch targets are 44 × 44 hit areas around visuals that can be smaller. Section boxes become ruled sections (1.10).

**Reason.** On a phone the screen is one column, so order is the hierarchy. A long stack with equal weights forces her to scroll past reference text to reach what she uses every day. Fixing the order and the weights shortens every page and puts the readout, the vibrato and the toggle in one view.

**Rejected alternatives.**
- *Tabs or a segmented control on Voice (Readout / Spectrogram / Readings).* It hides the vibrato numbers behind a tap while she is singing 2 m away, where she cannot tap.
- *Hide reference sections on mobile.* Hiding content by width removes it for the people most likely to be on a phone. Collapsing keeps it one tap away.
- *Horizontal carousels for Overview features and Tools rows.* They hide three of four items behind a swipe that is easy to miss, and there are few enough items to list.
- *A bottom tab bar.* Rejected in 2.1a; still holds.
- *Make the hero fill the whole first screen and push everything else below.* She would lose the vibrato readings above the fold, which is the second thing she wants while singing.

#### Principles (FINAL)

1. **Mid-practice versus reference.** Mid-practice: the note, the FLAT / SHARP / WITHIN cue, cents, the meter, the status, the gate hint, vibrato speed and width, Start and Stop, and the A4 value she is tuned to (read-only). Reference: everything else (pitch in Hz, Off by, the spectrogram, Details, Setup including the A4 stepper, How to read this, the whole of Overview below the action, Tools detail, Methods, About). Mid-practice content is never collapsed and never below the fold of a **375 × 560 viewport** (a 375-wide phone with the browser's toolbars showing; revision 2.3a, persona review). Reference content may be.
2. **One primary action per screen**, filled ink, full width at compact:

| Screen | Primary action | Everything else |
|---|---|---|
| Overview | Start singing `#ov-start` | text links and disclosures |
| Tools | Open voice analysis | the index row is also a link, but not a button |
| Voice analysis | Start / Stop listening `#va-live-toggle`, in the fixed bar (owner decision) | disclosures; the A4 stepper inside Setup |
| Methods | none; setup has three equal checks, so all three are ghost buttons (decided) | |
| About | none; a reading page | TOC chips, disclosures |
| Not found | Go to Overview | |

3. **Order is hierarchy.** Content priority per screen is the DOM order at compact. Where the order changes, it changes in the DOM at every width, never with CSS `order`, so focus order, reading order and visual order agree (WCAG 1.3.2, 2.4.3). The wide grid placement keeps today's desktop layout.
4. **Same content at every width.** Nothing is removed from the DOM by width. Reference content collapses; it is not cut. The only things hidden at compact are the Space bar hint under the toggle (the Setup disclosure still has the Space bar switch, which says the same thing) and the breadcrumb (already hidden).
5. **The disclaimer is on every screen**, in the compact footer.

#### Touch targets (FINAL)

**Policy.** Every target's hit area is at least 44 × 44 CSS px at every width. 24 × 24 is the WCAG 2.2 AA floor (2.5.8); 44 is the target here, because she taps the phone at arm's length on a stand, often in a hurry before stepping back. The visual can be smaller than the hit area. Exempt: links inside a sentence of prose (the 2.5.8 inline exception), because enlarging them would overlap the lines above and below.

**Techniques, in order of preference.**
- **A. The element is the hit area; the visual is inside it.** The button or link is at least 44 × 44. Its smaller visual (a glyph, a fill square, a label) is an inner span or its `::before`. Negative margins on the element pull the layout back to the visual size, so the page does not grow. Use it wherever the element's own pseudo-elements are free. It hit-tests reliably, and the focus ring follows the hit area, which makes it easier to see.
- **B. Padding with a negative margin**, for standalone text links: `display: inline-block`, `padding-block: 12px`, `margin-block: -12px`, `min-width: 44px`. The line box and the underline stay where they are.
- **C. A positioned pseudo-element extender** (`::before` with negative inset), only where A and B do not fit, for example a 40px-tall button at wide (inset −2px vertically), and the existing stretched link on tool index rows (`.irow-link::after`).

Text inputs cannot have pseudo-elements and clicks on a wrapper do not focus them, so inputs are 44px tall visually as well.

**Spacing.** Hit areas of neighbouring targets may touch but never overlap, so a tap always lands on one target. Centre-to-centre distance between neighbours in a row or column is at least 44px. Visual gap between neighbouring controls is at least 8px.

| Component | Visual at compact | Hit area | Technique | Notes |
|---|---|---|---|---|
| Primary button `.btn-primary` | full width, 44 tall | same as visual | none | at wide 40 tall visual, 44 hit (C) |
| Ghost button `.btn` (Methods runs, Try again) | auto width, 40 tall, 1px ink box | width × 44 | C, `::before` inset −2px 0 | |
| Voice toggle `#va-live-toggle` in the action bar | full width, 48 tall; idle: ink fill; **listening: `--signal-text` fill with an 8px `--on-ink` live dot before "Stop listening"** (below) | same | none | 56 tall in the hero at 600 and up (2.7) |
| A4 − and + `#va-a4-dec`, `#va-a4-inc` (in Setup) | 32 × 32 square with a **1px ink outline at rest**; glyph 20px ink; `--hover` fill on press | 44 × 44 | A: button 44 × 44, the square is `::before`, margin −6px | replaces the 48px boxes of 2.8 |
| A4 input `#va-a4` (in Setup) | 76 × 44, 1px ink box, `--t-display-3` | same | none (inputs) | |
| A4 Done `#va-a4-done` (new, in Setup) | ghost button "Done", 40 tall, shown while the A4 group has focus | width × 44 | C | the iOS decimal keypad has no Done key (below) |
| Calibration input `#m-cal-hz` | 9ch × 44, 1px ink box | same | none | |
| Standalone text links (`.ov-setup-link`, "How it works, and how it is tested", Methods document links on their own line) | 14/20 text, underline | text width (min 44) × 44 | B | |
| Links inside prose | text | exempt | none | |
| Disclosure `summary` | Geist 14/20 label, **12px chevron** (2px stroke), hairline above | full row × at least 44 | the summary is the row | |
| Nav button `#nav-toggle` | "NAV" 11/16 mono plus a 12px chevron, **1px ink outline at rest**, no fill; when open the whole button fills ink (2.1a cue) | at least 44 × 44 (about 75 × 44) | none (visual = hit) | tap-affordance rule (1.10) |
| Nav panel rows | 48 tall, full width | same | none | unchanged |
| Brand `¢2$` | 20/24 text, about 30px wide | at least 44 × 56 | existing padding plus `min-width: 44px` | the short brand alone is narrower than 44 |
| About TOC chips `.about-toc-chip` | 13/20 text, **1px `--muted` underline at rest**; current one in ink with the 2px signal line | text + 24 × 44 | existing padding | |
| Tool index row | whole row; the tool name underlined at rest, "→" at the row end | whole row, at least 64 tall | C (existing stretched link) | |
| Space switch `.va-switch` | 20 × 20 checkbox plus "On" | label at least 44 × 44 | existing label | |
| Skip link | 44 tall when shown | same | | |
| Status chip, cents chip, read-only A4 value | not interactive | none | | no border on any of them (1.10 tap-affordance rule), so they never look tappable. The spectrogram "Stopped" chip is removed (2.14) |

#### Layout patterns that replace "everything in a box"

**When a panel becomes a section.** Always, in Paper (1.10). Tier-1 sections get the ink top rule and a Newsreader title; tier-2 groups get a hairline and a mono label. The only surface is the Voice hero.

**Type and spacing tokens, compact (under 600px).** New tokens live in the Paper block of `theme.css`, with the compact values in its `max-width: 599px` block. Values not listed are unchanged from 1.5 and 1.6.

| Token | Wide (600 and up) | Compact | Was (compact) |
|---|---|---|---|
| `--t-display-1` | 40/44 | **28/32** | 32/36 |
| Voice h1 | 40/44 at 960+, 32/36 at 600 to 959 | **20/24** | 24/28 |
| `--t-display-2` | 26/32 | **22/28** | 26/32 |
| `--t-display-3` | 24/28 | **20/24** | 24/28 |
| `--t-h3` (new) | Geist 600 15/20 | same | none |
| `--t-hero` | clamp(104px, 30cqi, 200px) | **clamp(120px, 36cqi, 152px)** | clamp(104px, 30cqi, 200px) |
| `--t-cue`, `--t-chip` | 32/36 | **40/44** (revision 2.3a: readable from 2 m; inside the cue, the "±{tol} c" suffix is 0.6em, 24px, so "WITHIN ±10 c" fits at 320) | 24/28 |
| `--t-reading` (new) | Newsreader 350 28/32, tabular figures | same | none; the vibrato speed and width numbers, unit after them in `--t-body-s` |
| `--t-hint` | 18/24 | 18/24 | unchanged |
| `--t-body`, `--t-body-s`, `--t-label`, `--t-mono` | as 1.5 | as 1.5 | unchanged; 14px body stays (a 16px body would add about 15% to every page) |
| `--sec-gap` (new) | 48 | **32** | `--gap-panel` 20 plus two borders |
| `--sec-head-pad` (new) | 12 0 16 | **8 0 12** | `--strip-pad` 8 16 |
| `--group-gap` (new) | 24 | **20** | |
| `--item-gap` (new) | 20 | **16** | |
| `--row-pad-y` (new) | 12 | **10** | `--row-pad` 12 16 |
| `--route-pad-top` (new) | 24 | **0** (the page header has its own) | 24 |
| `--route-pad-bottom` (new) | 64 | **32** | 64 |
| page header padding | 24 0 | **16 0 12** | 16 0 |
| `--hit` (new) | 44 | 44 | |
| `--bar-h` (new) | none | **64** (8 + 48 + 8, plus the bottom inset) | |
| `--gutter` | 32 | 16 | unchanged |

**Two-column key-value pairs.** `.kv-list` is an inline-size container. While it is at least 280px wide, each row is label (2fr, `--muted`) and value (3fr, weight 500) on one line, with the action (if any) under the value. Under 280px it stacks. At 375 the list is 343px wide, so it is two columns at every phone width from 320 (288px). Voice Readings use a different pattern, the **stat grid**: two cells per row, mono label above the value, a vertical hairline between the columns, no horizontal rules (the reference's stat cells).

**Horizontal snap rows.** Only the About "On this page" chips (`.about-toc`), which already scroll sideways and stay pinned. Add `scroll-snap-type: x proximity` and `scroll-snap-align: start` on chips so a flick lands on a chip edge. Nowhere else: every other row has few enough items to list, and a sideways row hides items.

**Progressive disclosure for reference content.** Long reference blocks become `<details>`. A new attribute `data-open-wide` marks disclosures that are open at 600 and up and closed under 600. The router sets `open` once, at render, from `matchMedia('(min-width: 600px)')`, before the view is shown, so nothing animates and nothing changes when she rotates or resizes afterwards. Disclosures without the attribute keep their existing default (closed).

| Disclosure | Where | Default |
|---|---|---|
| How to use it | Overview | `data-open-wide` |
| Not built yet | Overview | `data-open-wide` |
| Technical checks | Overview | closed (unchanged) |
| Method (one per check) | Methods | `data-open-wide` |
| Details, Setup | Voice | closed (unchanged) |
| How X is measured, How it is tested | About | closed (unchanged) |

Not collapsed, on purpose: Voice "How to read this". It holds the octave-jump caveat and the way to check a wrong reading (section 4), which is the correction path when the tracker is wrong. That must stay one scroll away, not behind a tap.

**Fixed bottom action (Voice, compact portrait; owner decision, FINAL).** `#va-live-toggle` sits in `.va-actionbar`, `position: fixed` at the bottom of the viewport, full width, `--bg` background, a hairline on top, 8px padding above and `max(8px, env(safe-area-inset-bottom))` below.
- Why there: the bottom of the screen is where a thumb reaches without shifting the grip, she taps Start and then steps back, and Stop stays on screen while she scrolls to the spectrogram or Setup. It also takes the 56px toggle and the Space hint out of the hero, which is what lets the vibrato readings fit above the fold.
- DOM: the bar stays where the toggle is today, at the end of the hero, so the focus order is hero then toggle then Readings. Being fixed changes where it is drawn, not the order.
- **Two states that read from 2 m (revision 2.3a).** Idle, stopped, ended and error: ink fill, `--on-ink` label ("Start listening" or "Try again"). Listening: **`--signal-text` fill (`#C2360F`), an 8px `--on-ink` dot before the label, label "Stop listening"**. `--on-ink` on `#C2360F` is 4.81:1 (1.4). The change is colour, a shape (the dot) and the word, so it never relies on colour alone. Busy (requesting, stopping): disabled at 0.5 opacity with the busy label, as 2.7. The fill changes on the frame `live.ts` reports the state; nothing animates. Hover on the idle toggle uses `--ink-2`, not `--signal-text`, so a desktop hover never looks like "listening". The same treatment applies to the toggle in the hero at 600 and up and in the landscape title row.
- On-screen keyboard: while any input in the Voice route has focus (`.va-route:has(input:focus)`), the bar gets `visibility: hidden`. On iOS a fixed bar can ride above the keyboard and cover the focused field (WCAG 2.4.11); on Android it sits behind the keyboard. Hiding it causes no layout shift, because it is out of flow. Space and Enter in the field do not toggle (3.3), so nothing is lost. The only input on Voice is now A4, inside Setup.
- **Leaving the A4 field (revision 2.3a).** The iOS decimal keypad (`inputmode="decimal"`) has no Done or Return key, so she needs a way out that does not depend on the keyboard. Three ways commit the value, and each one ends the hidden state:
  1. **Done**: a ghost button `#va-a4-done` "Done" at the end of the A4 row, shown while the A4 group has focus (`.va-a4:focus-within`), so it is still there when focus moves from the field onto it. Activating it validates and applies the value (2.8 rules), then moves focus to the Done button itself, so no input has focus and the bar returns. It hides once focus leaves the group.
  2. **Enter** (hardware keyboards, and the Go or Next key on Android keypads): `keydown` with `key === 'Enter'` in `#va-a4` validates and applies, then blurs the field.
  3. **Blur** (tapping anywhere else, or the iOS accessory bar's own Done where the browser shows one): the existing `change` and blur validation applies.
  An invalid value shows the field error and keeps the last valid value (2.8); the bar still returns. The bar never stays hidden after focus has left the input (MOB-14a to MOB-14e).
- Room for it: the route gets `padding-bottom: calc(var(--bar-h) + env(safe-area-inset-bottom))`, and on Voice compact the footer gets the same extra bottom padding, so the last content and the disclaimer are never under the bar.
- Not on other screens: their primary actions are near the top and used once.
- Insecure page (VA-14): there is no toggle, so the bar is not rendered.

**Safe-area insets.** `index.html` viewport meta adds `viewport-fit=cover` (specified; the coordinator is clearing it with the `#/legacy` session). Then: `.shell` inline padding is `max(var(--gutter), env(safe-area-inset-left))` and the same on the right; the header row and the Nav panel use the same; the action bar and the footer add `env(safe-area-inset-bottom)` to their bottom padding; the sticky About TOC adds `env(safe-area-inset-top)` to its top only when pinned (`top: env(safe-area-inset-top)`).

**Compact footer.** One paragraph in `--t-body-s`: "For practice and study. Not a diagnostic or medical device. Audio stays in this browser and is not saved." 12px padding above, 16px below plus the inset. About 3 lines, at most 100px tall at 375 (MOB-36).

#### Per-screen layouts at 375

Heights are design targets for the idle state at 375 wide (measured with a 375 × 667 window; page height does not depend on window height), Nav closed, disclosures in their default state, fonts loaded. Fold checks on Voice use 375 × 560 (principle 1). They come from the type and spacing tokens, so they are estimates; MOB-01 to MOB-06 assert them. If the build misses a target, report it as a failure; do not change the target.

| Screen | Now | Target | Change |
|---|---|---|---|
| Overview | 2694 | **1450 or less** | −46% |
| Tools | 1733 | **1550 or less** (re-budgeted for five tool rows, revision 2.3a; measured 1508) | −11% |
| Voice analysis | 1862 | **1500 or less** | −19%, and the vibrato readings move from about 1060 to above the fold |
| Methods | 1582 | **1450 or less** | −8% (it is mostly needed text) |
| About | 2954 | **2700 or less** | −9%. Length is not the problem on a reading page; monotony is |
| Not found | not captured | **667 or less** (no scroll) | |

In the wireframes, `=` is an ink rule, `-` a hairline, `#` the Voice hero surface, `[ ]` a control or data frame, and `~~ fold ~~` the bottom of a 375 × 667 viewport (the Voice wireframes use 375 × 560). y values are approximate.

**Overview `#/`.** Job: start singing. Read first: h1, then Start singing.
- Order: page header (h1, lede, Start singing, Setup checks); What it shows you (4 items, no lines); How to use it (disclosure); Good to know (two notes and the About link); tier-2 label "Setup and roadmap" with Technical checks and Not built yet as disclosure rows; footer.
- Visible on first load: the whole page header including Start singing and Setup checks, and the start of "What it shows you". Must be: `#ov-start` (MOB-20).
- Collapses: How to use it, Not built yet (both `data-open-wide`), Technical checks (closed everywhere).
- Cut at every width: the third "Good to know" note ("For practice and study / Not a diagnostic or medical device."), because the footer carries the same line on the same screen. Nothing else.

```
y    375
0    +-----------------------------------------+
     | ¢2$                              NAV v  |
57   |=========================================|
     | Cents to Dollars                        |  h1 28/32
     | See the note you are singing, how many  |  lede 14/20
     | cents sharp or flat you are, and your   |
     | vibrato. Runs in this browser; audio is |
     | not saved or uploaded.                  |
     | [########### Start singing ###########] |  primary, 44
     | Setup checks                            |  link, 44 hit
     |                                         |
~330 |=========================================|
     | What it shows you                       |  h2 22/28
     | The note you are on                     |  h3 15/20
     | The nearest note, large enough to read  |
     | from across the room, and how many ...  |
     | Your vibrato                            |
667  ~~~~~~~~~~~~~~~~~~ fold ~~~~~~~~~~~~~~~~~~~~
     | How many times a second your pitch ...  |
     | Your ring ...                           |
     | A picture of your sound ...             |
     |-----------------------------------------|
     | How to use it                         v |  disclosure, closed
     |=========================================|
     | Good to know                            |
     | PRIVATE                                 |  mono dt
     | Your voice is measured in this browser..|
     | CLOSE, NOT PERFECT                      |
     | The live reading can jump an octave ... |
     | How it works, and how it is tested ->   |
     |                                         |
     | SETUP AND ROADMAP                       |  tier-2 label
     |-----------------------------------------|
     | Technical checks                      v |
     |-----------------------------------------|
     | Not built yet                         v |
     |-----------------------------------------|  footer hairline
     | For practice and study. Not a diagnostic|
     | or medical device. Audio stays in this  |
     | browser and is not saved.               |
~1400+-----------------------------------------+
```

**Tools `#/tools`.** Job: open Voice analysis. Read first: h1, then the index, then the Voice analysis detail and its button.
- Order: page header; Tool index (tier-1, hairline rows); Voice analysis (tier-1, title "Voice analysis", meta = the `data-va-status` value; description; **Open voice analysis** moved up to sit right after the description, at every width; then Shows / Input / Analysis window as a two-column kv list; then tier-2 "Requirements" and its kv rows); footer.
- The "Selected: 01" strip text goes; there is one selectable tool, and the selected row already shows the fill and bar.
- Visible on first load: page header and the first two or three index rows. Not required above the fold: the index row for Voice analysis is itself a link.
- Collapses: nothing; the page is short once the boxes go.
- Cut: nothing.

```
y    375
0    | ¢2$                              NAV v  |
57   |=========================================|
     | Tools                                   |
     | Tools for singing practice that run in  |
     | this browser. Pick a tool to see what   |
     | it shows and what it needs, then open   |
     | it. Use the same room and the same ...  |
~230 |=========================================|
     | Tool index                              |
     ||01 Voice analysis             * Ready  ||  selected: fill + signal bar
     || Note, cents sharp or flat, vibrato and ||
     || a picture of the sound, live as you    ||
     || Input: Live listening                  ||
     |-----------------------------------------|
     | 02 Aural skills         o NOT BUILT YET |
     | Interval recognition and pitch matching |
     | Input: Audio output                     |
     |-----------------------------------------|
667  ~~~~~~~~~~~~~~~~~~ fold ~~~~~~~~~~~~~~~~~~~~
     | 03 Source separation ...                |
     | 04 Repertoire register ...              |
     |=========================================|
     | Voice analysis                    READY |
     | Shows the note you are singing, ...     |
     | [###### Open voice analysis  ->  #####] |
     | Shows            Note, cents, pitch,    |
     |                  vibrato speed and ...  |
     |-----------------------------------------|
     | Input            Live listening         |
     |-----------------------------------------|
     | Analysis window  {bufferSize} samples   |
     | REQUIREMENTS                            |
     | Permission to    o Not asked yet        |
     | listen                                  |
     |-----------------------------------------|
     | Browser audio    * Available            |
     |-----------------------------------------|
     | Secure page      * Yes                  |
     |-----------------------------------------|  footer
~1350+-----------------------------------------+
```

**Voice analysis `#/voice`.** Job: sing and read the result. Read first: the note, then the cue and cents, then the meter, then the status, then vibrato. Details in the next subsection.
- Order (DOM, every width): page header row (h1 and status chip); hero (note slot holding the note or the one system message (2.14), the cents chip and the read-only A4 value, cue, meter, caption or gate hint, level, action bar); Readings (stat grid: Vibrato speed, Vibrato width, Pitch, Off by; then the Details disclosure); Spectrogram; How to read this; Setup (now including the A4 stepper and Done); footer.
- Visible on first load at 375 × 560, and must be (MOB-07 to MOB-11): the note, the cue, the cents chip, the meter, the read-only A4 value, Start / Stop, and the vibrato speed and width values. Pitch and Off by sit just below the fold.
- Collapses: Details and Setup (unchanged). How to read this stays open (above).
- Hidden under 600: the "Space bar also starts and stops" line. On a phone it describes a key the device usually does not have, and in the action bar it would add 20px to every screen. The Setup "Space bar shortcut" switch stays, because a phone can have a Bluetooth keyboard and a narrow desktop window has a real one.

**Methods `#/methods`.** Job: run one check on a new setup. Read first: h1 and the lede that says she does not need this to sing.
- Order: page header; Calibration; Loopback latency; Self-test; Documents; footer. Each check is a tier-1 section: title, status as mono meta, purpose, requirement, input (Calibration), ghost Run button, progress line, results, then a "Method" disclosure.
- Visible on first load: page header and Calibration down to its Run button.
- Collapses: the three Method notes (`data-open-wide`). Results, when present, are never collapsed.
- Cut: nothing. Deep links (`#/methods/calibration` and so on) scroll to the section title as today; the title clears the header with `scroll-margin-top: var(--s-4)`.

```
y    375
0    | ¢2$                              NAV v  |
57   |=========================================|
     | Methods and setup checks                |  may wrap to 2 lines
     | Run these once on a new laptop, phone   |
     | or room. You do not need them to sing.  |
~190 |=========================================|  becomes the state bar when run
     | Calibration       o NOT RUN THIS VISIT  |
     | Checks how closely your setup reads a   |
     | tone of known pitch. Play a steady ...  |
     | Needs permission to listen and a steady |
     | reference tone, for example from a ...  |
     | Reference [   440 ]  Hz, 60 to 2000     |
     | [ Measure for 5 s ]                     |  ghost
     |-----------------------------------------|
     | Method                                v |
667  ~~~~~~~~~~~~~~~~~~ fold ~~~~~~~~~~~~~~~~~~~~
     |=========================================|
     | Loopback latency  o NOT RUN THIS VISIT  |
     | ... [ Play 10 test tones ]              |
     | Method                                v |
     |=========================================|
     | Self-test         o NOT RUN THIS VISIT  |
     | ... [ Run the self-test ]               |
     | Method                                v |
     |=========================================|
     | Documents                               |
     | MEASUREMENT.md defines every ...        |
     |-----------------------------------------|  footer
~1400+-----------------------------------------+
```

**About `#/about`.** Job: understand what the app is and how far to trust it. Read first: h1 and lede, then the pinned chips.
- Order: unchanged (page header, pinned chips, Who it's for, What it measures, How accurate it is, Your privacy, What it isn't, Coming later, footer).
- Visible on first load: page header, chips, and the start of "Who it's for".
- Collapses: the existing "How X is measured" and "How it is tested" disclosures. Sections do not collapse: this is the page she came to read, and collapsed sections would break the chip jumps.
- Cut: nothing. The chips row is the one snap row in the app.

```
y    375
0    | ¢2$                              NAV v  |
57   |=========================================|
     | About Cents to Dollars                  |
     | Cents to Dollars shows you what your    |
     | voice is doing while you sing: ...      |
     |-----------------------------------------|  pinned while scrolling
     | Who it's for  What it measures  Accur>  |  snap row, 44 tall
     |-----------------------------------------|
     |=========================================|
     | Who it's for                            |
     | I built Cents to Dollars for an opera   |
     | singer, ...                             |
667  ~~~~~~~~~~~~~~~~~~ fold ~~~~~~~~~~~~~~~~~~~~
     |=========================================|
     | What it measures                        |
     | Your note, and how far above or below   |  h3 20/24
     | ...                                     |
     |-----------------------------------------|
     | How the pitch is measured             v |
     | Your vibrato ...                        |
     | ... (sections continue, no boxes)       |
~2650+-----------------------------------------+
```

**Not found.** Job: get back. Order: h1 "Page not found", "There is no page at this address.", Go to Overview (primary, full width). The footer sits at the bottom of the viewport (the page is a column with `min-height: 100vh` today). Nothing collapses or is cut.

```
y    375
0    | ¢2$                              NAV v  |
57   |=========================================|
     | Page not found                          |
     | There is no page at this address.       |
     | [########### Go to Overview ##########] |
     |                                         |
     |                                         |
~570 |-----------------------------------------|
     | For practice and study. Not a diagnostic|
     | or medical device. Audio stays in ...   |
667  +-----------------------------------------+
```

#### Voice analysis in detail

**Can she see her vibrato on the spectrogram? Mostly not, and the layout should not pretend she can.** The plot shows 0 to 4 kHz (`SPEC_TOP_HZ`) over 200 CSS px at compact, so 20 Hz per pixel. A ±50 cent vibrato on A4 (440 Hz) swings about ±12.9 Hz (440 × (2^(50/1200) − 1)), which moves the orange F0 marks by under one pixel. Upper partials swing more in hertz (the fifth partial by about ±64 Hz, about ±3px), so a wide vibrato shows as a slight waviness in the upper bands, and that is all. Where she can see her vibrato: **the cents meter marker** (no smoothing, 2.9), whose track spans −50 to +50 c over the full hero width, so a ±50 c vibrato sweeps it edge to edge; and **Vibrato speed and Vibrato width** in Readings. So the layout puts the meter and those two readings in the first viewport, and the spectrogram after them. A pitch-over-time trace would show vibrato directly; it is a later feature (section 10), not specified here.

**Portrait budget at 375 × 560 (revision 2.3a).** Real phone browsers with their toolbars showing leave about 560px of a 667px screen (persona review), so the first screen is budgeted against 560, with the 64px bar inside it: the bar top is at 496. This supersedes the 375 column of the 3.3 budget table; VA-47 still holds.

| Block | Height | y at end |
|---|---|---|
| App header | 57 | 57 |
| Page header row: h1 "Voice analysis" 20/24 left, status chip right (mono 12/16 with dot), min-height 44 | 44 | 101 |
| Hero top rule, 2px ink | 2 | 103 |
| hero padding top | 12 | |
| note row: the note at `--t-hero` (about 124px at 375) on the left; on the right, the cents chip (40/44) at the top and the read-only "A4 {a4} Hz" (`--t-label`, `--muted`) under it | 124 | |
| cue `#va-readout-dir`, 40/44, own line | 8 + 44 | |
| meter `#va-cents-meter` | 8 + 24 | |
| caption and gate hint, **one shared 24px slot** | 8 + 24 | |
| level bar, 4px | 8 + 4 | |
| hero padding bottom, bottom rule 2px | 12 + 2 | 381 |
| Readings: 12 gap; the tier-2 label "Readings" is visually hidden under 600 (still the group's heading for screen readers); hairline | 13 | 394 |
| stat grid row 1: Vibrato speed and Vibrato width. Mono label 16, 4, value at `--t-reading` 28/32, note line "last 2.5 s" 20 | 72 | **466** |
| Action bar top (560 − 64) | | **496** |
| stat grid row 2: Pitch and Off by, values at `--t-body` weight 500 | about 64 | about 534, below the bar |

The note, the cue, the cents chip, the meter, the read-only A4 value, both vibrato values and the toggle are visible at scroll 0 with 30px of margin. **If anything grows, Pitch and Off by leave the fold first; the cue, the chip and the vibrato values never shrink to make room** (persona review). The A4 row (52px) and the old 28px cue are what paid for the bigger type. At 375 × 667 everything above, plus Pitch and Off by, is visible.

**Hero decisions.**
- **Full-bleed band.** The hero spans the full 375 (negative gutter margins) with 16px inner padding, so the note gets 343px of container and grows to about 124px. `--panel` fill plus **2px ink rules top and bottom** (1.10, "The hero needs edges"), so the instrument has edges on a glary stand.
- **Note size.** `--t-hero` compact is clamp(120px, 36cqi, 152px): 120 at 320, about 124 at 375, about 140 at 430. Today it is about 104 at 375. The cap keeps the fold budget at 430 to 599. Readable from 2 m is the section 0 assumption, and I have no measurement for it (open question 2).
- **Cue and cents at 40px** (`--t-cue`, `--t-chip` compact, revision 2.3a). From 2 m, the direction and the size of the error matter as much as the note name. The cue's "±{tol} c" suffix is 24px (0.6em), so "WITHIN ±10 c" is about 250px wide and fits in 288px at 320. The chip ("−13 c" at 40px mono, about 136px with padding) sits beside the note: about 131 + 8 + 136 = 275px, inside 288 at 320.
- **Cents chip: fill, no border.** `--hover` fill and ink text; within tolerance `--ok` fill with `--on-ink` text (5.52:1); stale `--hover` with `--muted` text (4.67:1). It is a readout, so it must not look like a button (1.10 tap-affordance rule).
- **Status chip moves to the page header row**, right of the h1, at every width. Its states describe the page, and it frees the strip row. The "Note" label goes; `.va-hero` gets `aria-label="Note"`.
- **System messages go in the note slot** (2.14). In any message state the note slot holds the one callout, the cue row keeps its height but is hidden, the meter shows its empty track, and the bar holds the action. The slot is at least 120px, which holds the longest callout at 320.
- **Caption and gate hint share one slot.** "Nearest note in equal temperament" shows by default; while the gate hint is active, the hint replaces it in the same 24px slot. They are never needed at the same moment: the hint only shows when there is no pitch to name. VA-19 holds; VA-20 has the new copy (2.14).
- **A4 moves to Setup** (revision 2.3a). She sets A4 once per piano or ensemble, not mid-phrase. The stepper (−, input, +, "Hz", Done) becomes the first row of the Setup disclosure. The hero keeps a **read-only "A4 {a4} Hz"** under the cents chip, so she can still see what the note is named against. It is plain text with no border and is not focusable. Its accessible text is the same, and the hero's note announcement is unchanged. 2.8's validation, saving and announcement rules stay.
- **Level bar** 4px, no border (1.10). Still `aria-hidden`.
- **Space hint** hidden under 600; at 600 and up it stays under the toggle.

**Readings as a stat grid.** Two columns, a vertical hairline between them, no horizontal rules. Cell: mono label (`--t-label`, `--muted`) above the value. DOM order changes to Vibrato speed, Vibrato width, Pitch, Off by, at every width: vibrato is the reading the hero does not already show. **Vibrato speed and width numbers use `--t-reading` (Newsreader 28/32)** with the unit after them in `--t-body-s` ("{r}" then "per second", "±{e}" then "cents"), so she can read them from the stand. Pitch and Off by stay `--t-body` weight 500; they are for checking up close. Empty text such as "No vibrato found in the last 2.5 s" is `--t-body-s`, two lines in a 163px cell, which fits the 52px value-and-note space. The notes "last 2.5 s" and "up and down from the middle" stay under each value in `--t-body-s`. The Details disclosure follows the grid. **The type in this paragraph is superseded by "Readings type hierarchy" below (2026-11-09).**

**Spectrogram.** Tier-2 label "Spectrogram" with meta "0 to 4 kHz, last {span} s" (computed, 2.10) followed by the state word from 2.14 ("Not listening", "Waiting for sound", "Stopped") in `--muted`. Plot area 200px tall at compact, the only box. **No overlay of any kind on the plot** (2.14). Legend and caption below, unchanged.

**Landscape (phone on its side). In scope (owner: she uses both).** Applies when `(orientation: landscape) and (max-height: 500px)`, whatever the width, so 667 × 375 to 932 × 430. Budgeted against **667 × 320**, the same toolbar allowance as portrait.
- Header: the compact header with the Nav button (2.1a compact), even at widths of 600 and up. The medium header's second nav row would cost about 48px of a short screen. `nav.ts` uses the same media query for its `matchMedia` (it is `(max-width: 599px)` today).
- Page header row (48px): h1, status chip, and **`#va-live-toggle` at the right end of the row**, 44px tall, auto width, with the same two-state treatment as the bar. The owner's fixed-bar decision is for portrait; in landscape a bottom bar would take 64 of 320px, and her thumbs are at the sides of the phone, not the bottom. (My call; flagged in the changelog.)
- The hero is a band with ink rules top and bottom. Row 1 puts the note (the 1.5 minimum, 104px), the cue (40/44) and the cents chip (40/44) side by side: about 113 + 250 + 136 plus gaps, about 525px. Row 2: the meter. Row 3: the caption or hint slot on the left and the read-only "A4 {a4} Hz" on the right. Row 4: the level bar. Height: 2 + 12 + 104 + 8 + 24 + 8 + 24 + 8 + 4 + 12 + 2 = 208, ending at 57 + 48 + 208 = 313, inside 320. The cue and chip never stack under the note in landscape; that would push the meter out of view.
- **When the viewport is at least 800px wide** (most current phones on their side, 844 to 932), the route becomes a two-column grid for its first row: the hero (about 560px) and, to its right, the Readings group showing the vibrato pair. Below 800 (667 to 799), Readings follow the hero full width.
- Then, full width: the rest of Readings, the spectrogram (200px plot), How to read this, Setup.
- Fold at 667 × 320: the note, cue, cents chip, meter, read-only A4 and toggle are visible at scroll 0 (MOB-41). The vibrato values are not, and the meter shows the swing. At 844 × 320 the vibrato values are visible too (MOB-41a).
- A message state (2.14) uses the hero's note area for the callout, as in portrait.

```
Key: `##` rows are the hero's 2px ink rules; `{ }` is a filled readout (no border).

Portrait, idle, 375 x 560
y    375
0    +-----------------------------------------+
     | ¢2$                            [NAV v]  |  Nav outlined
57   |=========================================|
     | Voice analysis                  o IDLE  |
103  |#########################################|  2px ink rule, full bleed
     |  No pitch yet                           |  panel fill
     |  Press Start listening and sing a       |
     |  steady note. Audio stays in this       |
     |  browser and is not saved.    A4 440 Hz |  read-only
     |                                         |
     |  (cue row, hidden, keeps its 44px)      |
     |  [-50 ..........|.......... +50]        |  meter, no marker
     |  Nearest note in equal temperament      |  caption / hint slot
     |  ____________________________________   |  level, 4px
381  |#########################################|  2px ink rule
     | VIBRATO SPEED       | VIBRATO WIDTH     |
     | No vibrato found in | No vibrato found  |
     | the last 2.5 s      | in the last 2.5 s |
466  |                     |                   |
496  |-----------------------------------------|  action bar, fixed
     | [########## Start listening ##########] |  ink fill
560  +-----------------------------------------+

Portrait, listening with pitch, 375 x 560
57   |=========================================|
     | Voice analysis             * LISTENING  |
103  |#########################################|
     |   ___    #                              |
     |  |   |   4                 {  -13 c  }  |  note ~124px, chip 40px
     |  |___|                       A4 440 Hz  |
     |  <-  FLAT                               |  cue 40px
     |  [-50 .........|..[]...... +50]         |  marker swings with vibrato
     |  Nearest note in equal temperament      |
     |  ||||||||||||||______________________   |
381  |#########################################|
     | VIBRATO SPEED       | VIBRATO WIDTH     |
     | {r} per second      | ±{e} cents        |  {r}, {e} at 28px
     | last 2.5 s          | up and down ...   |
496  |-----------------------------------------|
     | [##### * Stop listening  (signal) ####] |  signal fill + live dot
560  +-----------------------------------------+
     (below the fold: Pitch, Off by, Details, SPECTROGRAM 0 to 4 kHz,
      last {span} s, the 200px plot, legend, caption, How to read
      this, Setup with A4 stepper, footer)

Portrait, listening blocked, 375 x 560
     | Voice analysis       o LISTENING BLOCKED|
103  |#########################################|
     | (!)| Listening is blocked for this page. |  callout, 3px signal rule
     |    | In your browser's site settings,    |
     |    | allow Microphone for this site,     |
     |    | then press Try again.               |
     |                               A4 440 Hz |
     |  [-50 ..........|.......... +50]        |  empty track
     |  Nearest note in equal temperament      |
381  |#########################################|
     | VIBRATO SPEED       | VIBRATO WIDTH     |
     | No vibrato found in | No vibrato found  |  their own empty text only
496  |-----------------------------------------|
     | [############# Try again #############] |
560  +-----------------------------------------+
     (below: SPECTROGRAM  0 TO 4 KHZ, LAST {span} S  NOT LISTENING,
      then the empty plot with its axis, no text over it)

Landscape, listening, 667 x 320
0    | ¢2$                                                  [NAV v] |
57   |================================================================|
     | Voice analysis   * LISTENING         [ * Stop listening ]      |
105  |################################################################|
     |   ___   #                                                      |
     |  |   |  4    <-  FLAT      {  -13 c  }                         |
     |  |___|                                                         |
     |  [-50 ...............|....[]............. +50]                 |
     |  Nearest note in equal temperament                 A4 440 Hz  |
     |  ______________________________________________                |
313  |################################################################|
320  ~~~~~~~~~~~~~~~~~~~~~~~~ fold ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
     (at 844 x 320 and wider, the vibrato pair sits to the right of
      the hero in the first row)
```

#### Readings type hierarchy (2026-11-09)

**Problem.** The owner: "typography needs to be improved. there isn't a hierarchy." In the empty state, which is what she sees before she sings and between phrases, each Readings cell shows three levels at one level. `.va-stat-v[data-empty]` drops the value to `--t-body-s` `--muted`, the same as the note under it (`.va-kv-note`), and the 11px mono label is only a little different. So nothing on the grid reads first. The same rule also makes the grid jump: a vibrato value grows from a 20px line to a 32px line when the first number arrives, and the width note grows from one line to two ("up and down from the middle" is about 175px at 13px, and the cell is about 158px at 375). The rows below move by up to 32px at the moment she starts singing.

**User.** The primary user (section 0) reads Voice from a music stand about 2 m away, mid-phrase. From the stand she needs the two vibrato numbers. Up close, she checks Pitch and Off by, and the label and note tell her what a number is and over what window.

**Read order.** 1, the vibrato values (or, empty, the words that stand where they go). 2, the label above, which names the value. 3, the note under it, which qualifies it. Pitch and Off by come after the vibrato pair: the hero already shows the note and the cents at 120px and 40px, so these two are for checking, not for reading from the stand.

**Decision (FINAL unless noted).** Same at every width: none of these tokens has a compact value except `--t-display-2` (26/32 wide, 22/28 under 600).

| Level | Vibrato cells (`.va-stat-big`) | Pitch, Off by |
|---|---|---|
| Label | `--t-label` 11/16 mono, uppercase, `--t-label-ls`, `--muted` (unchanged) | same |
| Label to value | `--s-1`, 4px (unchanged) | same |
| Value, filled | number `--t-reading` (Newsreader 350 28/32), tabular figures, `--ink`; unit after it `--t-body-s`, `--ink` (unchanged) | `--t-body` 14/20, weight `--t-body-strong` (500), `--ink` |
| Value, empty | `--t-display-2` (26/32, compact 22/28), `--t-display-2-ls`, `--muted`, in the same 32px line box | `--t-body` 14/20, weight 400, `--muted`, same line box |
| Value line height, both states | at least 32px (the `--t-reading` line) | at least two lines (`2lh`, 40px) |
| Value to note | 0; the 32px line box gives the space | no note |
| Note | `--t-body-s` 13/20, `--muted`, one line, "last 2.5 s" in both cells and both states | none |

Cell heights (padding 8 top and bottom, unchanged): vibrato row 16 + 4 + 32 + 20 = 72, the budget in the 375 table above, empty and filled. Pitch and Off by row 16 + 4 + 40 = 60, empty and filled.

**Reasons.**
- *The empty value keeps the value's place and family, not the note's.* The empty words stand where the number will be, so they belong to the value level: Newsreader, about the same size, in `--muted`. `--t-display-2` is the token 1.5 already names for empty readout text (the hero's "No pitch yet" uses it), so the hero's empty note, in ink on the surface, stays equal to or larger than the Readings placeholder. At 375 that is 22px muted against 28px ink numbers, close enough that the cell does not change shape, different enough that a placeholder never looks like a reading.
- *Fixed line boxes.* The value line is at least 32px in vibrato cells and two lines in Pitch and Off by, so neither the empty-to-filled change nor a value that wraps moves the rows below. "13 cents sharp of A♯4" is about 150px at 14px and wraps at 320 to 375 while "0 cents from A4" does not, so Off by changed height at frame rate.
- *The note is one line, always.* The width note becomes "last 2.5 s", the same as speed. "Up and down from the middle" took two lines and only appeared once there was a number, which is the 20px jump. The explanation of ± moves to How to read this (copy below). Both values cover the same window, so the note is the same.
- *Pitch and Off by stay at body size.* They repeat what the hero shows larger, and at `--t-reading` Off by would wrap to two 32px lines in a 158px cell. They get a real value level instead: ink and weight 500 against a muted mono label, and the empty text keeps the value's size (it was 13px, now 14px) and drops only the colour and weight.

**Rejected.**
- *Empty value at `--t-reading` itself, only muted.* Simplest and stable, but at compact a 28px "None yet" outranks the hero's 22px "No pitch yet" in the empty state, and the hero must lead.
- *Keep the empty value small and reserve the height with `min-height` only.* Stable, but it keeps the problem the owner named: the empty value and the note stay the same size and colour.
- *Pitch and Off by at `--t-reading`.* Off by wraps and jitters, it duplicates the hero at a size meant for the stand, and it spends the fold margin (if anything grows, these two leave the fold first, per the budget above). Splitting Off by into a big number and small words, like the vibrato cells, is possible later (open question 2).
- *Reserve two note lines in the vibrato cells instead of shortening the copy.* Costs 20 of the 30px fold margin at 375 × 560.
- *Note in `--t-caption` (Newsreader italic, `--ink-2`).* It would be darker than the label, so the qualifier would outrank the name.

**CSS (voice.css, replaces the stat-grid type rules; order matters, the later rules win on equal specificity).**

| Selector | Declarations |
|---|---|
| `.va-stat-label` | unchanged: `font: var(--t-label); letter-spacing: var(--t-label-ls); text-transform: uppercase; color: var(--muted)` |
| `.va-stat-body` | unchanged: `margin: var(--s-1) 0 0` |
| `.va-stat-v` | `font: var(--t-body); font-weight: var(--t-body-strong); color: var(--ink); overflow-wrap: anywhere; min-height: 2lh` |
| `.va-stat-v[data-empty]` | `font-weight: 400; color: var(--muted)` (no font change, so the size stays 14/20) |
| `.va-stat-big .va-stat-v` | `font: var(--t-reading); font-variant-numeric: tabular-nums; min-height: 32px` (the `--t-reading` line height; overrides the `2lh` above) |
| `.va-stat-big .va-stat-v[data-empty]` | `font: var(--t-display-2); letter-spacing: var(--t-display-2-ls); color: var(--muted)` |
| `.va-num` | `font: inherit; font-variant-numeric: tabular-nums` (the value element now carries `--t-reading`, so the line box is the number's) |
| `.va-stat-unit` | unchanged: `font: var(--t-body-s)` |
| `.va-stat .va-kv-note` | `margin: 0; font: var(--t-body-s); color: var(--muted)` |

**Markup and copy (voice.ts).**
- `stat()`: in the two vibrato cells the note is rendered from the start, not `hidden`, with the text `last 2.5 s` (`VIB_WINDOW_NOTE`), so the first paint already has the note line. Pitch and Off by keep their hidden, empty note.
- `render()`: `el.mVibWidthNote` is always `VIB_WINDOW_NOTE`.
- How to read this gets one sentence after the cents paragraph: "Vibrato width is how far your pitch goes up and down from the middle, in cents. Vibrato speed is how many times a second it does that." (Owner confirmed the copy, 2026-11-09.)

**Details (Voice) and Readings at cursor (#/file): the same problem, smaller.** Both use `.kv` rows: label `--t-body` `--muted`, value weight 500 `--ink`, note `--t-body-s` `--muted`. Filled, the value already stands out by ink and weight, and the label and note sit apart (label left, note under the value), so the three levels do not collapse. **But placeholders render as values**: "No pitch", "Not listening", "Shown while listening", "No voiced frames in the last 2.5 s", "No pitch at this time", "No window covers this time" and "Not measured" are ink, weight 500, like a measurement. 2.14 says placeholders are `--muted`. Both lists are read up close, so no size change.
- components.css: `.kv-value[data-empty] { font-weight: 400; color: var(--muted); }` (shared by Voice, #/file and Methods).
- voice.ts: `kv()` takes a flag for whether its initial text is a placeholder and sets `data-empty` then (yes for F0, Deviation, Vibrato extent, Energy, Input level, Input, Sample rate, Base latency; no for Voicing gate, Analysis window, Display range, which are real values). `render()` toggles `data-empty` wherever it writes one of those placeholder texts.
- file.ts: the same toggle on `fa-r-note`, `fa-r-pitch`, `fa-r-offby`, `fa-r-vib`, `fa-d-f0`, `fa-d-dev`, `fa-d-level` when it writes a placeholder. #/file's layout is M2-DESIGN.md's; this rule is the only change, and it should be mirrored there once the other edits to that file land.

**Contrast (WCAG 1.4.3, computed from sRGB relative luminance as in 1.4).** Readings and Details sit on `--bg`; `--panel` is listed in case either is ever placed on the hero surface.

| Text | on `--bg` `#F2F0EA` | on `--panel` `#FBFAF6` | Needs |
|---|---|---|---|
| `--muted` `#686761`: labels, notes, empty values (11, 13, 14, 22 and 26px) | 4.98 | 5.43 | 4.5, pass |
| `--ink` `#141413`: values and units | 16.18 | 17.65 | 4.5, pass |
| `--ink-2` `#3B3A36` (not used here; checked as the alternative note colour) | 9.99 | 10.90 | 4.5, pass |

Loud (dormant, 1.2a): `--muted` is ink there, so empty and filled differ by size and words only. No new token: `--t-reading` is set on `:root`, so Loud gets it with its own `--font-display`.

**States.**

| State | Vibrato cells | Pitch, Off by |
|---|---|---|
| Idle, before she sings | "None yet" empty value, note "last 2.5 s" | "No pitch" empty value |
| Requesting, denied, no device, busy, insecure, analyser, ended (2.14) | same as idle; the callout is in the hero, never here | same |
| Listening, no voiced frames or between phrases | empty value | empty value |
| Listening, pitch but no vibrato in the window | empty value | filled |
| Listening, vibrato | filled: number at 28px, unit, note | filled |
| Stopped | keeps the last values, filled treatment (no stale dimming here, unchanged) | same |
| Loading | none: values arrive per frame | none |
| Tracker wrong (octave jump, 4) | shown as measured, same treatment; no separate uncertainty style in Readings, the hero and How to read this carry it | same |
| 200% text | lines wrap; `min-height`, never `height`, so nothing clips | same |
| Forced colours | muted and ink both become CanvasText; empty still reads from the words and the smaller size | same |

Never animated (1.7a): no transition on any value, empty or filled.

**Acceptance criteria (one assertion each).**
- **RTH-01** `#/voice` at 375 and 1280: `#va-m-vib-speed` and `#va-m-vib-width` have the same `getBoundingClientRect().height` empty and with a vibrato reading.
- **RTH-02** `#/voice` at 320, 375 and 1280: the Readings grid's height is the same empty and filled.
- **RTH-03** `#/voice` empty: the computed `font-family` of `#va-m-vib-speed` starts with "Newsreader", and its `color` is `--muted`.
- **RTH-04** `#/voice` empty: the computed `font-size` of `#va-m-vib-speed` is larger than that of `#va-m-vib-speed-note`.
- **RTH-05** `#/voice` at 375 empty: the computed `font-size` of `#va-m-vib-speed` is not larger than that of `#va-readout-note`.
- **RTH-06** `#/voice` on first paint: `#va-m-vib-speed-note` and `#va-m-vib-width-note` are visible and read "last 2.5 s".
- **RTH-07** `#/voice` empty: `#va-m-pitch` has a computed `font-size` of 14px, weight 400, colour `--muted`.
- **RTH-08** `#/voice` and `#/file`: every `.kv-value` whose text is a placeholder listed above has `data-empty`, and none with a measured value has it.

**Open questions.**
1. Copy: the width note becomes "last 2.5 s" and the ± explanation moves to How to read this. Confirmed by the owner, 2026-11-09.
2. If the owner wants all four values large for consistency, the path is Off by as a number at `--t-reading` and "cents flat of A♯4" in `--t-body-s`. Not specified; it duplicates the hero's chip.
3. String widths above are estimated from average glyph widths, not measured. Check "None yet", "±100 cents" and "5.6 per second" in one line at 320 in the browser.
4. "None yet" after she has sung a straight tone reads as if vibrato were expected. Not a type question; noted for the next copy pass.
5. #/file: the vibrato note in Readings at cursor appears and disappears as the cursor moves, so the panel's Details row shifts by 20px while she scrubs. Up close and not live, so not specified here.

#### Breakpoints

| Width | What applies |
|---|---|
| 320 to 359 | Compact. Note at the 120px clamp floor; the 40px cue and chip still fit (about 250px and 275px in 288px). The brand may wrap when the mic is on (2.1a). Stat grid cells are 136px; long empty texts wrap to three lines, so Readings row 1 may end about 20px lower, still above the bar at 320 × 568 (bar top 504). kv lists two columns (288px is over the 280px threshold). No horizontal scroll (MOB-29). |
| 360 to 599 | Compact. The note grows with the container up to 152px (reached at about 455px wide). Everything else as at 375. |
| landscape, height 500 or less | the landscape layout above, at any width; the hero and Readings share the first row from 800 wide |
| **600 and up** | Medium (2.1a): the two-row header with the full nav and no Nav button. The hero is no longer full-bleed and is not full width beyond its column; the toggle returns into the hero at 56px with the Space hint, and the action bar is not rendered as fixed (position static, inside the hero). `--t-hero` returns to clamp(104px, 30cqi, 200px), and the cue and chip to 32/36. Type and spacing return to the wide column of the token table. `data-open-wide` disclosures render open. Tools stacks to one column until 960, as today. At 960, the 12-column grids from 3.1, 3.3 and 3.4 apply, with sections instead of panels (1.10). |

#### Motion on mobile (follows 1.7a)

No new tokens and no new animation.
- **Action bar:** never animated. It is present from the first frame; its label, fill and live dot change on the frame `live.ts` reports them, like the rest of the readout (a fill change is feedback, 0ms, 1.7a).
- **System messages:** appear and disappear at once, never faded (1.7a "Never animated" already covers error and permission messages). Hiding it for the keyboard is instant (`visibility`), because a slide would move a control while the keyboard is moving.
- **Sections and rules:** static. Removing boxes removes nothing animated.
- **Disclosures:** 1.7a pattern B, large class, unchanged. `data-open-wide` sets `open` before the view is shown, so the initial state never animates.
- **Snap row:** `scroll-snap-type: x proximity` is not an animation; the existing smooth scroll on a chip tap stays, `auto` under reduced motion.
- **Rotation into or out of landscape:** instant relayout, no transition.
- **Touch:** hover motion stays behind `@media (hover: hover)`, so a tap never leaves a stuck hover state. Press feedback (`:active` fill on the A4 squares, buttons) is 0ms (1.7a).
- **While live:** nothing new moves on its own (1.7a principle 3).

#### Route focus: no ring unless the keyboard caused it (FINAL)

**Bug.** After navigation the router focuses the h1 (section 5). `app.css` hides the ring with `h1[tabindex="-1"]:focus:not(:focus-visible)`, which relies on the browser's own guess. Chrome treats script focus as `:focus-visible` when no pointer interaction preceded it, or when the previously focused element matched `:focus-visible`. That is why the Voice capture shows an orange box on the h1: the navigation came from script, with no pointer event before it.

**Fix.** Track the input type ourselves.
- New module `src/app/modality.ts`, started from `main.ts` before the router. It sets `html[data-modality]`: `keyboard` on `keydown` (any key except a lone modifier: Shift, Control, Alt, Meta), `pointer` on `pointerdown`. Initial value `pointer`, so a page load or a script navigation never shows the ring. Listeners are passive, on `document`, in the capture phase.
- CSS: programmatic-focus targets, meaning `h1[tabindex="-1"]` and the section headings with `tabindex="-1"` (About h2s, Methods check titles), get `outline-color: transparent` on `:focus` always, and the normal ring only on `html[data-modality="keyboard"] …:focus-visible`. This replaces the existing `:not(:focus-visible)` rule in `app.css` and the separate rules in `about.css` and `methods.css`.
- Focus still moves to the h1 on every route change, so screen readers announce the new page (section 5 unchanged).
- Real controls (links, buttons, inputs, summaries) keep the browser's `:focus-visible`, untouched.

Rejected: `focus({ focusVisible: false })`. It is not supported in every engine she might use, and where it is ignored the bug returns. Rejected: never showing a ring on headings. A keyboard user who presses Enter on a nav link should see where focus went.

#### States

| State | Compact behaviour | Status |
|---|---|---|
| Voice idle | as the idle wireframe; bar says "Start listening" on an ink fill | FINAL |
| Voice requesting | status "Waiting for permission"; the `info` callout from 2.14 in the note slot; the bar button is disabled with "Waiting for permission…" | FINAL |
| Voice listening, pitch | as the listening wireframe; bar on `--signal-text` with the live dot and "Stop listening" | FINAL |
| Voice no pitch, held | the "Last:" label and the dim, in place; no layout change | FINAL |
| Voice gate hint | the hint replaces the caption in the shared slot | FINAL |
| Voice stopping | the bar button is disabled with "Stopping…" (VA-39) | FINAL |
| Permission denied, no device, busy, ended | the one 2.14 callout in the note slot (at least 120px, which holds the longest one at 320); short status in the header-row chip; the spectrogram meta says "Not listening" and the plot is empty; the bar button says "Try again" or "Start listening" on an ink fill | FINAL |
| Analyser failed | the callout plus its Details disclosure in the note slot; the hero grows and the readings move down; the bar keeps "Try again" visible | FINAL |
| Insecure page | the callout in the hero, with the address as a link; no toggle, so no bar (VA-14) | FINAL |
| On-screen keyboard open (A4 in Setup, or the calibration field on Methods) | Voice bar hidden while the input has focus; Done (`#va-a4-done`), Enter or blur commits and the bar returns | FINAL |
| Nav panel open | pushes the page down (2.1a); the Voice bar stays fixed and visible | FINAL |
| Empty (Methods not run, Overview checks not run) | words, never dashes (1.1); same layout | FINAL |
| Loading (fonts swapping) | fallback fonts may change heights by a few pixels; the reserved slots (note, cue, hint) keep controls still | FINAL |
| Text enlarged to 200% | everything wraps; kv lists stack under 280px; the bar grows to fit its label; fold and height criteria are not asserted at 200% | FINAL |
| Reduced motion, forced colours | as 1.7a and 1.2; in forced colours the A4 squares and the Nav button keep their outline as `ButtonText`, the cents chip and the listening toggle get a 1px `CanvasText` border because fills are dropped, and the live dot keeps its shape | FINAL |
| Landscape | as above | FINAL (owner: both orientations) |

#### Acceptance criteria (one assertion each)

Headless Chrome, Paper, device scale factor 2, `data-motion="off"`, after `document.fonts.ready`, idle, Nav closed, disclosures in their default state. Page heights at 375 × 667; **fold checks on Voice at 375 × 560** (revision 2.3a) unless stated. "Bar top" is the top of `.va-actionbar` (496 at 375 × 560). "Hit area" is tested by `document.elementFromPoint` at the centre and at the four points 21px left, right, above and below it: each returns the target or a descendant of it. IDs are as built, with the `va-` prefix (section 7.3 lists them without it). New IDs: `#va-a4-done` (Done button) and `#va-a4-readonly` (read-only A4 in the hero).

- **MOB-01** `#/`: `document.documentElement.scrollHeight` is at most 1450.
- **MOB-02** `#/tools`: scrollHeight is at most 1550 (re-budgeted for the fifth tool row, M2; measured 1508).
- **MOB-03** `#/voice`: scrollHeight is at most 1500.
- **MOB-04** `#/methods`: scrollHeight is at most 1450.
- **MOB-05** `#/about`: scrollHeight is at most 2700.
- **MOB-06** An unknown hash: scrollHeight is at most 667.
- **MOB-07** `#/voice` idle at scroll 0: the `#va-readout-note` box lies inside the viewport.
- **MOB-08** `#/voice` after a voiced frame 20 c flat: the bottoms of `#va-readout-note`, `#va-readout-dir` and `#va-readout-cents` are at or above the bar top.
- **MOB-09** `#/voice` at scroll 0: the bottom of `#va-cents-meter` is at or above the bar top.
- **MOB-10** `#/voice` at scroll 0 and after `scrollTo(0, scrollHeight)`: `#va-live-toggle` lies fully inside the viewport.
- **MOB-11** `#/voice` at scroll 0, idle and again after frames that produce vibrato values: the bottoms of `#va-m-vib-speed` and `#va-m-vib-width` are at or above the bar top.
- **MOB-11a** `#/voice` at scroll 0: `#va-a4-readonly` lies above the bar top and its text is "A4 {value of `#va-a4`} Hz".
- **MOB-11b** `#/voice` at 320 × 568 after a voiced frame: the bottoms of `#va-readout-dir`, `#va-readout-cents`, `#va-m-vib-speed` and `#va-m-vib-width` are at or above the bar top (504).
- **MOB-12** `#/voice` at 375 and at 320: `.va-letter` has a computed font size of at least 120px.
- **MOB-12a** `#/voice` at 375 and at 320 with pitch: the cue word in `#va-readout-dir` and the number in `#va-readout-cents` have computed font sizes of at least 40px.
- **MOB-12b** `#/voice` at 375 with vibrato values: the number parts of `#va-m-vib-speed` and `#va-m-vib-width` have a computed font size of at least 28px and a font family starting with "Newsreader".
- **MOB-12c** `#/voice` at 320 in the within-tolerance state: `#va-readout-dir` has `scrollWidth <= clientWidth` and lies inside `.va-hero` horizontally.
- **MOB-12d** `#/voice` at 375 with pitch: `#va-readout-cents` has no visible border and a background other than transparent.
- **MOB-13** `#/voice`: `.va-actionbar` has computed `position: fixed` and its bottom equals the viewport height.
- **MOB-14** `#/voice` with focus in `#va-a4`: `.va-actionbar` has computed `visibility: hidden`.
- **MOB-14a** After typing 442 in `#va-a4` and pressing Enter: the value in use is 442, `#va-a4` does not have focus, and `.va-actionbar` is visible.
- **MOB-14b** After typing 443 in `#va-a4` and clicking `#va-a4-done`: the value in use is 443, `document.activeElement` is not an input, and `.va-actionbar` is visible.
- **MOB-14c** After typing 444 in `#va-a4` and clicking the page body: the value in use is 444 and `.va-actionbar` is visible.
- **MOB-14d** After typing 4 in `#va-a4` and clicking `#va-a4-done`: `#va-a4-error` is visible, the previous valid value stays in use, and `.va-actionbar` is visible.
- **MOB-14e** `#va-a4-done` is displayed while focus is in `#va-a4` and not displayed when focus is outside `.va-a4`.
- **MOB-15** `#/voice` at 600 × 800: `.va-actionbar` has computed `position: static` and `#va-live-toggle` lies inside `.va-hero`.
- **MOB-15a** While listening, `#va-live-toggle` has a background equal to `--signal-text` and contains a displayed live dot; while idle its background is `--ink` and no live dot is displayed.
- **MOB-16** `#/voice` scrolled to the end: the bottom of the footer's text is at or above the bar top.
- **MOB-17** `#/voice` at 375: `.va-space-hint` has computed `display: none`; at 600 × 800 it is displayed.
- **MOB-18** `#/voice`: with the gate hint shown, `#va-readout-gate-hint` has the same top as `.va-caption` has when the hint is hidden.
- **MOB-19** `#/voice`: `#va-readout-status` is a descendant of the page header, and its vertical centre is within the h1's top and bottom.
- **MOB-19a** `#/voice`: `#va-a4`, `#va-a4-dec`, `#va-a4-inc` and `#va-a4-done` are descendants of `#va-setup`, and `.va-hero` contains no input.
- **MOB-19b** `#/voice` at 375 × 560 in the denied state: the `.msg` lies inside `.va-hero` and its bottom is at or above the bar top.
- **MOB-20** `#/`: `#ov-start` lies fully inside the viewport at scroll 0, and its width equals the shell's content width.
- **MOB-21** `#/tools`: the "Open voice analysis" link comes before the first `.kv-list` of the detail section in DOM order.
- **MOB-22** On every app route, every `a`, `button`, `input`, `summary` and `label.va-switch` that is visible passes the hit-area test, except links inside `p.prose` that have text siblings, and inputs inside a `label.va-switch` (the label is the target).
- **MOB-23** With Setup open, `#va-a4-dec` and `#va-a4-inc`: the `::before` box is at most 32 × 32, it has a visible 1px `--ink` border on four sides with no hover or focus, and the element passes the hit-area test.
- **MOB-24** `#nav-toggle`: passes the hit-area test, and `.nav-toggle-label` is at most 16px tall.
- **MOB-25** On every app route, no two hit areas of visible targets intersect (each target's hit area taken as its border box united with the boxes of any positioned `::before` or `::after` that receive pointer events).
- **MOB-26** With Setup open, in the A4 row, the horizontal distance between the centres of neighbouring targets (−, input, +) is at least 44px.
- **MOB-27** `#/`: `.ov-setup-link` passes the hit-area test, and the height of its parent paragraph equals its line height.
- **MOB-28** On every app route, every `summary` is at least 44px tall and as wide as its `details`.
- **MOB-29** At 320 on every app route, with the Nav panel open and closed, `document.documentElement.scrollWidth` is at most 320.
- **MOB-30** After a mouse click on a nav link, the focused h1 has a transparent outline colour or `outline-style: none`.
- **MOB-31** After Tab to a nav link and Enter, the focused h1 has a 2px outline in `--focus`.
- **MOB-32** After `location.hash` is set from script with no prior input, the focused h1 shows no outline.
- **MOB-33** After each navigation in MOB-30 to MOB-32, `document.activeElement` is the new route's h1.
- **MOB-34** `.va-actionbar` has a computed bottom padding of at least 8px, and its rule in `voice.css` uses `env(safe-area-inset-bottom)`.
- **MOB-35** The viewport meta content includes `viewport-fit=cover`.
- **MOB-36** On every route, the footer contains "For practice and study. Not a diagnostic or medical device." and is at most 100px tall at 375.
- **MOB-37** `#/`: the How to use it and Not built yet `details` are closed at 375 and open at 1280 after first render.
- **MOB-38** `#/methods`: the three Method `details` are closed at 375 and open at 1280 after first render.
- **MOB-39** `#/voice`: the How to read this text is not inside a closed `details`.
- **MOB-40** `#/about`: after `scrollTo(0, 800)`, `.about-toc` has a top of 0 (or the top inset), and `.about-toc-scroll` has computed `scroll-snap-type` on the x axis.
- **MOB-41** At 667 × 320 landscape on `#/voice` with pitch: `#va-readout-note`, `#va-readout-dir`, `#va-readout-cents`, `#va-cents-meter`, `#va-a4-readonly` and `#va-live-toggle` lie fully inside the viewport at scroll 0.
- **MOB-41a** At 844 × 320 landscape on `#/voice`: `#va-m-vib-speed` and `#va-m-vib-width` also lie fully inside the viewport at scroll 0.
- **MOB-41b** At 667 × 320 landscape: `#va-live-toggle` is inside the page header row and `.va-actionbar` is not `position: fixed`.
- **MOB-42** At 667 × 320 landscape: `#nav-toggle` is displayed.
- **MOB-43** `#/voice` in idle, listening and stopping: `.va-actionbar` and `#va-live-toggle` have empty `getAnimations()` and 0s transition durations on everything except colour feedback.
- **MOB-44** `#/tools` at 375: in the "Input" row of the detail list, the label and the value have the same top.
- **MOB-45** `#/voice` at 320: `#va-m-vib-speed` and `#va-m-vib-width` have the same top.
- **MOB-46** `#/voice`: the Readings value elements appear in the DOM in the order `#va-m-vib-speed`, `#va-m-vib-width`, `#va-m-pitch`, `#va-m-offby`.
- **MOB-47** `#/voice`: the top-level blocks appear in the DOM in the order hero, Readings, Spectrogram, How to read this, Setup.
- **MOB-48** `#/`: the text "For practice and study" appears exactly once inside `main` and the footer combined.
- **MOB-49** On every app route at 375, every `details.disclosure > summary::after` chevron is at least 12 × 12px (WGT-19 at compact).

#### Implementation order (for the engineer)

Each step is reviewable on its own. After each: `npm run typecheck`, code-reviewer on the diff, test-writer against the WGT and MOB criteria the step covers. a11y-auditor after steps 5 and 7. Run the design-review-card before step 2 (CLAUDE.md). No change to `src/dsp/`, so `./validate.sh` is not affected; run it anyway before calling the work done (CLAUDE.md).

1. **Route focus fix.** New `src/app/modality.ts`; start it in `main.ts`; replace the h1 rule in `app.css`, and the heading focus rules in `about.css` and `methods.css`. MOB-30 to MOB-33.
2. **Baseline count.** A test helper that counts boxes, rules and nesting (1.10 definitions) and measures page heights at 375 and 1280. Record today's numbers in the PR before any CSS change.
3. **Tokens.** `theme.css`: the new tokens and compact values from the token table, the compact `--t-hero`. `index.html`: `viewport-fit=cover` (once the coordinator confirms the `#/legacy` session agrees).
4. **Shared components.** `components.css`: `.sec`, `.sec-head`, `.sec-title`, `.sec-meta`, `.group`, `.group-label`; Paper rules that drop borders and inline padding from kv lists and rows; the kv container query; the disclosure restyle; ghost button hit extender; hit-area rules (techniques A to C). `links.css`: technique B for standalone links. `app.css`: the outlined Nav button with no fill, the compact footer, safe-area gutters. Router: the `data-open-wide` pass at render (`router.ts`). The `.msg` callout (2.14) and the 12px disclosure chevron.
5. **Voice.** `voice.ts`: status chip into the page header; remove the hero strip and add `aria-label`; caption and hint in one slot; the A4 stepper into Setup with `#va-a4-done`, Enter and blur commit; `#va-a4-readonly` in the hero; system messages as one `.msg` in the note slot with the 2.14 copy; remove the spectrogram overlay and "Stopped" chip and put the state word in the meta line; wrap the toggle in `.va-actionbar` with the listening fill and live dot; move Readings before the spectrogram and How to read this before Setup; reorder the Readings rows. `voice.css`: full-bleed band with 2px ink rules, 40px cue and chip, the chip fill, the stat grid with `--t-reading`, A4 squares with outlines, 4px level bar, the fixed bar and keyboard rule, the Space hint rule, spectrogram as a tier-2 group with the plot as the only box. VA-01 to VA-49 must still pass, with VA-04 and VA-20 as amended in 2.14.
6. **Other screens.** `overview.ts` and `overview.css` (sections, features list, How to use it and Not built yet as `data-open-wide` disclosures, remove the third note); `tools.ts` (sections, button after the description, drop "Selected: 01", underlined tool name and "→"); `methods.ts`, `checks.ts` messages and `methods.css` (sections, state bar on the section top, ghost buttons, Method disclosures, `.msg` callouts above the Run buttons with the 2.14 copy); `about.ts` and `about.css` (sections, snap and underlines on the chips, h3 sizes); `notfound.ts` (no change beyond shared CSS).
7. **Landscape.** The landscape media query in `app.css` (compact header) and `voice.css` (hero band, toggle in the title row, hero and Readings side by side from 800 wide); `nav.ts` uses the same query.
8. **Review.** review-as with "the user who hates this" on the built UI at 375 and 320, a phone check on a real device (open question 2), and test-writer on the full WGT and MOB set.

Files that change: `src/styles/theme.css`, `components.css`, `app.css`, `links.css`, `voice.css`, `overview.css`, `methods.css`, `about.css`; `src/app/views/voice.ts`, `overview.ts`, `tools.ts`, `methods.ts`, `about.ts`; `src/app/router.ts`, `main.ts`, `nav.ts`, `checks.ts` (message strings only); new `src/app/modality.ts`; `index.html` (viewport meta only). Not touched: `legacy.css`, `src/testpage/main.ts`, `tokens.css`, `src/dsp/`.

#### Open questions

Resolved in revision 2.3a: pitch trace (later, section 10), orientation (both, landscape in scope), collapsing reference content on mobile (yes), the fixed Start / Stop bar (yes), the duplicate "Good to know" note (removed, coordinator default), ghost buttons on Methods (coordinator default), `viewport-fit=cover` (specified; the coordinator is clearing it with the `#/legacy` session).

1. **Note, cue and chip sizes from 2 m.** About 124px for the note and 40px for the cue and chip are informed guesses. Test: phone on her stand, in portrait and landscape, she stands at 1 m and 2 m and reads the note, the direction and the cents aloud over a few sustained notes. If she misreads, the sizes go up and Pitch and Off by, then the vibrato pair, leave the fold, in that order.
2. **Landscape toggle position.** The owner chose the fixed bottom bar; I applied that to portrait and kept the toggle in the title row in landscape, where a bar would take a fifth of the height. If the owner wants the bar in landscape too, the vibrato pair stays below the fold at 844 × 320.
3. **560px is an estimate** of a phone browser's visible height with toolbars (from the persona review). Measure on her phone; if it is smaller, the budget is redone, not the criteria loosened.

---

## 4. Uncertainty: when the tracker is wrong or has no answer

- **No answer:** an unvoiced frame produces no number. The last note stays at full strength for `HOLD_FULL_MS`, then it is muted and labelled "Last:". Vibrato and the band ratio say why they are empty. Nothing is interpolated.
- **Wrong answer:** the live path is plain YIN, which slips octaves (VALIDATION.md section 4: 94.36% agreement with Praat, below the 95% criterion). The octave number is shown large. The F0 marks on the spectrogram make a slip visible, and "How to read this" says how to check it.
- **Correction:** a live reading cannot be edited; it is a measurement. She corrects the inputs (A4, the input level through the gate hint, calibration). Correcting saved takes waits for Sessions.
- **Rejected:** a confidence bar from `aperiodicity`, smoothing, and a take summary.

---

## 5. Accessibility baseline (FINAL)

Landmarks and skip link. One h1 per route. On route change: update `document.title` ("Voice analysis | Cents to Dollars"; Overview "Cents to Dollars") and focus the h1. Everything works from the keyboard. Contrast as in section 1.4, focus as in section 1.7, targets at or above `--control-h` (superseded by 3.6: hit areas at least 44 × 44, visuals may be smaller; programmatic heading focus shows a ring only after keyboard input). Colour is never the only signal. Live regions: `#readout-announce` (throttled), the mic indicator, check progress and results, input errors through `aria-describedby`. The canvas has `role="img"` and its readings exist as text. Reduced motion and forced colours as in section 1.2. Reflow at 320px, text resize to 200%.

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

1. **Reduced motion and fades.** Your rule was "no transition when reduced motion is set". `tokens.css` currently keeps 100 to 120ms fades in that mode. The spec sets 0ms. Keep the fades or not? Options, recommendation (no fades) and token mapping in 1.7a.
2. **Tolerance.** "WITHIN ±10 c" has no source. Her number is needed, and possibly a setting later.
3. **Timings.** `HOLD_FULL_MS` and `GATE_HINT_MS` are both 1000 ms. Tune them with her.
4. **The `s-tracker` row.** It needs one exported constant in `src/audio/capture.ts`. Add it, or drop the row?
5. **Automation harness.** Whatever produced `results/browser_selftest.json` must open `/#/legacy` during Phases A and B, and Methods after Phase C. Where does that harness live? I could not find it in the repo.
6. **Glyphs.** Newsreader and Archivo Black need checks for "♯" and tabular figures. If either is missing, use "#" and fixed-width digit boxes.
7. **Device picker** for an audio interface (needs `deviceId` in `capture.ts`). Not in M1 unless she needs it.
8. **Personas.** `docs/research/personas/` does not exist.

**Future features (not specified).**
- **Pitch trace** (owner: later). A plot of cents against the last few seconds, which would show vibrato directly. The spectrogram cannot: at 0 to 4 kHz over 200px, a ±50 c vibrato on A4 moves the F0 marks by under one pixel (3.6). Needs its own spec before any build.

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

## Changelog (revision 2.1)

- Section 0: she is an opera singer who practises unamplified. The app hears her through the device's built-in microphone, and the 1 to 2 m reading distance is unchanged.
- Added 1.2a: the theme selector is removed and the app is Paper only. Loud code stays, dormant.
- Added 2.1a: compact navigation, with a Nav button and an in-flow panel under 600px. The scroll strip, the fade and the `data-more` script are removed. Acceptance criteria NAV-01 to NAV-29 and THM-01 to THM-05.

## Changelog (revision 2.2)

- Added 1.7a: motion standards. Four size classes with enter, exit, easing and distance tokens, reveal patterns, stagger, hover, interruption and live rules, a reduced-motion recommendation (OPEN 1), an audit of every animation in the app, and MOT-01 to MOT-42. Older motion notes in 1.2, 1.7, 1.9, 2.1a and section 10 point to it.
- 2.1a: the compact toggle's visible label is "Nav", not "Menu" (owner).

## Changelog (revision 2.3)

- Added 1.10: visual weight at every width. Border budget, no box inside a box, strips replaced by tier-1 section heads and tier-2 labels, hairlines only for data rows, one surface per screen, what survives from the Clinical3 references, before and after per component, box and rule counts per screen, WGT-01 to WGT-15.
- Added 3.6: mobile layout. Mid-practice versus reference content, one primary action per screen, a 44 × 44 hit-area policy with smaller visuals, compact type and spacing tokens, two-column kv lists, a stat grid for Readings, `data-open-wide` disclosures, a fixed Start / Stop bar on Voice, safe-area insets, per-screen order and height targets with wireframes, Voice detail and landscape, breakpoints, motion, the route-focus fix, MOB-01 to MOB-48, and the build order.
- Pointers added in 1.6, 1.7, 1.8, 2.1a, 2.3, 2.4, 2.5, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 3.1, 3.3, 3.4 and 5.

## Changelog (revision 2.3a)

- Owner answers: the fixed Start / Stop bar is final; landscape is in scope (no longer cuttable); collapsing reference content on mobile is approved; the pitch trace is a later feature (section 10). Coordinator defaults: the duplicate Overview note is removed, Methods uses ghost buttons, `viewport-fit=cover` is specified.
- Added 2.14, system messages: one callout in one place, message types, copy rules and rewritten Voice and Methods copy, no overlays on plots, MSG-01 to MSG-19. Superseded parts of 2.9, 2.10, 2.12 and 3.0 point to it.
- 1.10: tap-affordance rule (things you can tap look tappable at rest; things you cannot have no outline); Nav button and A4 − and + keep a 1px outline; the cents chip loses its border for a fill; 12px disclosure chevrons; the Voice hero gets 2px ink rules top and bottom; data frames are now only the meter track and the plot; counts and WGT-11, WGT-12 revised; WGT-16 to WGT-20 added.
- 3.6: the Voice first screen is budgeted against 375 × 560 with the bar inside it; the cue and cents chip are 40px; the vibrato values are Newsreader 28px; the A4 stepper moves to Setup with a read-only A4 in the hero; Done, Enter and blur commit A4 and bring the bar back; the bar turns `--signal-text` with a live dot while listening; landscape is reworked for 667 × 320 (hero band, toggle in the title row, Readings beside the hero from 800 wide). MOB criteria use the built `va-` IDs; MOB-11a, 11b, 12a to 12d, 14a to 14e, 15a, 19a, 19b, 41a, 41b and 49 added.
