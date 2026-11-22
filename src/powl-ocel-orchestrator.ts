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

/** readonly = free concurrent fan-out; mutating = needs order or disjoint scopes (ARD §3.1.3). */
export type ActivityKind = "readonly" | "mutating";

export type PowlActivity = {
  kind: "activity";
  id: string;
  label: string;
  objectType: string;
  targetFile?: string;
  /** Optional; bare activities default to readonly fan-out; `targetFile` ⇒ mutating singleton scope. */
  activityKind?: ActivityKind;
  fileScope?: string[];
};

export type PowlPartialOrder = {
  kind: "partial_order";
  id: string;
  children: PowlNode[];
  order: ReadonlyArray<readonly [string, string]>;
};

export type PowlNode =
  | PowlActivity
  | { kind: "tau"; id: string }
  | { kind: "xor"; id: string; branches: PowlNode[] }
  | { kind: "loop"; id: string; doBranch: PowlNode; redoBranch: PowlNode; maxIterations?: number }
  | PowlPartialOrder;

export interface WriteScopeViolation {
  a: string;
  b: string;
  overlap: string[];
}

/**
 * Transitive closure ≺⁺ encoded as `${u}->${v}` (ARD §3.1.2).
 * Stored edges need not be transitively closed; semantics use ≺⁺.
 */
export function transitiveClosure(
  nodes: readonly string[],
  edges: ReadonlyArray<readonly [string, string]>
): Set<string> {
  const adj = new Map<string, string[]>();
  for (const id of nodes) adj.set(id, []);
  for (const [u, v] of edges) {
    if (!adj.has(u)) adj.set(u, []);
    adj.get(u)!.push(v);
  }
  const closure = new Set<string>();
  for (const u of nodes) {
    const stack = [...(adj.get(u) ?? [])];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const v = stack.pop()!;
      if (seen.has(v)) continue;
      seen.add(v);
      closure.add(`${u}->${v}`);
      for (const w of adj.get(v) ?? []) stack.push(w);
    }
  }
  return closure;
}

/** Exact + simple trailing-`*` glob intersection approx for Explore (ARD §3.1.3). */
export function defaultResolveOverlap(a: string[], b: string[]): string[] {
  const overlap: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    if (!seen.has(s)) {
      seen.add(s);
      overlap.push(s);
    }
  };
  for (const x of a) {
    for (const y of b) {
      if (x === y) {
        push(x);
        continue;
      }
      if (x.endsWith("/*") && y.startsWith(x.slice(0, -1))) push(`${x}∩${y}`);
      else if (y.endsWith("/*") && x.startsWith(y.slice(0, -1))) push(`${x}∩${y}`);
      else if (x.endsWith("*") && y.startsWith(x.slice(0, -1))) push(`${x}∩${y}`);
      else if (y.endsWith("*") && x.startsWith(y.slice(0, -1))) push(`${x}∩${y}`);
    }
  }
  return overlap;
}

function effectiveActivityKind(a: PowlActivity): ActivityKind {
  if (a.activityKind) return a.activityKind;
  if (a.targetFile || (a.fileScope && a.fileScope.length > 0)) return "mutating";
  return "readonly";
}

function effectiveFileScope(a: PowlActivity): string[] {
  if (a.fileScope && a.fileScope.length > 0) return a.fileScope;
  if (a.targetFile) return [a.targetFile];
  return [];
}

interface SubtreeWriteScope {
  hasMutating: boolean;
  hasEmptyMutating: boolean;
  scopes: string[];
}

function collectSubtreeWriteScope(node: PowlNode): SubtreeWriteScope {
  if (node.kind === "activity") {
    if (effectiveActivityKind(node) !== "mutating") {
      return { hasMutating: false, hasEmptyMutating: false, scopes: [] };
    }
    const s = effectiveFileScope(node);
    return {
      hasMutating: true,
      hasEmptyMutating: s.length === 0,
      scopes: [...s]
    };
  }
  if (node.kind === "tau") {
    return { hasMutating: false, hasEmptyMutating: false, scopes: [] };
  }
  const children: PowlNode[] =
    node.kind === "xor"
      ? node.branches
      : node.kind === "loop"
        ? [node.doBranch, node.redoBranch]
        : node.children;
  let hasMutating = false;
  let hasEmptyMutating = false;
  const seen = new Set<string>();
  const scopes: string[] = [];
  for (const child of children) {
    const sub = collectSubtreeWriteScope(child);
    if (sub.hasMutating) hasMutating = true;
    if (sub.hasEmptyMutating) hasEmptyMutating = true;
    for (const f of sub.scopes) {
      if (!seen.has(f)) {
        seen.add(f);
        scopes.push(f);
      }
    }
  }
  return { hasMutating, hasEmptyMutating, scopes };
}

/**
 * WIP>1 safety: unordered mutating activities (including inside compound xor/loop/partial_order
 * descendants) must have disjoint write scopes (ARD §3.1.3).
 * Returns violations; callers fail-closed with WRITE_SCOPE_CONFLICT.
 */
export function validateDisjointWriteScopes(
  po: PowlPartialOrder,
  resolveOverlap: (a: string[], b: string[]) => string[] = defaultResolveOverlap
): WriteScopeViolation[] {
  const childIds = po.children.map((c) => c.id);
  const prec = transitiveClosure(childIds, po.order);
  const childScopes = po.children.map((c) => ({ node: c, scope: collectSubtreeWriteScope(c) }));
  const violations: WriteScopeViolation[] = [];

  for (let i = 0; i < childScopes.length; i++) {
    for (let j = i + 1; j < childScopes.length; j++) {
      const u = childScopes[i]!;
      const v = childScopes[j]!;
      if (!u.scope.hasMutating || !v.scope.hasMutating) continue;
      const ordered =
        prec.has(`${u.node.id}->${v.node.id}`) || prec.has(`${v.node.id}->${u.node.id}`);
      if (ordered) continue;
      if (
        u.scope.hasEmptyMutating ||
        v.scope.hasEmptyMutating ||
        u.scope.scopes.length === 0 ||
        v.scope.scopes.length === 0
      ) {
        violations.push({
          a: u.node.id,
          b: v.node.id,
          overlap: ["∅-scope (mutating activities require fileScope/targetFile when unordered)"]
        });
        continue;
      }
      const overlap = resolveOverlap(u.scope.scopes, v.scope.scopes);
      if (overlap.length > 0) violations.push({ a: u.node.id, b: v.node.id, overlap });
    }
  }
  return violations;
}

/**
 * Validates that every PartialOrder node in a POWL tree is a strict partial order
 * (irreflexive, asymmetric, acyclic) and all node IDs are unique.
 * Also enforces disjoint write scopes for unordered mutating activities (ARD §3.1.3).
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
      const scopeViolations = validateDisjointWriteScopes(node);
      if (scopeViolations.length > 0) {
        const v0 = scopeViolations[0]!;
        throw new Error(
          `WRITE_SCOPE_CONFLICT: POWL PO "${node.id}": unordered mutating activities "${v0.a}" and "${v0.b}" overlap ${JSON.stringify(v0.overlap)}`
        );
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
  /** For loop exit τ transitions: the owning PowlLoop node id. */
  loopExitFor?: string;
  objectType: string;
  targetFile?: string;
  activityKind?: ActivityKind;
  fileScope?: string[];
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

/**
 * Compiler-allocated transition ids live in the reserved `__powl_t_` namespace and
 * always include a monotonic seq, so structural τ prefixes cannot collide with
 * user node ids (e.g. tau id `enter_L` vs loop enter for `L`).
 */
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

  /** Unique transition id: reserved prefix + role + optional hint + seq. */
  const newTransitionId = (role: string, hint?: string): string => {
    seq += 1;
    return hint !== undefined
      ? `__powl_t_${role}_${hint}_${seq}`
      : `__powl_t_${role}_${seq}`;
  };

  const addTransition = (t: Transition, inputs: string[], outputs: string[]) => {
    if (pre.has(t.id) || post.has(t.id) || transitions.some((x) => x.id === t.id)) {
      throw new Error(`POWL compile: duplicate transition id "${t.id}" (fail-closed)`);
    }
    transitions.push(t);
    pre.set(t.id, inputs);
    post.set(t.id, outputs);
  };

  const compile = (node: PowlNode, startP: string, endP: string) => {
    if (node.kind === "activity") {
      const kind = effectiveActivityKind(node);
      const scope = effectiveFileScope(node);
      addTransition(
        {
          id: newTransitionId("act", node.id),
          label: node.label,
          silent: false,
          activityId: node.id,
          objectType: node.objectType,
          targetFile: node.targetFile,
          activityKind: kind,
          ...(scope.length > 0 ? { fileScope: scope } : {})
        },
        [startP],
        [endP]
      );
      return;
    }
    if (node.kind === "tau") {
      addTransition(
        { id: newTransitionId("tau", node.id), label: "τ", silent: true, objectType: "Workflow" },
        [startP],
        [endP]
      );
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
      addTransition(
        { id: newTransitionId("enter", node.id), label: "τ_enter", silent: true, objectType: "Workflow" },
        [startP],
        [loopEntry]
      );
      compile(node.doBranch, loopEntry, loopChoice);
      compile(node.redoBranch, loopChoice, loopEntry);
      addTransition(
        {
          id: newTransitionId("exit", node.id),
          label: "τ_exit",
          silent: true,
          loopExitFor: node.id,
          objectType: "Workflow"
        },
        [loopChoice],
        [endP]
      );
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

      // Deduplicate node.order and compute its transitive reduction (Hasse diagram)
      // before allocating ord_* places.
      const childIds = node.children.map((c) => c.id);
      const uniqueEdges: Array<readonly [string, string]> = [];
      const seenEdges = new Set<string>();
      for (const [u, v] of node.order) {
        const key = `${u}->${v}`;
        if (!seenEdges.has(key)) {
          seenEdges.add(key);
          uniqueEdges.push([u, v]);
        }
      }
      const closure = transitiveClosure(childIds, uniqueEdges);
      const reducedOrder = uniqueEdges.filter(([u, v]) => {
        for (const w of childIds) {
          if (w !== u && w !== v && closure.has(`${u}->${w}`) && closure.has(`${w}->${v}`)) {
            return false;
          }
        }
        return true;
      });

      const orderPlaces = new Map<string, string[]>();
      for (const c of node.children) orderPlaces.set(c.id, []);
      for (const [u, v] of reducedOrder) {
        outEdges.get(u)!.push(v);
        inEdges.get(v)!.push(u);
      }

      const roots = node.children.filter((c) => inEdges.get(c.id)!.length === 0);
      const leaves = node.children.filter((c) => outEdges.get(c.id)!.length === 0);

      // Fork from startP to all minimal elements
      addTransition(
        { id: newTransitionId("fork", node.id), label: "τ_fork", silent: true, objectType: "Workflow" },
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
          {
            id: newTransitionId("join", `${node.id}_${v.id}`),
            label: `τ_join(${v.id})`,
            silent: true,
            objectType: "Workflow"
          },
          predSyncPlaces,
          [childStart.get(v.id)!]
        );
      }

      // Fan-out from each non-leaf u_end to its outgoing order places
      for (const u of node.children) {
        const outs = orderPlaces.get(u.id)!;
        if (outs.length === 0) continue;
        addTransition(
          {
            id: newTransitionId("split", `${node.id}_${u.id}`),
            label: `τ_split(${u.id})`,
            silent: true,
            objectType: "Workflow"
          },
          [childEnd.get(u.id)!],
          outs
        );
      }

      // Join all maximal elements into endP
      addTransition(
        { id: newTransitionId("end", node.id), label: "τ_end", silent: true, objectType: "Workflow" },
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

export interface StructuralSoundnessResult {
  optionToComplete: boolean;
  properCompletion: boolean;
  noDeadTransitions: boolean;
  /** Set to false when van der Aalst WF-Net structural preconditions fail (•i = ∅, o• = ∅, i-to-o connectedness). */
  wfNetValid?: boolean;
  /** Set to true when reachability BFS hit MAX_STATES before exhausting the state space. */
  truncated?: boolean;
  /** Set to "UNKNOWN" when truncated before completing reachability exploration. */
  standing?: "SOUND" | "UNSOUND" | "UNKNOWN";
}

function checkWfNetStructuralPreconditions(net: WorkflowNet): boolean {
  const placeSet = new Set(net.places.map((p) => p.id));
  if (!placeSet.has(net.sourcePlace) || !placeSet.has(net.sinkPlace)) return false;
  if (net.sourcePlace === net.sinkPlace) return false;

  const fwd = new Map<string, string[]>();
  const rev = new Map<string, string[]>();
  const addEdge = (from: string, to: string) => {
    if (!fwd.has(from)) fwd.set(from, []);
    fwd.get(from)!.push(to);
    if (!rev.has(to)) rev.set(to, []);
    rev.get(to)!.push(from);
  };

  for (const t of net.transitions) {
    const tNode = `t:${t.id}`;
    const inputs = net.pre.get(t.id) ?? [];
    const outputs = net.post.get(t.id) ?? [];
    for (const p of inputs) {
      if (!placeSet.has(p)) return false;
      // o• = ∅: sinkPlace must have no outgoing arcs
      if (p === net.sinkPlace) return false;
      addEdge(`p:${p}`, tNode);
    }
    for (const p of outputs) {
      if (!placeSet.has(p)) return false;
      // •i = ∅: sourcePlace must have no incoming arcs
      if (p === net.sourcePlace) return false;
      addEdge(tNode, `p:${p}`);
    }
  }

  const bfs = (start: string, adj: Map<string, string[]>): Set<string> => {
    const seen = new Set<string>([start]);
    const q = [start];
    let head = 0;
    while (head < q.length) {
      const cur = q[head++]!;
      for (const nxt of adj.get(cur) ?? []) {
        if (!seen.has(nxt)) {
          seen.add(nxt);
          q.push(nxt);
        }
      }
    }
    return seen;
  };

  const fromSource = bfs(`p:${net.sourcePlace}`, fwd);
  const toSink = bfs(`p:${net.sinkPlace}`, rev);

  for (const p of net.places) {
    const key = `p:${p.id}`;
    if (!fromSource.has(key) || !toSink.has(key)) return false;
  }
  for (const t of net.transitions) {
    const key = `t:${t.id}`;
    if (!fromSource.has(key) || !toSink.has(key)) return false;
  }
  return true;
}

/**
 * Soundness-preserving Murata series/parallel reduction pre-pass (FPT, FPP, FSP, FST).
 * Operates on a working copy so the caller's WorkflowNet is never mutated.
 */
function murataReduceWorkflowNet(net: WorkflowNet): WorkflowNet {
  let places = net.places.map((p) => ({ ...p }));
  let transitions = net.transitions.map((t) => ({ ...t }));
  const pre = new Map<string, string[]>();
  const post = new Map<string, string[]>();
  for (const t of transitions) {
    pre.set(t.id, [...(net.pre.get(t.id) ?? [])]);
    post.set(t.id, [...(net.post.get(t.id) ?? [])]);
  }

  const sig = (xs: string[]): string => [...xs].sort().join("\0");

  let changed = true;
  while (changed) {
    changed = false;

    // 1. Fusion of Parallel Transitions (FPT): identical pre and post multisets
    const seenT = new Map<string, string>();
    const keepT: Transition[] = [];
    for (const t of transitions) {
      const key = `${sig(pre.get(t.id) ?? [])}=>${sig(post.get(t.id) ?? [])}`;
      if (seenT.has(key)) {
        pre.delete(t.id);
        post.delete(t.id);
        changed = true;
      } else {
        seenT.set(key, t.id);
        keepT.push(t);
      }
    }
    transitions = keepT;
    if (changed) continue;

    // Build place incidence maps
    const pIn = new Map<string, string[]>();
    const pOut = new Map<string, string[]>();
    for (const p of places) {
      pIn.set(p.id, []);
      pOut.set(p.id, []);
    }
    for (const t of transitions) {
      for (const p of pre.get(t.id) ?? []) pOut.get(p)?.push(t.id);
      for (const p of post.get(t.id) ?? []) pIn.get(p)?.push(t.id);
    }

    // 2. Fusion of Parallel Places (FPP): non-boundary places with identical preset & postset
    const seenP = new Map<string, string>();
    const removedP = new Set<string>();
    for (const p of places) {
      if (p.id === net.sourcePlace || p.id === net.sinkPlace) continue;
      const key = `${sig(pIn.get(p.id) ?? [])}=>${sig(pOut.get(p.id) ?? [])}`;
      if (seenP.has(key)) {
        removedP.add(p.id);
        changed = true;
      } else {
        seenP.set(key, p.id);
      }
    }
    if (removedP.size > 0) {
      places = places.filter((p) => !removedP.has(p.id));
      for (const t of transitions) {
        pre.set(t.id, (pre.get(t.id) ?? []).filter((p) => !removedP.has(p)));
        post.set(t.id, (post.get(t.id) ?? []).filter((p) => !removedP.has(p)));
      }
      continue;
    }

    // 3. Fusion of Series Places (FSP): p1 -> t -> p2 where p1• = {t} and •p2 = {t}
    for (const t of transitions) {
      const ins = pre.get(t.id) ?? [];
      const outs = post.get(t.id) ?? [];
      if (ins.length !== 1 || outs.length !== 1) continue;
      const p1 = ins[0]!;
      const p2 = outs[0]!;
      if (p1 === p2) continue;
      if (p1 === net.sourcePlace && p2 === net.sinkPlace) continue;
      if ((pOut.get(p1)?.length ?? 0) !== 1 || (pIn.get(p2)?.length ?? 0) !== 1) continue;

      transitions = transitions.filter((x) => x.id !== t.id);
      pre.delete(t.id);
      post.delete(t.id);

      if (p2 === net.sinkPlace) {
        // Redirect all outputs to p1 -> p2, remove p1
        places = places.filter((p) => p.id !== p1);
        for (const other of transitions) {
          post.set(other.id, (post.get(other.id) ?? []).map((p) => (p === p1 ? p2 : p)));
        }
      } else {
        // Redirect all inputs from p2 -> p1, remove p2
        places = places.filter((p) => p.id !== p2);
        for (const other of transitions) {
          pre.set(other.id, (pre.get(other.id) ?? []).map((p) => (p === p2 ? p1 : p)));
        }
      }
      changed = true;
      break;
    }
    if (changed) continue;

    // 4. Fusion of Series Transitions (FST): t1 -> p -> t2 where t1• = {p} and •t2 = {p}
    for (const p of places) {
      if (p.id === net.sourcePlace || p.id === net.sinkPlace) continue;
      const ins = pIn.get(p.id) ?? [];
      const outs = pOut.get(p.id) ?? [];
      if (ins.length !== 1 || outs.length !== 1) continue;
      const t1 = ins[0]!;
      const t2 = outs[0]!;
      if (t1 === t2) continue;
      if ((post.get(t1)?.length ?? 0) !== 1 || (pre.get(t2)?.length ?? 0) !== 1) continue;

      post.set(t1, [...(post.get(t2) ?? [])]);
      transitions = transitions.filter((x) => x.id !== t2);
      pre.delete(t2);
      post.delete(t2);
      places = places.filter((x) => x.id !== p.id);
      changed = true;
      break;
    }
  }

  return {
    places,
    transitions,
    pre,
    post,
    sourcePlace: net.sourcePlace,
    sinkPlace: net.sinkPlace
  };
}

/**
 * Defensive WF-net soundness checker (van der Aalst):
 *   1. Structural WF-Net preconditions (•i = ∅, o• = ∅, every node on an i->o path).
 *   2. Soundness-preserving Murata series/parallel reduction pre-pass.
 *   3. Finite reachability BFS with O(1) head-index cursors and explicit truncation status.
 * Explore dry-run Exp-1 / ARD §3.2.3.
 */
export function verifyStructuralSoundness(net: WorkflowNet): StructuralSoundnessResult {
  if (!checkWfNetStructuralPreconditions(net)) {
    return {
      optionToComplete: false,
      properCompletion: false,
      noDeadTransitions: false,
      wfNetValid: false
    };
  }

  const reduced = murataReduceWorkflowNet(net);
  const placeIds = reduced.places.map((p) => p.id);
  const placeIndex = new Map(placeIds.map((id, i) => [id, i] as const));
  const n = placeIds.length;
  const sourceIdx = placeIndex.get(reduced.sourcePlace);
  const sinkIdx = placeIndex.get(reduced.sinkPlace);
  if (sourceIdx === undefined || sinkIdx === undefined) {
    return {
      optionToComplete: false,
      properCompletion: false,
      noDeadTransitions: false,
      wfNetValid: false
    };
  }

  const encode = (marking: number[]): string => marking.join(",");
  const initial = new Array<number>(n).fill(0);
  initial[sourceIdx] = 1;

  const enabled = (marking: number[], t: Transition): boolean => {
    const inputs = reduced.pre.get(t.id) ?? [];
    return inputs.every((p) => {
      const i = placeIndex.get(p);
      return i !== undefined && marking[i]! >= 1;
    });
  };

  const fire = (marking: number[], t: Transition): number[] => {
    const next = marking.slice();
    for (const p of reduced.pre.get(t.id) ?? []) {
      next[placeIndex.get(p)!]! -= 1;
    }
    for (const p of reduced.post.get(t.id) ?? []) {
      next[placeIndex.get(p)!]! += 1;
    }
    return next;
  };

  const visited = new Map<string, number[]>();
  const queue: number[][] = [initial];
  let qHead = 0;
  visited.set(encode(initial), initial);
  const fired = new Set<string>();
  const MAX_STATES = 50_000;

  while (qHead < queue.length) {
    if (visited.size > MAX_STATES) {
      return {
        optionToComplete: false,
        properCompletion: false,
        noDeadTransitions: false,
        truncated: true,
        standing: "UNKNOWN"
      };
    }
    const m = queue[qHead++]!;
    for (const t of reduced.transitions) {
      if (!enabled(m, t)) continue;
      fired.add(t.id);
      const next = fire(m, t);
      const key = encode(next);
      if (!visited.has(key)) {
        visited.set(key, next);
        queue.push(next);
      }
    }
  }

  const isSinkOnly = (m: number[]): boolean =>
    m[sinkIdx] === 1 && m.every((tokens, i) => (i === sinkIdx ? tokens === 1 : tokens === 0));

  const sinkKeys = [...visited.entries()].filter(([, m]) => m[sinkIdx]! >= 1).map(([k]) => k);
  const properCompletion = sinkKeys.every((k) => isSinkOnly(visited.get(k)!));

  // Reverse BFS from sink-only marking over the reachability graph edges.
  const reverseAdj = new Map<string, string[]>();
  for (const [key, m] of visited) {
    for (const t of reduced.transitions) {
      if (!enabled(m, t)) continue;
      const nextKey = encode(fire(m, t));
      if (!reverseAdj.has(nextKey)) reverseAdj.set(nextKey, []);
      reverseAdj.get(nextKey)!.push(key);
    }
  }
  const canReachSink = new Set<string>();
  const sinkOnlyKey = encode(
    (() => {
      const m = new Array<number>(n).fill(0);
      m[sinkIdx] = 1;
      return m;
    })()
  );
  if (visited.has(sinkOnlyKey)) {
    const rq = [sinkOnlyKey];
    let rqHead = 0;
    canReachSink.add(sinkOnlyKey);
    while (rqHead < rq.length) {
      const cur = rq[rqHead++]!;
      for (const pred of reverseAdj.get(cur) ?? []) {
        if (!canReachSink.has(pred)) {
          canReachSink.add(pred);
          rq.push(pred);
        }
      }
    }
  }
  const optionToComplete = visited.size > 0 && [...visited.keys()].every((k) => canReachSink.has(k));
  const noDeadTransitions = reduced.transitions.every((t) => fired.has(t.id));

  return { optionToComplete, properCompletion, noDeadTransitions };
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
 * Discovers peak API equilibrium online — zero user-configurable concurrency knobs.
 * Separates transport-layer congestion (TTFT / RPM / TPM / 429) from
 * heavy-tailed coding turn service times (c_s^2 >> 1) to maximize lambda_alive.
 *
 * MD is transport/API-health only (connect timeout, 429, TTFT/RPM/TPM). Heavy-tailed task
 * duration (`serviceMs > 2× median`) must never trigger MD — coding build/test
 * transitions are class-dependent and routinely exceed that threshold under
 * healthy transport (ARD §5.3 / EU AI Act robustness: no false congestion backoff).
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

  /** Median serviceMs in the rolling window (telemetry only; not an MD signal). */
  medianServiceMs(): number {
    return this.scheduler.medianServiceMs();
  }

  onSuccess(
    serviceMs: number,
    transport?: TransportTelemetrySample
  ): { changed: boolean; oldWip: number; newWip: number; reason: string; ttftMdTriggered: boolean } {
    const decision = this.scheduler.onSuccess(serviceMs, transport);
    const hasTransportTelemetry =
      transport !== undefined &&
      (transport.ttftMs !== undefined ||
        transport.rpmHeadroomRatio !== undefined ||
        transport.tpmHeadroomRatio !== undefined ||
        transport.interArrivalMs !== undefined);
    if (!hasTransportTelemetry && !decision.ttftMdTriggered) {
      const nextWip = decision.oldWip + 1;
      this.scheduler.wip = nextWip;
      this.scheduler.peakEquilibriumWip = Math.max(this.scheduler.peakEquilibriumWip, nextWip);
      return {
        changed: nextWip !== decision.oldWip,
        oldWip: decision.oldWip,
        newWip: nextWip,
        reason: "clean_completion_ai",
        ttftMdTriggered: false
      };
    }
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


/** Rozinat/van der Aalst token conservation: produced + missing = consumed + remaining. */
export function tokenConservationHolds(replay: ReplayMetrics): boolean {
  return replay.produced + replay.missing === replay.consumed + replay.remaining;
}

/** Deep-freeze a value so post-hash OCEL snapshots cannot silently diverge from ocelSha256. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
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

  const sharesPre = (a: Transition, b: Transition): boolean => {
    const preA = new Set(net.pre.get(a.id) ?? []);
    return (net.pre.get(b.id) ?? []).some((p) => preA.has(p));
  };

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

  /** Loop ids → max do-iterations (default 1: do once, then τ_exit). */
  const loopMaxIterations = new Map<string, number>();
  const loopDoCompletions = new Map<string, number>();
  const walkLoops = (node: PowlNode) => {
    if (node.kind === "loop") {
      loopMaxIterations.set(node.id, Math.max(1, node.maxIterations ?? 1));
      loopDoCompletions.set(node.id, 0);
      walkLoops(node.doBranch);
      walkLoops(node.redoBranch);
    } else if (node.kind === "xor") {
      node.branches.forEach(walkLoops);
    } else if (node.kind === "partial_order") {
      node.children.forEach(walkLoops);
    }
  };
  walkLoops(root);

  const bottlenecks: Array<{ transitionId: string; serviceMs: number }> = [];
  const executedActivities: string[] = [];
  const inFlight = new Set<Promise<void>>();
  let haltedOnFailure = false;
  let refusalCode: string | undefined;
  let rolledBackCount = 0;
  /** Executor-requested redo for the next loop choice (VdA free-choice). */
  let pendingRedo = false;
  /** Loop ids whose choice place must yield to redo this visit. */
  const redoArmedLoops = new Set<string>();

  /**
   * Fire silent transitions that do not resolve a free choice.
   * A silent t fires only when no other enabled transition (silent or visible)
   * shares an input place — otherwise drainSilent would kill redoBranch,
   * starve XOR visibles, or livelock loop(τ,τ).
   */
  const drainSilent = () => {
    let fired = true;
    while (fired) {
      fired = false;
      const enabledAll = net.transitions.filter((t) => isEnabled(t));
      for (const t of enabledAll) {
        if (!t.silent) continue;
        const lid = t.loopExitFor;
        if (lid && redoArmedLoops.has(lid)) continue;
        const contested = enabledAll.some((o) => o.id !== t.id && sharesPre(t, o));
        if (contested) continue;
        fireSilent(t);
        fired = true;
        break;
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

  /**
   * Resolve PowlLoop choice places (τ_exit vs redo) and silent XOR free choices.
   * Default: exit after each do unless pendingRedo && completions < maxIterations.
   */
  const resolveFreeChoices = (): boolean => {
    let progress = false;

    for (const exit of net.transitions) {
      const loopId = exit.loopExitFor;
      if (!loopId || !isEnabled(exit)) continue;
      if (redoArmedLoops.has(loopId)) continue;

      const maxIt = loopMaxIterations.get(loopId) ?? 1;
      const done = (loopDoCompletions.get(loopId) ?? 0) + 1;
      const allowRedo = pendingRedo && done < maxIt;
      if (allowRedo) {
        // Arm once; do not report progress (no marking change) to avoid spin.
        if (!redoArmedLoops.has(loopId)) {
          loopDoCompletions.set(loopId, done);
          pendingRedo = false;
          redoArmedLoops.add(loopId);
        }
        continue;
      }
      loopDoCompletions.set(loopId, done);
      pendingRedo = false;
      fireSilent(exit);
      progress = true;
    }

    // Silent XOR (or silent redo τ) with no visible competitor: fire exactly one.
    if (!net.transitions.some((t) => !t.silent && isEnabled(t))) {
      const enabledSilent = net.transitions.filter((t) => {
        if (!t.silent || !isEnabled(t)) return false;
        const lid = t.loopExitFor;
        if (lid && redoArmedLoops.has(lid)) return false;
        return true;
      });
      if (enabledSilent.length > 0) {
        const armedRedo = enabledSilent.find((t) =>
          [...redoArmedLoops].some((lid) => {
            const exit = net.transitions.find((x) => x.loopExitFor === lid);
            return exit ? sharesPre(t, exit) : false;
          })
        );
        const pick = armedRedo ?? enabledSilent[0]!;
        for (const lid of [...redoArmedLoops]) {
          const exit = net.transitions.find((x) => x.loopExitFor === lid);
          if (exit && sharesPre(pick, exit)) redoArmedLoops.delete(lid);
        }
        fireSilent(pick);
        progress = true;
      }
    }

    return progress;
  };

  while (!haltedOnFailure) {
    drainSilent();
    while (resolveFreeChoices()) drainSilent();
    if ((marking.get(net.sinkPlace) ?? 0) >= 1 && inFlight.size === 0) break;

    // Suppress visibles that compete with an unarmed τ_exit (exit wins by default).
    // When redo is armed, allow the competing visible redo branch.
    const enabledVisible = net.transitions.filter((t) => {
      if (t.silent || !isEnabled(t)) return false;
      const blockingExit = net.transitions.find((x) => {
        const lid = x.loopExitFor;
        return Boolean(lid && isEnabled(x) && sharesPre(t, x) && !redoArmedLoops.has(lid));
      });
      return !blockingExit;
    });
    if (enabledVisible.length === 0 && inFlight.size === 0) {
      if (redoArmedLoops.size > 0) {
        redoArmedLoops.clear();
        continue;
      }
      break;
    }

    const effectiveWip = options.workspaceDir ? 1 : aimd.wip;

    for (const t of enabledVisible) {
      if (inFlight.size >= effectiveWip) break;
      // Re-check enablement after prior reserves in this WIP window (XOR safety).
      if (!isEnabled(t)) continue;

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
        const cur = marking.get(p) ?? 0;
        if (cur < 1) {
          missing += 1;
          haltedOnFailure = true;
          break;
        }
        marking.set(p, cur - 1);
        consumed += 1;
      }
      if (haltedOnFailure) {
        snap?.dispose();
        break;
      }

      // Visible redo consumed the loop-choice token.
      for (const lid of [...redoArmedLoops]) {
        const exit = net.transitions.find((x) => x.loopExitFor === lid);
        if (exit && sharesPre(t, exit)) redoArmedLoops.delete(lid);
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

        const restoreReservedTokens = () => {
          // Abort fire: restore reserved tokens to input places and undo their consume
          // counts so Rozinat conservation (p+m = c+r) holds. Incompleteness is then
          // carried by remaining > 0 (fitness < 1.0) without a phantom sink missing.
          for (const p of net.pre.get(t.id) ?? []) {
            marking.set(p, (marking.get(p) ?? 0) + 1);
            if (consumed > 0) consumed -= 1;
          }
        };

        if (res?.ok) {
          snap?.dispose();
          for (const p of net.post.get(t.id) ?? []) {
            marking.set(p, (marking.get(p) ?? 0) + 1);
            produced += 1;
          }
          if (res.redo) pendingRedo = true;
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
            for (const rel of rb.event.relationships) {
              ensureObject(rel.objectId, "workspace_snapshot");
            }
            emitEvent(
              rb.event.type,
              rb.event.attributes,
              [{ objectId: wfObj.id, qualifier: "workflow" }, ...rb.event.relationships]
            );
          } catch (rbErr) {
            snap.dispose();
            haltedOnFailure = true;
            restoreReservedTokens();
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
            restoreReservedTokens();
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
          restoreReservedTokens();
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

  // Consume final token in sinkPlace if present. On a fail-closed halt the net never
  // reached the sink; do not invent a missing sink token (that broke p+m=c+r).
  const sinkTokens = marking.get(net.sinkPlace) ?? 0;
  if (sinkTokens >= 1) {
    marking.set(net.sinkPlace, sinkTokens - 1);
    consumed += 1;
  } else if (!haltedOnFailure) {
    missing += 1;
  }

  let remaining = 0;
  let negativeMarking = false;
  for (const count of marking.values()) {
    if (count < 0) negativeMarking = true;
    remaining += Math.max(0, count);
  }

  const fitness =
    0.5 * (1 - (consumed > 0 ? missing / consumed : 0)) +
    0.5 * (1 - (produced > 0 ? remaining / produced : 0));
  const soundTermination =
    missing === 0 && remaining === 0 && !negativeMarking && !haltedOnFailure;

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
      { name: "Artifact", attributes: [{ name: "standing", type: "string" }] },
      { name: "workspace_snapshot", attributes: [] }
    ],
    eventTypes: [
      {
        name: "transition_fired",
        attributes: [
          { name: "transition", type: "string" },
          { name: "label", type: "string" },
          { name: "wip", type: "string" }
        ]
      },
      {
        name: "transition_completed",
        attributes: [
          { name: "transition", type: "string" },
          { name: "service_ms", type: "string" },
          { name: "wip", type: "string" },
          { name: "aimd_reason", type: "string" },
          { name: "cs2", type: "string" },
          { name: "rho", type: "string" },
          { name: "lambda_alive", type: "string" },
          { name: "ttft_ms", type: "string" }
        ]
      },
      {
        name: "transition_refused",
        attributes: [
          { name: "transition", type: "string" },
          { name: "reason", type: "string" },
          { name: "signature", type: "string" },
          { name: "detail", type: "string" }
        ]
      },
      {
        name: "wip_backoff",
        attributes: [
          { name: "transition", type: "string" },
          { name: "old_wip", type: "string" },
          { name: "new_wip", type: "string" },
          { name: "reason", type: "string" },
          { name: "signature", type: "string" }
        ]
      },
      {
        name: "workspace_rolled_back",
        attributes: [
          { name: "reason", type: "string" },
          { name: "step_id", type: "string" },
          { name: "snapshot_sha256", type: "string" },
          { name: "files_restored", type: "string" },
          { name: "files_removed", type: "string" }
        ]
      },
      {
        name: "retry_budget_exhausted",
        attributes: [
          { name: "transition", type: "string" },
          { name: "signature", type: "string" },
          { name: "detail", type: "string" }
        ]
      }
    ],
    objects: [...objects.values()],
    events
  };

  const ocelJson = JSON.stringify(ocel, null, 2);
  const ocelSha256 = createHash("sha256").update(ocelJson).digest("hex");
  // Detach + freeze so callers cannot mutate the hashed log (EU AI Act record accuracy).
  const ocelSnapshot = deepFreeze(JSON.parse(ocelJson) as Ocel2Log);

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
    ocel: ocelSnapshot,
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
        const mutableOcel = JSON.parse(JSON.stringify(res.ocel)) as Ocel2Log;
        mutableOcel.events.push({
          id: `e_${String(mutableOcel.events.length + 1).padStart(5, "0")}`,
          type: "retry_budget_exhausted",
          time: new Date().toISOString(),
          attributes: [
            { name: "signature", value: sharedLimiter.normalizeSignature(`cycle_refusal:${detail}`) },
            { name: "detail", value: err instanceof Error ? err.message : String(err) }
          ],
          relationships: []
        });
        const updatedOcelJson = JSON.stringify(mutableOcel, null, 2);
        res.ocel = deepFreeze(mutableOcel);
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
