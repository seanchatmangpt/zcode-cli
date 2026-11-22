/**
 * Hands-free sJira frontier ingress + fail-closed GGEN_BIN pinning.
 * Wraps src/io/sjira-adapter.ts behind WorkOrderSourceAdapter.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";

import type { PowlNode } from "../powl-ocel-orchestrator.ts";
import {
  appendSjiraLedger,
  createSjiraIoAdapter,
  emitSjiraLedgerAndReceipt,
  emitSjiraLedgerEntry,
  ingestFrontierCmd,
  requireGgenBin,
  resolveSjiraPaths,
  sha256Json,
  sjiraEnvFromProcess,
  SjiraAdapterError,
  type SjiraAdapterEnv,
  type SjiraCandidate,
  type SjiraIoPaths,
  type SjiraLedgerEntry,
  type SjiraStanding
} from "../io/sjira-adapter.ts";
import type {
  ExitCode,
  PreflightResult,
  TransitionReceipt,
  WorkOrderSourceAdapter
} from "./types.ts";

/** Hands-free floor (fd4f99bbd…) — GGEN_BIN's checkout must descend from this when verifiable. */
export const MIN_GGEN_HANDS_FREE_ANCESTOR = "fd4f99bbd4971fb1ca5a0f3a3a2382aaba32261e";

export interface SjiraIoAdapterOptions {
  env?: SjiraAdapterEnv;
  cwd: string;
  ledgerPath?: string;
  outDir?: string;
  candidatesPath?: string;
  ggenBin?: string;
  /** When true (default), refuse if GGEN_BIN git checkout is not a descendant of minGgenAncestor. */
  enforceMinGgenAncestor?: boolean;
  minGgenAncestor?: string;
  /** Ban interactive TTY / --yes / dialoguer prompts (checked via argv inspection on spawned cmds). */
  forbidTtyPrompts?: boolean;
  /** Extra arguments passed to `ggen sjira frontier` in frontier_cmd mode. */
  frontierArgs?: string[];
  cycleId?: string;
}

export class SjiraWorkOrderSource implements WorkOrderSourceAdapter {
  readonly name = "sjira-io";
  private readonly opts: Required<
    Pick<SjiraIoAdapterOptions, "cwd" | "enforceMinGgenAncestor" | "minGgenAncestor" | "forbidTtyPrompts">
  > &
    SjiraIoAdapterOptions;
  private readonly paths: SjiraIoPaths;
  private candidates: SjiraCandidate[] = [];
  private ingestMeta: { source: "frontier_cmd" | "candidates_file"; ggenBin?: string; candidatesPath?: string } | null =
    null;
  private entries: ReturnType<typeof emitSjiraLedgerEntry>[] = [];
  private startedAt = new Date().toISOString();
  private powlRootId = "sjira-frontier";

  constructor(opts: SjiraIoAdapterOptions) {
    this.opts = {
      enforceMinGgenAncestor: true,
      minGgenAncestor: MIN_GGEN_HANDS_FREE_ANCESTOR,
      forbidTtyPrompts: true,
      ...opts
    };
    const env = opts.env ?? sjiraEnvFromProcess();
    this.paths = resolveSjiraPaths(env, {
      cwd: opts.cwd,
      ledgerPath: opts.ledgerPath,
      outDir: opts.outDir,
      candidatesPath: opts.candidatesPath,
      ggenBin: opts.ggenBin
    });
  }

  async preflightVerify(): Promise<PreflightResult> {
    try {
      if (!this.paths.candidatesPath) {
        const bin = requireGgenBin(this.paths.ggenBin);
        if (this.opts.enforceMinGgenAncestor) {
          const anc = verifyGgenHandsFreeFloor(bin, this.opts.minGgenAncestor);
          if (!anc.ok) {
            return { ok: false, exitCode: 2, detail: anc.detail };
          }
          if (anc.exitCode !== 0) {
            return { ok: anc.ok, exitCode: anc.exitCode, detail: anc.detail };
          }
        }
      }
      return { ok: true, exitCode: 0, detail: "sjira-io preflight ok" };
    } catch (e) {
      const err = e as SjiraAdapterError;
      return {
        ok: false,
        exitCode: (err.exitHint === 1 ? 1 : 2) as ExitCode,
        detail: err.message ?? String(e)
      };
    }
  }

  async ingestFrontier(): Promise<PowlNode> {
    const pre = await this.preflightVerify();
    if (!pre.ok) {
      throw new SjiraAdapterError("GGEN_NOT_FOUND", pre.detail, pre.exitCode);
    }
    const adapter = createSjiraIoAdapter(
      {
        GGEN_BIN: this.paths.ggenBin,
        SJIRA_CANDIDATES: this.paths.candidatesPath,
        SJIRA_LEDGER: this.paths.ledgerPath,
        SJIRA_OUT_DIR: this.paths.outDir
      },
      { cwd: this.paths.cwd }
    );
    const mode = this.paths.candidatesPath ? "candidates_file" : "frontier_cmd";
    let ingest: ReturnType<typeof adapter.ingestSjiraFrontier>;
    if (mode === "frontier_cmd") {
      const frontierArgs = this.opts.frontierArgs ?? [];
      const actualArgv = ["sjira", "frontier", ...frontierArgs];
      if (this.opts.forbidTtyPrompts) {
        assertNoInteractiveFrontierArgs(actualArgv);
      }
      const ggenBin = requireGgenBin(this.paths.ggenBin);
      const candidates = ingestFrontierCmd(ggenBin, this.paths.cwd, frontierArgs);
      ingest = { candidates, source: "frontier_cmd", ggenBin };
    } else {
      ingest = adapter.ingestSjiraFrontier(mode);
    }
    this.candidates = ingest.candidates;
    this.ingestMeta = {
      source: ingest.source,
      ggenBin: ingest.ggenBin,
      candidatesPath: ingest.candidatesPath
    };
    const powl = adapter.candidatesToPowl(ingest.candidates);
    this.powlRootId = powl.id;
    this.startedAt = new Date().toISOString();
    this.entries = [];
    return powl;
  }

  async recordOutcome(receipt: TransitionReceipt): Promise<void> {
    const candidate =
      this.candidates.find((c) => c.id === receipt.workOrderId) ??
      ({
        id: receipt.workOrderId,
        standing: "UNKNOWN" as SjiraStanding,
        objectType: "WorkOrder"
      } satisfies SjiraCandidate);

    const cycleId = receipt.cycleId || this.opts.cycleId || "cycle-1";
    let entry: SjiraLedgerEntry;

    if (receipt.standing === "BLOCKED" || receipt.standing === "UNSUPPORTED") {
      const standing = receipt.standing;
      const receiptBody = {
        workOrderId: candidate.id,
        outcome: standing,
        standing,
        cycleId,
        detail: receipt.detail ?? null
      };
      entry = {
        ts: new Date().toISOString(),
        cycleId,
        workOrderId: candidate.id,
        outcome: "REFUSED",
        standing,
        sha256Receipt: sha256Json(receiptBody),
        detail: receipt.detail,
        baseSha: candidate.baseSha,
        ocelSha256: receipt.ocelSha256,
        ggenBin: this.ingestMeta?.ggenBin ?? this.paths.ggenBin
      };
      appendSjiraLedger(this.paths.ledgerPath, entry);
    } else {
      const outcome =
        receipt.standing === "PARTIAL_ALIVE" || receipt.standing === "UNVERIFIED"
          ? receipt.standing
          : receipt.outcome === "ALIVE"
            ? "ALIVE"
            : receipt.outcome === "TIMED_OUT"
              ? "TIMED_OUT"
              : "REFUSED";

      entry = emitSjiraLedgerEntry({
        paths: this.paths,
        cycleId,
        candidate: { ...candidate, standing: candidate.standing ?? "UNKNOWN" },
        outcome,
        detail: receipt.detail,
        ocelSha256: receipt.ocelSha256,
        unverified: receipt.standing === "UNVERIFIED",
        sandboxPartial: receipt.standing === "PARTIAL_ALIVE",
        ggenBin: this.ingestMeta?.ggenBin ?? this.paths.ggenBin
      });
    }
    this.entries.push(entry);

    // Refresh aggregate receipt after each outcome (idempotent overwrite).
    if (this.ingestMeta) {
      emitSjiraLedgerAndReceipt({
        paths: this.paths,
        cycleId: receipt.cycleId || this.opts.cycleId || "cycle-1",
        startedAt: this.startedAt,
        ingest: {
          candidates: this.candidates,
          source: this.ingestMeta.source,
          ggenBin: this.ingestMeta.ggenBin,
          candidatesPath: this.ingestMeta.candidatesPath
        },
        powlRootId: this.powlRootId,
        entries: this.entries,
        twinParity: receipt.twinParity
      });
    }
  }
}

export function assertNoInteractiveFrontierArgs(args: readonly string[]): void {
  const banned = new Set([
    "--authority",
    "--yes",
    "-y",
    "--interactive",
    "--prompt",
    "--confirm"
  ]);
  for (const a of args) {
    if (banned.has(a) || a.startsWith("--authority=")) {
      throw new SjiraAdapterError(
        "FRONTIER_FAILED",
        `interactive/authority flag forbidden in hands-free frontier: ${a}`,
        2
      );
    }
  }
}

/**
 * When GGEN_BIN lives inside a git checkout, require minAncestor is an ancestor of HEAD.
 * If the binary is not inside a git repo, return ok with a loud-skip detail (caller may
 * treat as LOUD_SKIP / exit 3 when enforce is strict-only-when-git).
 */
export function verifyGgenHandsFreeFloor(
  ggenBin: string,
  minAncestor: string
): { ok: boolean; detail: string; exitCode: ExitCode } {
  if (!isAbsolute(ggenBin) || !existsSync(ggenBin)) {
    return { ok: false, exitCode: 2, detail: `GGEN_BIN missing: ${ggenBin}` };
  }
  // Walk up looking for .git
  let dir = dirname(ggenBin);
  let gitRoot: string | undefined;
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(`${dir}/.git`)) {
      gitRoot = dir;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (!gitRoot) {
    return {
      ok: true,
      exitCode: 3,
      detail: `GGEN_BIN not inside a git checkout; skipped ancestor check for ${minAncestor}`
    };
  }
  const r = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", minAncestor, "HEAD"],
    { cwd: gitRoot, encoding: "utf8" }
  );
  if (r.status === 0) {
    return { ok: true, exitCode: 0, detail: `GGEN_BIN descends from ${minAncestor}` };
  }
  return {
    ok: false,
    exitCode: 2,
    detail: `GGEN_BIN at ${gitRoot} does not descend from hands-free floor ${minAncestor}`
  };
}
