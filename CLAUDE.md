# Music Tools

Local-first singing practice and study tools in the browser. M1 is the measurement core (pitch, cents, vibrato, spectrum) plus a bare test page. For practice and study, not a diagnostic or medical device.

## Stack and commands

- Stack: TypeScript + Vite (browser, AudioWorklet), Python 3.12 references (librosa pYIN, Praat via parselmouth, mir_eval)
- Run: `npx vite` (test page at http://127.0.0.1:5173), or preview server `m1-testpage` in `.claude/launch.json`
- Typecheck: `npm run typecheck`
- Validate: `./validate.sh` (synthetic + Vocadito), `./validate.sh raw` (adds recordings in `data/raw/`). Results land in `results/`; `VALIDATION.md` quotes `results/summary.json`.

## Key directories

- `src/dsp/`: tracker, spectrum, cents, vibrato. Shared by the AudioWorklet and the Node runner, so it must stay free of DOM and Node APIs.
- `py/`: synthetic generator, reference trackers, scorer.
- `tools/`: Node runners for the TS code.

## How to work here

Agents come from the joseph-alfonso bank (joealfonso/AgentsAndSkills), enabled in `.claude/settings.json`: dev-team, review-personas, guardrails, writing, web-team, design-review.

The main session orchestrates. Subagents can't spawn other subagents, so delegate from here.

- UI or flow work: designer writes the spec first, then engineer builds it.
- Everything else (DSP, tools, data): spec-writer writes the acceptance criteria first, so test-writer has something to test against.
- Something is broken and the cause isn't obvious: debugger finds the root cause, then engineer fixes it.
- engineer never reviews its own work. After a change, run code-reviewer on the diff and test-writer against the spec.
- Built UI: a11y-auditor checks it. Docs (README, MEASUREMENT.md, VALIDATION.md): tech-writer, grounded in the code and real command output.
- Before building a new screen: run the design-review-card.
- When a piece of work is done, review it with the relevant persona via review-as (burned-out engineer for specs and code plans, the user who hates this for UI, cross-functional eng lead before a build).

## Subagent models

Set the `model` on every subagent by the job, then review every result before it lands:

- Haiku: mechanical work. Running and reading validate output, screenshots, renames, doc and log updates, code searches.
- Sonnet: routine, well-specified edits.
- Opus: design-heavy or tricky work. DSP, audio architecture, planning.

## Conventions that cause bugs if missed

- Every number in VALIDATION.md must be reproducible by `./validate.sh`. Re-run it after any change to `src/dsp/` and update the doc from `results/summary.json`, never by hand.
- `datasets/`, `data/raw/`, `.venv`, and caches stay out of git.

## Rules

- No em dashes. Use commas. Say "I" for my own work, not "we".
- Don't invent metrics, results, or quotes. Leave a marked gap and ask.
- Never weaken or delete a test or a validation threshold to make it pass. Report failures as failures.

## Boundaries

- Always: typecheck and re-run validation before calling DSP work done.
- Ask first: new dependencies, anything that deploys.
- Never: commit secrets or recordings, push to `main`.
- Dev servers: stop by PID, never `pkill`/`killall`.
