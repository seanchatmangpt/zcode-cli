import { describe, expect, test } from "bun:test";
import {
  compilePowlToWorkflowNet,
  deriveFollowUpPowl,
  executePowlWithTokenReplay,
  runAutonomicLoop,
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
