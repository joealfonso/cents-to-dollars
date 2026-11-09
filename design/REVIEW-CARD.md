# Design review: Cents to Dollars UI spec (rev 2)

Designer: dev-team designer agent
Reviewers: design-review-card
Date: 2026-11-08
Material reviewed: design/DESIGN.md, design/reference/*.dc.html

26 of 26 marked · 22 ✓ · 4 open · 0 not reviewed

## Follow-ups (4)

1. Has the singer, or anyone off the team, seen this spec or the reference designs? The only planned real-user check is a future practice session. (Section 0, Section 10 item 8 · p3)
2. Who will listen to the hero and the `#readout-announce` region with a real screen reader (VoiceOver, NVDA), and in which phase? a11y-auditor reads markup, it is not a listening test. (Section 5, Section 8 · a2)
3. How does a long audio device label wrap or truncate in the Setup row `#s-input` at 320 and 375 px? It comes straight from `getAudioTracks()[0].label`. (Section 3.3 Setup, Section 7.5 · e1)
4. When she hits an error she cannot fix herself (for example "Analyser failed"), who does she tell and how? Section 0 names Joseph as the person who runs setup, but no screen says so. (Section 3.0, Section 0 · r3)

## Looks good (22)

- p1: Section 0, Problem and User
- p2: Section 0 (watch one real practice session), Section 9 (49 acceptance criteria)
- s1: 1.1 principle 1, 2.4, 2.10, 3.0 Idle, VA-02, VA-04
- s2: 3.0 Requesting, 2.4, 2.12, 1.5 `font-display: swap`
- s3: 3.0 table, every error row has a message and a next action
- s4: 2.12 "Done with a warning", 3.4 calibration warning, 3.3 Readings empty states
- s5: 3.4 compact self-test blocks, 6 item 10 capped queues, 3.3 fixed windows
- s6: 2.1 and 3.1 first-visit theme choice, 1.2 persistence
- e2: Section 0 "Not doing", 3.4 "Could not run"
- e3: Section 0 dev server only, 1.5 self-hosted fonts, 3.4 fixtures not found
- e4: 3.0 Denied row, VA-10, VA-11
- e5: 1.6 compact breakpoint, Section 5 text resize, 3.3 hero budgets, VA-46 to VA-48
- a1: Section 5 skip link and focus, 2.1, 1.1 principle 4
- a3: 1.4 contrast tables for both themes
- a4: 2.9 cue word never colour alone, 2.6, Section 5
- a5: 1.6 `--control-h`, 2.8 48px buttons, 1.2 reduced motion
- w1: 3.0, 3.4 and 2.1 action labels
- w2: 3.0 messages, 2.8 input errors with range
- w3: Section 0 footer and "Not doing", 2.13, 3.3, Section 4 octave slips stated
- r1: Section 6 stop and abort, 2.8 invalid A4 keeps last value, 2.1
- r2: Section 0, nothing is saved, so nothing destructive
- r4: Section 6 one check at a time, 7.4, 3.0

## Not reviewed today (0)

- None.
