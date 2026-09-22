#!/usr/bin/env node
// Live proof driver: spawn `zcode app-server` over stdio (env ZCODE_MAX_TURNS=<n>), create a session,
// send a tool-heavy prompt, capture every protocol line to <out.jsonl>, stop when the turn ends.
// usage: node scripts/max-turns-live.mjs <maxTurns> <out.jsonl> [cwd]
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [maxTurns, out, cwdArg] = process.argv.slice(2);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cwd = cwdArg ?? root;
const sink = createWriteStream(out);
const child = spawn(process.execPath, [join(root, "bin/zcode.js"), "app-server"], {
  cwd, env: { ...process.env, ZCODE_MAX_TURNS: maxTurns }, stdio: ["pipe", "pipe", "inherit"]
});
let sent = false; let buf = ""; let sessionId; let nextId = 1; const pending = new Map();
const send = (method, params) => new Promise((res) => { const id = nextId++; pending.set(id, res); child.stdin.write(JSON.stringify({ id, method, params }) + "\n"); });
const done = new Promise((res) => setTimeout(() => res("timeout"), 120000));
let finish;
const ended = new Promise((r) => { finish = r; });
child.stdout.on("data", (d) => {
  buf += d; let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    sink.write(line + "\n");
    try {
      const m = JSON.parse(line);
      if (m.id !== undefined && m.method) { child.stdin.write(JSON.stringify({ id: m.id, result: m.method === "session/requestRuntimePreferences" ? { nativeSearchEnhancementsEnabled: true, memoryEnabled: false } : {} }) + "\n"); continue; }
      if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      if (sessionId && sent && /error_max_turns|"status":"idle"|turn\.completed|turn\.failed/.test(line)) finish("turn-ended");
    } catch {}
  }
});
const created = await send("session/create", { workspace: { workspacePath: cwd, workspaceKey: cwd }, mode: "yolo" });
sessionId = created.result?.sessionId ?? created.result?.session?.sessionId;
if (!sessionId) { console.error("no session", JSON.stringify(created)); child.kill(); process.exit(1); }
await send("session/subscribe", { sessionId, deliveryKind: "desktop-continuous", includeSnapshot: false }).catch(() => {});
const sentP = send("session/send", { sessionId, content: "Use the Bash tool to run 'ls', then use a tool to read package.json, then Bash 'pwd', then read README.md with a tool. One tool call per step, then summarize." });
sent = true; const sentR = await sentP; sink.write(JSON.stringify({ driver: "send-result", result: sentR }) + "\n");
console.log(await Promise.race([ended, done]));
setTimeout(() => { child.kill(); sink.end(); }, 3000);
