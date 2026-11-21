import { describe, expect, test } from "bun:test";
import {
  compilePowlToWorkflowNet,
  verifyStructuralSoundness,
  type PowlNode
} from "../src/powl-ocel-orchestrator.ts";

function uniqueTransitionIds(net: ReturnType<typeof compilePowlToWorkflowNet>): boolean {
  const ids = net.transitions.map((t) => t.id);
  return new Set(ids).size === ids.length && net.pre.size === ids.length && net.post.size === ids.length;
}

describe("WF-net structural soundness + transition identity", () => {
  test("verifyStructuralSoundness holds for Activity / Tau / Xor / Loop / PartialOrder", () => {
    const trees: PowlNode[] = [
      { kind: "activity", id: "a", label: "A", objectType: "Artifact" },
      { kind: "tau", id: "silent" },
      {
        kind: "xor",
        id: "x",
        branches: [
          { kind: "activity", id: "xa", label: "XA", objectType: "Artifact" },
          { kind: "activity", id: "xb", label: "XB", objectType: "Artifact" }
        ]
      },
      {
        kind: "loop",
        id: "L",
        doBranch: { kind: "activity", id: "do", label: "Do", objectType: "Artifact" },
        redoBranch: { kind: "activity", id: "redo", label: "Redo", objectType: "Artifact" }
      },
      {
        kind: "partial_order",
        id: "po",
        children: [
          { kind: "activity", id: "manifest", label: "Pin Manifest", objectType: "Artifact" },
          { kind: "activity", id: "scorecard", label: "Scorecard", objectType: "Artifact" },
          { kind: "activity", id: "trivy", label: "Trivy", objectType: "Artifact" },
          { kind: "activity", id: "court", label: "Court", objectType: "Artifact" }
        ],
        order: [
          ["manifest", "scorecard"],
          ["manifest", "trivy"],
          ["scorecard", "court"],
          ["trivy", "court"]
        ]
      }
    ];

    for (const root of trees) {
      const net = compilePowlToWorkflowNet(root);
      expect(uniqueTransitionIds(net)).toBe(true);
      const sound = verifyStructuralSoundness(net);
      expect(sound).toEqual({
        optionToComplete: true,
        properCompletion: true,
        noDeadTransitions: true
      });
    }
  });

  test("tau id that prefixes tau_enter_<loop> no longer collides (Antigravity CONFIRMED_DEFECT)", () => {
    const root: PowlNode = {
      kind: "partial_order",
      id: "root",
      children: [
        {
          kind: "loop",
          id: "L",
          doBranch: { kind: "activity", id: "do1", label: "Do", objectType: "Artifact" },
          redoBranch: { kind: "activity", id: "redo1", label: "Redo", objectType: "Artifact" }
        },
        { kind: "tau", id: "enter_L" }
      ],
      order: []
    };
    const net = compilePowlToWorkflowNet(root);
    expect(uniqueTransitionIds(net)).toBe(true);
    expect(verifyStructuralSoundness(net)).toEqual({
      optionToComplete: true,
      properCompletion: true,
      noDeadTransitions: true
    });
  });

  test("tau id that prefixes tau_fork_<po> / tau_join_<po>_<v> no longer collides", () => {
    const forkCollision: PowlNode = {
      kind: "partial_order",
      id: "P",
      children: [
        {
          kind: "partial_order",
          id: "inner",
          children: [{ kind: "activity", id: "a", label: "A", objectType: "Artifact" }],
          order: []
        },
        { kind: "tau", id: "fork_inner" }
      ],
      order: []
    };
    const joinCollision: PowlNode = {
      kind: "partial_order",
      id: "po",
      children: [
        { kind: "activity", id: "u", label: "U", objectType: "Artifact" },
        { kind: "activity", id: "v", label: "V", objectType: "Artifact" },
        { kind: "tau", id: "join_po_v" }
      ],
      order: [["u", "v"]]
    };
    for (const root of [forkCollision, joinCollision]) {
      const net = compilePowlToWorkflowNet(root);
      expect(uniqueTransitionIds(net)).toBe(true);
      expect(verifyStructuralSoundness(net).optionToComplete).toBe(true);
      expect(verifyStructuralSoundness(net).noDeadTransitions).toBe(true);
    }
  });
});
