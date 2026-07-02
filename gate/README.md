# gate — the gap-review courier engine

Automates the DEV_RULES *Gap-Review Gate* loop so the human stops hand-carrying prompts and findings between the **Build-Guide orchestrator** and the fresh **review instances**. Each reviewer is a genuinely separate **PEER** Claude — its own Agent SDK `query()` process on the **Max subscription** (the engine strips `ANTHROPIC_API_KEY` so auth is the `claude.ai` login), **never a subagent**. The script is the dumb courier + loop; the orchestrator stays a real agent that folds findings and pages the human only on genuine decisions.

See **`.agent/DEV_RULES.md` v4.1.0** for the method, and the canonical worked example: `everlastings-website/assets/docs/archive/v3_2/v3_2_3_REVIEW_PROMPTS.md`.

## Design principle — script = stable plumbing; method = editable data

The engine never hard-codes the method. Everything that *evolves* lives as data, so adapting the workflow means editing markdown/config, never the script:

- **`templates/review-prompt.md`** — the parameterized review-prompt the orchestrator fills each round, then regenerates on disk as `vX_Y_Z_REVIEW_PROMPTS.md`. **STATIC prose = the method** (the three-part lens, flag-don't-assert, the counter-reflex lines) — keep it verbatim, *never trim as "redundant."* The one **machine contract** the engine relies on: each angle's prompt sits in a fenced block under its `## Angle X —` header.
- **`config.ts`** — angle definitions (access + what-to-hand) and per-node model/effort: **orchestrator** = Opus `xhigh`, repo, resumable; **reviewers** = Opus `max`; **A = no repo** (docs inlined), **B/C/D = repo**.
- **`<target-repo>/.agent/GATE_NOTES.md`** — per-project data (see `templates/GATE_NOTES.example.md`): the `project_doc:` line gate inlines, plus the versioning scheme the orchestrator follows.

## How it works (one run)

1. `gate <IMPLEMENT-path>` derives the repo root (nearest `.git`), the same-version core docs (IMPLEMENT + two addenda + the project doc), and the matching `REVIEW_PROMPTS.md`.
2. It spawns the round's reviewers as separate SDK peers — **A** in a temp cwd with all file tools denied (physically no repo; docs inlined); **B/C/D** in the repo, in parallel — and writes each `GAP_REVIEW_<angle>.md`, reading the verdict trichotomy.
3. Not all READY → it resumes **your** orchestrator thread (found by its `/rename` title), which validates + folds + bumps + runs the breadth subagents + regenerates the prompts, returns a **structured control payload**, and writes its own `/compact` arg — which the engine then drives on that session.
4. A decision-shaped finding **pauses** the loop for you (a plain terminal prompt, no timeout). Loop until every angle is READY.

## Run

```bash
gate ~/Development/<repo>/assets/docs/archive/vX_Y/vX_Y_Z_IMPLEMENT.md --phase A
gate <IMPLEMENT-path> --dry-run     # resolve + parse + report, spawn nothing (no spend)
gate <IMPLEMENT-path> --phase BCD --max-rounds 8
```

Needs `node` 22+ (the SDK + `tsx` are installed in this dir). Auth is the `claude.ai` Max login — no `ANTHROPIC_API_KEY` needed or used.

## Status

Foundation **proven**: subscription auth (`claude.ai / max`), `/compact` drivable via the SDK, Angle-A filesystem wall, and orchestrator-thread resume-by-title all verified; `--dry-run` validated against real Everlastings docs. **Next:** the supervised live pilot hardens the fold contract under load, the phase A→B/C/D transition, and the Build Guide Final Cuts end-game (`src/probe.ts` runs the individual verification gates).
