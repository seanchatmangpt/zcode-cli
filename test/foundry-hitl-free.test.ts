import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  ReceiptSink,
  RepoVerifierCourtAdapter,
  runFoundryLoop,
  SjiraWorkOrderSource
} from "../src/adapters/index.ts";

function initTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "zcode-hitl-free-"));
  writeFileSync(join(dir, "state.txt"), "broken\n");
  execFileSync("git", ["init"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "foundry@local"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Foundry"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: dir });
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
        standing: "UNKNOWN"
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
  });

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
        standing: "UNKNOWN"
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
  });

  test("zcode foundry --dry-run CLI subprocess runs cleanly on a real repo", () => {
    const repo = initTempGitRepo();
    try {
      const binPath = resolve(import.meta.dir, "../bin/zcode.ts");
      const r = spawnSync("bun", [binPath, "foundry", "--dry-run", "--repo", repo], {
        cwd: resolve(import.meta.dir, ".."),
        encoding: "utf8"
      });
      // Honest standing: dry-run sandbox is PARTIAL_ALIVE (exit 2, never fake ALIVE exit 0).
      expect(r.status).toBe(2);
      const parsed = JSON.parse(r.stdout) as { mode: string; repos: Array<{ aggregateStanding: string }> };
      expect(parsed.mode).toBe("dry-run");
      expect(parsed.repos[0]?.aggregateStanding).toBe("PARTIAL_ALIVE");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
