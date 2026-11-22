import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  adapterOptionsFromTomlDoc,
  assertPublicAnonymize,
  CastlePublishCourtAdapter,
  IgniterSyncCourtAdapter,
  loadAdapterRegistryFromToml,
  MarketplaceCourtAdapter,
  ReceiptSink,
  isDfcmStubNonAdmit,
  SjiraWorkOrderSource,
  assertNoInteractiveFrontierArgs,
  validatePackTomlMinimal,
  findAskQueries,
  standingFromExit,
  exitCodeForStanding
} from "../src/adapters/index.ts";
import { parseTomlDocument } from "../src/compliance/config.ts";
import { minimatch as mm } from "../src/adapters/minimatch-lite.ts";
import { SjiraAdapterError } from "../src/io/sjira-adapter.ts";
import { validatePowlTree } from "../src/powl-ocel-orchestrator.ts";
import { resolve } from "node:path";

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

  test("validateWriteScope does not short-circuit on ggen.toml before generated/", async () => {
    const court = new MarketplaceCourtAdapter();
    // Regression: prior early `return 0` on ggen.toml skipped later generated/ refuse.
    expect(await court.validateWriteScope(["ggen.toml", "src/foo_generated.rs"])).toBe(1);
    expect(await court.validateWriteScope(["ggen.toml", "ontology/a.ttl"])).toBe(0);
  });
});

describe("adapters/igniter-sync", () => {
  test("write scope refuses generated trees", async () => {
    const court = new IgniterSyncCourtAdapter();
    expect(await court.validateWriteScope(["ontology/a.ttl"])).toBe(0);
    expect(await court.validateWriteScope(["lib/fnox_revops/foo.ex"])).toBe(1);
    expect(await court.validateWriteScope(["src/foo_generated.rs"])).toBe(1);
  });

  test("post-transition refuses sync --check drift (exit 4)", async () => {
    const court = new IgniterSyncCourtAdapter({
      run: (cmd) => {
        if (cmd[0] === "mix" && cmd.includes("ggen_igniter.sync") && cmd.includes("--check")) {
          return {
            status: 4,
            stdout: "ggen_igniter.sync --check: DRIFT -- 1 file(s) differ",
            stderr: ""
          };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
      forbidGeneratedDirs: false
    });
    const v = await court.verifyPostTransition("/tmp");
    expect(v.exitCode).toBe(1);
    expect(v.diagnostics.join(" ")).toMatch(/sync --check.*exit 4|ontology↔artifact drift/);
  });

  test("post-transition passes when sync --check exits 0", async () => {
    const court = new IgniterSyncCourtAdapter({
      run: (cmd) => {
        if (cmd[0] === "mix" && cmd.includes("--check")) {
          return {
            status: 0,
            stdout: "ggen_igniter.sync --check: clean (0 drifted files)",
            stderr: ""
          };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
      forbidGeneratedDirs: false
    });
    const v = await court.verifyPostTransition("/tmp");
    expect(v.exitCode).toBe(0);
    expect(v.standing).toBe("ALIVE");
  });

  test("post-transition LOUD_SKIPs when requireSyncCheck=false", async () => {
    const court = new IgniterSyncCourtAdapter({
      requireSyncCheck: false,
      forbidGeneratedDirs: false
    });
    const v = await court.verifyPostTransition("/tmp");
    expect(v.exitCode).toBe(3);
    expect(v.standing).toBe("UNVERIFIED");
    expect(v.diagnostics.join(" ")).toMatch(/LOUD_SKIP/);
  });

  test("noop cleanRoomSyncCmd=['true'] LOUD_SKIPs (never fake ALIVE)", async () => {
    const court = new IgniterSyncCourtAdapter({
      cleanRoomSyncCmd: ["true"],
      forbidGeneratedDirs: false,
      run: (cmd) => {
        if (cmd[0] === "true") return { status: 0, stdout: "", stderr: "" };
        return { status: 0, stdout: "", stderr: "" };
      }
    });
    const v = await court.verifyPostTransition("/tmp");
    expect(v.exitCode).toBe(3);
    expect(v.standing).toBe("UNVERIFIED");
    expect(v.diagnostics.join(" ")).toMatch(/LOUD_SKIP|noop/);
  });

  test("does not invoke git diff as ontology drift gate", async () => {
    const seen: string[][] = [];
    const court = new IgniterSyncCourtAdapter({
      run: (cmd) => {
        seen.push(cmd);
        if (cmd[0] === "mix") {
          return { status: 0, stdout: "clean", stderr: "" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
      forbidGeneratedDirs: false
    });
    await court.verifyPostTransition("/tmp");
    expect(seen.some((c) => c[0] === "git")).toBe(false);
    expect(seen.some((c) => c[0] === "mix" && c.includes("--check"))).toBe(true);
  });

  test("falsifier: git* cleanRoomSyncCmd refuses without spawning git", async () => {
    const seen: string[][] = [];
    const court = new IgniterSyncCourtAdapter({
      cleanRoomSyncCmd: ["git", "diff", "--exit-code"],
      forbidGeneratedDirs: false,
      run: (cmd) => {
        seen.push(cmd);
        return { status: 0, stdout: "", stderr: "" };
      }
    });
    const v = await court.verifyPostTransition("/tmp");
    expect(v.exitCode).toBe(1);
    expect(v.standing).toBe("REFUSED");
    expect(v.diagnostics.join(" ")).toMatch(/git\* sync cmd|clean-room fallacy/);
    expect(seen.some((c) => c[0] === "git" || (c[0] ?? "").endsWith("/git"))).toBe(false);
  });

  test("ggen sync --dry-run refuses non-empty planned_writes", async () => {
    const court = new IgniterSyncCourtAdapter({
      cleanRoomSyncCmd: ["ggen", "sync", "run", "--dry-run"],
      forbidGeneratedDirs: false,
      run: (cmd) => {
        if (cmd[0] === "ggen") {
          return {
            status: 0,
            stdout: JSON.stringify({ planned_writes: ["lib/generated/x.ex"] }),
            stderr: ""
          };
        }
        return { status: 0, stdout: "", stderr: "" };
      }
    });
    const v = await court.verifyPostTransition("/tmp");
    expect(v.exitCode).toBe(1);
    expect(v.diagnostics.join(" ")).toMatch(/planned_writes non-empty/);
  });

  test("gitDiffDiagnostic is non-gating after Jobs/C4 pass", async () => {
    const seen: string[][] = [];
    const court = new IgniterSyncCourtAdapter({
      gitDiffDiagnostic: true,
      forbidGeneratedDirs: false,
      run: (cmd) => {
        seen.push(cmd);
        if (cmd[0] === "mix") {
          return { status: 0, stdout: "clean", stderr: "" };
        }
        if (cmd[0] === "git") {
          return { status: 1, stdout: "M", stderr: "" };
        }
        return { status: 0, stdout: "", stderr: "" };
      }
    });
    const v = await court.verifyPostTransition("/tmp");
    expect(v.exitCode).toBe(0);
    expect(v.standing).toBe("ALIVE");
    expect(seen.some((c) => c[0] === "git")).toBe(true);
    expect(v.diagnostics.join(" ")).toMatch(/non-gating/);
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
    const dfcm = JSON.parse(readFileSync(result.dfcmPath!, "utf8")) as {
      schema: string;
      admit?: boolean;
      non_admit?: boolean;
      subject_sha?: string;
      work_order_id?: string;
    };
    // Stub honesty: cycle-close DFCM is zcode.dfcm.receipt/1, not Chatman-5 / receipt/v2.
    expect(dfcm.schema).toBe("zcode.dfcm.receipt/1");
    expect(dfcm.admit).toBe(false);
    expect(dfcm.non_admit).toBe(true);
    expect(dfcm.subject_sha).toBeTruthy();
    expect(dfcm.work_order_id).toBeUndefined();
    expect(isDfcmStubNonAdmit(dfcm)).toBe(true);
  });

  test("TOML enforce_twin_parity=true + exit-0 cmd arms twinParity.hands_free via ReceiptSink", () => {
    const dir = mkdtempSync(join(tmpdir(), "twin-parity-toml-"));
    // Isolated wiring probe: exit-0 cmd proves ReceiptSink spawn path only.
    // Workspace pin uses scripts/twin-parity-self-test.ts (not ["true"]).
    const toml = `
[adapters.sjira]
enabled = true
enforce_twin_parity = true
twin_parity_self_test_cmd = ["true"]
`;
    const doc = parseTomlDocument(toml);
    const { receiptSink } = adapterOptionsFromTomlDoc(doc, dir);
    expect(receiptSink.enforceTwinParity).toBe(true);
    expect(receiptSink.twinParitySelfTestCmd).toEqual(["true"]);

    const sink = new ReceiptSink({
      ledgerPath: join(dir, "ledger.jsonl"),
      outDir: join(dir, "out"),
      cwd: dir,
      ...receiptSink
    });
    const result = sink.closeCycle({
      cycleId: "twin-1",
      startedAt: new Date().toISOString(),
      receipts: [
        {
          cycleId: "twin-1",
          workOrderId: "WO-TWIN",
          outcome: "ALIVE",
          standing: "ALIVE",
          sha256Receipt: "beef"
        }
      ]
    });
    const loop = JSON.parse(readFileSync(result.loopReceiptPath, "utf8")) as {
      twinParity?: { hands_free?: string };
      aggregateStanding?: string;
    };
    expect(loop.twinParity?.hands_free).toBe("self-test-ok");
    expect(result.aggregateStanding).toBe("ALIVE");
  });

  test("workspace zcode-cli.toml twin self-test proves brand twins before hands_free", () => {
    const dir = mkdtempSync(join(tmpdir(), "twin-parity-foundry-"));
    const repoRoot = resolve(import.meta.dir, "..");
    const tomlPath = resolve(repoRoot, "zcode-cli.toml");
    const loaded = loadAdapterRegistryFromToml(tomlPath, { cwd: dir });
    expect(loaded.receiptSink.enforceTwinParity).toBe(true);
    // Real brand-hash court — not the ["true"] noop stub.
    expect(loaded.receiptSink.twinParitySelfTestCmd).toEqual([
      "bun",
      "scripts/twin-parity-self-test.ts"
    ]);
    const sink = new ReceiptSink({
      ledgerPath: join(dir, "sink-ledger.jsonl"),
      outDir: join(dir, "out"),
      // Script resolves brands via import.meta.dir; cwd must be repo for bun path.
      cwd: repoRoot,
      enforceTwinParity: loaded.receiptSink.enforceTwinParity,
      twinParitySelfTestCmd: loaded.receiptSink.twinParitySelfTestCmd
    });
    const result = sink.closeCycle({
      cycleId: "foundry-pin",
      startedAt: new Date().toISOString(),
      sandbox: true,
      receipts: [
        {
          cycleId: "foundry-pin",
          workOrderId: "WO-PIN",
          outcome: "ALIVE",
          standing: "ALIVE",
          sha256Receipt: "pin"
        }
      ]
    });
    const loop = JSON.parse(readFileSync(result.loopReceiptPath, "utf8")) as {
      twinParity?: { hands_free?: string };
      aggregateStanding?: string;
    };
    expect(loop.twinParity?.hands_free).toBe("self-test-ok");
    // sandbox still caps ALIVE → PARTIAL_ALIVE after a real twin PASS.
    expect(result.aggregateStanding).toBe("PARTIAL_ALIVE");
  });

  test("enforceTwinParity without self-test cmd fail-closes hands_free=FAILED", () => {
    const dir = mkdtempSync(join(tmpdir(), "twin-parity-nocmd-"));
    const sink = new ReceiptSink({
      ledgerPath: join(dir, "ledger.jsonl"),
      outDir: join(dir, "out"),
      cwd: dir,
      enforceTwinParity: true
    });
    const result = sink.closeCycle({
      cycleId: "twin-fail",
      startedAt: new Date().toISOString(),
      receipts: [
        {
          cycleId: "twin-fail",
          workOrderId: "WO-TWIN",
          outcome: "ALIVE",
          standing: "ALIVE",
          sha256Receipt: "cafe"
        }
      ]
    });
    const loop = JSON.parse(readFileSync(result.loopReceiptPath, "utf8")) as {
      twinParity?: { hands_free?: string };
    };
    expect(loop.twinParity?.hands_free).toBe("FAILED");
    expect(result.aggregateStanding).toBe("UNVERIFIED");
  });

  test("enforceTwinParity + failing self-test cmd fail-closes hands_free=FAILED", () => {
    const dir = mkdtempSync(join(tmpdir(), "twin-parity-false-"));
    const sink = new ReceiptSink({
      ledgerPath: join(dir, "ledger.jsonl"),
      outDir: join(dir, "out"),
      cwd: dir,
      enforceTwinParity: true,
      twinParitySelfTestCmd: ["false"]
    });
    const result = sink.closeCycle({
      cycleId: "twin-false",
      startedAt: new Date().toISOString(),
      receipts: [
        {
          cycleId: "twin-false",
          workOrderId: "WO-FALSE",
          outcome: "ALIVE",
          standing: "ALIVE",
          sha256Receipt: "dead"
        }
      ]
    });
    const loop = JSON.parse(readFileSync(result.loopReceiptPath, "utf8")) as {
      twinParity?: { hands_free?: string };
    };
    expect(loop.twinParity?.hands_free).toBe("FAILED");
    expect(result.aggregateStanding).toBe("UNVERIFIED");
  });
});

describe("minimatch-lite", () => {
  test("glob basics", () => {
    expect(mm("ontology/a.ttl", "ontology/**/*.ttl")).toBe(true);
    expect(mm("lib/fnox_x/a.ex", "ontology/**/*.ttl")).toBe(false);
  });
});
