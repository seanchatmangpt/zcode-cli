/**
 * Compiler-first & ggen_igniter clean-room gate.
 * Upstream-only write scope + ephemeral regeneration + purity guards.
 *
 * Jobs/C4 drift gate: `mix ggen_igniter.sync --check` (exit 0/4) OR
 * `ggen sync run --dry-run` with `planned_writes: []` — never
 * `git diff --exit-code` as refuse (optional `gitDiffDiagnostic` only).
 * LOUD_SKIP when `requireSyncCheck: false` or noop `["true"]` stub.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { minimatch } from "./minimatch-lite.ts";

import type { CourtVerdict, ExitCode, TransitionCourtAdapter } from "./types.ts";
import { standingFromExit } from "./types.ts";
import {
  DEFAULT_CLEAN_ROOM_CHECK_CMD,
  IGNITER_CHECK_DRIFT_EXIT,
  collectGitDiffDiagnostic,
  evaluateCleanRoomDrift,
  isGgenDryRunCmd,
  isGitSyncCmd,
  isIgniterCheckCmd,
  isNoopCleanRoomCmd
} from "./clean-room-drift.ts";

export {
  DEFAULT_CLEAN_ROOM_CHECK_CMD,
  IGNITER_CHECK_DRIFT_EXIT,
  evaluateCleanRoomDrift,
  collectGitDiffDiagnostic,
  isGitSyncCmd
} from "./clean-room-drift.ts";

export const DEFAULT_ALLOWED_MUTATION_GLOBS = [
  "ontology/**/*.ttl",
  "queries/**/*.rq",
  "templates/**/*.eex",
  "templates/**/*.tera",
  "**/*.ttl",
  "**/*.rq",
  "**/*.eex",
  "**/*.tera"
];

export const DEFAULT_FORBID_DOMAIN_WALL_CLOCK = [
  "DateTime.utc_now",
  "NaiveDateTime.utc_now",
  "Date.utc_today",
  "Time.utc_now",
  "System.os_time",
  "System.system_time",
  "System.monotonic_time",
  ":os.system_time",
  ":erlang.system_time",
  "SystemTime::now",
  "Instant::now",
  "chrono::Utc::now",
  "Date.now(",
  "new Date()",
  "performance.now("
];

/** @deprecated Prefer DEFAULT_CLEAN_ROOM_CHECK_CMD from clean-room-drift.ts */
export const DEFAULT_IGNITER_SYNC_CHECK_CMD = DEFAULT_CLEAN_ROOM_CHECK_CMD;

/** @deprecated Prefer IGNITER_CHECK_DRIFT_EXIT from clean-room-drift.ts */
export const IGNITER_SYNC_CHECK_DRIFT_EXIT = IGNITER_CHECK_DRIFT_EXIT;

export interface IgniterSyncOptions {
  allowedMutationGlobs?: string[];
  /**
   * Jobs/C4 drift-gate argv. Default: `mix ggen_igniter.sync --check`.
   * Alternate: `ggen sync run --dry-run` (require `planned_writes: []`).
   * Noop `["true"]` → LOUD_SKIP (never fake ALIVE).
   */
  cleanRoomSyncCmd?: string[];
  /**
   * When false, verifyPostTransition LOUD_SKIPs (exit 3) instead of running
   * the Jobs/C4 check. Default true.
   */
  requireSyncCheck?: boolean;
  /** Attach non-gating git-diff diagnostics after Jobs/C4 check (default false). */
  gitDiffDiagnostic?: boolean;
  forbidGeneratedDirs?: boolean;
  forbidDomainWallClock?: string[];
  /** Paths (relative) to rm -rf before sync (generated trees). */
  generatedTrees?: string[];
  /** Pathspecs for optional git-diff diagnostic only. */
  gitDiffPaths?: string[];
  run?: (cmd: string[], cwd: string) => { status: number | null; stdout: string; stderr: string };
}

export class IgniterSyncCourtAdapter implements TransitionCourtAdapter {
  readonly name = "ggen-igniter";
  private readonly opts: Required<
    Pick<
      IgniterSyncOptions,
      | "allowedMutationGlobs"
      | "cleanRoomSyncCmd"
      | "requireSyncCheck"
      | "gitDiffDiagnostic"
      | "forbidGeneratedDirs"
      | "forbidDomainWallClock"
    >
  > &
    IgniterSyncOptions;

  constructor(opts: IgniterSyncOptions = {}) {
    const requireSyncCheck = opts.requireSyncCheck !== false;
    const gitDiffDiagnostic = opts.gitDiffDiagnostic === true;
    this.opts = {
      allowedMutationGlobs: DEFAULT_ALLOWED_MUTATION_GLOBS,
      cleanRoomSyncCmd: [...DEFAULT_CLEAN_ROOM_CHECK_CMD],
      forbidGeneratedDirs: true,
      forbidDomainWallClock: DEFAULT_FORBID_DOMAIN_WALL_CLOCK,
      generatedTrees: [],
      gitDiffPaths: ["."],
      ...opts,
      requireSyncCheck,
      gitDiffDiagnostic
    };
  }

  async validateWriteScope(files: string[]): Promise<ExitCode> {
    for (const f of files) {
      const norm = f.replace(/\\/g, "/").replace(/^\.\//, "");
      if (/generated\//i.test(norm) || /_generated\./i.test(norm)) {
        return 1;
      }
      if (/^lib\/fnox_/i.test(norm) || /^test\/fnox_/i.test(norm)) {
        return 1;
      }
      const allowed = this.opts.allowedMutationGlobs.some((g) => minimatch(norm, g));
      if (!allowed) {
        // Readonly probes may touch other paths; mutating court only admits allowlisted globs.
        return 1;
      }
    }
    return 0;
  }

  async verifyPostTransition(workspaceDir: string): Promise<CourtVerdict> {
    const diagnostics: string[] = [];
    const digests: Record<string, string> = {};
    const run =
      this.opts.run ??
      ((cmd, cwd) => {
        const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd, encoding: "utf8", env: process.env, shell: false });
        return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
      });

    if (!this.opts.requireSyncCheck) {
      return {
        exitCode: 3,
        standing: standingFromExit(3),
        diagnostics: [
          "igniter sync --check skipped — LOUD_SKIP (requireSyncCheck=false; not a git-diff gate)"
        ],
        artifactDigests: digests
      };
    }

    for (const tree of this.opts.generatedTrees ?? []) {
      const rm = run(["rm", "-rf", tree], workspaceDir);
      if (rm.status !== 0) {
        diagnostics.push(`failed to rm -rf ${tree}`);
        return { exitCode: 1, standing: "REFUSED", diagnostics, artifactDigests: digests };
      }
    }

    const syncCmd = this.opts.cleanRoomSyncCmd;
    // Refuse git*, noop stubs, and unadmitted non-igniter commands before spawn.
    if (
      isGitSyncCmd(syncCmd) ||
      isNoopCleanRoomCmd(syncCmd) ||
      (!isIgniterCheckCmd(syncCmd) && !isGgenDryRunCmd(syncCmd))
    ) {
      const drift = evaluateCleanRoomDrift(syncCmd, { status: 0, stdout: "", stderr: "" });
      diagnostics.push(...drift.diagnostics);
      digests["igniter_sync_check"] = isGitSyncCmd(syncCmd)
        ? "refused:git*"
        : isNoopCleanRoomCmd(syncCmd)
          ? "loud_skip:noop"
          : "refused:unadmitted";
      return {
        exitCode: drift.exitCode,
        standing: standingFromExit(drift.exitCode),
        diagnostics,
        artifactDigests: digests
      };
    }
    const sync = run(syncCmd, workspaceDir);
    digests["igniter_sync_check"] = `${sync.status}`;
    const drift = evaluateCleanRoomDrift(syncCmd, sync);
    diagnostics.push(...drift.diagnostics);
    if (drift.kind !== "pass") {
      return {
        exitCode: drift.exitCode,
        standing: standingFromExit(drift.exitCode),
        diagnostics,
        artifactDigests: digests
      };
    }

    if (this.opts.gitDiffDiagnostic) {
      diagnostics.push(
        ...collectGitDiffDiagnostic(run, workspaceDir, this.opts.gitDiffPaths ?? ["."])
      );
    }

    if (this.opts.forbidGeneratedDirs) {
      const found = findGeneratedDirs(workspaceDir);
      if (found.length > 0) {
        diagnostics.push(`forbid_generated_dirs: found ${found.slice(0, 10).join(", ")}`);
        return { exitCode: 1, standing: "REFUSED", diagnostics, artifactDigests: digests };
      }
    }

    const clockHits = findDomainWallClock(workspaceDir, this.opts.forbidDomainWallClock);
    if (clockHits.length > 0) {
      diagnostics.push(
        `domain wall-clock forbidden (inject :now instead): ${clockHits.slice(0, 10).join(", ")}`
      );
      return { exitCode: 1, standing: "REFUSED", diagnostics, artifactDigests: digests };
    }

    return { exitCode: 0, standing: "ALIVE", diagnostics, artifactDigests: digests };
  }
}

export function findGeneratedDirs(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === ".git" || name === "node_modules" || name === "vendor") continue;
      const p = join(dir, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      if (name.toLowerCase() === "generated") out.push(relative(root, p) || name);
      else walk(p);
    }
  };
  walk(root);
  return out;
}

export function findDomainWallClock(root: string, needles: string[]): string[] {
  const hits: string[] = [];
  const domainRoots = ["lib", "src"].map((d) => join(root, d)).filter(existsSync);
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (name.toLowerCase() === "generated") continue;
        walk(p);
      } else if (/\.(ex|exs|rs|ts|tsx|js|jsx|mjs|cjs)$/i.test(name)) {
        const text = readFileSync(p, "utf8");
        for (const n of needles) {
          if (text.includes(n)) hits.push(`${relative(root, p)}:${n}`);
        }
      }
    }
  };
  for (const d of domainRoots) walk(d);
  return hits;
}
