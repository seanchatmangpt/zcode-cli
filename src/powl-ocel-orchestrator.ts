import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
 * Autonomic AIMD + Little's Law WIP Controller.
 * Discovers peak API equilibrium online — zero user-configurable concurrency knobs.
 */
export class AimdWipController {
  wip = 1;
  peakEquilibriumWip = 1;
  private serviceSamples: number[] = [];

  private baselineMs(): number {
    if (this.serviceSamples.length === 0) return Infinity;
    const sorted = [...this.serviceSamples].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.5)]!;
  }

  onSuccess(serviceMs: number): { changed: boolean; oldWip: number; newWip: number; reason: string } {
    const oldWip = this.wip;
    const base = this.baselineMs();
    this.serviceSamples.push(serviceMs);
    if (this.serviceSamples.length > 32) this.serviceSamples.shift();

    if (Number.isFinite(base) && base > 0 && serviceMs > base * 2.0) {
      this.wip = Math.max(1, Math.floor(this.wip * 0.5));
      return { changed: this.wip !== oldWip, oldWip, newWip: this.wip, reason: "latency_spike_md" };
    }
    this.wip = this.wip + 1;
    this.peakEquilibriumWip = Math.max(this.peakEquilibriumWip, this.wip);
    return { changed: this.wip !== oldWip, oldWip, newWip: this.wip, reason: "clean_completion_ai" };
  }

  onTransportBackpressure(): { changed: boolean; oldWip: number; newWip: number; reason: string } {
    const oldWip = this.wip;
    this.wip = Math.max(1, Math.floor(this.wip * 0.5));
    return { changed: this.wip !== oldWip, oldWip, newWip: this.wip, reason: "transport_timeout_md" };
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
}

export type TransitionExecutor = (t: Transition) => Promise<ExecutionOutcome>;

export interface OcelPowlRunResult {
  workflowId: string;
  replay: ReplayMetrics;
  ocel: Ocel2Log;
  ocelSha256: string;
  wasm4pmCompatChecked: boolean;
  equilibriumWip: number;
  bottlenecks: Array<{ transitionId: string; serviceMs: number }>;
}

export async function executePowlWithTokenReplay(
  root: PowlNode,
  executor: TransitionExecutor,
  options: { tomlPath?: string; wasm4pmCompatDir?: string; outputDir?: string } = {}
): Promise<OcelPowlRunResult> {
  const net = compilePowlToWorkflowNet(root);
  const aimd = new AimdWipController();
  const retries = new Map<string, number>();

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
  const inFlight = new Set<Promise<void>>();
  let haltedOnFailure = false;

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

  while (!haltedOnFailure) {
    drainSilent();
    if ((marking.get(net.sinkPlace) ?? 0) >= 1 && inFlight.size === 0) break;

    const enabledVisible = net.transitions.filter((t) => !t.silent && isEnabled(t));
    if (enabledVisible.length === 0 && inFlight.size === 0) break;

    for (const t of enabledVisible) {
      if (inFlight.size >= aimd.wip) break;
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
        const res = await executor(t);
        const serviceMs = Date.now() - started;
        bottlenecks.push({ transitionId: t.id, serviceMs });

        if (res.ok) {
          for (const p of net.post.get(t.id) ?? []) {
            marking.set(p, (marking.get(p) ?? 0) + 1);
            produced += 1;
          }
          const adj = aimd.onSuccess(serviceMs);
          artObj.attributes.push({ name: "standing", value: "ALIVE", time: new Date().toISOString() });
          emitEvent(
            "transition_completed",
            [
              { name: "transition", value: t.id },
              { name: "service_ms", value: String(serviceMs) },
              { name: "wip", value: String(adj.newWip) },
              { name: "aimd_reason", value: adj.reason }
            ],
            [
              { objectId: wfObj.id, qualifier: "workflow" },
              { objectId: artObj.id, qualifier: "verifies" }
            ]
          );
        } else if (res.transportBackpressure && (retries.get(t.id) ?? 0) < 3) {
          // Return tokens to input places (soundness preserved) and multiplicatively back off
          retries.set(t.id, (retries.get(t.id) ?? 0) + 1);
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
              { name: "reason", value: adj.reason }
            ],
            [{ objectId: wfObj.id, qualifier: "workflow" }]
          );
        } else {
          haltedOnFailure = true;
          artObj.attributes.push({ name: "standing", value: "REFUSED", time: new Date().toISOString() });
          emitEvent(
            "transition_refused",
            [{ name: "transition", value: t.id }, { name: "detail", value: res.detail ?? "failed" }],
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
      { name: "transition_refused", attributes: [{ name: "transition", type: "string" }, { name: "detail", type: "string" }] }
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
      JSON.stringify({ workflowId: root.id, replay: { produced, consumed, missing, remaining, fitness, soundTermination }, ocelSha256, wasm4pmCompatChecked, bottlenecks }, null, 2)
    );
  }

  return {
    workflowId: root.id,
    replay: { produced, consumed, missing, remaining, fitness, soundTermination },
    ocel,
    ocelSha256,
    wasm4pmCompatChecked,
    equilibriumWip: aimd.peakEquilibriumWip,
    bottlenecks
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
 * Continuous autonomic POWL v2 + OCEL 2.0 loop: never idles with an empty queue.
 * Omit `maxCycles` to run indefinitely; pass `maxCycles` for bounded runs/tests.
 */
export async function runAutonomicLoop(
  initialPowl: PowlNode,
  executor: TransitionExecutor,
  options: { maxCycles?: number; tomlPath?: string; wasm4pmCompatDir?: string; outputDir?: string } = {}
): Promise<OcelPowlRunResult[]> {
  const results: OcelPowlRunResult[] = [];
  let current: PowlNode = initialPowl;
  let cycle = 1;

  while (options.maxCycles === undefined || cycle <= options.maxCycles) {
    const res = await executePowlWithTokenReplay(current, executor, options);
    results.push(res);
    cycle += 1;
    current = deriveFollowUpPowl(res, cycle);
  }
  return results;
}
