import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  alignTraceAStar,
  computeAlignmentConformance,
  normalizeWorkflowNet,
  type ConformanceOcelDocLike,
  type WorkflowNetJson
} from "../src/compliance/conformance.ts";
import { executePowlWithTokenReplay, type PowlNode } from "../src/powl-ocel-orchestrator.ts";

function buildLinearWfNet(activities: readonly string[]): WorkflowNetJson {
  const places = [{ id: "p_0", objectType: "Workflow" }];
  const transitions: WorkflowNetJson["transitions"] = [];
  const pre: Record<string, string[]> = {};
  const post: Record<string, string[]> = {};

  activities.forEach((act, i) => {
    const pIn = `p_${i}`;
    const pOut = `p_${i + 1}`;
    const tid = `t_${i}_${act}`;
    places.push({ id: pOut, objectType: "Workflow" });
    transitions.push({ id: tid, label: act, silent: false, activityId: act, objectType: "session" });
    pre[tid] = [pIn];
    post[tid] = [pOut];
  });

  return {
    places,
    transitions,
    pre,
    post,
    sourcePlace: "p_0",
    sinkPlace: `p_${activities.length}`
  };
}

function buildParallelWfNet(): WorkflowNetJson {
  return {
    places: [
      { id: "p_source", objectType: "Workflow" },
      { id: "p_b1", objectType: "Workflow" },
      { id: "p_b2", objectType: "Workflow" },
      { id: "p_j1", objectType: "Workflow" },
      { id: "p_j2", objectType: "Workflow" },
      { id: "p_sink", objectType: "Workflow" }
    ],
    transitions: [
      { id: "t_split", label: "session_created", silent: false, activityId: "session_created", objectType: "session" },
      { id: "t_disc", label: "art50_disclosure_emitted", silent: false, activityId: "art50_disclosure_emitted", objectType: "session" },
      { id: "t_turn", label: "turn_started", silent: false, activityId: "turn_started", objectType: "turn" },
      { id: "t_join", label: "turn_completed", silent: false, activityId: "turn_completed", objectType: "turn" }
    ],
    pre: {
      t_split: ["p_source"],
      t_disc: ["p_b1"],
      t_turn: ["p_b2"],
      t_join: ["p_j1", "p_j2"]
    },
    post: {
      t_split: ["p_b1", "p_b2"],
      t_disc: ["p_j1"],
      t_turn: ["p_j2"],
      t_join: ["p_sink"]
    },
    sourcePlace: "p_source",
    sinkPlace: "p_sink"
  };
}

const NINE_STEPS = [
  "session_created",
  "art50_disclosure_emitted",
  "turn_started",
  "permission_requested",
  "permission_resolved",
  "model_request_completed",
  "tool_updated",
  "turn_completed",
  "session_closed"
];

describe("F11 Optimal A* Trace Alignment & Escaping-Edges Precision (Chicago)", () => {
  test("conforming 9-step linear trace yields alignmentCost=0, fitness=1, precision=1, all sync moves", () => {
    const net = buildLinearWfNet(NINE_STEPS);
    const res = alignTraceAStar(net, NINE_STEPS);

    expect(res.method).toBe("a_star_alignment");
    expect(res.alignmentCost).toBe(0);
    expect(res.fitness).toBe(1);
    expect(res.escapingEdgesPrecision).toBe(1);
    expect(res.precision).toBe(1);
    expect(res.syncMoves).toBe(9);
    expect(res.logMoves).toBe(0);
    expect(res.modelMoves).toBe(0);
    expect(res.moves).toHaveLength(9);
    expect(res.moves.every((m) => m.kind === "sync" && m.cost === 0)).toBe(true);
    expect(res.deviations).toEqual([]);
  });

  test("parallel WF-net accepts both valid interleavings with alignmentCost=0, fitness=1, and Align-ETC precision=0.8 single / 1.0 pooled", () => {
    const net = buildParallelWfNet();

    const interleaveA = alignTraceAStar(net, [
      "session_created",
      "art50_disclosure_emitted",
      "turn_started",
      "turn_completed"
    ]);
    expect(interleaveA.alignmentCost).toBe(0);
    expect(interleaveA.fitness).toBe(1);
    // At {p_b1, p_b2} both art50_disclosure_emitted and turn_started are enabled; single trace visits 1 of 2 -> 4/5 = 0.8
    expect(interleaveA.escapingEdgesPrecision).toBeCloseTo(0.8, 10);

    const interleaveB = alignTraceAStar(net, [
      "session_created",
      "turn_started",
      "art50_disclosure_emitted",
      "turn_completed"
    ]);
    expect(interleaveB.alignmentCost).toBe(0);
    expect(interleaveB.fitness).toBe(1);
    expect(interleaveB.escapingEdgesPrecision).toBeCloseTo(0.8, 10);

    // Pooling both interleavings covers both concurrent edges at the AND-split -> precision = 1
    const pooledDoc: ConformanceOcelDocLike = {
      objects: [
        { id: "c1", type: "session", attributes: [] },
        { id: "c2", type: "session", attributes: [] }
      ],
      events: [
        { id: "e1", type: "session_created", time: "2026-08-02T10:00:00Z", relationships: [{ objectId: "c1", qualifier: "s" }] },
        { id: "e2", type: "art50_disclosure_emitted", time: "2026-08-02T10:00:01Z", relationships: [{ objectId: "c1", qualifier: "s" }] },
        { id: "e3", type: "turn_started", time: "2026-08-02T10:00:02Z", relationships: [{ objectId: "c1", qualifier: "s" }] },
        { id: "e4", type: "turn_completed", time: "2026-08-02T10:00:03Z", relationships: [{ objectId: "c1", qualifier: "s" }] },
        { id: "e5", type: "session_created", time: "2026-08-02T10:00:04Z", relationships: [{ objectId: "c2", qualifier: "s" }] },
        { id: "e6", type: "turn_started", time: "2026-08-02T10:00:05Z", relationships: [{ objectId: "c2", qualifier: "s" }] },
        { id: "e7", type: "art50_disclosure_emitted", time: "2026-08-02T10:00:06Z", relationships: [{ objectId: "c2", qualifier: "s" }] },
        { id: "e8", type: "turn_completed", time: "2026-08-02T10:00:07Z", relationships: [{ objectId: "c2", qualifier: "s" }] }
      ]
    };
    const pooled = computeAlignmentConformance(pooledDoc, net, "session");
    expect(pooled.caseCount).toBe(2);
    expect(pooled.alignmentCost).toBe(0);
    expect(pooled.fitness).toBe(1);
    expect(pooled.escapingEdgesPrecision).toBe(1);
  });

  test("anti-vacuity: missing step -> model_move, extra step -> log_move, swap -> both, empty -> fitness 0", () => {
    const net = buildLinearWfNet(NINE_STEPS);

    // 1. Missing permission_resolved
    const skipped = NINE_STEPS.filter((s) => s !== "permission_resolved");
    const skippedRes = alignTraceAStar(net, skipped);
    expect(skippedRes.alignmentCost).toBe(1);
    expect(skippedRes.modelMoves).toBe(1);
    expect(skippedRes.logMoves).toBe(0);
    expect(skippedRes.fitness).toBeLessThan(1);
    expect(skippedRes.moves.some((m) => m.kind === "model_move" && m.activity === "permission_resolved")).toBe(true);
    expect(skippedRes.deviations[0]!.category).toBe("skipped_test");

    // 2. Extra unauthorized Write tool call
    const extra = [...NINE_STEPS.slice(0, 6), "unauthorized_Write", ...NINE_STEPS.slice(6)];
    const extraRes = alignTraceAStar(net, extra);
    expect(extraRes.alignmentCost).toBe(1);
    expect(extraRes.logMoves).toBe(1);
    expect(extraRes.modelMoves).toBe(0);
    expect(extraRes.fitness).toBeLessThan(1);
    expect(extraRes.moves.some((m) => m.kind === "log_move" && m.activity === "unauthorized_Write")).toBe(true);
    expect(extraRes.deviations[0]!.category).toBe("out_of_scope_write");

    // 3. Swapped steps (permission_resolved before permission_requested)
    const swapped = [...NINE_STEPS];
    swapped[3] = "permission_resolved";
    swapped[4] = "permission_requested";
    const swappedRes = alignTraceAStar(net, swapped);
    expect(swappedRes.alignmentCost).toBe(2);
    expect(swappedRes.logMoves).toBe(1);
    expect(swappedRes.modelMoves).toBe(1);
    expect(swappedRes.fitness).toBeLessThan(1);

    // 4. Empty trace against 9-step net
    const emptyRes = alignTraceAStar(net, []);
    expect(emptyRes.alignmentCost).toBe(9);
    expect(emptyRes.fitness).toBe(0);
    expect(emptyRes.modelMoves).toBe(9);
    expect(emptyRes.moves.every((m) => m.kind === "model_move")).toBe(true);
  });

  test("escaping-edges precision penalizes unvisited XOR branches and recovers when pooled across cases", () => {
    const xorPowl: PowlNode = {
      kind: "xor",
      id: "choice",
      branches: [
        { kind: "activity", id: "branch_a", label: "branch_a", objectType: "session" },
        { kind: "activity", id: "branch_b", label: "branch_b", objectType: "session" }
      ]
    };

    const single = alignTraceAStar(xorPowl, ["branch_a"]);
    expect(single.alignmentCost).toBe(0);
    expect(single.fitness).toBe(1);
    expect(single.escapingEdgesPrecision).toBe(0.5);

    const pooledDoc: ConformanceOcelDocLike = {
      objects: [
        { id: "s1", type: "session", attributes: [] },
        { id: "s2", type: "session", attributes: [] }
      ],
      events: [
        { id: "e1", type: "branch_a", time: "2026-08-02T10:00:00Z", relationships: [{ objectId: "s1", qualifier: "in_session" }] },
        { id: "e2", type: "branch_b", time: "2026-08-02T10:00:01Z", relationships: [{ objectId: "s2", qualifier: "in_session" }] }
      ]
    };
    const pooled = computeAlignmentConformance(pooledDoc, xorPowl, "session");
    expect(pooled.caseCount).toBe(2);
    expect(pooled.alignmentCost).toBe(0);
    expect(pooled.fitness).toBe(1);
    expect(pooled.escapingEdgesPrecision).toBe(1);
  });

  test("fail-closed validation rejects malformed and unreachable WF-nets", () => {
    const missingSource: WorkflowNetJson = {
      places: [{ id: "p_1", objectType: "Workflow" }],
      transitions: [],
      pre: {},
      post: {},
      sourcePlace: "p_missing",
      sinkPlace: "p_1"
    };
    expect(() => normalizeWorkflowNet(missingSource)).toThrow(/sourcePlace/);

    const unreachableSink: WorkflowNetJson = {
      places: [
        { id: "p_0", objectType: "Workflow" },
        { id: "p_1", objectType: "Workflow" },
        { id: "p_sink", objectType: "Workflow" }
      ],
      transitions: [
        { id: "t_dead", label: "dead", silent: false, activityId: "dead", objectType: "Workflow" }
      ],
      pre: { t_dead: ["p_0"] },
      post: { t_dead: ["p_1"] },
      sourcePlace: "p_0",
      sinkPlace: "p_sink"
    };
    expect(() => normalizeWorkflowNet(unreachableSink)).toThrow(/Unsound wfnet|unreachable/);
  });

  test("wires A* alignment and completionHeuristic into executePowlWithTokenReplay & replay-conformance.json", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "zcode-align-powl-"));
    try {
      const powl: PowlNode = {
        kind: "partial_order",
        id: "align-powl",
        children: [
          { kind: "activity", id: "plan", label: "Plan", objectType: "Artifact" },
          { kind: "activity", id: "impl", label: "Impl", objectType: "Artifact" },
          { kind: "activity", id: "verify", label: "Verify", objectType: "Artifact" }
        ],
        order: [
          ["plan", "impl"],
          ["impl", "verify"]
        ]
      };

      const res = await executePowlWithTokenReplay(
        powl,
        async () => ({ ok: true, exitCode: 0 }),
        { outputDir: outDir }
      );
      expect(res.alignment.method).toBe("a_star_alignment");
      expect(res.alignment.alignmentCost).toBe(0);
      expect(res.alignment.fitness).toBe(1);
      expect(res.completionHeuristic.fitness).toBe(1);

      const diskReceipt = JSON.parse(readFileSync(join(outDir, "replay-conformance.json"), "utf8"));
      expect(diskReceipt.alignment.method).toBe("a_star_alignment");
      expect(diskReceipt.alignment.alignmentCost).toBe(0);
      expect(diskReceipt.completionHeuristic.soundTermination).toBe(true);

      // Refused run degrades A* alignment fitness < 1 with model_moves
      const refused = await executePowlWithTokenReplay(powl, async (t) =>
        t.activityId === "impl" ? { ok: false, exitCode: 1, detail: "impl failed" } : { ok: true, exitCode: 0 }
      );
      expect(refused.alignment.fitness).toBeLessThan(1);
      expect(refused.alignment.modelMoves).toBeGreaterThanOrEqual(2);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  test("regression F11: normalizeWorkflowNet rejects disconnected islands, dead-end traps, and AND-split traps while accepting sound XOR/Loop/PO nets", () => {
    const disconnectedIsland: WorkflowNetJson = {
      places: [
        { id: "p_0", objectType: "Workflow" },
        { id: "p_sink", objectType: "Workflow" },
        { id: "p_orphan", objectType: "Workflow" }
      ],
      transitions: [
        { id: "t_ok", label: "ok", silent: false, activityId: "ok", objectType: "Workflow" },
        { id: "t_orphan", label: "orphan", silent: false, activityId: "orphan", objectType: "Workflow" }
      ],
      pre: { t_ok: ["p_0"], t_orphan: ["p_orphan"] },
      post: { t_ok: ["p_sink"], t_orphan: ["p_orphan"] },
      sourcePlace: "p_0",
      sinkPlace: "p_sink"
    };
    expect(() => normalizeWorkflowNet(disconnectedIsland)).toThrow(/Unsound wfnet|unreachable/);

    const deadEndTrap: WorkflowNetJson = {
      places: [
        { id: "p_0", objectType: "Workflow" },
        { id: "p_sink", objectType: "Workflow" },
        { id: "p_dead", objectType: "Workflow" }
      ],
      transitions: [
        { id: "t_ok", label: "ok", silent: false, activityId: "ok", objectType: "Workflow" },
        { id: "t_dead", label: "dead", silent: false, activityId: "dead", objectType: "Workflow" }
      ],
      pre: { t_ok: ["p_0"], t_dead: ["p_0"] },
      post: { t_ok: ["p_sink"], t_dead: ["p_dead"] },
      sourcePlace: "p_0",
      sinkPlace: "p_sink"
    };
    expect(() => normalizeWorkflowNet(deadEndTrap)).toThrow(/Unsound wfnet|cannot reach sinkPlace/);

    const andSplitTrap: WorkflowNetJson = {
      places: [
        { id: "p_0", objectType: "Workflow" },
        { id: "p_1", objectType: "Workflow" },
        { id: "p_2", objectType: "Workflow" },
        { id: "p_dead", objectType: "Workflow" },
        { id: "p_sink", objectType: "Workflow" }
      ],
      transitions: [
        { id: "t_split", label: "split", silent: false, activityId: "split", objectType: "Workflow" },
        { id: "t_finish", label: "finish", silent: false, activityId: "finish", objectType: "Workflow" },
        { id: "t_trap", label: "trap", silent: false, activityId: "trap", objectType: "Workflow" }
      ],
      pre: { t_split: ["p_0"], t_finish: ["p_1"], t_trap: ["p_2"] },
      post: { t_split: ["p_1", "p_2"], t_finish: ["p_sink"], t_trap: ["p_dead"] },
      sourcePlace: "p_0",
      sinkPlace: "p_sink"
    };
    expect(() => normalizeWorkflowNet(andSplitTrap)).toThrow(/Unsound wfnet|cannot reach sinkPlace/);

    const complexValidPowl: PowlNode = {
      kind: "loop",
      id: "outer_loop",
      doBranch: {
        kind: "partial_order",
        id: "po",
        children: [
          {
            kind: "xor",
            id: "choice",
            branches: [
              { kind: "activity", id: "x1", label: "x1", objectType: "Workflow" },
              { kind: "activity", id: "x2", label: "x2", objectType: "Workflow" }
            ]
          },
          { kind: "activity", id: "y", label: "y", objectType: "Workflow" }
        ],
        order: []
      },
      redoBranch: { kind: "activity", id: "r", label: "r", objectType: "Workflow" }
    };
    const normalized = normalizeWorkflowNet(complexValidPowl);
    expect(normalized.places.length).toBeGreaterThan(2);
    expect(alignTraceAStar(complexValidPowl, ["x2", "y"]).alignmentCost).toBe(0);
  });

  test("ERRC CREATE: marking-equation LP heuristic handles activity multiplicity and enforces cost admissibility guards", () => {
    const net = buildLinearWfNet(["a", "b"]);
    // Acyclic net allows 'a' only once; 5 occurrences of 'a' must incur 4 log moves + 1 model move for 'b' = cost 5
    const res = alignTraceAStar(net, ["a", "a", "a", "a", "a"]);
    expect(res.alignmentCost).toBe(5);
    expect(res.syncMoves).toBe(1);
    expect(res.logMoves).toBe(4);
    expect(res.modelMoves).toBe(1);
    expect(res.optimal).toBe(true);

    // Cost-function admissibility guards
    expect(() => alignTraceAStar(net, ["a", "b"], { logMoveCost: -1 })).toThrow(/non-negative/);
    expect(() => alignTraceAStar(net, ["a", "b"], { modelMoveCost: -0.5 })).toThrow(/non-negative/);
    expect(() => alignTraceAStar(net, ["a", "b"], { syncCost: 3, logMoveCost: 1, modelMoveCost: 1 })).toThrow(
      /Inadmissible alignment cost function/
    );
  });

  test("ERRC RAISE: tau*-closure Align-ETC captures silent-gated XOR branches and keeps precision orthogonal to fitness", () => {
    // Silent-transition-gated XOR: p_src --(tau_1)--> p_a --(act_a)--> p_sink
    //                              p_src --(tau_2)--> p_b --(act_b)--> p_sink
    const silentXorNet: WorkflowNetJson = {
      places: [
        { id: "p_src", objectType: "Workflow" },
        { id: "p_a", objectType: "Workflow" },
        { id: "p_b", objectType: "Workflow" },
        { id: "p_sink", objectType: "Workflow" }
      ],
      transitions: [
        { id: "tau_1", label: "tau_1", silent: true },
        { id: "tau_2", label: "tau_2", silent: true },
        { id: "t_a", label: "act_a", silent: false, activityId: "act_a" },
        { id: "t_b", label: "act_b", silent: false, activityId: "act_b" }
      ],
      pre: { tau_1: ["p_src"], tau_2: ["p_src"], t_a: ["p_a"], t_b: ["p_b"] },
      post: { tau_1: ["p_a"], tau_2: ["p_b"], t_a: ["p_sink"], t_b: ["p_sink"] },
      sourcePlace: "p_src",
      sinkPlace: "p_sink"
    };

    const single = alignTraceAStar(silentXorNet, ["act_a"]);
    expect(single.alignmentCost).toBe(0);
    expect(single.fitness).toBe(1);
    // True tau*-closure from p_src sees both act_a and act_b -> 1/2 = 0.5
    expect(single.escapingEdgesPrecision).toBeCloseTo(0.5, 10);

    // Orthogonality to fitness: linear net with a skipped step has fitness < 1 but precision === 1
    const linearNet = buildLinearWfNet(["step_1", "step_2", "step_3"]);
    const skipped = alignTraceAStar(linearNet, ["step_1", "step_3"]);
    expect(skipped.modelMoves).toBe(1);
    expect(skipped.fitness).toBeLessThan(1);
    expect(skipped.escapingEdgesPrecision).toBe(1);
  });

  test("ERRC REDUCE: computeAlignmentConformance deduplicates trace variants while preserving per-case eventIds", () => {
    const net = buildLinearWfNet(["a", "b"]);
    const doc: ConformanceOcelDocLike = {
      objects: [
        { id: "case_1", type: "session", attributes: [] },
        { id: "case_2", type: "session", attributes: [] }
      ],
      events: [
        { id: "c1_e1", type: "a", time: "2026-08-02T10:00:00Z", relationships: [{ objectId: "case_1", qualifier: "s" }] },
        { id: "c1_e2", type: "extra_write", time: "2026-08-02T10:00:01Z", relationships: [{ objectId: "case_1", qualifier: "s" }] },
        { id: "c1_e3", type: "b", time: "2026-08-02T10:00:02Z", relationships: [{ objectId: "case_1", qualifier: "s" }] },
        { id: "c2_e1", type: "a", time: "2026-08-02T10:00:03Z", relationships: [{ objectId: "case_2", qualifier: "s" }] },
        { id: "c2_e2", type: "extra_write", time: "2026-08-02T10:00:04Z", relationships: [{ objectId: "case_2", qualifier: "s" }] },
        { id: "c2_e3", type: "b", time: "2026-08-02T10:00:05Z", relationships: [{ objectId: "case_2", qualifier: "s" }] }
      ]
    };

    const report = computeAlignmentConformance(doc, net, "session");
    expect(report.caseCount).toBe(2);
    expect(report.alignmentCost).toBe(2);
    expect(report.cases[0]!.moves.map((m) => m.eventId)).toEqual(["c1_e1", "c1_e2", "c1_e3"]);
    expect(report.cases[1]!.moves.map((m) => m.eventId)).toEqual(["c2_e1", "c2_e2", "c2_e3"]);
    expect(report.cases[0]!.deviations[0]!.eventId).toBe("c1_e2");
    expect(report.cases[1]!.deviations[0]!.eventId).toBe("c2_e2");
  });

  test("ERRC ELIMINATE: missing explicit objectType returns empty 0-case report instead of __full_log__ fallback", () => {
    const net = buildLinearWfNet(["a", "b"]);
    const doc: ConformanceOcelDocLike = {
      objects: [{ id: "s1", type: "session", attributes: [] }],
      events: [
        { id: "e1", type: "a", time: "2026-08-02T10:00:00Z", relationships: [{ objectId: "s1", qualifier: "s" }] },
        { id: "e2", type: "b", time: "2026-08-02T10:00:01Z", relationships: [{ objectId: "s1", qualifier: "s" }] }
      ]
    };

    const report = computeAlignmentConformance(doc, net, "nonexistent_object_type");
    expect(report.objectType).toBe("nonexistent_object_type");
    expect(report.caseCount).toBe(0);
    expect(report.cases).toEqual([]);
    expect(report.moves).toEqual([]);
    expect(report.deviations).toEqual([]);
    expect(report.alignmentCost).toBe(0);
  });

  test("v27.1.1 regression: multi-arc preset requires full token multiplicity and never produces negative markings", () => {
    // Falsifier 1: weight-2 preset from sourcePlace p0 (which only starts with 1 token)
    const insufficientMultiArcNet: WorkflowNetJson = {
      places: [
        { id: "p0", objectType: "Workflow" },
        { id: "p_sink", objectType: "Workflow" }
      ],
      transitions: [
        { id: "t1", label: "t1", silent: false, activityId: "t1", objectType: "Workflow" }
      ],
      pre: { t1: ["p0", "p0"] },
      post: { t1: ["p_sink"] },
      sourcePlace: "p0",
      sinkPlace: "p_sink"
    };
    expect(() => alignTraceAStar(insufficientMultiArcNet, ["t1"])).toThrow(/unable to reach sinkPlace/);

    // Positive control: producer emits 2 tokens into p_mid so weight-2 consumer is legitimately enabled
    const soundMultiArcNet: WorkflowNetJson = {
      places: [
        { id: "p0", objectType: "Workflow" },
        { id: "p_mid", objectType: "Workflow" },
        { id: "p_sink", objectType: "Workflow" }
      ],
      transitions: [
        { id: "t_gen", label: "gen", silent: false, activityId: "gen", objectType: "Workflow" },
        { id: "t_consume", label: "consume", silent: false, activityId: "consume", objectType: "Workflow" }
      ],
      pre: { t_gen: ["p0"], t_consume: ["p_mid", "p_mid"] },
      post: { t_gen: ["p_mid", "p_mid"], t_consume: ["p_sink"] },
      sourcePlace: "p0",
      sinkPlace: "p_sink"
    };
    const res = alignTraceAStar(soundMultiArcNet, ["gen", "consume"]);
    expect(res.alignmentCost).toBe(0);
    expect(res.fitness).toBe(1);
    expect(res.syncMoves).toBe(2);
  });

  test("v27.1.1 regression: A* heap tie-breaking dives toward goal on 6-way parallel AND-split plateaus", () => {
    const branches = ["A", "B", "C", "D", "E", "F"];
    const places: WorkflowNetJson["places"] = [
      { id: "p_src", objectType: "Workflow" },
      { id: "p_sink", objectType: "Workflow" }
    ];
    const transitions: WorkflowNetJson["transitions"] = [
      { id: "t_split", label: "split", silent: true },
      { id: "t_join", label: "join", silent: true }
    ];
    const pre: Record<string, string[]> = { t_split: ["p_src"], t_join: [] };
    const post: Record<string, string[]> = { t_split: [], t_join: ["p_sink"] };

    for (const b of branches) {
      const pIn = `p_in_${b}`;
      const pOut = `p_out_${b}`;
      const tid = `t_${b}`;
      places.push({ id: pIn, objectType: "Workflow" }, { id: pOut, objectType: "Workflow" });
      transitions.push({ id: tid, label: b, silent: false, activityId: b, objectType: "Workflow" });
      post.t_split!.push(pIn);
      pre[tid] = [pIn];
      post[tid] = [pOut];
      pre.t_join!.push(pOut);
    }

    const parallel6Net: WorkflowNetJson = {
      places,
      transitions,
      pre,
      post,
      sourcePlace: "p_src",
      sinkPlace: "p_sink"
    };

    // 1 extra log move (f=1) on 6-way parallel net: diving tie-breaker avoids exponential plateau expansion
    const withExtra = alignTraceAStar(parallel6Net, ["A", "B", "EXTRA", "C", "D", "E", "F"], {
      maxStates: 200
    });
    expect(withExtra.alignmentCost).toBe(1);
    expect(withExtra.logMoves).toBe(1);
    expect(withExtra.syncMoves).toBe(6);
    expect(withExtra.statesExplored).toBeLessThan(50);

    // syncCost=1: every sync move increases g by 1 while f stays constant at 6
    const withSyncCost = alignTraceAStar(parallel6Net, ["A", "B", "C", "D", "E", "F"], {
      syncCost: 1,
      logMoveCost: 2,
      modelMoveCost: 2,
      maxStates: 200
    });
    expect(withSyncCost.alignmentCost).toBe(6);
    expect(withSyncCost.syncMoves).toBe(6);
    expect(withSyncCost.statesExplored).toBeLessThan(50);
  });

  test("v27.1.1 regression: computeAlignmentConformance auto-groups by session when objectType is omitted and projects tool attributes", () => {
    const net = buildLinearWfNet(["a", "b"]);
    const interleavedDoc: ConformanceOcelDocLike = {
      objects: [
        { id: "S1", type: "session", attributes: [] },
        { id: "S2", type: "session", attributes: [] }
      ],
      events: [
        { id: "e1", type: "a", time: "2026-08-02T10:00:00Z", relationships: [{ objectId: "S1", qualifier: "s" }] },
        { id: "e2", type: "a", time: "2026-08-02T10:00:01Z", relationships: [{ objectId: "S2", qualifier: "s" }] },
        { id: "e3", type: "b", time: "2026-08-02T10:00:02Z", relationships: [{ objectId: "S1", qualifier: "s" }] },
        { id: "e4", type: "b", time: "2026-08-02T10:00:03Z", relationships: [{ objectId: "S2", qualifier: "s" }] }
      ]
    };

    const report = computeAlignmentConformance(interleavedDoc, net);
    expect(report.caseCount).toBe(2);
    expect(report.alignmentCost).toBe(0);
    expect(report.fitness).toBe(1);

    // Tool-level WF-net matching coarse wire event type "tool_updated" via tool attribute
    const toolNet = buildLinearWfNet(["Read", "Write"]);
    const toolDoc: ConformanceOcelDocLike = {
      objects: [{ id: "S1", type: "session", attributes: [] }],
      events: [
        {
          id: "t1",
          type: "tool_updated",
          time: "2026-08-02T10:00:00Z",
          attributes: [{ name: "tool", value: "Read" }],
          relationships: [{ objectId: "S1", qualifier: "s" }]
        },
        {
          id: "t2",
          type: "tool_updated",
          time: "2026-08-02T10:00:01Z",
          attributes: [{ name: "tool", value: "Bash" }],
          relationships: [{ objectId: "S1", qualifier: "s" }]
        },
        {
          id: "t3",
          type: "tool_updated",
          time: "2026-08-02T10:00:02Z",
          attributes: [{ name: "tool", value: "Write" }],
          relationships: [{ objectId: "S1", qualifier: "s" }]
        }
      ]
    };
    const toolReport = computeAlignmentConformance(toolDoc, toolNet);
    expect(toolReport.caseCount).toBe(1);
    expect(toolReport.alignmentCost).toBe(1);
    expect(toolReport.syncMoves).toBe(2);
    expect(toolReport.logMoves).toBe(1);
    expect(toolReport.deviations[0]!.activity).toBe("Bash");
    expect(toolReport.deviations[0]!.category).toBe("out_of_scope_write");
  });
});
