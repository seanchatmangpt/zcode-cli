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
      issues: string[];
    }
  >;
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

class UnionFind {
  private parent = new Map<string, string>();

  makeSet(x: string): void {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }

  find(x: string): string {
    this.makeSet(x);
    let root = x;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    let cur = x;
    while (cur !== root) {
      const nxt = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = nxt;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
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

    const uf = new UnionFind();
    const activities = graph.nodes.map((n) => n.activity);
    for (const act of activities) {
      uf.makeSet(`pre:${act}`);
      uf.makeSet(`post:${act}`);
    }
    for (const edge of graph.edges) {
      uf.union(`post:${edge.source}`, `pre:${edge.target}`);
    }

    const startActs = Object.keys(graph.startActivities);
    const endActs = Object.keys(graph.endActivities);
    const effectiveStarts = startActs.length > 0 ? startActs : activities.slice(0, 1);
    const effectiveEnds = endActs.length > 0 ? endActs : activities.slice(-1);

    // Check which union-find classes serve as pre of starts or post of ends
    const classesWithIncomingVisible = new Set<string>();
    const classesWithOutgoingVisible = new Set<string>();
    for (const act of activities) {
      classesWithIncomingVisible.add(uf.find(`post:${act}`));
      classesWithOutgoingVisible.add(uf.find(`pre:${act}`));
    }

    // Group start classes & end classes
    const startClasses = new Set(effectiveStarts.map((a) => uf.find(`pre:${a}`)));
    const endClasses = new Set(effectiveEnds.map((a) => uf.find(`post:${a}`)));

    // Map union-find root -> concrete place id
    const classToPlaceId = new Map<string, string>();
    let internalSeq = 0;

    // If exactly 1 start class and it has no incoming visible edges, map it directly to srcId
    if (startClasses.size === 1) {
      const onlyStart = [...startClasses][0]!;
      if (!classesWithIncomingVisible.has(onlyStart)) {
        classToPlaceId.set(onlyStart, srcId);
      }
    }
    // If exactly 1 end class and it has no outgoing visible edges and wasn't mapped to srcId, map to snkId
    if (endClasses.size === 1) {
      const onlyEnd = [...endClasses][0]!;
      if (!classesWithOutgoingVisible.has(onlyEnd) && !classToPlaceId.has(onlyEnd)) {
        classToPlaceId.set(onlyEnd, snkId);
      }
    }

    const getPlaceForClass = (cls: string): string => {
      const existing = classToPlaceId.get(cls);
      if (existing) return existing;
      internalSeq += 1;
      const pid = `p_${sanitizeId(ot)}_${internalSeq}`;
      classToPlaceId.set(cls, pid);
      places.push({ id: pid, objectType: ot, role: "internal" });
      return pid;
    };

    // Connect visible transitions
    for (const act of activities) {
      const tid = `t_${sanitizeId(act)}`;
      ensureTransition(tid, act, false, ot);
      const isVar = variableKeySet.has(`${act}::${ot}`);
      const preP = getPlaceForClass(uf.find(`pre:${act}`));
      const postP = getPlaceForClass(uf.find(`post:${act}`));
      addArc(preP, tid, ot, "place_to_transition", isVar);
      addArc(tid, postP, ot, "transition_to_place", isVar);
    }

    // Add silent tau_enter transitions from srcId to any start class not mapped directly to srcId
    let enterIdx = 0;
    for (const sc of startClasses) {
      const pId = getPlaceForClass(sc);
      if (pId !== srcId) {
        enterIdx += 1;
        const tid = `tau_enter_${sanitizeId(ot)}_${enterIdx}`;
        ensureTransition(tid, `tau_enter_${ot}`, true, ot);
        addArc(srcId, tid, ot, "place_to_transition", false);
        addArc(tid, pId, ot, "transition_to_place", false);
      }
    }

    // Add silent tau_exit transitions from any end class not mapped directly to snkId
    let exitIdx = 0;
    for (const ec of endClasses) {
      const pId = getPlaceForClass(ec);
      if (pId !== snkId) {
        exitIdx += 1;
        const tid = `tau_exit_${sanitizeId(ot)}_${exitIdx}`;
        ensureTransition(tid, `tau_exit_${ot}`, true, ot);
        addArc(pId, tid, ot, "place_to_transition", false);
        addArc(tid, snkId, ot, "transition_to_place", false);
      }
    }
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

    const otSound = otIssues.length === 0;
    perObjectType[ot] = {
      sound: otSound,
      sourcePlace: src,
      sinkPlace: snk,
      unreachableFromSource,
      deadEndsToSink,
      issues: otIssues
    };
    globalIssues.push(...otIssues);
  }

  return {
    sound: globalIssues.length === 0,
    perObjectType,
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

  const canReachPlace = (
    ot: string,
    startPlaces: readonly string[],
    targetPlace: string,
    blockPlace?: string
  ): boolean => {
    if (startPlaces.includes(targetPlace)) return true;
    const adj = placeNextByOt.get(ot);
    if (!adj) return false;
    const visited = new Set<string>(startPlaces);
    const queue = [...startPlaces];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (blockPlace && cur === blockPlace && cur !== targetPlace) continue;
      for (const nxt of adj.get(cur) ?? []) {
        if (nxt === targetPlace) return true;
        if (blockPlace && nxt === blockPlace) continue;
        if (!visited.has(nxt)) {
          visited.add(nxt);
          queue.push(nxt);
        }
      }
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
          if (!reachableCandidate && canReachPlace(ot, posts, neededPlaceId, snk)) {
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
        ctr.consumed += 1;
      } else {
        ctr.missing += 1;
      }
    }

    let rem = 0;
    for (const p of ocpn.places) {
      if (p.objectType !== ot) continue;
      for (const c of markings.get(p.id)!.values()) {
        if (c > 0) rem += c;
      }
    }
    ctr.remaining = rem;

    const fitness =
      0.5 * (1 - (ctr.consumed > 0 ? ctr.missing / ctr.consumed : 0)) +
      0.5 * (1 - (ctr.produced > 0 ? ctr.remaining / ctr.produced : 0));

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

  const overallFitness =
    0.5 * (1 - (totalConsumed > 0 ? totalMissing / totalConsumed : 0)) +
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
