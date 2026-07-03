# gate — NEXT_UPDATE backlog

Non-urgent improvements to fold in *between* real build-guide runs (never mid-flight).
Newest at top. When one ships, move it to a "Done" note in the README/commit and delete here.

---

## 1. Decision-pause should be a two-way conversation (UX)

**Observed (v3_6, round 1→2):** gate surfaced 2 decisions correctly. Sean answered both — and his answers *included questions back to the orchestrator* ("I'm confused by the question and what B is — can you explain why you think B so I better understand and can decide?" / "what do you think of that logic? … you can advise what the best option is"). gate took the typed answers, silently re-folded, printed `compacted forward`, and jumped to Round 2. **Sean never saw the orchestrator respond** — his questions went unanswered and he couldn't tell if his reasoning was even received.

**Why it matters:** a decision-pause is exactly where the human most needs dialogue — half the time Sean is *asking the orchestrator to help him decide*, not handing down a verdict. One-shot "answer → fold → move on" defeats the point.

**Fix direction:**
- After the human answers, **print the orchestrator's response** (its reasoning / how it's folding / any answer to a question the human asked) before advancing.
- Allow a **back-and-forth loop**: if the human's answer contains a question (or they type `?`/`ask`), re-prompt the orchestrator, show its reply, and re-ask the human — repeat until the human gives a clear decision, *then* fold.
- Keep the no-timeout readline; this is deliberately human-paced.
- Consider showing the orchestrator's *recommendation rationale* up front with each decision (it already computes "Recommended: (b) …") so Sean has the reasoning before he answers.

---

## 2. End-game orchestration — condense, phase handoff, final cuts (the deferred PILOT-HARDEN)

**Context (v3_6 pilot):** the A cycle bloated to a 283 KB / ~81k-token IMPLEMENT and never got its clean-up read, then the rate limit cut it off before A reached READY. Two of the three end-game steps were never wired into the engine (they carried a `PILOT-HARDEN: driven by hand` comment). DEV_RULES §End-game cleanup + §Versioning ("demarcate phases with a MINOR bump") is the spec.

- **(a) Condense-on-NARROW — PARTIALLY DONE.** The fold prompt now instructs the orchestrator, on any NARROW verdict, to do the DEV_RULES "Clean-up read" (end-to-end read → condense, keeping a diffable `…_IMPLEMENT_2.md` pre-condense copy per carve-out #1) before regenerating the final narrow prompt. **Still to verify live** that the orchestrator actually performs it under load and that the doc shrinks.
- **(b) Phase-transition directory handoff — NOT DONE.** When an angle-type's cycle clears (e.g. cold-A all READY), gate currently just `break`s. It should instead drive the orchestrator to: fold the final report (PATCH), then **MINOR-bump + copy** the living docs into a new `vX_(Y+1)/` dir so the next phase (B/C/D) opens with its own directory + patch-trail (DEV_RULES: A-loop lives in `vX.6.*`, B/C/D opens at `vX.7.0`), leaving the terminal GAP_REVIEW records in the old dir. "Don't strand an empty directory" — copy the old dir's final-state living docs if it would otherwise empty out. Then gate re-points at the new dir and continues with the next phase's angles.
- **(c) Build Guide Final Cuts — NOT DONE.** After ALL angles (A + B/C/D) verdict READY: drive the orchestrator to strip provenance/changelog/gap-review framing, move long rationale to a sibling `…_RATIONALE.md`, and **MAJOR-bump** (plan → execution). This is the plan's exit.

Design note: gate should decide *phase-clear vs whole-gate-clear* from the fold payload's `nextAngles` (empty + which phase just ran), and the orchestrator owns the actual copy/renumber/header work (it manages versioning) — gate just triggers the step and follows the new paths. Likely wants a small `endGame` field on FOLD_SCHEMA so the orchestrator reports which handoff it performed and the new dir/version.

## 3. `gate --resume` — full checkpoint-based resume

**Context:** the graceful limit-halt (shipped) prints the correct current-version path to re-run, but the human still retypes the path + flags and picks the band. Under the tightened Max meter, hitting a limit mid-gate is now common, so resume should be one command.

**Fix direction:**
- Write a `.gate-state.json` checkpoint each round (in `archiveDir`): `{ implPath, reviewPromptsPath, archiveDir, active, round, flags, version }`.
- `gate --resume [dir]` reads the latest checkpoint and continues exactly where it stopped — right version, right band, same model/effort flags.
- Optional: for a **5-hour** limit (`rateLimitType: five_hour`), offer an auto-wait-then-continue (`--wait`) that sleeps until `resetsAt` and resumes on its own — the SDK's `rate_limit_event` carries `resetsAt` + `rateLimitType`. A **weekly** limit can't be slept: checkpoint + clean exit (current behavior) is correct there.

---

## Shipped (for reference, delete when stale)
- TTY spinner heartbeat on long reviewer / fold / compact turns.
- Per-run model/effort override flags (`--opus-4-7-reviewers`, `--<model>-reviewer-b-d-c`, `--<model>-all`, `=value`, bare-effort binding).
- Graceful Max-limit halt: catches the SDK throw, prints reset time + the exact continue command, exits clean (no stack trace).
