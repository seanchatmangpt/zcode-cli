/**
 * Clean-room I/O & court plugin seam for zcode-cli v26.11.20.
 *
 * Core orchestrator stays domain-agnostic (PowlNode + TransitionExecutor only).
 * Ecosystem rules (sjira / marketplace / igniter / castle) live behind these
 * adapters as transition pre/post conditions. Authority ceiling is CONSTRUCT —
 * protected DO never lives in zcode-cli.
 *
 * See docs/sjira/v26.11.20/ard/ZCODE-CLI-SPEC-26.11.20.md Appendix E.
 */

import type { PowlNode } from "../powl-ocel-orchestrator.ts";

/** Machine exit taxonomy (Explore + Exploit). */
export type ExitCode = 0 | 1 | 2 | 3; // PASS | FAIL_REFUSED | SUBJECT_MISSING | LOUD_SKIP

/** Honest standing — never narrate sandbox/missing-seal as live ALIVE. */
export type Standing =
  | "ALIVE"
  | "PARTIAL_ALIVE"
  | "REFUSED"
  | "BLOCKED"
  | "UNVERIFIED"
  | "TIMED_OUT"
  | "UNKNOWN"
  | "UNSUPPORTED";

/** Hard authority ceiling for the zcode-cli engine. */
export type AuthorityCeiling = "OBSERVE" | "SELECT" | "CONSTRUCT";

export interface PreflightResult {
  ok: boolean;
  exitCode: ExitCode;
  detail: string;
}

export interface TransitionReceipt {
  cycleId: string;
  workOrderId: string;
  outcome: Standing;
  standing: Standing;
  sha256Receipt: string;
  detail?: string;
  baseSha?: string;
  ocelSha256?: string;
  artifactDigests?: Record<string, string>;
  twinParity?: Record<string, string>;
}

export interface CourtVerdict {
  exitCode: ExitCode;
  standing: Standing;
  diagnostics: string[];
  artifactDigests: Record<string, string>;
}

/**
 * Work-order source: ingress frontier → POWL, egress ledger/receipt.
 * Implemented by adapters/sjira-io.ts (and future sources).
 */
export interface WorkOrderSourceAdapter {
  readonly name: string;
  preflightVerify(): Promise<PreflightResult>;
  /** Compiles SJIRA_CANDIDATES / `ggen sjira frontier` → PartialOrder(V, ≺). */
  ingestFrontier(): Promise<PowlNode>;
  /** Appends SJIRA_LEDGER + loop_receipt.json (honest standing). */
  recordOutcome(receipt: TransitionReceipt): Promise<void>;
}

/**
 * Transition court: write-scope pre-condition + post-transition verification.
 * Implemented by marketplace-court, igniter-sync, castle-publish.
 */
export interface TransitionCourtAdapter {
  readonly name: string;
  validateWriteScope(files: string[]): Promise<ExitCode>;
  verifyPostTransition(workspaceDir: string): Promise<CourtVerdict>;
}

export interface AdapterRegistry {
  sources: WorkOrderSourceAdapter[];
  courts: TransitionCourtAdapter[];
}

export function worstExitCode(codes: readonly ExitCode[]): ExitCode {
  if (codes.includes(1)) return 1;
  if (codes.includes(2)) return 2;
  if (codes.includes(3)) return 3;
  return 0;
}

/** Map court/source failures into honest standing (anti-fake-ALIVE). */
export function standingFromExit(
  exitCode: ExitCode,
  opts: { sandbox?: boolean; unverified?: boolean; blocked?: boolean } = {}
): Standing {
  if (opts.blocked) return "BLOCKED";
  if (exitCode === 1) return "REFUSED";
  if (exitCode === 2) return "BLOCKED";
  if (exitCode === 3) return "UNVERIFIED";
  if (opts.unverified) return "UNVERIFIED";
  if (opts.sandbox) return "PARTIAL_ALIVE";
  return "ALIVE";
}
