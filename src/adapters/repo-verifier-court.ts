/**
 * Repo-native verification court for HITL-free codebase finishing.
 *
 * Auto-detects (or accepts explicit) build/test commands for Elixir/Mix,
 * Rust/Cargo, or Bun/Node repositories and enforces fail-closed post-transition
 * verification with SHA-256 output digests.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { CourtVerdict, ExitCode, TransitionCourtAdapter } from "./types.ts";

export interface RepoVerifierCourtOptions {
  /** Explicit list of commands to run sequentially (overrides auto-detection). */
  commands?: string[][];
  /** Optional custom runner for deterministic testing. */
  run?: (cmd: string[], cwd: string) => { status: number | null; stdout: string; stderr: string };
  /** Optional per-command timeout in ms (default 300_000). */
  timeoutMs?: number;
}

export function detectRepoVerifyCommands(workspaceDir: string): string[][] {
  if (existsSync(join(workspaceDir, "mix.exs"))) {
    return [
      ["mix", "compile", "--warnings-as-errors"],
      ["mix", "test"]
    ];
  }
  if (existsSync(join(workspaceDir, "Cargo.toml"))) {
    return [["cargo", "test"]];
  }
  const pkgPath = join(workspaceDir, "package.json");
  if (existsSync(pkgPath)) {
    const cmds: string[][] = [];
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        scripts?: Record<string, string>;
      };
      if (pkg.scripts?.typecheck) cmds.push(["bun", "run", "typecheck"]);
      if (pkg.scripts?.test) cmds.push(["bun", "test"]);
    } catch {
      // Fallback to bun test if package.json is unreadable
    }
    if (cmds.length > 0) return cmds;
    return [["bun", "test"]];
  }
  return [];
}

export class RepoVerifierCourtAdapter implements TransitionCourtAdapter {
  readonly name = "repo-verifier";
  private readonly opts: RepoVerifierCourtOptions;

  constructor(opts: RepoVerifierCourtOptions = {}) {
    this.opts = opts;
  }

  async validateWriteScope(_files: string[]): Promise<ExitCode> {
    // RepoVerifierCourt judges post-transition build/test truth, not write globs.
    return 0;
  }

  async verifyPostTransition(workspaceDir: string): Promise<CourtVerdict> {
    const commands =
      this.opts.commands && this.opts.commands.length > 0
        ? this.opts.commands
        : detectRepoVerifyCommands(workspaceDir);

    if (commands.length === 0) {
      return {
        exitCode: 2,
        standing: "BLOCKED",
        diagnostics: [
          `repo-verifier: no build/test command detected in ${workspaceDir} (pass --verify-cmd)`
        ],
        artifactDigests: {}
      };
    }

    const run =
      this.opts.run ??
      ((cmd, cwd) => {
        const r = spawnSync(cmd[0]!, cmd.slice(1), {
          cwd,
          encoding: "utf8",
          env: process.env,
          shell: false,
          timeout: this.opts.timeoutMs ?? 300_000
        });
        return {
          status: r.status,
          stdout: r.stdout || "",
          stderr: r.stderr || ""
        };
      });

    const diagnostics: string[] = [];
    const artifactDigests: Record<string, string> = {};

    for (let i = 0; i < commands.length; i += 1) {
      const cmd = commands[i]!;
      const label = cmd.join(" ");
      const res = run(cmd, workspaceDir);
      const combined = `${res.stdout}\n${res.stderr}`;
      artifactDigests[`verify_${i}_${cmd[0]}`] = createHash("sha256")
        .update(combined)
        .digest("hex");

      if (res.status !== 0) {
        const tail = (res.stderr.trim() || res.stdout.trim() || `exit ${res.status}`).slice(-600);
        diagnostics.push(`repo-verifier failed (${label}, exit ${res.status}): ${tail}`);
        return {
          exitCode: 1,
          standing: "REFUSED",
          diagnostics,
          artifactDigests
        };
      }
    }

    return {
      exitCode: 0,
      standing: "ALIVE",
      diagnostics,
      artifactDigests
    };
  }
}
