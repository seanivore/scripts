// gate/src/claude.ts — spawn ONE peer `claude -p` instance.
// Each call is a genuinely separate Claude Code process (a PEER, never a subagent),
// authenticated to the Max subscription (we strip ANTHROPIC_API_KEY so it can't fall
// to the metered key). The prompt goes via stdin so a ~100k-token build doc fits.

import { spawn } from "node:child_process";

export interface RunOpts {
  prompt: string;
  model?: string;            // "opus" = latest Opus on the subscription
  effort?: string;           // low|medium|high|xhigh|max
  cwd?: string;              // the repo dir (B/C/D); a docs-only/temp dir (A) so it physically can't reach the repo
  allowedTools?: string[];
  disallowedTools?: string[];
  resume?: string;           // a prior session id (the persistent orchestrator)
  appendSystemPrompt?: string;
  permissionMode?: string;   // headless: avoid interactive prompts (e.g. "bypassPermissions")
  timeoutMs?: number;
}

export interface RunResult {
  result: string;            // the model's final text (findings, or the orchestrator's output)
  sessionId: string;         // capture to --resume the orchestrator next round
  costUsd: number;           // notional cost (usage shows against Max even on the subscription)
  raw: any;                  // the full --output-format json payload
}

export function runClaude(o: RunOpts): Promise<RunResult> {
  const args = ["-p", "--output-format", "json"];
  if (o.model) args.push("--model", o.model);
  if (o.effort) args.push("--effort", o.effort);
  if (o.resume) args.push("--resume", o.resume);
  if (o.permissionMode) args.push("--permission-mode", o.permissionMode);
  if (o.appendSystemPrompt) args.push("--append-system-prompt", o.appendSystemPrompt);
  if (o.allowedTools?.length) args.push("--allowedTools", ...o.allowedTools);
  if (o.disallowedTools?.length) args.push("--disallowedTools", ...o.disallowedTools);

  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;     // force the Max subscription, never the metered key
  delete env.ANTHROPIC_AUTH_TOKEN;

  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd: o.cwd ?? process.cwd(), env });
    let out = "", err = "";
    const timer = o.timeoutMs
      ? setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`claude timed out after ${o.timeoutMs}ms`)); }, o.timeoutMs)
      : null;

    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { if (timer) clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${err.slice(0, 800)}`));
      try {
        const j = JSON.parse(out);
        resolve({ result: j.result, sessionId: j.session_id, costUsd: j.total_cost_usd ?? 0, raw: j });
      } catch {
        reject(new Error(`could not parse claude JSON output: ${out.slice(0, 800)}`));
      }
    });

    child.stdin.write(o.prompt);    // prompt via stdin → large build docs fit
    child.stdin.end();
  });
}
