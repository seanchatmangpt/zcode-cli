/**
 * Gall's Law autonomic foundry loop — the *simple system that works*.
 *
 * John Gall (1975): a complex system that works evolved from a simple system
 * that worked. Sovereign Ecosystem planes (CASTLE / FFB / RAID / foundry /
 * RevOps) MUST compose this loop; they must not replace it with a greenfield
 * redesign of the core orchestrator.
 *
 * Loop (CONSTRUCT only):
 *   1. WorkOrderSource.ingestFrontier() → POWL PartialOrder
 *   2. For each activity: courts.validateWriteScope → executor → courts.verify
 *   3. ReceiptSink / source.recordOutcome (honest standing)
 *   4. Optional deriveFollowUpPowl when remediation needed
 *
 * See ARD Appendix F.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  compilePowlToWorkflowNet,
  deriveFollowUpPowl,
  executePowlWithTokenReplay,
  validatePowlTree,
  type ExecutionOutcome,
  type OcelPowlRunResult,
  type PowlNode,
  type Transition
} from "../powl-ocel-orchestrator.ts";
import type {
  ExitCode,
  Standing,
  TransitionCourtAdapter,
  TransitionReceipt,
  WorkOrderSourceAdapter
} from "./types.ts";
import { composeCourtExits, ReceiptSink, type CycleCloseResult } from "./receipt-sink.ts";
import { standingFromExit, worstExitCode } from "./types.ts";

export interface FoundryLoopOptions {
  source: WorkOrderSourceAdapter;
  courts: TransitionCourtAdapter[];
  /** Optional receipt sink for dual ledger/DFCM; source.recordOutcome still called. */
  sink?: ReceiptSink;
  workspaceDir: string;
  cycleId?: string;
  /** Sandbox / missing DO seals → never ALIVE. */
  sandbox?: boolean;
  blocked?: boolean;
  unverified?: boolean;
  maxCycles?: number;
  /** Dry-run: skip agent subprocess; still run courts + receipts. */
  dryRun?: boolean;
  /**
   * Transition executor. Dry-run default writes a tiny ontology touch file and
   * returns ok. Live callers inject bin/zcode.js runners.
   */
  executor?: (t: Transition) => Promise<ExecutionOutcome>;
  outputDir?: string;
}

export interface FoundryLoopResult {
  cycles: OcelPowlRunResult[];
  close: CycleCloseResult | null;
  aggregateStanding: Standing;
  exitCode: ExitCode;
  powlRootId: string;
}

/**
 * Run one autonomic foundry cycle (or bounded multi-cycle) over adapter courts.
 * This is the Gall spine: keep it small, tested, and honest.
 */
export async function runFoundryLoop(opts: FoundryLoopOptions): Promise<FoundryLoopResult> {
  const cycleId = opts.cycleId ?? `foundry-${Date.now()}`;
  const startedAt = new Date().toISOString();
  const pre = await opts.source.preflightVerify();
  if (!pre.ok) {
    const standing = standingFromExit(pre.exitCode, {
      blocked: opts.blocked || pre.exitCode === 2,
      sandbox: opts.sandbox,
      unverified: opts.unverified
    });
    return {
      cycles: [],
      close: null,
      aggregateStanding: standing,
      exitCode: pre.exitCode,
      powlRootId: "preflight-refused"
    };
  }

  let current: PowlNode = await opts.source.ingestFrontier();
  validatePowlTree(current);
  const cycles: OcelPowlRunResult[] = [];
  const receipts: TransitionReceipt[] = [];
  const maxCycles = opts.maxCycles ?? 1;

  const defaultExecutor = async (t: Transition): Promise<ExecutionOutcome> => {
    if (opts.dryRun) {
      // Gall spine: mutating touch stays inside allowlisted ontology path when present.
      // Write-scope is enforced by the outer court wrapper *before* this mutates.
      const rel = `ontology/${t.activityId ?? t.id}.ttl`;
      mkdirSync(join(opts.workspaceDir, "ontology"), { recursive: true });
      writeFileSync(
        join(opts.workspaceDir, rel),
        `# UNSUPPORTED(generator-capability): handwritten\n# dry-run touch for ${t.id}\n`
      );
      return { ok: true, exitCode: 0, detail: "dry-run" };
    }
    return { ok: false, exitCode: 2, detail: "live executor not configured (SUBJECT_MISSING)" };
  };

  const executor = opts.executor ?? defaultExecutor;

  for (let c = 1; c <= maxCycles; c += 1) {
    const run = await executePowlWithTokenReplay(current, async (t) => {
      // Pre: validateWriteScope before any executor mutation (EU AI Act human oversight / fail-closed).
      const planned = plannedWriteRel(t, opts);
      if (!planned) {
        return {
          ok: false,
          exitCode: 2,
          detail: "write-scope refused: transition missing targetFile (SUBJECT_MISSING)"
        };
      }
      const scope = await runWriteScope(opts.courts, [planned]);
      if (scope !== 0) {
        return { ok: false, exitCode: scope, detail: `write-scope refused (${scope})` };
      }

      const res = await executor(t);
      // Post-transition courts (marketplace / igniter / castle)
      if (res.ok) {
        const verdicts = [];
        for (const court of opts.courts) {
          verdicts.push(await court.verifyPostTransition(opts.workspaceDir));
        }
        const exit = composeCourtExits(verdicts.map((v) => v.exitCode));
        if (exit !== 0) {
          const detail = verdicts.flatMap((v) => v.diagnostics).join("; ");
          return { ok: false, exitCode: exit, detail: detail || `court exit ${exit}` };
        }
      }
      return res;
    }, { outputDir: opts.outputDir ? join(opts.outputDir, `cycle-${c}`) : undefined });

    cycles.push(run);

    // Emit per-artifact receipts from OCEL standing
    for (const obj of run.ocel.objects.filter((o) => o.type !== "Workflow")) {
      const last = obj.attributes.at(-1)?.value ?? "UNKNOWN";
      let standing: Standing =
        last === "ALIVE" ? "ALIVE" : last === "REFUSED" ? "REFUSED" : "UNKNOWN";
      if (opts.sandbox && standing === "ALIVE") standing = "PARTIAL_ALIVE";
      if (opts.unverified && standing === "ALIVE") standing = "UNVERIFIED";
      if (opts.blocked) standing = "BLOCKED";

      const receipt: TransitionReceipt = {
        cycleId: `${cycleId}-c${c}`,
        workOrderId: obj.id.replace(/^art:/, ""),
        outcome: standing,
        standing,
        sha256Receipt: createHash("sha256").update(`${obj.id}:${last}:${run.ocelSha256}`).digest("hex"),
        ocelSha256: run.ocelSha256,
        detail: last
      };
      receipts.push(receipt);
      await opts.source.recordOutcome(receipt);
    }

    if (c < maxCycles) {
      current = deriveFollowUpPowl(run, c + 1);
      validatePowlTree(current);
    }
  }

  let close: CycleCloseResult | null = null;
  let aggregateStanding: Standing = "UNKNOWN";
  let exitCode: ExitCode = 2;

  if (opts.sink) {
    close = opts.sink.closeCycle({
      cycleId,
      startedAt,
      receipts,
      sandbox: opts.sandbox,
      blocked: opts.blocked,
      unverified: opts.unverified,
      twinParity: { gall_spine: "foundry-loop-v1" }
    });
    aggregateStanding = close.aggregateStanding;
    exitCode = close.exitCode;
  } else if (receipts.length > 0) {
    aggregateStanding = receipts.every((r) => r.standing === "ALIVE")
      ? "ALIVE"
      : receipts.some((r) => r.standing === "REFUSED")
        ? "REFUSED"
        : receipts.some((r) => r.standing === "PARTIAL_ALIVE")
          ? "PARTIAL_ALIVE"
          : "UNVERIFIED";
    exitCode =
      aggregateStanding === "ALIVE" ? 0 : aggregateStanding === "REFUSED" ? 1 : 2;
  }

  // Net compile sanity (Gall: structural soundness of the simple system)
  compilePowlToWorkflowNet(current);

  return {
    cycles,
    close,
    aggregateStanding,
    exitCode,
    powlRootId: cycles[0]?.workflowId ?? current.id
  };
}

async function runWriteScope(courts: TransitionCourtAdapter[], files: string[]): Promise<ExitCode> {
  const codes: ExitCode[] = [];
  for (const court of courts) {
    codes.push(await court.validateWriteScope(files));
  }
  return worstExitCode(codes);
}

/**
 * Resolve the relative path the transition intends to mutate *before* execution.
 * Dry-run / default executor: ontology/<activity>.ttl. Live custom executors must
 * declare `targetFile` — missing target fails closed (SUBJECT_MISSING).
 */
function plannedWriteRel(t: Transition, opts: FoundryLoopOptions): string | null {
  if (t.targetFile) {
    return t.targetFile.replace(/\\/g, "/").replace(/^\.\//, "");
  }
  if (opts.dryRun || !opts.executor) {
    return `ontology/${t.activityId ?? t.id}.ttl`;
  }
  return null;
}
