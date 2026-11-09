# Motion spec: M1 test page

Status: spec only, no production code. Items marked FINAL are decided. Items marked OPEN need Joseph or a measurement.

## Problem

The test page is a measurement harness. Joseph wants it to feel crafted. The risk is that motion corrupts the thing the page exists to do: show real numbers, and measure output-to-screen latency on a requestAnimationFrame tick.

## User

The user is Joseph, or a developer or singer-tester running the harness. No persona file exists in docs/research/personas/ for this. The job is: start the mic, read a number, run a discrete test, trust the result. Motion has to answer one question the page currently leaves silent, "is this test running, finished, or failed?", and stay out of the way for everything else.

Assumption that carries the decision: compositor-only CSS animation does not shift the loopback median. I have not tested this. Test in "Verification" below. Until it passes, the safe fallback is rule 3 (no animation while live is on).

## Hard rules (FINAL)

1. Live numbers are instant. `#live-readout` gets no transition, no animation, no `data-state` styling, no fade. Its `textContent` rewrite every frame is the only thing that changes it.
2. `#spectrogram` is never transformed, faded, clipped-in, or transitioned. It is excluded from the entrance too. Nothing animates its box, border, or opacity at any time.
3. While live is on (`html[data-live="on"]`), there are no infinite animations anywhere. This includes calibration and loopback "working" states, because both require live capture. Only one-shot compositor animations (transform, opacity) may play, and none start during a loopback burst loop.
4. Only `transform` and `opacity` are animated, with two small exceptions, both user-initiated and tiny: focus ring `outline-color` and `outline-offset`. No layout properties. No `will-change` (one-shot layers are promoted by the browser for the animation's length).
5. No JS animation, no libraries, no new dependencies, no rAF added. JS only sets attributes.
6. No visible copy changes. No readout text format changes. The only markup additions are one empty decorative span and section wrappers (see "Markup changes").
7. Every color used for state is redundant. State is always also carried by the readout text. No state relies on color alone.

## Reading order (FINAL)

1. Title and intro note.
2. Live input controls (the primary action).
3. Readout text. The text is the content. The state bar is an accent above it and never delays or dims the text.

The entrance runs in that same top-to-bottom order, so motion order matches reading order.

## Tokens to add to src/styles/tokens.css

Per-theme values. Editorial is calm and decelerating. Loud is shorter and has overshoot on buttons only.

| Token | editorial | loud | Used by |
|---|---|---|---|
| --dur-fast | 100ms | 70ms | button press, focus ring, hover overlay |
| --dur-base | 180ms | 130ms | disabled fade, live dot, state bar fade-in |
| --dur-enter | 360ms | 260ms | page entrance |
| --dur-sweep | 1400ms | 900ms | working sweep (self-test only) |
| --dur-done | 900ms | 700ms | done reveal |
| --stagger | 60ms | 40ms | section entrance step |
| --ease-standard | cubic-bezier(.2, 0, 0, 1) | same | transitions |
| --ease-enter | cubic-bezier(.16, 1, .3, 1) | same | entrance, done sweep |
| --ease-spring | same as --ease-standard | cubic-bezier(.34, 1.56, .64, 1) | button hover and press, live dot |
| --move-enter | 8px | 12px | entrance translateY |
| --btn-hover-shift | 0px | -2px | button hover translateY |
| --btn-press-shift | 1px | 2px | button press translateY |
| --state-working | var(--ink) | var(--ink) | state bar |
| --state-done | var(--ok) | var(--ink) | state bar |
| --state-error | #B3261E | var(--ink) | state bar |
| --state-bar-h | 2px | var(--border-w) (4px) | state bar height |
| --focus | var(--signal) | var(--ink) | focus ring |

Notes on token choices:
- Loud `--ok` is #2EE59D on white, about 1.5:1, and `--signal` pink on the yellow bg is about 1.8:1. Neither meets the 3:1 non-text minimum. So loud state bars use ink, and the loud focus ring uses ink via `--focus`. This also fixes an existing focus-ring contrast gap in loud. My contrast figures are estimates, verify with a checker (OPEN).
- Editorial `#B3261E` is a new color. Check it is acceptable next to `--signal`, since tokens.css reserves `--signal` for F0, formant band, nav marker and sample tag. I did not reuse `--signal` for errors for that reason. OPEN: Joseph confirms the new red.

### Global switches (FINAL)

- `@media (prefers-reduced-motion: reduce)`: `--move-enter`, `--btn-hover-shift`, `--btn-press-shift` become 0px. All durations clamp to at most 120ms. Infinite animations are removed. Details per item below.
- `html[data-motion="off"]`: all durations 0ms, `animation: none`. For automated runs (the browser self-test that writes results/browser_selftest.json, screenshots). Nothing in main.ts sets it. The harness sets it on the document.

## Decisions

### 1. Page-load entrance (FINAL)

- What: each section fades in and rises, staggered top to bottom.
- Targets: five groups, `header` (h1 plus intro note), then the four `section`s. Index set as `--i` 0 to 4. Applied to `section > :not(canvas)` and header children, so the canvas is never touched.
- Properties: opacity 0 to 1, translateY(var(--move-enter)) to 0.
- Timing: `--dur-enter`, `--ease-enter`, delay `calc(var(--i) * var(--stagger))`, `animation-fill-mode: backwards` so no transform remains after it ends (no lingering stacking context).
- Total: editorial 360 + 4*60 = 600ms. Loud 260 + 4*40 = 420ms.
- Elements stay clickable throughout. Nothing is blocked by opacity.
- Runs once per page load. No scroll-triggered reveals, the page is one screen of content.
- Reduced motion: opacity only, 120ms, no translate, no stagger.
- Why: it is the one moment the page can be expressive with zero measurement risk, because live is off at load.
- Rejected: per-element stagger (about 20 elements, over 1 s, feels slow on a tool you reload often); animating the canvas in (violates rule 2).

### 2. Buttons (FINAL)

Applies to all five buttons. Gate hover behind `@media (hover: hover)`.

- Hover: a `::before` overlay (inset 0, ink, `pointer-events: none`) goes opacity 0 to 0.06. `--dur-fast`, `--ease-standard`. In loud, the button also moves `translateY(var(--btn-hover-shift))` with `--ease-spring`.
- Press (`:active`): `translateY(var(--btn-press-shift))`, `--dur-fast`, overlay to 0.12. Release returns with `--ease-spring`.
- Disabled: `opacity: 0.45`, `cursor: not-allowed`, no hover or press response. Transition opacity `--dur-base`. Today a disabled button looks identical to an enabled one, since `color` is set explicitly. This is a new visible state, not a copy change. Disabled controls are exempt from contrast requirements, but the Start/Stop pair is also distinguished by state, see item 5.
- Reduced motion: no translate. Overlay opacity change only, at most 120ms.
- Rejected: background-color transitions (paint, not compositor); animated box-shadow in loud (paint); scale on hover (reflows text rendering at small sizes); ripple effects.

### 3. Focus ring (FINAL)

- Applies to `button:focus-visible, input:focus-visible`.
- Rest state: `outline: 2px solid transparent; outline-offset: 4px`. Focus: outline-color to `var(--focus)`, offset to 2px. `--dur-fast`, `--ease-standard`.
- Ring is visible within 100ms and fully visible at the end. It never relies on the transition to be perceivable.
- Reduced motion: instant, no offset travel.
- Rejected: animating ring width (not interpolable from `none`); glow with box-shadow (paint, and low contrast in loud).

### 4. Readout status, for discrete results only (FINAL)

Applies to `#cal-readout`, `#loop-readout`, `#self-readout`. Not `#live-readout`.

Mechanism: a 2px (loud 4px) bar drawn as `.readout::before`, absolutely positioned at the top edge, full width. `.readout` needs `position: relative`. The bar sits inside the padding box, so the existing `overflow-x: auto` clips it correctly. On a horizontally scrolled readout the bar scrolls with content, which is acceptable. OPEN: use `position: sticky` if that looks wrong in practice.

Signal from main.ts: `data-state` on the readout element, with values `working | done | error`. No attribute means idle (nothing drawn). Also set `aria-busy="true"` while working, removed otherwise.

| data-state | Visual | Notes |
|---|---|---|
| (none) | no bar | initial text "No measurement yet." / "Not run." unchanged |
| working, live off (self-test) | bar sweeps: translateX(-100%) to 100%, `--dur-sweep`, linear, infinite, color `--state-working` | compositor-only. Self-test is offline, live is off, so rule 3 allows it |
| working, live on (calibration, loopback) | bar is static, full width, opacity 0.5, appears with no transition | no motion. Text already changes ("Measuring for 5 s...", "Burst n of 10...") and carries progress |
| done | bar scaleX 0 to 1 (origin left) over the first 40% of `--dur-done`, holds, fades to opacity 0 by 100%. `--ease-enter`, fill forwards. Color `--state-done` | one-shot. Result text is already fully visible at t=0, the bar never delays it |
| error | bar full width, `--state-error`, opacity 0 to 1 over `--dur-base`, persists until next run | persists so a failed run is still visibly failed after the user looks away. No shake |

Which main.ts paths map to which state:

- cal-run: `working` right after `ensureLive()` resolves, next to the "Measuring for 5 s..." write. `error` on the "Too few voiced frames" return and in `catch`. `done` after the result lines are written.
- loop-run: `working` after `ensureLive()` resolves, before the burst loop. `error` on "No burst was detected" and in `catch`. `done` after the result lines are written.
- self-run: `working` at the top of `selfTest()`. `done` after the final write. `error` in the `.catch` handler.

Reduced motion: no sweep. Working is the static bar (same as live-on). Done is a bar opacity fade only (0 to 1 over 120ms, then out), no scaleX.

Because a run always passes through `working` first, the `done` or `error` animation retriggers on every run without a reflow trick. Wiring is one helper, `setState(el, state)`, that sets `data-state` and `aria-busy`.

Why not animate during live: calibration and loopback run with the tracker feeding rAF. A compositor animation likely costs nothing, but the latency test is the reason this page exists, so I do not spend that risk on a decorative bar. Rule 3 can be relaxed only if the verification passes (OPEN).

Rejected: shimmer over the readout text (would sit on top of numbers); animated ellipsis or typewriter on the text (changes copy rendering); count-up of results (animates numbers, violates rule 1 in spirit); skeleton loaders (the page says nothing is shown before a measurement exists, a skeleton implies data); border-color animation (paint).

### 5. Start/Stop and the live indicator (FINAL)

Signal from main.ts: `document.documentElement.dataset.live = 'on'` where `ensureLive()` currently disables Start and enables Stop, and `'off'` where `stopLive()` re-enables Start. Calibration and loopback start capture through `ensureLive()`, so they get it for free. One attribute drives everything below.

- Start/Stop swap: the existing `disabled` toggle drives the opacity transition from item 2, `--dur-base`. No extra JS.
- Live dot: a decorative 8px square (loud 12px) after the Stop button, `aria-hidden="true"`, fill `--signal`, outline `--ink`. Off state: opacity 0, scale 0.6. On state: opacity 1, scale 1, `--dur-base`, `--ease-spring`. Off transition is `--dur-fast`. Its box is always reserved, so there is no layout shift.
- The dot is static once on. It does not pulse. A pulse is an infinite animation while live runs, which rule 3 forbids.
- Reduced motion: opacity only, no scale.
- The dot is not accessible to screen readers by design. Start/Stop enabled state and the live-readout text already carry the state. OPEN: a visually hidden status string would be new copy, Joseph decides.
- Rejected: pulsing or breathing dot (rule 3); waveform or level meter (continuous animation, and a second thing competing with the real spectrogram); recolor of the whole page while recording.

## Deliberately not animated

| Element | Reason |
|---|---|
| `#live-readout` text, color, border | Live numbers, rule 1 |
| `#spectrogram` | Rule 2. Also the canvas already is the motion on this page |
| Per-burst and per-fixture text rewrites ("Burst 3 of 10...", "set: id") | Discrete text, instant. Animating would add noise on updates every second or faster |
| Number inputs | Native spinner, no value in styling |
| Footer, h1, h2 rules | Static anchors. Only part of the entrance |
| Theme change | No theme switcher on the page; a color crossfade would be paint-heavy for no use |
| Scroll behavior, page transitions, parallax | Nothing to transition between |
| Error on `Could not start` in `#live-readout` | Live readout is exempt from state styling. OPEN: whether a one-shot error bar is wanted there |

## States

- Idle: no motion. Readouts show their original text.
- Loading: none exists as a visible state in this page. `getUserMedia` permission prompt time is owned by the browser. No spinner.
- Working (self-test, live off): sweeping bar, `aria-busy`.
- Working (cal/loop, live on): static bar, text progress.
- Done: one-shot bar, text final.
- Error: persistent error bar, text carries the message.
- Permission denied (mic): falls through `ensureLive()` rejection into the existing catch, so `error` state with the existing "Could not run: ..." text on cal and loop. For Start, live-readout shows the existing text with no state styling.
- Live on / off: dot and Start/Stop disabled swap.
- Reduced motion and `data-motion="off"`: as specified per item.
- No model output on this page, so no uncertainty UI. The measurement-null cases ("Too few voiced frames", "No burst was detected") are mapped to `error`. The user's correction is rerunning the test; the previous result stays until replaced, since text is overwritten only on the next run.

## Markup changes (no copy changes)

1. Wrap h1 plus intro note in `<header>`, and each h2 group in `<section>`. Alternative if wrapping is rejected: set `--i` via `body > :nth-child()`, which gives per-element stagger and is the thing I rejected above.
2. Add `<span id="live-dot" aria-hidden="true"></span>` after `#live-stop`.
3. `.readout { position: relative; }`.
4. `button:disabled` style.

## Verification (OPEN until run)

1. Loopback regression: run the loopback test at least 3 times with `data-motion="off"` and 3 times with motion on (entrance finished, live on, done reveal from a previous test not playing). Compare medians against the run-to-run spread. Acceptance threshold: [GAP, set after the baseline runs; I will not invent one]. Report failures as failures.
2. DevTools Performance and Layers: confirm the working sweep and done reveal show no main-thread paint or layout, and the canvas has no transform, opacity or animation applied at any time.
3. Emulate `prefers-reduced-motion: reduce` and check each item matches its reduced-motion line.
4. Both themes: check state bars, focus ring and disabled state in editorial and loud.
5. Keyboard pass: focus ring visible on every button and input, in both themes.
6. `npm run typecheck` after wiring. `./validate.sh` is unaffected since `src/dsp/` is untouched.

## Open questions

1. Confirm the new `--state-error` red (editorial).
2. Is the relaxed rule 3 worth testing (static bar replaced by a sweep during cal/loop)? I recommend leaving it static; the sweep adds little because the text already shows progress.
3. Hidden status text for screen readers on the live indicator (new copy).
4. `role="status"` or `aria-live` on the cal/loop/self readouts. Only `#live-readout` is aria-live today. Not a motion change, flagged for the a11y-auditor.
5. Sticky vs scrolling bar in an overflowing readout.
6. Buttons are not disabled during a running cal/loop/self test, so a second click starts a concurrent run. Out of scope here, but the state bar will make the overlap visible.

## Wiring summary for engineer

- `setState(el, 'working' | 'done' | 'error')` helper: sets `data-state`, toggles `aria-busy`.
- Call it in cal-run, loop-run, self-run at the points listed in item 4.
- Set `document.documentElement.dataset.live` to `'on'` / `'off'` in `ensureLive()` / `stopLive()`.
- Nothing else in main.ts changes. No timers, no rAF, no style writes.
