#!/usr/bin/env -S npx tsx
// gate/src/probe.ts — verification gates for the SDK foundation, run BEFORE the full loop.
// Each subcommand proves ONE risky mechanic in isolation (prove the cheap mechanics first,
// so a live gate never fails deep in round 7 on something we could have checked up front).
//
//   probe auth                    — assert we're on the Max SUBSCRIPTION, not an API key
//   probe compact                 — can a self-authored /compact be driven on a resumed session? (GATE #1)
//   probe isolate <repoRoot>      — does an Angle-A instance (temp cwd, file tools denied) truly fail to read the repo?
//   probe find <dir> <title...>   — locate a /rename-titled session (e.g. the orchestrator thread) — NO model spend
//
// auth/compact/isolate each spend a little Max usage (one or a few low-effort Opus turns).
// find spends nothing (it only reads local session files).

import { runQuery, findSessionByTitle } from "./sdk.ts";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const [cmd, ...rest] = process.argv.slice(2);
// A metered API key manifests as one of these apiKeySource values. Anything else
// ('none' = no key used, 'oauth'/'temporary' = subscription OAuth) means the key was
// stripped and we fell through to the claude.ai Max login — verified via `claude auth status`.
const METERED_SOURCES = new Set(["user", "project", "org", "ANTHROPIC_API_KEY"]);

async function auth(): Promise<void> {
  const r = await runQuery({ prompt: "Reply with exactly: ok", model: "opus", effort: "low" });
  const ok = !METERED_SOURCES.has(r.apiKeySource);
  console.log(`apiKeySource : ${r.apiKeySource}  ${ok ? "✓ subscription (no metered key used)" : "✗ NOT subscription — an API key won the auth race"}`);
  console.log(`result       : ${JSON.stringify(r.result).slice(0, 80)}`);
  console.log(`cost (usd)   : ${r.costUsd}`);
  console.log(`session id   : ${r.sessionId}`);
  process.exit(ok ? 0 : 1);
}

async function compact(): Promise<void> {
  const marker = `GATE-MARKER-${Date.now()}`;
  const seed = await runQuery({
    prompt: `Remember this exact token for later: ${marker}. Also note that we are mid gap-review. Reply "seeded".`,
    model: "opus", effort: "low",
  });
  console.log(`seeded session : ${seed.sessionId}  (${JSON.stringify(seed.result).slice(0, 40)})`);

  const comp = await runQuery({
    resume: seed.sessionId,
    prompt: `/compact Preserve verbatim the exact token I asked you to remember and the fact that we are mid gap-review; you may drop everything else.`,
    model: "opus", effort: "low",
  });
  console.log(`compact turn   : ${comp.isError ? "✗ ERROR" : "ran"}  → ${JSON.stringify(comp.result).slice(0, 90)}`);

  const recall = await runQuery({
    resume: seed.sessionId,
    prompt: `Without any preamble or explanation, print ONLY the exact token you were asked to remember.`,
    model: "opus", effort: "low",
  });
  const survived = recall.result.includes(marker);
  console.log(`recall         : ${JSON.stringify(recall.result).slice(0, 120)}`);
  console.log(`token survived : ${survived ? "✓ YES — self-authored /compact is drivable via the SDK" : "✗ NO — wire the PreCompact-hook fallback"}`);
  console.log(`(note: this proves the MECHANISM; true under-load shrinkage is confirmed in the live pilot.)`);
  process.exit(survived ? 0 : 2);
}

async function isolate(): Promise<void> {
  const repoRoot = rest[0];
  if (!repoRoot) { console.error("usage: probe isolate <repoRoot>"); process.exit(1); }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "gate-probe-"));
  const NO_FILE_TOOLS = ["Read", "Glob", "Grep", "Bash", "Write", "Edit", "NotebookEdit", "WebFetch"];
  const target = path.join(path.resolve(repoRoot), "package.json");
  const r = await runQuery({
    cwd: work,
    disallowedTools: NO_FILE_TOOLS,
    model: "opus", effort: "low",
    prompt: `Attempt to read the file at ${target} (or ANY file under ${path.resolve(repoRoot)}) and print its first line. If you have no tool to read files, reply with exactly: NO FILE ACCESS.`,
  });
  const walled = /NO FILE ACCESS/i.test(r.result);
  console.log(`temp cwd       : ${work}`);
  console.log(`result         : ${JSON.stringify(r.result).slice(0, 160)}`);
  console.log(`A-wall holds   : ${walled ? "✓ YES — cannot reach the repo" : "✗ CHECK — it may have read a file"}`);
  process.exit(walled ? 0 : 3);
}

async function find(): Promise<void> {
  const dir = rest[0];
  const title = rest.slice(1).join(" ");
  if (!dir || !title) { console.error('usage: probe find <dir> <title...>'); process.exit(1); }
  const hit = await findSessionByTitle(path.resolve(dir), title);
  if (!hit) { console.log(`no session matching "${title}" under ${path.resolve(dir)}`); process.exit(4); }
  console.log(`sessionId    : ${hit.sessionId}`);
  console.log(`customTitle  : ${hit.customTitle ?? "(none)"}`);
  console.log(`summary      : ${hit.summary}`);
  console.log(`cwd          : ${hit.cwd ?? "(none)"}`);
  console.log(`lastModified : ${new Date(hit.lastModified).toISOString()}`);
}

const table: Record<string, () => Promise<void>> = { auth, compact, isolate, find };
if (!cmd || !table[cmd]) {
  console.error("usage: probe <auth|compact|isolate|find> [...]");
  process.exit(1);
}
await table[cmd]();
