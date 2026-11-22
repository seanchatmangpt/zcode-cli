/**
 * Jobs/C4 clean-room drift gate — replaces the git-diff clean-room fallacy.
 *
 * Law (docs/c4-sovereign-ecosystem.md + JOBS-LOCK finish seal):
 *   1. Prefer `mix ggen_igniter.sync --check` → exit 0 clean, exit 4 = drift
 *   2. Secondary only: `ggen sync run --dry-run` with JSON `planned_writes: []`
 *      (dry-run EXIT=0 alone is NOT clean — must prove empty planned_writes)
 *
 * `git diff --exit-code` is an optional diagnostic only — never the refuse gate.
 * Empty `ea.graph.json` scaffolds (`ggen.ea.graph.v1`) are lawful FM-LAW-015 admits;
 * missing graphs still need `--skip-ea-admission` or a real scaffold (pack honesty).
 */

export type RunResult = { status: number | null; stdout: string; stderr: string };

/** Igniter contract: `--check` halt(4) when ontology↔generated drift exists. */
export const IGNITER_CHECK_DRIFT_EXIT = 4;

/** Default Jobs/C4 check argv (no write, no lock). */
export const DEFAULT_CLEAN_ROOM_CHECK_CMD: readonly string[] = [
  "mix",
  "ggen_igniter.sync",
  "--check"
] as const;

/** @deprecated Alias — prefer DEFAULT_CLEAN_ROOM_CHECK_CMD. */
export const DEFAULT_IGNITER_SYNC_CHECK_CMD = DEFAULT_CLEAN_ROOM_CHECK_CMD;

/** @deprecated Alias — prefer IGNITER_CHECK_DRIFT_EXIT. */
export const IGNITER_SYNC_CHECK_DRIFT_EXIT = IGNITER_CHECK_DRIFT_EXIT;

export type CleanRoomDriftKind = "pass" | "refuse" | "loud_skip" | "blocked";

export interface CleanRoomDriftVerdict {
  kind: CleanRoomDriftKind;
  /** Court exit: 0 pass, 1 refuse, 2 blocked, 3 loud-skip. */
  exitCode: 0 | 1 | 2 | 3;
  diagnostics: string[];
  /** True when the cmd was an identity stub (`true`) rather than a real check. */
  noopStub?: boolean;
}

/** Historical Chicago identity stub — not a Jobs/C4 check. */
export function isNoopCleanRoomCmd(cmd: string[] | undefined | null): boolean {
  if (!cmd || cmd.length === 0) return true;
  const bin = cmd[0]!;
  return bin === "true" || bin === "/bin/true" || bin === "/usr/bin/true";
}

/**
 * Refuse `git*` as a clean-room sync cmd (ELIMINATE-2).
 * `git diff --exit-code` is diagnostic-only via collectGitDiffDiagnostic — never the gate.
 */
export function isGitSyncCmd(cmd: string[] | undefined | null): boolean {
  if (!cmd || cmd.length === 0) return false;
  const bin = cmd[0]!;
  const base = bin.includes("/") ? bin.slice(bin.lastIndexOf("/") + 1) : bin;
  return base === "git" || base.startsWith("git");
}

export function isIgniterCheckCmd(cmd: string[]): boolean {
  if (!cmd.includes("--check")) return false;
  return cmd.some((c) => c === "mix" || c.includes("ggen_igniter"));
}

/** `ggen sync run --dry-run` (planned_writes JSON contract). */
export function isGgenDryRunCmd(cmd: string[]): boolean {
  if (cmd.length < 2) return false;
  if (cmd[0] !== "ggen") return false;
  const hasSync = cmd.includes("sync");
  const hasDry = cmd.includes("--dry-run") || cmd.includes("dry-run");
  return hasSync && hasDry;
}

/**
 * Extract `planned_writes` from ggen dry-run JSON stdout.
 * Returns `null` when the payload is unparseable / missing the key.
 */
export function parsePlannedWrites(stdout: string): unknown[] | null {
  const text = (stdout || "").trim();
  if (!text) return null;
  // Prefer a full-document parse; fall back to last JSON object on the stream.
  const candidates: string[] = [text];
  const lastBrace = text.lastIndexOf("{");
  if (lastBrace > 0) candidates.push(text.slice(lastBrace));
  for (const chunk of candidates) {
    try {
      const parsed = JSON.parse(chunk) as { planned_writes?: unknown };
      if (Array.isArray(parsed.planned_writes)) return parsed.planned_writes;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Evaluate a completed clean-room check/dry-run invocation against Jobs/C4 law.
 * Noop `true` stubs → LOUD_SKIP (never fake ALIVE).
 */
export function evaluateCleanRoomDrift(cmd: string[], result: RunResult): CleanRoomDriftVerdict {
  if (isNoopCleanRoomCmd(cmd)) {
    return {
      kind: "loud_skip",
      exitCode: 3,
      noopStub: true,
      diagnostics: [
        "clean-room LOUD_SKIP: noop sync cmd (true) is not Jobs/C4 — use mix ggen_igniter.sync --check or ggen sync run --dry-run"
      ]
    };
  }

  if (isGitSyncCmd(cmd)) {
    return {
      kind: "refuse",
      exitCode: 1,
      diagnostics: [
        `clean-room refused: git* sync cmd is the clean-room fallacy (got ${JSON.stringify(cmd)}); use mix ggen_igniter.sync --check or ggen sync run --dry-run`
      ]
    };
  }

  if (isGgenDryRunCmd(cmd)) {
    if (result.status !== 0) {
      return {
        kind: "refuse",
        exitCode: 1,
        diagnostics: [
          `ggen sync dry-run exited ${result.status}: ${(result.stderr || result.stdout).trim().slice(0, 400)}`
        ]
      };
    }
    const planned = parsePlannedWrites(result.stdout);
    if (planned === null) {
      return {
        kind: "blocked",
        exitCode: 2,
        diagnostics: [
          "clean-room SUBJECT_MISSING: ggen sync --dry-run stdout missing parseable planned_writes[]"
        ]
      };
    }
    if (planned.length > 0) {
      return {
        kind: "refuse",
        exitCode: 1,
        diagnostics: [
          `clean-room refused: ggen sync --dry-run planned_writes non-empty (${planned.length})`
        ]
      };
    }
    return {
      kind: "pass",
      exitCode: 0,
      diagnostics: ["ggen sync --dry-run: planned_writes=[] (Jobs/C4 clean)"]
    };
  }

  // Default / igniter --check path (also covers mix ggen_igniter.sync --check).
  if (result.status === 0) {
    return {
      kind: "pass",
      exitCode: 0,
      diagnostics: [
        isIgniterCheckCmd(cmd)
          ? "ggen_igniter.sync --check: clean (Jobs/C4)"
          : `clean-room check exited 0: ${(result.stdout || result.stderr).trim().slice(0, 200)}`
      ]
    };
  }
  if (result.status === IGNITER_CHECK_DRIFT_EXIT) {
    return {
      kind: "refuse",
      exitCode: 1,
      diagnostics: [
        `clean-room refused: ggen_igniter.sync --check exit ${IGNITER_CHECK_DRIFT_EXIT} (ontology↔generated drift)`,
        (result.stderr || result.stdout).trim().slice(0, 400)
      ].filter(Boolean)
    };
  }
  return {
    kind: "refuse",
    exitCode: 1,
    diagnostics: [
      `clean-room check exited ${result.status}: ${(result.stderr || result.stdout).trim().slice(0, 400)}`
    ]
  };
}

/**
 * Optional diagnostic only — never refuse. Surfaces unstaged/staged/untracked
 * hints after a Jobs/C4 check for operator triage.
 */
export function collectGitDiffDiagnostic(
  run: (cmd: string[], cwd: string) => RunResult,
  workspaceDir: string,
  paths: string[] = ["."]
): string[] {
  const out: string[] = [];
  const unstaged = run(["git", "diff", "--exit-code", "--", ...paths], workspaceDir);
  if (unstaged.status !== 0) {
    out.push("git-diff diagnostic (non-gating): unstaged changes present");
  }
  const staged = run(["git", "diff", "--cached", "--exit-code", "--", ...paths], workspaceDir);
  if (staged.status !== 0) {
    out.push("git-diff diagnostic (non-gating): staged changes present");
  }
  const untracked = run(
    ["git", "ls-files", "--others", "--exclude-standard", "--", ...paths],
    workspaceDir
  );
  if (untracked.status !== 0 || (untracked.stdout || "").trim().length > 0) {
    out.push("git-diff diagnostic (non-gating): untracked files present");
  }
  return out;
}
