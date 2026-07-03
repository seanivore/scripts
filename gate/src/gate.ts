#!/usr/bin/env -S npx tsx
// gate/src/gate.ts — the gap-review courier loop, on the Agent SDK.
//
//   gate <IMPLEMENT-path> [--phase A|BCD|all] [--max-rounds N]
//        [--orchestrator-title "IMPLEMENT Build Planning Orchestrator"] [--orchestrator-id <uuid>]
//        [--project-doc <path>]
//
// The SCRIPT is the dumb, stable courier + loop. The agentic work stays with peer Claudes:
//   • ORCHESTRATOR — Sean's RESUMED thread (his "IMPLEMENT Build Planning Orchestrator"),
//     Opus/xhigh, repo access. Validates + folds findings, bumps the version, updates the
//     ledger, runs the 2 breadth subagents, regenerates REVIEW_PROMPTS, WRITES its own
//     /compact arg to disk, and flags DECISIONS for the human. Reached via runQuery({resume}).
//   • REVIEWERS — fresh, separate SDK query() peers (never subagents): A = temp cwd + all file
//     tools denied (physically no repo; the 4 core docs are inlined); B/C/D = repo cwd, parallel.
//
// What gate parses from REVIEW_PROMPTS is ONLY each angle's fenced prompt block (under its
// `## Angle X` header, or explicit <!-- GATE:PROMPT:X --> markers). Everything else — the four
// core docs, versions, next angles — is derived from the IMPLEMENT path or the orchestrator's
// structured control payload. Minimal parsing = maximum format-stability.

import { runQuery, findSessionByTitle, type RunResult } from "./sdk.ts";
import { ProgressView, demoProgress } from "./progress.ts";
import { ORCHESTRATOR, REVIEWER, type Effort } from "../config.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as readline from "node:readline/promises";

// ── Constants ────────────────────────────────────────────────────────────────
const HEADLESS = "bypassPermissions" as const;
const NO_FILE_TOOLS = ["Read", "Glob", "Grep", "Bash", "Write", "Edit", "NotebookEdit", "WebFetch"]; // A: pure reasoning
const READONLY = ["Write", "Edit", "NotebookEdit"];                                                   // B/C/D: read, mutate nothing
const DEFAULT_ORCH_TITLE = "IMPLEMENT Build Planning Orchestrator";

// Every reviewer RETURNS its review as its reply — gate saves it (the courier writes the
// GAP_REVIEW file). No reviewer writes a file. Appended to every reviewer prompt so this is a
// gate GUARANTEE, not something a regenerated prompt must remember (the dropped-escape-hatch bug).
const REVIEWER_OUTPUT_FOOTER = [
  ``,
  `---`,
  `OUTPUT — return your COMPLETE review as your reply (do NOT write a file; the courier saves your reply):`,
  `  1. The ranked list of findings — each names the exact workstream/phase/anchor + a plain-language failure scenario.`,
  `  2. The single "if you fix one thing".`,
  `  3. The one-line verdict: READY TO BUILD · NEEDS ANOTHER PASS · NEEDS ANOTHER PASS (NARROW).`,
  `A review that finds NOTHING is suspect: a real build always has polish / non-breaking items worth surfacing, and even READY TO BUILD ships with them. "Nothing to find" reads as "didn't look", not "perfect" — take the time to find the real ones.`,
].join("\n");

// Angle A runs with the claude_code preset for GROUNDING (cwd/git/tool-discipline) but with NO
// repo/file/shell tools (its no-repo wall). Without this the preset advertises tools we then deny,
// and a starved A role-plays using a shell/subagents it never had. State the truth instead.
const ANGLE_A_SYSTEM_APPEND =
  "IMPORTANT: this run gives you NO file, shell, repo, web, or subagent tools — that absence is intentional (you are the cold, out-of-repo reader; the build docs are inlined in your prompt). Do not attempt to read files, run commands, write a file, or delegate to a subagent. Return your complete findings as your reply text.";

// The courier contract the orchestrator MUST honor whenever it (re)generates REVIEW_PROMPTS.
// gate extracts ONLY the fenced block under each `## Angle X` header, so DRY/placeholder
// authoring ("[paste the ledger from above]") starves the reviewer (the v3.6.4 bug). Injected
// into every orchestrator turn that regenerates the prompts.
const PROMPT_CONTRACT =
  `CRITICAL — write the REVIEW_PROMPTS so the gate courier delivers them intact. gate extracts ONLY the fenced code block under each "## Angle X —" header and sends THAT block verbatim to a fresh, no-context reviewer (gate inlines the four core docs separately, above the block). So EACH angle's fenced block MUST be fully self-contained + paste-ready: inline the COMPLETE current "Settled — do not re-raise" ledger, the full three-part review lens, and the settled-base paragraph directly INTO every block — NEVER a "[paste from above]" / "[LANDMINES …]" / "[REVIEW LENS]" placeholder (the courier sends those as literal text and the reviewer starves, engaging none of the accumulated findings). Keep ALL FOUR angle blocks present and current every round (fold each round's new ledger entries into every block), even while only some run this round — they must be ready when their phase arrives. Reproduce the static method prose verbatim per templates/review-prompt.md; do NOT trim it as "redundant". End each block with the output contract: the reviewer returns findings as its reply (never writes a file), and a review that finds NOTHING is suspect — even READY TO BUILD ships with polish / non-breaking items.`;

// gate couriers ONLY the fenced block under `## Angle X`, so each block MUST be fully
// self-contained (lens + settled-base + full ledger inlined). Refuse to spawn a reviewer on a
// block that is still an un-expanded template (placeholder directives) or implausibly thin —
// fail loud with the cause rather than silently run a starved review (the v3.6.4 bug).
const PLACEHOLDER_RE = /\[\s*(paste|landmines?|review lens|settled base|ledger)\b|paste\b[^\n]*\b(from above|in full|verbatim|here)\b/i;
function selfContainedIssue(anglePrompt: string): string | null {
  const hit = anglePrompt.match(PLACEHOLDER_RE);
  if (hit) return `holds a template placeholder ("${hit[0].trim()}") — the ledger/lens was referenced, not inlined`;
  if (anglePrompt.length < 2000) return `is only ${anglePrompt.length} chars — implausibly thin for a self-contained block (lens + settled-base + ledger + charge)`;
  return null;
}
function assertSelfContained(anglePrompt: string, key: string): void {
  const issue = selfContainedIssue(anglePrompt);
  if (!issue) return;
  die(
    `Angle ${key} prompt is not self-contained — it ${issue}.\n` +
    `  gate couriers ONLY the fenced block under "## Angle ${key}", so anything not inlined never reaches the reviewer.\n` +
    `  Regenerate REVIEW_PROMPTS with the full ledger + lens + settled-base inlined in EACH block (see templates/review-prompt.md).`,
  );
}

// The orchestrator's fold control payload (structured output → no fragile prose parsing).
const FOLD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    version: { type: "string", description: "New version after this fold, e.g. v3_6_1" },
    archiveDir: { type: "string", description: "Absolute dir where the regenerated docs now live" },
    reviewPromptsPath: { type: "string", description: "Absolute path to the regenerated REVIEW_PROMPTS.md" },
    foldedCount: { type: "number" },
    decisionsNeeded: { type: "array", items: { type: "string" }, description: "Human decisions; empty if none" },
    compactArg: { type: "string", description: "The self-authored /compact instruction for this round" },
    nextAngles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { key: { type: "string", enum: ["A", "B", "C", "D"] }, repo: { type: "boolean" } },
        required: ["key", "repo"],
      },
      description: "Angles to run NEXT round (scoped/narrowed re-runs only). Empty = gate clear.",
    },
    gateStatus: { type: "string", description: "One-line human status summary" },
  },
  required: ["version", "reviewPromptsPath", "nextAngles", "compactArg", "decisionsNeeded"],
} as const;

interface FoldPayload {
  version: string;
  archiveDir?: string;
  reviewPromptsPath: string;
  foldedCount?: number;
  decisionsNeeded: string[];
  compactArg: string;
  nextAngles: Array<{ key: string; repo: boolean }>;
  gateStatus?: string;
}

// ── Small helpers ────────────────────────────────────────────────────────────
function die(msg: string): never { console.error(`gate: ${msg}`); process.exit(1); }

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// ── Per-run model / effort overrides (the usage-meter knobs) ─────────────────
// Defaults live in config.ts (reviewers opus/max, orchestrator opus/xhigh); these flags
// only opt a given RUN down. Two equivalent routes, one resolver:
//   convenience — --opus-4-7-reviewers | --opus-4-7-reviewer-a | --opus-4-7-reviewer-b-d-c | --opus-4-7-orchestrator
//   explicit    — --reviewers <model> | --reviewer-a <model> | --orchestrator <model> | --reviewer-effort <lvl> | --orchestrator-effort <lvl>
// A bare effort flag (--max/--xhigh/--high/--medium/--low) binds to whichever node a model
// flag in the SAME command targeted (reviewers if none; error if both, use the explicit form).
type Angle = "A" | "B" | "C" | "D";
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

const MODEL_ALIASES: Record<string, string> = {
  // exceptions only — dated ids or anything the `claude-<slug>` pattern gets wrong
  "haiku-4-5": "claude-haiku-4-5-20251001",
};
function resolveModel(slug: string): string {
  if (MODEL_ALIASES[slug]) return MODEL_ALIASES[slug];
  if (["opus", "sonnet", "haiku"].includes(slug)) return slug;   // bare alias = latest
  return `claude-${slug}`;                                        // opus-4-7 → claude-opus-4-7
}

interface Overrides {
  reviewerModel: Record<Angle, string | undefined>;
  orchModel?: string;
  reviewerEffort?: Effort;
  orchEffort?: Effort;
}

function requireVal(v: string | undefined, flag: string): string {
  if (!v || v.startsWith("--")) die(`${flag} needs a value (a model, e.g. opus-4-7)`);
  return v;
}
function requireEffort(v: string | undefined): Effort {
  if (!v || !(EFFORTS as readonly string[]).includes(v)) die(`effort must be one of ${EFFORTS.join("|")}`);
  return v as Effort;
}

function parseOverrides(argv: string[]): Overrides {
  const reviewerModel: Record<Angle, string | undefined> = { A: undefined, B: undefined, C: undefined, D: undefined };
  let orchModel: string | undefined, reviewerEffort: Effort | undefined, orchEffort: Effort | undefined, bareEffort: Effort | undefined;
  let sawReviewerModel = false, sawOrchModel = false;
  const allAngles: Angle[] = ["A", "B", "C", "D"];

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith("--")) continue;
    const body = tok.slice(2);

    // explicit effort (always wins over a bare effort flag)
    if (body === "reviewer-effort") { reviewerEffort = requireEffort(argv[++i]); continue; }
    if (body === "orchestrator-effort") { orchEffort = requireEffort(argv[++i]); continue; }
    // explicit model (value in the NEXT token)
    if (body === "orchestrator") { orchModel = resolveModel(requireVal(argv[++i], tok)); sawOrchModel = true; continue; }
    if (body === "reviewers") { const m = resolveModel(requireVal(argv[++i], tok)); allAngles.forEach((k) => (reviewerModel[k] = m)); sawReviewerModel = true; continue; }
    const explRev = body.match(/^reviewer-([a-d])$/i);
    if (explRev) { reviewerModel[explRev[1].toUpperCase() as Angle] = resolveModel(requireVal(argv[++i], tok)); sawReviewerModel = true; continue; }
    // bare effort
    if ((EFFORTS as readonly string[]).includes(body)) { bareEffort = body as Effort; continue; }
    // convenience: --<slug>-all (every node → one model)
    let m = body.match(/^(.+)-all$/);
    if (m) { const md = resolveModel(m[1]); allAngles.forEach((k) => (reviewerModel[k] = md)); orchModel = md; sawReviewerModel = true; sawOrchModel = true; continue; }
    // convenience: --<slug>-orchestrator
    m = body.match(/^(.+)-orchestrator$/);
    if (m) { orchModel = resolveModel(m[1]); sawOrchModel = true; continue; }
    // convenience: --<slug>-reviewers (all)
    m = body.match(/^(.+)-reviewers$/);
    if (m) { const md = resolveModel(m[1]); allAngles.forEach((k) => (reviewerModel[k] = md)); sawReviewerModel = true; continue; }
    // convenience: --<slug>-reviewer-<letters> (a | a-b | b-d-c …)
    m = body.match(/^(.+)-reviewer-([a-d](?:-[a-d])*)$/i);
    if (m) { const md = resolveModel(m[1]); for (const L of m[2].split("-")) reviewerModel[L.toUpperCase() as Angle] = md; sawReviewerModel = true; continue; }
    // anything else isn't ours (--phase, --max-rounds, --dry-run, …) — left for arg()
  }

  if (bareEffort) {
    if (sawReviewerModel && sawOrchModel) die(`ambiguous --${bareEffort}: both a reviewer and an orchestrator model flag are present — use --reviewer-effort / --orchestrator-effort to say which.`);
    else if (sawOrchModel) orchEffort = orchEffort ?? bareEffort;
    else reviewerEffort = reviewerEffort ?? bareEffort;
  }
  return { reviewerModel, orchModel, reviewerEffort, orchEffort };
}

const HELP = `gate <IMPLEMENT-path> [flags]

  Phase / loop:
    --phase A|BCD|all         which angles to start (default all -> cold-A first)
    --phase-a  --phase-bcd    hyphenated aliases for the above
    --qa  --preflight         vet the workflow first: the orchestrator audits + repairs all four
                              angle prompts (self-contained + paste-ready), folds any real gap,
                              bumps a patch — then the loop runs. Auto-runs when no REVIEW_PROMPTS
                              exists (bootstrap) or the active block is an un-expanded template.
    --consolidate             enter at the clean-up-read step: condense the doc (own patch +
                              breadth), then continue into the loop's final cold-A pass
    --compact-first           with --consolidate: compact the orchestrator before condensing
    --final-bump major|minor  the final version bump after B/C/D clears (overrides the
                              <!-- GATE:FINAL_BUMP: … --> marker at the top of the IMPLEMENT)
    --max-rounds N            safety cap (default 12)
    --dry-run                 resolve + parse + report resolved models/effort; spawn nothing (no spend)

  Model down-shift (default = latest Opus):
    --<model>-reviewers               all reviewers -> <model>   e.g. --opus-4-7-reviewers
    --<model>-reviewer-a|-b|-c|-d     one reviewer               e.g. --opus-4-7-reviewer-a
    --<model>-reviewer-a-b ...        any combo                  e.g. --opus-4-7-reviewer-b-d-c
    --<model>-orchestrator            the orchestrator thread    e.g. --opus-4-7-orchestrator
    --<model>-all                     every node -> <model>      e.g. --opus-4-7-all
    --reviewers <model> | --reviewer-a <model> | --orchestrator <model>   explicit form
      <model>: opus | sonnet | opus-4-7 | opus-4-8 | sonnet-5 | ...

  Effort down-shift:
    --max --xhigh --high --medium --low   binds to the node your model flag targeted
                                          (reviewers if none); default reviewers=max, orch=xhigh
    --reviewer-effort <lvl> | --orchestrator-effort <lvl>   explicit, always wins

  Any value flag also takes = (no space):  --orchestrator-effort=high  --max-rounds=8  --reviewers=opus-4-7

  Orchestrator lookup:
    --orchestrator-title "..."  | --orchestrator-id <uuid>  | --project-doc <path>`;

async function ask(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(q);          // blocks indefinitely — no timeout, waits for Sean
  rl.close();
  return a;
}

// A tiny TTY spinner so long reviewer / fold turns show a heartbeat + elapsed time
// (a peer query() streams no intermediate output, so without this the terminal looks frozen).
// Non-TTY (piped, CI) degrades to a single plain line — never spews control codes.
class Spinner {
  private frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private i = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private start = 0;
  private label = "";
  private readonly tty = process.stdout.isTTY === true;
  private elapsed(): string {
    const s = Math.floor((Date.now() - this.start) / 1000);
    return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
  }
  private paint(): void {
    if (!this.tty) return;
    this.i = (this.i + 1) % this.frames.length;
    process.stdout.write(`\r\x1b[2K${this.frames[this.i]} ${this.label}  ${this.elapsed()}`);
  }
  begin(label: string): void {
    this.label = label; this.start = Date.now();
    if (!this.tty) { console.log(`… ${label}`); return; }
    this.paint();
    this.timer = setInterval(() => this.paint(), 90);
    this.timer.unref?.();
  }
  setLabel(label: string): void { this.label = label; if (!this.tty) console.log(`… ${label}`); }
  log(msg: string): void {                       // emit a permanent line without losing the spinner
    if (this.tty) process.stdout.write(`\r\x1b[2K`);
    console.log(msg);
    if (this.tty && this.timer) this.paint();
  }
  end(msg?: string): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.tty) process.stdout.write(`\r\x1b[2K`);
    if (msg) console.log(msg);
  }
}

// A Max usage limit is not a crash — it's a "come back after the reset." Exit CLEANLY with
// a plain message and the exact command to continue, instead of dumping a Node stack trace.
function haltIfLimited(r: RunResult): void {
  if (!r.rateLimited) return;
  const currentImpl = path.join(archiveDir, path.basename(reviewPromptsPath).replace(/_REVIEW_PROMPTS\.md$/i, "_IMPLEMENT.md"));
  const band = active.length === 1 && active[0].key === "A" ? "A" : "BCD";
  console.log(`\n⏸  Max usage limit reached${r.resetHint ? ` — resets ${r.resetHint}` : ""}. This is a pause, not a failure.`);
  console.log(`   Everything folded so far is saved on disk (latest docs in ${archiveDir}).`);
  console.log(`   After the reset, continue from where you stopped:`);
  console.log(`     gate ${currentImpl} --phase-${band.toLowerCase()}  <your same model/effort flags>`);
  console.log(`   (A one-command \`gate --resume\` that remembers band + version + flags is on the NEXT_UPDATE list.)`);
  process.exit(0);
}

function verdictOf(text: string): "READY" | "NARROW" | "PASS" {
  if (/NEEDS ANOTHER PASS \(NARROW\)/i.test(text)) return "NARROW";
  if (/READY TO BUILD/i.test(text)) return "READY";
  return "PASS"; // "NEEDS ANOTHER PASS" or anything without a clear READY
}

// Walk up from a path to the nearest ancestor containing .git — the repo root.
function gitRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) die(`no .git found above ${startDir} — is the IMPLEMENT inside a repo?`);
    dir = up;
  }
}

// Extract one angle's reviewer prompt from a REVIEW_PROMPTS.md.
// Prefer explicit <!-- GATE:PROMPT:X --> ... <!-- /GATE:PROMPT:X --> markers; otherwise fall
// back to the stable convention: the first fenced ``` block under the `## Angle X` header.
function extractAnglePrompt(md: string, key: string): string | undefined {
  const marker = new RegExp(`<!--\\s*GATE:PROMPT:${key}\\s*-->([\\s\\S]*?)<!--\\s*/GATE:PROMPT:${key}\\s*-->`, "i");
  const mk = md.match(marker);
  const region = mk ? mk[1] : sliceUnderHeader(md, key);
  if (!region) return undefined;
  const fence = region.match(/```[a-z]*\s*\n([\s\S]*?)```/i);
  return (fence ? fence[1] : region).trim() || undefined;
}
function sliceUnderHeader(md: string, key: string): string | undefined {
  // from "## Angle X" to the next "## " (or EOF)
  const hdr = new RegExp(`^##\\s*Angle\\s*${key}\\b.*$`, "im");
  const m = hdr.exec(md);
  if (!m) return undefined;
  const start = m.index + m[0].length;
  const nextHdr = /^##\s/m;
  nextHdr.lastIndex = 0;
  const rest = md.slice(start);
  const nx = rest.search(/^##\s/m);
  return nx >= 0 ? rest.slice(0, nx) : rest;
}

// Resolve the four core docs from the IMPLEMENT path + the project doc. Validates existence.
function resolveCoreDocs(implPath: string, repoRoot: string): { label: string; path: string }[] {
  const base = path.basename(implPath);
  const m = base.match(/^(v\d+_\d+_\d+)_IMPLEMENT\.md$/i);
  if (!m) die(`IMPLEMENT filename must look like vX_Y_Z_IMPLEMENT.md (got ${base})`);
  const ver = m[1];
  const dir = path.dirname(implPath);
  const sib = (suffix: string) => path.join(dir, `${ver}_${suffix}`);

  const projectDoc = arg("--project-doc") ?? projectDocFromNotes(repoRoot) ?? guessProjectDoc(repoRoot);
  if (!projectDoc) die("could not find the project doc — pass --project-doc <path> or add `project_doc:` to .agent/GATE_NOTES.md");

  const docs = [
    { label: "IMPLEMENT", path: implPath },
    { label: "ADDENDUM_TESTING", path: sib("ADDENDUM_TESTING.md") },
    { label: "ADDENDUM_DESIGN", path: sib("ADDENDUM_DESIGN.md") },
    { label: "PROJECT_DOC", path: path.resolve(repoRoot, projectDoc) },
  ];
  const missing = docs.filter((d) => !fs.existsSync(d.path));
  if (missing.length) die(`core docs missing — will not review blind:\n${missing.map((d) => `  ${d.label}: ${d.path}`).join("\n")}`);
  return docs;
}

function projectDocFromNotes(repoRoot: string): string | undefined {
  const notes = path.join(repoRoot, ".agent", "GATE_NOTES.md");
  if (!fs.existsSync(notes)) return undefined;
  const m = fs.readFileSync(notes, "utf8").match(/^project_doc:\s*(\S+)\s*$/im);
  return m?.[1];
}
function guessProjectDoc(repoRoot: string): string | undefined {
  const dir = path.join(repoRoot, "assets", "docs");
  if (!fs.existsSync(dir)) return undefined;
  const hit = fs.readdirSync(dir).find((f) => /_STORE\.md$/i.test(f));
  return hit ? path.join("assets", "docs", hit) : undefined;
}

// Inline the core docs at the top of a reviewer prompt (required for A — no repo; a guarantee
// for B/C/D that EVERLASTINGS_STORE.md et al. are actually in context, never just referenced).
function withCoreDocs(coreDocs: { label: string; path: string }[], anglePrompt: string): string {
  const inlined = coreDocs
    .map((d) => `===== BEGIN ${d.label} (${path.basename(d.path)}) =====\n${fs.readFileSync(d.path, "utf8")}\n===== END ${d.label} =====`)
    .join("\n\n");
  return `CORE DOCUMENTS — read in full, do not ration tokens. These are the build under review:\n\n${inlined}\n\n---\n\n${anglePrompt}`;
}

// ── Spawn one reviewer (a fresh, separate peer) ──────────────────────────────
async function runReviewer(a: { key: string; repo: boolean }, prompt: string, repoRoot: string, model: string, effort: Effort): Promise<RunResult> {
  const isColdA = !a.repo;
  const work = a.repo ? repoRoot : fs.mkdtempSync(path.join(os.tmpdir(), `gate-${a.key}-`));
  return runQuery({
    prompt,
    model,
    effort,
    cwd: work,                                      // A runs in a throwaway dir → physically no repo
    disallowedTools: a.repo ? READONLY : NO_FILE_TOOLS,
    permissionMode: HEADLESS,
    systemPromptPreset: true,                       // preset = GROUNDING (cwd/git/tool-discipline), for every angle
    ...(isColdA ? { systemPromptAppend: ANGLE_A_SYSTEM_APPEND } : {}), // …but A is told the truth: no tools this run
  });
}

// ── Orchestrator turns (fold + its end-game siblings) ────────────────────────
type Findings = Record<string, { verdict: string; file: string }>;

// Where the current living IMPLEMENT is on disk, given a control payload.
function implFromPayload(p: FoldPayload): string {
  const dir = p.archiveDir ? path.resolve(p.archiveDir) : path.dirname(path.resolve(p.reviewPromptsPath));
  const byPrompts = path.join(dir, path.basename(p.reviewPromptsPath).replace(/_REVIEW_PROMPTS\.md$/i, "_IMPLEMENT.md"));
  return fs.existsSync(byPrompts) ? byPrompts : path.join(dir, `${p.version}_IMPLEMENT.md`);
}

// Run ONE schema'd orchestrator turn (resume the thread) with a heartbeat + clean limit-halt.
async function orchTurn(prompt: string, label: string): Promise<FoldPayload | undefined> {
  if (!orchSession) die("orchestrator turn needs a session — pass --orchestrator-id <uuid> or ensure the titled thread exists.");
  const pv = new ProgressView();
  pv.begin(label, (label.split(/[\s—(]/)[0] || "working").toLowerCase());   // present-participle from the label's first word
  const r = await runQuery({
    prompt, model: orchModel, effort: orchEffort, cwd: repoRoot, resume: orchSession,
    permissionMode: HEADLESS, settingSources: ["user", "project", "local"],   // its project context: CLAUDE.md/AGENTS.md/DEV_RULES/memory
    jsonSchema: FOLD_SCHEMA as unknown as Record<string, unknown>,
    onEvent: (m) => pv.handle(m),                                             // live MAO-style progress tree
  });
  pv.end({ costUsd: r.costUsd, failed: r.isError && !r.rateLimited });
  haltIfLimited(r);
  return r.structuredOutput as FoldPayload | undefined;
}

// Drive the orchestrator's self-authored /compact on its own resumed session.
async function compactForward(compactArg: string | undefined): Promise<void> {
  if (!compactArg?.trim() || !orchSession) return;
  const s = new Spinner();
  s.begin(`compacting the orchestrator forward`);
  const c = await runQuery({ prompt: `/compact ${compactArg.trim()}`, resume: orchSession, model: orchModel, cwd: repoRoot, permissionMode: HEADLESS });
  s.end(`  compacted forward${c.isError && !c.rateLimited ? " (⚠ compact returned an error — check context growth)" : ""}`);
  haltIfLimited(c);
}

// Does the human's reply read as a question BACK (wants to talk it through) rather than a decision?
// Half the time Sean is asking the orchestrator to help him decide — that must not be folded past.
function looksLikeQuestion(s: string): boolean {
  const t = s.trim().toLowerCase();
  if (!t) return false;
  if (t.includes("?")) return true;
  return /^(what|why|how|which|who|when|where|explain|clarify|confused|not sure|unsure|idk|i don'?t (know|understand)|can you|could you|would you|tell me|help me|walk me|ask|elaborate|wdyt|what do you think|give me|show me|more (info|detail))\b/.test(t);
}

// One CONVERSATIONAL (no-schema) orchestrator turn — returns its reply TEXT to show the human.
// Used inside the decision-pause so Sean's questions get a real answer, not a silent fold.
async function orchChat(prompt: string, label: string): Promise<string> {
  if (!orchSession) die("orchestrator turn needs a session — pass --orchestrator-id <uuid> or ensure the titled thread exists.");
  const pv = new ProgressView();
  pv.begin(label, "thinking");
  const r = await runQuery({
    prompt, model: orchModel, effort: orchEffort, cwd: repoRoot, resume: orchSession,
    permissionMode: HEADLESS, settingSources: ["user", "project", "local"],
    onEvent: (m) => pv.handle(m),
  });
  pv.end({ costUsd: r.costUsd, failed: r.isError && !r.rateLimited });
  haltIfLimited(r);
  return r.result;
}

// Human decision-pause — the loop CANNOT fold a judgment call without Sean, and it is a genuine
// TWO-WAY conversation: if his answer is a question back, the orchestrator ANSWERS it (shown to
// him) and re-asks — looping until he gives a real decision, THEN folds. Never one-shot answer→
// fold→move-on (the old bug: his questions went unanswered and gate silently folded past them).
async function resolveDecisions(payload: FoldPayload): Promise<FoldPayload> {
  while (payload.decisionsNeeded?.length) {
    const n = payload.decisionsNeeded.length;
    console.log(`\n🞶  ${n} thing${n > 1 ? "s" : ""} I'd like your call on. Answer plainly — or ask me anything about it first (I'll explain, then re-ask; I won't move on until you've actually decided).`);
    const answers: string[] = [];
    for (const d of payload.decisionsNeeded) {
      let prompt = d, decided = "";
      for (;;) {                                     // talk until Sean gives a decision, not a question
        const reply = (await ask(`\n${prompt}\n> `)).trim();
        if (!reply) { console.log("  (blank is fine — type your decision, or a question if you'd like me to explain first.)"); continue; }
        if (looksLikeQuestion(reply)) {
          const answer = await orchChat(
            [
              `We're at a decision point in the gap-review gate. The question I put to the human was:`,
              `"${d}"`,
              `They didn't decide yet — they asked back:`,
              `"${reply}"`,
              `Answer them directly, in plain language, NO jargon (they don't know internal terms — never say "landmine" etc.). Explain your thinking, lay out the real options with trade-offs, and give your recommendation and WHY. Do NOT fold or change any docs — this is only a conversation to help them decide. Reply with just your message to them.`,
            ].join("\n\n"),
            `answering your question`,
          );
          console.log(`\n🞶  ${answer.trim()}`);
          prompt = `So — your call on this: ${d}`;    // re-ask the same decision after answering
          continue;
        }
        decided = reply;
        break;
      }
      answers.push(`Q: ${d}\nA: ${decided}`);
    }
    const next = await orchTurn(
      [
        `The human made these calls (after any back-and-forth):`,
        answers.join("\n\n"),
        `Fold each decision in accordingly and regenerate the REVIEW_PROMPTS.`,
        PROMPT_CONTRACT,
        `Return the same structured control payload shape.`,
      ].join("\n\n"),
      `folding in your decisions`,
    );
    payload = next ?? { ...payload, decisionsNeeded: [] };
  }
  return payload;
}

// Normal fold turn — validate + fold findings + breadth + PATCH + regen prompts, then decisions.
async function foldTurn(findings: Findings, round: number): Promise<FoldPayload> {
  const foldPrompt = [
    `You are resuming as the Build-Guide Planning Orchestrator (your own thread) for the gap-review gate on ${implAbs}.`,
    `Round ${round} findings are written to disk: ${Object.entries(findings).map(([k, f]) => `${k}=${f.file} (${f.verdict})`).join(", ")}.`,
    `Per DEV_RULES §The Gap-Review Gate: VALIDATE each finding against reality (flag-don't-assert — verify before folding; do NOT fold a finding that is a DECISION — a north-star / architecture / genuinely-unclear call — surface it instead).`,
    `Fold the real ones into the IMPLEMENT + addenda, bump the version (PATCH), update the "Settled — do not re-raise" ledger (replace superseded entries, never append a contradiction), run the 2-subagent breadth pass, and regenerate the REVIEW_PROMPTS (scoped + narrowed re-prompt for any passed angle whose lane a fold touched; omit angles that stay closed).`,
    PROMPT_CONTRACT,
    `Then WRITE your own forward /compact instruction (what the NEXT round must keep) and return it as compactArg.`,
    `Return ONLY the structured control payload.`,
  ].join("\n\n");
  let p = await orchTurn(foldPrompt, `folding round ${round} — orchestrator (${orchModel} ${orchEffort})`);
  if (!p) die(`orchestrator returned no structured payload after the fold.`);
  console.log(`  folded ${p.foldedCount ?? "?"} → ${p.version}${p.gateStatus ? `  (${p.gateStatus})` : ""}`);
  return resolveDecisions(p);
}

// The CONSOLIDATE step (DEV_RULES §End-game "Clean-up read") — a DISTINCT orchestrator turn,
// separate from the fold: end-to-end read → condense → its OWN patch bump → breadth subagents
// again (critical: a condense is where content can be dropped) → regenerate the final narrow
// cold-A prompt. No `_2.md` pre-condense copy (the rigor trail lives in the standing GAP_REVIEW
// files, not inline notes). Returns the new control payload (nextAngles = [A] on the clean doc).
async function consolidateStep(currentImpl: string): Promise<FoldPayload | undefined> {
  if (!fs.existsSync(currentImpl)) die(`consolidate: current IMPLEMENT not on disk: ${currentImpl}`);
  const kb = (fs.statSync(currentImpl).size / 1024).toFixed(0);
  const prompt = [
    `You are resuming as the Build-Guide Planning Orchestrator (your own thread). This is the CONSOLIDATE step (DEV_RULES §End-game "Clean-up read") for ${currentImpl} — a DISTINCT step from a normal fold, with its own PATCH bump.`,
    `The IMPLEMENT is ~${kb} KB after many surgical folds and needs its clean-up read BEFORE the presumed-final cold-A pass.`,
    `1) Do a deliberate END-TO-END read of the IMPLEMENT + both addenda FROM DISK. Catch stray/outdated/superseded references, duplicated or contradictory notes, and archaeology left by round-after-round edits.`,
    `2) CONSOLIDATE / condense: tighten and de-bloat WITHOUT dropping any executable content (byte-exact CURRENT anchors, NEW blocks, confirmed decisions). Do NOT keep a pre-condense _2.md copy — the rigor trail lives in the standing GAP_REVIEW files, not inline notes.`,
    `3) Drive a PATCH bump for the consolidation (a version distinct from the fold's).`,
    `4) Re-run the 2-subagent breadth pass on the CONSOLIDATED doc — critical: a condense is exactly where content can be accidentally dropped, so the breadth pass verifies the doc is still intact.`,
    `5) Regenerate the REVIEW_PROMPTS with the final narrow cold-A prompt against the consolidated version. Set nextAngles to exactly [{"key":"A","repo":false}].`,
    PROMPT_CONTRACT,
    `Then WRITE your forward /compact instruction as compactArg. Return ONLY the structured control payload.`,
  ].join("\n\n");
  const payload = await orchTurn(prompt, `consolidating (clean-up read) — orchestrator (${orchModel} ${orchEffort})`);
  if (payload) console.log(`  consolidated → ${payload.version}${payload.gateStatus ? `  (${payload.gateStatus})` : ""}`);
  return payload;
}

// QA PRE-FLIGHT — the orchestrator vets the whole workflow BEFORE any reviewer runs (Sean's QA
// gate). Behaves like a normal fold pass: audit the IMPLEMENT + addenda + the four angle prompts,
// fix/fold any gap it finds (mechanical OR a real missing/poorly-planned capability), run the 2
// breadth subagents, bump PATCH — and (re)generate all four angle blocks fully self-contained +
// paste-ready. Also BOOTSTRAPS a fresh run when no REVIEW_PROMPTS exists yet. Surfaces to the
// human ONLY a genuine north-star fork (decisionsNeeded). Returns the new control payload.
async function qaPreflightStep(currentImpl: string, promptsExist: boolean): Promise<FoldPayload | undefined> {
  if (!fs.existsSync(currentImpl)) die(`qa-preflight: current IMPLEMENT not on disk: ${currentImpl}`);
  const prompt = [
    `You are resuming as the Build-Guide Planning Orchestrator (your own thread). This is the QA PRE-FLIGHT for ${currentImpl} — run ONCE before any reviewer, to guarantee the workflow assets are sound and the reviewer prompts are complete. Treat it exactly like a normal fold pass (validate → fold → breadth → bump), never a rubber stamp.`,
    promptsExist
      ? `A REVIEW_PROMPTS file exists next to the IMPLEMENT. AUDIT it: are ALL FOUR angle blocks (A + B/C/D; include D only if the build carries substantial design/UX) present, fully self-contained, and paste-ready, with the COMPLETE current ledger + full lens + settled-base inlined in EACH block? Repair anything an earlier instance left lazy — a missing block, a "[paste from above]" / "[LANDMINES …]" placeholder, a stale version, a ledger that was referenced instead of inlined.`
      : `No REVIEW_PROMPTS exists yet — BOOTSTRAP it from scratch per templates/review-prompt.md: author all four angle blocks (include D only if the build carries substantial design/UX), seeding the "Settled — do not re-raise" ledger from what the IMPLEMENT + addenda already establish.`,
    `Also audit the BUILD the way you would in a fold: read the IMPLEMENT + both addenda end-to-end and find any real gap — a missing or poorly-planned capability, an unvalidated assumption, an incoherence, stray archaeology. VALIDATE each against reality (flag-don't-assert; a finding that is a genuine DECISION gets surfaced, not folded). Fold the real ones, run the 2-subagent breadth pass, and drive a PATCH bump.`,
    `Surface to the human (decisionsNeeded) ONLY a genuine fork that conflicts with the north star or a high-level project goal — in plain language, no jargon. Everything mechanical or clearly-correct you fix yourself; take the initiative.`,
    PROMPT_CONTRACT,
    `Return the control payload: version = the new PATCH version; archiveDir + reviewPromptsPath (ABSOLUTE); nextAngles = [] (the gate picks the round-1 angles from its --phase); decisionsNeeded = any genuine fork; compactArg = your forward note. Return ONLY the structured control payload.`,
  ].join("\n\n");
  const payload = await orchTurn(prompt, `QA pre-flight (vetting the workflow) — orchestrator (${orchModel} ${orchEffort})`);
  if (payload) console.log(`  QA pre-flight → ${payload.version}${payload.gateStatus ? `  (${payload.gateStatus})` : ""}`);
  return payload;
}

// A cleared → fold the final A findings (even READY carries polish) + do the MINOR-bump phase
// handoff: copy the living docs into a new vX_(Y+1)/ dir and generate the B/C/D prompts there.
async function phaseHandoffA(findings: Findings, round: number): Promise<FoldPayload | undefined> {
  const files = Object.entries(findings).map(([k, f]) => `${k}=${f.file} (${f.verdict})`).join(", ");
  const prompt = [
    `You are resuming as the Build-Guide Planning Orchestrator (your own thread). Cold-A (self-containment) returned READY TO BUILD, so the cold phase is CLEARING for ${implAbs}.`,
    `Round ${round} A findings: ${files}.`,
    `1) FIRST validate + fold the final A findings — even a READY pass carries polish / non-breaking-but-real findings; flag-don't-assert; surface any genuine DECISION instead of folding. Drive a PATCH bump and run the 2-subagent breadth pass.`,
    `2) Then, since A is now closed, do the PHASE HANDOFF (DEV_RULES §Versioning "demarcate phases with a MINOR bump"): drive a MINOR bump and COPY the living docs (IMPLEMENT + both addenda) into a NEW sibling directory vX_(Y+1)/ (e.g. .../v3_6/ → .../v3_7/). Leave the standing GAP_REVIEW records in the old dir (they keep it populated). Generate the B/C/D REVIEW_PROMPTS in the NEW dir.`,
    PROMPT_CONTRACT,
    `Return the control payload: version = the new MINOR version; archiveDir = the NEW dir (ABSOLUTE path); reviewPromptsPath = the new B/C/D REVIEW_PROMPTS (ABSOLUTE); nextAngles = [{"key":"B","repo":true},{"key":"C","repo":true}] plus {"key":"D","repo":true} ONLY if the build carries substantial design/UX; decisionsNeeded = any surfaced; compactArg = your forward note.`,
    `Return ONLY the structured control payload.`,
  ].join("\n\n");
  const p = await orchTurn(prompt, `A→B/C/D handoff (final fold + minor bump + new dir) — orchestrator`);
  if (p) console.log(`  cold-A cleared → handoff ${p.version}${p.archiveDir ? ` in ${path.basename(path.resolve(p.archiveDir))}/` : ""}`);
  return p;
}

// All angles cleared → Build Guide Final Cuts + final version bump. Assumes the final fold and a
// self-compact already ran, so the orchestrator's context is clean before the final clean condense.
async function finalCutsStep(currentImpl: string, finalBump: "major" | "minor" | undefined): Promise<FoldPayload | undefined> {
  const bumpLine = finalBump === "major" ? "Drive a MAJOR bump (plan → execution / architectural change)."
    : finalBump === "minor" ? "Drive a MINOR bump (recent-build delta / polish only)."
    : "Drive the version bump per the GATE:FINAL_BUMP intent recorded at the top of the IMPLEMENT (MAJOR for an architectural/deployment change; MINOR for a recent-build delta).";
  const prompt = [
    `You are resuming as the Build-Guide Planning Orchestrator (your own thread). ALL angles (A + B/C/D) returned READY TO BUILD for ${currentImpl}. Do the BUILD GUIDE FINAL CUTS (DEV_RULES §End-game). You have ALREADY folded the final findings and compacted, so your context is clean — read the doc fresh from disk.`,
    `1) Final clean condense: strip what is the WRONG context for the EXECUTION orchestrator — changelog, provenance, slipped-scope rationale, resolved-edges, owner-decision tags, gap-review framing, excessive prose — KEEPING the byte-exact anchors + ALL executable content. Move substantial rationale to a sibling vX_Y_Z_RATIONALE.md with a "don't read the rationale unless you must" note in the IMPLEMENT.`,
    `2) Run the 2-subagent breadth pass on the cut doc — verify nothing executable was dropped.`,
    `3) ${bumpLine}`,
    `Return the control payload: version = the final version; archiveDir + reviewPromptsPath (ABSOLUTE); nextAngles = [] (gate clear); compactArg = your forward note.`,
    `Return ONLY the structured control payload.`,
  ].join("\n\n");
  const p = await orchTurn(prompt, `Build Guide Final Cuts (${finalBump ?? "bump per doc"}) — orchestrator`);
  if (p) console.log(`  final cuts → ${p.version}`);
  return p;
}

// The intended FINAL version bump — knowable before the gate runs. Read from a
// `<!-- GATE:FINAL_BUMP: major|minor … -->` marker near the top of the IMPLEMENT; `--final-bump`
// overrides; absent → undefined (the orchestrator decides per the doc). See templates/GATE_NOTES.
function finalBumpIntent(implPath: string): "major" | "minor" | undefined {
  const cli = arg("--final-bump");
  if (cli === "major" || cli === "minor") return cli;
  if (!fs.existsSync(implPath)) return undefined;
  const m = fs.readFileSync(implPath, "utf8").slice(0, 4000).match(/GATE:FINAL_BUMP:\s*(major|minor)/i);
  return m ? (m[1].toLowerCase() as "major" | "minor") : undefined;
}

// ── The run ──────────────────────────────────────────────────────────────────
// Expand --flag=value into --flag value so no value-flag ever needs a space
// (--max-rounds=8, --orchestrator-effort=high, --reviewers=opus-4-7, …). Boolean/convenience
// flags carry no "=" and pass through untouched.
process.argv = process.argv.flatMap((t) => {
  const m = t.startsWith("--") ? t.match(/^(--[^=]+)=(.*)$/s) : null;
  return m ? [m[1], m[2]] : [t];
});
const rawArgs = process.argv.slice(2);
if (rawArgs.length === 0 || rawArgs.includes("--help") || rawArgs.includes("-h")) { console.log(HELP); process.exit(0); }
if (rawArgs.includes("--demo-ui")) { await demoProgress(); process.exit(0); } // zero-spend preview of the live progress view

const implPath = process.argv[2];
if (!implPath || implPath.startsWith("--")) die("usage: gate <IMPLEMENT-path> [flags]  (try --help)");
const implAbs = path.resolve(implPath);
if (!fs.existsSync(implAbs)) die(`IMPLEMENT not found: ${implAbs}`);

function resolvePhase(): "A" | "BCD" | "all" {
  if (rawArgs.includes("--phase-a")) return "A";
  if (rawArgs.includes("--phase-bcd")) return "BCD";
  const p = (arg("--phase") ?? "all").toUpperCase();
  if (p === "A") return "A";
  if (p === "BCD") return "BCD";
  if (p === "ALL") return "all";
  die(`--phase must be A | BCD | all (got ${arg("--phase")})`);
}
const phase = resolvePhase();
const maxRounds = Number(arg("--max-rounds") ?? 12);
const orchTitle = arg("--orchestrator-title") ?? DEFAULT_ORCH_TITLE;
const dryRun = process.argv.includes("--dry-run"); // resolve + parse + report, spawn nothing
const consolidateMode = rawArgs.includes("--consolidate"); // enter at the clean-up-read step
const compactFirst = rawArgs.includes("--compact-first");  // compact the orchestrator before consolidating
const qaMode = rawArgs.includes("--qa") || rawArgs.includes("--preflight"); // vet/bootstrap the prompts first
const ov = parseOverrides(rawArgs);
const orchModel = ov.orchModel ?? ORCHESTRATOR.model;
const orchEffort = ov.orchEffort ?? ORCHESTRATOR.effort;

const repoRoot = gitRoot(path.dirname(implAbs));
let archiveDir = path.dirname(implAbs);
let coreDocs = resolveCoreDocs(implAbs, repoRoot);
let reviewPromptsPath = path.join(archiveDir, path.basename(implAbs).replace(/_IMPLEMENT\.md$/i, "_REVIEW_PROMPTS.md"));
const promptsExist = fs.existsSync(reviewPromptsPath); // absent → QA pre-flight bootstraps them (no longer a hard error)

// Discover Sean's orchestrator thread (needed to fold). Resolve up front so we fail early.
let orchSession = arg("--orchestrator-id");
if (!orchSession) {
  const hit = await findSessionByTitle(repoRoot, orchTitle);
  if (hit) { orchSession = hit.sessionId; console.log(`▶ orchestrator thread: "${hit.customTitle ?? hit.summary}" (${hit.sessionId})`); }
  else console.warn(`⚠ no session titled "${orchTitle}" under ${repoRoot} — round 1 reviewers can run, but folding needs it (pass --orchestrator-id <uuid>).`);
}

// Which angles to run this round. Round 1 comes from --phase; later rounds from the fold payload.
let active: Array<{ key: string; repo: boolean }> =
  phase === "A" ? [{ key: "A", repo: false }]
  : phase === "BCD" ? [{ key: "B", repo: true }, { key: "C", repo: true }, { key: "D", repo: true }]
  : [{ key: "A", repo: false }]; // "all" starts at A, transitions to BCD when A closes (pilot-harden)

console.log(`▶ ${path.basename(implAbs)} — phase ${phase}, repo ${repoRoot}`);

// QA pre-flight runs before the loop when: asked (--qa), bootstrapping (no prompts yet), or the
// block gate is about to run is an un-expanded template (self-heal the v3.6.4-style starvation).
const activeBlockBroken = promptsExist && ((): boolean => {
  const md = fs.readFileSync(reviewPromptsPath, "utf8");
  return active.some((a) => { const b = extractAnglePrompt(md, a.key); return !b || !!selfContainedIssue(b); });
})();
const runQa = qaMode || !promptsExist || activeBlockBroken;

if (dryRun) {
  console.log(`\n=== DRY RUN (nothing spawned, no spend) ===`);
  console.log(`repo root         : ${repoRoot}`);
  console.log(`archive dir       : ${archiveDir}`);
  console.log(`REVIEW_PROMPTS    : ${path.basename(reviewPromptsPath)}`);
  console.log(`orchestrator      : ${orchSession ?? "(not found — folding would need --orchestrator-id)"}`);
  console.log(`resolved nodes    : (defaults from config.ts unless a flag overrides)`);
  for (const k of ["A", "B", "C", "D"] as Angle[])
    console.log(`  reviewer ${k}       ${(ov.reviewerModel[k] ?? REVIEWER.model).padEnd(20)} ${ov.reviewerEffort ?? REVIEWER.effort}`);
  console.log(`  orchestrator     ${orchModel.padEnd(20)} ${orchEffort}`);
  console.log(`final version bump: ${finalBumpIntent(coreDocs[0].path) ?? "(not set — orchestrator decides per doc; set via --final-bump or a GATE:FINAL_BUMP marker)"}`);
  console.log(`core docs (inlined every prompt):`);
  let total = 0;
  for (const d of coreDocs) { const kb = fs.statSync(d.path).size; total += kb; console.log(`  ${d.label.padEnd(16)} ${(kb / 1024).toFixed(0).padStart(4)} KB  ${path.relative(repoRoot, d.path)}`); }
  console.log(`  ${"TOTAL inlined".padEnd(16)} ${(total / 1024).toFixed(0).padStart(4)} KB  (~${Math.round(total / 4 / 1000)}k tokens per prompt, before the angle text)`);
  if (!promptsExist) {
    console.log(`REVIEW_PROMPTS    : (none yet — QA pre-flight would BOOTSTRAP ${path.basename(reviewPromptsPath)} from the IMPLEMENT)`);
  } else {
    const md = fs.readFileSync(reviewPromptsPath, "utf8");
    console.log(`angle prompts parsed from ${path.basename(reviewPromptsPath)}:`);
    for (const key of ["A", "B", "C", "D"]) {
      const p = extractAnglePrompt(md, key);
      if (!p) { console.log(`  Angle ${key}: — not present`); continue; }
      const issue = selfContainedIssue(p);
      console.log(`  Angle ${key}: ✓ found (${p.length} chars)${issue ? `  ⚠ WOULD BE REJECTED — ${issue}` : `  ✓ self-contained`}`);
    }
  }
  if (runQa) console.log(`\nQA pre-flight WOULD RUN first (${qaMode ? "--qa" : !promptsExist ? "no prompts → bootstrap" : "active block is an un-expanded template → self-heal"}), then the loop.`);
  console.log(`\nwould run this round: [${active.map((a) => `${a.key}${a.repo ? "" : " no-repo"}`).join(", ")}]`);
  if (consolidateMode) console.log(`\n--consolidate: would run the clean-up-read step on ${path.basename(coreDocs[0].path)} first${compactFirst ? " (after a compact-forward)" : ""}, then continue the loop on the cleaned doc.`);
  process.exit(0);
}

// QA PRE-FLIGHT — vet/bootstrap the workflow before any reviewer runs. Behaves like a fold:
// (re)generates all four self-contained angle blocks, folds any real gap, bumps PATCH; the loop
// then runs on the vetted docs. A surfaced north-star fork pauses for the human first.
if (runQa) {
  if (!orchSession) die(`QA pre-flight ${promptsExist ? "" : "/ bootstrap "}needs the orchestrator — pass --orchestrator-id <uuid> or ensure the titled thread exists under ${repoRoot}.`);
  const why = qaMode ? "requested (--qa)" : !promptsExist ? "no REVIEW_PROMPTS yet — bootstrapping" : "the active angle prompt is an un-expanded template — self-healing before reviewing";
  console.log(`\n▶ QA pre-flight — vetting the workflow (${why}).`);
  let qa = await qaPreflightStep(coreDocs[0].path, promptsExist);
  if (!qa) die("QA pre-flight returned no structured payload — cannot continue.");
  qa = await resolveDecisions(qa);
  await compactForward(qa.compactArg);
  reviewPromptsPath = path.resolve(qa.reviewPromptsPath);
  archiveDir = qa.archiveDir ? path.resolve(qa.archiveDir) : path.dirname(reviewPromptsPath);
  const qaImpl = implFromPayload(qa);
  if (fs.existsSync(qaImpl)) coreDocs = resolveCoreDocs(qaImpl, repoRoot);
  console.log(`▶ QA pre-flight complete → ${qa.version}; entering the loop with [${active.map((a) => a.key).join(", ")}].`);
}

// Enter at the CONSOLIDATE step (pick up mid-workflow), then fall into the normal loop on the
// cleaned doc. This is "resume at step 3": fold already happened; do clean-up read → final cold-A.
if (consolidateMode) {
  if (!orchSession) die("--consolidate needs the orchestrator — pass --orchestrator-id <uuid> or ensure the titled thread exists under the repo.");
  if (compactFirst) await compactForward(`Clearing context before the consolidate step. The doc is re-read end-to-end from disk, so keep only the gate/versioning state, the "Settled — do not re-raise" ledger, and standing decisions.`);
  const cons = await consolidateStep(coreDocs[0].path);
  if (!cons) die("consolidate returned no structured payload — nothing to continue from.");
  await compactForward(cons.compactArg);
  reviewPromptsPath = path.resolve(cons.reviewPromptsPath);
  archiveDir = cons.archiveDir ? path.resolve(cons.archiveDir) : path.dirname(reviewPromptsPath);
  const consImpl = implFromPayload(cons);
  if (fs.existsSync(consImpl)) coreDocs = resolveCoreDocs(consImpl, repoRoot);
  active = cons.nextAngles?.length ? cons.nextAngles : [{ key: "A", repo: false }];
  console.log(`\n▶ consolidated to ${cons.version}; continuing into the loop with [${active.map((a) => a.key).join(", ")}] on the cleaned doc.`);
}

for (let round = 1; round <= maxRounds; round++) {
  const md = fs.readFileSync(reviewPromptsPath, "utf8");
  console.log(`\n— Round ${round}: reviewing [${active.map((a) => a.key).join(", ")}] —`);

  // 1) Spawn the active reviewers (A alone / B·C·D in parallel), each a fresh peer.
  const findings: Record<string, { verdict: string; file: string }> = {};
  const pending = new Set(active.map((a) => a.key));
  const spin = new Spinner();
  spin.begin(`Round ${round} — reviewing [${active.map((a) => a.key).join(", ")}]`);
  await Promise.all(active.map(async (a) => {
    const anglePrompt = extractAnglePrompt(md, a.key);
    if (!anglePrompt) { spin.end(); die(`could not find the Angle ${a.key} prompt in ${path.basename(reviewPromptsPath)}`); }
    if (selfContainedIssue(anglePrompt)) { spin.end(); assertSelfContained(anglePrompt, a.key); } // never courier a starved block
    const rModel = ov.reviewerModel[a.key as Angle] ?? REVIEWER.model;
    const rEffort = ov.reviewerEffort ?? REVIEWER.effort;
    const rr = await runReviewer(a, withCoreDocs(coreDocs, anglePrompt + REVIEWER_OUTPUT_FOOTER), repoRoot, rModel, rEffort);
    haltIfLimited(rr);                               // a limit mid-round exits cleanly, not with a stack trace
    const result = rr.result;
    const ver = path.basename(reviewPromptsPath).replace(/_REVIEW_PROMPTS\.md$/i, "");
    const file = path.join(archiveDir, `${ver}_GAP_REVIEW_${a.key}.md`);
    fs.writeFileSync(file, result);
    findings[a.key] = { verdict: verdictOf(result), file };
    pending.delete(a.key);
    // Empty-review tripwire: a real review surfaces polish even on READY. A suspiciously thin
    // reply is the fingerprint of a starved/confabulated reviewer — flag it loudly, don't trust it.
    const thin = result.trim().length < 1000;
    spin.log(`  ${a.key}: ${findings[a.key].verdict}  → ${path.basename(file)}${thin ? `  ⚠ only ${result.trim().length} chars — suspiciously thin; review by hand before trusting` : ""}`);
    spin.setLabel(`Round ${round} — reviewing [${[...pending].join(", ") || "wrapping up"}]`);
  }));
  spin.end();

  // 2) End-of-phase / convergence handling. A READY verdict still carries findings to fold —
  //    "all READY" is never a bare stop; it triggers the phase-appropriate end-game.
  if (!orchSession) die("findings need folding but no orchestrator session — re-run with --orchestrator-id <uuid>.");
  const allReady = Object.values(findings).every((f) => f.verdict === "READY");
  const anyNarrow = Object.values(findings).some((f) => f.verdict === "NARROW");
  const phaseIsA = active.every((a) => a.key === "A");   // cold-A phase (A alone) vs a B/C/D phase

  // 2a) COLD-A CLEARED → final fold + MINOR-bump handoff into a new dir → continue with B/C/D.
  if (allReady && phaseIsA) {
    console.log("\n✅ Cold-A cleared — final fold + handoff to B/C/D.");
    let p = await phaseHandoffA(findings, round);
    if (!p) die("phase handoff returned no structured payload.");
    p = await resolveDecisions(p);
    await compactForward(p.compactArg);
    reviewPromptsPath = path.resolve(p.reviewPromptsPath);
    archiveDir = p.archiveDir ? path.resolve(p.archiveDir) : path.dirname(reviewPromptsPath);
    if (!fs.existsSync(reviewPromptsPath)) die(`handoff reported a REVIEW_PROMPTS that isn't on disk: ${reviewPromptsPath}`);
    const handoffImpl = implFromPayload(p);
    if (fs.existsSync(handoffImpl)) coreDocs = resolveCoreDocs(handoffImpl, repoRoot);
    active = p.nextAngles?.length ? p.nextAngles : [{ key: "B", repo: true }, { key: "C", repo: true }];
    console.log(`  → B/C/D open in ${path.basename(archiveDir)}/ with [${active.map((a) => a.key).join(", ")}]`);
    continue;
  }

  // 2b) B/C/D CLEARED → final fold → compact (clean context) → Build Guide Final Cuts → done.
  if (allReady) {
    console.log("\n✅ B/C/D cleared — final fold, then Build Guide Final Cuts.");
    const p = await foldTurn(findings, round);
    await compactForward(p.compactArg);                    // compact BEFORE the clean condense (Sean's rule)
    const finalBump = finalBumpIntent(implFromPayload(p));
    const fc = await finalCutsStep(implFromPayload(p), finalBump);
    const done = fc ?? p;
    await compactForward(done.compactArg);
    archiveDir = done.archiveDir ? path.resolve(done.archiveDir) : archiveDir;
    console.log(`\n🏁 gate clear → ${done.version} (${finalBump ?? "bump per doc"}). The build guide is ready to execute.`);
    break;
  }

  // 3) Still converging: fold → consolidate (if NARROW) → compact → follow to the next round.
  let payload = await foldTurn(findings, round);
  if (anyNarrow) {                                          // NARROW = last stretch → clean-up read (step 3 of 4)
    const cons = await consolidateStep(implFromPayload(payload));
    if (cons) payload = cons;
  }
  await compactForward(payload.compactArg);

  reviewPromptsPath = path.resolve(payload.reviewPromptsPath);
  archiveDir = payload.archiveDir ? path.resolve(payload.archiveDir) : path.dirname(reviewPromptsPath);
  if (!fs.existsSync(reviewPromptsPath)) die(`orchestrator reported a REVIEW_PROMPTS that isn't on disk: ${reviewPromptsPath}`);
  const nextImpl = implFromPayload(payload);
  if (fs.existsSync(nextImpl)) coreDocs = resolveCoreDocs(nextImpl, repoRoot); // re-inline the bumped docs

  if (!payload.nextAngles?.length) { console.log("\n✅ No angles left to re-run — gate clear."); break; }
  active = payload.nextAngles;
}

console.log(`\nDone. GAP_REVIEW + REVIEW_PROMPTS files are in ${archiveDir}`);
console.log("(Full end-game wired: NARROW→consolidate, cold-A→B/C/D minor handoff, and B/C/D→Final Cuts + version bump.)");
