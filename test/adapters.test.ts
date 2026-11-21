import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertPublicAnonymize,
  CastlePublishCourtAdapter,
  IgniterSyncCourtAdapter,
  MarketplaceCourtAdapter,
  ReceiptSink,
  SjiraWorkOrderSource,
  assertNoInteractiveFrontierArgs,
  validatePackTomlMinimal,
  findAskQueries,
  standingFromExit,
  exitCodeForStanding
} from "../src/adapters/index.ts";
import { minimatch as mm } from "../src/adapters/minimatch-lite.ts";
import { SjiraAdapterError } from "../src/io/sjira-adapter.ts";
import { validatePowlTree } from "../src/powl-ocel-orchestrator.ts";

const FIXTURE_CANDIDATES = join(import.meta.dir, "fixtures/sjira/candidates.jsonl");

describe("adapters/types standing taxonomy", () => {
  test("anti-fake-ALIVE: sandbox and missing subject never yield ALIVE", () => {
    expect(standingFromExit(0, { sandbox: true })).toBe("PARTIAL_ALIVE");
    expect(standingFromExit(0, { unverified: true })).toBe("UNVERIFIED");
    expect(standingFromExit(2)).toBe("BLOCKED");
    expect(standingFromExit(0)).toBe("ALIVE");
    expect(exitCodeForStanding("PARTIAL_ALIVE")).toBe(2);
    expect(exitCodeForStanding("ALIVE")).toBe(0);
  });
});

describe("adapters/sjira-io", () => {
  test("forbids interactive/authority frontier flags", () => {
    expect(() => assertNoInteractiveFrontierArgs(["sjira", "frontier"])).not.toThrow();
    expect(() => assertNoInteractiveFrontierArgs(["sjira", "frontier", "--authority"])).toThrow(
      SjiraAdapterError
    );
  });

  test("ingestFrontier from candidates.jsonl → PartialOrder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "adapter-sjira-"));
    const src = new SjiraWorkOrderSource({
      cwd: dir,
      candidatesPath: FIXTURE_CANDIDATES,
      ledgerPath: join(dir, "ledger.jsonl"),
      outDir: join(dir, "out"),
      enforceMinGgenAncestor: false
    });
    const pre = await src.preflightVerify();
    expect(pre.ok).toBe(true);
    const powl = await src.ingestFrontier();
    validatePowlTree(powl);
    expect(powl.kind).toBe("partial_order");

    await src.recordOutcome({
      cycleId: "c1",
      workOrderId: "WO-A",
      outcome: "ALIVE",
      standing: "PARTIAL_ALIVE",
      sha256Receipt: "abc",
      twinParity: { hands_free: "self-test-ok" }
    });
    const receipt = JSON.parse(readFileSync(join(dir, "out", "loop_receipt.json"), "utf8"));
    expect(receipt.aggregateStanding).toBe("PARTIAL_ALIVE");
    expect(receipt.exitCode).toBe(2);
  });
});

describe("adapters/marketplace-court", () => {
  test("pack.toml minimal schema lock", () => {
    expect(validatePackTomlMinimal('[pack]\nname="a"\nversion="1.0.0"\n')).toEqual({
      ok: true,
      detail: "ok"
    });
    expect(validatePackTomlMinimal('[pack]\nname="a"\nversion="1"\nauthor="x"\n').ok).toBe(false);
  });

  test("refuses ASK gates and accepts SELECT-only", () => {
    const dir = mkdtempSync(join(tmpdir(), "mkt-gates-"));
    const gates = join(dir, "gates");
    mkdirSync(gates);
    writeFileSync(join(gates, "bad.rq"), "ASK { ?s ?p ?o }\n");
    writeFileSync(join(gates, "good.rq"), "SELECT ?violation ?subject WHERE { ?s ?p ?o }\n");
    expect(findAskQueries(gates)).toEqual(["bad.rq"]);
  });

  test("double-run capsule digests must match", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mkt-check-"));
    mkdirSync(join(dir, "packs", "demo"), { recursive: true });
    writeFileSync(
      join(dir, "packs", "demo", "pack.toml"),
      '[pack]\nname = "demo"\nversion = "0.1.0"\ndescription = "d"\n'
    );
    let n = 0;
    const court = new MarketplaceCourtAdapter({
      packDirs: [join(dir, "packs", "demo")],
      requireDoubleCapsuleCheck: true,
      runCheck: () => {
        n += 1;
        return { status: 0, stdout: n === 1 ? "capsule-A" : "capsule-B", stderr: "" };
      }
    });
    const v = await court.verifyPostTransition(dir);
    expect(v.exitCode).toBe(1);
    expect(v.diagnostics.join(" ")).toContain("diverged");
  });

  test("FM-CONFIG-101 refuses consumer [packs.*]", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mkt-cfg-"));
    writeFileSync(join(dir, "ggen.toml"), '[packs.foo]\npath = "./packs/foo"\n');
    const court = new MarketplaceCourtAdapter({
      packDirs: [],
      requireDoubleCapsuleCheck: false
    });
    const v = await court.verifyPostTransition(dir);
    expect(v.exitCode).toBe(1);
    expect(v.diagnostics.join(" ")).toContain("FM-CONFIG-101");
  });
});

describe("adapters/igniter-sync", () => {
  test("write scope refuses generated trees", async () => {
    const court = new IgniterSyncCourtAdapter();
    expect(await court.validateWriteScope(["ontology/a.ttl"])).toBe(0);
    expect(await court.validateWriteScope(["lib/fnox_revops/foo.ex"])).toBe(1);
    expect(await court.validateWriteScope(["src/foo_generated.rs"])).toBe(1);
  });

  test("post-transition requires clean git diff after sync", async () => {
    const court = new IgniterSyncCourtAdapter({
      run: (cmd) => {
        if (cmd[0] === "mix") return { status: 0, stdout: "", stderr: "" };
        if (cmd[0] === "git") return { status: 1, stdout: "M generated", stderr: "" };
        return { status: 0, stdout: "", stderr: "" };
      },
      forbidGeneratedDirs: false
    });
    const v = await court.verifyPostTransition("/tmp");
    expect(v.exitCode).toBe(1);
    expect(v.diagnostics.join(" ")).toContain("git diff");
  });
});

describe("adapters/castle-publish", () => {
  test("requires --public-anonymize on linkedin targets", () => {
    expect(
      assertPublicAnonymize(["publish", "--target", "linkedin-carousel"], ["linkedin-carousel"]).ok
    ).toBe(false);
    expect(
      assertPublicAnonymize(
        ["publish", "--target", "linkedin-carousel", "--public-anonymize"],
        ["linkedin-carousel"]
      ).ok
    ).toBe(true);
  });

  test("loud skip when argv unset", async () => {
    delete process.env.CASTLE_PUBLISH_ARGV;
    const court = new CastlePublishCourtAdapter();
    const v = await court.verifyPostTransition("/tmp");
    expect(v.exitCode).toBe(3);
    expect(v.standing).toBe("UNVERIFIED");
  });
});

describe("adapters/receipt-sink", () => {
  test("closeCycle preserves PARTIAL_ALIVE and writes loop_receipt + dfcm", () => {
    const dir = mkdtempSync(join(tmpdir(), "receipt-sink-"));
    const sink = new ReceiptSink({
      ledgerPath: join(dir, "ledger.jsonl"),
      outDir: join(dir, "out"),
      dfcmReceiptPath: join(dir, "dfcm", "receipt.json"),
      cwd: process.cwd()
    });
    const result = sink.closeCycle({
      cycleId: "c1",
      startedAt: new Date().toISOString(),
      sandbox: true,
      receipts: [
        {
          cycleId: "c1",
          workOrderId: "WO-1",
          outcome: "ALIVE",
          standing: "ALIVE",
          sha256Receipt: "deadbeef"
        }
      ]
    });
    expect(result.aggregateStanding).toBe("PARTIAL_ALIVE");
    expect(result.exitCode).toBe(2);
    expect(readFileSync(result.loopReceiptPath, "utf8")).toContain("PARTIAL_ALIVE");
    expect(readFileSync(result.dfcmPath!, "utf8")).toContain("subject_sha");
  });
});

describe("minimatch-lite", () => {
  test("glob basics", () => {
    expect(mm("ontology/a.ttl", "ontology/**/*.ttl")).toBe(true);
    expect(mm("lib/fnox_x/a.ex", "ontology/**/*.ttl")).toBe(false);
  });
});
