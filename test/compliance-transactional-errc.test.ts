import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkflowNetJson } from "../src/compliance/conformance.ts";
import {
  captureWorkspaceSnapshot,
  executeTransactionalLifecycle
} from "../src/compliance/transactional-net.ts";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function initCleanGitRepo(dir: string): void {
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: dir });
  writeFileSync(join(dir, "tracked.txt"), "initial-content\n", "utf8");
  execFileSync("git", ["add", "tracked.txt"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("07-Transactional-Nets ERRC improvements", () => {
  test("RAISE: drainSilent detects silent cycles and returns BLOCKED (SILENT_CYCLE_DETECTED) without hanging", async () => {
    const cyclicNet: WorkflowNetJson = {
      places: [{ id: "p_start" }, { id: "p_mid" }, { id: "p_end" }],
      transitions: [
        { id: "tau_1", label: "tau_1", silent: true },
        { id: "tau_2", label: "tau_2", silent: true },
        { id: "t_done", label: "t_done", activityId: "done", silent: false }
      ],
      pre: {
        tau_1: ["p_start"],
        tau_2: ["p_mid"],
        t_done: ["p_mid"]
      },
      post: {
        tau_1: ["p_mid"],
        tau_2: ["p_start"],
        t_done: ["p_end"]
      },
      sourcePlace: "p_start",
      sinkPlace: "p_end"
    };

    const res = await executeTransactionalLifecycle(
      cyclicNet,
      { done: async () => ({ ok: true }) },
      { maxWallClockMs: 5_000 }
    );

    expect(res.ok).toBe(false);
    expect(res.standing).toBe("BLOCKED");
    expect(res.refusalCode).toBe("SILENT_CYCLE_DETECTED");
    expect(res.events.some((e) => e.type === "transition_refused")).toBe(true);
  });

  test("RAISE: Petri-net token conservation is preserved on STEP_REFUSED and RETRY_BUDGET_EXHAUSTED", async () => {
    const seqNet: WorkflowNetJson = {
      places: [{ id: "p0" }, { id: "p1" }, { id: "p2" }],
      transitions: [
        { id: "t_a", label: "A", activityId: "A", silent: false },
        { id: "t_b", label: "B", activityId: "B", silent: false }
      ],
      pre: {
        t_a: ["p0"],
        t_b: ["p1"]
      },
      post: {
        t_a: ["p1"],
        t_b: ["p2"]
      },
      sourcePlace: "p0",
      sinkPlace: "p2"
    };

    // Case 1: STEP_REFUSED on B -> token must remain in p1
    const refused = await executeTransactionalLifecycle(seqNet, {
      A: async () => ({ ok: true }),
      B: async () => ({ ok: false, retryable: false, detail: "hard refusal" })
    });
    expect(refused.ok).toBe(false);
    expect(refused.refusalCode).toBe("STEP_REFUSED");
    expect(refused.finalMarking).toEqual({ p1: 1 });

    // Case 2: RETRY_BUDGET_EXHAUSTED on B -> token must remain in p1
    const exhausted = await executeTransactionalLifecycle(
      seqNet,
      {
        A: async () => ({ ok: true }),
        B: async () => ({ ok: false, retryable: true, errorSignature: "same_err", detail: "flaky" })
      },
      { maxRetriesPerSignature: 1 }
    );
    expect(exhausted.ok).toBe(false);
    expect(exhausted.refusalCode).toBe("RETRY_BUDGET_EXHAUSTED");
    expect(exhausted.finalMarking).toEqual({ p1: 1 });
  });

  test("CREATE: Saga-style cross-step compensation unwinds committed steps in LIFO order and emits transition_compensated", async () => {
    const net: WorkflowNetJson = {
      places: [{ id: "p0" }, { id: "p1" }, { id: "p2" }, { id: "p3" }],
      transitions: [
        { id: "t_a", label: "A", activityId: "A", silent: false },
        { id: "t_b", label: "B", activityId: "B", silent: false },
        { id: "t_c", label: "C", activityId: "C", silent: false }
      ],
      pre: {
        t_a: ["p0"],
        t_b: ["p1"],
        t_c: ["p2"]
      },
      post: {
        t_a: ["p1"],
        t_b: ["p2"],
        t_c: ["p3"]
      },
      sourcePlace: "p0",
      sinkPlace: "p3"
    };

    const compensationOrder: string[] = [];
    const res = await executeTransactionalLifecycle(net, {
      A: {
        run: async () => ({ ok: true }),
        compensate: async (t, ctx) => {
          compensationOrder.push(`${t.id}:${ctx.reason}`);
        }
      },
      B: {
        run: async () => ({ ok: true }),
        compensate: async (t, ctx) => {
          compensationOrder.push(`${t.id}:${ctx.reason}`);
        }
      },
      C: {
        run: async () => ({ ok: false, retryable: false, detail: "downstream boom" })
      }
    });

    expect(res.ok).toBe(false);
    expect(res.refusalCode).toBe("STEP_REFUSED");
    expect(res.compensatedCount).toBe(2);
    expect(compensationOrder).toEqual(["t_b:STEP_REFUSED", "t_a:STEP_REFUSED"]);

    const compEvents = res.events.filter((e) => e.type === "transition_compensated");
    expect(compEvents.length).toBe(2);
    expect(compEvents[0]!.attributes.find((a) => a.name === "transition")?.value).toBe("t_b");
    expect(compEvents[1]!.attributes.find((a) => a.name === "transition")?.value).toBe("t_a");
  });

  test("CREATE: lifecycleSavepoint rolls back workspace mutations from earlier committed steps on terminal failure", async () => {
    const ws = makeTempDir("zcode-tx-saga-ws-");
    writeFileSync(join(ws, "base.txt"), "v0\n", "utf8");

    const net: WorkflowNetJson = {
      places: [{ id: "p0" }, { id: "p1" }, { id: "p2" }],
      transitions: [
        { id: "t_a", label: "A", activityId: "A", silent: false },
        { id: "t_b", label: "B", activityId: "B", silent: false }
      ],
      pre: {
        t_a: ["p0"],
        t_b: ["p1"]
      },
      post: {
        t_a: ["p1"],
        t_b: ["p2"]
      },
      sourcePlace: "p0",
      sinkPlace: "p2"
    };

    const res = await executeTransactionalLifecycle(
      net,
      {
        A: async () => {
          writeFileSync(join(ws, "base.txt"), "v1-from-A\n", "utf8");
          writeFileSync(join(ws, "from-a.txt"), "created\n", "utf8");
          return { ok: true };
        },
        B: async () => ({ ok: false, retryable: false, detail: "B failed" })
      },
      { workspaceDir: ws, lifecycleSavepoint: true }
    );

    expect(res.ok).toBe(false);
    expect(readFileSync(join(ws, "base.txt"), "utf8")).toBe("v0\n");
    expect(existsSync(join(ws, "from-a.txt"))).toBe(false);
  });

  test("REDUCE: clean git snapshot skips tmpdir backup copy and supports configurable ignorePatterns", () => {
    const repo = makeTempDir("zcode-tx-git-opt-");
    initCleanGitRepo(repo);

    // Create ignored files/dirs before snapshot
    mkdirSync(join(repo, "dist"), { recursive: true });
    writeFileSync(join(repo, "dist", "bundle.js"), "console.log(1);\n", "utf8");
    writeFileSync(join(repo, "debug.log"), "log-line\n", "utf8");
    // Ignore them in git too so repo stays clean
    writeFileSync(join(repo, ".gitignore"), "dist/\n*.log\n", "utf8");
    execFileSync("git", ["add", ".gitignore"], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "ignore dist and logs"], { cwd: repo });

    const snap = captureWorkspaceSnapshot(repo, { ignorePatterns: ["dist", "*.log"] });
    try {
      expect(snap.isGit).toBe(true);
      expect(snap.wasCleanBefore).toBe(true);
      expect(snap.headSha).toBeTruthy();
      // Clean git skips tmpdir full copy
      expect(snap.backupDir).toBe("");
      // Ignored patterns are excluded from manifest
      expect(snap.manifest.has("dist/bundle.js")).toBe(false);
      expect(snap.manifest.has("debug.log")).toBe(false);
      expect(snap.manifest.has("tracked.txt")).toBe(true);

      // Mutating an ignored file does not mark snapshot dirty
      writeFileSync(join(repo, "debug.log"), "updated-log\n", "utf8");
      expect(snap.isDirty()).toBe(false);

      // Mutating tracked file + adding untracked file marks dirty and rolls back cleanly via git
      writeFileSync(join(repo, "tracked.txt"), "mutated\n", "utf8");
      writeFileSync(join(repo, "untracked.txt"), "junk\n", "utf8");
      expect(snap.isDirty()).toBe(true);

      const rb = snap.rollback("test_clean_git", "step_1", true);
      expect(rb.rolledBack).toBe(true);
      expect(rb.filesRestored).toBe(1);
      expect(rb.filesRemoved).toBe(1);
      expect(readFileSync(join(repo, "tracked.txt"), "utf8")).toBe("initial-content\n");
      expect(existsSync(join(repo, "untracked.txt"))).toBe(false);
    } finally {
      snap.dispose();
    }
  });

  test("ELIMINATE: unsettled timed-out step fails closed with ROLLBACK_FAILED without racing snap.rollback()", async () => {
    const ws = makeTempDir("zcode-tx-race-");
    writeFileSync(join(ws, "state.txt"), "original\n", "utf8");

    const net: WorkflowNetJson = {
      places: [{ id: "p0" }, { id: "p1" }],
      transitions: [{ id: "t_hang", label: "hang", activityId: "hang", silent: false }],
      pre: { t_hang: ["p0"] },
      post: { t_hang: ["p1"] },
      sourcePlace: "p0",
      sinkPlace: "p1"
    };

    let releaseHung: (() => void) | undefined;
    const res = await executeTransactionalLifecycle(
      net,
      {
        hang: {
          timeoutMs: 30,
          abortGraceMs: 40,
          run: async () => {
            // Ignores AbortSignal and does not settle within abortGraceMs
            writeFileSync(join(ws, "state.txt"), "in-progress-write\n", "utf8");
            await new Promise<void>((resolve) => {
              releaseHung = resolve;
            });
            return { ok: true };
          }
        }
      },
      { workspaceDir: ws }
    );

    releaseHung?.();

    expect(res.ok).toBe(false);
    expect(res.standing).toBe("REFUSED");
    expect(res.refusalCode).toBe("ROLLBACK_FAILED");
    // Rollback was NOT executed while promise was unsettled
    expect(res.rolledBackCount).toBe(0);
    // Token conserved
    expect(res.finalMarking).toEqual({ p0: 1 });
  });

  test("ELIMINATE: cooperative timed-out step that settles within abortGraceMs rolls back and retries cleanly", async () => {
    const ws = makeTempDir("zcode-tx-coop-");
    writeFileSync(join(ws, "state.txt"), "original\n", "utf8");

    const net: WorkflowNetJson = {
      places: [{ id: "p0" }, { id: "p1" }],
      transitions: [{ id: "t_coop", label: "coop", activityId: "coop", silent: false }],
      pre: { t_coop: ["p0"] },
      post: { t_coop: ["p1"] },
      sourcePlace: "p0",
      sinkPlace: "p1"
    };

    const res = await executeTransactionalLifecycle(
      net,
      {
        coop: {
          timeoutMs: 30,
          abortGraceMs: 200,
          run: async (_t, ctx) => {
            if (ctx.attempt === 1) {
              writeFileSync(join(ws, "state.txt"), "dirty-attempt-1\n", "utf8");
              await new Promise<void>((resolve) => {
                ctx.signal.addEventListener("abort", () => resolve(), { once: true });
              });
              return { ok: false, detail: "aborted" };
            }
            expect(readFileSync(join(ws, "state.txt"), "utf8")).toBe("original\n");
            writeFileSync(join(ws, "state.txt"), "committed-attempt-2\n", "utf8");
            return { ok: true };
          }
        }
      },
      { workspaceDir: ws }
    );

    expect(res.ok).toBe(true);
    expect(res.standing).toBe("ALIVE");
    expect(res.rolledBackCount).toBe(1);
    expect(readFileSync(join(ws, "state.txt"), "utf8")).toBe("committed-attempt-2\n");
  });
});
