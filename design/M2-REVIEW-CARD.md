# Design review: M2 screens (Recording analysis, Interval recognition, Sung exercises, Speaker and microphone check)

Designer: designer agent
Reviewers: main session
Date: 2026-11-08
Material reviewed: design/M2-DESIGN.md (revision 2, matched to specs/M2.md revision 2). Spec only, no prototype or built screens.

26 of 26 marked · 17 ✓ · 8 open · 1 not reviewed (07 AI check not applicable)

| Line | Mark | Where |
|---|---|---|
| p1 Problem in one sentence | ✓ | 0, one problem per screen |
| p2 How we tell it worked | ? | 0 has tests for its assumptions, nothing on success |
| p3 Fresh eyes | ? | personas reviewed the spec, not this design |
| s1 Empty | ✓ | 3.3 No file, 4.2, 5.2 and 5.3 Ready |
| s2 Loading, slow | ? | 3.3 Decoding is indeterminate, no slow-decode case |
| s3 Error says what next | ✓ | 3.3, 5.4 |
| s4 Partial | ✓ | 3.3 Done, no pitch found; 5.5 No answer |
| s5 Full | ? | long takes vs zoom, 3.4 and D5 |
| s6 First vs returning | ? | speaker check every visit, Q15 |
| e1 Long strings | ✓ | 3.2 file name wraps, no truncation |
| e2 Zero and thousands | ✓ | zero voiced frames designed; one file at a time, no lists |
| e3 Slow connection | – | local-first, nothing loads over the network |
| e4 Lacks permission | ✓ | mic states in 5.1 and 5.4; file route needs none |
| e5 Small screen, large text | ✓ | 375 and 320 layouts, 200% text in 6 |
| a1 Keyboard | ✓ | 4.3, 6 focus orders, Space bar rule |
| a2 Screen reader, heard | ? | labels written, not heard; D13 speech into the mic |
| a3 Contrast | ? | new figure marks have no contrast table |
| a4 Not colour alone | ✓ | 6 Colour never alone |
| a5 Targets, motion | ✓ | 6 Targets, 7 Motion |
| w1 Labels say what happens | ✓ | buttons are verbs |
| w2 Errors say what to do | ✓ | 3.3 messages with next action |
| w3 No overpromising | ✓ | no judgement words, leak limits stated in 5.5 |
| r1 Undo, back out | ✓ | Cancel on every running step, new file replaces old |
| r2 Destructive marked | ? | a new file wipes the current results with no warning |
| r3 Who gets the ticket | ✓ | "tell Joseph" with the Details text |
| r4 One failure isolated | ✓ | 5.4 Devices changed and Audio error; worker failure stays on #/file |

## Follow-ups (8)

1. How will we know M2 worked for her? Pick one observation per screen before build, for example "she opens a phone take and finds the flat note without help". Q13 in the spec says her own answer is still missing. (01 · p2)
2. Who outside this work looks at the design? The persona reviews covered the spec only. Run the-user-who-hates-this on M2-DESIGN.md before build. (01 · p3)
3. What does Decoding look like when a long MP3 takes many seconds? The indeterminate block has no "still working" step, and the spike (spec 4.5) may show decode is slow. (02 · s2)
4. What does the figure stack look like for a take at `MAX_DURATION_S`? The default zoom (3.4) depends on D5 and on her typical take length. (02 · s5)
5. Is running the speaker check on every visit acceptable to her, or does Pitch match become a chore? This depends on Q15. (02 · s6)
6. Has anyone listened to an exercise with VoiceOver, including whether the single-word announcements reach the mic through speakers (D13)? (04 · a2)
7. What is the contrast of the new figure marks (cents marks, hollow vibrato marks, span shading, hold brackets) in both themes? DESIGN.md 1.3 has a table for M1 colours only. The Loud plot surface in tokens.css is still the old blue. (04 · a3)
8. Opening a new file in Done wipes the current results at once (3.3). Nothing is saved, but should the drop zone say that the current analysis will be replaced? (06 · r2)

## Not reviewed today (1)

- 03 Edges: e3 slow or intermittent connection (local-first, nothing loads at run time)

07 AI check: not applicable, M2 has no AI or ML.
