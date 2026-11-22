import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  admitAfterIntegrity,
  checkChatman5Structural,
  checkReceiptIntegrity,
  detectReceiptSchemaKind,
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

  test("live ZCODE-26923-01 trips ALIVE+exit:1 (r2 base_sha corrected to real commit)", () => {
    const findings = checkReceiptIntegrity("receipts/v26.9.23/ZCODE-26923-01.json");
    const rules = new Set(findings.map((f) => f.rule));
    expect(rules.has("ALIVE_WITH_NONZERO_EXIT")).toBe(true);
    // Padded short-hash 9edcf90b0468… was corrected to real 9edcf905b241… — no BOGUS_SHA.
    expect(rules.has("BOGUS_SHA")).toBe(false);
  });
});

const v1Body = {
  identity: {
    subject: "demo",
    repo: "/tmp/repo",
    subject_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    base_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  },
  authority: { ceiling: "OBSERVE", grant: "NONE", actor: "test" },
  consequence: { commits: [], files_changed: [], remote_effects: [] },
  replay: { commands: [{ cmd: "true", exit: 0, cwd: "/tmp" }] },
  standing: { value: "PARTIAL_ALIVE", derived_from: "true" },
};

describe("ALOOP v1/v2 adapter", () => {
  test("detectReceiptSchemaKind: pure v1 vs any v2 field vs invalid", () => {
    expect(detectReceiptSchemaKind(v1Body)).toBe("v1");
    expect(detectReceiptSchemaKind({ ...v1Body, work_order_id: "WO-1" })).toBe("v2");
    expect(detectReceiptSchemaKind({ identity: v1Body.identity })).toBe("invalid");
  });

  test("checkChatman5Structural admits complete v1 shape", () => {
    expect(checkChatman5Structural(v1Body)).toEqual([]);
  });

  test("admitAfterIntegrity: pure v1 + zcode source uses adapter (no external call)", () => {
    let called = 0;
    const result = admitAfterIntegrity({
      path: "fixture-v1.json",
      raw: JSON.stringify(v1Body),
      external: { path: "/fake/validate_receipt.py", source: "zcode" },
      allowIntegrityOnly: false,
      runExternal: () => {
        called++;
        return { exitCode: 1, out: "should not run" };
      },
    });
    expect(called).toBe(0);
    expect(result.ok).toBe(true);
    expect(result.out).toContain("v1 Chatman-5 adapter");
  });

  test("admitAfterIntegrity: partial v2 routes to external (fail-closed)", () => {
    let called = 0;
    const partial = { ...v1Body, work_order_id: "WO-1" }; // missing other v2 fields
    const result = admitAfterIntegrity({
      path: "fixture-partial-v2.json",
      raw: JSON.stringify(partial),
      external: { path: "/fake/validate_receipt.py", source: "zcode" },
      allowIntegrityOnly: false,
      runExternal: () => {
        called++;
        return { exitCode: 1, out: "REFUSED missing origin_authority" };
      },
    });
    expect(called).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.out).toContain("REFUSED");
  });

  test("golden ALOOP v2 fixture admits under live zcode validator", () => {
    const findings = checkReceiptIntegrity(
      "receipts/v26.11.20/golden-aloop-v2-admit.json",
    );
    expect(findings).toEqual([]);
    const external = resolveExternalValidator();
    expect(external.source).toBe("zcode");
    const result = admitAfterIntegrity({
      path: "receipts/v26.11.20/golden-aloop-v2-admit.json",
      external,
      allowIntegrityOnly: false,
    });
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
  });
});
