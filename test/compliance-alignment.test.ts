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

  test("parallel WF-net accepts both valid interleavings with alignmentCost=0, fitness=1, precision=1", () => {
    const net = buildParallelWfNet();

    const interleaveA = alignTraceAStar(net, [
      "session_created",
      "art50_disclosure_emitted",
      "turn_started",
      "turn_completed"
    ]);
    expect(interleaveA.alignmentCost).toBe(0);
    expect(interleaveA.fitness).toBe(1);
    expect(interleaveA.escapingEdgesPrecision).toBe(1);

    const interleaveB = alignTraceAStar(net, [
      "session_created",
      "turn_started",
      "art50_disclosure_emitted",
      "turn_completed"
    ]);
    expect(interleaveB.alignmentCost).toBe(0);
    expect(interleaveB.fitness).toBe(1);
    expect(interleaveB.escapingEdgesPrecision).toBe(1);
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
});
