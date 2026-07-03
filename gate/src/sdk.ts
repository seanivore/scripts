// gate/src/sdk.ts — spawn ONE peer Claude via the Agent SDK.
//
// Each runQuery() call is a genuinely separate Claude Code instance (a PEER, never a
// subagent), driven through @anthropic-ai/claude-agent-sdk. We strip ANTHROPIC_API_KEY
// (and any proxy token) from the child env so it authenticates to the Max SUBSCRIPTION,
// never the metered key — and the init message's `apiKeySource` lets the caller VERIFY
// that ('oauth'/'temporary' = subscription; 'user'/'project'/'org' = an API key snuck in).
//
// The SDK is a thin wrapper over the same engine as `claude -p`, so a separate query()
// with its own `cwd` runs its own process that physically cannot read another repo dir —
// that is Angle A's wall. Identifiers verified against @anthropic-ai/claude-agent-sdk@0.3.198.

import {
  query,
  listSessions,
  type Options,
  type EffortLevel,
  type PermissionMode,
  type SettingSource,
  type AgentDefinition,
  type ApiKeySource,
  type SDKSessionInfo,
} from "@anthropic-ai/claude-agent-sdk";

export interface RunOpts {
  prompt: string;
  model?: string;                              // "opus" = latest Opus on the subscription
  effort?: EffortLevel;                        // "max" reviewers / "xhigh" orchestrator
  cwd?: string;                                // repo root (B/C/D) or a temp dir (A → no repo)
  allowedTools?: string[];
  disallowedTools?: string[];
  additionalDirectories?: string[];
  agents?: Record<string, AgentDefinition>;    // the orchestrator's 2 breadth subagents
  resume?: string;                             // a prior session id (the persistent orchestrator)
  forkSession?: boolean;
  permissionMode?: PermissionMode;             // default "bypassPermissions" for headless
  settingSources?: SettingSource[];            // orchestrator loads project/user; reviewers stay clean (omit)
  systemPromptPreset?: boolean;                // true → claude_code preset (grounding: cwd/git/tool-discipline)
  systemPromptAppend?: string;                 // extra system-prompt text appended to the preset (e.g. Angle A's honest "no tools this run")
  jsonSchema?: Record<string, unknown>;        // structured control payload (orchestrator folds)
  abortController?: AbortController;
  onEvent?: (m: unknown) => void;              // live progress: every streamed SDK message is forwarded (the renderer filters)
  includePartialMessages?: boolean;            // also emit token-level stream_event partials (off by default; the typed task/tool msgs suffice)
}

export interface RunResult {
  result: string;                              // model's final text (findings, or orchestrator output)
  sessionId: string;                           // capture to resume the orchestrator next round
  structuredOutput?: unknown;                  // present when jsonSchema was set
  apiKeySource: ApiKeySource;                  // 'oauth'/'temporary' = subscription; else an API key leaked in
  costUsd: number;                             // notional; usage shows against Max on the subscription
  isError: boolean;
  rateLimited: boolean;                        // true → hit a Max session/weekly limit (not a real failure)
  resetHint?: string;                          // human reset time parsed from the limit message, if any
}

// Force the Max subscription: never let the metered key or a bearer proxy token win the
// SDK's auth precedence. Copies the rest of the env so the CLI still finds PATH/HOME/creds.
function subscriptionEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

export async function runQuery(o: RunOpts): Promise<RunResult> {
  const options: Options = {
    env: subscriptionEnv(),
    permissionMode: o.permissionMode ?? "bypassPermissions",
    ...(o.model ? { model: o.model } : {}),
    ...(o.effort ? { effort: o.effort } : {}),
    ...(o.cwd ? { cwd: o.cwd } : {}),
    ...(o.allowedTools ? { allowedTools: o.allowedTools } : {}),
    ...(o.disallowedTools ? { disallowedTools: o.disallowedTools } : {}),
    ...(o.additionalDirectories ? { additionalDirectories: o.additionalDirectories } : {}),
    ...(o.agents ? { agents: o.agents } : {}),
    ...(o.resume ? { resume: o.resume } : {}),
    ...(o.forkSession ? { forkSession: true } : {}),
    ...(o.settingSources ? { settingSources: o.settingSources } : {}),
    ...(o.systemPromptPreset
      ? { systemPrompt: { type: "preset", preset: "claude_code", ...(o.systemPromptAppend ? { append: o.systemPromptAppend } : {}) } }
      : {}),
    ...(o.jsonSchema ? { outputFormat: { type: "json_schema", schema: o.jsonSchema } } : {}),
    ...(o.abortController ? { abortController: o.abortController } : {}),
    ...(o.includePartialMessages ? { includePartialMessages: true } : {}),
  };

  let sessionId = "";
  let apiKeySource: ApiKeySource = "oauth";
  let result = "";
  let structuredOutput: unknown;
  let costUsd = 0;
  let isError = false;
  let rateLimited = false;
  let resetHint: string | undefined;

  // Detect a Max usage-limit signal from a message OR a thrown error, and pull the reset
  // time out of it. The SDK THROWS on a session-limit ("You've hit your session limit ·
  // resets 2:20am (…)"), so without this catch it crashes the whole loop with a stack trace.
  const noteLimit = (text: string): void => {
    rateLimited = true;
    const m = text.match(/resets?\s+(.+)/i);
    if (m && !resetHint) resetHint = m[1].trim();
  };

  try {
    for await (const m of query({ prompt: o.prompt, options })) {
      o.onEvent?.(m);                            // forward every message to the live progress renderer
      if (m.type === "system" && m.subtype === "init") {
        sessionId = m.session_id;
        apiKeySource = m.apiKeySource;
      } else if (m.type === "rate_limit_event") {
        if (m.rate_limit_info?.status === "rejected") noteLimit(result || "usage limit rejected");
      } else if (m.type === "result") {
        sessionId = m.session_id;
        costUsd = m.total_cost_usd ?? 0;
        if (m.subtype === "success") {
          result = m.result;
          structuredOutput = m.structured_output;
        } else {
          isError = true;
          result = `[gate] query ended non-success: ${m.subtype}`;
          if (/limit/i.test(String(m.subtype))) noteLimit(result);
        }
      }
    }
  } catch (e) {
    isError = true;
    const msg = e instanceof Error ? e.message : String(e);
    result = msg;
    if (/\blimit\b|rate.?limit|rejected/i.test(msg)) noteLimit(msg);
    else throw e;                              // a genuine crash still surfaces loudly
  }

  return { result, sessionId, structuredOutput, apiKeySource, costUsd, isError, rateLimited, resetHint };
}

// Locate an existing session — e.g. Sean's renamed "IMPLEMENT Build Planning Orchestrator"
// thread — by its /rename title (customTitle) or summary, scoped to a project dir.
// Most-recently-modified match wins. Returns undefined if nothing matches.
export async function findSessionByTitle(
  dir: string,
  needle: string,
): Promise<SDKSessionInfo | undefined> {
  const sessions = await listSessions({ dir });
  const needleLower = needle.toLowerCase();
  return sessions
    .filter((s) => `${s.customTitle ?? ""}\n${s.summary ?? ""}`.toLowerCase().includes(needleLower))
    .sort((a, b) => b.lastModified - a.lastModified)[0];
}
