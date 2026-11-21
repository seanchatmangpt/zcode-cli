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

  // Build reverse index: postPlace -> transitions that produce into it
  const producingTransitions: number[][] = Array.from({ length: numPlaces }, () => []);
  for (let ti = 0; ti < transitions.length; ti++) {
    for (const q of postIndices[ti]!) {
      producingTransitions[q]!.push(ti);
    }
  }

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
  traceIdx: number;
  parent: number;
  move: InternalMoveRecord | null;
}

function computeSingleTracePrecision(
  net: NormalizedWorkflowNet,
  internalMoves: readonly InternalMoveRecord[]
): number {
  const marking = new Array<number>(net.places.length).fill(0);
  marking[net.sourceIdx] = 1;

  let reflected = 0;
  let totalOpportunities = 0;

  for (const mv of internalMoves) {
    if (mv.kind === "log_move") continue;
    const ti = mv.transitionIndex!;
    const t = net.transitions[ti]!;
    if (mv.kind === "silent") {
      for (const p of net.preIndices[ti]!) marking[p]! -= 1;
      for (const p of net.postIndices[ti]!) marking[p]! += 1;
      continue;
    }

    // Visible model transition: count conflict/XOR siblings enabled at current marking
    const preSet = new Set(net.preIndices[ti]!);
    let conflictSiblings = 0;
    for (let otherIdx = 0; otherIdx < net.transitions.length; otherIdx++) {
      const ot = net.transitions[otherIdx]!;
      if (ot.silent) continue;
      if (!isEnabled(marking, net.preIndices[otherIdx]!)) continue;
      const sharesPre = net.preIndices[otherIdx]!.some((p) => preSet.has(p));
      if (sharesPre) conflictSiblings += 1;
    }

    const opp = Math.max(1, conflictSiblings);
    totalOpportunities += opp;
    if (mv.kind === "sync") {
      reflected += 1;
    }

    for (const p of net.preIndices[ti]!) marking[p]! -= 1;
    for (const p of net.postIndices[ti]!) marking[p]! += 1;
  }

  if (totalOpportunities === 0) return 1;
  return Math.max(0, Math.min(1, reflected / totalOpportunities));
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

  const numPlaces = net.places.length;
  const placeToTransitions: number[][] = Array.from({ length: numPlaces }, () => []);
  for (let ti = 0; ti < net.transitions.length; ti++) {
    for (const p of net.preIndices[ti]!) {
      placeToTransitions[p]!.push(ti);
    }
  }

  const reachableCache = new Map<string, Set<string>>();
  const heuristic = (marking: readonly number[], traceIdx: number): number => {
    let minModelToSink = 0;
    for (let p = 0; p < numPlaces; p++) {
      if (marking[p]! > 0) {
        const d = net.minVisibleDistToSink[p]!;
        if (!Number.isFinite(d)) return Number.POSITIVE_INFINITY;
        if (d > minModelToSink) minModelToSink = d;
      }
    }

    const remainingCount = traceEvents.length - traceIdx;
    if (remainingCount === 0) {
      return minModelToSink * modelMoveCost;
    }

    const mKey = marking.join(",");
    let reachable = reachableCache.get(mKey);
    if (!reachable) {
      reachable = computeReachableLabelsFromMarking(net, marking, placeToTransitions);
      reachableCache.set(mKey, reachable);
    }

    let impossibleLog = 0;
    let syncable = 0;
    for (let i = traceIdx; i < traceEvents.length; i++) {
      if (reachable.has(traceEvents[i]!.activity)) {
        syncable += 1;
      } else {
        impossibleLog += 1;
      }
    }

    const unavoidableModel = Math.max(0, minModelToSink - syncable);
    return impossibleLog * logMoveCost + unavoidableModel * modelMoveCost;
  };

  const initMarking = new Array<number>(numPlaces).fill(0);
  initMarking[net.sourceIdx] = 1;

  const nodes: SearchNode[] = [
    { marking: initMarking, traceIdx: 0, parent: -1, move: null }
  ];
  const bestG = new Map<string, number>();
  const initKey = `0|${initMarking.join(",")}`;
  bestG.set(initKey, 0);

  const heap = new MinHeap();
  let seq = 0;
  heap.push({ f: heuristic(initMarking, 0), g: 0, seq: seq++, stateIdx: 0 });

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
    const curKey = `${node.traceIdx}|${node.marking.join(",")}`;
    const recordedG = bestG.get(curKey);
    if (recordedG !== undefined && cur.g > recordedG) continue;

    statesExplored += 1;

    if (node.traceIdx === traceEvents.length && isGoalMarking(node.marking)) {
      goalIdx = cur.stateIdx;
      goalCost = cur.g;
      break;
    }

    // 1. Model moves (silent & visible) enabled at current marking
    for (let ti = 0; ti < net.transitions.length; ti++) {
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
          const h = heuristic(nextMarking, node.traceIdx);
          if (Number.isFinite(h)) {
            bestG.set(nKey, ng);
            const sIdx = nodes.length;
            nodes.push({
              marking: nextMarking,
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
      if (node.traceIdx < traceEvents.length) {
        const ev = traceEvents[node.traceIdx]!;
        if (transitionMatchesActivity(t, ev.activity)) {
          const ng = cur.g + syncCost;
          const nextTrace = node.traceIdx + 1;
          const nKey = `${nextTrace}|${nextMarkingKey}`;
          const prev = bestG.get(nKey);
          if (prev === undefined || ng < prev) {
            const h = heuristic(nextMarking, nextTrace);
            if (Number.isFinite(h)) {
              bestG.set(nKey, ng);
              const sIdx = nodes.length;
              nodes.push({
                marking: nextMarking,
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
          const h = heuristic(nextMarking, node.traceIdx);
          if (Number.isFinite(h)) {
            bestG.set(nKey, ng);
            const sIdx = nodes.length;
            nodes.push({
              marking: nextMarking,
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
    if (node.traceIdx < traceEvents.length) {
      const ev = traceEvents[node.traceIdx]!;
      const ng = cur.g + logMoveCost;
      const nextTrace = node.traceIdx + 1;
      const nKey = `${nextTrace}|${node.marking.join(",")}`;
      const prev = bestG.get(nKey);
      if (prev === undefined || ng < prev) {
        const h = heuristic(node.marking, nextTrace);
        if (Number.isFinite(h)) {
          bestG.set(nKey, ng);
          const sIdx = nodes.length;
          nodes.push({
            marking: node.marking,
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
    if (traceEvents.length === 0) {
      emptyModelCost = goalCost;
    } else {
      emptyModelCost = runAStarCore(net, [], options, 0).result.alignmentCost;
    }
  }

  const worstCaseCost = traceEvents.length * logMoveCost + emptyModelCost;
  const fitness = worstCaseCost === 0 ? 1 : Math.max(0, Math.min(1, 1 - goalCost / worstCaseCost));
  const precision = computeSingleTracePrecision(net, internalMoves);

  return {
    result: {
      method: "a_star_alignment",
      traceLength: traceEvents.length,
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

function computePooledPrecision(
  net: NormalizedWorkflowNet,
  allInternalMoves: readonly (readonly InternalMoveRecord[])[]
): number {
  if (allInternalMoves.length === 0) return 1;

  // Map markingKey -> { conflictUniverseSize, syncedTransitionIds }
  const stateMap = new Map<string, { prePlaceKey: string; conflictSize: number; syncedTransitions: Set<number>; missedModelMoves: number }>();

  for (const traceMoves of allInternalMoves) {
    const marking = new Array<number>(net.places.length).fill(0);
    marking[net.sourceIdx] = 1;

    for (const mv of traceMoves) {
      if (mv.kind === "log_move") continue;
      const ti = mv.transitionIndex!;
      if (mv.kind === "silent") {
        for (const p of net.preIndices[ti]!) marking[p]! -= 1;
        for (const p of net.postIndices[ti]!) marking[p]! += 1;
        continue;
      }

      const preSet = new Set(net.preIndices[ti]!);
      let conflictSiblings = 0;
      const conflictIds: number[] = [];
      for (let otherIdx = 0; otherIdx < net.transitions.length; otherIdx++) {
        const ot = net.transitions[otherIdx]!;
        if (ot.silent) continue;
        if (!isEnabled(marking, net.preIndices[otherIdx]!)) continue;
        if (net.preIndices[otherIdx]!.some((p) => preSet.has(p))) {
          conflictSiblings += 1;
          conflictIds.push(otherIdx);
        }
      }

      const stateKey = `${marking.join(",")}|${conflictIds.join(",")}`;
      let rec = stateMap.get(stateKey);
      if (!rec) {
        rec = {
          prePlaceKey: stateKey,
          conflictSize: Math.max(1, conflictSiblings),
          syncedTransitions: new Set<number>(),
          missedModelMoves: 0
        };
        stateMap.set(stateKey, rec);
      }

      if (mv.kind === "sync") {
        rec.syncedTransitions.add(ti);
      } else {
        rec.missedModelMoves += 1;
      }

      for (const p of net.preIndices[ti]!) marking[p]! -= 1;
      for (const p of net.postIndices[ti]!) marking[p]! += 1;
    }
  }

  let numerator = 0;
  let denominator = 0;
  for (const rec of stateMap.values()) {
    numerator += rec.syncedTransitions.size;
    denominator += Math.max(rec.conflictSize, rec.syncedTransitions.size) + rec.missedModelMoves;
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
  const matchingObjects = objectType
    ? (doc.objects ?? []).filter((o) => o.type === targetType)
    : [];

  const traces: Array<{ caseId: string; objectType: string; events: ConformanceOcelEventLike[] }> = [];
  if (objectType && matchingObjects.length > 0) {
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
      caseId: matchingObjects[0]?.id ?? "__full_log__",
      objectType: targetType,
      events: sortedEvents
    });
  }

  const emptyModelCost = runAStarCore(net, [], options, 0).result.alignmentCost;
  const cases: CaseAlignmentSummary[] = [];
  const allInternalMoves: InternalMoveRecord[][] = [];
  const allMoves: AlignmentMove[] = [];
  const allDeviations: AlignmentDeviation[] = [];

  let totalCost = 0;
  let totalWorstCase = 0;
  let syncMoves = 0;
  let logMoves = 0;
  let modelMoves = 0;

  for (const tr of traces) {
    const tracePayload = tr.events.map((e) => ({ activity: e.type, eventId: e.id }));
    const { result, internalMoves } = runAStarCore(net, tracePayload, options, emptyModelCost);
    allInternalMoves.push(internalMoves);
    totalCost += result.alignmentCost;
    totalWorstCase += result.worstCaseCost;
    syncMoves += result.syncMoves;
    logMoves += result.logMoves;
    modelMoves += result.modelMoves;
    allMoves.push(...result.moves);
    allDeviations.push(...result.deviations);
    cases.push({
      caseId: tr.caseId,
      objectType: tr.objectType,
      traceLength: result.traceLength,
      alignmentCost: result.alignmentCost,
      fitness: result.fitness,
      syncMoves: result.syncMoves,
      logMoves: result.logMoves,
      modelMoves: result.modelMoves,
      moves: result.moves,
      deviations: result.deviations
    });
  }

  const fitness = totalWorstCase === 0 ? 1 : Math.max(0, Math.min(1, 1 - totalCost / totalWorstCase));
  const precision = computePooledPrecision(net, allInternalMoves);

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
