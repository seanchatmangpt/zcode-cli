import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkReceiptIntegrity,
  resolveExternalValidator,
} from "../scripts/validate-receipts.ts";

describe("resolveExternalValidator", () => {
  test("prefers ~/.zcode over ~/.claude and never invents a path", () => {
    const root = mkdtempSync(join(tmpdir(), "dfcm-home-"));
    const zcodeDir = join(root, ".zcode", "dfcm");
    const claudeDir = join(root, ".claude", "dfcm");
    // missing → missing
    expect(resolveExternalValidator(root).source).toBe("missing");
    // only claude → claude (legacy)
    require("node:fs").mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "validate_receipt.py"), "# stub\n");
    expect(resolveExternalValidator(root)).toEqual({
      path: join(claudeDir, "validate_receipt.py"),
      source: "claude",
    });
    // zcode present → zcode wins even if claude exists
    require("node:fs").mkdirSync(zcodeDir, { recursive: true });
    writeFileSync(join(zcodeDir, "validate_receipt.py"), "# zcode\n");
    expect(resolveExternalValidator(root)).toEqual({
      path: join(zcodeDir, "validate_receipt.py"),
      source: "zcode",
    });
  });
});

describe("checkReceiptIntegrity", () => {
  const known = new Set([
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  ]);
  const shaExists = (sha: string) => known.has(sha.toLowerCase());

  test("refuses nested ALIVE with nonzero replay exit", () => {
    const raw = JSON.stringify({
      identity: {
        subject: "demo",
        repo: ".",
        subject_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        base_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      standing: { value: "PARTIAL_ALIVE", derived_from: "top" },
      replay: { commands: [{ cmd: "true", exit: 0 }] },
      r2: {
        identity: {
          subject: "r2",
          repo: ".",
          base_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
        standing: { value: "ALIVE", derived_from: "claimed green" },
        replay: {
          commands: [
            { cmd: "bun run typecheck", exit: 0 },
            { cmd: "bun run test:unit", exit: 1 },
          ],
        },
      },
    });
    const findings = checkReceiptIntegrity("fixture.json", { raw, shaExists });
    expect(findings.some((f) => f.rule === "ALIVE_WITH_NONZERO_EXIT")).toBe(true);
    expect(findings.map((f) => f.detail).join("\n")).toContain("test:unit");
  });

  test("admits PARTIAL_ALIVE with nonzero exits", () => {
    const raw = JSON.stringify({
      identity: {
        subject: "demo",
        repo: ".",
        subject_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        base_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      standing: { value: "PARTIAL_ALIVE", derived_from: "honest red" },
      replay: { commands: [{ cmd: "bun run test:runtime", exit: 1 }] },
    });
    expect(checkReceiptIntegrity("ok.json", { raw, shaExists })).toEqual([]);
  });

  test("refuses bogus base_sha even under PARTIAL_ALIVE", () => {
    const raw = JSON.stringify({
      identity: {
        subject: "demo",
        repo: ".",
        subject_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        base_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      standing: { value: "PARTIAL_ALIVE", derived_from: "x" },
      replay: { commands: [] },
      r2: {
        identity: {
          base_sha: "9edcf90b0468bb45b1e46cb16dcb1ecca44eabd0",
        },
        standing: { value: "PARTIAL_ALIVE" },
        replay: { commands: [] },
      },
    });
    const findings = checkReceiptIntegrity("bogus.json", { raw, shaExists });
    expect(findings.some((f) => f.rule === "BOGUS_SHA")).toBe(true);
    expect(findings[0]?.detail).toContain("9edcf90b0468bb45b1e46cb16dcb1ecca44eabd0");
  });

  test("live ZCODE-26923-01 trips ALIVE+exit:1 and bogus r2.base_sha", () => {
    const findings = checkReceiptIntegrity("receipts/v26.9.23/ZCODE-26923-01.json");
    const rules = new Set(findings.map((f) => f.rule));
    expect(rules.has("ALIVE_WITH_NONZERO_EXIT")).toBe(true);
    expect(rules.has("BOGUS_SHA")).toBe(true);
  });
});
