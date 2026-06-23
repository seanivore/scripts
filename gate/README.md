# gate — the gap-review courier engine

Automates the DEV_RULES §*The Gap-Review Gate* loop so the human stops hand-carrying prompts and findings between the **Build-Guide orchestrator** and the fresh **review instances**. Each reviewer is a genuinely separate **PEER** Claude — a `claude -p` subprocess on the **Max subscription** (run with `ANTHROPIC_API_KEY` unset), **never a subagent**. The script is the courier; the orchestrator stays a real agent that folds findings and pages the human only on genuine decisions.

See **`.agent/DEV_RULES.md` v4.1.0** for the method, and the canonical worked example: `everlastings-website/assets/docs/archive/v3_2/v3_2_3_REVIEW_PROMPTS.md`.

## Design principle — script = stable plumbing; method = editable data

The engine never hard-codes the method. Everything that *evolves* lives here as data, so adapting the workflow means editing markdown/config, never the script:

- **`templates/review-prompt.md`** — the parameterized review-prompt the orchestrator fills each round, then regenerates on disk as `vX_Y_Z_REVIEW_PROMPTS.md`. **STATIC prose = the method** (the three-part lens, flag-don't-assert, the counter-reflex lines) — keep it verbatim, *never trim as "redundant"* (a tidy-up quietly reopens the narrowing it beat back). **`{{PLACEHOLDERS}}` = per-build / per-round** (filled by the orchestrator).
- **`config.ts`** *(Phase 3)* — angle definitions (access + what-to-hand) and per-node model/effort:
  - **orchestrator** — latest Opus, effort `xhigh`, repo access, persistent/resumable;
  - **reviewers** — latest Opus, effort `max`; **A = no repo** (docs only), **B/C/D = repo** (+ docs + the shared ledger).

## Phases

- **Phase 2** *(in progress)* — externalize the method as templates/config (this dir).
- **Phase 3** — the TypeScript engine (`claude -p` orchestration: spawn peers, courier files, parse the verdict trichotomy, loop with angle-by-angle scoped re-runs, version bookkeeping, decision-pause).
- **Phase 4** — the `~/bin` launcher + this README.
- **Phase 5** — gate the tool on itself, then pilot on a live IMPLEMENT.

## Run (first cut)

```bash
# from inside the target repo (so the orchestrator + B/C/D reviewers see it):
cd <target-repo>
tsx /Users/seanivore/Development/scripts/gate/src/gate.ts docs/archive/vX_Y/vX_Y_Z_IMPLEMENT.md --phase all
```

Runs with `ANTHROPIC_API_KEY` unset → the Max subscription. Needs `node` 22+ and `tsx` on PATH. A `~/bin/gate` launcher (Phase 4) will wrap this. **Not yet run end-to-end** — the Phase 5 pilot on a real IMPLEMENT hardens the orchestrator JSON contract, A's no-repo enforcement, the end-game cleanup, and breadth-subagent wiring.
