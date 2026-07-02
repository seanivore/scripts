<!-- Copy this to <target-repo>/.agent/GATE_NOTES.md and fill it in per project.
     gate reads ONE machine line from here — `project_doc:` — to know the non-versioned
     project/architecture doc to inline into every reviewer prompt (the one file it can't
     derive from the IMPLEMENT's version number). Everything else on this page is prose for
     the ORCHESTRATOR thread (it reads the whole repo), so per-project method lives here and
     travels with the repo — never lost in a chat. -->

# Gate notes — <PROJECT NAME>

project_doc: assets/docs/EVERLASTINGS_STORE.md

## Versioning scheme (the orchestrator follows this)

<!-- Example — Everlastings. Replace with this project's real scheme. -->
- **Patch bump** after each fold round that's validated + folded + given the 2-subagent breadth pass
  (self-gap rounds, and each A / B/C/D round).
- **Minor bump** to hand off to fresh-instance gate reviews: the IMPLEMENT, both addenda, and
  REVIEW_PROMPTS go up a minor, leaving the final `vX_Y.z` docs in the `vX_Y/` dir, and the
  A-type kickoff docs are created in a **new `vX_(Y+1)/` dir**. After A closes (with the
  consolidation pass before the last narrow A), the same again into the next `vX_(Y+2)/` for B/C/D.
- **Major bump** for the final clean copy: after B/C/D close + the 2-subagent breadth pass, the
  extra-thorough consolidation + architecture-removal produces the `v(X+1)_0_0` docs the build
  implementation orchestrator executes from.
- Leave at least the final versioned docs in each `vX_Y/` dir — never an empty dir.

## Anything else the orchestrator should hold across rounds

<!-- North-star reminders, known problem areas, project-specific landmine conventions, etc. -->
