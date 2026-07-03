// gate/src/progress.ts — the live "feel like Claude Code" progress view.
//
// Renders an agent's working process in Sean's MAO design language
// (modular-agent-orchestrator/AUDIT_LOGIC/MAO_FLOW/11_UI_SCREEN_DISPLAY_MAO_BUSY.md):
// completed steps + items accumulate above with status icons and a cost/token/time footer,
// while ONE live line at the bottom shows a blinking present-participle + the current activity.
// This append-plus-one-live-line model is exactly what Claude Code does; it's robust (no
// full-screen cursor math) and degrades to plain lines off a TTY.
//
//   Icon language:
//     ●  completed step      ○  a step not yet started
//     ▶︎  completed item      ▷  an item still to do
//     🞶  the agent           >  the user
//     └──/   nested tree;  footer:  Done ($x • n tok • ys)
//
// It is fed the SDK's typed progress messages (SDKTaskStarted/Updated/Progress/Notification,
// SDKToolProgress, SDKThinkingTokens) via handle(); it never depends on any single one arriving
// (a phase with no events still shows the header + a live heartbeat), so it can't break if a
// future SDK changes what it streams — the backbone is gate-driven, the events are enrichment.

const TICK_MS = 110;

// A present-participle for the live line — phase-accurate but alive, in the MAO spirit
// (`+ FOLDING +`). Keyed off the current tool when we know it, else the phase word.
const TOOL_WORD: Record<string, string> = {
  Read: "reading", Glob: "scanning", Grep: "scanning", Bash: "running",
  Edit: "revising", Write: "writing", MultiEdit: "revising", NotebookEdit: "revising",
  Task: "delegating", WebFetch: "fetching", WebSearch: "searching",
  TaskCreate: "planning", TaskUpdate: "planning", TaskList: "planning", TodoWrite: "planning",
};
function participle(word: string): string {
  return `+ ${word.toUpperCase()} +`;
}

interface TaskRow {
  desc: string;
  status: "pending" | "running" | "completed" | "failed" | "killed" | "paused";
  subagent?: string;
  tokens?: number;
  ms?: number;
}

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}
function fmtFooter(costUsd: number | undefined, tokens: number | undefined, ms: number): string {
  const bits: string[] = [];
  if (costUsd && costUsd > 0) bits.push(`$${costUsd.toFixed(costUsd < 0.1 ? 3 : 2)}`);
  if (tokens && tokens > 0) bits.push(`${tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens} tok`);
  bits.push(fmtElapsed(ms));
  return bits.join(" • ");
}

export class ProgressView {
  private readonly tty = process.stdout.isTTY === true && !process.env.GATE_NO_TTY;
  private frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private i = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private start = 0;
  private step = "";
  private word = "working";
  private activity = "";                       // the current tool / task detail, shown in the live line
  private tasks = new Map<string, TaskRow>();
  private printedDone = new Set<string>();      // task ids we've already printed a ▶︎ line for
  private cols(): number { return Math.max(40, (process.stdout.columns ?? 80) - 1); }
  private readonly METRIC_COL = 54;             // descriptions pad to here so the (tok • s) metrics line up
  private dim(s: string): string { return this.tty && s ? `\x1b[2m${s}\x1b[22m` : s; }

  private clearLive(): void { if (this.tty) process.stdout.write(`\r\x1b[2K`); }
  private paintLive(): void {
    if (!this.tty) return;
    this.i = (this.i + 1) % this.frames.length;
    const flash = Math.floor((Date.now() - this.start) / 500) % 2 === 0 ? "▷" : "▶︎";
    const detail = this.activity ? `  ⟨${this.activity}⟩` : "";
    let line = `${this.frames[this.i]} ${flash} ${participle(this.word)}${detail}  ${fmtElapsed(Date.now() - this.start)}`;
    if (line.length > this.cols()) line = line.slice(0, this.cols() - 1) + "…";
    process.stdout.write(`\r\x1b[2K${line}`);
  }
  // Print a permanent line above the live line without losing the spinner.
  private emit(line: string): void {
    this.clearLive();
    console.log(line);
    if (this.tty && this.timer) this.paintLive();
  }

  begin(step: string, word = "working"): void {
    this.step = step; this.word = word; this.start = Date.now();
    this.tasks.clear(); this.printedDone.clear(); this.activity = "";
    console.log(`\n●  ${step}\n`);               // blank lines above + below the header → breathing room (MAO: whitespace is our friend)
    if (!this.tty) return;
    this.paintLive();
    this.timer = setInterval(() => this.paintLive(), TICK_MS);
    this.timer.unref?.();
  }

  setWord(word: string): void { this.word = word; }

  // Feed one SDK message. Unknown/irrelevant types are ignored; the view never needs any single one.
  handle(m: unknown): void {
    const msg = m as { type?: string; subtype?: string; [k: string]: unknown };
    const t = msg.type, sub = msg.subtype;
    if (t === "system" && sub === "task_started") {
      const id = String(msg.task_id ?? "");
      const desc = String(msg.description ?? msg.prompt ?? "task");
      if (msg.skip_transcript) return;            // ambient/housekeeping — hide per the SDK contract
      this.tasks.set(id, { desc, status: "running", subagent: msg.subagent_type as string | undefined });
      this.activity = desc;
      if (msg.subagent_type) this.setWord("delegating");
    } else if (t === "system" && sub === "task_progress") {
      const id = String(msg.task_id ?? "");
      const row = this.tasks.get(id); if (!row) return;
      const u = msg.usage as { total_tokens?: number; duration_ms?: number } | undefined;
      if (u) { row.tokens = u.total_tokens; row.ms = u.duration_ms; }
      if (msg.last_tool_name) { this.activity = `${row.desc} — ${msg.last_tool_name}`; this.setWord(TOOL_WORD[String(msg.last_tool_name)] ?? this.word); }
    } else if (t === "system" && (sub === "task_updated" || sub === "task_notification")) {
      const id = String(msg.task_id ?? "");
      const row = this.tasks.get(id) ?? { desc: String(msg.summary ?? "task"), status: "running" as const };
      const patch = (msg.patch ?? {}) as { status?: TaskRow["status"] };
      const status = (patch.status ?? (msg.status as TaskRow["status"])) ?? row.status;
      row.status = status;
      const u = msg.usage as { total_tokens?: number; duration_ms?: number } | undefined;
      if (u) { row.tokens = u.total_tokens; row.ms = u.duration_ms; }
      this.tasks.set(id, row);
      if ((status === "completed" || status === "failed" || status === "killed") && !this.printedDone.has(id)) {
        this.printedDone.add(id);
        const mark = status === "completed" ? "▶︎" : "✕";
        const foot = fmtFooter(undefined, row.tokens, row.ms ?? 0);
        const pad = row.desc.length < this.METRIC_COL ? " ".repeat(this.METRIC_COL - row.desc.length) : "   ";
        this.emit(`     ${mark}   ${row.desc}${foot ? `${pad}${this.dim(foot)}` : ""}`);  // roomier indent, aligned + dimmed metrics
      }
    } else if (t === "tool_progress") {
      const name = String(msg.tool_name ?? "");
      if (name) { this.activity = name; this.setWord(TOOL_WORD[name] ?? this.word); }
    } else if (t === "tool_use_summary" && typeof msg.summary === "string") {
      this.activity = msg.summary.slice(0, 80);
    } else if (t === "system" && sub === "thinking_tokens") {
      const tok = Number(msg.estimated_tokens ?? 0);
      if (tok > 0) this.activity = `thinking (~${tok >= 1000 ? `${(tok / 1000).toFixed(1)}k` : tok} tok)`;
    }
  }

  // Close the step: stop the live line, print the MAO footer (Done ($x • n tok • ys)).
  end(opts?: { costUsd?: number; tokens?: number; note?: string; failed?: boolean }): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.clearLive();
    const ms = Date.now() - this.start;
    const foot = fmtFooter(opts?.costUsd, opts?.tokens, ms);
    const verb = opts?.failed ? "Stopped" : "Done";
    console.log(`     └──  ${verb}   ${this.dim(foot)}${opts?.note ? `   ${opts.note}` : ""}\n`); // aligned under items + trailing blank
  }
}

// A zero-spend preview: replay synthetic SDK-shaped events so the MAO look can be seen without
// a live agent run. Driven by `gate --demo-ui`.
export async function demoProgress(): Promise<void> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const pv = new ProgressView();
  pv.begin("folding round 2 — orchestrator (opus xhigh)", "folding");
  const steps: Array<[string, string, number, number]> = [
    ["validate finding: WS4 sale auto-apply race", "Read", 4200, 900],
    ["validate finding: WS2 alt-text publish gate", "Grep", 3100, 700],
    ["fold the 2 real findings into the IMPLEMENT", "Edit", 6800, 1500],
    ["breadth subagent — owner-journey", "Task", 12400, 2600],
    ["breadth subagent — integration", "Task", 11800, 2500],
    ["regenerate REVIEW_PROMPTS (4 self-contained blocks)", "Write", 5200, 1200],
    ["bump version → v3_6_5", "Bash", 800, 300],
  ];
  let id = 0;
  for (const [desc, tool, tokens, dur] of steps) {
    const tid = `t${id++}`;
    pv.handle({ type: "system", subtype: "task_started", task_id: tid, description: desc, subagent_type: tool === "Task" ? "breadth" : undefined });
    await sleep(500);
    pv.handle({ type: "system", subtype: "task_progress", task_id: tid, last_tool_name: tool, usage: { total_tokens: Math.floor(tokens / 2), duration_ms: Math.floor(dur / 2) } });
    await sleep(700);
    pv.handle({ type: "system", subtype: "task_notification", task_id: tid, status: "completed", usage: { total_tokens: tokens, duration_ms: dur } });
    await sleep(150);
  }
  pv.end({ costUsd: 0.42, tokens: 58200, note: "→ v3_6_5 (2 findings folded, both breadth READY)" });
}
