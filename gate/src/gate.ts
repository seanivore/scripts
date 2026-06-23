#!/usr/bin/env -S npx tsx
// gate/src/gate.ts — the gap-review courier loop.
// FIRST CUT: the foundation (claude.ts) is smoke-tested; this loop is hardened in the Phase 5 pilot.
//
//   tsx src/gate.ts <IMPLEMENT-path> [--phase A|BCD|all] [--max-rounds N]   (run from the target repo)
//
// The script is the COURIER + loop control. The agentic work stays with peer `claude -p`:
//   • ORCHESTRATOR (persistent --resume, repo, xhigh): fills templates/review-prompt.md from the build docs +
//     DEV_RULES, writes per-angle prompt files + the human-readable REVIEW_PROMPTS.md; later validates +
//     folds findings, bumps the version, updates the ledger, regenerates prompts, flags DECISIONS for the human.
//   • REVIEWERS (fresh per pass, never reused, never subagents): A = no repo (temp cwd + no file tools, docs
//     inlined); B/C/D = repo, read-only. Each returns findings; the engine writes GAP_REVIEW_<angle>.md.

import { runClaude } from "./claude.ts";
import { ORCHESTRATOR, REVIEWER } from "../config.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as readline from "node:readline/promises";

function extractJson(text: string): any {
  const m = text.match(/```json\s*([\s\S]*?)```/);          // orchestrator wraps its control payload in a fence
  try { return JSON.parse((m ? m[1] : text).trim()); } catch { return null; }
}
async function ask(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(q); rl.close(); return a;
}
function verdictOf(text: string): "READY" | "NARROW" | "PASS" {
  if (/NEEDS ANOTHER PASS \(NARROW\)/i.test(text)) return "NARROW";
  if (/READY TO BUILD/i.test(text)) return "READY";
  return "PASS";
}

const HEADLESS = "bypassPermissions";                        // non-interactive; access still bounded by allow/disallow
const NO_FILE_TOOLS = ["Read", "Glob", "Grep", "Bash", "Write", "Edit", "NotebookEdit", "WebFetch"]; // A: pure reasoning
const READONLY = ["Write", "Edit", "NotebookEdit"];          // B/C/D: read the repo, mutate nothing

const argv = process.argv.slice(2);
const implPath = argv[0];
if (!implPath || implPath.startsWith("--")) {
  console.error("usage: gate <IMPLEMENT-path> [--phase A|BCD|all] [--max-rounds N]"); process.exit(1);
}
const phase = (argv.includes("--phase") ? argv[argv.indexOf("--phase") + 1] : "all") as "A" | "BCD" | "all";
const maxRounds = argv.includes("--max-rounds") ? Number(argv[argv.indexOf("--max-rounds") + 1]) : 12;

const repoDir = process.cwd();
const archiveDir = path.dirname(path.resolve(implPath));
const work = fs.mkdtempSync(path.join(os.tmpdir(), "gate-"));
const gateSrc = path.dirname(new URL(import.meta.url).pathname);
const templatePath = path.join(gateSrc, "..", "templates", "review-prompt.md");

function orchestratorPrompt(task: string): string {
  return [
    "You are the Build-Guide Planning Orchestrator for the gap-review gate (DEV_RULES v4.1.0 §The Gap-Review Gate).",
    `Build under review: ${path.resolve(implPath)} (+ its same-version addenda). Template: ${templatePath}.`,
    "Read DEV_RULES, the IMPLEMENT + addenda, and the template before acting.",
    task,
    "Return ONE ```json fenced block as your control payload (write any files it describes). Be terse outside the JSON.",
  ].join("\n\n");
}

// 1) Generate the prompts for this phase.
let orch = await runClaude({
  ...ORCHESTRATOR, cwd: repoDir, permissionMode: HEADLESS,
  prompt: orchestratorPrompt(
    `Generate the gap-review prompts for phase "${phase}". Fill the template from the build docs + DEV_RULES. ` +
    `Write the human-readable REVIEW_PROMPTS.md into ${archiveDir} (versioned), AND one fully self-contained prompt ` +
    `file per active angle into ${work} (prompt_<ANGLE>.txt; for angle A inline ALL docs — A gets no repo). ` +
    `JSON: { "version":"vX_Y_Z", "angles":[ {"key":"A","promptFile":"<abs>","repo":false}, ... ] }`
  ),
});
let status = extractJson(orch.result);
const orchSession = orch.sessionId;
if (!status?.angles?.length) { console.error("orchestrator returned no angle prompts:\n", orch.result.slice(0, 1500)); process.exit(1); }
console.log(`▶ ${status.version}: prompts generated for [${status.angles.map((a: any) => a.key).join(", ")}]`);

// 2) The round loop.
for (let round = 1; round <= maxRounds; round++) {
  const active = status.angles as Array<{ key: string; promptFile: string; repo: boolean }>;
  console.log(`\n— Round ${round}: reviewing [${active.map((a) => a.key).join(", ")}] —`);

  const findings: Record<string, { verdict: string; file: string }> = {};
  await Promise.all(active.map(async (a) => {
    const prompt = fs.readFileSync(a.promptFile, "utf8");
    const r = await runClaude({
      model: REVIEWER.model, effort: REVIEWER.effort, prompt, permissionMode: HEADLESS,
      cwd: a.repo ? repoDir : work,                          // A runs in the temp dir → physically no repo
      disallowedTools: a.repo ? READONLY : NO_FILE_TOOLS,
    });
    const verdict = verdictOf(r.result);
    const file = path.join(archiveDir, `${status.version}_GAP_REVIEW_${a.key}.md`);
    fs.writeFileSync(file, r.result);
    findings[a.key] = { verdict, file };
    console.log(`  ${a.key}: ${verdict}  → ${path.basename(file)}`);
  }));

  if (Object.values(findings).every((f) => f.verdict === "READY")) {
    console.log("\n✅ Every active angle returned READY TO BUILD."); break;
  }

  // 3) Orchestrator validates + folds; flags decisions; chooses the next round's angles.
  orch = await runClaude({
    ...ORCHESTRATOR, cwd: repoDir, resume: orchSession, permissionMode: HEADLESS,
    prompt: orchestratorPrompt(
      `Findings written: ${Object.entries(findings).map(([k, f]) => `${k}=${f.file} (${f.verdict})`).join(", ")}. ` +
      `Validate each (flag-don't-assert: verify before folding), fold the REAL ones into the IMPLEMENT, bump the version, ` +
      `update the ledger (replace superseded entries), run the 2-subagent breadth pass, regenerate the prompt files + REVIEW_PROMPTS.md, ` +
      `and compact your own session forward. Do NOT fold a finding that is a DECISION (architecture / north-star / genuinely unclear) — surface it. ` +
      `Angle-by-angle: only re-run an angle whose lane a fold touched (scoped + narrowed); omit angles that stay closed. ` +
      `JSON: { "version":"vX_Y_Z", "foldedCount":N, "decisionsNeeded":["..."], "angles":[ {"key","promptFile","repo"} to run NEXT ] }`
    ),
  });
  status = extractJson(orch.result);
  if (!status) { console.error("orchestrator fold returned no JSON:\n", orch.result.slice(0, 1500)); process.exit(1); }
  console.log(`  folded ${status.foldedCount ?? "?"} → ${status.version}`);

  // 4) Human decision-pause — the loop CANNOT fold a judgment call without you.
  if (status.decisionsNeeded?.length) {
    console.log(`\n⏸  ${status.decisionsNeeded.length} decision(s) need you:`);
    const answers: string[] = [];
    for (const d of status.decisionsNeeded) answers.push(`Q: ${d}\nA: ${await ask(`\n${d}\n> `)}`);
    orch = await runClaude({
      ...ORCHESTRATOR, cwd: repoDir, resume: orchSession, permissionMode: HEADLESS,
      prompt: orchestratorPrompt(`The human answered:\n${answers.join("\n\n")}\n\nFold accordingly, regenerate prompts, return the same JSON shape (angles to run next).`),
    });
    status = extractJson(orch.result) ?? status;
  }

  if (!status.angles?.length) { console.log("\n✅ No angles left to re-run — gate clear."); break; }
}

console.log("\nDone. GAP_REVIEW + REVIEW_PROMPTS files are in", archiveDir);
console.log("(First cut — foundation smoke-tested; the Phase 5 pilot hardens the orchestrator JSON contract, A's no-repo enforcement, the end-game cleanup, and breadth-subagent wiring.)");
