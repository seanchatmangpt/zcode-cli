import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  ReceiptSink,
  RepoVerifierCourtAdapter,
  runFoundryLoop,
  SjiraWorkOrderSource,
  type TransitionReceipt,
  type WorkOrderSourceAdapter
} from "../src/adapters/index.ts";
import {
  admitAfterIntegrity,
  checkReceiptIntegrity,
  resolveExternalValidator
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

  test("C7-Foundry-Recursion: re-ingests frontier R_t -> O*_{t+1} and emits Chatman-5 ALOOP v2 DFCM receipt", async () => {
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

      // (2) Chatman-5 / ALOOP v2 DFCM receipt admitted by validate-receipts.ts
      expect(existsSync(dfcmReceiptPath)).toBe(true);
      const raw = readFileSync(dfcmReceiptPath, "utf8");
      const integrity = checkReceiptIntegrity(dfcmReceiptPath, {
        raw,
        shaExists: (sha) => {
          const probe = spawnSync("git", ["-C", repo, "cat-file", "-t", sha], {
            encoding: "utf8"
          });
          return probe.status === 0 && probe.stdout.trim() === "commit";
        }
      });
      expect(integrity).toEqual([]);

      const external = resolveExternalValidator();
      const admitted = admitAfterIntegrity({
        path: dfcmReceiptPath,
        raw,
        external,
        allowIntegrityOnly: external.path === null
      });
      expect(admitted.ok).toBe(true);
      expect(admitted.exitCode).toBe(0);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 30_000);
});
