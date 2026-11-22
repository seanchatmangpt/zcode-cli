/**
 * Zero-mock regression tests for v27.1.1 V19-Receipt-Sink hardening:
 * 1. Byte-identical deterministic replay for loop_receipt.json, ledger.jsonl, and ALOOP v2 receipt.
 * 2. Production Chatman-5 / ALOOP v2 receipt writer admitted by ~/.zcode/dfcm/validate_receipt.py.
 * 3. Anti-vacuity: ALIVE with non-zero replay exit fail-closes to REFUSED(nonzero_replay_exit).
 * 4. Fail-closed R_missing_identity when git HEAD cannot be resolved.
 * 5. Backward compatibility: stub mode without aloop provenance still emits zcode.dfcm.receipt/1.
 */

import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import {
  ReceiptSink,
  isDfcmStubNonAdmit,
  type CycleCloseInput
} from "../src/adapters/receipt-sink.ts";

function initTempGitRepo(): { dir: string; head: string } {
  const dir = mkdtempSync(join(tmpdir(), "v27-receipt-sink-"));
  writeFileSync(join(dir, "README.md"), "v27 receipt sink test\n");
  const gitOpts = { cwd: dir, timeout: 15_000 };
  execFileSync("git", ["init"], gitOpts);
  execFileSync("git", ["config", "user.email", "v27@local"], gitOpts);
  execFileSync("git", ["config", "user.name", "V27"], gitOpts);
  execFileSync("git", ["add", "-A"], gitOpts);
  execFileSync("git", ["commit", "-m", "init"], gitOpts);
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: dir,
    encoding: "utf8"
  }).trim();
  return { dir, head };
}

describe("V19-Receipt-Sink v27.1.1 hardening", () => {
  test("closeCycle produces byte-identical loop_receipt.json, ledger.jsonl, and ALOOP v2 receipt on identical inputs", () => {
    const { dir, head } = initTempGitRepo();
    try {
      const input: CycleCloseInput = {
        cycleId: "cycle-det-1",
        startedAt: "2026-11-21T00:00:00.000Z",
        receipts: [
          {
            cycleId: "cycle-det-1",
            workOrderId: "WO-V27-DET-1",
            outcome: "ALIVE",
            standing: "ALIVE",
            sha256Receipt: "a".repeat(64),
            baseSha: head
          }
        ],
        aloop: {
          workOrderId: "WO-V27-DET-1",
          originAuthority: {
            ceiling: "CONSTRUCT",
            grant: "lease-v27-det",
            actor: "zcode-cli-construct"
          },
          provider: {
            name: "zcode-cli",
            transport: "local",
            authorityCeiling: "CONSTRUCT"
          },
          providerExecutionId: "exec-det-001",
          filesChanged: ["src/adapters/receipt-sink.ts"],
          replayCommands: [
            {
              cmd: `git rev-parse --verify ${head}`,
              exit: 0,
              cwd: dir
            }
          ],
          durableLocation: "receipts/v27/det-001.json",
          providerExt: { cycle: "cycle-det-1" }
        }
      };

      const run1Dir = join(dir, "run1");
      const run2Dir = join(dir, "run2");

      const sink1 = new ReceiptSink({
        ledgerPath: join(run1Dir, "ledger.jsonl"),
        outDir: join(run1Dir, "out"),
        dfcmReceiptPath: join(run1Dir, "aloop-v2.json"),
        cwd: dir
      });
      const sink2 = new ReceiptSink({
        ledgerPath: join(run2Dir, "ledger.jsonl"),
        outDir: join(run2Dir, "out"),
        dfcmReceiptPath: join(run2Dir, "aloop-v2.json"),
        cwd: dir
      });

      const res1 = sink1.closeCycle(input);
      const res2 = sink2.closeCycle(input);

      expect(readFileSync(res1.loopReceiptPath, "utf8")).toBe(
        readFileSync(res2.loopReceiptPath, "utf8")
      );
      expect(readFileSync(res1.ledgerPath, "utf8")).toBe(
        readFileSync(res2.ledgerPath, "utf8")
      );
      expect(readFileSync(res1.dfcmPath!, "utf8")).toBe(
        readFileSync(res2.dfcmPath!, "utf8")
      );

      const loopObj = JSON.parse(readFileSync(res1.loopReceiptPath, "utf8")) as {
        startedAt: string;
        finishedAt: string;
      };
      expect(loopObj.finishedAt).toBe(input.startedAt);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("writeAloopV2Receipt emits a Chatman-5 / ALOOP v2 receipt ADMITTED by ~/.zcode/dfcm/validate_receipt.py", () => {
    const { dir, head } = initTempGitRepo();
    try {
      const dfcmPath = join(dir, "out", "aloop-v2.json");
      const sink = new ReceiptSink({
        ledgerPath: join(dir, "ledger.jsonl"),
        outDir: join(dir, "out"),
        dfcmReceiptPath: dfcmPath,
        cwd: dir
      });

      const res = sink.closeCycle({
        cycleId: "cycle-v2-admit",
        startedAt: "2026-11-21T01:00:00.000Z",
        finishedAt: "2026-11-21T01:00:05.000Z",
        receipts: [
          {
            cycleId: "cycle-v2-admit",
            workOrderId: "WO-V27-ADMIT-1",
            outcome: "ALIVE",
            standing: "ALIVE",
            sha256Receipt: "b".repeat(64),
            baseSha: head
          }
        ],
        aloop: {
          workOrderId: "WO-V27-ADMIT-1",
          originAuthority: {
            ceiling: "CONSTRUCT",
            grant: "lease-v27-admit",
            actor: "zcode-cli-construct"
          },
          provider: {
            name: "zcode-cli",
            transport: "local",
            authorityCeiling: "CONSTRUCT"
          },
          providerExecutionId: "exec-admit-001",
          filesChanged: ["src/adapters/receipt-sink.ts"],
          replayCommands: [
            {
              cmd: `git rev-parse --verify ${head}`,
              exit: 0,
              cwd: dir
            }
          ],
          providerExt: {
            suite: "receipt-sink-v27"
          }
        }
      });

      expect(res.aggregateStanding).toBe("ALIVE");
      expect(res.exitCode).toBe(0);
      expect(res.dfcmPath).toBe(dfcmPath);

      const emitted = JSON.parse(readFileSync(dfcmPath, "utf8")) as Record<string, unknown>;
      expect(isDfcmStubNonAdmit(emitted)).toBe(false);
      expect(emitted.work_order_id).toBe("WO-V27-ADMIT-1");
      expect(emitted.provider_execution_id).toBe("exec-admit-001");
      expect((emitted.identity as Record<string, unknown>).subject_sha).toBe(head);
      expect((emitted.standing as Record<string, unknown>).value).toBe("ALIVE");
      expect(emitted["provider_ext.zcode-cli"]).toEqual({ suite: "receipt-sink-v27" });

      const validatorPath = join(homedir(), ".zcode", "dfcm", "validate_receipt.py");
      expect(existsSync(validatorPath)).toBe(true);
      const v = spawnSync("python3", [validatorPath, dfcmPath], {
        cwd: dir,
        encoding: "utf8",
        timeout: 15_000
      });
      expect(v.status).toBe(0);
      expect(v.stdout).toContain("ADMITTED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("anti-vacuity: ALIVE with non-zero replay exit fail-closes to REFUSED(nonzero_replay_exit) and passes validator", () => {
    const { dir, head } = initTempGitRepo();
    try {
      const dfcmPath = join(dir, "out", "aloop-v2-refused.json");
      const sink = new ReceiptSink({
        ledgerPath: join(dir, "ledger.jsonl"),
        outDir: join(dir, "out"),
        dfcmReceiptPath: dfcmPath,
        cwd: dir
      });

      sink.closeCycle({
        cycleId: "cycle-v2-vacuity",
        startedAt: "2026-11-21T02:00:00.000Z",
        receipts: [
          {
            cycleId: "cycle-v2-vacuity",
            workOrderId: "WO-V27-VACUITY",
            outcome: "ALIVE",
            standing: "ALIVE",
            sha256Receipt: "c".repeat(64),
            baseSha: head
          }
        ],
        aloop: {
          workOrderId: "WO-V27-VACUITY",
          originAuthority: {
            ceiling: "CONSTRUCT",
            grant: "lease-v27-vacuity",
            actor: "zcode-cli-construct"
          },
          provider: {
            name: "zcode-cli"
          },
          providerExecutionId: "exec-vacuity-001",
          replayCommands: [
            {
              cmd: "false",
              exit: 1,
              cwd: dir
            }
          ]
        }
      });

      const emitted = JSON.parse(readFileSync(dfcmPath, "utf8")) as {
        standing: { value: string; broken_term?: string };
      };
      expect(emitted.standing.value).toBe("REFUSED(nonzero_replay_exit)");
      expect(emitted.standing.broken_term).toBe("admission_vacuous");

      const validatorPath = join(homedir(), ".zcode", "dfcm", "validate_receipt.py");
      const v = spawnSync("python3", [validatorPath, dfcmPath], {
        cwd: dir,
        encoding: "utf8",
        timeout: 15_000
      });
      expect(v.status).toBe(0);
      expect(v.stdout).toContain("ADMITTED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("writeAloopV2Receipt fails closed with R_missing_identity outside a git repo", () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), "v27-nongit-"));
    try {
      const sink = new ReceiptSink({
        ledgerPath: join(nonGitDir, "ledger.jsonl"),
        outDir: join(nonGitDir, "out"),
        dfcmReceiptPath: join(nonGitDir, "out", "aloop-v2.json"),
        cwd: nonGitDir
      });
      expect(() =>
        sink.closeCycle({
          cycleId: "cycle-nongit",
          startedAt: "2026-11-21T03:00:00.000Z",
          receipts: [
            {
              cycleId: "cycle-nongit",
              workOrderId: "WO-NONGIT",
              outcome: "ALIVE",
              standing: "ALIVE",
              sha256Receipt: "d".repeat(64)
            }
          ],
          aloop: {
            workOrderId: "WO-NONGIT",
            originAuthority: { grant: "NONE", actor: "test" },
            provider: { name: "zcode-cli" },
            providerExecutionId: "exec-nongit"
          }
        })
      ).toThrow(/R_missing_identity/);
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});
