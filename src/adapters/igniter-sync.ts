/**
 * Compiler-first & ggen_igniter clean-room gate.
 * Upstream-only write scope + ephemeral regeneration + purity guards.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { minimatch } from "./minimatch-lite.ts";

import type { CourtVerdict, ExitCode, TransitionCourtAdapter } from "./types.ts";

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

export const DEFAULT_FORBID_DOMAIN_WALL_CLOCK = ["DateTime.utc_now", "System.os_time"];

export interface IgniterSyncOptions {
  allowedMutationGlobs?: string[];
  cleanRoomSyncCmd?: string[];
  requireGitDiffZero?: boolean;
  forbidGeneratedDirs?: boolean;
  forbidDomainWallClock?: string[];
  /** Paths (relative) to rm -rf before sync (generated trees). */
  generatedTrees?: string[];
  /**
   * Paths passed to `git diff --exit-code` after sync. Defaults exclude upstream
   * ontology/query/template mutations (Gall: agents edit sources; sync must not
   * leave generated drift).
   */
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
      | "requireGitDiffZero"
      | "forbidGeneratedDirs"
      | "forbidDomainWallClock"
    >
  > &
    IgniterSyncOptions;

  constructor(opts: IgniterSyncOptions = {}) {
    this.opts = {
      allowedMutationGlobs: DEFAULT_ALLOWED_MUTATION_GLOBS,
      cleanRoomSyncCmd: ["mix", "ggen_igniter.sync", "--yes"],
      requireGitDiffZero: true,
      forbidGeneratedDirs: true,
      forbidDomainWallClock: DEFAULT_FORBID_DOMAIN_WALL_CLOCK,
      generatedTrees: [],
      // Pathspecs: ignore upstream sources; catch generated drift only.
      gitDiffPaths: [":(exclude)ontology", ":(exclude)queries", ":(exclude)templates", "."],
      ...opts
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

    for (const tree of this.opts.generatedTrees ?? []) {
      const rm = run(["rm", "-rf", tree], workspaceDir);
      if (rm.status !== 0) {
        diagnostics.push(`failed to rm -rf ${tree}`);
        return { exitCode: 1, standing: "REFUSED", diagnostics, artifactDigests: digests };
      }
    }

    const sync = run(this.opts.cleanRoomSyncCmd, workspaceDir);
    if (sync.status !== 0) {
      diagnostics.push(
        `igniter sync exited ${sync.status}: ${(sync.stderr || sync.stdout).trim().slice(0, 500)}`
      );
      return { exitCode: 1, standing: "REFUSED", diagnostics, artifactDigests: digests };
    }

    if (this.opts.requireGitDiffZero) {
      const diffCmd = ["git", "diff", "--exit-code", "--", ...(this.opts.gitDiffPaths ?? ["."])];
      const diff = run(diffCmd, workspaceDir);
      if (diff.status !== 0) {
        diagnostics.push("igniter clean-room refused: git diff --exit-code != 0 after sync (generated drift)");
        return { exitCode: 1, standing: "REFUSED", diagnostics, artifactDigests: digests };
      }
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

function findGeneratedDirs(root: string): string[] {
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
      if (name === "generated") out.push(relative(root, p) || "generated");
      else walk(p);
    }
  };
  walk(root);
  return out;
}

function findDomainWallClock(root: string, needles: string[]): string[] {
  const hits: string[] = [];
  const domainRoots = ["lib", "src"].map((d) => join(root, d)).filter(existsSync);
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (name === "generated") continue;
        walk(p);
      } else if (/\.(ex|exs|rs)$/.test(name) && !/_generated\./.test(name)) {
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
