// gate/config.ts — the editable per-node config (the "data" the engine reads).
// Change the workflow by editing THIS + templates/review-prompt.md, never the engine.

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface NodeCfg {
  model: string;   // "opus" resolves to the latest Opus on the Max subscription
  effort: Effort;
  repo: boolean;   // does this node get repo/file access?
}

export interface AngleCfg {
  key: "A" | "B" | "C" | "D";
  name: string;
  repo: boolean;        // A = false (the no-repo wall); B/C/D = true
  readsFirst?: string[]; // docs to read before the build (e.g. the architecture doc for C)
  conditional?: boolean; // D: include only when the build carries substantial design/UX
  charge: string;        // the angle-specific instruction (fills {{..._CHARGE}} in the template)
}

// ── Nodes ───────────────────────────────────────────────────────────────────
export const ORCHESTRATOR: NodeCfg = { model: "opus", effort: "xhigh", repo: true };
export const REVIEWER:     NodeCfg = { model: "opus", effort: "max",   repo: true }; // A overrides repo→false

// ── Angles ────────────────────────────────────────────────────────────────--
export const ANGLES: AngleCfg[] = [
  {
    key: "A", name: "cold / out-of-repo (self-containment + completeness)", repo: false,
    charge:
      "1) SELF-CONTAINMENT: every place the builder would have to open a file, guess, recall a library's behavior, or make a decision the docs didn't make — across ALL docs, including the design addendum. " +
      "2) COMPLETENESS / PARITY through the lens: can the user FULLY do the thing in every surface the North Star names? Cross-check each capability; flag any that reads covered but isn't drivable.",
  },
  {
    key: "B", name: "fidelity", repo: true,
    charge:
      "Open every file the plan edits. Every CURRENT block matches the working tree BYTE-FOR-BYTE (line numbers are hints; the quoted text is the anchor). Every NEW block applies cleanly + references only things that exist. Flag any CURRENT that no longer matches — it forces the builder to DISCOVER/DECIDE.",
  },
  {
    key: "C", name: "integration", repo: true, readsFirst: ["{{ARCH_DOC}}"],
    charge:
      "Hunt system-fit gaps through the lens: a locally-correct edit that, in the wider system, makes a capability fail or leak, or breaks a render. Scoping, idempotency, auth, resource caps, AR conflicts, stale pointers. Design integration is in scope (design edits touch the same files functional edits do — do they compose?).",
  },
  {
    key: "D", name: "design-correctness", repo: true, conditional: true,
    readsFirst: ["{{DESIGN_ADDENDUM}}", "{{DESIGN_SOURCES}}"],
    charge:
      "You are the lens A (no repo) and B/C (fidelity/integration) under-weight: does the UI actually RENDER right, is it ACCESSIBLE (reduced-motion, screen-reader), RESPONSIVE, and does it MATCH the design addendum? The 'columns-bug' class is home turf — a spec that applies cleanly but renders wrong/incomplete. Judge concrete-default + render-tune, not final pixels.",
  },
];

// The engine always runs each node with ANTHROPIC_API_KEY unset → the Max subscription.
