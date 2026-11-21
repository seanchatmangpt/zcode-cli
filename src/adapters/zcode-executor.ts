/**
 * Live ZCode headless agent executor for the Gall's Law foundry loop.
 *
 * Spawns `bin/zcode.js --cwd <workspaceDir> -p <prompt> --mode yolo --max-turns <N>`
 * with non-interactive stdin (`ignore`), `ZCODE_OCEL=1` telemetry tap, per-transition
 * log files, and Kingman/AIMD transport backpressure detection.
 */

import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ExecutionOutcome, Transition } from "../powl-ocel-orchestrator.ts";

export interface ZcodeExecutorOptions {
  workspaceDir: string;
  /** Path to zcode launcher script (defaults to repo's bin/zcode.js or bin/zcode.ts). */
  zcodeBin?: string;
  /** Runtime executable (defaults to "node" for .js or "bun" for .ts). */
  runtimeBin?: string;
  /** Max agent turns per transition (default 12). */
  maxTurns?: number;
  /** Directory to write per-transition logs. */
  logDir?: string;
  /** Extra context appended to every transition prompt (e.g., verify commands). */
  repoInstructions?: string;
  /** Optional map of transitionId -> prior court diagnostics for remediation cycles. */
  priorDiagnostics?: Map<string, string>;
  /** Extra environment variables passed to the spawned agent. */
  env?: Record<string, string | undefined>;
}

const TRANSPORT_BACKPRESSURE_RE =
  /UND_ERR_CONNECT_TIMEOUT|ECONNRESET|ETIMEDOUT|\b429\b|\b503\b|rate.?limit/i;

export function resolveDefaultZcodeBin(): { runtimeBin: string; scriptPath: string } {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "../..");
  const jsBin = join(repoRoot, "bin", "zcode.js");
  if (existsSync(jsBin)) {
    return { runtimeBin: "node", scriptPath: jsBin };
  }
  const tsBin = join(repoRoot, "bin", "zcode.ts");
  return { runtimeBin: "bun", scriptPath: tsBin };
}

export function buildTransitionPrompt(
  t: Transition,
  opts: Pick<ZcodeExecutorOptions, "workspaceDir" | "repoInstructions" | "priorDiagnostics">
): string {
  const lines: string[] = [
    `Autonomous HITL-free foundry transition: ${t.activityId ?? t.id}`,
    `Label: ${t.label}`,
    `Workspace: ${opts.workspaceDir}`
  ];
  if (t.targetFile) {
    lines.push(`Target file: ${t.targetFile}`);
  }
  if (opts.repoInstructions) {
    lines.push(`Repository verification contract: ${opts.repoInstructions}`);
  }
  const prior = opts.priorDiagnostics?.get(t.activityId ?? t.id) ?? opts.priorDiagnostics?.get(t.id);
  if (prior) {
    lines.push(`Prior court refusal diagnostics (fix these exact failures):\n${prior}`);
  }
  lines.push(
    "Complete this work order cleanly in the workspace. Do not ask interactive questions. " +
      "Run the relevant verification commands before finishing."
  );
  return lines.join("\n");
}

export function createZcodeAgentExecutor(
  opts: ZcodeExecutorOptions
): (t: Transition) => Promise<ExecutionOutcome> {
  const resolved = resolveDefaultZcodeBin();
  const scriptPath = opts.zcodeBin ?? resolved.scriptPath;
  const runtimeBin =
    opts.runtimeBin ?? (scriptPath.endsWith(".ts") ? "bun" : resolved.runtimeBin);
  const maxTurns = opts.maxTurns ?? 12;

  if (opts.logDir) {
    mkdirSync(opts.logDir, { recursive: true });
  }

  return async (t: Transition): Promise<ExecutionOutcome> => {
    const prompt = buildTransitionPrompt(t, opts);
    const args = [
      scriptPath,
      "--cwd",
      opts.workspaceDir,
      "-p",
      prompt,
      "--mode",
      "yolo",
      "--max-turns",
      String(maxTurns)
    ];

    const safeId = (t.activityId ?? t.id).replace(/[^a-zA-Z0-9._-]+/g, "_");
    const logStream = opts.logDir
      ? createWriteStream(join(opts.logDir, `${safeId}.log`), { flags: "a" })
      : null;

    return await new Promise<ExecutionOutcome>((resolveOutcome) => {
      const child = spawn(runtimeBin, args, {
        cwd: opts.workspaceDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          ZCODE_OCEL: "1",
          ...(opts.env ?? {})
        }
      });

      let stderr = "";
      let stdout = "";

      child.stdout.on("data", (chunk) => {
        const text = String(chunk);
        stdout += text;
        logStream?.write(text);
      });
      child.stderr.on("data", (chunk) => {
        const text = String(chunk);
        stderr += text;
        logStream?.write(text);
      });

      child.on("close", (code) => {
        logStream?.end();
        const exitCode = code ?? 1;
        const transportBackpressure = TRANSPORT_BACKPRESSURE_RE.test(stderr);
        const detail =
          exitCode === 0
            ? "zcode-agent-ok"
            : (stderr.trim() || stdout.trim() || `zcode exited ${exitCode}`).slice(-800);
        resolveOutcome({
          ok: exitCode === 0,
          exitCode,
          transportBackpressure,
          detail
        });
      });

      child.on("error", (err) => {
        logStream?.end();
        resolveOutcome({
          ok: false,
          exitCode: 2,
          transportBackpressure: false,
          detail: `spawn failed: ${err.message}`
        });
      });
    });
  };
}
