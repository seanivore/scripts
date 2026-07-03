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

- **(a) Condense-on-NARROW — DONE (verify live).** Consolidate is now a **distinct wired step** (not smushed into the fold): its own orchestrator turn, its own PATCH bump, its own breadth pass. In-loop, a NARROW verdict auto-triggers it after the fold (4-step protocol: fold → consolidate → final cold-A). Also enterable mid-workflow via **`gate <IMPLEMENT> --consolidate [--compact-first]`** — runs the clean-up read, then falls into the loop on the cleaned doc. **No `_2.md` pre-condense copy** (Sean's call: the docs are now too big to read, so the rigor trail lives in the bulked GAP_REVIEW files, not inline notes — carve-out #1 is moot for this flow). **Still to verify live** the orchestrator actually shrinks the doc and the breadth pass confirms integrity.
- **(b) Phase-transition directory handoff — DONE (verify live).** A READY verdict is never a bare stop — it folds the final findings first. When cold-A clears, gate runs `phaseHandoffA`: final fold (PATCH) → **MINOR bump + copy** living docs into a new `vX_(Y+1)/` dir → generate B/C/D prompts there → gate re-points and continues with B/C/D. Standing GAP_REVIEW records stay in the old dir.
- **(c) Build Guide Final Cuts — DONE (verify live).** When B/C/D clears: final fold (PATCH) → **compact self** (clean context before the condense — Sean's rule) → `finalCutsStep`: clean condense (strip provenance/changelog/gap-framing, rationale → sibling `…_RATIONALE.md`) → 2 subagents → final version bump. Bump size = the `GATE:FINAL_BUMP` marker at the top of the IMPLEMENT (or `--final-bump major|minor`; absent → orchestrator decides).

**Still to verify LIVE (the whole end-game only fires at phase-clear, never reached in the pilot yet):** that the orchestrator actually (1) performs the minor-bump dir copy correctly and returns absolute paths gate can follow, and (2) does the final clean condense + correct major bump. These are the highest-value things to watch when A first clears.

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
