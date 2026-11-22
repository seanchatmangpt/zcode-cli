import { createHash } from "node:crypto";

export interface DiscoverAttributeLike {
  name: string;
  value: unknown;
  time?: string;
}

export interface DiscoverRelationshipLike {
  objectId: string;
  qualifier: string;
}

export interface DiscoverObjectLike {
  id: string;
  type: string;
  attributes: readonly DiscoverAttributeLike[] | readonly unknown[] | Record<string, unknown>;
  relationships?: readonly DiscoverRelationshipLike[] | readonly unknown[];
}

export interface DiscoverEventLike {
  id: string;
  type: string;
  time: string;
  attributes?: readonly DiscoverAttributeLike[] | Record<string, unknown>;
  relationships?: readonly DiscoverRelationshipLike[];
}

export interface DiscoverDocLike {
  objectTypes?: ReadonlyArray<{ name: string; attributes?: unknown[] }>;
  eventTypes?: ReadonlyArray<{ name: string; attributes?: unknown[] }>;
  objects: readonly DiscoverObjectLike[];
  events: readonly DiscoverEventLike[];
}

export interface SojournStats {
  count: number;
  minMs: number;
  medianMs: number;
  meanMs: number;
  p95Ms: number;
  maxMs: number;
  varianceMs2: number;
  cs2: number;
}

export interface OcDfgNode {
  activity: string;
  /** Distinct event count (E) for this activity and object type. */
  frequency: number;
  /** Distinct event count (E) — explicit alias of `frequency`. */
  eventCount?: number;
  /** Unique object count (UO) participating in this activity for this object type. */
  objectCount: number;
  /** Total event-object pairs (TO) for this activity and object type. */
  totalObjects?: number;
  medianSojournMs: number;
  p95SojournMs: number;
  meanSojournMs: number;
  cs2: number;
}

export interface OcDfgEdge {
  source: string;
  target: string;
  objectType: string;
  /** Distinct directly-follows event pairs (E) for this edge and object type. */
  frequency: number;
  /** Distinct directly-follows event pairs (E) — explicit alias of `frequency`. */
  eventCount?: number;
  /** Unique object count (UO) traversing this edge. */
  objectCount: number;
  /** Total object-level directly-follows transitions (TO) traversing this edge. */
  totalObjects?: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  cs2: number;
}

export interface OcDfgPerTypeGraph {
  objectType: string;
  traceCount: number;
  nodes: OcDfgNode[];
  edges: OcDfgEdge[];
  startActivities: Record<string, number>;
  endActivities: Record<string, number>;
}

export interface ConvergencePattern {
  activity: string;
  objectType: string;
  maxObjectsPerEvent: number;
  count: number;
}

export interface DivergencePattern {
  activity: string;
  objectType: string;
  maxEventsPerObject: number;
  count: number;
  differingOtherTypes?: string[];
}

export interface SynchronizationPattern {
  activity: string;
  objectTypes: string[];
  count: number;
}

export interface DiscoverOcDfgOptions {
  minReviewMs?: number;
  slowOversightMs?: number;
  minActivityFrequency?: number;
  minEdgeFrequency?: number;
  noiseThreshold?: number;
}

export interface ReworkCycleFinding {
  objectType: string;
  cycle: string[];
  count: number;
  sampleEventIds: string[];
}

export interface FileCollisionFinding {
  fileObjectId: string;
  filePath?: string;
  actors: string[];
  eventIds: string[];
  count: number;
}

export interface OversightBottleneckFinding {
  permissionObjectId: string;
  latencyMs: number;
  decision: string;
  kind: "slow_oversight" | "rubber_stamp";
  eventIds: string[];
}

export interface OcDfgModel {
  schema: "zcode.oc-dfg/1";
  objectTypes: string[];
  eventTypes: string[];
  totalEvents: number;
  totalObjects: number;
  byObjectType: Record<string, OcDfgPerTypeGraph>;
  convergence: ConvergencePattern[];
  divergence: DivergencePattern[];
  synchronization: SynchronizationPattern[];
  reworkCycles: ReworkCycleFinding[];
  fileCollisions: FileCollisionFinding[];
  oversightBottlenecks: OversightBottleneckFinding[];
  sojournByObjectType: Record<string, SojournStats>;
}

const QUALIFIER_OBJECT_TYPE: Readonly<Record<string, string>> = {
  in_session: "session",
  in_turn: "turn",
  about_tool_call: "tool_call",
  about_permission: "permission",
  about_model_request: "model_request",
  by_subagent: "subagent",
  subject: "work_order",
  in_work_order: "work_order",
  on_lease: "lease",
  provider: "provider",
  worker: "worker",
  receipt: "receipt",
  originAuthority: "authority",
  governs: "permission",
  mutated_in: "workspace_file",
  seals: "receipt",
  approved_by: "human_overseer"
};

function readAttrStr(
  attrs: readonly DiscoverAttributeLike[] | readonly unknown[] | Record<string, unknown> | undefined,
  key: string
): string | undefined {
  if (!attrs) return undefined;
  if (Array.isArray(attrs)) {
    let last: string | undefined;
    for (const a of attrs) {
      if (a && typeof a === "object" && (a as DiscoverAttributeLike).name === key) {
        const val = (a as DiscoverAttributeLike).value;
        last = val === undefined || val === null ? undefined : String(val);
      }
    }
    return last;
  }
  const rec = attrs as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(rec, key)) {
    const val = rec[key];
    return val === undefined || val === null ? undefined : String(val);
  }
  return undefined;
}

function readAttrNum(
  attrs: readonly DiscoverAttributeLike[] | readonly unknown[] | Record<string, unknown> | undefined,
  key: string
): number | undefined {
  const s = readAttrStr(attrs, key);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export function computeSummaryStats(samples: readonly number[]): SojournStats {
  const clean = samples.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  const n = clean.length;
  if (n === 0) {
    return { count: 0, minMs: 0, medianMs: 0, meanMs: 0, p95Ms: 0, maxMs: 0, varianceMs2: 0, cs2: 0 };
  }
  const minMs = clean[0]!;
  const maxMs = clean[n - 1]!;
  const medianMs =
    n % 2 === 1 ? clean[(n - 1) >> 1]! : (clean[n / 2 - 1]! + clean[n / 2]!) / 2;
  const p95Idx = Math.min(n - 1, Math.max(0, Math.ceil(0.95 * n) - 1));
  const p95Ms = clean[p95Idx]!;
  const sum = clean.reduce((acc, v) => acc + v, 0);
  const meanMs = sum / n;
  const varianceMs2 =
    n > 1
      ? clean.reduce((acc, v) => acc + (v - meanMs) * (v - meanMs), 0) / (n - 1)
      : 0;
  const cs2 = meanMs > 0 ? varianceMs2 / (meanMs * meanMs) : 0;
  return { count: n, minMs, medianMs, meanMs, p95Ms, maxMs, varianceMs2, cs2 };
}

function filterPerTypeGraph(
  nodes: OcDfgNode[],
  edges: OcDfgEdge[],
  startActivities: Record<string, number>,
  endActivities: Record<string, number>,
  options: { minActivityFrequency: number; minEdgeFrequency: number; noiseThreshold: number }
): {
  nodes: OcDfgNode[];
  edges: OcDfgEdge[];
  startActivities: Record<string, number>;
  endActivities: Record<string, number>;
} {
  const { minActivityFrequency, minEdgeFrequency, noiseThreshold } = options;
  if (minActivityFrequency <= 0 && minEdgeFrequency <= 0 && noiseThreshold <= 0) {
    return { nodes, edges, startActivities, endActivities };
  }
  if (nodes.length === 0) {
    return { nodes, edges, startActivities, endActivities };
  }

  const maxNodeFreq = nodes.reduce((m, n) => Math.max(m, n.frequency), 0);
  const maxEdgeFreq = edges.reduce((m, e) => Math.max(m, e.frequency), 0);
  const nodeThresh = Math.max(
    minActivityFrequency,
    noiseThreshold > 0 ? Math.ceil(noiseThreshold * maxNodeFreq) : 0
  );
  const edgeThresh = Math.max(
    minEdgeFrequency,
    noiseThreshold > 0 ? Math.ceil(noiseThreshold * maxEdgeFreq) : 0
  );

  const nodeByAct = new Map<string, OcDfgNode>(nodes.map((n) => [n.activity, n]));
  const keptNodeSet = new Set<string>(
    nodes.filter((n) => n.frequency >= nodeThresh).map((n) => n.activity)
  );

  // Always retain the top start and top end activity if present
  const startEntries = Object.entries(startActivities).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const endEntries = Object.entries(endActivities).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const topStart = startEntries[0]?.[0];
  const topEnd = endEntries[0]?.[0];
  if (topStart && nodeByAct.has(topStart)) keptNodeSet.add(topStart);
  if (topEnd && nodeByAct.has(topEnd)) keptNodeSet.add(topEnd);

  const keptEdgeKeys = new Set<string>();
  const edgeByKey = new Map<string, OcDfgEdge>();
  for (const e of edges) {
    const k = `${e.source}\0${e.target}`;
    edgeByKey.set(k, e);
    if (e.frequency >= edgeThresh && keptNodeSet.has(e.source) && keptNodeSet.has(e.target)) {
      keptEdgeKeys.add(k);
    }
  }

  // Check if any kept start activity can reach any kept end activity via kept edges
  const keptStarts = startEntries.map(([a]) => a).filter((a) => keptNodeSet.has(a));
  const keptEnds = new Set(endEntries.map(([a]) => a).filter((a) => keptNodeSet.has(a)));

  const hasStartToEndPath = (): boolean => {
    if (keptStarts.length === 0 || keptEnds.size === 0) return true;
    const adj = new Map<string, string[]>();
    for (const k of keptEdgeKeys) {
      const e = edgeByKey.get(k)!;
      let list = adj.get(e.source);
      if (!list) {
        list = [];
        adj.set(e.source, list);
      }
      list.push(e.target);
    }
    const visited = new Set<string>(keptStarts);
    const queue = [...keptStarts];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (keptEnds.has(cur)) return true;
      for (const nxt of adj.get(cur) ?? []) {
        if (!visited.has(nxt)) {
          visited.add(nxt);
          queue.push(nxt);
        }
      }
    }
    return false;
  };

  // If filtering broke start-to-end connectivity, restore the widest (highest min-edge-frequency) path
  if (!hasStartToEndPath() && keptStarts.length > 0 && keptEnds.size > 0) {
    const fullAdj = new Map<string, OcDfgEdge[]>();
    for (const e of edges) {
      let list = fullAdj.get(e.source);
      if (!list) {
        list = [];
        fullAdj.set(e.source, list);
      }
      list.push(e);
    }

    const bestCap = new Map<string, number>();
    const prevEdge = new Map<string, OcDfgEdge>();
    const unvisited = new Set<string>(nodes.map((n) => n.activity));
    for (const s of keptStarts) {
      bestCap.set(s, Number.POSITIVE_INFINITY);
    }

    let reachedEnd: string | undefined;
    while (unvisited.size > 0) {
      let u: string | undefined;
      let uCap = -1;
      for (const cand of unvisited) {
        const c = bestCap.get(cand) ?? -1;
        if (c > uCap) {
          uCap = c;
          u = cand;
        }
      }
      if (u === undefined || uCap <= 0) break;
      unvisited.delete(u);
      if (keptEnds.has(u)) {
        reachedEnd = u;
        break;
      }
      for (const e of fullAdj.get(u) ?? []) {
        if (!unvisited.has(e.target)) continue;
        const candCap = Math.min(uCap, e.frequency);
        if (candCap > (bestCap.get(e.target) ?? -1)) {
          bestCap.set(e.target, candCap);
          prevEdge.set(e.target, e);
        }
      }
    }

    if (reachedEnd !== undefined) {
      let cur = reachedEnd;
      keptNodeSet.add(cur);
      const guard = new Set<string>();
      while (prevEdge.has(cur) && !guard.has(cur)) {
        guard.add(cur);
        const e = prevEdge.get(cur)!;
        keptNodeSet.add(e.source);
        keptNodeSet.add(e.target);
        keptEdgeKeys.add(`${e.source}\0${e.target}`);
        cur = e.source;
      }
    }
  }

  const filteredNodes = nodes.filter((n) => keptNodeSet.has(n.activity));
  const filteredEdges = edges.filter((e) => keptEdgeKeys.has(`${e.source}\0${e.target}`));
  const filteredStarts: Record<string, number> = {};
  for (const [act, cnt] of Object.entries(startActivities)) {
    if (keptNodeSet.has(act)) filteredStarts[act] = cnt;
  }
  const filteredEnds: Record<string, number> = {};
  for (const [act, cnt] of Object.entries(endActivities)) {
    if (keptNodeSet.has(act)) filteredEnds[act] = cnt;
  }

  return {
    nodes: filteredNodes,
    edges: filteredEdges,
    startActivities: filteredStarts,
    endActivities: filteredEnds
  };
}

export function discoverOcDfg(
  logs: DiscoverDocLike | readonly DiscoverDocLike[],
  options: DiscoverOcDfgOptions = {}
): OcDfgModel {
  const docs = Array.isArray(logs) ? logs : [logs];
  const minReviewMs = options.minReviewMs ?? 1000;
  const slowOversightMs = options.slowOversightMs ?? 30_000;
  const minActivityFrequency = Math.max(0, options.minActivityFrequency ?? 0);
  const minEdgeFrequency = Math.max(0, options.minEdgeFrequency ?? 0);
  const noiseThreshold = Math.min(1, Math.max(0, options.noiseThreshold ?? 0));

  const allObjectTypes = new Set<string>();
  const allEventTypes = new Set<string>();

  // Per object type accumulators
  const traceCountByOt = new Map<string, number>();
  const nodeEventsByOt = new Map<string, Map<string, Set<string>>>();
  const nodeTotalObjectsByOt = new Map<string, Map<string, number>>();
  const nodeObjectsByOt = new Map<string, Map<string, Set<string>>>();
  const nodeSojournByOt = new Map<string, Map<string, number[]>>();
  const startActByOt = new Map<string, Map<string, number>>();
  const endActByOt = new Map<string, Map<string, number>>();
  const edgeDurationsByOt = new Map<string, Map<string, number[]>>();
  const edgeEventsByOt = new Map<string, Map<string, Set<string>>>();
  const edgeObjectsByOt = new Map<string, Map<string, Set<string>>>();
  const objSojournByOt = new Map<string, number[]>();

  // Convergence (same-type multiplicity >= 2 on one event),
  // Divergence (same object participating in >= 2 events of the same activity),
  // Synchronization (>= 2 distinct objectTypes on one event)
  const convergenceMap = new Map<string, { activity: string; objectType: string; maxObjectsPerEvent: number; count: number }>();
  const divergenceMap = new Map<
    string,
    { activity: string; objectType: string; maxEventsPerObject: number; count: number; differingOtherTypes: Set<string> }
  >();
  const synchronizationMap = new Map<string, { activity: string; objectTypes: string[]; count: number }>();

  // Trace-level rework cycles (witnessed repetitions with real sampleEventIds)
  const traceCycleMap = new Map<string, { objectType: string; cycle: string[]; count: number; sampleEventIds: string[] }>();

  // File collisions
  const fileMutationMap = new Map<
    string,
    { fileObjectId: string; filePath?: string; actors: Set<string>; eventIds: Set<string> }
  >();

  // Oversight pairs (keyed globally by permission objectId across rotated docs)
  const permEventsById = new Map<
    string,
    { reqTime?: number; resTime?: number; explicitLatency?: number; decision?: string; eventIds: string[] }
  >();

  const ensureOtAcc = (ot: string) => {
    allObjectTypes.add(ot);
    if (!nodeEventsByOt.has(ot)) nodeEventsByOt.set(ot, new Map());
    if (!nodeTotalObjectsByOt.has(ot)) nodeTotalObjectsByOt.set(ot, new Map());
    if (!nodeObjectsByOt.has(ot)) nodeObjectsByOt.set(ot, new Map());
    if (!nodeSojournByOt.has(ot)) nodeSojournByOt.set(ot, new Map());
    if (!startActByOt.has(ot)) startActByOt.set(ot, new Map());
    if (!endActByOt.has(ot)) endActByOt.set(ot, new Map());
    if (!edgeDurationsByOt.has(ot)) edgeDurationsByOt.set(ot, new Map());
    if (!edgeEventsByOt.has(ot)) edgeEventsByOt.set(ot, new Map());
    if (!edgeObjectsByOt.has(ot)) edgeObjectsByOt.set(ot, new Map());
    if (!objSojournByOt.has(ot)) objSojournByOt.set(ot, []);
    if (!traceCountByOt.has(ot)) traceCountByOt.set(ot, 0);
  };

  // Merge objects and deduplicate events globally across all input documents
  const objById = new Map<string, DiscoverObjectLike>();
  const seenEventIds = new Set<string>();
  const mergedEvents: Array<{ ev: DiscoverEventLike; idx: number; ms: number }> = [];
  let globalIdx = 0;

  for (let docIdx = 0; docIdx < docs.length; docIdx++) {
    const doc = docs[docIdx]!;
    for (const obj of doc.objects ?? []) {
      const existing = objById.get(obj.id);
      if (!existing) {
        objById.set(obj.id, obj);
      } else if (
        Array.isArray(existing.attributes) &&
        existing.attributes.length === 0 &&
        Array.isArray(obj.attributes) &&
        obj.attributes.length > 0
      ) {
        objById.set(obj.id, obj);
      }
      ensureOtAcc(obj.type);
    }

    for (const ev of doc.events ?? []) {
      if (seenEventIds.has(ev.id)) continue;
      seenEventIds.add(ev.id);
      mergedEvents.push({ ev, idx: globalIdx++, ms: Date.parse(ev.time) });
    }
  }

  const totalObjects = objById.size;

  const sortedEvents = mergedEvents
    .sort((a, b) => {
      const am = Number.isFinite(a.ms) ? a.ms : 0;
      const bm = Number.isFinite(b.ms) ? b.ms : 0;
      return am !== bm ? am - bm : a.idx - b.idx;
    })
    .map((x) => x.ev);

  const totalEvents = sortedEvents.length;

  // Map objectId -> globally time-sorted events across all documents
  const eventsByObjectId = new Map<
    string,
    Array<{ ev: DiscoverEventLike; ms: number; ot: string; objectsByOt: Map<string, string[]> }>
  >();

  for (const ev of sortedEvents) {
    allEventTypes.add(ev.type);
    const evMs = Date.parse(ev.time);
    const safeMs = Number.isFinite(evMs) ? evMs : 0;

    const otCounts = new Map<string, number>();
    const objectsByOt = new Map<string, string[]>();
    const seenPairs = new Set<string>();
    const actorIdsForEvent: string[] = [];
    const fileTargetsForEvent: Array<{ id: string; path?: string }> = [];

    for (const rel of ev.relationships ?? []) {
      const obj = objById.get(rel.objectId);
      const ot = obj?.type ?? QUALIFIER_OBJECT_TYPE[rel.qualifier] ?? "unknown";
      ensureOtAcc(ot);

      const pairKey = `${ot}::${rel.objectId}`;
      if (!seenPairs.has(pairKey)) {
        seenPairs.add(pairKey);
        otCounts.set(ot, (otCounts.get(ot) ?? 0) + 1);

        let otObjs = objectsByOt.get(ot);
        if (!otObjs) {
          otObjs = [];
          objectsByOt.set(ot, otObjs);
        }
        otObjs.push(rel.objectId);

        let list = eventsByObjectId.get(rel.objectId);
        if (!list) {
          list = [];
          eventsByObjectId.set(rel.objectId, list);
        }
        list.push({ ev, ms: safeMs, ot, objectsByOt });
      }

      if (ot === "turn" || ot === "subagent" || ot === "worker") {
        actorIdsForEvent.push(rel.objectId);
      }
      if (rel.qualifier === "mutated_in" || ot === "workspace_file") {
        const pathAttr = obj ? readAttrStr(obj.attributes, "path") : undefined;
        fileTargetsForEvent.push({ id: rel.objectId, path: pathAttr });
      }
      if (ot === "permission") {
        let prec = permEventsById.get(rel.objectId);
        if (!prec) {
          prec = { eventIds: [] };
          permEventsById.set(rel.objectId, prec);
        }
        prec.eventIds.push(ev.id);
        if (ev.type === "permission_requested") prec.reqTime = safeMs;
        if (ev.type === "permission_resolved") {
          prec.resTime = safeMs;
          prec.decision = readAttrStr(ev.attributes, "decision") ?? "resolved";
          const lat = readAttrNum(ev.attributes, "decision_latency_ms");
          if (lat !== undefined) prec.explicitLatency = lat;
        }
      }
    }

    // Check file collision from explicit file path attribute when mutated_in isn't present
    if (ev.type === "tool_updated" && fileTargetsForEvent.length === 0) {
      const fp = readAttrStr(ev.attributes, "path") ?? readAttrStr(ev.attributes, "targetFile");
      if (fp) {
        fileTargetsForEvent.push({ id: `path:${fp}`, path: fp });
      }
    }

    if (fileTargetsForEvent.length > 0) {
      const actors =
        actorIdsForEvent.length > 0
          ? actorIdsForEvent
          : [readAttrStr(ev.attributes, "actor") ?? readAttrStr(ev.attributes, "turn_id") ?? ev.id];
      for (const ft of fileTargetsForEvent) {
        const canonicalKey = ft.path ?? ft.id;
        let rec = fileMutationMap.get(canonicalKey);
        if (!rec) {
          rec = { fileObjectId: ft.id, filePath: ft.path, actors: new Set(), eventIds: new Set() };
          fileMutationMap.set(canonicalKey, rec);
        }
        if (!rec.filePath && ft.path) rec.filePath = ft.path;
        for (const a of actors) rec.actors.add(a);
        rec.eventIds.add(ev.id);
      }
    }

    // Convergence (van der Aalst OCEL 2.0): >= 2 objects of same objectType on one event
    for (const [ot, cnt] of otCounts.entries()) {
      if (cnt >= 2) {
        const cKey = `${ev.type}::${ot}`;
        const prev = convergenceMap.get(cKey);
        if (!prev) {
          convergenceMap.set(cKey, { activity: ev.type, objectType: ot, maxObjectsPerEvent: cnt, count: 1 });
        } else {
          prev.count += 1;
          if (cnt > prev.maxObjectsPerEvent) prev.maxObjectsPerEvent = cnt;
        }
      }
    }

    // Synchronization / multi-object interaction: >= 2 distinct objectTypes on one event
    if (otCounts.size >= 2) {
      const sortedOts = [...otCounts.keys()].sort();
      const sKey = `${ev.type}::${sortedOts.join(",")}`;
      const prev = synchronizationMap.get(sKey);
      if (!prev) {
        synchronizationMap.set(sKey, { activity: ev.type, objectTypes: sortedOts, count: 1 });
      } else {
        prev.count += 1;
      }
    }
  }

  // Extract per-object traces, divergence, sojourn durations, and trace-witnessed rework
  for (const [objId, entries] of eventsByObjectId.entries()) {
    if (entries.length === 0) continue;
    const ot = entries[0]!.ot;
    ensureOtAcc(ot);
    traceCountByOt.set(ot, (traceCountByOt.get(ot) ?? 0) + 1);

    const nodeEvents = nodeEventsByOt.get(ot)!;
    const nodeTotalObjs = nodeTotalObjectsByOt.get(ot)!;
    const nodeObjs = nodeObjectsByOt.get(ot)!;
    const nodeSoj = nodeSojournByOt.get(ot)!;
    const startMap = startActByOt.get(ot)!;
    const endMap = endActByOt.get(ot)!;
    const edgeDur = edgeDurationsByOt.get(ot)!;
    const edgeEvents = edgeEventsByOt.get(ot)!;
    const edgeObjs = edgeObjectsByOt.get(ot)!;

    const firstAct = entries[0]!.ev.type;
    const lastAct = entries[entries.length - 1]!.ev.type;
    startMap.set(firstAct, (startMap.get(firstAct) ?? 0) + 1);
    endMap.set(lastAct, (endMap.get(lastAct) ?? 0) + 1);

    // Group events by activity for this object to detect true OCEL 2.0 divergence
    const entriesByActivity = new Map<string, typeof entries>();

    // Node E/UO/TO frequencies & per-event service/sojourn sampling
    for (let i = 0; i < entries.length; i++) {
      const cur = entries[i]!;
      const act = cur.ev.type;
      nodeTotalObjs.set(act, (nodeTotalObjs.get(act) ?? 0) + 1);

      let nEvSet = nodeEvents.get(act);
      if (!nEvSet) {
        nEvSet = new Set();
        nodeEvents.set(act, nEvSet);
      }
      nEvSet.add(cur.ev.id);

      let nObjSet = nodeObjs.get(act);
      if (!nObjSet) {
        nObjSet = new Set();
        nodeObjs.set(act, nObjSet);
      }
      nObjSet.add(objId);

      let actList = entriesByActivity.get(act);
      if (!actList) {
        actList = [];
        entriesByActivity.set(act, actList);
      }
      actList.push(cur);

      const svcMs =
        readAttrNum(cur.ev.attributes, "service_ms") ??
        readAttrNum(cur.ev.attributes, "decision_latency_ms");
      const stepMs =
        svcMs !== undefined
          ? svcMs
          : i + 1 < entries.length
            ? Math.max(0, entries[i + 1]!.ms - cur.ms)
            : undefined;
      if (stepMs !== undefined) {
        let arr = nodeSoj.get(act);
        if (!arr) {
          arr = [];
          nodeSoj.set(act, arr);
        }
        arr.push(stepMs);
      }

      if (i + 1 < entries.length) {
        const nxt = entries[i + 1]!;
        const eKey = `${act}\0${nxt.ev.type}`;
        const delta = Math.max(0, nxt.ms - cur.ms);
        let arr = edgeDur.get(eKey);
        if (!arr) {
          arr = [];
          edgeDur.set(eKey, arr);
        }
        arr.push(delta);

        let eEvSet = edgeEvents.get(eKey);
        if (!eEvSet) {
          eEvSet = new Set();
          edgeEvents.set(eKey, eEvSet);
        }
        eEvSet.add(`${cur.ev.id}\0${nxt.ev.id}`);

        let eObjSet = edgeObjs.get(eKey);
        if (!eObjSet) {
          eObjSet = new Set();
          edgeObjs.set(eKey, eObjSet);
        }
        eObjSet.add(objId);
      }
    }

    // Divergence (van der Aalst OCEL 2.0): same object participating in >= 2 events of same activity
    for (const [act, actEntries] of entriesByActivity.entries()) {
      if (actEntries.length >= 2) {
        const dKey = `${act}::${ot}`;
        let prev = divergenceMap.get(dKey);
        if (!prev) {
          prev = {
            activity: act,
            objectType: ot,
            maxEventsPerObject: actEntries.length,
            count: 1,
            differingOtherTypes: new Set<string>()
          };
          divergenceMap.set(dKey, prev);
        } else {
          prev.count += 1;
          if (actEntries.length > prev.maxEventsPerObject) {
            prev.maxEventsPerObject = actEntries.length;
          }
        }

        // Check whether other object types vary across these same-activity events
        const otherTypes = new Set<string>();
        for (const ae of actEntries) {
          for (const otherOt of ae.objectsByOt.keys()) {
            if (otherOt !== ot) otherTypes.add(otherOt);
          }
        }
        for (const otherOt of otherTypes) {
          const signatures = new Set<string>();
          for (const ae of actEntries) {
            const ids = [...(ae.objectsByOt.get(otherOt) ?? [])].sort().join(",");
            signatures.add(ids);
          }
          if (signatures.size >= 2) {
            prev.differingOtherTypes.add(otherOt);
          }
        }
      }
    }

    // Object-level sojourn
    const obj = objById.get(objId);
    const objSvc =
      (obj ? readAttrNum(obj.attributes, "service_ms") ?? readAttrNum(obj.attributes, "decision_latency_ms") : undefined) ??
      (entries.length === 1
        ? readAttrNum(entries[0]!.ev.attributes, "service_ms") ??
          readAttrNum(entries[0]!.ev.attributes, "decision_latency_ms")
        : undefined);
    const objSojourn =
      entries.length >= 2
        ? Math.max(0, entries[entries.length - 1]!.ms - entries[0]!.ms)
        : objSvc;
    if (objSojourn !== undefined) {
      objSojournByOt.get(ot)!.push(objSojourn);
    }

    // Trace-level rework cycle detection (repeated activity A -> ... -> A)
    const lastIndexByAct = new Map<string, number>();
    for (let i = 0; i < entries.length; i++) {
      const act = entries[i]!.ev.type;
      const prevIdx = lastIndexByAct.get(act);
      if (prevIdx !== undefined) {
        const cycleActs = entries.slice(prevIdx, i + 1).map((x) => x.ev.type);
        const cycKey = `${ot}::${cycleActs.join("->")}`;
        const existing = traceCycleMap.get(cycKey);
        const evIds = entries.slice(prevIdx, i + 1).map((x) => x.ev.id);
        if (!existing) {
          traceCycleMap.set(cycKey, { objectType: ot, cycle: cycleActs, count: 1, sampleEventIds: evIds });
        } else {
          existing.count += 1;
        }
      }
      lastIndexByAct.set(act, i);
    }
  }

  // Finalize per-object-type graphs (trace-witnessed rework only; no SCC fabrication)
  const byObjectType: Record<string, OcDfgPerTypeGraph> = {};
  const sojournByObjectType: Record<string, SojournStats> = {};
  const reworkCycles: ReworkCycleFinding[] = [...traceCycleMap.values()];

  for (const ot of [...allObjectTypes].sort()) {
    const nodeEvents = nodeEventsByOt.get(ot)!;
    const nodeTotalObjs = nodeTotalObjectsByOt.get(ot)!;
    const nodeObjs = nodeObjectsByOt.get(ot)!;
    const nodeSoj = nodeSojournByOt.get(ot)!;
    const startMap = startActByOt.get(ot)!;
    const endMap = endActByOt.get(ot)!;
    const edgeDur = edgeDurationsByOt.get(ot)!;
    const edgeEvents = edgeEventsByOt.get(ot)!;
    const edgeObjs = edgeObjectsByOt.get(ot)!;

    const rawNodes: OcDfgNode[] = [...nodeEvents.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([activity, evSet]) => {
        const st = computeSummaryStats(nodeSoj.get(activity) ?? []);
        const eventCount = evSet.size;
        return {
          activity,
          frequency: eventCount,
          eventCount,
          objectCount: nodeObjs.get(activity)?.size ?? 0,
          totalObjects: nodeTotalObjs.get(activity) ?? 0,
          medianSojournMs: st.medianMs,
          p95SojournMs: st.p95Ms,
          meanSojournMs: st.meanMs,
          cs2: st.cs2
        };
      });

    const rawEdges: OcDfgEdge[] = [...edgeDur.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, durs]) => {
        const sep = key.indexOf("\0");
        const source = key.slice(0, sep);
        const target = key.slice(sep + 1);
        const st = computeSummaryStats(durs);
        const eventCount = edgeEvents.get(key)?.size ?? 0;
        return {
          source,
          target,
          objectType: ot,
          frequency: eventCount,
          eventCount,
          objectCount: edgeObjs.get(key)?.size ?? 0,
          totalObjects: durs.length,
          meanMs: st.meanMs,
          medianMs: st.medianMs,
          p95Ms: st.p95Ms,
          cs2: st.cs2
        };
      });

    const rawStarts = Object.fromEntries([...startMap.entries()].sort(([a], [b]) => a.localeCompare(b)));
    const rawEnds = Object.fromEntries([...endMap.entries()].sort(([a], [b]) => a.localeCompare(b)));

    const filtered = filterPerTypeGraph(rawNodes, rawEdges, rawStarts, rawEnds, {
      minActivityFrequency,
      minEdgeFrequency,
      noiseThreshold
    });

    byObjectType[ot] = {
      objectType: ot,
      traceCount: traceCountByOt.get(ot) ?? 0,
      nodes: filtered.nodes,
      edges: filtered.edges,
      startActivities: filtered.startActivities,
      endActivities: filtered.endActivities
    };

    sojournByObjectType[ot] = computeSummaryStats(objSojournByOt.get(ot) ?? []);
  }

  const fileCollisions: FileCollisionFinding[] = [];
  for (const rec of fileMutationMap.values()) {
    if (rec.actors.size >= 2) {
      fileCollisions.push({
        fileObjectId: rec.fileObjectId,
        filePath: rec.filePath,
        actors: [...rec.actors].sort(),
        eventIds: [...rec.eventIds],
        count: rec.eventIds.size
      });
    }
  }

  // Oversight bottlenecks (slow > p95 or > 5000ms, and fast rubber stamps < minReviewMs)
  const permLatencies: Array<{ id: string; latencyMs: number; decision: string; eventIds: string[] }> = [];
  for (const [permId, rec] of permEventsById.entries()) {
    const lat =
      rec.explicitLatency ??
      (rec.reqTime !== undefined && rec.resTime !== undefined ? Math.max(0, rec.resTime - rec.reqTime) : undefined);
    if (lat !== undefined) {
      permLatencies.push({
        id: permId,
        latencyMs: lat,
        decision: rec.decision ?? "unknown",
        eventIds: rec.eventIds
      });
    }
  }
  const permStats = computeSummaryStats(permLatencies.map((p) => p.latencyMs));
  const slowThreshold = Math.max(5000, permStats.p95Ms);
  const oversightBottlenecks: OversightBottleneckFinding[] = [];
  for (const p of permLatencies) {
    if (p.latencyMs < minReviewMs) {
      oversightBottlenecks.push({
        permissionObjectId: p.id,
        latencyMs: p.latencyMs,
        decision: p.decision,
        kind: "rubber_stamp",
        eventIds: p.eventIds
      });
    } else if (
      p.latencyMs >= slowOversightMs ||
      (p.latencyMs >= slowThreshold && p.latencyMs > permStats.medianMs * 2)
    ) {
      oversightBottlenecks.push({
        permissionObjectId: p.id,
        latencyMs: p.latencyMs,
        decision: p.decision,
        kind: "slow_oversight",
        eventIds: p.eventIds
      });
    }
  }

  const divergence: DivergencePattern[] = [...divergenceMap.values()]
    .map((d) => {
      const diff = [...d.differingOtherTypes].sort();
      return {
        activity: d.activity,
        objectType: d.objectType,
        maxEventsPerObject: d.maxEventsPerObject,
        count: d.count,
        ...(diff.length > 0 ? { differingOtherTypes: diff } : {})
      };
    })
    .sort((a, b) => b.count - a.count);

  return {
    schema: "zcode.oc-dfg/1",
    objectTypes: [...allObjectTypes].sort(),
    eventTypes: [...allEventTypes].sort(),
    totalEvents,
    totalObjects,
    byObjectType,
    convergence: [...convergenceMap.values()].sort((a, b) => b.count - a.count),
    divergence,
    synchronization: [...synchronizationMap.values()].sort((a, b) => b.count - a.count),
    reworkCycles,
    fileCollisions,
    oversightBottlenecks,
    sojournByObjectType
  };
}

function sanitizeId(raw: string): string {
  const base = raw.replace(/[^a-zA-Z0-9_]/g, "_");
  if (base === raw && base.length > 0) return base;
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 8);
  return `${base || "id"}_${hash}`;
}

function escapeMermaidLabel(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\[/g, "&#91;")
    .replace(/\]/g, "&#93;")
    .replace(/\r?\n/g, " ");
}

export function formatOcDfgDot(dfg: OcDfgModel): string {
  const lines: string[] = [
    "digraph OC_DFG {",
    '  rankdir=LR;',
    '  node [shape=box, fontname="Helvetica"];'
  ];

  for (const ot of dfg.objectTypes) {
    const graph = dfg.byObjectType[ot];
    if (!graph || (graph.nodes.length === 0 && graph.edges.length === 0)) continue;
    const otId = sanitizeId(ot);
    lines.push(`  subgraph cluster_${otId} {`);
    lines.push(`    label=${JSON.stringify(`objectType: ${ot} (traces=${graph.traceCount})`)};`);
    for (const n of graph.nodes) {
      lines.push(
        `    ${otId}__${sanitizeId(n.activity)} [label=${JSON.stringify(`${n.activity}\\n(${n.frequency})`)}];`
      );
    }
    for (const e of graph.edges) {
      lines.push(
        `    ${otId}__${sanitizeId(e.source)} -> ${otId}__${sanitizeId(e.target)} [label=${JSON.stringify(`${ot}: ${e.frequency} (${Math.round(e.medianMs)}ms)`)}];`
      );
    }
    lines.push("  }");
  }

  lines.push("}");
  return lines.join("\n");
}

export function formatOcDfgMermaid(dfg: OcDfgModel): string {
  const lines: string[] = ["flowchart LR"];
  for (const ot of dfg.objectTypes) {
    const graph = dfg.byObjectType[ot];
    if (!graph || (graph.nodes.length === 0 && graph.edges.length === 0)) continue;
    const otId = sanitizeId(ot);
    lines.push(`  subgraph ${otId}[${escapeMermaidLabel(ot)}]`);
    for (const n of graph.nodes) {
      lines.push(
        `    ${otId}_${sanitizeId(n.activity)}["${escapeMermaidLabel(`${n.activity} (${n.frequency})`)}"]`
      );
    }
    for (const e of graph.edges) {
      lines.push(
        `    ${otId}_${sanitizeId(e.source)} -->|"${escapeMermaidLabel(`${e.frequency} / ${Math.round(e.medianMs)}ms`)}"| ${otId}_${sanitizeId(e.target)}`
      );
    }
    lines.push("  end");
  }
  return lines.join("\n");
}
