import {
  compilePowlToWorkflowNet,
  type Place,
  type PowlNode,
  type Transition,
  type WorkflowNet
} from "../powl-ocel-orchestrator.ts";

export interface ConformanceAttributeLike {
  name: string;
  value: unknown;
  time?: string;
}

export interface ConformanceRelationshipLike {
  objectId: string;
  qualifier: string;
}

export interface ConformanceOcelObjectLike {
  id: string;
  type: string;
  attributes: readonly ConformanceAttributeLike[] | readonly unknown[] | Record<string, unknown>;
  relationships?: readonly ConformanceRelationshipLike[] | readonly unknown[];
}

export interface ConformanceOcelEventLike {
  id: string;
  type: string;
  time: string;
  attributes?: readonly ConformanceAttributeLike[] | Record<string, unknown>;
  relationships?: readonly ConformanceRelationshipLike[];
}

export interface ConformanceOcelDocLike {
  objects?: readonly ConformanceOcelObjectLike[];
  events: readonly ConformanceOcelEventLike[];
}

export interface WorkflowNetJson {
  places: Array<{ id: string; objectType?: string }>;
  transitions: Array<{
    id: string;
    label: string;
    silent: boolean;
    activityId?: string;
    objectType?: string;
    targetFile?: string;
  }>;
  pre: Record<string, string[]>;
  post: Record<string, string[]>;
  sourcePlace: string;
  sinkPlace: string;
}

export type WorkflowNetLike = WorkflowNet | WorkflowNetJson;

export interface NormalizedWorkflowNet {
  places: Place[];
  transitions: Transition[];
  placeIndex: Map<string, number>;
  transitionIndex: Map<string, number>;
  preIndices: number[][];
  postIndices: number[][];
  sourceIdx: number;
  sinkIdx: number;
  sourcePlace: string;
  sinkPlace: string;
  minVisibleDistToSink: number[];
}

export type AlignmentMoveKind = "sync" | "log_move" | "model_move";

export interface AlignmentMove {
  kind: AlignmentMoveKind;
  activity: string;
  transitionId?: string;
  eventId?: string;
  cost: number;
}

export interface AlignmentDeviation {
  kind: "log_move" | "model_move";
  category: "skipped_test" | "missing_step" | "out_of_scope_write" | "unauthorized_tool" | "unexpected_step";
  activity: string;
  transitionId?: string;
  eventId?: string;
  detail: string;
}

export interface AlignmentOptions {
  syncCost?: number;
  logMoveCost?: number;
  modelMoveCost?: number;
  silentCost?: number;
  maxStates?: number;
  maxTokensPerPlace?: number;
  includeSilentMoves?: boolean;
}

export interface AlignmentResult {
  method: "a_star_alignment";
  traceLength: number;
  alignmentCost: number;
  worstCaseCost: number;
  fitness: number;
  escapingEdgesPrecision: number;
  precision: number;
  syncMoves: number;
  logMoves: number;
  modelMoves: number;
  moves: AlignmentMove[];
  deviations: AlignmentDeviation[];
  statesExplored: number;
  optimal: boolean;
}

export interface CaseAlignmentSummary {
  caseId: string;
  objectType: string;
  traceLength: number;
  alignmentCost: number;
  fitness: number;
  syncMoves: number;
  logMoves: number;
  modelMoves: number;
  moves: AlignmentMove[];
  deviations: AlignmentDeviation[];
}

export interface AlignmentConformanceReport {
  method: "a_star_alignment";
  objectType: string;
  caseCount: number;
  alignmentCost: number;
  fitness: number;
  escapingEdgesPrecision: number;
  precision: number;
  syncMoves: number;
  logMoves: number;
  modelMoves: number;
  moves: AlignmentMove[];
  deviations: AlignmentDeviation[];
  cases: CaseAlignmentSummary[];
}

function isPowlNode(input: WorkflowNetLike | PowlNode): input is PowlNode {
  return typeof input === "object" && input !== null && "kind" in input;
}

function getArcList(
  mapOrRecord: Map<string, string[]> | Record<string, string[]>,
  key: string
): string[] {
  if (mapOrRecord instanceof Map) {
    return mapOrRecord.get(key) ?? [];
  }
  if (Object.prototype.hasOwnProperty.call(mapOrRecord, key)) {
    const val = mapOrRecord[key];
    return Array.isArray(val) ? val : [];
  }
  return [];
}

function computeBackwardMinVisibleDist(
  numPlaces: number,
  transitions: readonly Transition[],
  preIndices: readonly number[][],
  postIndices: readonly number[][],
  sinkIdx: number
): number[] {
  const dist = new Array<number>(numPlaces).fill(Number.POSITIVE_INFINITY);
  dist[sinkIdx] = 0;

  // Bellman-Ford / 0-1 relaxation over place distances
  let changed = true;
  let guard = 0;
  const maxIter = numPlaces * (transitions.length + 1) + 4;
  while (changed && guard < maxIter) {
    changed = false;
    guard += 1;
    for (let ti = 0; ti < transitions.length; ti++) {
      const posts = postIndices[ti]!;
      const pres = preIndices[ti]!;
      if (posts.length === 0 || pres.length === 0) continue;
      let minPostDist = Number.POSITIVE_INFINITY;
      for (const q of posts) {
        if (dist[q]! < minPostDist) minPostDist = dist[q]!;
      }
      if (!Number.isFinite(minPostDist)) continue;
      const w = transitions[ti]!.silent ? 0 : 1;
      const cand = minPostDist + w;
      for (const p of pres) {
        if (cand < dist[p]!) {
          dist[p] = cand;
          changed = true;
        }
      }
    }
  }

  return dist;
}

export function normalizeWorkflowNet(input: WorkflowNetLike | PowlNode): NormalizedWorkflowNet {
  const wf: WorkflowNetLike = isPowlNode(input) ? compilePowlToWorkflowNet(input) : input;

  if (!wf || !Array.isArray(wf.places) || wf.places.length === 0) {
    throw new Error("Invalid wfnet: places must be a non-empty array");
  }
  if (!Array.isArray(wf.transitions)) {
    throw new Error("Invalid wfnet: transitions must be an array");
  }
  if (typeof wf.sourcePlace !== "string" || wf.sourcePlace.length === 0) {
    throw new Error("Invalid wfnet: sourcePlace must be a non-empty string");
  }
  if (typeof wf.sinkPlace !== "string" || wf.sinkPlace.length === 0) {
    throw new Error("Invalid wfnet: sinkPlace must be a non-empty string");
  }

  const placeIndex = new Map<string, number>();
  const places: Place[] = [];
  for (const p of wf.places) {
    if (!p || typeof p.id !== "string" || p.id.length === 0) {
      throw new Error("Invalid wfnet: every place must have a non-empty id");
    }
    if (placeIndex.has(p.id)) {
      throw new Error(`Invalid wfnet: duplicate place id "${p.id}"`);
    }
    placeIndex.set(p.id, places.length);
    places.push({ id: p.id, objectType: p.objectType ?? "Workflow" });
  }

  if (!placeIndex.has(wf.sourcePlace)) {
    throw new Error(`Invalid wfnet: sourcePlace "${wf.sourcePlace}" is not declared in places`);
  }
  if (!placeIndex.has(wf.sinkPlace)) {
    throw new Error(`Invalid wfnet: sinkPlace "${wf.sinkPlace}" is not declared in places`);
  }
  if (wf.sourcePlace === wf.sinkPlace) {
    throw new Error(`Unsound wfnet: sourcePlace "${wf.sourcePlace}" cannot equal sinkPlace`);
  }

  const transitions: Transition[] = [];
  const transitionIndex = new Map<string, number>();
  const preIndices: number[][] = [];
  const postIndices: number[][] = [];

  for (const t of wf.transitions) {
    if (!t || typeof t.id !== "string" || t.id.length === 0) {
      throw new Error("Invalid wfnet: every transition must have a non-empty id");
    }
    if (transitionIndex.has(t.id)) {
      throw new Error(`Invalid wfnet: duplicate transition id "${t.id}"`);
    }
    const preList = getArcList(wf.pre, t.id);
    const postList = getArcList(wf.post, t.id);
    if (preList.length === 0 || postList.length === 0) {
      throw new Error(`Unsound wfnet: transition "${t.id}" must have at least one pre and one post place`);
    }

    const preIdx: number[] = [];
    for (const pid of preList) {
      const idx = placeIndex.get(pid);
      if (idx === undefined) {
        throw new Error(`Invalid wfnet: transition "${t.id}" pre references unknown place "${pid}"`);
      }
      preIdx.push(idx);
    }
    const postIdx: number[] = [];
    for (const pid of postList) {
      const idx = placeIndex.get(pid);
      if (idx === undefined) {
        throw new Error(`Invalid wfnet: transition "${t.id}" post references unknown place "${pid}"`);
      }
      postIdx.push(idx);
    }

    transitionIndex.set(t.id, transitions.length);
    transitions.push({
      id: t.id,
      label: t.label,
      silent: Boolean(t.silent),
      activityId: t.activityId,
      objectType: t.objectType ?? "Workflow",
      targetFile: t.targetFile
    });
    preIndices.push(preIdx);
    postIndices.push(postIdx);
  }

  const sourceIdx = placeIndex.get(wf.sourcePlace)!;
  const sinkIdx = placeIndex.get(wf.sinkPlace)!;

  // Full WF-net bipartite forward reachability from sourcePlace and backward co-reachability from sinkPlace
  const placeToTransitions: number[][] = Array.from({ length: places.length }, () => []);
  const placeFromTransitions: number[][] = Array.from({ length: places.length }, () => []);
  for (let ti = 0; ti < transitions.length; ti++) {
    for (const p of preIndices[ti]!) {
      placeToTransitions[p]!.push(ti);
    }
    for (const p of postIndices[ti]!) {
      placeFromTransitions[p]!.push(ti);
    }
  }

  const fwdPlaces = new Set<number>([sourceIdx]);
  const fwdTrans = new Set<number>();
  const fwdQueue: number[] = [sourceIdx];
  while (fwdQueue.length > 0) {
    const cur = fwdQueue.shift()!;
    for (const ti of placeToTransitions[cur]!) {
      if (!fwdTrans.has(ti)) {
        fwdTrans.add(ti);
        for (const nxt of postIndices[ti]!) {
          if (!fwdPlaces.has(nxt)) {
            fwdPlaces.add(nxt);
            fwdQueue.push(nxt);
          }
        }
      }
    }
  }
  if (!fwdPlaces.has(sinkIdx)) {
    throw new Error(
      `Unsound wfnet: sinkPlace "${wf.sinkPlace}" is not reachable from sourcePlace "${wf.sourcePlace}"`
    );
  }

  const bwdPlaces = new Set<number>([sinkIdx]);
  const bwdTrans = new Set<number>();
  const bwdQueue: number[] = [sinkIdx];
  while (bwdQueue.length > 0) {
    const cur = bwdQueue.shift()!;
    for (const ti of placeFromTransitions[cur]!) {
      if (!bwdTrans.has(ti)) {
        bwdTrans.add(ti);
        for (const prev of preIndices[ti]!) {
          if (!bwdPlaces.has(prev)) {
            bwdPlaces.add(prev);
            bwdQueue.push(prev);
          }
        }
      }
    }
  }

  const unreachablePlaces = places.filter((_, idx) => !fwdPlaces.has(idx)).map((p) => p.id);
  if (unreachablePlaces.length > 0) {
    throw new Error(
      `Unsound wfnet: place(s) unreachable from sourcePlace "${wf.sourcePlace}": ${unreachablePlaces.join(", ")}`
    );
  }
  const unreachableTransitions = transitions.filter((_, idx) => !fwdTrans.has(idx)).map((t) => t.id);
  if (unreachableTransitions.length > 0) {
    throw new Error(
      `Unsound wfnet: transition(s) unreachable from sourcePlace "${wf.sourcePlace}": ${unreachableTransitions.join(", ")}`
    );
  }
  const trappedPlaces = places.filter((_, idx) => !bwdPlaces.has(idx)).map((p) => p.id);
  if (trappedPlaces.length > 0) {
    throw new Error(
      `Unsound wfnet: place(s) cannot reach sinkPlace "${wf.sinkPlace}": ${trappedPlaces.join(", ")}`
    );
  }
  const trappedTransitions = transitions.filter((_, idx) => !bwdTrans.has(idx)).map((t) => t.id);
  if (trappedTransitions.length > 0) {
    throw new Error(
      `Unsound wfnet: transition(s) cannot reach sinkPlace "${wf.sinkPlace}": ${trappedTransitions.join(", ")}`
    );
  }

  const minVisibleDistToSink = computeBackwardMinVisibleDist(
    places.length,
    transitions,
    preIndices,
    postIndices,
    sinkIdx
  );
  if (!Number.isFinite(minVisibleDistToSink[sourceIdx]!)) {
    throw new Error(
      `Unsound wfnet: sourcePlace "${wf.sourcePlace}" has no path to sinkPlace "${wf.sinkPlace}"`
    );
  }

  return {
    places,
    transitions,
    placeIndex,
    transitionIndex,
    preIndices,
    postIndices,
    sourceIdx,
    sinkIdx,
    sourcePlace: wf.sourcePlace,
    sinkPlace: wf.sinkPlace,
    minVisibleDistToSink
  };
}

interface HeapItem {
  f: number;
  g: number;
  seq: number;
  stateIdx: number;
}

class MinHeap {
  private data: HeapItem[] = [];

  get size(): number {
    return this.data.length;
  }

  push(item: HeapItem): void {
    this.data.push(item);
    let idx = this.data.length - 1;
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this.compare(this.data[idx]!, this.data[parent]!) < 0) {
        const tmp = this.data[idx]!;
        this.data[idx] = this.data[parent]!;
        this.data[parent] = tmp;
        idx = parent;
      } else {
        break;
      }
    }
  }

  pop(): HeapItem | undefined {
    const n = this.data.length;
    if (n === 0) return undefined;
    const top = this.data[0]!;
    const last = this.data.pop()!;
    if (n > 1) {
      this.data[0] = last;
      let idx = 0;
      const len = this.data.length;
      while (true) {
        let best = idx;
        const left = idx * 2 + 1;
        const right = idx * 2 + 2;
        if (left < len && this.compare(this.data[left]!, this.data[best]!) < 0) best = left;
        if (right < len && this.compare(this.data[right]!, this.data[best]!) < 0) best = right;
        if (best === idx) break;
        const tmp = this.data[idx]!;
        this.data[idx] = this.data[best]!;
        this.data[best] = tmp;
        idx = best;
      }
    }
    return top;
  }

  private compare(a: HeapItem, b: HeapItem): number {
    if (a.f !== b.f) return a.f - b.f;
    if (a.g !== b.g) return a.g - b.g;
    return a.seq - b.seq;
  }
}

function transitionMatchesActivity(t: Transition, act: string): boolean {
  return t.activityId === act || t.label === act;
}

function transitionActivityName(t: Transition): string {
  return t.activityId ?? t.label;
}

function classifyDeviation(
  kind: "log_move" | "model_move",
  activity: string,
  transitionId?: string,
  eventId?: string
): AlignmentDeviation {
  const lower = activity.toLowerCase();
  if (kind === "model_move") {
    const isTestOrGate =
      lower.includes("test") ||
      lower.includes("verify") ||
      lower.includes("permission") ||
      lower.includes("disclosure") ||
      lower.includes("court");
    return {
      kind,
      category: isTestOrGate ? "skipped_test" : "missing_step",
      activity,
      transitionId,
      detail: `Model transition "${activity}" required by workflow net was skipped in observed trace.`
    };
  }
  const isWriteOrTool =
    lower.includes("write") ||
    lower.includes("edit") ||
    lower.includes("file") ||
    lower.includes("bash");
  return {
    kind,
    category: isWriteOrTool ? "out_of_scope_write" : lower.includes("tool") ? "unauthorized_tool" : "unexpected_step",
    activity,
    eventId,
    detail: `Observed event "${activity}" has no conforming transition in workflow net.`
  };
}

function computeReachableLabelsFromMarking(
  net: NormalizedWorkflowNet,
  marking: readonly number[],
  placeToTransitions: readonly number[][]
): Set<string> {
  const reachablePlaces = new Set<number>();
  const q: number[] = [];
  for (let p = 0; p < marking.length; p++) {
    if (marking[p]! > 0) {
      reachablePlaces.add(p);
      q.push(p);
    }
  }
  const labels = new Set<string>();
  while (q.length > 0) {
    const p = q.shift()!;
    for (const ti of placeToTransitions[p]!) {
      const t = net.transitions[ti]!;
      if (!t.silent) {
        if (t.activityId) labels.add(t.activityId);
        if (t.label) labels.add(t.label);
      }
      for (const nxt of net.postIndices[ti]!) {
        if (!reachablePlaces.has(nxt)) {
          reachablePlaces.add(nxt);
          q.push(nxt);
        }
      }
    }
  }
  return labels;
}

function isEnabled(marking: readonly number[], preIdx: readonly number[]): boolean {
  for (let i = 0; i < preIdx.length; i++) {
    if (marking[preIdx[i]!]! < 1) return false;
  }
  return true;
}

function applyTransition(
  marking: readonly number[],
  preIdx: readonly number[],
  postIdx: readonly number[],
  maxTokensPerPlace: number
): number[] | null {
  const next = marking.slice();
  for (let i = 0; i < preIdx.length; i++) {
    next[preIdx[i]!]! -= 1;
  }
  for (let i = 0; i < postIdx.length; i++) {
    const p = postIdx[i]!;
    next[p]! += 1;
    if (next[p]! > maxTokensPerPlace) return null;
  }
  return next;
}

interface InternalMoveRecord {
  kind: AlignmentMoveKind | "silent";
  activity: string;
  transitionIndex?: number;
  transitionId?: string;
  eventId?: string;
  cost: number;
}

interface SearchNode {
  marking: number[];
  markingKey: string;
  traceIdx: number;
  parent: number;
  move: InternalMoveRecord | null;
}

/**
 * Two-phase simplex solver for:
 *   minimize   c^T x
 *   subject to A x = b,  x >= 0
 * Uses Bland's rule to guarantee termination without cycling.
 * Returns:
 *   - finite optimal value >= 0 when feasible & bounded
 *   - Number.POSITIVE_INFINITY when infeasible (prunes dead-end markings)
 *   - 0 as a safe admissible fallback if iteration limit is exceeded
 */
function solveMarkingEquationLP(
  A: readonly (readonly number[])[],
  b: readonly number[],
  c: readonly number[]
): number {
  const m = A.length;
  const n = c.length;
  if (m === 0 || n === 0) return 0;

  const EPS = 1e-9;
  const totalCols = n + m; // real vars [0..n-1], artificial vars [n..n+m-1]
  // Tableau has (m + 1) rows and (totalCols + 1) columns; last column is RHS.
  // Row m is the objective row: z - sum_j r_j x_j = objVal (so we pivot on r_j < -EPS).
  const T: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(totalCols + 1).fill(0));
  const basis = new Int32Array(m);

  for (let i = 0; i < m; i++) {
    const row = T[i]!;
    const aRow = A[i]!;
    const sign = b[i]! < 0 ? -1 : 1;
    for (let j = 0; j < n; j++) {
      row[j] = sign * aRow[j]!;
    }
    row[n + i] = 1; // artificial variable
    row[totalCols] = sign * b[i]!;
    basis[i] = n + i;
  }

  const pivot = (pRow: number, pCol: number): void => {
    const row = T[pRow]!;
    const pVal = row[pCol]!;
    const inv = 1 / pVal;
    for (let j = 0; j <= totalCols; j++) {
      row[j] = row[j]! * inv;
    }
    row[pCol] = 1;
    for (let i = 0; i <= m; i++) {
      if (i === pRow) continue;
      const r = T[i]!;
      const factor = r[pCol]!;
      if (Math.abs(factor) <= EPS) continue;
      for (let j = 0; j <= totalCols; j++) {
        r[j] = r[j]! - factor * row[j]!;
      }
      r[pCol] = 0;
    }
    basis[pRow] = pCol;
  };

  const runSimplex = (numCols: number, maxIter: number): boolean => {
    const obj = T[m]!;
    for (let iter = 0; iter < maxIter; iter++) {
      // Bland's rule: first column with reduced cost < -EPS
      let enter = -1;
      for (let j = 0; j < numCols; j++) {
        if (obj[j]! < -EPS) {
          enter = j;
          break;
        }
      }
      if (enter === -1) return true; // optimal

      // Minimum ratio test with Bland's tie-breaking (smallest row index)
      let leave = -1;
      let minRatio = Number.POSITIVE_INFINITY;
      for (let i = 0; i < m; i++) {
        const aij = T[i]![enter]!;
        if (aij > EPS) {
          const ratio = T[i]![totalCols]! / aij;
          if (ratio < minRatio - EPS) {
            minRatio = ratio;
            leave = i;
          }
        }
      }
      if (leave === -1) return false; // unbounded
      pivot(leave, enter);
    }
    return false; // iteration cap reached
  };

  // Phase I: minimize sum of artificial variables
  const objRow = T[m]!;
  for (let i = 0; i < m; i++) {
    const r = T[i]!;
    for (let j = 0; j < n; j++) {
      objRow[j] = objRow[j]! - r[j]!;
    }
    objRow[totalCols] = objRow[totalCols]! - r[totalCols]!;
  }

  const maxIter = Math.max(500, (m + n) * 20);
  if (!runSimplex(totalCols, maxIter)) {
    return 0; // safe admissible fallback
  }

  // Objective value of Phase I is -objRow[totalCols]
  const phase1Obj = -objRow[totalCols]!;
  if (phase1Obj > 1e-6) {
    return Number.POSITIVE_INFINITY; // infeasible marking equation
  }

  // Drive any remaining artificial variables out of the basis
  for (let i = 0; i < m; i++) {
    if (basis[i]! >= n) {
      const r = T[i]!;
      let col = -1;
      for (let j = 0; j < n; j++) {
        if (Math.abs(r[j]!) > EPS) {
          col = j;
          break;
        }
      }
      if (col !== -1) {
        pivot(i, col);
      }
    }
  }

  // Phase II: minimize c^T x over real variables [0..n-1]
  objRow.fill(0);
  for (let j = 0; j < n; j++) {
    objRow[j] = c[j]!;
  }
  for (let i = 0; i < m; i++) {
    const bCol = basis[i]!;
    if (bCol < n) {
      const cb = c[bCol]!;
      if (Math.abs(cb) > EPS) {
        const r = T[i]!;
        for (let j = 0; j < n; j++) {
          objRow[j] = objRow[j]! - cb * r[j]!;
        }
        objRow[totalCols] = objRow[totalCols]! - cb * r[totalCols]!;
      }
    }
  }

  if (!runSimplex(n, maxIter)) {
    return 0; // safe admissible fallback
  }

  const opt = -objRow[totalCols]!;
  return opt <= EPS ? 0 : opt;
}

/**
 * Compute tau*-closure of visible activities enabled from a marking:
 * all visible activity names reachable via 0 or more silent transitions.
 */
function computeTauClosureEnabledActivities(
  net: NormalizedWorkflowNet,
  startMarking: readonly number[],
  maxTokensPerPlace: number
): Set<string> {
  const enabledActivities = new Set<string>();
  const visited = new Set<string>();
  const queue: number[][] = [startMarking.slice()];
  visited.add(startMarking.join(","));

  const maxClosureStates = 2048;
  while (queue.length > 0 && visited.size <= maxClosureStates) {
    const m = queue.shift()!;
    for (let ti = 0; ti < net.transitions.length; ti++) {
      const pre = net.preIndices[ti]!;
      if (!isEnabled(m, pre)) continue;
      const t = net.transitions[ti]!;
      if (t.silent) {
        const next = applyTransition(m, pre, net.postIndices[ti]!, maxTokensPerPlace);
        if (!next) continue;
        const key = next.join(",");
        if (!visited.has(key)) {
          visited.add(key);
          queue.push(next);
        }
      } else {
        enabledActivities.add(transitionActivityName(t));
      }
    }
  }
  return enabledActivities;
}

function computeSingleTracePrecision(
  net: NormalizedWorkflowNet,
  internalMoves: readonly InternalMoveRecord[],
  maxTokensPerPlace = 8
): number {
  return computePooledPrecision(net, [internalMoves], maxTokensPerPlace);
}

function markingSupportKey(marking: readonly number[]): string {
  let out = "";
  for (let i = 0; i < marking.length; i++) {
    out += marking[i]! > 0 ? "1" : "0";
  }
  return out;
}

function runAStarCore(
  net: NormalizedWorkflowNet,
  traceEvents: readonly { activity: string; eventId?: string }[],
  options: AlignmentOptions = {},
  worstCaseEmptyModelCost?: number
): { result: AlignmentResult; internalMoves: InternalMoveRecord[] } {
  const syncCost = options.syncCost ?? 0;
  const logMoveCost = options.logMoveCost ?? 1;
  const modelMoveCost = options.modelMoveCost ?? 1;
  const silentCost = options.silentCost ?? 0;
  const maxStates = options.maxStates ?? 100_000;
  const maxTokensPerPlace = options.maxTokensPerPlace ?? 8;
  const includeSilentMoves = options.includeSilentMoves ?? false;

  // Cost-function admissibility guards
  if (
    !Number.isFinite(syncCost) || syncCost < 0 ||
    !Number.isFinite(logMoveCost) || logMoveCost < 0 ||
    !Number.isFinite(modelMoveCost) || modelMoveCost < 0 ||
    !Number.isFinite(silentCost) || silentCost < 0
  ) {
    throw new Error(
      `Invalid alignment cost function: all costs must be finite and non-negative (sync=${syncCost}, log=${logMoveCost}, model=${modelMoveCost}, silent=${silentCost})`
    );
  }
  if (syncCost > logMoveCost + modelMoveCost) {
    throw new Error(
      `Inadmissible alignment cost function: syncCost (${syncCost}) must be <= logMoveCost + modelMoveCost (${logMoveCost + modelMoveCost})`
    );
  }

  const numPlaces = net.places.length;
  const numTrans = net.transitions.length;
  const placeToTransitions: number[][] = Array.from({ length: numPlaces }, () => []);
  for (let ti = 0; ti < numTrans; ti++) {
    for (const p of net.preIndices[ti]!) {
      placeToTransitions[p]!.push(ti);
    }
  }

  // Build Petri-net incidence matrix N[p][ti] = post(p, ti) - pre(p, ti)
  const incidence: number[][] = Array.from({ length: numPlaces }, () => new Array<number>(numTrans).fill(0));
  for (let ti = 0; ti < numTrans; ti++) {
    for (const p of net.preIndices[ti]!) {
      incidence[p]![ti] = incidence[p]![ti]! - 1;
    }
    for (const p of net.postIndices[ti]!) {
      incidence[p]![ti] = incidence[p]![ti]! + 1;
    }
  }

  // Distinct trace activities and suffix multiset counts for the synchronous-product marking equation LP
  const distinctActivities: string[] = [];
  const activityToIdx = new Map<string, number>();
  for (const ev of traceEvents) {
    if (!activityToIdx.has(ev.activity)) {
      activityToIdx.set(ev.activity, distinctActivities.length);
      distinctActivities.push(ev.activity);
    }
  }
  const numActs = distinctActivities.length;
  const traceLen = traceEvents.length;
  const suffixCounts: Int32Array[] = Array.from({ length: traceLen + 1 }, () => new Int32Array(numActs));
  for (let i = traceLen - 1; i >= 0; i--) {
    const prev = suffixCounts[i + 1]!;
    const cur = suffixCounts[i]!;
    cur.set(prev);
    const aIdx = activityToIdx.get(traceEvents[i]!.activity)!;
    cur[aIdx] = cur[aIdx]! + 1;
  }

  // Prebuild constant LP constraint matrix A and cost vector c:
  // Columns: [x_model (0..numTrans-1), x_sync (numTrans..numTrans+syncCols-1), x_log (..+numActs-1)]
  const syncCols: Array<{ ti: number; actIdx: number }> = [];
  for (let ti = 0; ti < numTrans; ti++) {
    const t = net.transitions[ti]!;
    if (t.silent) continue;
    for (let aIdx = 0; aIdx < numActs; aIdx++) {
      if (transitionMatchesActivity(t, distinctActivities[aIdx]!)) {
        syncCols.push({ ti, actIdx: aIdx });
      }
    }
  }

  const numLpRows = numPlaces + numActs;
  const numLpCols = numTrans + syncCols.length + numActs;
  const lpA: number[][] = Array.from({ length: numLpRows }, () => new Array<number>(numLpCols).fill(0));
  const lpC: number[] = new Array<number>(numLpCols).fill(0);

  for (let ti = 0; ti < numTrans; ti++) {
    lpC[ti] = net.transitions[ti]!.silent ? silentCost : modelMoveCost;
    for (let p = 0; p < numPlaces; p++) {
      lpA[p]![ti] = incidence[p]![ti]!;
    }
  }
  for (let s = 0; s < syncCols.length; s++) {
    const { ti, actIdx } = syncCols[s]!;
    const col = numTrans + s;
    lpC[col] = syncCost;
    for (let p = 0; p < numPlaces; p++) {
      lpA[p]![col] = incidence[p]![ti]!;
    }
    lpA[numPlaces + actIdx]![col] = 1;
  }
  for (let aIdx = 0; aIdx < numActs; aIdx++) {
    const col = numTrans + syncCols.length + aIdx;
    lpC[col] = logMoveCost;
    lpA[numPlaces + aIdx]![col] = 1;
  }

  const allIntegerCosts =
    Number.isInteger(syncCost) &&
    Number.isInteger(logMoveCost) &&
    Number.isInteger(modelMoveCost) &&
    Number.isInteger(silentCost);

  const reachableCache = new Map<string, Set<string>>();
  const lpCache = new Map<string, number>();
  const lpB = new Array<number>(numLpRows).fill(0);

  const heuristic = (marking: readonly number[], markingKey: string, traceIdx: number): number => {
    const cacheKey = `${traceIdx}|${markingKey}`;
    const cached = lpCache.get(cacheKey);
    if (cached !== undefined) return cached;

    let minModelToSink = 0;
    for (let p = 0; p < numPlaces; p++) {
      if (marking[p]! > 0) {
        const d = net.minVisibleDistToSink[p]!;
        if (!Number.isFinite(d)) {
          lpCache.set(cacheKey, Number.POSITIVE_INFINITY);
          return Number.POSITIVE_INFINITY;
        }
        if (d > minModelToSink) minModelToSink = d;
      }
    }

    // Build RHS b = [m_f - m; suffixCounts[traceIdx]]
    for (let p = 0; p < numPlaces; p++) {
      lpB[p] = (p === net.sinkIdx ? 1 : 0) - marking[p]!;
    }
    const sc = suffixCounts[traceIdx]!;
    for (let aIdx = 0; aIdx < numActs; aIdx++) {
      lpB[numPlaces + aIdx] = sc[aIdx]!;
    }

    const rawLp = solveMarkingEquationLP(lpA, lpB, lpC);
    if (!Number.isFinite(rawLp)) {
      lpCache.set(cacheKey, Number.POSITIVE_INFINITY);
      return Number.POSITIVE_INFINITY;
    }
    const lpH = allIntegerCosts ? Math.max(0, Math.ceil(rawLp - 1e-7)) : Math.max(0, rawLp - 1e-9);

    // Fast support-keyed reachability lower bound (combined via max, both admissible)
    let fallbackH: number;
    const remainingCount = traceLen - traceIdx;
    if (remainingCount === 0) {
      fallbackH = minModelToSink * modelMoveCost;
    } else {
      const supKey = markingSupportKey(marking);
      let reachable = reachableCache.get(supKey);
      if (!reachable) {
        reachable = computeReachableLabelsFromMarking(net, marking, placeToTransitions);
        reachableCache.set(supKey, reachable);
      }
      let impossibleLog = 0;
      let syncable = 0;
      for (let i = traceIdx; i < traceLen; i++) {
        if (reachable.has(traceEvents[i]!.activity)) {
          syncable += 1;
        } else {
          impossibleLog += 1;
        }
      }
      const unavoidableModel = Math.max(0, minModelToSink - syncable);
      fallbackH = impossibleLog * logMoveCost + unavoidableModel * modelMoveCost;
    }

    const h = Math.max(lpH, fallbackH);
    lpCache.set(cacheKey, h);
    return h;
  };

  const initMarking = new Array<number>(numPlaces).fill(0);
  initMarking[net.sourceIdx] = 1;
  const initMarkingKey = initMarking.join(",");

  const nodes: SearchNode[] = [
    { marking: initMarking, markingKey: initMarkingKey, traceIdx: 0, parent: -1, move: null }
  ];
  const bestG = new Map<string, number>();
  const initKey = `0|${initMarkingKey}`;
  bestG.set(initKey, 0);

  const heap = new MinHeap();
  let seq = 0;
  heap.push({ f: heuristic(initMarking, initMarkingKey, 0), g: 0, seq: seq++, stateIdx: 0 });

  let goalIdx = -1;
  let goalCost = Number.POSITIVE_INFINITY;
  let statesExplored = 0;

  const isGoalMarking = (m: readonly number[]): boolean => {
    if (m[net.sinkIdx]! !== 1) return false;
    for (let p = 0; p < numPlaces; p++) {
      if (p !== net.sinkIdx && m[p]! !== 0) return false;
    }
    return true;
  };

  while (heap.size > 0 && statesExplored < maxStates) {
    const cur = heap.pop()!;
    const node = nodes[cur.stateIdx]!;
    const curKey = `${node.traceIdx}|${node.markingKey}`;
    const recordedG = bestG.get(curKey);
    if (recordedG !== undefined && cur.g > recordedG) continue;

    statesExplored += 1;

    if (node.traceIdx === traceLen && isGoalMarking(node.marking)) {
      goalIdx = cur.stateIdx;
      goalCost = cur.g;
      break;
    }

    // 1. Model moves (silent & visible) enabled at current marking
    for (let ti = 0; ti < numTrans; ti++) {
      const pre = net.preIndices[ti]!;
      if (!isEnabled(node.marking, pre)) continue;
      const t = net.transitions[ti]!;
      const nextMarking = applyTransition(node.marking, pre, net.postIndices[ti]!, maxTokensPerPlace);
      if (!nextMarking) continue;
      const nextMarkingKey = nextMarking.join(",");

      if (t.silent) {
        const ng = cur.g + silentCost;
        const nKey = `${node.traceIdx}|${nextMarkingKey}`;
        const prev = bestG.get(nKey);
        if (prev === undefined || ng < prev) {
          const h = heuristic(nextMarking, nextMarkingKey, node.traceIdx);
          if (Number.isFinite(h)) {
            bestG.set(nKey, ng);
            const sIdx = nodes.length;
            nodes.push({
              marking: nextMarking,
              markingKey: nextMarkingKey,
              traceIdx: node.traceIdx,
              parent: cur.stateIdx,
              move: {
                kind: "silent",
                activity: t.label,
                transitionIndex: ti,
                transitionId: t.id,
                cost: silentCost
              }
            });
            heap.push({ f: ng + h, g: ng, seq: seq++, stateIdx: sIdx });
          }
        }
        continue;
      }

      // Sync move if next trace event matches
      if (node.traceIdx < traceLen) {
        const ev = traceEvents[node.traceIdx]!;
        if (transitionMatchesActivity(t, ev.activity)) {
          const ng = cur.g + syncCost;
          const nextTrace = node.traceIdx + 1;
          const nKey = `${nextTrace}|${nextMarkingKey}`;
          const prev = bestG.get(nKey);
          if (prev === undefined || ng < prev) {
            const h = heuristic(nextMarking, nextMarkingKey, nextTrace);
            if (Number.isFinite(h)) {
              bestG.set(nKey, ng);
              const sIdx = nodes.length;
              nodes.push({
                marking: nextMarking,
                markingKey: nextMarkingKey,
                traceIdx: nextTrace,
                parent: cur.stateIdx,
                move: {
                  kind: "sync",
                  activity: ev.activity,
                  transitionIndex: ti,
                  transitionId: t.id,
                  eventId: ev.eventId,
                  cost: syncCost
                }
              });
              heap.push({ f: ng + h, g: ng, seq: seq++, stateIdx: sIdx });
            }
          }
        }
      }

      // Visible model-only move
      {
        const ng = cur.g + modelMoveCost;
        const nKey = `${node.traceIdx}|${nextMarkingKey}`;
        const prev = bestG.get(nKey);
        if (prev === undefined || ng < prev) {
          const h = heuristic(nextMarking, nextMarkingKey, node.traceIdx);
          if (Number.isFinite(h)) {
            bestG.set(nKey, ng);
            const sIdx = nodes.length;
            nodes.push({
              marking: nextMarking,
              markingKey: nextMarkingKey,
              traceIdx: node.traceIdx,
              parent: cur.stateIdx,
              move: {
                kind: "model_move",
                activity: transitionActivityName(t),
                transitionIndex: ti,
                transitionId: t.id,
                cost: modelMoveCost
              }
            });
            heap.push({ f: ng + h, g: ng, seq: seq++, stateIdx: sIdx });
          }
        }
      }
    }

    // 2. Log-only move
    if (node.traceIdx < traceLen) {
      const ev = traceEvents[node.traceIdx]!;
      const ng = cur.g + logMoveCost;
      const nextTrace = node.traceIdx + 1;
      const nKey = `${nextTrace}|${node.markingKey}`;
      const prev = bestG.get(nKey);
      if (prev === undefined || ng < prev) {
        const h = heuristic(node.marking, node.markingKey, nextTrace);
        if (Number.isFinite(h)) {
          bestG.set(nKey, ng);
          const sIdx = nodes.length;
          nodes.push({
            marking: node.marking,
            markingKey: node.markingKey,
            traceIdx: nextTrace,
            parent: cur.stateIdx,
            move: {
              kind: "log_move",
              activity: ev.activity,
              eventId: ev.eventId,
              cost: logMoveCost
            }
          });
          heap.push({ f: ng + h, g: ng, seq: seq++, stateIdx: sIdx });
        }
      }
    }
  }

  if (goalIdx === -1) {
    throw new Error(
      `Unsound or bounded alignment failure: unable to reach sinkPlace "${net.sinkPlace}" within ${statesExplored} explored states`
    );
  }

  const internalMoves: InternalMoveRecord[] = [];
  let walk = goalIdx;
  while (walk > 0) {
    const n = nodes[walk]!;
    if (n.move) internalMoves.push(n.move);
    walk = n.parent;
  }
  internalMoves.reverse();

  const moves: AlignmentMove[] = [];
  const deviations: AlignmentDeviation[] = [];
  let syncMoves = 0;
  let logMoves = 0;
  let modelMoves = 0;

  for (const mv of internalMoves) {
    if (mv.kind === "silent") {
      if (includeSilentMoves) {
        moves.push({ kind: "model_move", activity: mv.activity, transitionId: mv.transitionId, cost: mv.cost });
      }
      continue;
    }
    moves.push({
      kind: mv.kind,
      activity: mv.activity,
      transitionId: mv.transitionId,
      eventId: mv.eventId,
      cost: mv.cost
    });
    if (mv.kind === "sync") {
      syncMoves += 1;
    } else if (mv.kind === "log_move") {
      logMoves += 1;
      deviations.push(classifyDeviation("log_move", mv.activity, undefined, mv.eventId));
    } else {
      modelMoves += 1;
      deviations.push(classifyDeviation("model_move", mv.activity, mv.transitionId, undefined));
    }
  }

  let emptyModelCost = worstCaseEmptyModelCost;
  if (emptyModelCost === undefined) {
    if (traceLen === 0) {
      emptyModelCost = goalCost;
    } else {
      emptyModelCost = runAStarCore(net, [], options, 0).result.alignmentCost;
    }
  }

  const worstCaseCost = traceLen * logMoveCost + emptyModelCost;
  const fitness = worstCaseCost === 0 ? 1 : Math.max(0, Math.min(1, 1 - goalCost / worstCaseCost));
  const precision = computeSingleTracePrecision(net, internalMoves, maxTokensPerPlace);

  return {
    result: {
      method: "a_star_alignment",
      traceLength: traceLen,
      alignmentCost: goalCost,
      worstCaseCost,
      fitness,
      escapingEdgesPrecision: precision,
      precision,
      syncMoves,
      logMoves,
      modelMoves,
      moves,
      deviations,
      statesExplored,
      optimal: true
    },
    internalMoves
  };
}

export function alignTraceAStar(
  netOrPowl: WorkflowNetLike | PowlNode,
  trace: readonly string[] | readonly ConformanceOcelEventLike[],
  options: AlignmentOptions = {}
): AlignmentResult {
  const net = normalizeWorkflowNet(netOrPowl);
  const traceEvents = trace.map((item) =>
    typeof item === "string"
      ? { activity: item }
      : { activity: item.type, eventId: item.id }
  );
  return runAStarCore(net, traceEvents, options).result;
}

/**
 * True tau*-closure Align-ETC escaping-edges precision over the aligned prefix automaton:
 *   - en_M(state) = all visible activities reachable via 0+ silent transitions from the state's marking
 *   - en_L(state) = all visible activities executed in the aligned model-projection at that state
 *   - States are weighted by event frequency: sum_s freq(s) * |en_L(s)| / sum_s freq(s) * |en_M(s)|
 *   - Orthogonal to fitness (no missedModelMoves penalty in denominator).
 */
function computePooledPrecision(
  net: NormalizedWorkflowNet,
  allInternalMoves: readonly (readonly InternalMoveRecord[])[],
  maxTokensPerPlace = 8
): number {
  if (allInternalMoves.length === 0) return 1;

  const tauClosureCache = new Map<string, Set<string>>();
  const getEnM = (marking: readonly number[], markingKey: string): Set<string> => {
    let en = tauClosureCache.get(markingKey);
    if (!en) {
      en = computeTauClosureEnabledActivities(net, marking, maxTokensPerPlace);
      tauClosureCache.set(markingKey, en);
    }
    return en;
  };

  // Aligned prefix automaton states keyed by visible activity prefix
  const stateMap = new Map<
    string,
    { enM: Set<string>; enL: Set<string>; freq: number }
  >();

  for (const traceMoves of allInternalMoves) {
    const marking = new Array<number>(net.places.length).fill(0);
    marking[net.sourceIdx] = 1;
    let preSilentMarking = marking.slice();
    let preSilentKey = preSilentMarking.join(",");
    let prefix = "";

    for (const mv of traceMoves) {
      if (mv.kind === "log_move") continue;
      const ti = mv.transitionIndex!;
      if (mv.kind === "silent") {
        for (const p of net.preIndices[ti]!) marking[p]! -= 1;
        for (const p of net.postIndices[ti]!) marking[p]! += 1;
        continue;
      }

      const actName = transitionActivityName(net.transitions[ti]!);
      const enMAtState = getEnM(preSilentMarking, preSilentKey);

      let rec = stateMap.get(prefix);
      if (!rec) {
        rec = {
          enM: new Set<string>(enMAtState),
          enL: new Set<string>(),
          freq: 0
        };
        stateMap.set(prefix, rec);
      } else {
        for (const a of enMAtState) rec.enM.add(a);
      }

      rec.enL.add(actName);
      rec.freq += 1;

      for (const p of net.preIndices[ti]!) marking[p]! -= 1;
      for (const p of net.postIndices[ti]!) marking[p]! += 1;
      preSilentMarking = marking.slice();
      preSilentKey = preSilentMarking.join(",");
      prefix = prefix.length === 0 ? actName : `${prefix}\0${actName}`;
    }
  }

  let numerator = 0;
  let denominator = 0;
  for (const rec of stateMap.values()) {
    const modelEnabled = Math.max(rec.enM.size, rec.enL.size);
    numerator += rec.freq * rec.enL.size;
    denominator += rec.freq * modelEnabled;
  }

  if (denominator === 0) return 1;
  return Math.max(0, Math.min(1, numerator / denominator));
}

export function computeAlignmentConformance(
  doc: ConformanceOcelDocLike,
  netOrPowl: WorkflowNetLike | PowlNode,
  objectType?: string,
  options: AlignmentOptions = {}
): AlignmentConformanceReport {
  const net = normalizeWorkflowNet(netOrPowl);

  const sortedEvents = [...(doc.events ?? [])]
    .map((ev, idx) => ({ ev, idx, ms: Date.parse(ev.time) }))
    .sort((a, b) => {
      const am = Number.isFinite(a.ms) ? a.ms : 0;
      const bm = Number.isFinite(b.ms) ? b.ms : 0;
      return am !== bm ? am - bm : a.idx - b.idx;
    })
    .map((x) => x.ev);

  const targetType = objectType ?? "session";
  const matchingObjects = objectType !== undefined
    ? (doc.objects ?? []).filter((o) => o.type === targetType)
    : [];

  // Fail closed: when an explicit objectType is requested and no matching objects exist,
  // return an empty 0-case report instead of falling back to __full_log__.
  if (objectType !== undefined && matchingObjects.length === 0) {
    return {
      method: "a_star_alignment",
      objectType: targetType,
      caseCount: 0,
      alignmentCost: 0,
      fitness: 1,
      escapingEdgesPrecision: 1,
      precision: 1,
      syncMoves: 0,
      logMoves: 0,
      modelMoves: 0,
      moves: [],
      deviations: [],
      cases: []
    };
  }

  const traces: Array<{ caseId: string; objectType: string; events: ConformanceOcelEventLike[] }> = [];
  if (objectType !== undefined) {
    const objIds = new Set(matchingObjects.map((o) => o.id));
    const grouped = new Map<string, ConformanceOcelEventLike[]>();
    for (const o of matchingObjects) grouped.set(o.id, []);
    for (const ev of sortedEvents) {
      const seenForEvent = new Set<string>();
      for (const rel of ev.relationships ?? []) {
        if (objIds.has(rel.objectId) && !seenForEvent.has(rel.objectId)) {
          seenForEvent.add(rel.objectId);
          grouped.get(rel.objectId)!.push(ev);
        }
      }
    }
    for (const [caseId, evs] of grouped.entries()) {
      traces.push({ caseId, objectType: targetType, events: evs });
    }
  } else {
    traces.push({
      caseId: "__full_log__",
      objectType: targetType,
      events: sortedEvents
    });
  }

  const emptyModelCost = runAStarCore(net, [], options, 0).result.alignmentCost;
  const maxTokensPerPlace = options.maxTokensPerPlace ?? 8;
  const cases: CaseAlignmentSummary[] = [];
  const allInternalMoves: InternalMoveRecord[][] = [];
  const allMoves: AlignmentMove[] = [];
  const allDeviations: AlignmentDeviation[] = [];

  // Deduplicate traces by activity-sequence variant: align each unique variant once
  // and remap eventIds onto each case's moves and deviations.
  const variantCache = new Map<
    string,
    { result: AlignmentResult; internalMoves: InternalMoveRecord[] }
  >();

  let totalCost = 0;
  let totalWorstCase = 0;
  let syncMoves = 0;
  let logMoves = 0;
  let modelMoves = 0;

  for (const tr of traces) {
    const variantKey = JSON.stringify(tr.events.map((e) => e.type));
    let aligned = variantCache.get(variantKey);
    if (!aligned) {
      const tracePayload = tr.events.map((e) => ({ activity: e.type, eventId: e.id }));
      aligned = runAStarCore(net, tracePayload, options, emptyModelCost);
      variantCache.set(variantKey, aligned);
    }

    const { result, internalMoves } = aligned;

    // Remap eventIds for this specific case's events
    let evCursor = 0;
    const caseMoves: AlignmentMove[] = result.moves.map((m) => {
      if (m.kind === "sync" || m.kind === "log_move") {
        const evId = tr.events[evCursor]?.id;
        evCursor += 1;
        return evId !== undefined ? { ...m, eventId: evId } : { ...m };
      }
      return { ...m };
    });

    let devEvCursor = 0;
    const caseDeviations: AlignmentDeviation[] = [];
    for (const m of caseMoves) {
      if (m.kind === "log_move") {
        caseDeviations.push(classifyDeviation("log_move", m.activity, undefined, m.eventId));
        devEvCursor += 1;
      } else if (m.kind === "model_move") {
        // Only classify visible model moves (matching result.deviations when includeSilentMoves is true)
        if (devEvCursor < result.deviations.length || !options.includeSilentMoves) {
          caseDeviations.push(classifyDeviation("model_move", m.activity, m.transitionId, undefined));
        }
      }
    }

    allInternalMoves.push(internalMoves);
    totalCost += result.alignmentCost;
    totalWorstCase += result.worstCaseCost;
    syncMoves += result.syncMoves;
    logMoves += result.logMoves;
    modelMoves += result.modelMoves;
    allMoves.push(...caseMoves);
    allDeviations.push(...caseDeviations);
    cases.push({
      caseId: tr.caseId,
      objectType: tr.objectType,
      traceLength: result.traceLength,
      alignmentCost: result.alignmentCost,
      fitness: result.fitness,
      syncMoves: result.syncMoves,
      logMoves: result.logMoves,
      modelMoves: result.modelMoves,
      moves: caseMoves,
      deviations: caseDeviations
    });
  }

  const fitness = totalWorstCase === 0 ? 1 : Math.max(0, Math.min(1, 1 - totalCost / totalWorstCase));
  const precision = computePooledPrecision(net, allInternalMoves, maxTokensPerPlace);

  return {
    method: "a_star_alignment",
    objectType: targetType,
    caseCount: cases.length,
    alignmentCost: totalCost,
    fitness,
    escapingEdgesPrecision: precision,
    precision,
    syncMoves,
    logMoves,
    modelMoves,
    moves: allMoves,
    deviations: allDeviations,
    cases
  };
}
