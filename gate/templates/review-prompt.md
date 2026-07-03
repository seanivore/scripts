<!-- ============================================================================
gate/templates/review-prompt.md — the externalized gap-review method.

The Build-Guide orchestrator fills the {{PLACEHOLDERS}}, injects the ledger, and
regenerates this whole file on disk as `vX_Y_Z_REVIEW_PROMPTS.md` each round.

RULES FOR THE GENERATOR:
- SELF-CONTAINED BLOCKS — the load-bearing rule. The `gate` courier extracts ONLY the fenced
  ``` block under each `## Angle X —` header and sends it verbatim to a FRESH, no-context
  reviewer (gate inlines the four core docs separately, above the block). So every block must be
  fully PASTE-READY on its own. Wherever a bracket below reads "[THE REVIEW LENS — verbatim]",
  "[THE SETTLED BASE — verbatim]", or names the ledger, EXPAND THE FULL TEXT INLINE at that spot.
  NEVER leave a bracket, a "[paste … from above]" note, or "you have this whole file in context"
  — the reviewer receives ONLY this block; anything not inlined never reaches it (this is the bug
  that starved a cold-A into a rubber-stamp). It is also what lets Sean paste any single block by hand.
- THE FULL LEDGER is inlined in EVERY block — it costs nothing per reviewer (each gets exactly one
  block). Keep ALL FOUR angle blocks present and current every round (fold each round's new ledger
  entries into every block), even while only some run this round — they must be ready when their phase arrives.
- STATIC prose below = the method (the three-part lens, flag-don't-assert, the counter-reflex
  lines). Reproduce it VERBATIM in every block. NEVER trim it as "redundant" — each line overrides
  a model instinct to do less; trimming quietly reopens the narrowing it beat back (DEV_RULES v4.1.0).
- OUTPUT CONTRACT, ending every block: the reviewer RETURNS its findings as its reply — it does
  NOT write a file (the courier saves the reply). And a review that finds NOTHING is suspect: a
  real build always has polish / non-breaking items, and even READY TO BUILD ships with them
  ("nothing to find" reads as "didn't look", not "perfect").
- Do NOT manufacture a persona ("you are a senior engineer…") — lead with the task + lens.
- Verdict is a TRICHOTOMY everywhere: READY TO BUILD / NEEDS ANOTHER PASS /
  NEEDS ANOTHER PASS (NARROW).
- MACHINE CONTRACT (the `gate` engine parses this — keep it stable): each angle's
  reviewer prompt stays in a fenced ``` block DIRECTLY under its `## Angle X —` header;
  gate extracts that block verbatim and inlines the four core docs above it. Optional
  explicit <!-- GATE:PROMPT:X --> … <!-- /GATE:PROMPT:X --> markers around the block are
  honored first. gate derives the docs + versions from the IMPLEMENT path (not this prose).
- Canonical worked example (fully self-contained per block): everlastings-website/.../v3_1/v3_1_7_REVIEW_PROMPTS.md
============================================================================ -->

# {{VERSION}} — Gap-review prompts ({{GATE_STATUS_SUMMARY}})

<!-- GATE_STATUS_SUMMARY e.g. "A-gate CLOSED at round 7; B/C/D round 3 — B+C READY, D NEEDS ANOTHER PASS (narrow)" -->

**The build under review** = {{BUILD_DOCS}} ({{BUILD_DESCRIPTION}}). The IMPLEMENT **and every addendum are ONE build; every addendum is always in scope.** Effort: **maximum**. **A new instance per pass** (no context contamination). Reviewers change **NOTHING** — output is findings only, written to the named `GAP_REVIEW` file.

**What to hand each angle:** **A** = the docs ONLY, **NO repo** (the absence is the point). **B / C / D** = the whole repo + the docs. **C** also reads {{ARCH_DOC}} first; **D** also reads {{DESIGN_SOURCES}}. An optional final cold-A holistic pass (after B/C/D clean) gets the docs only, no repo. (Every reviewer receives only its own self-contained angle block — the courier delivers that block plus the four core docs, so the ledger + lens live INSIDE the block, never "assumed in context.")

---

## The settled base — don't re-litigate what's shipped
<!-- INCLUDE only when this build is a DELTA on a shipped/tested system; omit for a greenfield plan-it-all. -->
The current system — everything in {{ARCH_DOC}} and present in the repo today — is **built, tested, and approved**; the fixed, proven substrate. **{{VERSION}} is a DELTA on top.** Review the {{VERSION}} changes for gaps + whether they **FIT** the base; do **NOT** redesign or flag settled/shipped behavior — a finding must be about what *this build* adds/changes, or a real conflict it creates with the base.

## ⭐ The review lens (in every block — all three parts)

**(a) North Star / thesis — THIS build's:** {{BUILD_NORTH_STAR}}
<!-- the problem THIS build/phase solves (it evolves per phase; an angle may tailor it). A capability that reads "covered" but isn't actually drivable is a REAL gap, not a nitpick. -->

**(b) Broader mandate — the lens must NOT shrink the scope:** the North Star is the primary *functionality* lens, **NOT** the filter for what counts as a gap. Across the **whole build (the IMPLEMENT + every addendum), every element** — *do not neglect the design addendum even if you're "not the design reviewer"; the value is many eyes on the **whole**, not tidy specialization* — also catch anything not truly **exclusively-executable**, any **unvalidated assumption**, and any **design-correctness** failure (the "columns-bug" class: a spec that *applies* cleanly but *renders wrong/incomplete*).

**(c) Read in full · co-design · flag-don't-assert:** read ALL provided docs **end-to-end** and **don't ration tokens** (you're at max effort, context is managed for you; grep/jump reading has produced real mis-diagnoses). **Co-design, don't just audit:** a gap is a gap whether it's a flaw in what we wrote **OR** something the build should address but omitted — don't assume it's mostly complete. **Flag-don't-assert:** when a finding depends on runtime/code you can't directly see, **FLAG it *needs-verification* — do NOT assert it "broken"** (whole rounds of false alarms came from confident "broken" calls the code disproved; on a delta prefer *"I can't verify X from the docs"* over *"X is broken"* — it cuts both ways).

## Settled — do not re-raise (the shared ledger; validate against reality, not training data)
<!-- Current-only + bounded. Every entry = a VERIFIED finding from a prior round. A superseding
     fold REPLACES its entry (never append a contradiction — no mixed truth); prune at each condense.
     The orchestrator validates each new finding against reality BEFORE folding; only verified ones land here. -->
{{LEDGER}}

---

## Angle A — cold / out-of-repo (self-containment + completeness)

```
Pre-build gap review. Effort: maximum. Do NOT change anything — your only output is findings (write them to {{GAP_REVIEW_A}}, or print the full file contents if you have no filesystem).

[THE REVIEW LENS — all three parts, verbatim: INLINE THE FULL TEXT HERE]
[READ IN FULL · CO-DESIGN · FLAG-DON'T-ASSERT — verbatim: INLINE THE FULL TEXT HERE]
[THE SETTLED BASE — verbatim: INLINE THE FULL TEXT HERE, if a delta build]

CONTEXT
- You are given these documents and NO repository: {{DOC_LIST}}. A FRESH agent executes ALL of it {{EXEC_TARGET}}, then tests {{TEST_TARGET}}. "Exclusively executable" = the docs embed the exact current code + exact replacement for every edit, so the builder LOCATES and APPLIES, never DISCOVERS or DECIDES.
- LANDMINES = the "Settled — do not re-raise" ledger, inlined above IN THIS BLOCK. Validate each against reality, FLAG-don't-assert, and do NOT re-raise any as a new finding.

ANGLE A — cold / out-of-repo. Your lack of a repo is the point. Two jobs:
1. SELF-CONTAINMENT: every place the builder would have to open a file, guess, recall a library's behavior, or make a decision the docs didn't make — across ALL docs, including the design addendum.
2. COMPLETENESS / PARITY (the holistic pass, through the lens): {{COMPLETENESS_CHARGE}}

OUTPUT
- A gap list RANKED by how likely each is to derail the build or leave a capability missing: location (doc/section/phase), what's wrong/missing, the concrete fix.
- The single most important "if you fix one thing" insight.
- One-line verdict: READY TO BUILD / NEEDS ANOTHER PASS / NEEDS ANOTHER PASS (NARROW).
Be concrete: "{{CONCRETE_EXAMPLE}}" beats a vague gesture.
```

## Angle B — fidelity (repo)

```
Pre-build gap review. Effort: maximum. Do NOT change code or docs — output findings only (write them to {{GAP_REVIEW_B}}).

{{#if SCOPED_RERUN}}
⚠️ ROUND-{{N}} RE-RUN — SCOPED, NOT A FRESH REVIEW. You returned READY TO BUILD on {{PRIOR_VERSION}}: you already read the whole build end-to-end and cleared it on fidelity. We re-run for ONE reason — these folds since then landed in YOUR (fidelity) lane: {{LANE_CHANGES}}. YOUR SCOPE = confirm EXACTLY those (do the NEW blocks quote the real CURRENT? do new references resolve?). Do NOT re-audit the anchors you cleared; do NOT surface polish. The "read the whole build / don't shrink the scope" mandate below was for your FIRST pass — you did it and cleared it, so this narrowed delta-scope is DELIBERATE, not a violation.
{{/if}}

[THE REVIEW LENS — all three parts, verbatim]
[READ IN FULL · CO-DESIGN · FLAG-DON'T-ASSERT — verbatim]
[THE SETTLED BASE — verbatim, if a delta build]

CONTEXT
- The build = {{DOC_LIST}}. A FRESH agent applies ALL of it to THIS repo, then tests {{TEST_TARGET}}. Every code edit quotes a CURRENT block (locator) + a NEW block. Byte-check the design addendum's DECIDED blocks at the same bar; for render-tuned defaults judge "concrete enough the builder never guesses," not whether it's the final value.
- LANDMINES = the "Settled — do not re-raise" ledger, inlined above in this block. Validate against the repo, FLAG-don't-assert, do NOT re-raise.

ANGLE B — fidelity. Open every file the plan edits and verify: every CURRENT block matches the working tree BYTE-FOR-BYTE (line numbers are hints; the quoted text is the anchor); every NEW block applies cleanly + references only things that exist; {{FIDELITY_CHECKS}}.

OUTPUT
- Ranked list: location, the mismatch, the corrected anchor/fix.
- The single most important fix.
- One-line verdict: READY TO BUILD / NEEDS ANOTHER PASS / NEEDS ANOTHER PASS (NARROW).
```

## Angle C — integration (repo + architecture)

```
Pre-build gap review. Effort: maximum. Do NOT change code or docs — output findings only (write them to {{GAP_REVIEW_C}}).

{{#if SCOPED_RERUN}}
⚠️ ROUND-{{N}} RE-RUN — SCOPED, NOT A FRESH REVIEW. You returned READY TO BUILD on {{PRIOR_VERSION}}: you already traced the whole system and cleared its integration. We re-run for ONE reason — these folds landed in YOUR (integration) lane: {{LANE_CHANGES}}. YOUR SCOPE = confirm those compose in the wider system. Do NOT re-trace the contracts you cleared; do NOT surface polish. The narrowed scope is DELIBERATE, not a violation.
{{/if}}

[THE REVIEW LENS — all three parts, verbatim]
[READ IN FULL · CO-DESIGN · FLAG-DON'T-ASSERT — verbatim]
[THE SETTLED BASE — verbatim, if a delta build]

CONTEXT
- Read {{ARCH_DOC}} FIRST, then the build docs. A FRESH agent applies the WHOLE build to this repo + tests {{TEST_TARGET}}. DESIGN INTEGRATION IS IN SCOPE (the design edits touch the same files the functional edits touch — check they compose).
- LANDMINES = the "Settled — do not re-raise" ledger, inlined above in this block. Validate against reality, FLAG-don't-assert, do NOT re-raise.

ANGLE C — integration. Hunt system-fit gaps through the lens: a locally-correct edit that, in the wider system, makes a capability fail or leak, or breaks a render. {{INTEGRATION_CHECKS}}.

OUTPUT
- Ranked list: location, the integration gap, the concrete fix.
- The single most important fix.
- One-line verdict: READY TO BUILD / NEEDS ANOTHER PASS / NEEDS ANOTHER PASS (NARROW).
```

## Angle D — design-correctness (CONDITIONAL — include when the build carries substantial design/UX)

```
Pre-build gap + design review. Effort: maximum. Do NOT change code or docs — output findings only (write them to {{GAP_REVIEW_D}}).

[THE REVIEW LENS — all three parts, verbatim; (a) may be design-flavored]
[READ IN FULL · CO-DESIGN · FLAG-DON'T-ASSERT — verbatim]
[THE SETTLED BASE — verbatim, if a delta build]

CONTEXT
- Read {{DESIGN_ADDENDUM}} + the parts of the IMPLEMENT it depends on + the repo's relevant render surfaces + {{DESIGN_SOURCES}}. The bar: design ships as concrete-default + render-tune — judge "concrete enough to build + correct + accessible," NOT final pixels.
- LANDMINES = the "Settled — do not re-raise" ledger, inlined above in this block. Validate against reality, FLAG-don't-assert, do NOT re-raise.

ANGLE D — design-correctness. You are the lens A (no repo) and B/C (fidelity/integration) under-weight: does the UI actually RENDER right, is it ACCESSIBLE (reduced-motion, screen-reader), RESPONSIVE, and does it MATCH the design addendum? The "columns-bug" class is your home turf — a spec that applies cleanly but renders wrong/incomplete (e.g. removing an inline style assuming a stylesheet rule wins the cascade — does that rule exist and win?). {{DESIGN_CHECKS}}.

OUTPUT
- Ranked list: location, the design-correctness gap, the concrete fix.
- The single most important fix.
- One-line verdict: READY TO BUILD / NEEDS ANOTHER PASS / NEEDS ANOTHER PASS (NARROW).
```

---

<!-- AFTER A ROUND: orchestrator validates findings (flag-don't-assert → verify before folding) → folds the
     real ones → bumps the version → updates the ledger (replace superseded entries) → regenerates this file →
     compacts its session FORWARD (as if the just-prepped reviews are already done) → re-runs an angle ONLY if a
     fold landed in its lane (scoped + narrowed). Folds touching no lane → that angle stays CLOSED. The 2-subagent
     breadth pass is the cross-lane backstop. Loop until each angle's fresh pass finds nothing load-bearing. -->
