import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  aggregateStanding,
  assertNoStandingPromotion,
  candidatesToPowl,
  createSjiraIoAdapter,
  emitSjiraLedgerAndReceipt,
  emitSjiraLedgerEntry,
  parseCandidatesJsonl,
  readCandidatesFile,
  requireGgenBin,
  resolveHonestStanding,
  SjiraAdapterError,
  verifyIgniterCleanRoom,
  type SjiraCandidate,
  type SjiraLedgerEntry
} from "../src/io/sjira-adapter.ts";
import { validatePowlTree } from "../src/powl-ocel-orchestrator.ts";

const FIXTURE = join(import.meta.dir, "fixtures/sjira/candidates.jsonl");

describe("SjiraIoAdapter — GGEN_BIN fail-closed", () => {
  test("unset GGEN_BIN refuses PATH fallback", () => {
    expect(() => requireGgenBin(undefined)).toThrow(SjiraAdapterError);
    try {
      requireGgenBin("");
      throw new Error("unreachable");
    } catch (e) {
      expect(e).toBeInstanceOf(SjiraAdapterError);
      expect((e as SjiraAdapterError).code).toBe("GGEN_NOT_FOUND");
      expect((e as SjiraAdapterError).exitHint).toBe(2);
    }
  });

  test("relative GGEN_BIN is refused", () => {
    try {
      requireGgenBin("ggen");
      throw new Error("unreachable");
    } catch (e) {
      expect((e as SjiraAdapterError).code).toBe("GGEN_BIN_NOT_ABSOLUTE");
    }
  });

  test("absolute missing binary is GGEN_NOT_FOUND", () => {
    try {
      requireGgenBin("/tmp/definitely-not-a-ggen-binary-9ac3");
      throw new Error("unreachable");
    } catch (e) {
      expect((e as SjiraAdapterError).code).toBe("GGEN_NOT_FOUND");
    }
  });

  test("absolute executable binary is accepted", () => {
    const dir = mkdtempSync(join(tmpdir(), "sjira-ggen-"));
    const bin = join(dir, "ggen");
    writeFileSync(bin, "#!/bin/sh\necho ok\n");
    chmodSync(bin, 0o755);
    expect(requireGgenBin(bin)).toBe(bin);
  });
});

describe("SjiraIoAdapter — ingress candidates.jsonl → POWL", () => {
  test("parses fixture and compiles PartialOrder with dependsOn edges", () => {
    const candidates = readCandidatesFile(FIXTURE);
    expect(candidates.map((c) => c.id)).toEqual(["WO-A", "WO-B", "WO-C"]);
    expect(candidates[1]!.dependsOn).toEqual(["WO-A"]);
    expect(candidates[0]!.requiresIgniterCleanRoom).toBe(true);

    const powl = candidatesToPowl(candidates, { rootId: "frontier-test" });
    validatePowlTree(powl);
    expect(powl.kind).toBe("partial_order");
    if (powl.kind !== "partial_order") throw new Error("expected partial_order");
    expect(powl.children).toHaveLength(3);
    expect(powl.order).toContainEqual(["WO-A", "WO-B"]);
    expect(powl.order).toContainEqual(["WO-A", "WO-C"]);
    expect(powl.order).toContainEqual(["WO-B", "WO-C"]);
  });

  test("self-dependency is PO_CYCLE", () => {
    const bad: SjiraCandidate[] = [{ id: "X", dependsOn: ["X"], objectType: "WorkOrder" }];
    expect(() => candidatesToPowl(bad)).toThrow(SjiraAdapterError);
    try {
      candidatesToPowl(bad);
    } catch (e) {
      expect((e as SjiraAdapterError).code).toBe("PO_CYCLE");
    }
  });

  test("cycle A→B→A is refused", () => {
    const bad: SjiraCandidate[] = [
      { id: "A", dependsOn: ["B"], objectType: "WorkOrder" },
      { id: "B", dependsOn: ["A"], objectType: "WorkOrder" }
    ];
    expect(() => candidatesToPowl(bad)).toThrow(SjiraAdapterError);
  });

  test("dangling dependsOn outside frontier is skipped (eligible set only)", () => {
    const rows: SjiraCandidate[] = [
      { id: "A", dependsOn: ["MISSING"], objectType: "WorkOrder" },
      { id: "B", dependsOn: ["A"], objectType: "WorkOrder" }
    ];
    const powl = candidatesToPowl(rows);
    if (powl.kind !== "partial_order") throw new Error("expected partial_order");
    expect(powl.order).toEqual([["A", "B"]]);
  });

  test("malformed JSONL fails closed", () => {
    expect(() => parseCandidatesJsonl("{not-json\n")).toThrow(SjiraAdapterError);
    expect(() => parseCandidatesJsonl("{\"label\":\"no-id\"}\n")).toThrow(SjiraAdapterError);
  });
});

describe("SjiraIoAdapter — standing honesty", () => {
  test("never promotes PARTIAL_ALIVE prior to ALIVE", () => {
    const standing = resolveHonestStanding({
      outcome: "ALIVE",
      priorStanding: "PARTIAL_ALIVE"
    });
    expect(standing).toBe("PARTIAL_ALIVE");
  });

  test("sandboxPartial caps ALIVE → PARTIAL_ALIVE", () => {
    expect(
      resolveHonestStanding({ outcome: "ALIVE", sandboxPartial: true })
    ).toBe("PARTIAL_ALIVE");
  });

  test("unverified caps ALIVE → UNVERIFIED", () => {
    expect(resolveHonestStanding({ outcome: "ALIVE", unverified: true })).toBe("UNVERIFIED");
  });

  test("assertNoStandingPromotion refuses PARTIAL → ALIVE", () => {
    expect(() => assertNoStandingPromotion("PARTIAL_ALIVE", "ALIVE")).toThrow(SjiraAdapterError);
    expect(() => assertNoStandingPromotion("UNVERIFIED", "ALIVE")).toThrow(SjiraAdapterError);
    expect(() => assertNoStandingPromotion("PARTIAL_ALIVE", "PARTIAL_ALIVE")).not.toThrow();
  });

  test("aggregateStanding never upgrades mixed PARTIAL to ALIVE", () => {
    expect(aggregateStanding(["ALIVE", "PARTIAL_ALIVE"])).toBe("PARTIAL_ALIVE");
    expect(aggregateStanding(["ALIVE", "ALIVE"])).toBe("ALIVE");
    expect(aggregateStanding(["ALIVE", "REFUSED"])).toBe("REFUSED");
  });
});

describe("SjiraIoAdapter — igniter clean-room gate", () => {
  test("skipped when not required", () => {
    const r = verifyIgniterCleanRoom("/tmp", { required: false });
    expect(r.status).toBe("skipped");
    expect(r.ok).toBe(true);
  });

  test("fails when sync non-zero", () => {
    const r = verifyIgniterCleanRoom("/tmp", {
      required: true,
      run: (cmd) => {
        if (cmd[0] === "mix") return { status: 1, stderr: "sync boom", stdout: "" };
        return { status: 0, stderr: "", stdout: "" };
      }
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe("failed");
    expect(r.detail).toContain("igniter sync");
  });

  test("fails when git diff dirty after sync", () => {
    const r = verifyIgniterCleanRoom("/tmp", {
      required: true,
      run: (cmd) => {
        if (cmd[0] === "mix") return { status: 0, stderr: "", stdout: "" };
        if (cmd[0] === "git") return { status: 1, stderr: "", stdout: "M generated/x.ex" };
        return { status: 0, stderr: "", stdout: "" };
      }
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("git diff");
  });

  test("passes sync + clean tree + verifyCmd", () => {
    const r = verifyIgniterCleanRoom("/tmp", {
      required: true,
      verifyCmd: "true",
      run: () => ({ status: 0, stderr: "", stdout: "" })
    });
    expect(r).toEqual({ ok: true, status: "passed" });
  });
});

describe("SjiraIoAdapter — egress ledger + loop_receipt", () => {
  test("appends ledger.jsonl and writes loop_receipt with honest PARTIAL_ALIVE", () => {
    const dir = mkdtempSync(join(tmpdir(), "sjira-out-"));
    const ledgerPath = join(dir, "ledger.jsonl");
    const outDir = join(dir, "out");
    mkdirSync(outDir, { recursive: true });

    const adapter = createSjiraIoAdapter(
      { SJIRA_CANDIDATES: FIXTURE, SJIRA_LEDGER: ledgerPath, SJIRA_OUT_DIR: outDir },
      { cwd: dir }
    );
    const ingest = adapter.ingestSjiraFrontier("candidates_file");
    const powl = adapter.candidatesToPowl(ingest.candidates, "cycle-1");
    validatePowlTree(powl);

    const entries: SjiraLedgerEntry[] = [];
    for (const c of ingest.candidates) {
      entries.push(
        adapter.emitSjiraLedgerEntry({
          cycleId: "cycle-1",
          candidate: { ...c, standing: "PARTIAL_ALIVE" },
          outcome: "ALIVE",
          sandboxPartial: true,
          igniterCleanRoom: c.requiresIgniterCleanRoom ? "passed" : "skipped"
        })
      );
    }

    expect(entries.every((e) => e.standing === "PARTIAL_ALIVE")).toBe(true);
    expect(entries.every((e) => e.outcome === "PARTIAL_ALIVE")).toBe(true);

    const ledger = readFileSync(ledgerPath, "utf8").trim().split("\n");
    expect(ledger).toHaveLength(3);

    const receipt = adapter.emitSjiraLedgerAndReceipt({
      cycleId: "cycle-1",
      startedAt: new Date().toISOString(),
      ingest,
      powlRootId: powl.id,
      entries,
      twinParity: { hands_free: "self-test-ok" }
    });

    expect(receipt.schema).toBe("zcode.sjira.loop_receipt/1");
    expect(receipt.aggregateStanding).toBe("PARTIAL_ALIVE");
    expect(receipt.exitCode).toBe(2);
    expect(readFileSync(join(outDir, "loop_receipt.json"), "utf8")).toContain("PARTIAL_ALIVE");
  });

  test("live ALIVE aggregate exits 0 only when every child is ALIVE", () => {
    const dir = mkdtempSync(join(tmpdir(), "sjira-alive-"));
    const paths = {
      cwd: dir,
      ledgerPath: join(dir, "ledger.jsonl"),
      outDir: join(dir, "out")
    };
    const candidate: SjiraCandidate = { id: "WO-1", standing: "UNKNOWN", objectType: "WorkOrder" };
    const entry = emitSjiraLedgerEntry({
      paths,
      cycleId: "c2",
      candidate,
      outcome: "ALIVE"
    });
    expect(entry.standing).toBe("ALIVE");
    const receipt = emitSjiraLedgerAndReceipt({
      paths,
      cycleId: "c2",
      startedAt: new Date().toISOString(),
      ingest: { candidates: [candidate], source: "candidates_file", candidatesPath: FIXTURE },
      powlRootId: "root",
      entries: [entry]
    });
    expect(receipt.aggregateStanding).toBe("ALIVE");
    expect(receipt.exitCode).toBe(0);
  });
});
