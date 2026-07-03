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
    --consolidate             enter at the clean-up-read step: condense the doc (own patch +
                              breadth), then continue into the loop's final cold-A pass
    --compact-first           with --consolidate: compact the orchestrator before condensing
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
  const work = a.repo ? repoRoot : fs.mkdtempSync(path.join(os.tmpdir(), `gate-${a.key}-`));
  return runQuery({
    prompt,
    model,
    effort,
    cwd: work,                                      // A runs in a throwaway dir → physically no repo
    disallowedTools: a.repo ? READONLY : NO_FILE_TOOLS,
    permissionMode: HEADLESS,
    systemPromptPreset: true,                       // good tool-use behavior for B/C/D
  });
}

// ── Orchestrator turns (fold's siblings) ─────────────────────────────────────
// Where the current living IMPLEMENT is on disk, given a control payload.
function implFromPayload(p: FoldPayload): string {
  const dir = p.archiveDir ? path.resolve(p.archiveDir) : path.dirname(path.resolve(p.reviewPromptsPath));
  const byPrompts = path.join(dir, path.basename(p.reviewPromptsPath).replace(/_REVIEW_PROMPTS\.md$/i, "_IMPLEMENT.md"));
  return fs.existsSync(byPrompts) ? byPrompts : path.join(dir, `${p.version}_IMPLEMENT.md`);
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

// The CONSOLIDATE step (DEV_RULES §End-game "Clean-up read") — a DISTINCT orchestrator turn,
// separate from the fold: end-to-end read → condense → its OWN patch bump → breadth subagents
// again (critical: a condense is where content can be dropped) → regenerate the final narrow
// cold-A prompt. No `_2.md` pre-condense copy (the rigor trail lives in the standing GAP_REVIEW
// files, not inline notes). Returns the new control payload (nextAngles = [A] on the clean doc).
async function consolidateStep(currentImpl: string): Promise<FoldPayload | undefined> {
  if (!orchSession) die("consolidate needs the orchestrator session — pass --orchestrator-id <uuid> or ensure the titled thread exists.");
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
    `Then WRITE your forward /compact instruction as compactArg. Return ONLY the structured control payload.`,
  ].join("\n\n");
  const s = new Spinner();
  s.begin(`consolidating (clean-up read) — orchestrator (${orchModel} ${orchEffort})`);
  const r = await runQuery({
    prompt, model: orchModel, effort: orchEffort, cwd: repoRoot, resume: orchSession,
    permissionMode: HEADLESS, settingSources: ["user", "project", "local"],
    jsonSchema: FOLD_SCHEMA as unknown as Record<string, unknown>,
  });
  s.end();
  haltIfLimited(r);
  const payload = r.structuredOutput as FoldPayload | undefined;
  if (payload) console.log(`  consolidated → ${payload.version}${payload.gateStatus ? `  (${payload.gateStatus})` : ""}`);
  else console.error(`  ⚠ consolidate returned no structured payload:\n${r.result.slice(0, 800)}`);
  return payload;
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
const ov = parseOverrides(rawArgs);
const orchModel = ov.orchModel ?? ORCHESTRATOR.model;
const orchEffort = ov.orchEffort ?? ORCHESTRATOR.effort;

const repoRoot = gitRoot(path.dirname(implAbs));
let archiveDir = path.dirname(implAbs);
let coreDocs = resolveCoreDocs(implAbs, repoRoot);
let reviewPromptsPath = path.join(archiveDir, path.basename(implAbs).replace(/_IMPLEMENT\.md$/i, "_REVIEW_PROMPTS.md"));
if (!fs.existsSync(reviewPromptsPath)) die(`REVIEW_PROMPTS not found next to the IMPLEMENT: ${reviewPromptsPath}`);

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
  console.log(`core docs (inlined every prompt):`);
  let total = 0;
  for (const d of coreDocs) { const kb = fs.statSync(d.path).size; total += kb; console.log(`  ${d.label.padEnd(16)} ${(kb / 1024).toFixed(0).padStart(4)} KB  ${path.relative(repoRoot, d.path)}`); }
  console.log(`  ${"TOTAL inlined".padEnd(16)} ${(total / 1024).toFixed(0).padStart(4)} KB  (~${Math.round(total / 4 / 1000)}k tokens per prompt, before the angle text)`);
  const md = fs.readFileSync(reviewPromptsPath, "utf8");
  console.log(`angle prompts parsed from ${path.basename(reviewPromptsPath)}:`);
  for (const key of ["A", "B", "C", "D"]) {
    const p = extractAnglePrompt(md, key);
    console.log(`  Angle ${key}: ${p ? `✓ found (${p.length} chars)` : "— not present"}`);
  }
  console.log(`\nwould run this round: [${active.map((a) => `${a.key}${a.repo ? "" : " no-repo"}`).join(", ")}]`);
  if (consolidateMode) console.log(`\n--consolidate: would run the clean-up-read step on ${path.basename(coreDocs[0].path)} first${compactFirst ? " (after a compact-forward)" : ""}, then continue the loop on the cleaned doc.`);
  process.exit(0);
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
    const rModel = ov.reviewerModel[a.key as Angle] ?? REVIEWER.model;
    const rEffort = ov.reviewerEffort ?? REVIEWER.effort;
    const rr = await runReviewer(a, withCoreDocs(coreDocs, anglePrompt), repoRoot, rModel, rEffort);
    haltIfLimited(rr);                               // a limit mid-round exits cleanly, not with a stack trace
    const result = rr.result;
    const ver = path.basename(reviewPromptsPath).replace(/_REVIEW_PROMPTS\.md$/i, "");
    const file = path.join(archiveDir, `${ver}_GAP_REVIEW_${a.key}.md`);
    fs.writeFileSync(file, result);
    findings[a.key] = { verdict: verdictOf(result), file };
    pending.delete(a.key);
    spin.log(`  ${a.key}: ${findings[a.key].verdict}  → ${path.basename(file)}`);
    spin.setLabel(`Round ${round} — reviewing [${[...pending].join(", ") || "wrapping up"}]`);
  }));
  spin.end();

  // 2) All active angles READY → this phase is clear.
  if (Object.values(findings).every((f) => f.verdict === "READY")) {
    console.log("\n✅ Every active angle returned READY TO BUILD.");
    // PILOT-HARDEN: A-gate close → orchestrator preps B/C/D kickoff (new dir); and the final
    // Build Guide Final Cuts after B/C/D close. For the first pilot these are driven by hand
    // with the orchestrator; wiring them as explicit steps is the next hardening pass.
    break;
  }

  // 3) Fold. Resume Sean's orchestrator; it validates + folds + bumps + regenerates + self-compacts.
  if (!orchSession) die("findings need folding but no orchestrator session — re-run with --orchestrator-id <uuid>.");
  const anyNarrow = Object.values(findings).some((f) => f.verdict === "NARROW");
  const foldPrompt = [
    `You are resuming as the Build-Guide Planning Orchestrator (your own thread) for the gap-review gate on ${implAbs}.`,
    `Round ${round} findings are written to disk: ${Object.entries(findings).map(([k, f]) => `${k}=${f.file} (${f.verdict})`).join(", ")}.`,
    `Per DEV_RULES §The Gap-Review Gate: VALIDATE each finding against reality (flag-don't-assert — verify before folding; do NOT fold a finding that is a DECISION — a north-star / architecture / genuinely-unclear call — surface it instead).`,
    `Fold the real ones into the IMPLEMENT + addenda, bump the version (PATCH), update the "Settled — do not re-raise" ledger (replace superseded entries, never append a contradiction), run the 2-subagent breadth pass, and regenerate the REVIEW_PROMPTS (scoped + narrowed re-prompt for any passed angle whose lane a fold touched; omit angles that stay closed).`,
    `Then WRITE your own forward /compact instruction (what the NEXT round must keep) and return it as compactArg.`,
    `Return ONLY the structured control payload.`,
  ].join("\n\n");

  const foldSpin = new Spinner();
  foldSpin.begin(`folding round ${round} — orchestrator (${orchModel} ${orchEffort})`);
  let fold = await runQuery({
    prompt: foldPrompt,
    model: orchModel,
    effort: orchEffort,
    cwd: repoRoot,
    resume: orchSession,
    permissionMode: HEADLESS,
    settingSources: ["user", "project", "local"],   // its project context: CLAUDE.md/AGENTS.md/DEV_RULES/memory
    jsonSchema: FOLD_SCHEMA as unknown as Record<string, unknown>,
  });
  foldSpin.end();
  haltIfLimited(fold);
  let payload = fold.structuredOutput as FoldPayload | undefined;
  if (!payload) die(`orchestrator returned no structured payload:\n${fold.result.slice(0, 1200)}`);
  console.log(`  folded ${payload.foldedCount ?? "?"} → ${payload.version}${payload.gateStatus ? `  (${payload.gateStatus})` : ""}`);

  // 4) Human decision-pause — the loop CANNOT fold a judgment call without Sean.
  if (payload.decisionsNeeded?.length) {
    console.log(`\n⏸  ${payload.decisionsNeeded.length} decision(s) need you:`);
    const answers: string[] = [];
    for (const d of payload.decisionsNeeded) answers.push(`Q: ${d}\nA: ${await ask(`\n${d}\n> `)}`);
    fold = await runQuery({
      prompt: `The human answered:\n\n${answers.join("\n\n")}\n\nFold accordingly, regenerate the REVIEW_PROMPTS, and return the same structured payload shape.`,
      model: orchModel, effort: orchEffort, cwd: repoRoot, resume: orchSession,
      permissionMode: HEADLESS, settingSources: ["user", "project", "local"],
      jsonSchema: FOLD_SCHEMA as unknown as Record<string, unknown>,
    });
    haltIfLimited(fold);
    payload = (fold.structuredOutput as FoldPayload | undefined) ?? payload;
  }

  // 4.5) CONSOLIDATE (distinct step). A NARROW verdict means the loop is converging → run the
  //      clean-up-read turn on the just-folded doc (its own patch + its own breadth pass), so the
  //      presumed-final cold-A pass reviews the cleaned version. This is step 3 of the 4-step
  //      NARROW protocol (fold → consolidate → final A), wired so it never needs a human's eyes.
  if (anyNarrow) {
    const cons = await consolidateStep(implFromPayload(payload));
    if (cons) payload = cons;
  }

  // 5) File-drop compaction — drive the orchestrator's self-authored /compact on its own session.
  await compactForward(payload.compactArg);

  // 6) Follow the orchestrator to the next round's docs + angles.
  reviewPromptsPath = path.resolve(payload.reviewPromptsPath);
  archiveDir = payload.archiveDir ? path.resolve(payload.archiveDir) : path.dirname(reviewPromptsPath);
  if (!fs.existsSync(reviewPromptsPath)) die(`orchestrator reported a REVIEW_PROMPTS that isn't on disk: ${reviewPromptsPath}`);
  const nextImpl = path.join(archiveDir, path.basename(reviewPromptsPath).replace(/_REVIEW_PROMPTS\.md$/i, "_IMPLEMENT.md"));
  if (fs.existsSync(nextImpl)) coreDocs = resolveCoreDocs(nextImpl, repoRoot); // re-inline the bumped docs

  if (!payload.nextAngles?.length) { console.log("\n✅ No angles left to re-run — gate clear."); break; }
  active = payload.nextAngles;
}

console.log(`\nDone. GAP_REVIEW + REVIEW_PROMPTS files are in ${archiveDir}`);
console.log("(NARROW→consolidate is wired; the phase A→B/C/D directory handoff and final Build Guide Cuts are the remaining end-game steps — see NEXT_UPDATE.md.)");
