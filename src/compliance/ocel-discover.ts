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
  frequency: number;
  medianSojournMs: number;
  p95SojournMs: number;
  meanSojournMs: number;
  cs2: number;
}

export interface OcDfgEdge {
  source: string;
  target: string;
  objectType: string;
  frequency: number;
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
  objectTypes: string[];
  count: number;
}

export interface DivergencePattern {
  activity: string;
  objectType: string;
  maxObjectsPerEvent: number;
  count: number;
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

function detectSccs(nodes: readonly string[], edges: readonly { source: string; target: string }[]): string[][] {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n, []);
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }

  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const sccs: string[][] = [];

  const strongConnect = (v: string) => {
    indices.set(v, index);
    lowlink.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);

    for (const w of adj.get(v) ?? []) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const comp: string[] = [];
      while (true) {
        const w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
        if (w === v) break;
      }
      if (comp.length > 1) {
        sccs.push(comp.reverse());
      } else if (comp.length === 1) {
        const only = comp[0]!;
        if ((adj.get(only) ?? []).includes(only)) {
          sccs.push(comp);
        }
      }
    }
  };

  for (const n of nodes) {
    if (!indices.has(n)) strongConnect(n);
  }
  return sccs;
}

export function discoverOcDfg(
  logs: DiscoverDocLike | readonly DiscoverDocLike[],
  options: { minReviewMs?: number; slowOversightMs?: number } = {}
): OcDfgModel {
  const docs = Array.isArray(logs) ? logs : [logs];
  const minReviewMs = options.minReviewMs ?? 1000;
  const slowOversightMs = options.slowOversightMs ?? 30_000;

  const allObjectTypes = new Set<string>();
  const allEventTypes = new Set<string>();
  let totalEvents = 0;
  let totalObjects = 0;

  // Per object type accumulators
  const traceCountByOt = new Map<string, number>();
  const nodeFreqByOt = new Map<string, Map<string, number>>();
  const nodeSojournByOt = new Map<string, Map<string, number[]>>();
  const startActByOt = new Map<string, Map<string, number>>();
  const endActByOt = new Map<string, Map<string, number>>();
  const edgeDurationsByOt = new Map<string, Map<string, number[]>>();
  const objSojournByOt = new Map<string, number[]>();

  // Convergence & Divergence
  const convergenceMap = new Map<string, { activity: string; objectTypes: string[]; count: number }>();
  const divergenceMap = new Map<string, { activity: string; objectType: string; maxObjectsPerEvent: number; count: number }>();

  // Rework cycles (trace-level + SCCs)
  const traceCycleMap = new Map<string, { objectType: string; cycle: string[]; count: number; sampleEventIds: string[] }>();

  // File collisions
  const fileMutationMap = new Map<
    string,
    { fileObjectId: string; filePath?: string; actors: Set<string>; eventIds: Set<string> }
  >();

  // Oversight pairs
  const permEventsById = new Map<
    string,
    { reqTime?: number; resTime?: number; explicitLatency?: number; decision?: string; eventIds: string[] }
  >();

  const ensureOtAcc = (ot: string) => {
    allObjectTypes.add(ot);
    if (!nodeFreqByOt.has(ot)) nodeFreqByOt.set(ot, new Map());
    if (!nodeSojournByOt.has(ot)) nodeSojournByOt.set(ot, new Map());
    if (!startActByOt.has(ot)) startActByOt.set(ot, new Map());
    if (!endActByOt.has(ot)) endActByOt.set(ot, new Map());
    if (!edgeDurationsByOt.has(ot)) edgeDurationsByOt.set(ot, new Map());
    if (!objSojournByOt.has(ot)) objSojournByOt.set(ot, []);
    if (!traceCountByOt.has(ot)) traceCountByOt.set(ot, 0);
  };

  for (let docIdx = 0; docIdx < docs.length; docIdx++) {
    const doc = docs[docIdx]!;
    const objById = new Map<string, DiscoverObjectLike>();
    for (const obj of doc.objects ?? []) {
      objById.set(obj.id, obj);
      totalObjects += 1;
      ensureOtAcc(obj.type);
    }

    const sortedEvents = [...(doc.events ?? [])]
      .map((ev, idx) => ({ ev, idx, ms: Date.parse(ev.time) }))
      .sort((a, b) => {
        const am = Number.isFinite(a.ms) ? a.ms : 0;
        const bm = Number.isFinite(b.ms) ? b.ms : 0;
        return am !== bm ? am - bm : a.idx - b.idx;
      })
      .map((x) => x.ev);

    // Map objectId -> sorted events in this doc
    const eventsByObjectId = new Map<string, Array<{ ev: DiscoverEventLike; ms: number; ot: string }>>();

    for (const ev of sortedEvents) {
      totalEvents += 1;
      allEventTypes.add(ev.type);
      const evMs = Date.parse(ev.time);
      const safeMs = Number.isFinite(evMs) ? evMs : 0;

      const otCounts = new Map<string, number>();
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

          let list = eventsByObjectId.get(rel.objectId);
          if (!list) {
            list = [];
            eventsByObjectId.set(rel.objectId, list);
          }
          list.push({ ev, ms: safeMs, ot });
        }

        if (ot === "turn" || ot === "subagent" || ot === "worker") {
          actorIdsForEvent.push(rel.objectId);
        }
        if (rel.qualifier === "mutated_in" || ot === "workspace_file") {
          const pathAttr = obj ? readAttrStr(obj.attributes, "path") : undefined;
          fileTargetsForEvent.push({ id: rel.objectId, path: pathAttr });
        }
        if (ot === "permission") {
          const permKey = `${docIdx}:${rel.objectId}`;
          let prec = permEventsById.get(permKey);
          if (!prec) {
            prec = { eventIds: [] };
            permEventsById.set(permKey, prec);
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

      // Divergence (>= 2 objects of same objectType on one event)
      for (const [ot, cnt] of otCounts.entries()) {
        if (cnt >= 2) {
          const dKey = `${ev.type}::${ot}`;
          const prev = divergenceMap.get(dKey);
          if (!prev) {
            divergenceMap.set(dKey, { activity: ev.type, objectType: ot, maxObjectsPerEvent: cnt, count: 1 });
          } else {
            prev.count += 1;
            if (cnt > prev.maxObjectsPerEvent) prev.maxObjectsPerEvent = cnt;
          }
        }
      }

      // Convergence (>= 2 distinct objectTypes on one event)
      if (otCounts.size >= 2) {
        const sortedOts = [...otCounts.keys()].sort();
        const cKey = `${ev.type}::${sortedOts.join(",")}`;
        const prev = convergenceMap.get(cKey);
        if (!prev) {
          convergenceMap.set(cKey, { activity: ev.type, objectTypes: sortedOts, count: 1 });
        } else {
          prev.count += 1;
        }
      }
    }

    // Extract per-object traces & sojourn durations
    for (const [objId, entries] of eventsByObjectId.entries()) {
      if (entries.length === 0) continue;
      const ot = entries[0]!.ot;
      ensureOtAcc(ot);
      traceCountByOt.set(ot, (traceCountByOt.get(ot) ?? 0) + 1);

      const nodeFreq = nodeFreqByOt.get(ot)!;
      const nodeSoj = nodeSojournByOt.get(ot)!;
      const startMap = startActByOt.get(ot)!;
      const endMap = endActByOt.get(ot)!;
      const edgeDur = edgeDurationsByOt.get(ot)!;

      const firstAct = entries[0]!.ev.type;
      const lastAct = entries[entries.length - 1]!.ev.type;
      startMap.set(firstAct, (startMap.get(firstAct) ?? 0) + 1);
      endMap.set(lastAct, (endMap.get(lastAct) ?? 0) + 1);

      // Node frequencies & per-event service/sojourn sampling
      for (let i = 0; i < entries.length; i++) {
        const cur = entries[i]!;
        nodeFreq.set(cur.ev.type, (nodeFreq.get(cur.ev.type) ?? 0) + 1);

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
          let arr = nodeSoj.get(cur.ev.type);
          if (!arr) {
            arr = [];
            nodeSoj.set(cur.ev.type, arr);
          }
          arr.push(stepMs);
        }

        if (i + 1 < entries.length) {
          const nxt = entries[i + 1]!;
          const eKey = `${cur.ev.type}\0${nxt.ev.type}`;
          const delta = Math.max(0, nxt.ms - cur.ms);
          let arr = edgeDur.get(eKey);
          if (!arr) {
            arr = [];
            edgeDur.set(eKey, arr);
          }
          arr.push(delta);
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
  }

  // Finalize per-object-type graphs & SCC rework detection
  const byObjectType: Record<string, OcDfgPerTypeGraph> = {};
  const sojournByObjectType: Record<string, SojournStats> = {};
  const reworkCycles: ReworkCycleFinding[] = [...traceCycleMap.values()];
  const seenNodeSets = new Set<string>(
    reworkCycles.map((r) => `${r.objectType}::${[...new Set(r.cycle)].sort().join(",")}`)
  );

  for (const ot of [...allObjectTypes].sort()) {
    const nodeFreq = nodeFreqByOt.get(ot)!;
    const nodeSoj = nodeSojournByOt.get(ot)!;
    const startMap = startActByOt.get(ot)!;
    const endMap = endActByOt.get(ot)!;
    const edgeDur = edgeDurationsByOt.get(ot)!;

    const nodes: OcDfgNode[] = [...nodeFreq.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([activity, frequency]) => {
        const st = computeSummaryStats(nodeSoj.get(activity) ?? []);
        return {
          activity,
          frequency,
          medianSojournMs: st.medianMs,
          p95SojournMs: st.p95Ms,
          meanSojournMs: st.meanMs,
          cs2: st.cs2
        };
      });

    const edges: OcDfgEdge[] = [...edgeDur.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, durs]) => {
        const sep = key.indexOf("\0");
        const source = key.slice(0, sep);
        const target = key.slice(sep + 1);
        const st = computeSummaryStats(durs);
        return {
          source,
          target,
          objectType: ot,
          frequency: durs.length,
          meanMs: st.meanMs,
          medianMs: st.medianMs,
          p95Ms: st.p95Ms,
          cs2: st.cs2
        };
      });

    const sccs = detectSccs(
      nodes.map((n) => n.activity),
      edges
    );
    for (const scc of sccs) {
      const k = `${ot}::${[...new Set(scc)].sort().join(",")}`;
      if (!seenNodeSets.has(k)) {
        seenNodeSets.add(k);
        reworkCycles.push({ objectType: ot, cycle: scc, count: 1, sampleEventIds: [] });
      }
    }

    byObjectType[ot] = {
      objectType: ot,
      traceCount: traceCountByOt.get(ot) ?? 0,
      nodes,
      edges,
      startActivities: Object.fromEntries([...startMap.entries()].sort(([a], [b]) => a.localeCompare(b))),
      endActivities: Object.fromEntries([...endMap.entries()].sort(([a], [b]) => a.localeCompare(b)))
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
  for (const [permKey, rec] of permEventsById.entries()) {
    const lat =
      rec.explicitLatency ??
      (rec.reqTime !== undefined && rec.resTime !== undefined ? Math.max(0, rec.resTime - rec.reqTime) : undefined);
    if (lat !== undefined) {
      permLatencies.push({
        id: permKey.replace(/^\d+:/, ""),
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

  return {
    schema: "zcode.oc-dfg/1",
    objectTypes: [...allObjectTypes].sort(),
    eventTypes: [...allEventTypes].sort(),
    totalEvents,
    totalObjects,
    byObjectType,
    convergence: [...convergenceMap.values()].sort((a, b) => b.count - a.count),
    divergence: [...divergenceMap.values()].sort((a, b) => b.count - a.count),
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
