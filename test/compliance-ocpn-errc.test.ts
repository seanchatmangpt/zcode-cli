import { describe, expect, test } from "bun:test";
import {
  discoverOcpn,
  replayOcpn,
  validateOcpnSoundness,
  type OcpnModel
} from "../src/compliance/ocpn.ts";
import { discoverOcDfg, type DiscoverDocLike, type OcDfgModel } from "../src/compliance/ocel-discover.ts";

function makeMinimalOcDfg(
  byObjectType: OcDfgModel["byObjectType"],
  convergence: OcDfgModel["convergence"] = [],
  divergence: OcDfgModel["divergence"] = []
): OcDfgModel {
  const objectTypes = Object.keys(byObjectType);
  const eventTypes = [
    ...new Set(Object.values(byObjectType).flatMap((g) => g.nodes.map((n) => n.activity)))
  ];
  return {
    schema: "zcode.oc-dfg/1",
    objectTypes,
    eventTypes,
    totalEvents: 0,
    totalObjects: 0,
    byObjectType,
    convergence,
    divergence,
    synchronization: [],
    reworkCycles: [],
    fileCollisions: [],
    oversightBottlenecks: [],
    sojournByObjectType: {}
  };
}

function makeNode(activity: string, frequency = 1) {
  return {
    activity,
    frequency,
    objectCount: frequency,
    medianSojournMs: 0,
    p95SojournMs: 0,
    meanSojournMs: 0,
    cs2: 0
  };
}

function makeEdge(source: string, target: string, objectType: string, frequency = 1) {
  return {
    source,
    target,
    objectType,
    frequency,
    objectCount: frequency,
    meanMs: 0,
    medianMs: 0,
    p95Ms: 0,
    cs2: 0
  };
}

describe("03-OCPN-Semantics ERRC improvements", () => {
  describe("RAISE: Behavioral OCPN soundness (validateOcpnSoundness)", () => {
    test("detects deadlock & dead transition in statically reachable XOR-split -> AND-join subnet", () => {
      // Statically every node is reachable from p_src and can reach p_snk,
      // but behaviorally p_src -> t_a -> p1 OR p_src -> t_b -> p2 deadlocks before AND-join t_join.
      const net: OcpnModel = {
        schema: "zcode.ocpn/1",
        objectTypes: ["order"],
        places: [
          { id: "p_src", objectType: "order", role: "source" },
          { id: "p1", objectType: "order", role: "internal" },
          { id: "p2", objectType: "order", role: "internal" },
          { id: "p_snk", objectType: "order", role: "sink" }
        ],
        transitions: [
          { id: "t_a", activity: "A", silent: false, objectTypes: ["order"] },
          { id: "t_b", activity: "B", silent: false, objectTypes: ["order"] },
          { id: "t_join", activity: "JOIN", silent: false, objectTypes: ["order"] }
        ],
        arcs: [
          { id: "a1", source: "p_src", target: "t_a", objectType: "order", direction: "place_to_transition", variable: false },
          { id: "a2", source: "t_a", target: "p1", objectType: "order", direction: "transition_to_place", variable: false },
          { id: "a3", source: "p_src", target: "t_b", objectType: "order", direction: "place_to_transition", variable: false },
          { id: "a4", source: "t_b", target: "p2", objectType: "order", direction: "transition_to_place", variable: false },
          { id: "a5", source: "p1", target: "t_join", objectType: "order", direction: "place_to_transition", variable: false },
          { id: "a6", source: "p2", target: "t_join", objectType: "order", direction: "place_to_transition", variable: false },
          { id: "a7", source: "t_join", target: "p_snk", objectType: "order", direction: "transition_to_place", variable: false }
        ],
        sourcePlaces: { order: "p_src" },
        sinkPlaces: { order: "p_snk" },
        soundness: { sound: true, perObjectType: {}, issues: [] },
        diagnostics: [],
        warnings: [],
        reworkCycles: [],
        fileCollisions: [],
        sojournByObjectType: {}
      };

      const res = validateOcpnSoundness(net);
      expect(res.sound).toBe(false);
      expect(res.perObjectType.order?.unreachableFromSource).toEqual([]);
      expect(res.perObjectType.order?.deadEndsToSink).toEqual([]);
      expect(res.perObjectType.order?.optionToComplete).toBe(false);
      expect(res.perObjectType.order?.deadTransitions).toContain("t_join");
    });

    test("detects improper completion when AND-split feeds XOR-join into sink", () => {
      // t_split puts tokens in p1 and p2; t_a consumes p1 -> p_snk leaving a token in p2 (improper completion).
      const net: OcpnModel = {
        schema: "zcode.ocpn/1",
        objectTypes: ["order"],
        places: [
          { id: "p_src", objectType: "order", role: "source" },
          { id: "p1", objectType: "order", role: "internal" },
          { id: "p2", objectType: "order", role: "internal" },
          { id: "p_snk", objectType: "order", role: "sink" }
        ],
        transitions: [
          { id: "t_split", activity: "SPLIT", silent: false, objectTypes: ["order"] },
          { id: "t_a", activity: "A", silent: false, objectTypes: ["order"] },
          { id: "t_b", activity: "B", silent: false, objectTypes: ["order"] }
        ],
        arcs: [
          { id: "a1", source: "p_src", target: "t_split", objectType: "order", direction: "place_to_transition", variable: false },
          { id: "a2", source: "t_split", target: "p1", objectType: "order", direction: "transition_to_place", variable: false },
          { id: "a3", source: "t_split", target: "p2", objectType: "order", direction: "transition_to_place", variable: false },
          { id: "a4", source: "p1", target: "t_a", objectType: "order", direction: "place_to_transition", variable: false },
          { id: "a5", source: "t_a", target: "p_snk", objectType: "order", direction: "transition_to_place", variable: false },
          { id: "a6", source: "p2", target: "t_b", objectType: "order", direction: "place_to_transition", variable: false },
          { id: "a7", source: "t_b", target: "p_snk", objectType: "order", direction: "transition_to_place", variable: false }
        ],
        sourcePlaces: { order: "p_src" },
        sinkPlaces: { order: "p_snk" },
        soundness: { sound: true, perObjectType: {}, issues: [] },
        diagnostics: [],
        warnings: [],
        reworkCycles: [],
        fileCollisions: [],
        sojournByObjectType: {}
      };

      const res = validateOcpnSoundness(net);
      expect(res.sound).toBe(false);
      expect(res.perObjectType.order?.properCompletion).toBe(false);
    });

    test("detects cross-object-type synchronization deadlock over shared transitions", () => {
      // Type A requires t1 -> t2; Type B requires t2 -> t1.
      // Individually both subnets are sound, but jointly they deadlock immediately at the initial marking.
      const net: OcpnModel = {
        schema: "zcode.ocpn/1",
        objectTypes: ["otA", "otB"],
        places: [
          { id: "pA_src", objectType: "otA", role: "source" },
          { id: "pA_mid", objectType: "otA", role: "internal" },
          { id: "pA_snk", objectType: "otA", role: "sink" },
          { id: "pB_src", objectType: "otB", role: "source" },
          { id: "pB_mid", objectType: "otB", role: "internal" },
          { id: "pB_snk", objectType: "otB", role: "sink" }
        ],
        transitions: [
          { id: "t1", activity: "T1", silent: false, objectTypes: ["otA", "otB"] },
          { id: "t2", activity: "T2", silent: false, objectTypes: ["otA", "otB"] }
        ],
        arcs: [
          { id: "a1", source: "pA_src", target: "t1", objectType: "otA", direction: "place_to_transition", variable: false },
          { id: "a2", source: "t1", target: "pA_mid", objectType: "otA", direction: "transition_to_place", variable: false },
          { id: "a3", source: "pA_mid", target: "t2", objectType: "otA", direction: "place_to_transition", variable: false },
          { id: "a4", source: "t2", target: "pA_snk", objectType: "otA", direction: "transition_to_place", variable: false },
          { id: "b1", source: "pB_src", target: "t2", objectType: "otB", direction: "place_to_transition", variable: false },
          { id: "b2", source: "t2", target: "pB_mid", objectType: "otB", direction: "transition_to_place", variable: false },
          { id: "b3", source: "pB_mid", target: "t1", objectType: "otB", direction: "place_to_transition", variable: false },
          { id: "b4", source: "t1", target: "pB_snk", objectType: "otB", direction: "transition_to_place", variable: false }
        ],
        sourcePlaces: { otA: "pA_src", otB: "pB_src" },
        sinkPlaces: { otA: "pA_snk", otB: "pB_snk" },
        soundness: { sound: true, perObjectType: {}, issues: [] },
        diagnostics: [],
        warnings: [],
        reworkCycles: [],
        fileCollisions: [],
        sojournByObjectType: {}
      };

      const res = validateOcpnSoundness(net);
      expect(res.perObjectType.otA?.sound).toBe(true);
      expect(res.perObjectType.otB?.sound).toBe(true);
      expect(res.sound).toBe(false);
      expect((res.synchronizationDeadlocks ?? []).length).toBeGreaterThan(0);
    });
  });

  describe("CREATE: Inductive Miner per-type WF-net discovery (discoverOcpn)", () => {
    test("discovers AND-split and AND-join for concurrent activities A -> (B || C) -> D", () => {
      const ocdfg = makeMinimalOcDfg({
        turn: {
          objectType: "turn",
          traceCount: 2,
          nodes: [makeNode("A", 2), makeNode("B", 2), makeNode("C", 2), makeNode("D", 2)],
          edges: [
            makeEdge("A", "B", "turn", 1),
            makeEdge("A", "C", "turn", 1),
            makeEdge("B", "C", "turn", 1),
            makeEdge("C", "B", "turn", 1),
            makeEdge("B", "D", "turn", 1),
            makeEdge("C", "D", "turn", 1)
          ],
          startActivities: { A: 2 },
          endActivities: { D: 2 }
        }
      });

      const ocpn = discoverOcpn(ocdfg, { requiredObjectTypes: ["turn"] });
      expect(ocpn.soundness.sound).toBe(true);
      expect(ocpn.soundness.perObjectType.turn?.optionToComplete).toBe(true);
      expect(ocpn.soundness.perObjectType.turn?.properCompletion).toBe(true);
      expect(ocpn.soundness.perObjectType.turn?.deadTransitions).toEqual([]);

      // Must contain silent AND-split (>= 2 outgoing arcs) and AND-join (>= 2 incoming arcs)
      const split = ocpn.transitions.find(
        (t) => t.silent && ocpn.arcs.filter((a) => a.source === t.id).length >= 2
      );
      const join = ocpn.transitions.find(
        (t) => t.silent && ocpn.arcs.filter((a) => a.target === t.id).length >= 2
      );
      expect(split).toBeDefined();
      expect(join).toBeDefined();

      // Replay both interleavings A->B->C->D and A->C->B->D with perfect fitness
      const doc: DiscoverDocLike = {
        objects: [
          { id: "t1", type: "turn", attributes: [] },
          { id: "t2", type: "turn", attributes: [] }
        ],
        events: [
          { id: "e1", type: "A", time: "2026-01-01T00:00:01Z", relationships: [{ objectId: "t1", qualifier: "turn" }] },
          { id: "e2", type: "B", time: "2026-01-01T00:00:02Z", relationships: [{ objectId: "t1", qualifier: "turn" }] },
          { id: "e3", type: "C", time: "2026-01-01T00:00:03Z", relationships: [{ objectId: "t1", qualifier: "turn" }] },
          { id: "e4", type: "D", time: "2026-01-01T00:00:04Z", relationships: [{ objectId: "t1", qualifier: "turn" }] },
          { id: "e5", type: "A", time: "2026-01-01T00:00:05Z", relationships: [{ objectId: "t2", qualifier: "turn" }] },
          { id: "e6", type: "C", time: "2026-01-01T00:00:06Z", relationships: [{ objectId: "t2", qualifier: "turn" }] },
          { id: "e7", type: "B", time: "2026-01-01T00:00:07Z", relationships: [{ objectId: "t2", qualifier: "turn" }] },
          { id: "e8", type: "D", time: "2026-01-01T00:00:08Z", relationships: [{ objectId: "t2", qualifier: "turn" }] }
        ]
      };
      const replay = replayOcpn(ocpn, doc);
      expect(replay.fitness).toBe(1);
      expect(replay.soundTermination).toBe(true);
    });

    test("discovers XOR choice without transitive place collapse", () => {
      // Two separate paths: A -> B and C -> D (XOR cut)
      const ocdfg = makeMinimalOcDfg({
        turn: {
          objectType: "turn",
          traceCount: 2,
          nodes: [makeNode("A", 1), makeNode("B", 1), makeNode("C", 1), makeNode("D", 1)],
          edges: [makeEdge("A", "B", "turn", 1), makeEdge("C", "D", "turn", 1)],
          startActivities: { A: 1, C: 1 },
          endActivities: { B: 1, D: 1 }
        }
      });

      const ocpn = discoverOcpn(ocdfg, { requiredObjectTypes: ["turn"] });
      expect(ocpn.soundness.sound).toBe(true);

      // Post-place of A must differ from post-place of C
      const postA = ocpn.arcs.find((a) => a.source === "t_A")?.target;
      const postC = ocpn.arcs.find((a) => a.source === "t_C")?.target;
      expect(postA).toBeDefined();
      expect(postC).toBeDefined();
      expect(postA).not.toBe(postC);
    });
  });

  describe("RAISE & REDUCE: Sink-miss accounting, unobservedEvents penalty, and precomputed reachability", () => {
    test("increments consumed on sink miss, clamps per-type fitness to [0, 1], and penalizes unobservedEvents", () => {
      const ocdfg = makeMinimalOcDfg({
        turn: {
          objectType: "turn",
          traceCount: 1,
          nodes: [makeNode("A", 1), makeNode("B", 1)],
          edges: [makeEdge("A", "B", "turn", 1)],
          startActivities: { A: 1 },
          endActivities: { B: 1 }
        }
      });
      const ocpn = discoverOcpn(ocdfg, { requiredObjectTypes: ["turn"] });

      // Case 1: Object never fires any events -> misses sink place; consumed must be >= missing (1) and fitness === 0
      const emptyEventsDoc: DiscoverDocLike = {
        objects: [{ id: "t1", type: "turn", attributes: [] }],
        events: []
      };
      const emptyRes = replayOcpn(ocpn, emptyEventsDoc);
      const turnMetrics = emptyRes.perObjectType.turn!;
      expect(turnMetrics.missing).toBe(1);
      expect(turnMetrics.consumed).toBe(1);
      expect(turnMetrics.fitness).toBeGreaterThanOrEqual(0);
      expect(turnMetrics.fitness).toBeLessThanOrEqual(1);
      expect(turnMetrics.fitness).toBe(0);

      // Case 2: Valid trace + unobserved event -> overallFitness must be strictly < 1
      const unobservedDoc: DiscoverDocLike = {
        objects: [{ id: "t1", type: "turn", attributes: [] }],
        events: [
          { id: "e1", type: "A", time: "2026-01-01T00:00:01Z", relationships: [{ objectId: "t1", qualifier: "turn" }] },
          { id: "e2", type: "B", time: "2026-01-01T00:00:02Z", relationships: [{ objectId: "t1", qualifier: "turn" }] },
          { id: "e3", type: "UNKNOWN_ACTIVITY", time: "2026-01-01T00:00:03Z", relationships: [{ objectId: "t1", qualifier: "turn" }] }
        ]
      };
      const unobsRes = replayOcpn(ocpn, unobservedDoc);
      expect(unobsRes.unobservedEvents).toEqual(["e3"]);
      expect(unobsRes.soundTermination).toBe(false);
      expect(unobsRes.fitness).toBeLessThan(1);
      expect(unobsRes.fitness).toBeGreaterThanOrEqual(0);
    });
  });

  describe("G05-OCPN-Convergence: variable arcs derive from convergence, not divergence", () => {
    test("purely convergent batch event gets variable=true and replays with fitness=1; purely divergent 1-to-1 events get variable=false", () => {
      // 1. Purely convergent: 1 event linked to 2 tool_call objects (convergence=1, divergence=0)
      const convergentLog: DiscoverDocLike = {
        objects: [
          { id: "tc1", type: "tool_call", attributes: [] },
          { id: "tc2", type: "tool_call", attributes: [] }
        ],
        events: [
          {
            id: "e_batch",
            type: "batch_tool",
            time: "2026-08-03T14:00:00.000Z",
            relationships: [
              { objectId: "tc1", qualifier: "about_tool_call" },
              { objectId: "tc2", qualifier: "about_tool_call" }
            ]
          }
        ]
      };

      const convDfg = discoverOcDfg(convergentLog);
      expect(convDfg.convergence).toHaveLength(1);
      expect(convDfg.divergence).toHaveLength(0);

      const convOcpn = discoverOcpn(convDfg, { requiredObjectTypes: ["tool_call"] });
      const batchArcs = convOcpn.arcs.filter(
        (a) => a.objectType === "tool_call" && (a.source === "t_batch_tool" || a.target === "t_batch_tool")
      );
      expect(batchArcs.length).toBeGreaterThanOrEqual(2);
      expect(batchArcs.every((a) => a.variable === true)).toBe(true);

      const convReplay = replayOcpn(convOcpn, convergentLog);
      expect(convReplay.missing).toBe(0);
      expect(convReplay.fitness).toBe(1);
      expect(convReplay.soundTermination).toBe(true);

      // 2. Purely divergent: 1 session object participating in 2 separate 1-to-1 events with differing tool_calls (convergence=0, divergence=1)
      const divergentLog: DiscoverDocLike = {
        objects: [
          { id: "s1", type: "session", attributes: [] },
          { id: "tc1", type: "tool_call", attributes: [] },
          { id: "tc2", type: "tool_call", attributes: [] }
        ],
        events: [
          {
            id: "e1",
            type: "single_tool",
            time: "2026-08-03T14:01:00.000Z",
            relationships: [
              { objectId: "s1", qualifier: "in_session" },
              { objectId: "tc1", qualifier: "about_tool_call" }
            ]
          },
          {
            id: "e2",
            type: "single_tool",
            time: "2026-08-03T14:02:00.000Z",
            relationships: [
              { objectId: "s1", qualifier: "in_session" },
              { objectId: "tc2", qualifier: "about_tool_call" }
            ]
          }
        ]
      };

      const divDfg = discoverOcDfg(divergentLog);
      expect(divDfg.convergence).toHaveLength(0);
      expect(divDfg.divergence.some((d) => d.activity === "single_tool" && d.objectType === "session")).toBe(true);

      const divOcpn = discoverOcpn(divDfg, { requiredObjectTypes: ["session", "tool_call"] });
      const singleArcs = divOcpn.arcs.filter(
        (a) => a.source === "t_single_tool" || a.target === "t_single_tool"
      );
      expect(singleArcs.length).toBeGreaterThanOrEqual(4);
      expect(singleArcs.every((a) => a.variable === false)).toBe(true);
    });
  });
});
