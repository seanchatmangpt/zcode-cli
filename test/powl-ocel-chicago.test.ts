import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compilePowlToWorkflowNet,
  deriveFollowUpPowl,
  executePowlWithTokenReplay,
  pruneDeadPowlRoutes,
  pruneDeadWorkflowNetRoutes,
  runAutonomicLoop,
  tokenConservationHolds,
  validateDisjointWriteScopes,
  validatePowlTree,
  verifyStructuralSoundness,
  type PowlNode,
  type PowlPartialOrder,
  type WorkflowNet
} from "../src/powl-ocel-orchestrator.ts";

/** Per-child budget: vendor `doctor`/`--help` cold-start can exceed bun's 5s default under CI load. */
const SUBPROCESS_TIMEOUT_MS = 25_000;
/** Whole-case budget for the real-zcode POWL path (version → doctor∥help). */
const REAL_ZCODE_CASE_TIMEOUT_MS = 60_000;

function runRealSubprocess(
  cmd: string,
  args: string[],
  timeoutMs = SUBPROCESS_TIMEOUT_MS
): Promise<{ ok: boolean; exitCode: number; detail?: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let settled = false;
    const finish = (result: { ok: boolean; exitCode: number; detail?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, exitCode: 1, detail: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stderr?.on("data", (d) => { stderr += String(d); });
    child.on("close", (code) => finish({ ok: code === 0, exitCode: code ?? 1, detail: stderr.trim() || undefined }));
    child.on("error", (err) => finish({ ok: false, exitCode: 1, detail: err.message }));
  });
}

describe("Chicago-style (zero-mock, real subprocess + filesystem) POWL v2 + OCEL 2.0 tests", () => {
  test("executes real zcode CLI subprocesses through POWL -> Workflow Net -> OCEL 2.0 with byte-exact SHA-256 receipt", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "zcode-powl-chicago-"));
    try {
      const powl: PowlNode = {
        kind: "partial_order",
        id: "chicago-zcode-real",
        children: [
          { kind: "activity", id: "version", label: "zcode --version", objectType: "Artifact" },
          { kind: "activity", id: "doctor", label: "zcode doctor", objectType: "Artifact" },
          { kind: "activity", id: "help", label: "zcode --help", objectType: "Artifact" }
        ],
        order: [
          ["version", "doctor"],
          ["version", "help"]
        ]
      };

      const zcodeBin = join(process.cwd(), "bin", "zcode.js");
      const argMap: Record<string, string[]> = {
        version: [zcodeBin, "--version"],
        doctor: [zcodeBin, "doctor"],
        help: [zcodeBin, "--help"]
      };

      const res = await executePowlWithTokenReplay(
        powl,
        async (t) => runRealSubprocess(process.execPath, argMap[t.activityId!]!),
        { outputDir: outDir }
      );

      expect(res.replay.fitness).toBe(1);
      expect(res.replay.soundTermination).toBe(true);
      expect(res.replay.missing).toBe(0);
      expect(res.replay.remaining).toBe(0);

      // Verify real files on disk & recompute SHA-256 independently
      const ocelPath = join(outDir, "workflow.ocel.json");
      const receiptPath = join(outDir, "replay-conformance.json");
      const treePath = join(outDir, "powl-tree.json");
      expect(existsSync(ocelPath)).toBe(true);
      expect(existsSync(receiptPath)).toBe(true);
      expect(existsSync(treePath)).toBe(true);

      const diskOcel = readFileSync(ocelPath, "utf8");
      const recomputedSha = createHash("sha256").update(diskOcel).digest("hex");
      expect(recomputedSha).toBe(res.ocelSha256);

      const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
      expect(receipt.ocelSha256).toBe(recomputedSha);
      expect(receipt.replay.soundTermination).toBe(true);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, REAL_ZCODE_CASE_TIMEOUT_MS);

  test("anti-vacuity: real failing subprocess degrades fitness < 1.0 and triggers remediation follow-up POWL", async () => {
    const powl: PowlNode = {
      kind: "partial_order",
      id: "chicago-antivacuity",
      children: [
        { kind: "activity", id: "fail_step", label: "real exit 1", objectType: "Artifact" },
        { kind: "activity", id: "downstream", label: "must not fire", objectType: "Artifact" }
      ],
      order: [["fail_step", "downstream"]]
    };

    const fired: string[] = [];
    const res = await executePowlWithTokenReplay(powl, async (t) => {
      fired.push(t.activityId!);
      return runRealSubprocess(process.execPath, ["-e", "process.exit(1)"]);
    });

    expect(fired).toEqual(["fail_step"]);
    expect(res.replay.soundTermination).toBe(false);
    expect(res.replay.fitness).toBeLessThan(1);

    const followUp = deriveFollowUpPowl(res, 2);
    expect(followUp.id).toBe("chicago-antivacuity-remediate-c2");
  });

  test("autonomic multi-cycle loop runs real subprocesses without emptying the queue", async () => {
    const seed: PowlNode = {
      kind: "activity",
      id: "seed_real",
      label: "node -v",
      objectType: "Artifact"
    };

    const cycles = await runAutonomicLoop(
      seed,
      async () => runRealSubprocess(process.execPath, ["-v"]),
      { maxCycles: 2 }
    );

    expect(cycles).toHaveLength(2);
    expect(cycles[0]!.replay.soundTermination).toBe(true);
    expect(cycles[1]!.workflowId).toContain("verify-c2");
    expect(cycles[1]!.replay.soundTermination).toBe(true);
  });

  test("RAISE: recursive write-scope soundness rejects overlapping and empty-scope mutating leaves inside compound POWL nodes", () => {
    const overlappingCompound: PowlPartialOrder = {
      kind: "partial_order",
      id: "po-compound-overlap",
      children: [
        {
          kind: "xor",
          id: "xor-branch",
          branches: [
            { kind: "activity", id: "x1", label: "edit a", objectType: "File", targetFile: "src/shared.ts" },
            { kind: "activity", id: "x2", label: "read only", objectType: "File", activityKind: "readonly" }
          ]
        },
        {
          kind: "loop",
          id: "loop-branch",
          doBranch: { kind: "activity", id: "l1", label: "edit shared", objectType: "File", fileScope: ["src/*"] },
          redoBranch: { kind: "tau", id: "l-redo" }
        }
      ],
      order: []
    };

    const violations = validateDisjointWriteScopes(overlappingCompound);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.a).toBe("xor-branch");
    expect(violations[0]!.b).toBe("loop-branch");
    expect(() => validatePowlTree(overlappingCompound)).toThrow(/WRITE_SCOPE_CONFLICT/);

    const emptyScopeNested: PowlPartialOrder = {
      kind: "partial_order",
      id: "po-empty-nested",
      children: [
        {
          kind: "partial_order",
          id: "nested-po",
          children: [{ kind: "activity", id: "m1", label: "unscoped", objectType: "File", activityKind: "mutating" }],
          order: []
        },
        { kind: "activity", id: "m2", label: "scoped", objectType: "File", targetFile: "src/b.ts" }
      ],
      order: []
    };
    expect(validateDisjointWriteScopes(emptyScopeNested)).toHaveLength(1);
    expect(() => validatePowlTree(emptyScopeNested)).toThrow(/WRITE_SCOPE_CONFLICT/);

    const disjointCompound: PowlPartialOrder = {
      kind: "partial_order",
      id: "po-compound-disjoint",
      children: [
        {
          kind: "xor",
          id: "xor-ok",
          branches: [
            { kind: "activity", id: "ok1", label: "edit a", objectType: "File", targetFile: "src/a.ts" },
            { kind: "tau", id: "ok-tau" }
          ]
        },
        {
          kind: "loop",
          id: "loop-ok",
          doBranch: { kind: "activity", id: "ok2", label: "edit b", objectType: "File", targetFile: "src/b.ts" },
          redoBranch: { kind: "tau", id: "ok-redo" }
        }
      ],
      order: []
    };
    expect(validateDisjointWriteScopes(disjointCompound)).toHaveLength(0);
    expect(() => validatePowlTree(disjointCompound)).not.toThrow();
  });

  test("REDUCE: Hasse-diagram transitive reduction omits redundant ord_* places for transitive and duplicate edges", () => {
    const chainWithRedundant: PowlPartialOrder = {
      kind: "partial_order",
      id: "po-hasse",
      children: [
        { kind: "activity", id: "a", label: "A", objectType: "Artifact" },
        { kind: "activity", id: "b", label: "B", objectType: "Artifact" },
        { kind: "activity", id: "c", label: "C", objectType: "Artifact" }
      ],
      order: [
        ["a", "b"],
        ["b", "c"],
        ["a", "c"], // transitively implied
        ["a", "b"]  // duplicate
      ]
    };

    const net = compilePowlToWorkflowNet(chainWithRedundant);
    const ordPlaces = net.places.filter((p) => p.id.startsWith("p_ord_"));
    expect(ordPlaces).toHaveLength(2);
    expect(ordPlaces.some((p) => p.id.includes("ord_a_to_c"))).toBe(false);

    const soundness = verifyStructuralSoundness(net);
    expect(soundness.wfNetValid).not.toBe(false);
    expect(soundness.truncated).not.toBe(true);
    expect(soundness.optionToComplete).toBe(true);
    expect(soundness.properCompletion).toBe(true);
    expect(soundness.noDeadTransitions).toBe(true);
  });

  test("ELIMINATE: loop exit transitions carry typed loopExitFor metadata and drive redo execution", async () => {
    const loopNode: PowlNode = {
      kind: "loop",
      id: "retry_loop_1",
      maxIterations: 2,
      doBranch: { kind: "activity", id: "work", label: "work", objectType: "Artifact" },
      redoBranch: { kind: "activity", id: "fix", label: "fix", objectType: "Artifact" }
    };

    const net = compilePowlToWorkflowNet(loopNode);
    const exitTransitions = net.transitions.filter((t) => t.loopExitFor === "retry_loop_1");
    expect(exitTransitions).toHaveLength(1);
    expect(exitTransitions[0]!.silent).toBe(true);

    let doRuns = 0;
    const seq: string[] = [];
    const res = await executePowlWithTokenReplay(loopNode, async (t) => {
      seq.push(t.activityId!);
      if (t.activityId === "work") {
        doRuns += 1;
        return { ok: true, exitCode: 0, redo: doRuns === 1 };
      }
      return { ok: true, exitCode: 0 };
    });

    expect(seq).toEqual(["work", "fix", "work"]);
    expect(res.replay.soundTermination).toBe(true);
    expect(res.replay.fitness).toBe(1);
  });

  test("CREATE: verifyStructuralSoundness enforces WF-Net preconditions and reports truncated UNKNOWN on state-space overflow", () => {
    // 1. Violates •i = ∅ (transition outputs back to sourcePlace)
    const badSourceNet: WorkflowNet = {
      places: [
        { id: "i", objectType: "Workflow" },
        { id: "o", objectType: "Workflow" }
      ],
      transitions: [
        { id: "t1", label: "t1", silent: false, objectType: "Workflow" },
        { id: "t_back", label: "t_back", silent: true, objectType: "Workflow" }
      ],
      pre: new Map([["t1", ["i"]], ["t_back", ["i"]]]),
      post: new Map([["t1", ["o"]], ["t_back", ["i"]]]),
      sourcePlace: "i",
      sinkPlace: "o"
    };
    const rBadSource = verifyStructuralSoundness(badSourceNet);
    expect(rBadSource.wfNetValid).toBe(false);
    expect(rBadSource.optionToComplete).toBe(false);
    expect(rBadSource.truncated).not.toBe(true);

    // 2. Violates i-to-o connectedness (orphan dead-end place)
    const disconnectedNet: WorkflowNet = {
      places: [
        { id: "i", objectType: "Workflow" },
        { id: "o", objectType: "Workflow" },
        { id: "orphan", objectType: "Workflow" }
      ],
      transitions: [{ id: "t1", label: "t1", silent: false, objectType: "Workflow" }],
      pre: new Map([["t1", ["i"]]]),
      post: new Map([["t1", ["o"]]]),
      sourcePlace: "i",
      sinkPlace: "o"
    };
    const rDisc = verifyStructuralSoundness(disconnectedNet);
    expect(rDisc.wfNetValid).toBe(false);
    expect(rDisc.optionToComplete).toBe(false);

    // 3. Murata series/parallel reduction collapses 17 concurrent simple branches and proves SOUND
    const wideReducible: PowlPartialOrder = {
      kind: "partial_order",
      id: "po-wide-reducible-17",
      children: Array.from({ length: 17 }, (_, idx) => ({
        kind: "activity" as const,
        id: `b${idx}`,
        label: `Branch ${idx}`,
        objectType: "Artifact"
      })),
      order: []
    };
    const rWideReducible = verifyStructuralSoundness(compilePowlToWorkflowNet(wideReducible));
    expect(rWideReducible.wfNetValid).not.toBe(false);
    expect(rWideReducible.truncated).not.toBe(true);
    expect(rWideReducible.optionToComplete).toBe(true);
    expect(rWideReducible.properCompletion).toBe(true);
    expect(rWideReducible.noDeadTransitions).toBe(true);

    // 4. 17 irreducible concurrent loops (2^17 = 131072 > MAX_STATES = 50_000) -> truncated: true, standing: "UNKNOWN"
    const wideIrreducible: PowlPartialOrder = {
      kind: "partial_order",
      id: "po-wide-irreducible-17",
      children: Array.from({ length: 17 }, (_, idx) => ({
        kind: "loop" as const,
        id: `lp${idx}`,
        doBranch: { kind: "activity" as const, id: `do${idx}`, label: `Do ${idx}`, objectType: "Artifact" },
        redoBranch: { kind: "activity" as const, id: `re${idx}`, label: `Redo ${idx}`, objectType: "Artifact" }
      })),
      order: []
    };
    const rWideIrreducible = verifyStructuralSoundness(compilePowlToWorkflowNet(wideIrreducible));
    expect(rWideIrreducible.wfNetValid).not.toBe(false);
    expect(rWideIrreducible.truncated).toBe(true);
    expect(rWideIrreducible.standing).toBe("UNKNOWN");
  });

  test("G02: HTN-FOND oneof crystallizes Control Surface escalation when undecidable and executes selected branch when oracle resolves", async () => {
    const oneOfNode: PowlNode = {
      kind: "oneof",
      id: "fond-env-branch",
      reason: "environment-controlled nondeterministic deployment outcome",
      branches: [
        { kind: "activity", id: "branch_a", label: "Branch A", objectType: "Artifact" },
        { kind: "activity", id: "branch_b", label: "Branch B", objectType: "Artifact" }
      ]
    };

    const net = compilePowlToWorkflowNet(oneOfNode);
    const soundness = verifyStructuralSoundness(net);
    expect(soundness.wfNetValid).not.toBe(false);
    expect(soundness.optionToComplete).toBe(true);
    expect(soundness.properCompletion).toBe(true);
    expect(soundness.noDeadTransitions).toBe(true);

    // 1. Undecidable (no Control Surface oracle): must NOT greedily fire branch_a; must crystallize escalation.
    const firedUndecided: string[] = [];
    const escalated = await executePowlWithTokenReplay(oneOfNode, async (t) => {
      firedUndecided.push(t.activityId!);
      return runRealSubprocess(process.execPath, ["-v"]);
    });

    expect(firedUndecided).toEqual([]);
    expect(escalated.replay.soundTermination).toBe(false);
    expect(tokenConservationHolds(escalated.replay)).toBe(true);
    expect(escalated.refusalCode).toBe("CONTROL_SURFACE_ESCALATION");
    expect(escalated.controlSurfaceEscalations).toHaveLength(1);
    expect(escalated.controlSurfaceEscalations[0]!.oneOfId).toBe("fond-env-branch");
    expect(escalated.controlSurfaceEscalations[0]!.status).toBe("CRYSTALLIZED");
    expect(escalated.ocel.events.some((e) => e.type === "control_surface_escalation")).toBe(true);
    expect(escalated.ocel.objects.some((o) => o.id === "cs:fond-env-branch" && o.type === "ControlSurface")).toBe(true);

    // 2. Resolved by external Control Surface oracle to branch index 1 (branch_b)
    const firedResolved: string[] = [];
    const resolved = await executePowlWithTokenReplay(
      oneOfNode,
      async (t) => {
        firedResolved.push(t.activityId!);
        return runRealSubprocess(process.execPath, ["-v"]);
      },
      { resolveOneOf: (id) => (id === "fond-env-branch" ? 1 : undefined) }
    );

    expect(firedResolved).toEqual(["branch_b"]);
    expect(resolved.replay.soundTermination).toBe(true);
    expect(resolved.replay.fitness).toBe(1);
    expect(resolved.controlSurfaceEscalations).toHaveLength(0);
    expect(resolved.ocel.events.some((e) => e.type === "control_surface_resolved")).toBe(true);
  });

  test("G03: Provisional Voucher + Cure-Obligation Debt pair blocks sound termination until discharged", async () => {
    const seqPowl: PowlNode = {
      kind: "partial_order",
      id: "voucher-debt-flow",
      children: [
        { kind: "activity", id: "issue_step", label: "Provisional step", objectType: "Artifact" },
        { kind: "activity", id: "cure_step", label: "Cure step", objectType: "Artifact" }
      ],
      order: [["issue_step", "cure_step"]]
    };

    // 1. Unsettled cure obligation debt -> blocks soundTermination fail-closed
    const unsettled = await executePowlWithTokenReplay(seqPowl, async (t) => {
      const sub = await runRealSubprocess(process.execPath, ["-v"]);
      if (t.activityId === "issue_step") {
        return {
          ...sub,
          ok: false,
          provisionalVoucher: {
            voucherId: "v-001",
            cureObligationId: "cure-001",
            reason: "provisional artifact requires downstream verification"
          }
        };
      }
      return sub;
    });

    expect(unsettled.voucherDebt.voucherIssued).toBe(1);
    expect(unsettled.voucherDebt.cureObligationDischarged).toBe(0);
    expect(unsettled.voucherDebt.openCureObligations).toEqual(["cure-001"]);
    expect(unsettled.voucherDebt.invariantHolds).toBe(false);
    expect(unsettled.replay.soundTermination).toBe(false);
    expect(unsettled.refusalCode).toBe("UNSETTLED_CURE_OBLIGATION_DEBT");
    expect(unsettled.ocel.events.some((e) => e.type === "voucher_issued")).toBe(true);
    expect(unsettled.ocel.events.some((e) => e.type === "cure_obligation_unsettled")).toBe(true);

    // 2. Discharged cure obligation debt -> soundTermination === true
    const settled = await executePowlWithTokenReplay(seqPowl, async (t) => {
      const sub = await runRealSubprocess(process.execPath, ["-v"]);
      if (t.activityId === "issue_step") {
        return {
          ...sub,
          ok: false,
          provisionalVoucher: {
            voucherId: "v-002",
            cureObligationId: "cure-002",
            reason: "provisional artifact requires downstream verification"
          }
        };
      }
      return {
        ...sub,
        dischargesCureObligationId: "cure-002"
      };
    });

    expect(settled.voucherDebt.voucherIssued).toBe(1);
    expect(settled.voucherDebt.cureObligationDischarged).toBe(1);
    expect(settled.voucherDebt.openCureObligations).toEqual([]);
    expect(settled.voucherDebt.invariantHolds).toBe(true);
    expect(settled.replay.soundTermination).toBe(true);
    expect(settled.replay.fitness).toBe(1);
    expect(settled.refusalCode).toBeUndefined();
    expect(settled.ocel.events.some((e) => e.type === "voucher_issued")).toBe(true);
    expect(settled.ocel.events.some((e) => e.type === "cure_obligation_discharged")).toBe(true);
    expect(
      settled.ocel.objects.some(
        (o) => o.id === "voucher:v-002" && o.attributes.at(-1)?.value === "SETTLED"
      )
    ).toBe(true);
    expect(
      settled.ocel.objects.some(
        (o) => o.id === "debt:cure-002" && o.attributes.at(-1)?.value === "DISCHARGED"
      )
    ).toBe(true);
  });

  test("V03-POWL-OneOf: dead-route pruning strips refuted XOR/oneof/loop branches from POWL AST and compiled WorkflowNet", async () => {
    // 1. Refuted XOR branch is pruned from compiled WorkflowNet transitions
    const xorWithRefuted: PowlNode = {
      kind: "xor",
      id: "xor-dead-route",
      branches: [
        { kind: "activity", id: "live_branch", label: "Live Branch", objectType: "Artifact" },
        { kind: "activity", id: "dead_branch", label: "Dead Branch", objectType: "Artifact", refuted: true }
      ]
    };

    const prunedAst = pruneDeadPowlRoutes(xorWithRefuted);
    expect(prunedAst.node.kind).toBe("activity");
    expect(prunedAst.node.id).toBe("live_branch");
    expect(prunedAst.prunedNodeIds).toEqual(["dead_branch"]);

    const compiledXor = compilePowlToWorkflowNet(xorWithRefuted);
    const activityIds = compiledXor.transitions.map((t) => t.activityId).filter(Boolean);
    expect(activityIds).toEqual(["live_branch"]);
    expect(verifyStructuralSoundness(compiledXor).noDeadTransitions).toBe(true);

    // Real subprocess execution on the pruned XOR tree
    const fired: string[] = [];
    const res = await executePowlWithTokenReplay(xorWithRefuted, async (t) => {
      fired.push(t.activityId!);
      return runRealSubprocess(process.execPath, ["-v"]);
    });
    expect(fired).toEqual(["live_branch"]);
    expect(res.replay.soundTermination).toBe(true);
    expect(res.replay.fitness).toBe(1);

    // 2. Refuted via external refutedNodeIds option
    const xorExternalRefute: PowlNode = {
      kind: "xor",
      id: "xor-ext-refute",
      branches: [
        { kind: "activity", id: "keep_me", label: "Keep", objectType: "Artifact" },
        { kind: "activity", id: "drop_me", label: "Drop", objectType: "Artifact" }
      ]
    };
    const netExt = compilePowlToWorkflowNet(xorExternalRefute, { refutedNodeIds: ["drop_me"] });
    expect(netExt.transitions.map((t) => t.activityId).filter(Boolean)).toEqual(["keep_me"]);

    // 3. Resolved oneof prunes unchosen branch from compiled WorkflowNet
    const resolvedOneOf: PowlNode = {
      kind: "oneof",
      id: "oneof-resolved-prune",
      resolvedBranchIndex: 1,
      branches: [
        { kind: "activity", id: "unchosen_a", label: "Unchosen A", objectType: "Artifact" },
        { kind: "activity", id: "chosen_b", label: "Chosen B", objectType: "Artifact" }
      ]
    };
    const netOneOf = compilePowlToWorkflowNet(resolvedOneOf);
    expect(netOneOf.transitions.map((t) => t.activityId).filter(Boolean)).toEqual(["chosen_b"]);

    // 4. Loop with refuted redoBranch collapses to doBranch
    const loopDeadRedo: PowlNode = {
      kind: "loop",
      id: "loop-dead-redo",
      doBranch: { kind: "activity", id: "do_once", label: "Do Once", objectType: "Artifact" },
      redoBranch: { kind: "activity", id: "never_redo", label: "Never Redo", objectType: "Artifact", refuted: true }
    };
    const netLoop = compilePowlToWorkflowNet(loopDeadRedo);
    expect(netLoop.transitions.map((t) => t.activityId).filter(Boolean)).toEqual(["do_once"]);
    expect(netLoop.transitions.some((t) => t.loopExitFor === "loop-dead-redo")).toBe(false);

    // 5. All branches refuted fails closed
    const allDeadXor: PowlNode = {
      kind: "xor",
      id: "xor-all-dead",
      branches: [
        { kind: "activity", id: "d1", label: "D1", objectType: "Artifact", refuted: true },
        { kind: "activity", id: "d2", label: "D2", objectType: "Artifact", refuted: true }
      ]
    };
    expect(() => compilePowlToWorkflowNet(allDeadXor)).toThrow(/no feasible route/);
  });

  test("V03-POWL-OneOf: pruneDeadWorkflowNetRoutes removes structurally unreachable and behaviorally dead transitions", () => {
    const netWithDeadRoutes: WorkflowNet = {
      places: [
        { id: "i", objectType: "Workflow" },
        { id: "o", objectType: "Workflow" },
        { id: "p_orphan", objectType: "Workflow" },
        { id: "p_dead_lock", objectType: "Workflow" }
      ],
      transitions: [
        { id: "t_live", label: "live", silent: false, activityId: "live", objectType: "Artifact" },
        // Structurally unreachable from sourcePlace
        { id: "t_orphan", label: "orphan", silent: false, activityId: "orphan", objectType: "Artifact" },
        // Behaviorally dead: requires both i and p_dead_lock, where p_dead_lock is never marked
        { id: "t_dead", label: "dead", silent: false, activityId: "dead", objectType: "Artifact" }
      ],
      pre: new Map([
        ["t_live", ["i"]],
        ["t_orphan", ["p_orphan"]],
        ["t_dead", ["i", "p_dead_lock"]]
      ]),
      post: new Map([
        ["t_live", ["o"]],
        ["t_orphan", ["o"]],
        ["t_dead", ["o"]]
      ]),
      sourcePlace: "i",
      sinkPlace: "o"
    };

    const pruned = pruneDeadWorkflowNetRoutes(netWithDeadRoutes);
    expect(pruned.net.transitions.map((t) => t.id)).toEqual(["t_live"]);
    expect(pruned.prunedTransitionIds).toContain("t_orphan");
    expect(pruned.prunedTransitionIds).toContain("t_dead");
    expect(pruned.prunedPlaceIds).toContain("p_orphan");
    expect(pruned.prunedPlaceIds).toContain("p_dead_lock");

    const soundness = verifyStructuralSoundness(pruned.net);
    expect(soundness.wfNetValid).not.toBe(false);
    expect(soundness.optionToComplete).toBe(true);
    expect(soundness.properCompletion).toBe(true);
    expect(soundness.noDeadTransitions).toBe(true);
  });
});
