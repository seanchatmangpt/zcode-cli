import { describe, expect, test } from "bun:test";
import {
  AimdWipController,
  compilePowlToWorkflowNet,
  deriveFollowUpPowl,
  executePowlWithTokenReplay,
  runAutonomicLoop,
  transitiveClosure,
  validateDisjointWriteScopes,
  validatePowlTree,
  type PowlNode
} from "../src/powl-ocel-orchestrator.ts";

describe("POWL v2 -> Workflow Net -> Token-Based Replay & OCEL 2.0", () => {
  test("rejects cycles and irreflexive violations in nested PartialOrder", () => {
    const cyclic: PowlNode = {
      kind: "partial_order",
      id: "root",
      children: [
        { kind: "activity", id: "a", label: "A", objectType: "Artifact" },
        { kind: "activity", id: "b", label: "B", objectType: "Artifact" }
      ],
      order: [["a", "b"], ["b", "a"]]
    };
    expect(() => validatePowlTree(cyclic)).toThrow("cycle detected");
  });

  test("compiles POWL PartialOrder to a sound Workflow Net and achieves fitness = 1.0", async () => {
    const powl: PowlNode = {
      kind: "partial_order",
      id: "castle-sound",
      children: [
        { kind: "activity", id: "manifest", label: "Pin Manifest", objectType: "Artifact" },
        { kind: "activity", id: "scorecard", label: "Scorecard Adapter", objectType: "Artifact" },
        { kind: "activity", id: "trivy", label: "Trivy Adapter", objectType: "Artifact" },
        { kind: "activity", id: "court", label: "5-Agent Court", objectType: "Artifact" }
      ],
      order: [
        ["manifest", "scorecard"],
        ["manifest", "trivy"],
        ["scorecard", "court"],
        ["trivy", "court"]
      ]
    };

    const net = compilePowlToWorkflowNet(powl);
    expect(net.sourcePlace).toBeTruthy();
    expect(net.sinkPlace).toBeTruthy();

    const fired: string[] = [];
    const res = await executePowlWithTokenReplay(powl, async (t) => {
      fired.push(t.activityId!);
      return { ok: true, exitCode: 0 };
    }, { tomlPath: "zcode-cli.toml" });

    expect(fired[0]).toBe("manifest");
    expect(fired[fired.length - 1]).toBe("court");
    expect(res.replay.fitness).toBe(1);
    expect(res.replay.soundTermination).toBe(true);
    expect(res.replay.missing).toBe(0);
    expect(res.replay.remaining).toBe(0);
    // OCEL 2.0 O2O relationships & dynamic attributes present
    expect(res.ocel.objects.some((o) => o.relationships.some((r) => r.qualifier === "part_of"))).toBe(true);
  });

  test("degrades token-replay fitness < 1.0 and halts on refused transition", async () => {
    const powl: PowlNode = {
      kind: "partial_order",
      id: "castle-refuse",
      children: [
        { kind: "activity", id: "probe", label: "Probe", objectType: "Artifact" },
        { kind: "activity", id: "publish", label: "Publish", objectType: "Artifact" }
      ],
      order: [["probe", "publish"]]
    };

    const fired: string[] = [];
    const res = await executePowlWithTokenReplay(powl, async (t) => {
      fired.push(t.activityId!);
      return { ok: false, exitCode: 1, detail: "SHA256_MISMATCH" };
    });

    expect(fired).toEqual(["probe"]);
    expect(res.replay.soundTermination).toBe(false);
    expect(res.replay.fitness).toBeLessThan(1);
    expect(res.ocel.events.some((e) => e.type === "transition_refused")).toBe(true);
  });

  test("AIMD never MD on long serviceMs with healthy transport (no false build/test backoff)", () => {
    const aimd = new AimdWipController();
    // Fast activities establish a low median (~100ms) under healthy unsaturated arrival rate.
    for (let i = 0; i < 12; i++) {
      const adj = aimd.onSuccess(80 + (i % 5) * 10, { interArrivalMs: 60_000 });
      expect(adj.reason).toBe("clean_completion_ai");
    }
    const wipBefore = aimd.wip;
    expect(wipBefore).toBeGreaterThan(1);
    const median = aimd.medianServiceMs();
    expect(median).toBeLessThan(200);

    // Build/test class: routinely > 2× median under healthy transport.
    const buildSamples = [5_000, 12_000, 8_000, 30_000, 4_500];
    let falseMd = 0;
    for (const ms of buildSamples) {
      expect(ms).toBeGreaterThan(median * 2);
      const adj = aimd.onSuccess(ms, { interArrivalMs: 60_000 });
      if (adj.reason === "latency_spike_md" || adj.newWip < adj.oldWip) falseMd += 1;
      expect(["clean_completion_ai", "heavy_tail_protected_ai"]).toContain(adj.reason);
      expect(adj.newWip).toBe(adj.oldWip + 1);
    }
    expect(falseMd).toBe(0);
    expect(aimd.wip).toBe(wipBefore + buildSamples.length);
  });

  test("AIMD MD only on transport backpressure, then recovers with AI", () => {
    const aimd = new AimdWipController();
    for (let i = 0; i < 6; i++) aimd.onSuccess(100, { interArrivalMs: 60_000 });
    expect(aimd.wip).toBe(7);
    const md = aimd.onTransportBackpressure();
    expect(md.reason).toBe("transport_timeout_md");
    expect(md.newWip).toBe(3);
    const ai = aimd.onSuccess(50_000, { interArrivalMs: 60_000 }); // long but healthy
    expect(["clean_completion_ai", "heavy_tail_protected_ai"]).toContain(ai.reason);
    expect(ai.newWip).toBe(4);
  });

  test("autonomic AIMD returns token on transport backpressure and recovers to fitness = 1.0", async () => {
    const powl: PowlNode = {
      kind: "partial_order",
      id: "castle-aimd",
      children: [
        { kind: "activity", id: "a1", label: "A1", objectType: "Artifact" },
        { kind: "activity", id: "a2", label: "A2", objectType: "Artifact" }
      ],
      order: []
    };

    let attempts = 0;
    const res = await executePowlWithTokenReplay(
      powl,
      async () => {
        attempts += 1;
        if (attempts === 1) return { ok: false, transportBackpressure: true, exitCode: 1, detail: "UND_ERR_CONNECT_TIMEOUT" };
        return { ok: true, exitCode: 0 };
      }
    );

    expect(res.replay.fitness).toBe(1);
    expect(res.replay.soundTermination).toBe(true);
    expect(res.ocel.events.some((e) => e.type === "wip_backoff")).toBe(true);
  });

  test("falsifier: drainSilent must not kill PowlLoop.redoBranch when redo requested", async () => {
    const powl: PowlNode = {
      kind: "loop",
      id: "L",
      maxIterations: 2,
      doBranch: { kind: "activity", id: "do", label: "DO", objectType: "Artifact" },
      redoBranch: { kind: "activity", id: "redo", label: "REDO", objectType: "Artifact" }
    };
    const fired: string[] = [];
    const res = await executePowlWithTokenReplay(powl, async (t) => {
      fired.push(t.activityId!);
      // Request redo after the first do so the redoBranch is taken once.
      return { ok: true, exitCode: 0, redo: t.activityId === "do" && fired.filter((x) => x === "do").length === 1 };
    });
    expect(fired).toContain("redo");
    expect(fired.filter((x) => x === "do").length).toBe(2);
    expect(res.replay.soundTermination).toBe(true);
    expect(res.replay.fitness).toBe(1);
  });

  test("falsifier: loop(tau,tau) must terminate (no drainSilent livelock)", async () => {
    const powl: PowlNode = {
      kind: "loop",
      id: "Ltau",
      doBranch: { kind: "tau", id: "doTau" },
      redoBranch: { kind: "tau", id: "redoTau" }
    };
    const res = await Promise.race([
      executePowlWithTokenReplay(powl, async () => ({ ok: true, exitCode: 0 })),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("loop(tau,tau) hung — drainSilent livelock")), 500)
      )
    ]);
    expect(res.replay.soundTermination).toBe(true);
    expect(res.replay.fitness).toBe(1);
  });

  test("falsifier: silent XOR branch must not starve visible sibling", async () => {
    const powl: PowlNode = {
      kind: "xor",
      id: "X",
      branches: [
        { kind: "activity", id: "A", label: "A", objectType: "Artifact" },
        { kind: "tau", id: "silentB" }
      ]
    };
    const fired: string[] = [];
    const res = await executePowlWithTokenReplay(powl, async (t) => {
      fired.push(t.activityId!);
      return { ok: true, exitCode: 0 };
    });
    expect(fired).toEqual(["A"]);
    expect(res.replay.soundTermination).toBe(true);
    expect(res.replay.fitness).toBe(1);
  });

  test("falsifier: WIP>=2 must not fire all XOR branches (no negative marking)", async () => {
    const powl: PowlNode = {
      kind: "partial_order",
      id: "root",
      children: [
        { kind: "activity", id: "warm1", label: "W1", objectType: "Artifact" },
        { kind: "activity", id: "warm2", label: "W2", objectType: "Artifact" },
        {
          kind: "xor",
          id: "X",
          branches: [
            { kind: "activity", id: "xa", label: "XA", objectType: "Artifact" },
            { kind: "activity", id: "xb", label: "XB", objectType: "Artifact" }
          ]
        }
      ],
      order: [
        ["warm1", "X"],
        ["warm2", "X"]
      ]
    };
    const fired: string[] = [];
    const res = await executePowlWithTokenReplay(powl, async (t) => {
      fired.push(t.activityId!);
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true, exitCode: 0 };
    });
    const xorFired = fired.filter((x) => x === "xa" || x === "xb");
    expect(xorFired).toHaveLength(1);
    expect(res.replay.fitness).toBeLessThanOrEqual(1);
    expect(res.replay.soundTermination).toBe(true);
    expect(res.equilibriumWip).toBeGreaterThanOrEqual(2);
  });

  test("autonomic loop never empties queue: synthesizes follow-up POWL cycles from R_t", async () => {
    const initial: PowlNode = {
      kind: "activity",
      id: "seed",
      label: "Seed Work",
      objectType: "Artifact"
    };

    const cycles = await runAutonomicLoop(
      initial,
      async () => ({ ok: true, exitCode: 0 }),
      { maxCycles: 3 }
    );

    expect(cycles).toHaveLength(3);
    expect(cycles[0]!.workflowId).toBe("seed");
    expect(cycles[1]!.workflowId).toContain("verify-c2");
    expect(cycles[2]!.workflowId).toContain("verify-c3");
    expect(cycles.every((c) => c.replay.fitness === 1 && c.replay.soundTermination)).toBe(true);

    // Refused cycle derives a remediation POWL
    const refusedCycle = await executePowlWithTokenReplay(initial, async () => ({ ok: false, exitCode: 1 }));
    const followUp = deriveFollowUpPowl(refusedCycle, 2);
    expect(followUp.id).toContain("remediate-c2");
  });
});

describe("A1 POWL AST soundness (transition-id namespace + write scopes)", () => {
  test("falsifier: tau id enter_L inside loop L no longer collides; fitness = 1", async () => {
    // Evidence: a1-transition-id-collision-repro.json — previously duplicate tau_enter_L → fitness 0.5
    const powl: PowlNode = {
      kind: "loop",
      id: "L",
      doBranch: { kind: "tau", id: "enter_L" },
      redoBranch: { kind: "activity", id: "redoL", label: "Redo", objectType: "Artifact" }
    };

    const net = compilePowlToWorkflowNet(powl);
    const ids = net.transitions.map((t) => t.id);
    expect(ids.length).toBe(new Set(ids).size);
    expect(net.pre.size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith("__powl_t_"))).toBe(true);

    let redoFired = 0;
    const res = await executePowlWithTokenReplay(powl, async (t) => {
      if (t.activityId === "redoL") {
        redoFired += 1;
        // First redo attempt exits the loop (executor returns ok without redo flag;
        // silent exit fires after do completes — loop body is tau then optional redo).
        return { ok: true, exitCode: 0 };
      }
      return { ok: true, exitCode: 0 };
    });

    expect(res.replay.fitness).toBe(1);
    expect(res.replay.soundTermination).toBe(true);
    expect(res.replay.missing).toBe(0);
    expect(res.replay.remaining).toBe(0);
    expect(redoFired).toBe(0); // exit takes silent path; redo activity never enabled without redo token path
  });

  test("falsifier: tau fork_po1 / end_po1 under PO po1 compile with unique ids + fitness 1", async () => {
    const powl: PowlNode = {
      kind: "partial_order",
      id: "po1",
      children: [
        { kind: "tau", id: "fork_po1" },
        { kind: "tau", id: "end_po1" }
      ],
      order: [["fork_po1", "end_po1"]]
    };
    const net = compilePowlToWorkflowNet(powl);
    const ids = net.transitions.map((t) => t.id);
    expect(ids.length).toBe(new Set(ids).size);
    expect(net.pre.size).toBe(ids.length);

    const res = await executePowlWithTokenReplay(powl, async () => ({ ok: true, exitCode: 0 }));
    expect(res.replay.fitness).toBe(1);
    expect(res.replay.soundTermination).toBe(true);
  });

  test("falsifier: tau join_P_v under ordered PO does not collide with structural join", async () => {
    const powl: PowlNode = {
      kind: "partial_order",
      id: "P",
      children: [
        { kind: "activity", id: "u", label: "U", objectType: "Artifact" },
        { kind: "tau", id: "join_P_v" },
        { kind: "activity", id: "v", label: "V", objectType: "Artifact" }
      ],
      order: [
        ["u", "join_P_v"],
        ["join_P_v", "v"]
      ]
    };
    const net = compilePowlToWorkflowNet(powl);
    const ids = net.transitions.map((t) => t.id);
    expect(ids.length).toBe(new Set(ids).size);
    expect(net.pre.size).toBe(ids.length);

    const fired: string[] = [];
    const res = await executePowlWithTokenReplay(powl, async (t) => {
      if (t.activityId) fired.push(t.activityId);
      return { ok: true, exitCode: 0 };
    });
    expect(fired).toEqual(["u", "v"]);
    expect(res.replay.fitness).toBe(1);
    expect(res.replay.soundTermination).toBe(true);
  });

  test("transitiveClosure exposes ≺⁺ for covering relations", () => {
    const closure = transitiveClosure(["a", "b", "c"], [["a", "b"], ["b", "c"]]);
    expect(closure.has("a->b")).toBe(true);
    expect(closure.has("b->c")).toBe(true);
    expect(closure.has("a->c")).toBe(true);
    expect(closure.has("c->a")).toBe(false);
  });

  test("validateDisjointWriteScopes: overlapping unordered targetFiles → WRITE_SCOPE_CONFLICT", () => {
    const po: PowlNode = {
      kind: "partial_order",
      id: "conflict-po",
      children: [
        { kind: "activity", id: "w1", label: "W1", objectType: "Artifact", targetFile: "src/a.ts" },
        { kind: "activity", id: "w2", label: "W2", objectType: "Artifact", targetFile: "src/a.ts" }
      ],
      order: []
    };
    expect(po.kind).toBe("partial_order");
    if (po.kind !== "partial_order") return;
    const violations = validateDisjointWriteScopes(po);
    expect(violations.length).toBe(1);
    expect(violations[0]!.overlap).toContain("src/a.ts");
    expect(() => validatePowlTree(po)).toThrow("WRITE_SCOPE_CONFLICT");
  });

  test("validateDisjointWriteScopes: ordered or disjoint scopes pass; readonly fan-out free", () => {
    const ordered: PowlNode = {
      kind: "partial_order",
      id: "ordered-po",
      children: [
        { kind: "activity", id: "w1", label: "W1", objectType: "Artifact", targetFile: "src/a.ts" },
        { kind: "activity", id: "w2", label: "W2", objectType: "Artifact", targetFile: "src/a.ts" }
      ],
      order: [["w1", "w2"]]
    };
    expect(() => validatePowlTree(ordered)).not.toThrow();

    const disjoint: PowlNode = {
      kind: "partial_order",
      id: "disjoint-po",
      children: [
        { kind: "activity", id: "w1", label: "W1", objectType: "Artifact", targetFile: "src/a.ts" },
        { kind: "activity", id: "w2", label: "W2", objectType: "Artifact", targetFile: "src/b.ts" }
      ],
      order: []
    };
    expect(() => validatePowlTree(disjoint)).not.toThrow();

    const readonlyFanout: PowlNode = {
      kind: "partial_order",
      id: "ro-po",
      children: [
        { kind: "activity", id: "r1", label: "R1", objectType: "Artifact" },
        { kind: "activity", id: "r2", label: "R2", objectType: "Artifact" }
      ],
      order: []
    };
    expect(() => validatePowlTree(readonlyFanout)).not.toThrow();
  });
});
