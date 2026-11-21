import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePowlWorkflowConfig } from "../scripts/powl-workflow-config.ts";

describe("powl workflow config (path + cycle budgets)", () => {
  test("dry-run defaults to repo-relative output and bounded maxCycles=2", () => {
    const cwd = mkdtempSync(join(tmpdir(), "powl-cfg-dry-"));
    try {
      writeFileSync(join(cwd, "zcode-cli.toml"), "[paths]\n");
      const cfg = resolvePowlWorkflowConfig({
        argv: ["bun", "script", "--dry-run"],
        cwd,
        workflowSlug: "ecosystem"
      });
      expect(cfg.dryRun).toBe(true);
      expect(cfg.maxCycles).toBe(2);
      expect(cfg.outputDir).toBe(join(cwd, ".tmp", "ecosystem-powl-ocel"));
      expect(cfg.zcodeBin).toBe(join(cwd, "bin", "zcode.js"));
      expect(cfg.castleDir).toBe(join(cwd, ".tmp", "castle-workspace"));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("live defaults to maxCycles=1 and fails closed when castle is missing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "powl-cfg-live-"));
    try {
      writeFileSync(join(cwd, "zcode-cli.toml"), "[paths]\n");
      expect(() =>
        resolvePowlWorkflowConfig({
          argv: ["bun", "script"],
          cwd,
          workflowSlug: "castle"
        })
      ).toThrow(/castle workspace required/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("CLI overrides beat toml; --soak leaves maxCycles unbounded", () => {
    const cwd = mkdtempSync(join(tmpdir(), "powl-cfg-cli-"));
    try {
      const castle = join(cwd, "castle");
      const bin = join(cwd, "zcode.js");
      mkdirSync(castle);
      writeFileSync(bin, "#!/usr/bin/env node\n");
      writeFileSync(
        join(cwd, "zcode-cli.toml"),
        '[paths]\ncastle_dir = "/Users/sac/castle"\nwasm4pm_compat_dir = "/Users/sac/wasm4pm-compat"\n'
      );
      const cfg = resolvePowlWorkflowConfig({
        argv: [
          "bun",
          "script",
          "--castle-dir",
          castle,
          "--zcode-bin",
          bin,
          "--output-dir",
          join(cwd, "out"),
          "--soak"
        ],
        cwd,
        workflowSlug: "ecosystem"
      });
      expect(cfg.castleDir).toBe(castle);
      expect(cfg.zcodeBin).toBe(bin);
      expect(cfg.outputDir).toBe(join(cwd, "out"));
      expect(cfg.maxCycles).toBeUndefined();
      expect(cfg.soak).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("--max-cycles requires a positive integer", () => {
    const cwd = mkdtempSync(join(tmpdir(), "powl-cfg-bad-"));
    try {
      writeFileSync(join(cwd, "zcode-cli.toml"), "[paths]\n");
      expect(() =>
        resolvePowlWorkflowConfig({
          argv: ["bun", "script", "--dry-run", "--max-cycles", "0"],
          cwd,
          workflowSlug: "ecosystem"
        })
      ).toThrow(/positive integer/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
