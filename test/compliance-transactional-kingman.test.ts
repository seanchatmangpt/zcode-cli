import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ComplianceRefusalError } from "../src/compliance/config.ts";
import {
  analyzeOcelKingmanMetrics,
  computeKingmanQueueEstimate,
  KingmanScheduler
} from "../src/compliance/kingman-scheduler.ts";
import {
  captureWorkspaceSnapshot,
  executeTransactionalLifecycle,
  SignatureRetryLimiter,
  TransactionalRollbackError
} from "../src/compliance/transactional-net.ts";
import {
  AimdWipController,
  executePowlWithTokenReplay,
  runAutonomicLoop,
  type PowlNode
} from "../src/powl-ocel-orchestrator.ts";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function initGitWorkspace(dir: string): void {
  const gitOpts = { cwd: dir, stdio: "ignore" as const, timeout: 15_000 };
  execFileSync("git", ["init"], gitOpts);
  execFileSync("git", ["config", "user.email", "test@example.org"], gitOpts);
  execFileSync("git", ["config", "user.name", "ZCode Test"], gitOpts);
  writeFileSync(join(dir, "tracked.txt"), "initial-clean-state\n", "utf8");
  execFileSync("git", ["add", "tracked.txt"], gitOpts);
  execFileSync("git", ["commit", "-m", "init"], gitOpts);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("F12 Transactional Nets, Atomic Rollback & Retry Cap (Chicago)", () => {
  test("SignatureRetryLimiter tracks independent budgets and throws RETRY_BUDGET_EXHAUSTED on 4th identical failure", () => {
    const limiter = new SignatureRetryLimiter(3);
    expect(limiter.recordFailure("TS2322:identical_burn src/a.ts:10:5", "t1").count).toBe(1);
    expect(limiter.recordFailure("TS2322:identical_burn src/a.ts:14:9", "t1").count).toBe(2);
    expect(limiter.recordFailure("TS2322:identical_burn src/a.ts:22:1", "t1").count).toBe(3);

    // Independent signature has its own full budget
    expect(limiter.recordFailure("ENOENT:missing_fixture", "t2").count).toBe(1);
    expect(limiter.remainingFor("ENOENT:missing_fixture")).toBe(2);

    // 4th failure on TS2322 throws ComplianceRefusalError RETRY_BUDGET_EXHAUSTED
    let caught: unknown;
    try {
      limiter.recordFailure("TS2322:identical_burn src/a.ts:99:3", "t1");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ComplianceRefusalError);
    const refusal = caught as ComplianceRefusalError;
    expect(refusal.code).toBe("RETRY_BUDGET_EXHAUSTED");
    expect(refusal.exitCode).toBe(1);
    expect(refusal.brokenTerm).toBe("mu_on_O");
  });

  test("atomic git + filesystem rollback restores tracked files, deletes untracked files, and emits workspace_rolled_back", async () => {
    const repo = makeTempDir("zcode-tx-git-");
    initGitWorkspace(repo);

    const powl: PowlNode = {
      kind: "activity",
      id: "edit_step",
      label: "Mutate workspace",
      objectType: "Artifact"
    };

    let calls = 0;
    const res = await executeTransactionalLifecycle(
      powl,
      async (_t, { attempt }) => {
        calls += 1;
        if (attempt === 1) {
          // Dirty tracked + create untracked file before failing
          writeFileSync(join(repo, "tracked.txt"), "corrupted-partial-edit\n", "utf8");
          writeFileSync(join(repo, "orphan.tmp"), "leftover\n", "utf8");
          return { ok: false, retryable: true, errorSignature: "TRANSIENT_TIMEOUT", detail: "timed out" };
        }
        // On retry, verify workspace was cleanly rolled back first
        expect(readFileSync(join(repo, "tracked.txt"), "utf8")).toBe("initial-clean-state\n");
        expect(existsSync(join(repo, "orphan.tmp"))).toBe(false);
        writeFileSync(join(repo, "tracked.txt"), "final-committed-edit\n", "utf8");
        return { ok: true };
      },
      { workspaceDir: repo, maxRetriesPerSignature: 3 }
    );

    expect(calls).toBe(2);
    expect(res.ok).toBe(true);
    expect(res.standing).toBe("ALIVE");
    expect(res.rolledBackCount).toBe(1);
    expect(readFileSync(join(repo, "tracked.txt"), "utf8")).toBe("final-committed-edit\n");
    expect(res.events.some((e) => e.type === "workspace_rolled_back")).toBe(true);
  }, 25_000);

  test("refuses DIRTY_TIMEOUT_REFUSED when rollbackOnDirty is false and fails closed on .git/index.lock", async () => {
    const repo = makeTempDir("zcode-tx-dirty-");
    initGitWorkspace(repo);

    const powl: PowlNode = { kind: "activity", id: "step1", label: "step1", objectType: "Artifact" };

    const dirtyRes = await executeTransactionalLifecycle(
      powl,
      async () => {
        writeFileSync(join(repo, "tracked.txt"), "dirty-unrolled\n", "utf8");
        return { ok: false, retryable: true, errorSignature: "STEP_TIMEOUT" };
      },
      { workspaceDir: repo, rollbackOnDirty: false }
    );

    expect(dirtyRes.ok).toBe(false);
    expect(dirtyRes.refusalCode).toBe("DIRTY_TIMEOUT_REFUSED");
    expect(dirtyRes.standing).toBe("REFUSED");

    // Reset and place .git/index.lock
    execFileSync("git", ["checkout", "--", "tracked.txt"], { cwd: repo, stdio: "ignore", timeout: 15_000 });
    writeFileSync(join(repo, ".git", "index.lock"), "locked", "utf8");

    expect(() => captureWorkspaceSnapshot(repo)).toThrow(TransactionalRollbackError);
    const lockRes = await executeTransactionalLifecycle(
      powl,
      async () => ({ ok: true }),
      { workspaceDir: repo }
    );
    expect(lockRes.ok).toBe(false);
    expect(lockRes.refusalCode).toBe("ROLLBACK_FAILED");
    expect(lockRes.errorDetail).toContain("index.lock");
  }, 25_000);

  test("runAutonomicLoop enforces cross-cycle retry cap instead of looping indefinitely", async () => {
    const repo = makeTempDir("zcode-loop-tx-");
    initGitWorkspace(repo);

    const seed: PowlNode = { kind: "activity", id: "seed", label: "Seed", objectType: "Artifact" };

    // 1. Timeout + dirty rollback inside executePowlWithTokenReplay
    let attempts = 0;
    const singleRun = await executePowlWithTokenReplay(
      seed,
      async () => {
        attempts += 1;
        writeFileSync(join(repo, "tracked.txt"), `dirty-${attempts}\n`, "utf8");
        await new Promise((r) => setTimeout(r, 40));
        return { ok: true, exitCode: 0 };
      },
      { workspaceDir: repo, stepTimeoutMs: 10, maxRetriesPerSignature: 2 }
    );

    expect(singleRun.replay.soundTermination).toBe(false);
    expect(singleRun.refusalCode).toBe("RETRY_BUDGET_EXHAUSTED");
    expect(singleRun.rolledBackCount).toBe(3);
    expect(readFileSync(join(repo, "tracked.txt"), "utf8")).toBe("initial-clean-state\n");
    expect(singleRun.ocel.events.some((e) => e.type === "workspace_rolled_back")).toBe(true);
    expect(singleRun.ocel.events.some((e) => e.type === "retry_budget_exhausted")).toBe(true);

    // 2. Unbounded runAutonomicLoop (no maxCycles!) halts cleanly at RETRY_BUDGET_EXHAUSTED
    const loopCycles = await runAutonomicLoop(
      seed,
      async () => ({ ok: false, exitCode: 1, detail: "persistent_build_error" }),
      { maxRetriesPerSignature: 2 }
    );
    expect(loopCycles.length).toBe(3);
    expect(loopCycles.at(-1)!.refusalCode).toBe("RETRY_BUDGET_EXHAUSTED");
  }, 25_000);
});

describe("F13 Kingman Variance-Law Scheduler (Chicago)", () => {
  test("computeKingmanQueueEstimate captures divergence as rho -> 1 and peaks lambda_alive below saturation", () => {
    const low = computeKingmanQueueEstimate(0.3, 1.0, 12.0, 4000);
    const mid = computeKingmanQueueEstimate(0.65, 1.0, 12.0, 4000);
    const high = computeKingmanQueueEstimate(0.96, 1.0, 12.0, 4000);
    const sat = computeKingmanQueueEstimate(1.0, 1.0, 12.0, 4000);

    expect(low.recommendedMaxRho).toBeLessThan(1);
    expect(mid.expectedQueueWaitMs).toBeGreaterThan(low.expectedQueueWaitMs);
    expect(high.expectedQueueWaitMs).toBeGreaterThan(mid.expectedQueueWaitMs * 5);
    expect(high.lambdaAlivePerSec).toBeLessThan(mid.lambdaAlivePerSec);
    expect(sat.saturated).toBe(true);
    expect(sat.expectedQueueWaitMs).toBe(Number.POSITIVE_INFINITY);
    expect(sat.lambdaAlivePerSec).toBe(0);
  });

  test("KingmanScheduler & AimdWipController protect heavy-tailed coding turns while cutting WIP on TTFT/headroom/429", () => {
    const sched = new KingmanScheduler();
    const aimd = new AimdWipController();

    // Feed 25 turns: steady ttftMs ~ 105ms, heavy-tailed serviceMs (3500ms vs 120_000ms every 5th turn)
    for (let i = 1; i <= 25; i++) {
      const ttft = 100 + (i % 4) * 5;
      const service = i % 5 === 0 ? 120_000 : 3500;
      const d1 = sched.onSuccess(service, { ttftMs: ttft, rpmHeadroomRatio: 0.8, tpmHeadroomRatio: 0.75 });
      const d2 = aimd.onSuccess(service, { ttftMs: ttft, rpmHeadroomRatio: 0.8, tpmHeadroomRatio: 0.75 });
      expect(d1.ttftMdTriggered).toBe(false);
      expect(d2.ttftMdTriggered).toBe(false);
    }

    const snap = sched.getSnapshot();
    expect(snap.ttftMdTriggered).toBe(false);
    expect(snap.cs2).toBeGreaterThan(1.5);
    expect(snap.heavyTailedProtectedCount).toBeGreaterThan(0);
    expect(snap.wip).toBeGreaterThan(1);

    // Now inject TTFT spike (> 2x median ~105ms) -> triggers MD immediately
    const wipBeforeSpike = sched.wip;
    const spikeDecision = sched.onSuccess(3500, { ttftMs: 480 });
    expect(spikeDecision.ttftMdTriggered).toBe(true);
    expect(spikeDecision.reason).toBe("ttft_spike_md");
    expect(spikeDecision.newWip).toBe(Math.max(1, Math.floor(wipBeforeSpike * 0.5)));

    // Low RPM headroom also triggers MD without conflating into ttftMdTriggered
    const rpmWipBefore = sched.wip;
    const rpmDecision = sched.onSuccess(3500, { ttftMs: 105, rpmHeadroomRatio: 0.02 });
    expect(rpmDecision.ttftMdTriggered).toBe(false);
    expect(rpmDecision.reason).toBe("rpm_headroom_md");
    expect(rpmDecision.newWip).toBe(Math.max(1, Math.floor(rpmWipBefore * 0.5)));
  });

  test("regression F12: symlink safety on rollback (unlinks created & clobbering symlinks without overwriting external target) + clean git rollback counts", async () => {
    // 1. Non-git workspace: created dangling symlink is removed AND replaced-by-symlink does not overwrite external target
    const ws = makeTempDir("zcode-tx-symlink-");
    const externalDir = makeTempDir("zcode-tx-ext-");
    const victimFile = join(externalDir, "victim.txt");
    writeFileSync(victimFile, "DO_NOT_OVERWRITE", "utf8");
    writeFileSync(join(ws, "config.txt"), "original-config", "utf8");

    const powl: PowlNode = { kind: "activity", id: "sym_step", label: "SymStep", objectType: "Artifact" };
    let symAttempt = 0;
    const symRes = await executeTransactionalLifecycle(
      powl,
      async () => {
        symAttempt += 1;
        if (symAttempt === 1) {
          unlinkSync(join(ws, "config.txt"));
          symlinkSync(victimFile, join(ws, "config.txt"));
          symlinkSync(join(externalDir, "missing_target.txt"), join(ws, "dangling_link"));
          return { ok: false, retryable: true, errorSignature: "SYM_RETRY" };
        }
        expect(lstatSync(join(ws, "config.txt")).isSymbolicLink()).toBe(false);
        expect(readFileSync(join(ws, "config.txt"), "utf8")).toBe("original-config");
        expect(() => lstatSync(join(ws, "dangling_link"))).toThrow();
        return { ok: true };
      },
      { workspaceDir: ws, maxRetriesPerSignature: 2 }
    );

    expect(symRes.ok).toBe(true);
    expect(readFileSync(victimFile, "utf8")).toBe("DO_NOT_OVERWRITE");
    expect(lstatSync(join(ws, "config.txt")).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(ws, "config.txt"), "utf8")).toBe("original-config");
    const rbEv = symRes.events.find((e) => e.type === "workspace_rolled_back")!;
    expect(Number(rbEv.attributes.find((a) => a.name === "files_restored")!.value)).toBeGreaterThanOrEqual(1);
    expect(Number(rbEv.attributes.find((a) => a.name === "files_removed")!.value)).toBeGreaterThanOrEqual(1);

    // 2. Clean git workspace reports accurate files_restored and files_removed counts before git reset/clean
    const gitRepo = makeTempDir("zcode-tx-git-counts-");
    initGitWorkspace(gitRepo);
    mkdirSync(join(gitRepo, "sub"), { recursive: true });
    writeFileSync(join(gitRepo, "sub", "nested.txt"), "nested-initial\n", "utf8");
    execFileSync("git", ["add", "sub/nested.txt"], { cwd: gitRepo, stdio: "ignore", timeout: 15_000 });
    execFileSync("git", ["commit", "-m", "add nested"], { cwd: gitRepo, stdio: "ignore", timeout: 15_000 });

    let gitAttempt = 0;
    const gitRes = await executeTransactionalLifecycle(
      powl,
      async () => {
        gitAttempt += 1;
        if (gitAttempt === 1) {
          writeFileSync(join(gitRepo, "tracked.txt"), "mutated\n", "utf8");
          unlinkSync(join(gitRepo, "sub", "nested.txt"));
          mkdirSync(join(gitRepo, "untracked_dir"), { recursive: true });
          writeFileSync(join(gitRepo, "untracked_dir", "junk.txt"), "junk", "utf8");
          writeFileSync(join(gitRepo, "top_untracked.txt"), "top", "utf8");
          return { ok: false, retryable: true, errorSignature: "GIT_COUNT_RETRY" };
        }
        return { ok: true };
      },
      { workspaceDir: gitRepo, maxRetriesPerSignature: 2 }
    );

    expect(gitRes.ok).toBe(true);
    const gitRbEv = gitRes.events.find((e) => e.type === "workspace_rolled_back")!;
    expect(gitRbEv.attributes.find((a) => a.name === "files_restored")!.value).toBe("2");
    expect(gitRbEv.attributes.find((a) => a.name === "files_removed")!.value).toBe("2");
  }, 25_000);

  test("regression F12: runAutonomicLoop syncs ocelSha256 and disk files on cross-cycle RETRY_BUDGET_EXHAUSTED", async () => {
    const outDir = makeTempDir("zcode-loop-disk-sync-");
    const seed: PowlNode = { kind: "activity", id: "seed_sync", label: "SeedSync", objectType: "Artifact" };

    const cycles = await runAutonomicLoop(
      seed,
      async () => ({ ok: false, exitCode: 1, detail: "persistent_cross_cycle_failure" }),
      { maxRetriesPerSignature: 2, outputDir: outDir }
    );

    const last = cycles.at(-1)!;
    expect(last.refusalCode).toBe("RETRY_BUDGET_EXHAUSTED");
    expect(last.ocel.events.some((e) => e.type === "retry_budget_exhausted")).toBe(true);

    const expectedSha = createHash("sha256").update(JSON.stringify(last.ocel, null, 2)).digest("hex");
    expect(last.ocelSha256).toBe(expectedSha);

    const diskOcelRaw = readFileSync(join(outDir, "workflow.ocel.json"), "utf8");
    const diskOcel = JSON.parse(diskOcelRaw);
    expect(diskOcel.events.some((e: { type: string }) => e.type === "retry_budget_exhausted")).toBe(true);
    expect(createHash("sha256").update(diskOcelRaw).digest("hex")).toBe(last.ocelSha256);

    const diskReplay = JSON.parse(readFileSync(join(outDir, "replay-conformance.json"), "utf8"));
    expect(diskReplay.refusalCode).toBe("RETRY_BUDGET_EXHAUSTED");
    expect(diskReplay.ocelSha256).toBe(last.ocelSha256);
  });

  test("regression F13: KingmanScheduler avoids downward WIP cliff on heavy-tailed turn when WIP > kingmanCeiling", () => {
    const sched = new KingmanScheduler({ minWip: 1, maxWip: 64 });
    for (let i = 0; i < 30; i++) {
      sched.onSuccess(100, { ttftMs: 50, rpmHeadroomRatio: 0.9, tpmHeadroomRatio: 0.9, interArrivalMs: 200 });
    }
    const wipBeforeHeavyTurn = sched.wip;
    expect(wipBeforeHeavyTurn).toBeGreaterThan(20);

    const heavyDecision = sched.onSuccess(50_000, { ttftMs: 50, rpmHeadroomRatio: 0.9, tpmHeadroomRatio: 0.9, interArrivalMs: 100 });
    expect(heavyDecision.ttftMdTriggered).toBe(false);
    expect(heavyDecision.heavyTailedProtected).toBe(true);
    expect(heavyDecision.newWip).toBeGreaterThanOrEqual(wipBeforeHeavyTurn);
  });

  test("regression F12/F13: executePowlWithTokenReplay drains inFlight promises on haltedOnFailure so ocelSha256 and disk files are immutable", async () => {
    const outDir = makeTempDir("zcode-powl-inflight-drain-");
    const powl: PowlNode = {
      kind: "partial_order",
      id: "race_root",
      children: [
        { kind: "activity", id: "warm1", label: "Warm1", objectType: "Artifact" },
        { kind: "activity", id: "warm2", label: "Warm2", objectType: "Artifact" },
        { kind: "activity", id: "fast_fail", label: "FastFail", objectType: "Artifact" },
        { kind: "activity", id: "slow_ok", label: "SlowOk", objectType: "Artifact" }
      ],
      order: [
        ["warm1", "warm2"],
        ["warm2", "fast_fail"],
        ["warm2", "slow_ok"]
      ]
    };

    const res = await executePowlWithTokenReplay(
      powl,
      async (t) => {
        if (t.activityId === "fast_fail") {
          await new Promise((r) => setTimeout(r, 5));
          return { ok: false, exitCode: 1, detail: "fast_fail_triggered" };
        }
        if (t.activityId === "slow_ok") {
          await new Promise((r) => setTimeout(r, 80));
          return { ok: true, exitCode: 0 };
        }
        return { ok: true, exitCode: 0 };
      },
      { outputDir: outDir }
    );

    expect(res.equilibriumWip).toBeGreaterThanOrEqual(2);
    expect(res.replay.soundTermination).toBe(false);

    const eventsLenAtReturn = res.ocel.events.length;
    const shaAtReturn = res.ocelSha256;
    const expectedAtReturn = createHash("sha256").update(JSON.stringify(res.ocel, null, 2)).digest("hex");
    expect(shaAtReturn).toBe(expectedAtReturn);

    // Wait well past slow_ok completion window (80ms) and assert zero post-return mutation
    await new Promise((r) => setTimeout(r, 120));

    expect(res.ocel.events.length).toBe(eventsLenAtReturn);
    const expectedAfterWait = createHash("sha256").update(JSON.stringify(res.ocel, null, 2)).digest("hex");
    expect(expectedAfterWait).toBe(shaAtReturn);

    const diskOcelRaw = readFileSync(join(outDir, "workflow.ocel.json"), "utf8");
    expect(createHash("sha256").update(diskOcelRaw).digest("hex")).toBe(shaAtReturn);
    const diskReplay = JSON.parse(readFileSync(join(outDir, "replay-conformance.json"), "utf8"));
    expect(diskReplay.ocelSha256).toBe(shaAtReturn);
  });

  test("regression F12 (Probe 5 Case A): runAutonomicLoop honors errorSignature across varying per-cycle detail and syncs disk receipts on RETRY_BUDGET_EXHAUSTED", async () => {
    const outDir = makeTempDir("zcode-probe5-case-a-");
    const seed: PowlNode = { kind: "activity", id: "seed_sig", label: "SeedSig", objectType: "Artifact" };

    let cycleNum = 0;
    const cycles = await runAutonomicLoop(
      seed,
      async (t) => {
        cycleNum += 1;
        return {
          ok: false,
          exitCode: 1,
          errorSignature: "CANONICAL_TS_ERROR_2322",
          detail: `failed on ${t.id} at cycle ${cycleNum}`
        };
      },
      { maxRetriesPerSignature: 2, maxCycles: 8, outputDir: outDir }
    );

    expect(cycles.length).toBe(3);
    const last = cycles.at(-1)!;
    expect(last.refusalCode).toBe("RETRY_BUDGET_EXHAUSTED");

    const refusedEv = last.ocel.events.find((e) => e.type === "transition_refused")!;
    expect(refusedEv.attributes.find((a) => a.name === "signature")?.value).toBe("CANONICAL_TS_ERROR_2322");
    expect(refusedEv.attributes.find((a) => a.name === "detail")?.value).toMatch(
      /^failed on __powl_t_act_remediate-3-0_\d+ at cycle 3$/
    );

    const exhaustedEv = last.ocel.events.find((e) => e.type === "retry_budget_exhausted")!;
    expect(exhaustedEv.attributes.find((a) => a.name === "signature")?.value).toBe(
      "cycle_refusal:CANONICAL_TS_ERROR_2322"
    );

    const expectedSha = createHash("sha256").update(JSON.stringify(last.ocel, null, 2)).digest("hex");
    expect(last.ocelSha256).toBe(expectedSha);

    const diskOcelRaw = readFileSync(join(outDir, "workflow.ocel.json"), "utf8");
    expect(createHash("sha256").update(diskOcelRaw).digest("hex")).toBe(last.ocelSha256);
    const diskReplay = JSON.parse(readFileSync(join(outDir, "replay-conformance.json"), "utf8"));
    expect(diskReplay.refusalCode).toBe("RETRY_BUDGET_EXHAUSTED");
    expect(diskReplay.ocelSha256).toBe(last.ocelSha256);

    // Also verify throwOnRetryExhausted: true syncs disk files before throwing ComplianceRefusalError
    const outDirThrow = makeTempDir("zcode-probe5-case-a-throw-");
    let throwCycle = 0;
    let caught: unknown;
    try {
      await runAutonomicLoop(
        seed,
        async (t) => {
          throwCycle += 1;
          return {
            ok: false,
            exitCode: 1,
            errorSignature: "CANONICAL_TS_ERROR_2322",
            detail: `failed on ${t.id} at cycle ${throwCycle}`
          };
        },
        { maxRetriesPerSignature: 2, maxCycles: 8, outputDir: outDirThrow, throwOnRetryExhausted: true }
      );
    } catch (err) {
      caught = err;
    }
    expect(throwCycle).toBe(3);
    expect(caught).toBeInstanceOf(ComplianceRefusalError);
    expect((caught as ComplianceRefusalError).code).toBe("RETRY_BUDGET_EXHAUSTED");
    const throwDiskOcelRaw = readFileSync(join(outDirThrow, "workflow.ocel.json"), "utf8");
    const throwDiskReplay = JSON.parse(readFileSync(join(outDirThrow, "replay-conformance.json"), "utf8"));
    expect(throwDiskReplay.refusalCode).toBe("RETRY_BUDGET_EXHAUSTED");
    expect(createHash("sha256").update(throwDiskOcelRaw).digest("hex")).toBe(throwDiskReplay.ocelSha256);
  });

  test("regression F12 (Probe 5 Case B): distinct thrown errors retain separate budgets while identical thrown errors exhaust at cap", async () => {
    const seed: PowlNode = { kind: "activity", id: "seed_throw", label: "SeedThrow", objectType: "Artifact" };
    const distinctErrs = ["ENOENT_MISSING_A", "EACCES_DENIED_B", "ETIMEDOUT_C", "EPERM_D"];

    let distinctIdx = 0;
    const distinctCycles = await runAutonomicLoop(
      seed,
      async () => {
        const msg = distinctErrs[distinctIdx]!;
        distinctIdx += 1;
        throw new Error(msg);
      },
      { maxRetriesPerSignature: 1, maxCycles: 4 }
    );

    expect(distinctCycles.length).toBe(4);
    for (let i = 0; i < 4; i++) {
      expect(distinctCycles[i]!.refusalCode).toBeUndefined();
      const refusedEv = distinctCycles[i]!.ocel.events.find((e) => e.type === "transition_refused")!;
      expect(refusedEv.attributes.find((a) => a.name === "detail")?.value).toBe("step_exception");
      expect(refusedEv.attributes.find((a) => a.name === "signature")?.value).toBe(distinctErrs[i]);
    }

    // Identical thrown error twice across cycles with maxRetriesPerSignature: 1 halts at cycle 2
    let sameCalls = 0;
    const sameOutDir = makeTempDir("zcode-probe5-case-b-same-");
    const sameCycles = await runAutonomicLoop(
      seed,
      async () => {
        sameCalls += 1;
        throw new Error("ENOENT_MISSING_A");
      },
      { maxRetriesPerSignature: 1, maxCycles: 4, outputDir: sameOutDir }
    );

    expect(sameCalls).toBe(2);
    expect(sameCycles.length).toBe(2);
    const lastSame = sameCycles.at(-1)!;
    expect(lastSame.refusalCode).toBe("RETRY_BUDGET_EXHAUSTED");
    const sameDiskOcelRaw = readFileSync(join(sameOutDir, "workflow.ocel.json"), "utf8");
    const sameDiskReplay = JSON.parse(readFileSync(join(sameOutDir, "replay-conformance.json"), "utf8"));
    expect(sameDiskReplay.refusalCode).toBe("RETRY_BUDGET_EXHAUSTED");
    expect(createHash("sha256").update(sameDiskOcelRaw).digest("hex")).toBe(sameDiskReplay.ocelSha256);
    expect(lastSame.ocelSha256).toBe(sameDiskReplay.ocelSha256);
  });

  test("ERRC 08-Kingman: multi-server G/G/c Sakasegawa/Allen-Cunneen wait estimator and scheduler wip-server binding", () => {
    const rho = 0.75;
    const ca2 = 1.4;
    const cs2 = 2.6;
    const meanServiceMs = 1000;

    // servers = 1 reduces identically to G/G/1 Kingman
    const gg1Default = computeKingmanQueueEstimate(rho, ca2, cs2, meanServiceMs);
    const gg1Explicit = computeKingmanQueueEstimate(rho, ca2, cs2, meanServiceMs, 1.5, 1);
    expect(gg1Explicit.utilizationFactor).toBeCloseTo(rho / (1 - rho), 10);
    expect(gg1Explicit.expectedQueueWaitMs).toBeCloseTo(gg1Default.expectedQueueWaitMs, 10);

    // servers = 4 uses Sakasegawa/Allen-Cunneen G/G/c formula
    const c = 4;
    const ggc = computeKingmanQueueEstimate(rho, ca2, cs2, meanServiceMs, 1.5, c);
    const expectedUtilFactor = Math.pow(rho, Math.sqrt(2 * (c + 1)) - 1) / (c * (1 - rho));
    const expectedWaitMs = expectedUtilFactor * ((ca2 + cs2) / 2) * meanServiceMs;
    expect(ggc.utilizationFactor).toBeCloseTo(expectedUtilFactor, 10);
    expect(ggc.expectedQueueWaitMs).toBeCloseTo(expectedWaitMs, 10);
    expect(ggc.expectedQueueWaitMs).toBeLessThan(gg1Explicit.expectedQueueWaitMs);

    // KingmanScheduler.currentEstimate() passes Math.max(1, this.wip) as servers
    const sched = new KingmanScheduler({ minWip: 1, maxWip: 16, useWallClockFallback: false });
    for (let i = 0; i < 6; i++) {
      sched.onSuccess(80, { ttftMs: 50, interArrivalMs: 100 });
    }
    const snap = sched.getSnapshot();
    expect(snap.wip).toBeGreaterThan(1);
    const expectedFromWip = computeKingmanQueueEstimate(
      snap.rho,
      snap.ca2,
      snap.cs2,
      snap.meanServiceMs,
      1.5,
      snap.wip
    );
    expect(snap.estimate.expectedQueueWaitMs).toBeCloseTo(expectedFromWip.expectedQueueWaitMs, 10);
  });

  test("ERRC 08-Kingman: kingmanCeiling triggers on combined variabilityFactor > 1.25 even when cs2 === 0 (bursty arrivals)", () => {
    const sched = new KingmanScheduler({ minWip: 1, maxWip: 64, useWallClockFallback: false });
    // Constant service time (cs2 === 0), highly bursty inter-arrival times (ca2 >> 2.5 => variabilityFactor > 1.25)
    for (let i = 0; i < 40; i++) {
      const interArrivalMs = i % 10 === 0 ? 10_000 : 10;
      sched.onSuccess(100, { ttftMs: 40, interArrivalMs });
    }
    const snap = sched.getSnapshot();
    expect(snap.cs2).toBe(0);
    expect(snap.ca2).toBeGreaterThan(2.5);
    expect(snap.estimate.variabilityFactor).toBeGreaterThan(1.25);
    // WIP must be capped well below maxWip (64) by kingmanCeiling
    expect(snap.wip).toBeLessThan(40);
  });

  test("ERRC 08-Kingman (ELIMINATE): AimdWipController respects maxWip and kingmanCeiling even when transport telemetry is absent", () => {
    const aimdCapped = new AimdWipController({ minWip: 1, maxWip: 3, useWallClockFallback: false });
    for (let i = 0; i < 10; i++) {
      aimdCapped.onSuccess(100);
    }
    expect(aimdCapped.wip).toBe(3);
    expect(aimdCapped.peakEquilibriumWip).toBe(3);
    expect(aimdCapped.getKingmanSnapshot().wip).toBe(3);

    // High service-time variability without transport telemetry must still respect kingmanCeiling
    const aimdHeavy = new AimdWipController({ minWip: 1, maxWip: 64, useWallClockFallback: false });
    for (let i = 0; i < 40; i++) {
      const svc = i % 10 === 0 ? 10_000 : 10;
      aimdHeavy.onSuccess(svc);
    }
    const snap = aimdHeavy.getKingmanSnapshot();
    expect(snap.estimate.variabilityFactor).toBeGreaterThan(1.25);
    expect(snap.wip).toBeLessThan(40);
    expect(aimdHeavy.peakEquilibriumWip).toBeLessThan(40);
  });

  test("ERRC 08-Kingman (RAISE): executePowlWithTokenReplay feeds true start-to-start interArrivalMs into KingmanScheduler", async () => {
    // 4 concurrent activities dispatched in a single burst (start delta ~0ms) followed by a delayed activity
    const root: PowlNode = {
      kind: "partial_order",
      id: "po_interarrival",
      children: [
        { kind: "activity", id: "a1", label: "A1", objectType: "Artifact" },
        { kind: "activity", id: "a2", label: "A2", objectType: "Artifact" },
        { kind: "activity", id: "a3", label: "A3", objectType: "Artifact" },
        { kind: "activity", id: "a4", label: "A4", objectType: "Artifact" }
      ],
      order: [
        ["a1", "a2"],
        ["a2", "a3"],
        ["a3", "a4"]
      ]
    };
    const delays: Record<string, number> = { a1: 5, a2: 5, a3: 40, a4: 5 };
    const result = await executePowlWithTokenReplay(root, async (t) => {
      const ms = delays[t.activityId ?? ""] ?? 5;
      await new Promise((r) => setTimeout(r, ms));
      return { ok: true, exitCode: 0 };
    });

    expect(result.replay.fitness).toBe(1);
    expect(Number.isFinite(result.kingman.ca2)).toBe(true);
    expect(result.kingman.ca2).toBeGreaterThanOrEqual(0);
    expect(result.kingman.rho).toBeGreaterThan(0);
    expect(result.kingman.rho).toBeLessThanOrEqual(0.99);
  });

  test("ERRC 08-Kingman (REDUCE): workspaceDir serializes AimdWipController to WIP=1 with no phantom WIP drift", async () => {
    const wsDir = makeTempDir("zcode-kingman-ws-wip1-");
    initGitWorkspace(wsDir);

    const root: PowlNode = {
      kind: "partial_order",
      id: "po_ws_serial",
      children: [
        { kind: "activity", id: "s1", label: "S1", objectType: "Artifact" },
        { kind: "activity", id: "s2", label: "S2", objectType: "Artifact" },
        { kind: "activity", id: "s3", label: "S3", objectType: "Artifact" },
        { kind: "activity", id: "s4", label: "S4", objectType: "Artifact" }
      ],
      order: []
    };

    const result = await executePowlWithTokenReplay(
      root,
      async () => ({ ok: true, exitCode: 0 }),
      { workspaceDir: wsDir }
    );

    expect(result.replay.fitness).toBe(1);
    expect(result.equilibriumWip).toBe(1);
    expect(result.kingman.wip).toBe(1);
    expect(result.kingman.peakEquilibriumWip).toBe(1);
    for (const ev of result.ocel.events) {
      if (ev.type === "transition_fired" || ev.type === "transition_completed") {
        const wipAttr = ev.attributes.find((a) => a.name === "wip");
        expect(wipAttr?.value).toBe("1");
      }
    }
  });

  test("regression V11-Kingman-WIP (Gap 1): true overload rho >= 1 surfaces saturated=true and holds WIP instead of AI", () => {
    const sched = new KingmanScheduler({ maxWip: 16, useWallClockFallback: false });
    for (let i = 0; i < 10; i++) {
      const dec = sched.onSuccess(1000, { interArrivalMs: 10 });
      expect(dec.reason).toBe("saturated_hold");
      expect(dec.changed).toBe(false);
      expect(dec.estimate.saturated).toBe(true);
    }
    const snap = sched.getSnapshot();
    expect(snap.estimate.saturated).toBe(true);
    expect(snap.rho).toBeGreaterThan(1);
    expect(snap.estimate.expectedQueueWaitMs).toBe(Number.POSITIVE_INFINITY);
    expect(snap.estimate.lambdaAlivePerSec).toBe(0);
    expect(snap.wip).toBe(1);
  });

  test("regression V11-Kingman-WIP (Gap 2): zero-delta interArrivalMs is ignored online and matches offline analyzeOcelKingmanMetrics", () => {
    const sched = new KingmanScheduler({ maxWip: 16, useWallClockFallback: false });
    // Simulate 4 concurrent forks at t=0 (0ms deltas) followed by spaced arrivals
    const baseMs = Date.parse("2026-11-21T00:00:00.000Z");
    const timestamps = [0, 0, 0, 0, 200, 500, 900];
    const events = timestamps.map((offset, idx) => ({
      id: `e${idx}`,
      type: "transition_completed",
      time: new Date(baseMs + offset).toISOString(),
      attributes: [{ name: "service_ms", value: "50" }],
      relationships: []
    }));

    for (let i = 0; i < timestamps.length; i++) {
      const delta = i === 0 ? undefined : timestamps[i]! - timestamps[i - 1]!;
      sched.onSuccess(50, { interArrivalMs: delta });
    }

    const online = sched.getSnapshot();
    const offline = analyzeOcelKingmanMetrics({ events, objects: [] }, { maxWip: 16 });
    expect(online.ca2).toBeCloseTo(offline.ca2, 10);
    expect(online.rho).toBeCloseTo(offline.rho, 10);
    expect(online.wip).toBe(offline.wip);
    expect(online.ca2).toBeGreaterThan(0);
  });

  test("regression V11-Kingman-WIP (Gap 3): RPM/TPM headroom and transport timeout MD do not set ttftMdTriggered", () => {
    const sched = new KingmanScheduler({ maxWip: 16, useWallClockFallback: false });
    // Warm up WIP > 4 with healthy TTFT
    for (let i = 0; i < 8; i++) {
      sched.onSuccess(50, { ttftMs: 50, rpmHeadroomRatio: 0.9, tpmHeadroomRatio: 0.9, interArrivalMs: 200 });
    }
    expect(sched.wip).toBeGreaterThan(4);

    const rpmDec = sched.onSuccess(50, { ttftMs: 50, rpmHeadroomRatio: 0.01 });
    expect(rpmDec.reason).toBe("rpm_headroom_md");
    expect(rpmDec.ttftMdTriggered).toBe(false);
    expect(sched.getSnapshot().ttftMdTriggered).toBe(false);
    expect(sched.getSnapshot().mdCount).toBe(1);

    const tpmDec = sched.onSuccess(50, { ttftMs: 50, tpmHeadroomRatio: 0.01 });
    expect(tpmDec.reason).toBe("tpm_headroom_md");
    expect(tpmDec.ttftMdTriggered).toBe(false);
    expect(sched.getSnapshot().ttftMdTriggered).toBe(false);
    expect(sched.getSnapshot().mdCount).toBe(2);

    const timeoutDec = sched.onTransportBackpressure();
    expect(timeoutDec.reason).toBe("transport_timeout_md");
    expect(timeoutDec.ttftMdTriggered).toBe(false);
    expect(sched.getSnapshot().ttftMdTriggered).toBe(false);
    expect(sched.getSnapshot().mdCount).toBe(3);
  });
});
