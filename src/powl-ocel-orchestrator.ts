import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { alignTraceAStar, type AlignmentResult } from "./compliance/conformance.ts";
import { ComplianceRefusalError } from "./compliance/config.ts";
import {
  KingmanScheduler,
  type KingmanMetricsSnapshot,
  type TransportTelemetrySample
} from "./compliance/kingman-scheduler.ts";
import {
  captureWorkspaceSnapshot,
  SignatureRetryLimiter,
  TransactionalRollbackError,
  type WorkspaceSnapshotHandle
} from "./compliance/transactional-net.ts";

/**
 * Formal POWL v2 (Kourani & van der Aalst) + Workflow-Net Token-Based Replay
 * + IEEE OCEL 2.0 (Berti, Koren, van der Aalst et al.) Execution Engine.
 *
 * Architecture:
 *   1. Recursive POWL v2 AST: Activity | Tau | Xor | Loop(do, redo) | PartialOrder(V, ≺)
 *      — sound by construction (free of deadlocks & livelocks).
 *   2. Exact POWL -> Sound Workflow Net (Petri Net: P, T, F, i, o) compiler.
 *   3. Token-Based Replay Engine computing Van der Aalst fitness:
 *        fitness = 0.5 * (1 - m/c) + 0.5 * (1 - r/p)
 *      with fail-closed conformance (refuses firing unenabled transitions).
 *   4. True OCEL 2.0 log: E2O (event-to-object), O2O (object-to-object),
 *      timestamped dynamic object attributes, and convergence/divergence.
 */

// ---------------------------------------------------------------------------
// 1. Recursive POWL v2 AST (Sound by Construction)
// ---------------------------------------------------------------------------

export type PowlNode =
  | { kind: "activity"; id: string; label: string; objectType: string; targetFile?: string }
  | { kind: "tau"; id: string }
  | { kind: "xor"; id: string; branches: PowlNode[] }
  | { kind: "loop"; id: string; doBranch: PowlNode; redoBranch: PowlNode; maxIterations?: number }
  | { kind: "partial_order"; id: string; children: PowlNode[]; order: ReadonlyArray<readonly [string, string]> };

/**
 * Validates that every PartialOrder node in a POWL tree is a strict partial order
 * (irreflexive, asymmetric, acyclic) and all node IDs are unique.
 */
export function validatePowlTree(root: PowlNode): void {
  const seenIds = new Set<string>();
  const walk = (node: PowlNode) => {
    if (seenIds.has(node.id)) throw new Error(`POWL violation: duplicate node id "${node.id}"`);
    seenIds.add(node.id);
    if (node.kind === "xor") {
      if (node.branches.length < 2) throw new Error(`POWL XOR "${node.id}" requires >= 2 branches`);
      node.branches.forEach(walk);
    } else if (node.kind === "loop") {
      walk(node.doBranch);
      walk(node.redoBranch);
    } else if (node.kind === "partial_order") {
      if (node.children.length === 0) throw new Error(`POWL PO "${node.id}" requires >= 1 child`);
      const childIds = new Set(node.children.map((c) => c.id));
      const adj = new Map<string, string[]>();
      const inDeg = new Map<string, number>();
      for (const id of childIds) { adj.set(id, []); inDeg.set(id, 0); }
      for (const [u, v] of node.order) {
        if (!childIds.has(u) || !childIds.has(v)) {
          throw new Error(`POWL PO "${node.id}": order edge (${u} ≺ ${v}) references non-child`);
        }
        if (u === v) throw new Error(`POWL PO "${node.id}": irreflexivity violated on "${u}"`);
        adj.get(u)!.push(v);
        inDeg.set(v, (inDeg.get(v) ?? 0) + 1);
      }
      const q = [...childIds].filter((id) => inDeg.get(id) === 0);
      let visited = 0;
      while (q.length > 0) {
        const cur = q.shift()!;
        visited += 1;
        for (const nxt of adj.get(cur)!) {
          const d = inDeg.get(nxt)! - 1;
          inDeg.set(nxt, d);
          if (d === 0) q.push(nxt);
        }
      }
      if (visited !== childIds.size) {
        throw new Error(`POWL PO "${node.id}": cycle detected (violates strict partial order)`);
      }
      node.children.forEach(walk);
    }
  };
  walk(root);
}

// ---------------------------------------------------------------------------
// 2. POWL -> Sound Workflow Net (Petri Net) Compiler
// ---------------------------------------------------------------------------

export interface Place {
  id: string;
  objectType: string;
}

export interface Transition {
  id: string;
  label: string;
  silent: boolean;
  activityId?: string;
  objectType: string;
  targetFile?: string;
}

export interface WorkflowNet {
  places: Place[];
  transitions: Transition[];
  /** Place -> Transition input arcs */
  pre: Map<string, string[]>;
  /** Transition -> Place output arcs */
  post: Map<string, string[]>;
  sourcePlace: string;
  sinkPlace: string;
}

export function compilePowlToWorkflowNet(root: PowlNode): WorkflowNet {
  validatePowlTree(root);
  const places: Place[] = [];
  const transitions: Transition[] = [];
  const pre = new Map<string, string[]>();
  const post = new Map<string, string[]>();
  let seq = 0;

  const newPlace = (prefix: string, objectType = "Workflow"): string => {
    seq += 1;
    const id = `p_${prefix}_${seq}`;
    places.push({ id, objectType });
    return id;
  };

  const addTransition = (t: Transition, inputs: string[], outputs: string[]) => {
    transitions.push(t);
    pre.set(t.id, inputs);
    post.set(t.id, outputs);
  };

  const compile = (node: PowlNode, startP: string, endP: string) => {
    if (node.kind === "activity") {
      addTransition(
        { id: `t_${node.id}`, label: node.label, silent: false, activityId: node.id, objectType: node.objectType, targetFile: node.targetFile },
        [startP],
        [endP]
      );
      return;
    }
    if (node.kind === "tau") {
      addTransition({ id: `tau_${node.id}`, label: "τ", silent: true, objectType: "Workflow" }, [startP], [endP]);
      return;
    }
    if (node.kind === "xor") {
      for (const branch of node.branches) {
        compile(branch, startP, endP);
      }
      return;
    }
    if (node.kind === "loop") {
      const loopEntry = newPlace(`loop_in_${node.id}`);
      const loopChoice = newPlace(`loop_choice_${node.id}`);
      addTransition({ id: `tau_enter_${node.id}`, label: "τ_enter", silent: true, objectType: "Workflow" }, [startP], [loopEntry]);
      compile(node.doBranch, loopEntry, loopChoice);
      compile(node.redoBranch, loopChoice, loopEntry);
      addTransition({ id: `tau_exit_${node.id}`, label: "τ_exit", silent: true, objectType: "Workflow" }, [loopChoice], [endP]);
      return;
    }
    if (node.kind === "partial_order") {
      const childStart = new Map<string, string>();
      const childEnd = new Map<string, string>();
      const inEdges = new Map<string, string[]>();
      const outEdges = new Map<string, string[]>();

      for (const c of node.children) {
        inEdges.set(c.id, []);
        outEdges.set(c.id, []);
        childStart.set(c.id, newPlace(`po_in_${c.id}`));
        childEnd.set(c.id, newPlace(`po_out_${c.id}`));
        compile(c, childStart.get(c.id)!, childEnd.get(c.id)!);
      }

      // Add order places between u_end -> v_start for every (u ≺ v)
      const orderPlaces = new Map<string, string[]>();
      for (const c of node.children) orderPlaces.set(c.id, []);
      for (const [u, v] of node.order) {
        outEdges.get(u)!.push(v);
        inEdges.get(v)!.push(u);
      }

      const roots = node.children.filter((c) => inEdges.get(c.id)!.length === 0);
      const leaves = node.children.filter((c) => outEdges.get(c.id)!.length === 0);

      // Fork from startP to all minimal elements
      addTransition(
        { id: `tau_fork_${node.id}`, label: "τ_fork", silent: true, objectType: "Workflow" },
        [startP],
        roots.map((r) => childStart.get(r.id)!)
      );

      // Wire precedence edges: for each non-root v, join all predecessors u -> v via tau_sync
      for (const v of node.children) {
        const preds = inEdges.get(v.id)!;
        if (preds.length === 0) continue;
        const predSyncPlaces: string[] = [];
        for (const u of preds) {
          const pEdge = newPlace(`ord_${u}_to_${v.id}`);
          predSyncPlaces.push(pEdge);
          orderPlaces.get(u)!.push(pEdge);
        }
        addTransition(
          { id: `tau_join_${node.id}_${v.id}`, label: `τ_join(${v.id})`, silent: true, objectType: "Workflow" },
          predSyncPlaces,
          [childStart.get(v.id)!]
        );
      }

      // Fan-out from each non-leaf u_end to its outgoing order places
      for (const u of node.children) {
        const outs = orderPlaces.get(u.id)!;
        if (outs.length === 0) continue;
        addTransition(
          { id: `tau_split_${node.id}_${u.id}`, label: `τ_split(${u.id})`, silent: true, objectType: "Workflow" },
          [childEnd.get(u.id)!],
          outs
        );
      }

      // Join all maximal elements into endP
      addTransition(
        { id: `tau_end_${node.id}`, label: "τ_end", silent: true, objectType: "Workflow" },
        leaves.map((l) => childEnd.get(l.id)!),
        [endP]
      );
    }
  };

  const sourcePlace = newPlace("source");
  const sinkPlace = newPlace("sink");
  compile(root, sourcePlace, sinkPlace);

  return { places, transitions, pre, post, sourcePlace, sinkPlace };
}

// ---------------------------------------------------------------------------
// 3. Token-Based Replay + Online Conformance + OCEL 2.0 Emitter
// ---------------------------------------------------------------------------

export interface ReplayMetrics {
  produced: number;
  consumed: number;
  missing: number;
  remaining: number;
  /** Van der Aalst token-based replay fitness: 0.5*(1 - m/c) + 0.5*(1 - r/p) */
  fitness: number;
  soundTermination: boolean;
}

export interface Ocel2DynamicAttribute {
  name: string;
  value: string;
  time: string;
}

export interface Ocel2Object {
  id: string;
  type: string;
  attributes: Ocel2DynamicAttribute[];
  relationships: Array<{ objectId: string; qualifier: string }>;
}

export interface Ocel2Event {
  id: string;
  type: string;
  time: string;
  attributes: Array<{ name: string; value: string }>;
  relationships: Array<{ objectId: string; qualifier: string }>;
}

export interface Ocel2Log {
  objectTypes: Array<{ name: string; attributes: Array<{ name: string; type: string }> }>;
  eventTypes: Array<{ name: string; attributes: Array<{ name: string; type: string }> }>;
  objects: Ocel2Object[];
  events: Ocel2Event[];
}

/**
 * Autonomic Kingman-Variance-Law + AIMD WIP Controller.
 * Separates transport-layer congestion (TTFT / RPM / TPM / 429) from
 * heavy-tailed coding turn service times (c_s^2 >> 1) to maximize lambda_alive.
 */
export class AimdWipController {
  private readonly scheduler = new KingmanScheduler();

  get wip(): number {
    return this.scheduler.wip;
  }

  set wip(value: number) {
    this.scheduler.wip = value;
  }

  get peakEquilibriumWip(): number {
    return this.scheduler.peakEquilibriumWip;
  }

  set peakEquilibriumWip(value: number) {
    this.scheduler.peakEquilibriumWip = value;
  }

  onSuccess(
    serviceMs: number,
    transport?: TransportTelemetrySample
  ): { changed: boolean; oldWip: number; newWip: number; reason: string; ttftMdTriggered: boolean } {
    const decision = this.scheduler.onSuccess(serviceMs, transport);
    return {
      changed: decision.changed,
      oldWip: decision.oldWip,
      newWip: decision.newWip,
      reason: decision.reason,
      ttftMdTriggered: decision.ttftMdTriggered
    };
  }

  onTransportBackpressure(): { changed: boolean; oldWip: number; newWip: number; reason: string } {
    const decision = this.scheduler.onTransportBackpressure();
    return {
      changed: decision.changed,
      oldWip: decision.oldWip,
      newWip: decision.newWip,
      reason: decision.reason
    };
  }

  getKingmanSnapshot(): KingmanMetricsSnapshot {
    return this.scheduler.getSnapshot();
  }
}

export interface ExecutionOutcome {
  ok: boolean;
  /** True when failure is transient transport backpressure (429 / UND_ERR_CONNECT_TIMEOUT). */
  transportBackpressure?: boolean;
  /** For Loop redo/exit decisions: set `redo: true` to take the redo branch. */
  redo?: boolean;
  exitCode: number;
  detail?: string;
  /** Optional transport telemetry separated from coding turn serviceMs. */
  ttftMs?: number;
  rpmHeadroomRatio?: number;
  tpmHeadroomRatio?: number;
  /** Optional stable failure signature for bounded retry accounting. */
  errorSignature?: string;
}

export type TransitionExecutor = (t: Transition) => Promise<ExecutionOutcome>;

export interface OcelPowlRunOptions {
  tomlPath?: string;
  wasm4pmCompatDir?: string;
  outputDir?: string;
  workspaceDir?: string;
  rollbackOnDirty?: boolean;
  maxRetriesPerSignature?: number;
  stepTimeoutMs?: number;
  retryLimiter?: SignatureRetryLimiter;
}

export interface OcelPowlRunResult {
  workflowId: string;
  replay: ReplayMetrics;
  /** Formal A* trace alignment over observed visible completions (gamma*, log_move vs model_move). */
  alignment: AlignmentResult;
  /** Token-replay completion heuristic retained beside A* alignment for audit comparison. */
  completionHeuristic: ReplayMetrics;
  kingman: KingmanMetricsSnapshot;
  ocel: Ocel2Log;
  ocelSha256: string;
  wasm4pmCompatChecked: boolean;
  equilibriumWip: number;
  bottlenecks: Array<{ transitionId: string; serviceMs: number }>;
  refusalCode?: string;
  rolledBackCount?: number;
}

export async function executePowlWithTokenReplay(
  root: PowlNode,
  executor: TransitionExecutor,
  options: OcelPowlRunOptions = {}
): Promise<OcelPowlRunResult> {
  const net = compilePowlToWorkflowNet(root);
  const aimd = new AimdWipController();
  const limiter = options.retryLimiter ?? new SignatureRetryLimiter(options.maxRetriesPerSignature ?? 3);
  const rollbackOnDirty = options.rollbackOnDirty ?? true;

  const marking = new Map<string, number>();
  for (const p of net.places) marking.set(p.id, 0);
  marking.set(net.sourcePlace, 1);

  let produced = 1; // initial token in sourcePlace
  let consumed = 0;
  let missing = 0;

  const objects = new Map<string, Ocel2Object>();
  const ensureObject = (id: string, type: string) => {
    if (!objects.has(id)) objects.set(id, { id, type, attributes: [], relationships: [] });
    return objects.get(id)!;
  };

  const wfObj = ensureObject(`wf:${root.id}`, "Workflow");
  wfObj.attributes.push({ name: "standing", value: "RUNNING", time: new Date().toISOString() });

  const events: Ocel2Event[] = [];
  let evtSeq = 0;
  const emitEvent = (
    type: string,
    attributes: Array<{ name: string; value: string }>,
    relationships: Array<{ objectId: string; qualifier: string }>
  ) => {
    evtSeq += 1;
    events.push({
      id: `e_${String(evtSeq).padStart(5, "0")}`,
      type,
      time: new Date().toISOString(),
      attributes,
      relationships
    });
  };

  const isEnabled = (t: Transition): boolean =>
    (net.pre.get(t.id) ?? []).every((p) => (marking.get(p) ?? 0) >= 1);

  const fireSilent = (t: Transition) => {
    for (const p of net.pre.get(t.id) ?? []) {
      const cur = marking.get(p) ?? 0;
      if (cur < 1) { missing += 1; } else { marking.set(p, cur - 1); }
      consumed += 1;
    }
    for (const p of net.post.get(t.id) ?? []) {
      marking.set(p, (marking.get(p) ?? 0) + 1);
      produced += 1;
    }
  };

  const bottlenecks: Array<{ transitionId: string; serviceMs: number }> = [];
  const executedActivities: string[] = [];
  const inFlight = new Set<Promise<void>>();
  let haltedOnFailure = false;
  let refusalCode: string | undefined;
  let rolledBackCount = 0;

  const drainSilent = () => {
    let fired = true;
    while (fired) {
      fired = false;
      for (const t of net.transitions) {
        if (t.silent && isEnabled(t)) {
          fireSilent(t);
          fired = true;
        }
      }
    }
  };

  const runExecutorWithStepTimeout = async (t: Transition): Promise<ExecutionOutcome> => {
    const ms = options.stepTimeoutMs;
    if (ms === undefined || !Number.isFinite(ms) || ms <= 0) {
      return await executor(t);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        executor(t),
        new Promise<ExecutionOutcome>((_, reject) => {
          timer = setTimeout(() => {
            reject(new TransactionalRollbackError("STEP_TIMEOUT", `Step "${t.id}" timed out after ${ms}ms`, 1));
          }, ms);
        })
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  while (!haltedOnFailure) {
    drainSilent();
    if ((marking.get(net.sinkPlace) ?? 0) >= 1 && inFlight.size === 0) break;

    const enabledVisible = net.transitions.filter((t) => !t.silent && isEnabled(t));
    if (enabledVisible.length === 0 && inFlight.size === 0) break;

    const effectiveWip = options.workspaceDir ? 1 : aimd.wip;

    for (const t of enabledVisible) {
      if (inFlight.size >= effectiveWip) break;

      let snap: WorkspaceSnapshotHandle | null = null;
      if (options.workspaceDir) {
        try {
          snap = captureWorkspaceSnapshot(options.workspaceDir);
        } catch (snapErr) {
          haltedOnFailure = true;
          refusalCode = snapErr instanceof TransactionalRollbackError ? snapErr.code : "ROLLBACK_FAILED";
          emitEvent(
            "transition_refused",
            [
              { name: "transition", value: t.id },
              { name: "reason", value: refusalCode },
              { name: "signature", value: refusalCode },
              { name: "detail", value: snapErr instanceof Error ? snapErr.message : String(snapErr) }
            ],
            [{ objectId: wfObj.id, qualifier: "workflow" }]
          );
          break;
        }
      }

      // Reserve input tokens atomically (strict Petri net firing semantics)
      for (const p of net.pre.get(t.id) ?? []) {
        marking.set(p, (marking.get(p) ?? 1) - 1);
        consumed += 1;
      }

      const artObj = ensureObject(`art:${t.activityId ?? t.id}`, t.objectType);
      artObj.relationships.push({ objectId: wfObj.id, qualifier: "part_of" });
      artObj.attributes.push({ name: "standing", value: "RUNNING", time: new Date().toISOString() });

      emitEvent(
        "transition_fired",
        [{ name: "transition", value: t.id }, { name: "label", value: t.label }, { name: "wip", value: String(aimd.wip) }],
        [
          { objectId: wfObj.id, qualifier: "workflow" },
          { objectId: artObj.id, qualifier: "produces" }
        ]
      );

      const started = Date.now();
      const job = (async () => {
        let res: ExecutionOutcome | undefined;
        let stepError: unknown;
        try {
          res = await runExecutorWithStepTimeout(t);
        } catch (err) {
          stepError = err;
        }
        const serviceMs = Date.now() - started;
        bottlenecks.push({ transitionId: t.id, serviceMs });

        if (res?.ok) {
          snap?.dispose();
          for (const p of net.post.get(t.id) ?? []) {
            marking.set(p, (marking.get(p) ?? 0) + 1);
            produced += 1;
          }
          executedActivities.push(t.activityId ?? t.label);
          const adj = aimd.onSuccess(serviceMs, {
            ttftMs: res.ttftMs,
            rpmHeadroomRatio: res.rpmHeadroomRatio,
            tpmHeadroomRatio: res.tpmHeadroomRatio
          });
          const kingmanSnap = aimd.getKingmanSnapshot();
          artObj.attributes.push({ name: "standing", value: "ALIVE", time: new Date().toISOString() });
          emitEvent(
            "transition_completed",
            [
              { name: "transition", value: t.id },
              { name: "service_ms", value: String(serviceMs) },
              { name: "wip", value: String(adj.newWip) },
              { name: "aimd_reason", value: adj.reason },
              { name: "cs2", value: kingmanSnap.cs2.toFixed(4) },
              { name: "rho", value: kingmanSnap.rho.toFixed(4) },
              { name: "lambda_alive", value: kingmanSnap.estimate.lambdaAlivePerSec.toFixed(4) },
              ...(res.ttftMs !== undefined ? [{ name: "ttft_ms", value: String(res.ttftMs) }] : [])
            ],
            [
              { objectId: wfObj.id, qualifier: "workflow" },
              { objectId: artObj.id, qualifier: "verifies" }
            ]
          );
          return;
        }

        const isTimeout =
          stepError instanceof TransactionalRollbackError && stepError.code === "STEP_TIMEOUT";
        const failureReason = isTimeout
          ? "step_timeout"
          : stepError
            ? "step_exception"
            : res?.detail ?? "failed";
        const failureSig =
          res?.errorSignature ??
          (stepError instanceof Error
            ? `${t.id}:${stepError.message}`
            : `${t.id}:${res?.detail ?? "transport_or_step_failure"}`);

        if (snap) {
          try {
            const rb = snap.rollback(failureReason, t.id, rollbackOnDirty);
            rolledBackCount += 1;
            emitEvent(
              rb.event.type,
              rb.event.attributes,
              [{ objectId: wfObj.id, qualifier: "workflow" }, ...rb.event.relationships]
            );
          } catch (rbErr) {
            snap.dispose();
            haltedOnFailure = true;
            refusalCode = rbErr instanceof TransactionalRollbackError ? rbErr.code : "ROLLBACK_FAILED";
            artObj.attributes.push({ name: "standing", value: "REFUSED", time: new Date().toISOString() });
            emitEvent(
              "transition_refused",
              [
                { name: "transition", value: t.id },
                { name: "reason", value: refusalCode },
                { name: "signature", value: refusalCode },
                { name: "detail", value: rbErr instanceof Error ? rbErr.message : String(rbErr) }
              ],
              [
                { objectId: wfObj.id, qualifier: "workflow" },
                { objectId: artObj.id, qualifier: "blocks" }
              ]
            );
            return;
          } finally {
            snap.dispose();
          }
        }

        const retryable = Boolean(res?.transportBackpressure) || (Boolean(options.workspaceDir) && isTimeout);
        if (retryable) {
          try {
            limiter.recordFailure(failureSig, t.id);
          } catch (limitErr) {
            haltedOnFailure = true;
            refusalCode =
              limitErr instanceof ComplianceRefusalError ? limitErr.code : "RETRY_BUDGET_EXHAUSTED";
            artObj.attributes.push({ name: "standing", value: "REFUSED", time: new Date().toISOString() });
            emitEvent(
              "retry_budget_exhausted",
              [
                { name: "transition", value: t.id },
                { name: "signature", value: limiter.normalizeSignature(failureSig) },
                { name: "detail", value: limitErr instanceof Error ? limitErr.message : String(limitErr) }
              ],
              [
                { objectId: wfObj.id, qualifier: "workflow" },
                { objectId: artObj.id, qualifier: "blocks" }
              ]
            );
            emitEvent(
              "transition_refused",
              [
                { name: "transition", value: t.id },
                { name: "reason", value: refusalCode },
                { name: "signature", value: limiter.normalizeSignature(failureSig) },
                { name: "detail", value: limitErr instanceof Error ? limitErr.message : String(limitErr) }
              ],
              [
                { objectId: wfObj.id, qualifier: "workflow" },
                { objectId: artObj.id, qualifier: "blocks" }
              ]
            );
            return;
          }

          // Return tokens to input places cleanly (after atomic rollback & retry budget check)
          for (const p of net.pre.get(t.id) ?? []) {
            marking.set(p, (marking.get(p) ?? 0) + 1);
            produced += 1;
          }
          const adj = aimd.onTransportBackpressure();
          emitEvent(
            "wip_backoff",
            [
              { name: "transition", value: t.id },
              { name: "old_wip", value: String(adj.oldWip) },
              { name: "new_wip", value: String(adj.newWip) },
              { name: "reason", value: adj.reason },
              { name: "signature", value: limiter.normalizeSignature(failureSig) }
            ],
            [{ objectId: wfObj.id, qualifier: "workflow" }]
          );
        } else {
          haltedOnFailure = true;
          artObj.attributes.push({ name: "standing", value: "REFUSED", time: new Date().toISOString() });
          const refusedSignature =
            res?.errorSignature && res.errorSignature.trim().length > 0
              ? res.errorSignature
              : stepError !== undefined && !isTimeout
                ? (stepError instanceof Error ? stepError.message : String(stepError)) || failureReason
                : failureReason;
          emitEvent(
            "transition_refused",
            [
              { name: "transition", value: t.id },
              { name: "signature", value: refusedSignature },
              { name: "detail", value: failureReason }
            ],
            [
              { objectId: wfObj.id, qualifier: "workflow" },
              { objectId: artObj.id, qualifier: "blocks" }
            ]
          );
        }
      })();
      inFlight.add(job);
      job.finally(() => inFlight.delete(job));
    }

    if (inFlight.size > 0) await Promise.race(inFlight);
  }

  // Drain any remaining in-flight transition promises before finalizing marking / OCEL SHA-256
  if (inFlight.size > 0) {
    await Promise.allSettled(inFlight);
  }

  // Consume final token in sinkPlace if present
  const sinkTokens = marking.get(net.sinkPlace) ?? 0;
  if (sinkTokens >= 1) {
    marking.set(net.sinkPlace, sinkTokens - 1);
    consumed += 1;
  } else {
    missing += 1;
  }

  let remaining = 0;
  for (const count of marking.values()) remaining += count;

  const fitness =
    0.5 * (1 - (consumed > 0 ? missing / consumed : 0)) +
    0.5 * (1 - (produced > 0 ? remaining / produced : 0));
  const soundTermination = missing === 0 && remaining === 0 && !haltedOnFailure;

  const replay: ReplayMetrics = { produced, consumed, missing, remaining, fitness, soundTermination };
  const alignment = alignTraceAStar(net, executedActivities);
  const kingman = aimd.getKingmanSnapshot();

  wfObj.attributes.push({
    name: "standing",
    value: soundTermination ? "ALIVE" : "REFUSED",
    time: new Date().toISOString()
  });

  const ocel: Ocel2Log = {
    objectTypes: [
      { name: "Workflow", attributes: [{ name: "standing", type: "string" }] },
      { name: "Artifact", attributes: [{ name: "standing", type: "string" }] }
    ],
    eventTypes: [
      { name: "transition_fired", attributes: [{ name: "transition", type: "string" }, { name: "label", type: "string" }] },
      { name: "transition_completed", attributes: [{ name: "transition", type: "string" }, { name: "service_ms", type: "string" }] },
      {
        name: "transition_refused",
        attributes: [
          { name: "transition", type: "string" },
          { name: "signature", type: "string" },
          { name: "detail", type: "string" }
        ]
      },
      { name: "workspace_rolled_back", attributes: [{ name: "reason", type: "string" }, { name: "step_id", type: "string" }] },
      { name: "retry_budget_exhausted", attributes: [{ name: "signature", type: "string" }, { name: "detail", type: "string" }] }
    ],
    objects: [...objects.values()],
    events
  };

  const ocelJson = JSON.stringify(ocel, null, 2);
  const ocelSha256 = createHash("sha256").update(ocelJson).digest("hex");

  let wasm4pmCompatChecked = false;
  const compatDist = options.wasm4pmCompatDir
    ? join(options.wasm4pmCompatDir, "wasm4pm-compat-wasm", "dist", "compat-ocel.js")
    : undefined;
  if (compatDist && existsSync(compatDist)) {
    try {
      const mod = await import(compatDist) as { ocelV2?: { validateOcelJson?: (s: string) => unknown } };
      if (typeof mod.ocelV2?.validateOcelJson === "function") {
        mod.ocelV2.validateOcelJson(ocelJson);
        wasm4pmCompatChecked = true;
      }
    } catch {
      wasm4pmCompatChecked = false;
    }
  }

  if (options.outputDir) {
    mkdirSync(options.outputDir, { recursive: true });
    writeFileSync(join(options.outputDir, "powl-tree.json"), JSON.stringify(root, null, 2));
    writeFileSync(join(options.outputDir, "workflow.ocel.json"), ocelJson);
    writeFileSync(
      join(options.outputDir, "replay-conformance.json"),
      JSON.stringify(
        {
          workflowId: root.id,
          replay,
          completionHeuristic: replay,
          alignment,
          kingman,
          ocelSha256,
          wasm4pmCompatChecked,
          bottlenecks,
          ...(refusalCode ? { refusalCode } : {}),
          ...(rolledBackCount > 0 ? { rolledBackCount } : {})
        },
        null,
        2
      )
    );
  }

  return {
    workflowId: root.id,
    replay,
    alignment,
    completionHeuristic: replay,
    kingman,
    ocel,
    ocelSha256,
    wasm4pmCompatChecked,
    equilibriumWip: aimd.peakEquilibriumWip,
    bottlenecks,
    ...(refusalCode ? { refusalCode } : {}),
    ...(rolledBackCount > 0 ? { rolledBackCount } : {})
  };
}

/**
 * Autonomic Follow-Up Work Generator (Chatman recursion: R_t -> POWL_{t+1}).
 * Ensures the workflow queue is never empty by deriving the next sound POWL
 * cycle from the OCEL 2.0 log, replay fitness, and bottleneck telemetry:
 *   1. Refused / fitness < 1.0 -> Remediation POWL for refused artifacts.
 *   2. Latency bottleneck (> 2x median) -> Optimization & profiling POWL.
 *   3. All ALIVE (fitness = 1.0) -> Anti-vacuity mutation court + drift-check POWL.
 */
export function deriveFollowUpPowl(prev: OcelPowlRunResult, cycle: number): PowlNode {
  const refused = prev.ocel.objects.filter(
    (o) => o.type !== "Workflow" && o.attributes.at(-1)?.value === "REFUSED"
  );
  if (!prev.replay.soundTermination || refused.length > 0) {
    const targets = refused.length > 0 ? refused : [{ id: "art:workflow", type: "Artifact" }];
    return {
      kind: "partial_order",
      id: `${prev.workflowId}-remediate-c${cycle}`,
      children: [
        ...targets.map((o, idx): PowlNode => ({
          kind: "activity",
          id: `remediate-${cycle}-${idx}`,
          label: `Remediate ${o.id}`,
          objectType: o.type
        })),
        {
          kind: "activity",
          id: `verify-remediation-${cycle}`,
          label: `Re-verify conformance after cycle ${cycle} remediation`,
          objectType: "Artifact"
        }
      ],
      order: targets.map((_, idx) => [`remediate-${cycle}-${idx}`, `verify-remediation-${cycle}`] as const)
    };
  }

  const sorted = [...prev.bottlenecks].sort((a, b) => a.serviceMs - b.serviceMs);
  const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)]!.serviceMs : 0;
  const slowest = sorted.at(-1);
  if (slowest && median > 0 && slowest.serviceMs > median * 2) {
    return {
      kind: "partial_order",
      id: `${prev.workflowId}-optimize-c${cycle}`,
      children: [
        { kind: "activity", id: `profile-${cycle}`, label: `Profile bottleneck ${slowest.transitionId}`, objectType: "Artifact" },
        { kind: "activity", id: `optimize-${cycle}`, label: `Optimize ${slowest.transitionId}`, objectType: "Artifact" }
      ],
      order: [[`profile-${cycle}`, `optimize-${cycle}`]]
    };
  }

  return {
    kind: "partial_order",
    id: `${prev.workflowId}-verify-c${cycle}`,
    children: [
      { kind: "activity", id: `mutation-court-${cycle}`, label: `Anti-vacuity mutation court (cycle ${cycle})`, objectType: "Artifact" },
      { kind: "activity", id: `drift-audit-${cycle}`, label: `Clean-room regeneration & drift audit (cycle ${cycle})`, objectType: "Artifact" },
      { kind: "activity", id: `seal-receipt-${cycle}`, label: `Seal cycle ${cycle} Chatman receipt`, objectType: "Artifact" }
    ],
    order: [
      [`mutation-court-${cycle}`, `seal-receipt-${cycle}`],
      [`drift-audit-${cycle}`, `seal-receipt-${cycle}`]
    ]
  };
}

/**
 * Continuous autonomic POWL v2 + OCEL 2.0 loop: never idles with an empty queue,
 * while bounding repeated remediation cycles per failure signature (F12).
 * Omit `maxCycles` to run until convergence/budget cap; pass `maxCycles` for bounded runs/tests.
 */
export async function runAutonomicLoop(
  initialPowl: PowlNode,
  executor: TransitionExecutor,
  options: OcelPowlRunOptions & { maxCycles?: number; throwOnRetryExhausted?: boolean } = {}
): Promise<OcelPowlRunResult[]> {
  const results: OcelPowlRunResult[] = [];
  const sharedLimiter =
    options.retryLimiter ?? new SignatureRetryLimiter(options.maxRetriesPerSignature ?? 3);
  let current: PowlNode = initialPowl;
  let cycle = 1;

  while (options.maxCycles === undefined || cycle <= options.maxCycles) {
    const res = await executePowlWithTokenReplay(current, executor, {
      ...options,
      retryLimiter: sharedLimiter
    });
    results.push(res);

    if (
      res.refusalCode === "RETRY_BUDGET_EXHAUSTED" ||
      res.refusalCode === "DIRTY_TIMEOUT_REFUSED" ||
      res.refusalCode === "ROLLBACK_FAILED"
    ) {
      if (options.throwOnRetryExhausted && res.refusalCode === "RETRY_BUDGET_EXHAUSTED") {
        throw new ComplianceRefusalError(
          "RETRY_BUDGET_EXHAUSTED",
          `Autonomic loop halted at cycle ${cycle}: ${res.refusalCode}`,
          "mu_on_O"
        );
      }
      break;
    }

    if (!res.replay.soundTermination) {
      const refusedEv = res.ocel.events.find((e) => e.type === "transition_refused");
      const sigAttr = refusedEv?.attributes.find((a) => a.name === "signature")?.value;
      const detailAttr = refusedEv?.attributes.find((a) => a.name === "detail")?.value;
      const reasonAttr = refusedEv?.attributes.find((a) => a.name === "reason")?.value;
      const detail =
        (sigAttr && sigAttr.trim().length > 0 ? sigAttr : undefined) ??
        (detailAttr && detailAttr.trim().length > 0 ? detailAttr : undefined) ??
        (reasonAttr && reasonAttr.trim().length > 0 ? reasonAttr : undefined) ??
        "cycle_refused";
      try {
        sharedLimiter.recordFailure(`cycle_refusal:${detail}`);
      } catch (err) {
        res.refusalCode = "RETRY_BUDGET_EXHAUSTED";
        res.ocel.events.push({
          id: `e_${String(res.ocel.events.length + 1).padStart(5, "0")}`,
          type: "retry_budget_exhausted",
          time: new Date().toISOString(),
          attributes: [
            { name: "signature", value: sharedLimiter.normalizeSignature(`cycle_refusal:${detail}`) },
            { name: "detail", value: err instanceof Error ? err.message : String(err) }
          ],
          relationships: []
        });
        const updatedOcelJson = JSON.stringify(res.ocel, null, 2);
        res.ocelSha256 = createHash("sha256").update(updatedOcelJson).digest("hex");
        if (options.outputDir) {
          mkdirSync(options.outputDir, { recursive: true });
          writeFileSync(join(options.outputDir, "workflow.ocel.json"), updatedOcelJson);
          writeFileSync(
            join(options.outputDir, "replay-conformance.json"),
            JSON.stringify(
              {
                workflowId: res.workflowId,
                replay: res.replay,
                completionHeuristic: res.completionHeuristic,
                alignment: res.alignment,
                kingman: res.kingman,
                ocelSha256: res.ocelSha256,
                wasm4pmCompatChecked: res.wasm4pmCompatChecked,
                bottlenecks: res.bottlenecks,
                ...(res.refusalCode ? { refusalCode: res.refusalCode } : {}),
                ...(res.rolledBackCount && res.rolledBackCount > 0 ? { rolledBackCount: res.rolledBackCount } : {})
              },
              null,
              2
            )
          );
        }
        if (options.throwOnRetryExhausted) throw err;
        break;
      }
    }

    cycle += 1;
    current = deriveFollowUpPowl(res, cycle);
  }
  return results;
}
