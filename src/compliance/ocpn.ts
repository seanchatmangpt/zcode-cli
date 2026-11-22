import { createHash } from "node:crypto";
import type {
  DiscoverDocLike,
  OcDfgModel,
  ReworkCycleFinding,
  FileCollisionFinding,
  SojournStats
} from "./ocel-discover.ts";

export const DEFAULT_REQUIRED_OCPN_OBJECT_TYPES = [
  "session",
  "turn",
  "tool_call",
  "permission",
  "model_request"
] as const;

export interface OcpnPlace {
  id: string;
  objectType: string;
  role: "source" | "sink" | "internal";
}

export interface OcpnTransition {
  id: string;
  activity: string;
  silent: boolean;
  objectTypes: string[];
}

export interface OcpnArc {
  id: string;
  source: string;
  target: string;
  objectType: string;
  direction: "place_to_transition" | "transition_to_place";
  variable: boolean;
}

export interface OcpnSoundnessResult {
  sound: boolean;
  perObjectType: Record<
    string,
    {
      sound: boolean;
      sourcePlace: string;
      sinkPlace: string;
      unreachableFromSource: string[];
      deadEndsToSink: string[];
      deadTransitions?: string[];
      optionToComplete?: boolean;
      properCompletion?: boolean;
      stateSpaceTruncated?: boolean;
      issues: string[];
    }
  >;
  synchronizationDeadlocks?: string[];
  issues: string[];
}

export interface OcpnDiagnostic {
  code: "UNOBSERVED_OBJECT_TYPE" | "UNSOUND_SUBNET";
  objectType?: string;
  message: string;
}

export interface OcpnModel {
  schema: "zcode.ocpn/1";
  objectTypes: string[];
  places: OcpnPlace[];
  transitions: OcpnTransition[];
  arcs: OcpnArc[];
  sourcePlaces: Record<string, string>;
  sinkPlaces: Record<string, string>;
  soundness: OcpnSoundnessResult;
  diagnostics: OcpnDiagnostic[];
  warnings: string[];
  reworkCycles: ReworkCycleFinding[];
  fileCollisions: FileCollisionFinding[];
  sojournByObjectType: Record<string, SojournStats>;
}

export interface OcpnReplayPerTypeMetrics {
  objectType: string;
  objectCount: number;
  produced: number;
  consumed: number;
  missing: number;
  remaining: number;
  fitness: number;
  soundTermination: boolean;
}

export interface OcpnReplayResult {
  produced: number;
  consumed: number;
  missing: number;
  remaining: number;
  fitness: number;
  soundTermination: boolean;
  unobservedEvents: string[];
  perObjectType: Record<string, OcpnReplayPerTypeMetrics>;
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

type ProcessTree =
  | { kind: "leaf"; activity: string }
  | { kind: "tau" }
  | { kind: "seq"; children: ProcessTree[] }
  | { kind: "xor"; children: ProcessTree[] }
  | { kind: "and"; children: ProcessTree[] }
  | { kind: "loop"; body: ProcessTree; redo: ProcessTree };

interface SubDfg {
  nodes: string[];
  edges: Map<string, Set<string>>;
  starts: Set<string>;
  ends: Set<string>;
}

function buildSubDfg(
  nodes: string[],
  parentEdges: Map<string, Set<string>>,
  starts: Set<string>,
  ends: Set<string>
): SubDfg {
  const nodeSet = new Set(nodes);
  const edges = new Map<string, Set<string>>();
  for (const u of nodes) {
    const out = new Set<string>();
    for (const v of parentEdges.get(u) ?? []) {
      if (nodeSet.has(v)) out.add(v);
    }
    edges.set(u, out);
  }
  const effStarts = new Set<string>([...starts].filter((s) => nodeSet.has(s)));
  const effEnds = new Set<string>([...ends].filter((e) => nodeSet.has(e)));
  if (effStarts.size === 0) {
    for (const n of nodes) effStarts.add(n);
  }
  if (effEnds.size === 0) {
    for (const n of nodes) effEnds.add(n);
  }
  return { nodes, edges, starts: effStarts, ends: effEnds };
}

function undirectedComponents(nodes: string[], hasEdge: (u: string, v: string) => boolean): string[][] {
  const visited = new Set<string>();
  const comps: string[][] = [];
  for (const start of nodes) {
    if (visited.has(start)) continue;
    const comp: string[] = [];
    const stack = [start];
    visited.add(start);
    while (stack.length > 0) {
      const u = stack.pop()!;
      comp.push(u);
      for (const v of nodes) {
        if (!visited.has(v) && (hasEdge(u, v) || hasEdge(v, u))) {
          visited.add(v);
          stack.push(v);
        }
      }
    }
    comps.push(comp);
  }
  return comps;
}

function computeSccs(nodes: string[], edges: Map<string, Set<string>>): string[][] {
  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  const strongconnect = (v: string) => {
    indices.set(v, index);
    lowlink.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);

    for (const w of edges.get(v) ?? []) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const scc: string[] = [];
      while (true) {
        const w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
        if (w === v) break;
      }
      sccs.push(scc);
    }
  };

  for (const v of nodes) {
    if (!indices.has(v)) strongconnect(v);
  }
  // Tarjan outputs SCCs in reverse topological order
  return sccs.reverse();
}

function findSequenceCut(dfg: SubDfg): string[][] | null {
  const sccs = computeSccs(dfg.nodes, dfg.edges);
  if (sccs.length <= 1) return null;

  const sccOf = new Map<string, number>();
  sccs.forEach((comp, idx) => {
    for (const n of comp) sccOf.set(n, idx);
  });

  // Reachability between SCCs
  const k = sccs.length;
  const reach: boolean[][] = Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) => i === j)
  );
  for (const [u, outs] of dfg.edges.entries()) {
    const su = sccOf.get(u)!;
    for (const v of outs) {
      const sv = sccOf.get(v)!;
      if (su !== sv) reach[su]![sv] = true;
    }
  }
  for (let m = 0; m < k; m++) {
    for (let i = 0; i < k; i++) {
      if (!reach[i]![m]) continue;
      for (let j = 0; j < k; j++) {
        if (reach[m]![j]) reach[i]![j] = true;
      }
    }
  }

  // Merge pairwise-unreachable SCCs into the same sequence block
  const parent = Array.from({ length: k }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      if (!reach[i]![j] && !reach[j]![i]) {
        union(i, j);
      }
    }
  }

  const blockMap = new Map<number, number[]>();
  for (let i = 0; i < k; i++) {
    const r = find(i);
    if (!blockMap.has(r)) blockMap.set(r, []);
    blockMap.get(r)!.push(i);
  }
  if (blockMap.size <= 1) return null;

  const blockIds = [...blockMap.keys()];
  // Topological sort of merged blocks
  const blockInDeg = new Map<number, number>(blockIds.map((b) => [b, 0]));
  const blockAdj = new Map<number, Set<number>>(blockIds.map((b) => [b, new Set()]));
  for (let i = 0; i < k; i++) {
    const bi = find(i);
    for (let j = 0; j < k; j++) {
      const bj = find(j);
      if (bi !== bj && reach[i]![j] && !blockAdj.get(bi)!.has(bj)) {
        blockAdj.get(bi)!.add(bj);
        blockInDeg.set(bj, blockInDeg.get(bj)! + 1);
      }
    }
  }

  const queue = blockIds.filter((b) => blockInDeg.get(b) === 0);
  const orderedBlocks: number[] = [];
  while (queue.length > 0) {
    const b = queue.shift()!;
    orderedBlocks.push(b);
    for (const nxt of blockAdj.get(b)!) {
      const deg = blockInDeg.get(nxt)! - 1;
      blockInDeg.set(nxt, deg);
      if (deg === 0) queue.push(nxt);
    }
  }

  if (orderedBlocks.length !== blockIds.length) return null;

  return orderedBlocks.map((b) => {
    const nodes: string[] = [];
    for (const sccIdx of blockMap.get(b)!) {
      nodes.push(...sccs[sccIdx]!);
    }
    return nodes;
  });
}

function discoverProcessTree(dfg: SubDfg, depth = 0): ProcessTree {
  const { nodes, edges, starts, ends } = dfg;
  if (nodes.length === 0) return { kind: "tau" };
  if (nodes.length === 1) {
    const act = nodes[0]!;
    const leaf: ProcessTree = { kind: "leaf", activity: act };
    if (edges.get(act)?.has(act)) {
      return { kind: "loop", body: leaf, redo: { kind: "tau" } };
    }
    return leaf;
  }
  if (depth > 64) {
    return {
      kind: "loop",
      body: { kind: "xor", children: nodes.map((activity) => ({ kind: "leaf", activity })) },
      redo: { kind: "tau" }
    };
  }

  // 1. Exclusive-choice (XOR) cut: disconnected components in undirected DFG
  const xorComps = undirectedComponents(nodes, (u, v) => Boolean(edges.get(u)?.has(v)));
  if (xorComps.length > 1) {
    return {
      kind: "xor",
      children: xorComps.map((comp) =>
        discoverProcessTree(buildSubDfg(comp, edges, starts, ends), depth + 1)
      )
    };
  }

  // 2. Sequence (SEQ) cut: condensation DAG of SCCs with mutually-unreachable SCCs merged
  const seqBlocks = findSequenceCut(dfg);
  if (seqBlocks && seqBlocks.length > 1) {
    return {
      kind: "seq",
      children: seqBlocks.map((block) => {
        const blockSet = new Set(block);
        const subStarts = new Set<string>([...starts].filter((s) => blockSet.has(s)));
        const subEnds = new Set<string>([...ends].filter((e) => blockSet.has(e)));
        for (const [u, outs] of edges.entries()) {
          if (!blockSet.has(u)) {
            for (const v of outs) {
              if (blockSet.has(v)) subStarts.add(v);
            }
          } else {
            for (const v of outs) {
              if (!blockSet.has(v)) subEnds.add(u);
            }
          }
        }
        return discoverProcessTree(buildSubDfg(block, edges, subStarts, subEnds), depth + 1);
      })
    };
  }

  // 3. Parallel (AND) cut: connected components of non-concurrent graph
  const andComps = undirectedComponents(
    nodes,
    (u, v) => u !== v && !(edges.get(u)?.has(v) && edges.get(v)?.has(u))
  );
  if (andComps.length > 1) {
    const allHaveStartAndEnd = andComps.every(
      (comp) => comp.some((n) => starts.has(n)) && comp.some((n) => ends.has(n))
    );
    if (allHaveStartAndEnd) {
      return {
        kind: "and",
        children: andComps.map((comp) =>
          discoverProcessTree(buildSubDfg(comp, edges, starts, ends), depth + 1)
        )
      };
    }
  }

  // 4. Redo-loop (LOOP) cut: body = starts ∪ ends, redo = remaining nodes
  const bodySet = new Set<string>([...starts, ...ends]);
  const redoNodes = nodes.filter((n) => !bodySet.has(n));
  if (redoNodes.length > 0 && bodySet.size > 0) {
    let validLoop = true;
    const redoStarts = new Set<string>();
    const redoEnds = new Set<string>();
    for (const [u, outs] of edges.entries()) {
      for (const v of outs) {
        if (bodySet.has(u) && !bodySet.has(v)) {
          if (!ends.has(u)) validLoop = false;
          redoStarts.add(v);
        } else if (!bodySet.has(u) && bodySet.has(v)) {
          if (!starts.has(v)) validLoop = false;
          redoEnds.add(u);
        }
      }
    }
    if (validLoop && redoStarts.size > 0 && redoEnds.size > 0) {
      const bodyNodes = nodes.filter((n) => bodySet.has(n));
      return {
        kind: "loop",
        body: discoverProcessTree(buildSubDfg(bodyNodes, edges, starts, ends), depth + 1),
        redo: discoverProcessTree(buildSubDfg(redoNodes, edges, redoStarts, redoEnds), depth + 1)
      };
    }
  }

  // 5. Flower fall-through (guaranteed sound WF-net)
  return {
    kind: "loop",
    body: { kind: "xor", children: nodes.map((activity) => ({ kind: "leaf", activity })) },
    redo: { kind: "tau" }
  };
}

export function discoverOcpn(
  ocdfg: OcDfgModel,
  options: { requiredObjectTypes?: readonly string[] } = {}
): OcpnModel {
  const required = options.requiredObjectTypes ?? DEFAULT_REQUIRED_OCPN_OBJECT_TYPES;
  const observedSet = new Set(ocdfg.objectTypes);

  const diagnostics: OcpnDiagnostic[] = [];
  const warnings: string[] = [];
  for (const reqOt of required) {
    if (!observedSet.has(reqOt)) {
      const msg = `UNOBSERVED_OBJECT_TYPE:${reqOt}`;
      diagnostics.push({
        code: "UNOBSERVED_OBJECT_TYPE",
        objectType: reqOt,
        message: `Required compliance objectType "${reqOt}" was not observed in OC-DFG logs (${msg}).`
      });
      warnings.push(msg);
    }
  }

  const variableKeySet = new Set<string>();
  for (const div of ocdfg.divergence) {
    variableKeySet.add(`${div.activity}::${div.objectType}`);
  }

  const places: OcpnPlace[] = [];
  const transitionsById = new Map<string, OcpnTransition>();
  const arcs: OcpnArc[] = [];
  const sourcePlaces: Record<string, string> = {};
  const sinkPlaces: Record<string, string> = {};

  let arcSeq = 0;
  const addArc = (
    source: string,
    target: string,
    objectType: string,
    direction: "place_to_transition" | "transition_to_place",
    variable: boolean
  ) => {
    arcSeq += 1;
    arcs.push({
      id: `arc_${arcSeq}`,
      source,
      target,
      objectType,
      direction,
      variable
    });
  };

  const ensureTransition = (id: string, activity: string, silent: boolean, ot: string): OcpnTransition => {
    let t = transitionsById.get(id);
    if (!t) {
      t = { id, activity, silent, objectTypes: [ot] };
      transitionsById.set(id, t);
    } else if (!t.objectTypes.includes(ot)) {
      t.objectTypes.push(ot);
    }
    return t;
  };

  for (const ot of ocdfg.objectTypes) {
    const graph = ocdfg.byObjectType[ot];
    if (!graph || graph.nodes.length === 0) continue;

    const srcId = `p_${sanitizeId(ot)}_source`;
    const snkId = `p_${sanitizeId(ot)}_sink`;
    sourcePlaces[ot] = srcId;
    sinkPlaces[ot] = snkId;
    places.push({ id: srcId, objectType: ot, role: "source" });
    places.push({ id: snkId, objectType: ot, role: "sink" });

    const activities = graph.nodes.map((n) => n.activity);
    const edgeMap = new Map<string, Set<string>>();
    for (const act of activities) edgeMap.set(act, new Set());
    for (const edge of graph.edges) {
      if (!edgeMap.has(edge.source)) edgeMap.set(edge.source, new Set());
      edgeMap.get(edge.source)!.add(edge.target);
    }

    const startActs = Object.keys(graph.startActivities);
    const endActs = Object.keys(graph.endActivities);
    const effectiveStarts = new Set<string>(startActs.length > 0 ? startActs : activities.slice(0, 1));
    const effectiveEnds = new Set<string>(endActs.length > 0 ? endActs : activities.slice(-1));

    const tree = discoverProcessTree(buildSubDfg(activities, edgeMap, effectiveStarts, effectiveEnds));

    let internalSeq = 0;
    let tauSeq = 0;
    const otSafe = sanitizeId(ot);

    const newInternalPlace = (): string => {
      internalSeq += 1;
      const pid = `p_${otSafe}_${internalSeq}`;
      places.push({ id: pid, objectType: ot, role: "internal" });
      return pid;
    };

    const newSilent = (kind: string): string => {
      tauSeq += 1;
      const tid = `tau_${kind}_${otSafe}_${tauSeq}`;
      ensureTransition(tid, `tau_${kind}_${ot}`, true, ot);
      return tid;
    };

    const wireTree = (node: ProcessTree, inPlace: string, outPlace: string): void => {
      switch (node.kind) {
        case "leaf": {
          const tid = `t_${sanitizeId(node.activity)}`;
          ensureTransition(tid, node.activity, false, ot);
          const isVar = variableKeySet.has(`${node.activity}::${ot}`);
          addArc(inPlace, tid, ot, "place_to_transition", isVar);
          addArc(tid, outPlace, ot, "transition_to_place", isVar);
          return;
        }
        case "tau": {
          const tid = newSilent("skip");
          addArc(inPlace, tid, ot, "place_to_transition", false);
          addArc(tid, outPlace, ot, "transition_to_place", false);
          return;
        }
        case "seq": {
          const children = node.children;
          if (children.length === 0) {
            wireTree({ kind: "tau" }, inPlace, outPlace);
            return;
          }
          if (children.length === 1) {
            wireTree(children[0]!, inPlace, outPlace);
            return;
          }
          let curIn = inPlace;
          for (let i = 0; i < children.length; i++) {
            const curOut = i === children.length - 1 ? outPlace : newInternalPlace();
            wireTree(children[i]!, curIn, curOut);
            curIn = curOut;
          }
          return;
        }
        case "xor": {
          const children = node.children;
          if (children.length === 0) {
            wireTree({ kind: "tau" }, inPlace, outPlace);
            return;
          }
          for (const child of children) {
            wireTree(child, inPlace, outPlace);
          }
          return;
        }
        case "and": {
          const children = node.children;
          if (children.length === 0) {
            wireTree({ kind: "tau" }, inPlace, outPlace);
            return;
          }
          if (children.length === 1) {
            wireTree(children[0]!, inPlace, outPlace);
            return;
          }
          const splitTid = newSilent("and_split");
          const joinTid = newSilent("and_join");
          addArc(inPlace, splitTid, ot, "place_to_transition", false);
          addArc(joinTid, outPlace, ot, "transition_to_place", false);
          for (const child of children) {
            const branchIn = newInternalPlace();
            const branchOut = newInternalPlace();
            addArc(splitTid, branchIn, ot, "transition_to_place", false);
            addArc(branchOut, joinTid, ot, "place_to_transition", false);
            wireTree(child, branchIn, branchOut);
          }
          return;
        }
        case "loop": {
          // Ensure source place never receives incoming arcs and sink place never has outgoing arcs
          let loopIn = inPlace;
          let loopOut = outPlace;
          if (loopIn === srcId) {
            loopIn = newInternalPlace();
            const enterTid = newSilent("enter");
            addArc(srcId, enterTid, ot, "place_to_transition", false);
            addArc(enterTid, loopIn, ot, "transition_to_place", false);
          }
          if (loopOut === snkId) {
            loopOut = newInternalPlace();
            const exitTid = newSilent("exit");
            addArc(loopOut, exitTid, ot, "place_to_transition", false);
            addArc(exitTid, snkId, ot, "transition_to_place", false);
          }
          wireTree(node.body, loopIn, loopOut);
          wireTree(node.redo, loopOut, loopIn);
          return;
        }
      }
    };

    wireTree(tree, srcId, snkId);
  }

  const transitions = [...transitionsById.values()];
  const modelWithoutSoundness: OcpnModel = {
    schema: "zcode.ocpn/1",
    objectTypes: [...ocdfg.objectTypes],
    places,
    transitions,
    arcs,
    sourcePlaces,
    sinkPlaces,
    soundness: { sound: true, perObjectType: {}, issues: [] },
    diagnostics,
    warnings,
    reworkCycles: ocdfg.reworkCycles,
    fileCollisions: ocdfg.fileCollisions,
    sojournByObjectType: ocdfg.sojournByObjectType
  };

  modelWithoutSoundness.soundness = validateOcpnSoundness(modelWithoutSoundness);
  if (!modelWithoutSoundness.soundness.sound) {
    for (const issue of modelWithoutSoundness.soundness.issues) {
      modelWithoutSoundness.diagnostics.push({ code: "UNSOUND_SUBNET", message: issue });
      modelWithoutSoundness.warnings.push(issue);
    }
  }

  return modelWithoutSoundness;
}

export function validateOcpnSoundness(ocpn: OcpnModel): OcpnSoundnessResult {
  const perObjectType: OcpnSoundnessResult["perObjectType"] = {};
  const globalIssues: string[] = [];

  const placesByOt = new Map<string, OcpnPlace[]>();
  for (const p of ocpn.places) {
    let arr = placesByOt.get(p.objectType);
    if (!arr) {
      arr = [];
      placesByOt.set(p.objectType, arr);
    }
    arr.push(p);
  }

  for (const [ot, otPlaces] of placesByOt.entries()) {
    const src = ocpn.sourcePlaces[ot] ?? otPlaces.find((p) => p.role === "source")?.id ?? "";
    const snk = ocpn.sinkPlaces[ot] ?? otPlaces.find((p) => p.role === "sink")?.id ?? "";
    const otIssues: string[] = [];

    if (!src || !otPlaces.some((p) => p.id === src)) {
      otIssues.push(`Missing source place for objectType "${ot}"`);
    }
    if (!snk || !otPlaces.some((p) => p.id === snk)) {
      otIssues.push(`Missing sink place for objectType "${ot}"`);
    }

    const otArcs = ocpn.arcs.filter((a) => a.objectType === ot);
    const fwd = new Map<string, string[]>();
    const rev = new Map<string, string[]>();

    for (const a of otArcs) {
      if (!fwd.has(a.source)) fwd.set(a.source, []);
      fwd.get(a.source)!.push(a.target);
      if (!rev.has(a.target)) rev.set(a.target, []);
      rev.get(a.target)!.push(a.source);
    }

    if ((rev.get(src) ?? []).length > 0) {
      otIssues.push(`Source place "${src}" for "${ot}" has incoming arcs`);
    }
    if ((fwd.get(snk) ?? []).length > 0) {
      otIssues.push(`Sink place "${snk}" for "${ot}" has outgoing arcs`);
    }

    const reachFromSrc = new Set<string>();
    if (src) {
      reachFromSrc.add(src);
      const q = [src];
      while (q.length > 0) {
        const cur = q.shift()!;
        for (const nxt of fwd.get(cur) ?? []) {
          if (!reachFromSrc.has(nxt)) {
            reachFromSrc.add(nxt);
            q.push(nxt);
          }
        }
      }
    }

    const reachToSnk = new Set<string>();
    if (snk) {
      reachToSnk.add(snk);
      const q = [snk];
      while (q.length > 0) {
        const cur = q.shift()!;
        for (const prv of rev.get(cur) ?? []) {
          if (!reachToSnk.has(prv)) {
            reachToSnk.add(prv);
            q.push(prv);
          }
        }
      }
    }

    const subnetNodeIds = new Set<string>([
      ...otPlaces.map((p) => p.id),
      ...ocpn.transitions.filter((t) => t.objectTypes.includes(ot)).map((t) => t.id)
    ]);

    const unreachableFromSource = [...subnetNodeIds].filter((id) => !reachFromSrc.has(id));
    const deadEndsToSink = [...subnetNodeIds].filter((id) => !reachToSnk.has(id));

    if (unreachableFromSource.length > 0) {
      otIssues.push(`Nodes unreachable from "${src}": ${unreachableFromSource.join(", ")}`);
    }
    if (deadEndsToSink.length > 0) {
      otIssues.push(`Nodes unable to reach "${snk}": ${deadEndsToSink.join(", ")}`);
    }

    // Bounded per-type marking-graph behavioral soundness verification:
    // (1) option-to-complete, (2) proper completion, (3) no dead transitions
    const deadTransitions: string[] = [];
    let optionToComplete = true;
    let properCompletion = true;
    let stateSpaceTruncated = false;

    const hasValidEndpoints =
      Boolean(src) &&
      Boolean(snk) &&
      otPlaces.some((p) => p.id === src) &&
      otPlaces.some((p) => p.id === snk);

    if (hasValidEndpoints) {
      const MAX_STATES = 512;
      const MAX_TOKENS_PER_PLACE = 4;
      const placeIds = otPlaces.map((p) => p.id);
      const placeIdx = new Map<string, number>(placeIds.map((id, idx) => [id, idx]));
      const srcIdx = placeIdx.get(src)!;
      const snkIdx = placeIdx.get(snk)!;

      const otTransitions = ocpn.transitions.filter((t) => t.objectTypes.includes(ot));
      const transEffects = otTransitions.map((t) => {
        const pre = new Map<number, number>();
        const post = new Map<number, number>();
        for (const a of otArcs) {
          if (a.direction === "place_to_transition" && a.target === t.id) {
            const idx = placeIdx.get(a.source);
            if (idx !== undefined) pre.set(idx, (pre.get(idx) ?? 0) + 1);
          } else if (a.direction === "transition_to_place" && a.source === t.id) {
            const idx = placeIdx.get(a.target);
            if (idx !== undefined) post.set(idx, (post.get(idx) ?? 0) + 1);
          }
        }
        return { id: t.id, pre, post };
      });

      const encode = (m: number[]) => m.join(",");
      const initMarking = new Array<number>(placeIds.length).fill(0);
      initMarking[srcIdx] = 1;
      const finalMarking = new Array<number>(placeIds.length).fill(0);
      finalMarking[snkIdx] = 1;

      const initKey = encode(initMarking);
      const finalKey = encode(finalMarking);

      const visited = new Map<string, number[]>([[initKey, initMarking]]);
      const revEdges = new Map<string, string[]>();
      const outDegree = new Map<string, number>();
      const fired = new Set<string>();
      const bfsQueue: string[] = [initKey];
      let head = 0;

      while (head < bfsQueue.length) {
        const curKey = bfsQueue[head++]!;
        const curM = visited.get(curKey)!;

        // Proper completion: if sink is marked, no other tokens may remain and sink count must be 1
        if (curM[snkIdx]! >= 1 && curKey !== finalKey) {
          properCompletion = false;
        }

        let enabledCount = 0;
        for (const tr of transEffects) {
          if (tr.pre.size === 0 && tr.post.size === 0) continue;
          let enabled = true;
          for (const [pIdx, need] of tr.pre.entries()) {
            if (curM[pIdx]! < need) {
              enabled = false;
              break;
            }
          }
          if (!enabled) continue;
          enabledCount += 1;
          fired.add(tr.id);

          const nextM = curM.slice();
          for (const [pIdx, need] of tr.pre.entries()) nextM[pIdx]! -= need;
          for (const [pIdx, add] of tr.post.entries()) nextM[pIdx]! += add;

          if (nextM.some((v) => v > MAX_TOKENS_PER_PLACE)) {
            properCompletion = false;
            stateSpaceTruncated = true;
            continue;
          }

          const nextKey = encode(nextM);
          let revList = revEdges.get(nextKey);
          if (!revList) {
            revList = [];
            revEdges.set(nextKey, revList);
          }
          revList.push(curKey);

          if (!visited.has(nextKey)) {
            if (visited.size >= MAX_STATES) {
              stateSpaceTruncated = true;
            } else {
              visited.set(nextKey, nextM);
              bfsQueue.push(nextKey);
            }
          }
        }
        outDegree.set(curKey, enabledCount);
      }

      if (!properCompletion) {
        otIssues.push(
          `Proper completion violated for "${ot}": reachable marking has extra tokens alongside "${snk}" or exceeds token bound`
        );
      }

      // Option-to-complete: every reachable marking can reach finalKey
      if (!visited.has(finalKey)) {
        optionToComplete = false;
        otIssues.push(`Option-to-complete violated for "${ot}": final marking [${snk}=1] is unreachable`);
      } else {
        const canComplete = new Set<string>([finalKey]);
        const revQ: string[] = [finalKey];
        let rHead = 0;
        while (rHead < revQ.length) {
          const cur = revQ[rHead++]!;
          for (const prv of revEdges.get(cur) ?? []) {
            if (!canComplete.has(prv)) {
              canComplete.add(prv);
              revQ.push(prv);
            }
          }
        }
        for (const k of visited.keys()) {
          if (!canComplete.has(k)) {
            if (!stateSpaceTruncated || (outDegree.get(k) ?? 0) === 0) {
              optionToComplete = false;
              break;
            }
          }
        }
        if (!optionToComplete) {
          otIssues.push(
            `Option-to-complete violated for "${ot}": deadlock or livelock marking cannot reach [${snk}=1]`
          );
        }
      }

      // No dead transitions
      if (!stateSpaceTruncated) {
        for (const tr of otTransitions) {
          if (!fired.has(tr.id)) {
            deadTransitions.push(tr.id);
          }
        }
        if (deadTransitions.length > 0) {
          otIssues.push(`Dead transitions for "${ot}": ${deadTransitions.join(", ")}`);
        }
      }
    }

    const otSound = otIssues.length === 0;
    perObjectType[ot] = {
      sound: otSound,
      sourcePlace: src,
      sinkPlace: snk,
      unreachableFromSource,
      deadEndsToSink,
      deadTransitions,
      optionToComplete,
      properCompletion,
      stateSpaceTruncated,
      issues: otIssues
    };
    globalIssues.push(...otIssues);
  }

  // Cross-object-type synchronization deadlock check over shared transitions
  const synchronizationDeadlocks: string[] = [];
  const sharedTransitions = ocpn.transitions.filter((t) => t.objectTypes.length > 1);
  if (sharedTransitions.length > 0) {
    const syncOts = [...new Set(sharedTransitions.flatMap((t) => t.objectTypes))].filter(
      (ot) => Boolean(perObjectType[ot]?.sourcePlace) && Boolean(perObjectType[ot]?.sinkPlace)
    );
    if (syncOts.length >= 2) {
      const syncOtSet = new Set(syncOts);
      const jointPlaces = ocpn.places.filter((p) => syncOtSet.has(p.objectType));
      const jointPlaceIdx = new Map<string, number>(jointPlaces.map((p, i) => [p.id, i]));
      const jointTransitions = ocpn.transitions.filter((t) =>
        t.objectTypes.some((ot) => syncOtSet.has(ot))
      );

      const jointEffects = jointTransitions.map((t) => {
        const pre = new Map<number, number>();
        const post = new Map<number, number>();
        for (const a of ocpn.arcs) {
          if (!syncOtSet.has(a.objectType)) continue;
          if (a.direction === "place_to_transition" && a.target === t.id) {
            const idx = jointPlaceIdx.get(a.source);
            if (idx !== undefined) pre.set(idx, (pre.get(idx) ?? 0) + 1);
          } else if (a.direction === "transition_to_place" && a.source === t.id) {
            const idx = jointPlaceIdx.get(a.target);
            if (idx !== undefined) post.set(idx, (post.get(idx) ?? 0) + 1);
          }
        }
        return { id: t.id, shared: t.objectTypes.length > 1, pre, post };
      });

      const initJoint = new Array<number>(jointPlaces.length).fill(0);
      const finalJoint = new Array<number>(jointPlaces.length).fill(0);
      for (const ot of syncOts) {
        const sIdx = jointPlaceIdx.get(perObjectType[ot]!.sourcePlace);
        const kIdx = jointPlaceIdx.get(perObjectType[ot]!.sinkPlace);
        if (sIdx !== undefined) initJoint[sIdx] = 1;
        if (kIdx !== undefined) finalJoint[kIdx] = 1;
      }

      const encode = (m: number[]) => m.join(",");
      const initKey = encode(initJoint);
      const finalKey = encode(finalJoint);
      const visited = new Map<string, number[]>([[initKey, initJoint]]);
      const firedJoint = new Set<string>();
      const queue: string[] = [initKey];
      let head = 0;
      let jointTruncated = false;
      const MAX_JOINT_STATES = 512;
      const MAX_JOINT_TOKENS = 3;

      while (head < queue.length) {
        const curKey = queue[head++]!;
        const curM = visited.get(curKey)!;

        for (const tr of jointEffects) {
          if (tr.pre.size === 0 && tr.post.size === 0) continue;
          let enabled = true;
          for (const [pIdx, need] of tr.pre.entries()) {
            if (curM[pIdx]! < need) {
              enabled = false;
              break;
            }
          }
          if (!enabled) continue;
          firedJoint.add(tr.id);

          const nextM = curM.slice();
          for (const [pIdx, need] of tr.pre.entries()) nextM[pIdx]! -= need;
          for (const [pIdx, add] of tr.post.entries()) nextM[pIdx]! += add;
          if (nextM.some((v) => v > MAX_JOINT_TOKENS)) {
            jointTruncated = true;
            continue;
          }
          const nextKey = encode(nextM);
          if (!visited.has(nextKey)) {
            if (visited.size >= MAX_JOINT_STATES) {
              jointTruncated = true;
            } else {
              visited.set(nextKey, nextM);
              queue.push(nextKey);
            }
          }
        }
      }

      if (!jointTruncated && !visited.has(finalKey)) {
        const msg = `Cross-object-type synchronization deadlock across [${syncOts.join(", ")}]`;
        synchronizationDeadlocks.push(msg);
        globalIssues.push(msg);
      }

      if (!jointTruncated) {
        const deadShared = jointEffects
          .filter((tr) => tr.shared && !firedJoint.has(tr.id))
          .map((tr) => tr.id);
        if (deadShared.length > 0) {
          const msg = `Shared transitions dead under cross-object-type synchronization: ${deadShared.join(", ")}`;
          synchronizationDeadlocks.push(msg);
          globalIssues.push(msg);
        }
      }
    }
  }

  return {
    sound: globalIssues.length === 0,
    perObjectType,
    synchronizationDeadlocks,
    issues: globalIssues
  };
}

export function replayOcpn(ocpn: OcpnModel, doc: DiscoverDocLike): OcpnReplayResult {
  const objTypeById = new Map<string, string>();
  for (const obj of doc.objects ?? []) {
    objTypeById.set(obj.id, obj.type);
  }

  const sortedEvents = [...(doc.events ?? [])]
    .map((ev, idx) => ({ ev, idx, ms: Date.parse(ev.time) }))
    .sort((a, b) => {
      const am = Number.isFinite(a.ms) ? a.ms : 0;
      const bm = Number.isFinite(b.ms) ? b.ms : 0;
      return am !== bm ? am - bm : a.idx - b.idx;
    })
    .map((x) => x.ev);

  // Per-object marking: placeId -> Map<objectId, count>
  const markings = new Map<string, Map<string, number>>();
  for (const p of ocpn.places) {
    markings.set(p.id, new Map());
  }

  const perTypeCounters = new Map<
    string,
    { produced: number; consumed: number; missing: number; remaining: number; objectIds: Set<string> }
  >();
  for (const ot of Object.keys(ocpn.sourcePlaces)) {
    perTypeCounters.set(ot, { produced: 0, consumed: 0, missing: 0, remaining: 0, objectIds: new Set() });
  }

  // Seed initial tokens at sourcePlaces for every object
  for (const obj of doc.objects ?? []) {
    const src = ocpn.sourcePlaces[obj.type];
    const ctr = perTypeCounters.get(obj.type);
    if (src && ctr) {
      const pMap = markings.get(src)!;
      pMap.set(obj.id, (pMap.get(obj.id) ?? 0) + 1);
      ctr.produced += 1;
      ctr.objectIds.add(obj.id);
    }
  }

  // Index pre/post places per transition & objectType
  const transByActivity = new Map<string, OcpnTransition>();
  for (const t of ocpn.transitions) {
    if (!t.silent) transByActivity.set(t.activity, t);
  }
  const prePlaces = new Map<string, Map<string, string[]>>();
  const postPlaces = new Map<string, Map<string, string[]>>();
  const preArcs = new Map<string, Map<string, OcpnArc[]>>();
  const postArcs = new Map<string, Map<string, OcpnArc[]>>();
  for (const a of ocpn.arcs) {
    if (a.direction === "place_to_transition") {
      if (!prePlaces.has(a.target)) prePlaces.set(a.target, new Map());
      const m = prePlaces.get(a.target)!;
      if (!m.has(a.objectType)) m.set(a.objectType, []);
      m.get(a.objectType)!.push(a.source);

      if (!preArcs.has(a.target)) preArcs.set(a.target, new Map());
      const am = preArcs.get(a.target)!;
      if (!am.has(a.objectType)) am.set(a.objectType, []);
      am.get(a.objectType)!.push(a);
    } else {
      if (!postPlaces.has(a.source)) postPlaces.set(a.source, new Map());
      const m = postPlaces.get(a.source)!;
      if (!m.has(a.objectType)) m.set(a.objectType, []);
      m.get(a.objectType)!.push(a.target);

      if (!postArcs.has(a.source)) postArcs.set(a.source, new Map());
      const am = postArcs.get(a.source)!;
      if (!am.has(a.objectType)) am.set(a.objectType, []);
      am.get(a.objectType)!.push(a);
    }
  }

  const silentTransitions = ocpn.transitions.filter((t) => t.silent);

  // Build per-objectType place -> outgoing places adjacency (via all transitions of that objectType)
  const placeNextByOt = new Map<string, Map<string, string[]>>();
  for (const t of ocpn.transitions) {
    for (const ot of t.objectTypes) {
      const pres = prePlaces.get(t.id)?.get(ot) ?? [];
      const posts = postPlaces.get(t.id)?.get(ot) ?? [];
      if (pres.length === 0 || posts.length === 0) continue;
      let adj = placeNextByOt.get(ot);
      if (!adj) {
        adj = new Map();
        placeNextByOt.set(ot, adj);
      }
      for (const p of pres) {
        let list = adj.get(p);
        if (!list) {
          list = [];
          adj.set(p, list);
        }
        for (const q of posts) list.push(q);
      }
    }
  }

  // Precompute per-objectType place-to-place reachability sets (standard & sink-blocked)
  // so canReachPlace is an O(1) lookup inside drainSilentForObject.
  const reachAllByOt = new Map<string, Map<string, Set<string>>>();
  const reachNoSinkByOt = new Map<string, Map<string, Set<string>>>();

  const computeReachSets = (
    adj: Map<string, string[]>,
    placesForOt: string[],
    blockedPlace?: string
  ): Map<string, Set<string>> => {
    const out = new Map<string, Set<string>>();
    for (const start of placesForOt) {
      const visited = new Set<string>([start]);
      const queue: string[] = [start];
      let head = 0;
      while (head < queue.length) {
        const cur = queue[head++]!;
        if (blockedPlace && cur === blockedPlace) continue;
        for (const nxt of adj.get(cur) ?? []) {
          if (blockedPlace && nxt === blockedPlace) continue;
          if (!visited.has(nxt)) {
            visited.add(nxt);
            queue.push(nxt);
          }
        }
      }
      out.set(start, visited);
    }
    return out;
  };

  for (const ot of Object.keys(ocpn.sourcePlaces)) {
    const adj = placeNextByOt.get(ot) ?? new Map<string, string[]>();
    const otPlaceIds = ocpn.places.filter((p) => p.objectType === ot).map((p) => p.id);
    const snk = ocpn.sinkPlaces[ot];
    reachAllByOt.set(ot, computeReachSets(adj, otPlaceIds));
    reachNoSinkByOt.set(ot, computeReachSets(adj, otPlaceIds, snk));
  }

  const canReachPlace = (
    ot: string,
    startPlaces: readonly string[],
    targetPlace: string,
    blockSink = false
  ): boolean => {
    const reachMap = blockSink ? reachNoSinkByOt.get(ot) : reachAllByOt.get(ot);
    for (const sp of startPlaces) {
      if (sp === targetPlace || reachMap?.get(sp)?.has(targetPlace)) return true;
    }
    return false;
  };

  const drainSilentForObject = (objectId: string, ot: string, neededPlaceId?: string) => {
    const snk = ocpn.sinkPlaces[ot]!;
    if (neededPlaceId && neededPlaceId !== snk && (markings.get(neededPlaceId)?.get(objectId) ?? 0) >= 1) {
      return;
    }
    const maxSteps = Math.max(16, ocpn.transitions.length * 4);
    for (let step = 0; step < maxSteps; step++) {
      if (neededPlaceId && neededPlaceId !== snk && (markings.get(neededPlaceId)?.get(objectId) ?? 0) >= 1) {
        break;
      }

      let directCandidate: { st: OcpnTransition; pres: string[]; posts: string[] } | null = null;
      let reachableCandidate: { st: OcpnTransition; pres: string[]; posts: string[] } | null = null;

      for (const st of silentTransitions) {
        if (!st.objectTypes.includes(ot)) continue;
        const pres = prePlaces.get(st.id)?.get(ot) ?? [];
        const posts = postPlaces.get(st.id)?.get(ot) ?? [];
        if (pres.length === 0 || posts.length === 0) continue;
        const canFire = pres.every((p) => (markings.get(p)!.get(objectId) ?? 0) >= 1);
        if (!canFire) continue;
        if (neededPlaceId && pres.includes(neededPlaceId)) continue;

        const isExit = posts.includes(snk);
        if (neededPlaceId && neededPlaceId !== snk) {
          if (isExit) continue;
          if (posts.includes(neededPlaceId)) {
            directCandidate = { st, pres, posts };
            break;
          }
          if (!reachableCandidate && canReachPlace(ot, posts, neededPlaceId, true)) {
            reachableCandidate = { st, pres, posts };
          }
        } else if (neededPlaceId === snk) {
          if (isExit) {
            directCandidate = { st, pres, posts };
            break;
          }
          if (!reachableCandidate && canReachPlace(ot, posts, snk)) {
            reachableCandidate = { st, pres, posts };
          }
        } else if (!reachableCandidate) {
          reachableCandidate = { st, pres, posts };
        }
      }

      const chosen = directCandidate ?? reachableCandidate;
      if (!chosen) break;

      const ctr = perTypeCounters.get(ot)!;
      for (const p of chosen.pres) {
        const m = markings.get(p)!;
        m.set(objectId, m.get(objectId)! - 1);
        ctr.consumed += 1;
      }
      for (const p of chosen.posts) {
        const m = markings.get(p)!;
        m.set(objectId, (m.get(objectId) ?? 0) + 1);
        ctr.produced += 1;
      }
    }
  };

  const unobservedEvents: string[] = [];

  for (const ev of sortedEvents) {
    const tr = transByActivity.get(ev.type);
    if (!tr) {
      unobservedEvents.push(ev.id);
      continue;
    }

    const linkedByOt = new Map<string, Set<string>>();
    for (const rel of ev.relationships ?? []) {
      const ot = objTypeById.get(rel.objectId);
      if (!ot) continue;
      if (!linkedByOt.has(ot)) linkedByOt.set(ot, new Set());
      linkedByOt.get(ot)!.add(rel.objectId);
    }

    const requiredOts = new Set<string>(tr.objectTypes);
    for (const ot of prePlaces.get(tr.id)?.keys() ?? []) requiredOts.add(ot);
    for (const ot of postPlaces.get(tr.id)?.keys() ?? []) requiredOts.add(ot);

    const allOts = new Set<string>(requiredOts);
    for (const ot of linkedByOt.keys()) allOts.add(ot);

    for (const ot of allOts) {
      const ctr = perTypeCounters.get(ot);
      if (!ctr) continue;
      const pres = prePlaces.get(tr.id)?.get(ot) ?? [];
      const posts = postPlaces.get(tr.id)?.get(ot) ?? [];
      const objIds = linkedByOt.get(ot);

      // Missing synchronized object-type binding: transition requires ot, event omitted it
      if (!objIds || objIds.size === 0) {
        if (requiredOts.has(ot)) {
          const penalty = Math.max(1, pres.length);
          ctr.missing += penalty;
          ctr.consumed += penalty;
        }
        continue;
      }

      // Non-variable arc multiplicity violation: |b(ot)| > 1 on a variable=false arc
      const pArcs = preArcs.get(tr.id)?.get(ot) ?? [];
      const qArcs = postArcs.get(tr.id)?.get(ot) ?? [];
      const nonVarCount =
        pArcs.filter((a) => !a.variable).length + qArcs.filter((a) => !a.variable).length;
      if (objIds.size > 1 && nonVarCount > 0) {
        const excess = (objIds.size - 1) * nonVarCount;
        ctr.missing += excess;
        ctr.consumed += excess;
      }

      for (const oid of objIds) {
        for (const p of pres) {
          drainSilentForObject(oid, ot, p);
        }
        for (const p of pres) {
          const m = markings.get(p)!;
          const cur = m.get(oid) ?? 0;
          if (cur >= 1) {
            m.set(oid, cur - 1);
          } else {
            ctr.missing += 1;
          }
          ctr.consumed += 1;
        }
        for (const p of posts) {
          const m = markings.get(p)!;
          m.set(oid, (m.get(oid) ?? 0) + 1);
          ctr.produced += 1;
        }
      }
    }
  }

  // Drain silent exits to sink places & consume sink tokens
  let totalProduced = 0;
  let totalConsumed = 0;
  let totalMissing = 0;
  let totalRemaining = 0;
  const perObjectType: Record<string, OcpnReplayPerTypeMetrics> = {};

  for (const [ot, ctr] of perTypeCounters.entries()) {
    const snk = ocpn.sinkPlaces[ot]!;
    for (const oid of ctr.objectIds) {
      drainSilentForObject(oid, ot, snk);
      const snkMap = markings.get(snk)!;
      const cur = snkMap.get(oid) ?? 0;
      if (cur >= 1) {
        snkMap.set(oid, cur - 1);
      } else {
        ctr.missing += 1;
      }
      ctr.consumed += 1;
    }

    let rem = 0;
    for (const p of ocpn.places) {
      if (p.objectType !== ot) continue;
      for (const c of markings.get(p.id)!.values()) {
        if (c > 0) rem += c;
      }
    }
    ctr.remaining = rem;

    const rawFitness =
      0.5 * (1 - (ctr.consumed > 0 ? ctr.missing / ctr.consumed : 0)) +
      0.5 * (1 - (ctr.produced > 0 ? ctr.remaining / ctr.produced : 0));
    const fitness = Math.max(0, Math.min(1, rawFitness));

    perObjectType[ot] = {
      objectType: ot,
      objectCount: ctr.objectIds.size,
      produced: ctr.produced,
      consumed: ctr.consumed,
      missing: ctr.missing,
      remaining: ctr.remaining,
      fitness,
      soundTermination: ctr.missing === 0 && ctr.remaining === 0
    };

    totalProduced += ctr.produced;
    totalConsumed += ctr.consumed;
    totalMissing += ctr.missing;
    totalRemaining += ctr.remaining;
  }

  const effectiveMissing = totalMissing + unobservedEvents.length;
  const effectiveConsumed = totalConsumed + unobservedEvents.length;
  const overallFitness =
    0.5 * (1 - (effectiveConsumed > 0 ? effectiveMissing / effectiveConsumed : 0)) +
    0.5 * (1 - (totalProduced > 0 ? totalRemaining / totalProduced : 0));

  return {
    produced: totalProduced,
    consumed: totalConsumed,
    missing: totalMissing,
    remaining: totalRemaining,
    fitness: Math.max(0, Math.min(1, overallFitness)),
    soundTermination: totalMissing === 0 && totalRemaining === 0 && unobservedEvents.length === 0,
    unobservedEvents,
    perObjectType
  };
}

export function formatOcpnDot(ocpn: OcpnModel): string {
  const lines: string[] = [
    "digraph OCPN {",
    '  rankdir=LR;',
    '  fontname="Helvetica";'
  ];

  for (const p of ocpn.places) {
    const shape = p.role === "source" || p.role === "sink" ? "doublecircle" : "circle";
    lines.push(`  ${sanitizeId(p.id)} [shape=${shape}, label=${JSON.stringify(`${p.id}\\n[${p.objectType}]`)}];`);
  }
  for (const t of ocpn.transitions) {
    const fill = t.silent ? "black" : "lightgray";
    const style = t.silent ? "filled" : "filled";
    const label = t.silent ? "τ" : t.activity;
    lines.push(`  ${sanitizeId(t.id)} [shape=box, style=${style}, fillcolor=${fill}, label=${JSON.stringify(label)}];`);
  }
  for (const a of ocpn.arcs) {
    const style = a.variable ? "bold,dashed" : "solid";
    const label = a.variable ? `${a.objectType} (var)` : a.objectType;
    lines.push(`  ${sanitizeId(a.source)} -> ${sanitizeId(a.target)} [style="${style}", label=${JSON.stringify(label)}];`);
  }

  lines.push("}");
  return lines.join("\n");
}

export function formatOcpnMermaid(ocpn: OcpnModel): string {
  const lines: string[] = ["flowchart LR"];
  for (const p of ocpn.places) {
    lines.push(`  ${sanitizeId(p.id)}(("${escapeMermaidLabel(`${p.id} [${p.objectType}]`)}"))`);
  }
  for (const t of ocpn.transitions) {
    const lbl = t.silent ? "tau" : t.activity;
    lines.push(`  ${sanitizeId(t.id)}["${escapeMermaidLabel(lbl)}"]`);
  }
  for (const a of ocpn.arcs) {
    const arrow = a.variable ? "==>" : "-->";
    const lbl = a.variable ? `${a.objectType} (var)` : a.objectType;
    lines.push(`  ${sanitizeId(a.source)} ${arrow}|"${escapeMermaidLabel(lbl)}"| ${sanitizeId(a.target)}`);
  }
  return lines.join("\n");
}
