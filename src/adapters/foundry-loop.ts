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
 *   2. For each activity: snapshot → executor → courts.verify
 *      - On court refusal: transactional rollback + SignatureRetryLimiter + remediation diagnostics
 *      - On ALIVE: optional atomic git commit on canonical branch (no worktrees, no force-push)
 *   3. ReceiptSink / source.recordOutcome (honest standing)
 *   4. Stop-court: converge early when fitness === 1.0 && soundTermination && all ALIVE;
 *      otherwise deriveFollowUpPowl up to maxCycles / retry-limiter bound.
 *
 * See ARD Appendix F.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
import {
  captureWorkspaceSnapshot,
  SignatureRetryLimiter,
  type WorkspaceSnapshotHandle
} from "../compliance/transactional-net.ts";
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
  /** Stop early once a cycle reaches fitness === 1.0 && soundTermination && all ALIVE (default true). */
  untilDrained?: boolean;
  /** Enable transactional snapshot + rollback on court refusal (default false in dry-run, true in live). */
  transactionalRollback?: boolean;
  /** Max retries for the same normalized failure signature before halting (default 2). */
  maxSameSignatureRetries?: number;
  /** Auto-commit verified ALIVE transitions on the canonical branch (default false). */
  autoCommitAlive?: boolean;
  /** Shared diagnostics map fed into live agent remediation prompts. */
  priorDiagnostics?: Map<string, string>;
  /** Dry-run: skip agent subprocess; still run courts + receipts. */
  dryRun?: boolean;
  /**
   * Transition executor. Dry-run default writes a tiny ontology touch file and
   * returns ok. Live callers inject createZcodeAgentExecutor(...).
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
  converged: boolean;
  retryBudgetExhausted: boolean;
  commitsCreated: string[];
}

/**
 * Run one autonomic foundry cycle (or bounded convergence multi-cycle) over adapter courts.
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
      powlRootId: "preflight-refused",
      converged: false,
      retryBudgetExhausted: false,
      commitsCreated: []
    };
  }

  let current: PowlNode = await opts.source.ingestFrontier();
  validatePowlTree(current);
  let lastFrontierSignature = frontierActivitySignature(current);
  const cycles: OcelPowlRunResult[] = [];
  const receipts: TransitionReceipt[] = [];
  const commitsCreated: string[] = [];
  const maxCycles = opts.maxCycles ?? 1;
  const untilDrained = opts.untilDrained ?? true;
  const useRollback = opts.transactionalRollback ?? !opts.dryRun;
  const retryLimiter = new SignatureRetryLimiter(opts.maxSameSignatureRetries ?? 2);
  const priorDiagnostics = opts.priorDiagnostics ?? new Map<string, string>();
  const knownTargetScopes = collectTargetScopes(current);
  let converged = false;
  let retryBudgetExhausted = false;
  let rollbackFault: { transitionId: string; detail: string } | null = null;

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
    for (const [k, v] of collectTargetScopes(current)) {
      knownTargetScopes.set(k, v);
    }
    const cycleBaseSha = readGitHead(opts.workspaceDir);
    const transitionBaseShas = new Map<string, string>();
    const run = await executePowlWithTokenReplay(
      current,
      async (t) => {
        if (rollbackFault) {
          return { ok: false, exitCode: 2, detail: rollbackFault.detail };
        }
        // Pre: validateWriteScope before any executor mutation (EU AI Act human oversight / fail-closed).
        const planned = plannedWriteRels(t, opts, knownTargetScopes);
        if (!planned || planned.length === 0) {
          return {
            ok: false,
            exitCode: 2,
            detail: "write-scope refused: transition missing targetFile (SUBJECT_MISSING)"
          };
        }
        const scope = await runWriteScope(opts.courts, planned);
        if (scope !== 0) {
          return { ok: false, exitCode: scope, detail: `write-scope refused (${scope})` };
        }

        const preHead = readGitHead(opts.workspaceDir) ?? cycleBaseSha;
        if (preHead) {
          transitionBaseShas.set(t.activityId ?? t.id, preHead);
          transitionBaseShas.set(t.id, preHead);
        }

        let snapshot: WorkspaceSnapshotHandle | null = null;
        if (useRollback) {
          try {
            snapshot = captureWorkspaceSnapshot(opts.workspaceDir);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const detail = `snapshot-capture failed (${t.activityId ?? t.id}): ${msg}`;
            priorDiagnostics.set(t.activityId ?? t.id, detail);
            rollbackFault = { transitionId: t.activityId ?? t.id, detail };
            return { ok: false, exitCode: 2, detail };
          }
        }

        try {
          const res = await executor(t);
          if (!res.ok) {
            if (snapshot && !res.transportBackpressure) {
              try {
                snapshot.rollback(res.detail ?? "executor_failed", t.id, true);
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                const detail = `rollback failed after executor refusal (${t.activityId ?? t.id}): ${msg}`;
                priorDiagnostics.set(t.activityId ?? t.id, detail);
                rollbackFault = { transitionId: t.activityId ?? t.id, detail };
                return { ok: false, exitCode: 2, detail };
              }
            }
            if (!res.transportBackpressure) {
              const sig = res.detail ?? `exit_${res.exitCode ?? 1}`;
              priorDiagnostics.set(t.activityId ?? t.id, res.detail ?? "executor failed");
              try {
                retryLimiter.recordFailure(sig, t.id);
              } catch {
                retryBudgetExhausted = true;
              }
            }
            return res;
          }

          // Post-transition courts (marketplace / igniter / castle / repo-verifier)
          const verdicts = [];
          for (const court of opts.courts) {
            verdicts.push(await court.verifyPostTransition(opts.workspaceDir));
          }
          const exit = composeCourtExits(verdicts.map((v) => v.exitCode));
          if (exit !== 0) {
            const detail = verdicts.flatMap((v) => v.diagnostics).join("; ") || `court exit ${exit}`;
            if (snapshot) {
              try {
                snapshot.rollback(detail, t.id, true);
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                const rbDetail = `rollback failed after court refusal (${t.activityId ?? t.id}): ${msg}`;
                priorDiagnostics.set(t.activityId ?? t.id, rbDetail);
                rollbackFault = { transitionId: t.activityId ?? t.id, detail: rbDetail };
                return { ok: false, exitCode: 2, detail: rbDetail };
              }
            }
            priorDiagnostics.set(t.activityId ?? t.id, detail);
            try {
              retryLimiter.recordFailure(detail, t.id);
            } catch {
              retryBudgetExhausted = true;
            }
            return { ok: false, exitCode: exit, detail };
          }

          // Verified ALIVE transition: optionally commit atomically on canonical branch.
          priorDiagnostics.delete(t.activityId ?? t.id);
          if (opts.autoCommitAlive && !opts.dryRun && existsSync(join(opts.workspaceDir, ".git"))) {
            const sha = commitAliveTransition(opts.workspaceDir, t);
            if (sha) commitsCreated.push(sha);
          }
          return res;
        } finally {
          snapshot?.dispose();
        }
      },
      { outputDir: opts.outputDir ? join(opts.outputDir, `cycle-${c}`) : undefined }
    );

    cycles.push(run);

    // Emit per-artifact receipts from OCEL standing
    const cycleReceipts: TransitionReceipt[] = [];
    for (const obj of run.ocel.objects.filter(
      (o) => o.type !== "Workflow" && o.type !== "workspace_snapshot"
    )) {
      const last = obj.attributes.at(-1)?.value ?? "UNKNOWN";
      let standing: Standing =
        last === "ALIVE" ? "ALIVE" : last === "REFUSED" ? "REFUSED" : "UNKNOWN";
      if (opts.sandbox && standing === "ALIVE") standing = "PARTIAL_ALIVE";
      if (opts.unverified && standing === "ALIVE") standing = "UNVERIFIED";
      if (opts.blocked) standing = "BLOCKED";

      const workOrderId = obj.id.replace(/^art:/, "");
      const baseSha =
        transitionBaseShas.get(workOrderId) ?? transitionBaseShas.get(obj.id) ?? cycleBaseSha;
      const receipt: TransitionReceipt = {
        cycleId: `${cycleId}-c${c}`,
        workOrderId,
        outcome: standing,
        standing,
        sha256Receipt: createHash("sha256").update(`${obj.id}:${last}:${run.ocelSha256}`).digest("hex"),
        ...(baseSha ? { baseSha } : {}),
        ocelSha256: run.ocelSha256,
        detail: last
      };
      receipts.push(receipt);
      cycleReceipts.push(receipt);
      await opts.source.recordOutcome(receipt);
    }

    if (rollbackFault) {
      break;
    }

    const cycleAllPassed =
      run.replay.soundTermination &&
      run.replay.fitness === 1.0 &&
      cycleReceipts.length > 0 &&
      cycleReceipts.every((r) => r.standing === "ALIVE" || (opts.sandbox && r.standing === "PARTIAL_ALIVE"));

    if (untilDrained && cycleAllPassed) {
      converged = true;
      break;
    }

    if (retryBudgetExhausted) {
      break;
    }

    if (c < maxCycles) {
      // Closed-loop recursion R_t -> O*_{t+1}: re-ingest frontier after recordOutcome
      // so persisted receipts and updated standings feed into the next cycle.
      const refreshedFrontier = await opts.source.ingestFrontier();
      validatePowlTree(refreshedFrontier);
      for (const [k, v] of collectTargetScopes(refreshedFrontier)) {
        knownTargetScopes.set(k, v);
      }
      const refreshedSignature = frontierActivitySignature(refreshedFrontier);
      if (refreshedSignature !== lastFrontierSignature) {
        current = refreshedFrontier;
        lastFrontierSignature = refreshedSignature;
      } else {
        current = propagateTargetScopes(deriveFollowUpPowl(run, c + 1), knownTargetScopes);
        validatePowlTree(current);
      }
    }
  }

  let close: CycleCloseResult | null = null;
  let aggregateStanding: Standing = "UNKNOWN";
  let exitCode: ExitCode = 2;

  // Use the final cycle's receipts when converged so remediated failures don't taint final standing.
  const finalCycleId = `${cycleId}-c${cycles.length}`;
  const effectiveReceipts = converged
    ? receipts.filter((r) => r.cycleId === finalCycleId)
    : receipts;

  if (opts.sink) {
    close = opts.sink.closeCycle({
      cycleId,
      startedAt,
      receipts: effectiveReceipts,
      sandbox: opts.sandbox,
      blocked: opts.blocked,
      unverified: opts.unverified,
      twinParity: { gall_spine: "foundry-loop-v1" }
    });
    aggregateStanding = close.aggregateStanding;
    exitCode = close.exitCode;
  } else if (effectiveReceipts.length > 0) {
    aggregateStanding = effectiveReceipts.every((r) => r.standing === "ALIVE")
      ? "ALIVE"
      : effectiveReceipts.some((r) => r.standing === "REFUSED")
        ? "REFUSED"
        : effectiveReceipts.some((r) => r.standing === "PARTIAL_ALIVE")
          ? "PARTIAL_ALIVE"
          : "UNVERIFIED";
    exitCode =
      aggregateStanding === "ALIVE" ? 0 : aggregateStanding === "REFUSED" ? 1 : 2;
  }

  if (rollbackFault) {
    aggregateStanding = "REFUSED";
    exitCode = 2;
  }

  // Net compile sanity (Gall: structural soundness of the simple system)
  compilePowlToWorkflowNet(current);

  return {
    cycles,
    close,
    aggregateStanding,
    exitCode,
    powlRootId: cycles[0]?.workflowId ?? current.id,
    converged,
    retryBudgetExhausted,
    commitsCreated
  };
}

function readGitHead(workspaceDir: string): string | undefined {
  if (!existsSync(join(workspaceDir, ".git"))) return undefined;
  const rev = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: workspaceDir,
    encoding: "utf8"
  });
  const sha = rev.status === 0 ? rev.stdout.trim() : "";
  return sha.length > 0 ? sha : undefined;
}

function commitAliveTransition(workspaceDir: string, t: Transition): string | null {
  const status = spawnSync("git", ["status", "--porcelain"], {
    cwd: workspaceDir,
    encoding: "utf8"
  });
  if (status.status !== 0 || !status.stdout.trim()) {
    return null;
  }
  const add = spawnSync("git", ["add", "-A"], { cwd: workspaceDir, encoding: "utf8" });
  if (add.status !== 0) return null;
  const msg = `foundry(${t.activityId ?? t.id}): ${t.label}`;
  const commit = spawnSync("git", ["commit", "-m", msg], {
    cwd: workspaceDir,
    encoding: "utf8"
  });
  if (commit.status !== 0) return null;
  const rev = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: workspaceDir,
    encoding: "utf8"
  });
  return rev.status === 0 ? rev.stdout.trim() : null;
}

async function runWriteScope(courts: TransitionCourtAdapter[], files: string[]): Promise<ExitCode> {
  const codes: ExitCode[] = [];
  for (const court of courts) {
    codes.push(await court.validateWriteScope(files));
  }
  return worstExitCode(codes);
}

function normalizeWriteRel(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Resolve the relative paths the transition intends to mutate *before* execution.
 * Dry-run / default executor: ontology/<activity>.ttl. Live custom executors must
 * declare `targetFile` or non-empty `fileScope` — missing target fails closed (SUBJECT_MISSING).
 */
function plannedWriteRels(
  t: Transition,
  opts: FoundryLoopOptions,
  knownTargetScopes?: Map<string, string[]>
): string[] | null {
  const explicit = [
    ...(t.targetFile ? [t.targetFile] : []),
    ...(t.fileScope ?? [])
  ].map(normalizeWriteRel);
  if (explicit.length > 0) {
    return [...new Set(explicit)];
  }
  const inherited =
    (t.activityId ? knownTargetScopes?.get(t.activityId) : undefined) ??
    knownTargetScopes?.get(t.id);
  if (inherited && inherited.length > 0) {
    return [...new Set(inherited.map(normalizeWriteRel))];
  }
  if (opts.dryRun || !opts.executor) {
    return [`ontology/${t.activityId ?? t.id}.ttl`];
  }
  return null;
}

export function frontierActivitySignature(node: PowlNode): string {
  const canon = (n: PowlNode): string => {
    if (n.kind === "activity") {
      const scopes = [
        ...new Set([
          ...(n.targetFile ? [n.targetFile] : []),
          ...(n.fileScope ?? [])
        ].map(normalizeWriteRel))
      ].sort();
      return `act(${n.id}:${n.label}:${n.objectType}:${n.activityKind ?? ""}:[${scopes.join(",")}])`;
    }
    if (n.kind === "tau") {
      return `tau(${n.id})`;
    }
    if (n.kind === "xor") {
      return `xor(${n.id}:[${n.branches.map(canon).join(",")}])`;
    }
    if (n.kind === "loop") {
      return `loop(${n.id}:do=${canon(n.doBranch)},redo=${canon(n.redoBranch)},max=${n.maxIterations ?? ""})`;
    }
    const children = n.children.map(canon).join(",");
    const edges = [...n.order]
      .map(([u, v]) => `${u}->${v}`)
      .sort()
      .join(",");
    return `po(${n.id}:children=[${children}],order=[${edges}])`;
  };
  return canon(node);
}

function collectTargetScopes(
  node: PowlNode,
  out = new Map<string, string[]>()
): Map<string, string[]> {
  if (node.kind === "activity") {
    const unique = [
      ...new Set([
        ...(node.targetFile ? [node.targetFile] : []),
        ...(node.fileScope ?? [])
      ])
    ];
    if (unique.length > 0) {
      out.set(node.id, unique);
      out.set(`art:${node.id}`, unique);
    }
  } else if (node.kind === "xor") {
    for (const b of node.branches) collectTargetScopes(b, out);
  } else if (node.kind === "loop") {
    collectTargetScopes(node.doBranch, out);
    collectTargetScopes(node.redoBranch, out);
  } else if (node.kind === "partial_order") {
    for (const c of node.children) collectTargetScopes(c, out);
  }
  return out;
}

function withTargetScope(
  n: Extract<PowlNode, { kind: "activity" }>,
  scope: string[]
): PowlNode {
  if (scope.length === 0) return n;
  if (scope.length === 1) return { ...n, targetFile: scope[0] };
  return { ...n, fileScope: scope };
}

function propagateTargetScopes(
  node: PowlNode,
  knownTargetScopes: Map<string, string[]>
): PowlNode {
  if (knownTargetScopes.size === 0) return node;
  const allKnown = [...new Set([...knownTargetScopes.values()].flat())];
  const rewrite = (n: PowlNode): PowlNode => {
    if (n.kind === "activity") {
      if (n.targetFile || (n.fileScope && n.fileScope.length > 0)) return n;
      const m = n.label.match(/^Remediate\s+(art:.+)$/);
      if (m?.[1]) {
        const refId = m[1];
        const matched = knownTargetScopes.get(refId);
        if (matched && matched.length > 0) {
          return withTargetScope(n, matched);
        }
        // Only the synthetic workflow-level target ("art:workflow" when refused.length === 0)
        // may inherit known workspace scopes; never leak another WO's targetFile onto a
        // specific work order that omitted targetFile (preserves PR #32 SUBJECT_MISSING).
        if (refId === "art:workflow" && allKnown.length > 0) {
          return withTargetScope(n, allKnown);
        }
      }
      return n;
    }
    if (n.kind === "xor") {
      return { ...n, branches: n.branches.map(rewrite) };
    }
    if (n.kind === "loop") {
      return { ...n, doBranch: rewrite(n.doBranch), redoBranch: rewrite(n.redoBranch) };
    }
    if (n.kind === "partial_order") {
      const childrenAfterRemediate = n.children.map(rewrite);
      const remediateScopes: string[] = [];
      let hasUnscopedRemediate = false;
      for (const child of childrenAfterRemediate) {
        if (child.kind === "activity" && child.id.startsWith("remediate-")) {
          const s = [
            ...(child.targetFile ? [child.targetFile] : []),
            ...(child.fileScope ?? [])
          ];
          if (s.length === 0) hasUnscopedRemediate = true;
          else remediateScopes.push(...s);
        }
      }
      const uniqueRemediate = [...new Set(remediateScopes)];
      return {
        ...n,
        children: childrenAfterRemediate.map((child) => {
          if (
            child.kind === "activity" &&
            !child.targetFile &&
            (!child.fileScope || child.fileScope.length === 0) &&
            /^verify-remediation-\d+$/.test(child.id) &&
            !hasUnscopedRemediate &&
            uniqueRemediate.length > 0
          ) {
            return withTargetScope(child, uniqueRemediate);
          }
          return child;
        })
      };
    }
    return n;
  };
  return rewrite(node);
}
