import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  ReceiptSink,
  RepoVerifierCourtAdapter,
  isDfcmStubNonAdmit,
  runFoundryLoop,
  SjiraWorkOrderSource,
  type TransitionReceipt,
  type WorkOrderSourceAdapter
} from "../src/adapters/index.ts";
import { frontierActivitySignature } from "../src/adapters/foundry-loop.ts";
import {
  checkChatman5Structural,
  checkReceiptIntegrity,
} from "../scripts/validate-receipts.ts";

function initTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "zcode-hitl-free-"));
  writeFileSync(join(dir, "state.txt"), "broken\n");
  const gitOpts = { cwd: dir, timeout: 15_000 };
  execFileSync("git", ["init"], gitOpts);
  execFileSync("git", ["config", "user.email", "foundry@local"], gitOpts);
  execFileSync("git", ["config", "user.name", "Foundry"], gitOpts);
  execFileSync("git", ["add", "-A"], gitOpts);
  execFileSync("git", ["commit", "-m", "initial"], gitOpts);
  return dir;
}

function initMultiWoGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "zcode-hitl-multi-"));
  writeFileSync(join(dir, "a.txt"), "broken\n");
  writeFileSync(join(dir, "b.txt"), "ok\n");
  const gitOpts = { cwd: dir, timeout: 15_000 };
  execFileSync("git", ["init"], gitOpts);
  execFileSync("git", ["config", "user.email", "foundry@local"], gitOpts);
  execFileSync("git", ["config", "user.name", "Foundry"], gitOpts);
  execFileSync("git", ["add", "-A"], gitOpts);
  execFileSync("git", ["commit", "-m", "initial"], gitOpts);
  return dir;
}

describe("HITL-free foundry loop (Chicago zero-mock)", () => {
  test("refuses failing repo, rolls back broken edit, then converges ALIVE + auto-commits", async () => {
    const repo = initTempGitRepo();
    const outDir = join(repo, ".sjira-out");
    const candidatesPath = join(repo, "candidates.jsonl");
    writeFileSync(
      candidatesPath,
      `${JSON.stringify({
        id: "WO-FIX-STATE",
        label: "Fix state.txt to ok",
        objectType: "WorkOrder",
        standing: "UNKNOWN",
        targetFile: "state.txt"
      })}\n`
    );

    try {
      const source = new SjiraWorkOrderSource({
        cwd: repo,
        candidatesPath,
        ledgerPath: join(outDir, "ledger.jsonl"),
        outDir,
        enforceMinGgenAncestor: false
      });
      const sink = new ReceiptSink({
        ledgerPath: join(outDir, "sink-ledger.jsonl"),
        outDir,
        cwd: repo
      });

      // Real subprocess court: passes iff state.txt === "ok"
      const court = new RepoVerifierCourtAdapter({
        commands: [["node", "-e", "const fs=require('fs'); process.exit(fs.readFileSync('state.txt','utf8').trim()==='ok'?0:1)"]]
      });

      let attempt = 0;
      const result = await runFoundryLoop({
        source,
        courts: [court],
        sink,
        workspaceDir: repo,
        dryRun: false,
        maxCycles: 3,
        untilDrained: true,
        transactionalRollback: true,
        autoCommitAlive: true,
        outputDir: join(outDir, "ocel"),
        executor: async () => {
          attempt += 1;
          if (attempt === 1) {
            // Write a broken mutation; court must refuse and roll it back.
            writeFileSync(join(repo, "state.txt"), "still-broken\n");
            return { ok: true, exitCode: 0, detail: "attempt-1" };
          }
          // Second cycle remediates to "ok"
          writeFileSync(join(repo, "state.txt"), "ok\n");
          return { ok: true, exitCode: 0, detail: "attempt-2" };
        }
      });

      expect(result.converged).toBe(true);
      expect(result.aggregateStanding).toBe("ALIVE");
      expect(result.exitCode).toBe(0);
      expect(result.cycles.length).toBe(2);
      expect(result.commitsCreated.length).toBe(1);
      expect(readFileSync(join(repo, "state.txt"), "utf8").trim()).toBe("ok");
      expect(existsSync(join(outDir, "loop_receipt.json"))).toBe(true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 30_000);

  test("SignatureRetryLimiter halts repeated identical failures without infinite loop", async () => {
    const repo = initTempGitRepo();
    const outDir = join(repo, ".sjira-out");
    const candidatesPath = join(repo, "candidates.jsonl");
    writeFileSync(
      candidatesPath,
      `${JSON.stringify({
        id: "WO-STUCK",
        label: "Always failing transition",
        objectType: "WorkOrder",
        standing: "UNKNOWN",
        targetFile: "state.txt"
      })}\n`
    );

    try {
      const source = new SjiraWorkOrderSource({
        cwd: repo,
        candidatesPath,
        ledgerPath: join(outDir, "ledger.jsonl"),
        outDir,
        enforceMinGgenAncestor: false
      });

      const result = await runFoundryLoop({
        source,
        courts: [],
        workspaceDir: repo,
        dryRun: false,
        maxCycles: 10,
        maxSameSignatureRetries: 1,
        transactionalRollback: true,
        executor: async () => ({ ok: false, exitCode: 1, detail: "same-error-forever" })
      });

      expect(result.converged).toBe(false);
      expect(result.retryBudgetExhausted).toBe(true);
      expect(result.aggregateStanding).toBe("REFUSED");
      expect(result.exitCode).toBe(1);
      expect(result.cycles.length).toBeLessThan(10);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 30_000);

  test("zcode foundry --dry-run CLI subprocess runs cleanly on a real repo", () => {
    const repo = initTempGitRepo();
    try {
      const binPath = resolve(import.meta.dir, "../bin/zcode.ts");
      const r = spawnSync("bun", [binPath, "foundry", "--dry-run", "--repo", repo], {
        cwd: resolve(import.meta.dir, ".."),
        encoding: "utf8",
        timeout: 15_000
      });
      // Honest standing: dry-run sandbox is PARTIAL_ALIVE (exit 2, never fake ALIVE exit 0).
      expect(r.status).toBe(2);
      const parsed = JSON.parse(r.stdout) as { mode: string; repos: Array<{ aggregateStanding: string }> };
      expect(parsed.mode).toBe("dry-run");
      expect(parsed.repos[0]?.aggregateStanding).toBe("PARTIAL_ALIVE");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 25_000);

  test("multi-WO remediation converges ALIVE across distinct targetFiles without SUBJECT_MISSING on verify-remediation", async () => {
    const repo = initMultiWoGitRepo();
    const outDir = join(repo, ".sjira-out");
    const candidatesPath = join(repo, "candidates.jsonl");
    writeFileSync(
      candidatesPath,
      [
        JSON.stringify({
          id: "WO-A",
          label: "Fix a.txt",
          objectType: "WorkOrder",
          standing: "UNKNOWN",
          targetFile: "a.txt"
        }),
        JSON.stringify({
          id: "WO-B",
          label: "Verify b.txt",
          objectType: "WorkOrder",
          standing: "UNKNOWN",
          targetFile: "b.txt"
        })
      ].join("\n") + "\n"
    );

    try {
      const source = new SjiraWorkOrderSource({
        cwd: repo,
        candidatesPath,
        ledgerPath: join(outDir, "ledger.jsonl"),
        outDir,
        enforceMinGgenAncestor: false
      });
      const sink = new ReceiptSink({
        ledgerPath: join(outDir, "sink-ledger.jsonl"),
        outDir,
        cwd: repo
      });
      const court = new RepoVerifierCourtAdapter({
        commands: [
          [
            "node",
            "-e",
            "const fs=require('fs'); process.exit(fs.readFileSync('a.txt','utf8').trim()==='ok' && fs.readFileSync('b.txt','utf8').trim()==='ok' ? 0 : 1)"
          ]
        ]
      });

      const result = await runFoundryLoop({
        source,
        courts: [court],
        sink,
        workspaceDir: repo,
        dryRun: false,
        maxCycles: 3,
        untilDrained: true,
        transactionalRollback: true,
        autoCommitAlive: true,
        outputDir: join(outDir, "ocel"),
        executor: async (t) => {
          const actId = t.activityId ?? t.id;
          if (actId === "WO-A") {
            writeFileSync(join(repo, "a.txt"), "still-broken\n");
            return { ok: true, exitCode: 0, detail: "attempt-a-1" };
          }
          if (actId === "WO-B") {
            writeFileSync(join(repo, "b.txt"), "ok\n");
            return { ok: true, exitCode: 0, detail: "attempt-b-1" };
          }
          if (actId.startsWith("remediate-2-")) {
            if (t.label.includes("WO-A") || t.targetFile === "a.txt") {
              expect(t.targetFile).toBe("a.txt");
              writeFileSync(join(repo, "a.txt"), "ok\n");
            } else {
              writeFileSync(join(repo, "b.txt"), "ok\n");
            }
            return { ok: true, exitCode: 0, detail: `remediate-${actId}` };
          }
          if (actId === "verify-remediation-2") {
            expect(t.targetFile === "a.txt" || (t.fileScope?.includes("a.txt") ?? false)).toBe(true);
            return { ok: true, exitCode: 0, detail: "re-verified" };
          }
          return { ok: false, exitCode: 1, detail: `unexpected-transition:${actId}` };
        }
      });

      expect(result.converged).toBe(true);
      expect(result.aggregateStanding).toBe("ALIVE");
      expect(result.exitCode).toBe(0);
      expect(result.cycles.length).toBe(2);
      expect(result.commitsCreated.length).toBeGreaterThanOrEqual(1);
      expect(readFileSync(join(repo, "a.txt"), "utf8").trim()).toBe("ok");
      expect(readFileSync(join(repo, "b.txt"), "utf8").trim()).toBe("ok");
      const cycle2Events = result.cycles[1]!.ocel.events;
      expect(
        cycle2Events.some(
          (e) =>
            e.type === "transition_completed" &&
            e.attributes.some(
              (a) => a.name === "transition" && String(a.value).includes("verify-remediation-2")
            ) &&
            e.relationships.some((r) => r.objectId === "art:verify-remediation-2")
        )
      ).toBe(true);
      expect(
        cycle2Events.some((e) =>
          e.attributes.some((a) => String(a.value).includes("SUBJECT_MISSING"))
        )
      ).toBe(false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 30_000);

  test("PR #32 anti-vacuity: unscoped WO refuses SUBJECT_MISSING in Cycle 1 and Cycle 2 without leaking sibling targetFile", async () => {
    const repo = initMultiWoGitRepo();
    const outDir = join(repo, ".sjira-out");
    const candidatesPath = join(repo, "candidates.jsonl");
    writeFileSync(
      candidatesPath,
      [
        JSON.stringify({
          id: "WO-A",
          label: "Scoped work order",
          objectType: "WorkOrder",
          standing: "UNKNOWN",
          targetFile: "a.txt"
        }),
        JSON.stringify({
          id: "WO-UNSCOPED",
          label: "Missing targetFile",
          objectType: "WorkOrder",
          standing: "UNKNOWN",
          dependsOn: ["WO-A"]
        })
      ].join("\n") + "\n"
    );

    try {
      const source = new SjiraWorkOrderSource({
        cwd: repo,
        candidatesPath,
        ledgerPath: join(outDir, "ledger.jsonl"),
        outDir,
        enforceMinGgenAncestor: false
      });
      const executedIds: string[] = [];
      const result = await runFoundryLoop({
        source,
        courts: [],
        workspaceDir: repo,
        dryRun: false,
        maxCycles: 2,
        untilDrained: true,
        transactionalRollback: true,
        executor: async (t) => {
          executedIds.push(t.activityId ?? t.id);
          return { ok: true, exitCode: 0, detail: "ok" };
        }
      });

      expect(executedIds).toEqual(["WO-A"]);
      expect(result.converged).toBe(false);
      expect(result.aggregateStanding).toBe("REFUSED");
      expect(result.exitCode).toBe(1);
      expect(result.cycles.length).toBe(2);
      for (const cycle of result.cycles) {
        expect(
          cycle.ocel.events.some(
            (e) =>
              e.type === "transition_refused" &&
              e.attributes.some((a) => a.name === "detail" && String(a.value).includes("SUBJECT_MISSING"))
          )
        ).toBe(true);
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 30_000);

  test("C7-Foundry-Recursion: re-ingests frontier R_t -> O*_{t+1} and emits fail-closed DFCM stub", async () => {
    const repo = initTempGitRepo();
    const outDir = join(repo, ".sjira-out");
    const dfcmReceiptPath = join(outDir, "dfcm-receipt.json");

    try {
      let ingestCount = 0;
      let mutatedByOutcome = false;
      const recorded: TransitionReceipt[] = [];

      const source: WorkOrderSourceAdapter = {
        name: "c7-recursion-source",
        async preflightVerify() {
          return { ok: true, exitCode: 0, detail: "ok" };
        },
        async ingestFrontier() {
          ingestCount += 1;
          return {
            kind: "partial_order",
            id: `frontier-pass-${ingestCount}`,
            children: [
              {
                kind: "activity",
                id: mutatedByOutcome ? "WO-CYCLE-2" : "WO-CYCLE-1",
                label: mutatedByOutcome ? "Cycle 2 frontier after R_1" : "Cycle 1 frontier",
                objectType: "WorkOrder",
                targetFile: "state.txt"
              }
            ],
            order: []
          };
        },
        async recordOutcome(receipt: TransitionReceipt) {
          recorded.push(receipt);
          mutatedByOutcome = true;
        }
      };

      const sink = new ReceiptSink({
        ledgerPath: join(outDir, "sink-ledger.jsonl"),
        outDir,
        dfcmReceiptPath,
        cwd: repo
      });

      const court = new RepoVerifierCourtAdapter({
        commands: [
          [
            "node",
            "-e",
            "const fs=require('fs'); process.exit(fs.readFileSync('state.txt','utf8').trim()==='ok'?0:1)"
          ]
        ]
      });

      const result = await runFoundryLoop({
        source,
        courts: [court],
        sink,
        workspaceDir: repo,
        dryRun: false,
        maxCycles: 2,
        untilDrained: true,
        transactionalRollback: true,
        executor: async (t) => {
          if (t.activityId === "WO-CYCLE-1") {
            writeFileSync(join(repo, "state.txt"), "still-broken\n");
            return { ok: true, exitCode: 0, detail: "cycle-1-broken" };
          }
          writeFileSync(join(repo, "state.txt"), "ok\n");
          return { ok: true, exitCode: 0, detail: "cycle-2-fixed" };
        }
      });

      // (1) Closed-loop recursion R_t -> O*_{t+1}: ingestFrontier called >= 2 times
      expect(ingestCount).toBeGreaterThanOrEqual(2);
      expect(recorded.length).toBeGreaterThanOrEqual(2);
      expect(result.converged).toBe(true);
      expect(result.aggregateStanding).toBe("ALIVE");
      expect(result.exitCode).toBe(0);
      expect(result.cycles.length).toBe(2);

      // (2) Cycle-close DFCM is zcode.dfcm.receipt/1 stub — non-admit, not ALOOP v2.
      expect(existsSync(dfcmReceiptPath)).toBe(true);
      const dfcm = JSON.parse(readFileSync(dfcmReceiptPath, "utf8")) as Record<string, unknown>;
      expect(dfcm.schema).toBe("zcode.dfcm.receipt/1");
      expect(dfcm.admit).toBe(false);
      expect(dfcm.non_admit).toBe(true);
      expect(dfcm.authority).toBe("NONE");
      expect(dfcm.work_order_id).toBeUndefined();
      expect(isDfcmStubNonAdmit(dfcm)).toBe(true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 30_000);

  test("ERRC ELIMINATE: fails closed with REFUSED/exitCode 2 when captureWorkspaceSnapshot throws, recording diagnostic and halting re-entry", async () => {
    const repo = initTempGitRepo();
    const missingWorkspace = join(repo, "nonexistent-workspace-dir");
    const priorDiagnostics = new Map<string, string>();
    let ingestCount = 0;
    const executedIds: string[] = [];

    try {
      const source: WorkOrderSourceAdapter = {
        name: "rollback-fail-closed-source",
        async preflightVerify() {
          return { ok: true, exitCode: 0, detail: "ok" };
        },
        async ingestFrontier() {
          ingestCount += 1;
          return {
            kind: "partial_order",
            id: `po-${ingestCount}`,
            children: [
              {
                kind: "activity",
                id: "WO-1",
                label: "First transition",
                objectType: "WorkOrder",
                targetFile: "state.txt"
              },
              {
                kind: "activity",
                id: "WO-2",
                label: "Second transition",
                objectType: "WorkOrder",
                targetFile: "state.txt"
              }
            ],
            order: [["WO-1", "WO-2"]]
          };
        },
        async recordOutcome() {
          // no-op
        }
      };

      const result = await runFoundryLoop({
        source,
        courts: [],
        workspaceDir: missingWorkspace,
        dryRun: false,
        maxCycles: 3,
        transactionalRollback: true,
        priorDiagnostics,
        executor: async (t) => {
          executedIds.push(t.activityId ?? t.id);
          return { ok: true, exitCode: 0, detail: "should-not-run" };
        }
      });

      expect(result.converged).toBe(false);
      expect(result.aggregateStanding).toBe("REFUSED");
      expect(result.exitCode).toBe(2);
      expect(result.cycles.length).toBe(1);
      expect(ingestCount).toBe(1);
      expect(executedIds).toEqual([]);
      expect(priorDiagnostics.get("WO-1")).toContain("snapshot-capture failed");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 15_000);

  test("ERRC CREATE: frontierActivitySignature detects structural edge/scope deltas and binds git baseSha on TransitionReceipt", async () => {
    const repo = initMultiWoGitRepo();
    const initialHead = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repo,
      encoding: "utf8"
    }).trim();

    // Direct structural signature checks: same activity IDs/labels, different edges or scopes.
    const sigBase = frontierActivitySignature({
      kind: "partial_order",
      id: "po",
      children: [
        { kind: "activity", id: "WO-1", label: "Work", objectType: "WorkOrder", targetFile: "a.txt" },
        { kind: "activity", id: "WO-2", label: "Work", objectType: "WorkOrder", targetFile: "b.txt" }
      ],
      order: []
    });
    const sigWithEdge = frontierActivitySignature({
      kind: "partial_order",
      id: "po",
      children: [
        { kind: "activity", id: "WO-1", label: "Work", objectType: "WorkOrder", targetFile: "a.txt" },
        { kind: "activity", id: "WO-2", label: "Work", objectType: "WorkOrder", targetFile: "b.txt" }
      ],
      order: [["WO-1", "WO-2"]]
    });
    const sigWithScope = frontierActivitySignature({
      kind: "partial_order",
      id: "po",
      children: [
        { kind: "activity", id: "WO-1", label: "Work", objectType: "WorkOrder", targetFile: "c.txt" },
        { kind: "activity", id: "WO-2", label: "Work", objectType: "WorkOrder", targetFile: "b.txt" }
      ],
      order: []
    });
    expect(sigBase).not.toBe(sigWithEdge);
    expect(sigBase).not.toBe(sigWithScope);

    try {
      let ingestCount = 0;
      const recorded: TransitionReceipt[] = [];
      const seenTargets: string[] = [];

      const source: WorkOrderSourceAdapter = {
        name: "structural-delta-source",
        async preflightVerify() {
          return { ok: true, exitCode: 0, detail: "ok" };
        },
        async ingestFrontier() {
          ingestCount += 1;
          // Same activity id + label on both passes, but targetFile changes from a.txt -> b.txt on pass 2.
          return {
            kind: "partial_order",
            id: "po-same-id",
            children: [
              {
                kind: "activity",
                id: "WO-SAME",
                label: "Same label",
                objectType: "WorkOrder",
                targetFile: ingestCount === 1 ? "a.txt" : "b.txt"
              }
            ],
            order: []
          };
        },
        async recordOutcome(receipt: TransitionReceipt) {
          recorded.push(receipt);
        }
      };

      const result = await runFoundryLoop({
        source,
        courts: [],
        workspaceDir: repo,
        dryRun: false,
        maxCycles: 2,
        untilDrained: true,
        transactionalRollback: true,
        autoCommitAlive: true,
        executor: async (t) => {
          seenTargets.push(t.targetFile ?? "");
          if (seenTargets.length === 1) {
            return { ok: false, exitCode: 1, detail: "force-cycle-2-reingest" };
          }
          writeFileSync(join(repo, "b.txt"), "updated-ok\n");
          return { ok: true, exitCode: 0, detail: "cycle-2-ok" };
        }
      });

      expect(ingestCount).toBe(2);
      expect(seenTargets).toEqual(["a.txt", "b.txt"]);
      expect(result.converged).toBe(true);
      expect(result.commitsCreated.length).toBe(1);
      expect(recorded.length).toBeGreaterThanOrEqual(2);
      for (const r of recorded) {
        expect(r.baseSha).toBe(initialHead);
      }
      expect(result.commitsCreated[0]).not.toBe(initialHead);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 20_000);

  test("ERRC RAISE (Fix-20-ValidateReceipts): rejects malformed replay.commands and non-enum standing values", () => {
    const baseReceipt = {
      identity: {
        subject: "WO-20",
        repo: "zcode-cli",
        subject_sha: "a".repeat(40),
        base_sha: "b".repeat(40),
      },
      authority: {
        ceiling: "CONSTRUCT",
        grant: "lease-1",
        actor: "foundry",
      },
      consequence: {
        commits: [],
        files_changed: ["scripts/validate-receipts.ts"],
        remote_effects: [],
      },
      replay: {
        commands: [{ cmd: "bun test", exit: 0 }],
      },
      standing: {
        value: "ALIVE",
        derived_from: "bun test @ aaaa",
      },
    };

    // Valid baseline passes both structural and integrity checks
    expect(checkChatman5Structural(baseReceipt)).toEqual([]);
    expect(
      checkReceiptIntegrity("synthetic.json", {
        raw: JSON.stringify(baseReceipt),
        shaExists: () => true,
      }),
    ).toEqual([]);

    // 1. Non-enum standing value rejected by checkChatman5Structural
    const badStanding = {
      ...baseReceipt,
      standing: { value: "MOSTLY_FINE", derived_from: "bun test" },
    };
    const standingErrs = checkChatman5Structural(badStanding);
    expect(standingErrs.some((e) => e.includes("standing.value") && e.includes("MOSTLY_FINE"))).toBe(true);

    // 2. Non-record entry in replay.commands rejected by both structural and integrity checks
    const nonRecordCmd = {
      ...baseReceipt,
      replay: { commands: ["bun test"] },
    };
    expect(
      checkChatman5Structural(nonRecordCmd).some((e) => e.includes("replay.commands[0]: must be an object")),
    ).toBe(true);
    const nonRecordFindings = checkReceiptIntegrity("synthetic.json", {
      raw: JSON.stringify(nonRecordCmd),
      shaExists: () => true,
    });
    expect(nonRecordFindings.some((f) => f.rule === "MALFORMED_REPLAY_COMMAND")).toBe(true);

    // 3. Non-integer exit (e.g. string "0" or float 0.5) and empty cmd rejected by both checks
    const badExitCmd = {
      ...baseReceipt,
      replay: { commands: [{ cmd: "", exit: "0" }] },
    };
    const badExitErrs = checkChatman5Structural(badExitCmd);
    expect(badExitErrs.some((e) => e.includes("replay.commands[0].cmd"))).toBe(true);
    expect(badExitErrs.some((e) => e.includes("replay.commands[0].exit"))).toBe(true);
    const badExitFindings = checkReceiptIntegrity("synthetic.json", {
      raw: JSON.stringify(badExitCmd),
      shaExists: () => true,
    });
    expect(badExitFindings.filter((f) => f.rule === "MALFORMED_REPLAY_COMMAND").length).toBe(2);
  });
});
