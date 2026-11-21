import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deriveFollowUpPowl,
  executePowlWithTokenReplay,
  runAutonomicLoop,
  type PowlNode
} from "../src/powl-ocel-orchestrator.ts";

function runRealSubprocess(cmd: string, args: string[]): Promise<{ ok: boolean; exitCode: number; detail?: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (d) => { stderr += String(d); });
    child.on("close", (code) => resolve({ ok: code === 0, exitCode: code ?? 1, detail: stderr.trim() || undefined }));
    child.on("error", (err) => resolve({ ok: false, exitCode: 1, detail: err.message }));
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
  });

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
});
