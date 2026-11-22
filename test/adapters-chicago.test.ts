/**
 * Chicago-style (zero-mock) Gall spine court:
 * real temp git workspace, real filesystem, real JSONL, real courts, SHA receipts.
 * Anti-vacuity: inject ASK gate / dirty generated tree / standing promotion and
 * prove the loop flips to non-zero exit.
 */

import { describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  IgniterSyncCourtAdapter,
  MarketplaceCourtAdapter,
  ReceiptSink,
  SjiraWorkOrderSource,
  runFoundryLoop
} from "../src/adapters/index.ts";
import {
  PUBLIC_ONTOLOGY_PREFIXES,
  structuralPrivateNamespaceScan
} from "../src/adapters/marketplace-court.ts";
import { aggregateStanding, exitCodeForStanding } from "../src/adapters/receipt-sink.ts";

const FIXTURE = join(import.meta.dir, "fixtures/sjira/candidates.jsonl");

function initWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "chicago-foundry-"));
  mkdirSync(join(root, "ontology"), { recursive: true });
  mkdirSync(join(root, "packs", "demo", "gates"), { recursive: true });
  mkdirSync(join(root, "out"), { recursive: true });
  writeFileSync(
    join(root, "packs", "demo", "pack.toml"),
    '[pack]\nname = "demo"\nversion = "0.1.0"\ndescription = "chicago"\n'
  );
  writeFileSync(
    join(root, "packs", "demo", "gates", "010_select.rq"),
    "SELECT ?violation ?subject WHERE { ?s a ?t }\n"
  );
  writeFileSync(
    join(root, "ontology", "seed.ttl"),
    "# UNSUPPORTED(generator-capability): handwritten\n"
  );
  copyFileSync(FIXTURE, join(root, "candidates.jsonl"));
  spawnSync("git", ["init"], { cwd: root, timeout: 15_000 });
  spawnSync("git", ["add", "-A"], { cwd: root, timeout: 15_000 });
  spawnSync(
    "git",
    ["-c", "user.email=chicago@local", "-c", "user.name=Chicago", "commit", "-m", "init"],
    { cwd: root, timeout: 15_000 }
  );
  return root;
}

function buildLoop(root: string, overrides: { askGate?: boolean; generatedDirty?: boolean } = {}) {
  if (overrides.askGate) {
    writeFileSync(join(root, "packs", "demo", "gates", "099_ask.rq"), "ASK { ?s ?p ?o }\n");
  }
  if (overrides.generatedDirty) {
    mkdirSync(join(root, "lib", "generated"), { recursive: true });
    writeFileSync(join(root, "lib", "generated", "x.ex"), "IO.puts(:leak)\n");
  }

  const source = new SjiraWorkOrderSource({
    cwd: root,
    candidatesPath: join(root, "candidates.jsonl"),
    ledgerPath: join(root, "ledger.jsonl"),
    outDir: join(root, "out"),
    enforceMinGgenAncestor: false
  });
  const marketplace = new MarketplaceCourtAdapter({
    packDirs: [join(root, "packs", "demo")],
    requireDoubleCapsuleCheck: true,
    runCheck: () => ({ status: 0, stdout: "capsule-stable", stderr: "" })
  });
  const igniter = new IgniterSyncCourtAdapter({
    // Honest sync --check stub (argv matches production gate; not ["true"]).
    cleanRoomSyncCmd: ["mix", "ggen_igniter.sync", "--check"],
    forbidGeneratedDirs: true,
    run: (cmd, cwd) => {
      if (cmd[0] === "mix" && cmd.includes("ggen_igniter.sync") && cmd.includes("--check")) {
        return {
          status: 0,
          stdout: "ggen_igniter.sync --check: clean (0 drifted files)",
          stderr: ""
        };
      }
      const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd, encoding: "utf8", timeout: 15_000 });
      return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
    }
  });
  const sink = new ReceiptSink({
    ledgerPath: join(root, "sink-ledger.jsonl"),
    outDir: join(root, "out"),
    dfcmReceiptPath: join(root, "out", "dfcm.json"),
    cwd: root
  });
  return { source, marketplace, igniter, sink };
}

describe("Chicago Gall foundry loop (zero-mock)", () => {
  test("dry-run spine: candidates → POWL → courts → honest PARTIAL_ALIVE receipt", async () => {
    const root = initWorkspace();
    const { source, marketplace, igniter, sink } = buildLoop(root);
    const result = await runFoundryLoop({
      source,
      courts: [marketplace, igniter],
      sink,
      workspaceDir: root,
      dryRun: true,
      sandbox: true,
      maxCycles: 1,
      outputDir: join(root, "ocel")
    });

    expect(result.cycles.length).toBe(1);
    expect(result.aggregateStanding).toBe("PARTIAL_ALIVE");
    expect(result.exitCode).toBe(2);

    const loop = JSON.parse(readFileSync(join(root, "out", "loop_receipt.json"), "utf8"));
    expect(loop.aggregateStanding).toBe("PARTIAL_ALIVE");
    expect(loop.schema).toBe("zcode.sjira.loop_receipt/1");

    const dfcm = JSON.parse(readFileSync(join(root, "out", "dfcm.json"), "utf8"));
    expect(dfcm.subject_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(dfcm.authority).toBe("NONE");
    expect(dfcm.external_do_count).toBe(0);
    expect(dfcm.admit).toBe(false);
    expect(dfcm.non_admit).toBe(true);
    expect(dfcm.schema).toBe("zcode.dfcm.receipt/1");

    // Real filesystem side effects from dry-run executor
    const ocel = readFileSync(join(root, "ocel", "cycle-1", "workflow.ocel.json"), "utf8");
    expect(ocel.length).toBeGreaterThan(10);
  }, 25_000);

  test("anti-vacuity: ASK gate flips marketplace court to REFUSED", async () => {
    const root = initWorkspace();
    const { source, marketplace, igniter, sink } = buildLoop(root, { askGate: true });
    const result = await runFoundryLoop({
      source,
      courts: [marketplace, igniter],
      sink,
      workspaceDir: root,
      dryRun: true,
      sandbox: true,
      maxCycles: 1
    });
    expect(result.exitCode).not.toBe(0);
    expect(["REFUSED", "PARTIAL_ALIVE", "UNVERIFIED", "BLOCKED"]).toContain(result.aggregateStanding);
    // At least one transition should have been refused by court
    const refused = result.cycles[0]!.ocel.objects.some(
      (o) => o.attributes.at(-1)?.value === "REFUSED"
    );
    expect(refused).toBe(true);
  }, 25_000);

  test("anti-vacuity: generated/ directory fails igniter forbid_generated_dirs", async () => {
    const root = initWorkspace();
    const { source, marketplace, igniter, sink } = buildLoop(root, { generatedDirty: true });
    const result = await runFoundryLoop({
      source,
      courts: [marketplace, igniter],
      sink,
      workspaceDir: root,
      dryRun: true,
      sandbox: true,
      maxCycles: 1
    });
    expect(result.exitCode).not.toBe(0);
    const refused = result.cycles[0]!.ocel.objects.some(
      (o) => o.attributes.at(-1)?.value === "REFUSED"
    );
    expect(refused).toBe(true);
  }, 25_000);

  test("anti-vacuity: never promotes sandbox ALIVE in sink aggregate", async () => {
    const root = initWorkspace();
    const sink = new ReceiptSink({
      ledgerPath: join(root, "ledger.jsonl"),
      outDir: join(root, "out"),
      cwd: root
    });
    const close = sink.closeCycle({
      cycleId: "vacuity",
      startedAt: new Date().toISOString(),
      sandbox: true,
      receipts: [
        {
          cycleId: "vacuity",
          workOrderId: "WO",
          outcome: "ALIVE",
          standing: "ALIVE",
          sha256Receipt: "00"
        }
      ]
    });
    expect(close.aggregateStanding).toBe("PARTIAL_ALIVE");
    expect(close.exitCode).toBe(2);
  });

  test("ERRC ELIMINATE: SjiraWorkOrderSource rejects interactive/authority frontierArgs before spawn", async () => {
    const root = mkdtempSync(join(tmpdir(), "chicago-sjira-argv-"));
    const fakeBin = join(root, "fake-ggen.sh");
    writeFileSync(fakeBin, "#!/bin/sh\necho '{\"id\":\"SHOULD_NOT_RUN\"}'\n");
    chmodSync(fakeBin, 0o755);

    const source = new SjiraWorkOrderSource({
      cwd: root,
      ggenBin: fakeBin,
      enforceMinGgenAncestor: false,
      forbidTtyPrompts: true,
      frontierArgs: ["--yes"]
    });
    await expect(source.ingestFrontier()).rejects.toThrow(/interactive\/authority flag forbidden/i);

    const sourceAuth = new SjiraWorkOrderSource({
      cwd: root,
      ggenBin: fakeBin,
      enforceMinGgenAncestor: false,
      forbidTtyPrompts: true,
      frontierArgs: ["--authority=ADMIN"]
    });
    await expect(sourceAuth.ingestFrontier()).rejects.toThrow(/interactive\/authority flag forbidden/i);
  });

  test("ERRC REDUCE: preflightVerify propagates LOUD_SKIP (exitCode 3) when GGEN_BIN is outside git", async () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), "chicago-nongit-ggen-"));
    const fakeBin = join(nonGitDir, "ggen");
    writeFileSync(fakeBin, "#!/bin/sh\nexit 0\n");
    chmodSync(fakeBin, 0o755);

    const source = new SjiraWorkOrderSource({
      cwd: nonGitDir,
      ggenBin: fakeBin,
      enforceMinGgenAncestor: true
    });
    const pre = await source.preflightVerify();
    expect(pre.ok).toBe(true);
    expect(pre.exitCode).toBe(3);
    expect(pre.detail).toContain("not inside a git checkout");
  });

  test("ERRC RAISE: structuralPrivateNamespaceScan enforces strict allowlist and parses @prefix/PREFIX", () => {
    const packDir = mkdtempSync(join(tmpdir(), "chicago-privns-"));
    const ontDir = join(packDir, "ontology");
    mkdirSync(ontDir, { recursive: true });
    const rqPath = join(packDir, "gates", "000_forbid_private_namespaces.rq");

    // 1. Clean public ontology passes
    writeFileSync(
      join(ontDir, "clean.ttl"),
      "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n" +
        "@prefix schema: <https://schema.org/> .\n" +
        "<urn:uuid:12345678-1234-1234-1234-123456789abc> a <https://schema.org/Thing> .\n"
    );
    expect(structuralPrivateNamespaceScan(packDir, rqPath).status).toBe(0);

    // 2. Arbitrary private namespace (not in 5-host denylist) fails closed
    writeFileSync(
      join(ontDir, "private.ttl"),
      "@prefix corp: <http://corp.example/ont#> .\ncorp:Widget a <http://corp.example/ont#Thing> .\n"
    );
    const privRes = structuralPrivateNamespaceScan(packDir, rqPath);
    expect(privRes.status).toBe(1);
    expect(privRes.stderr).toContain("http://corp.example/ont#");

    // 3. Substring-spoofed URI fails closed (no includes() bypass)
    const spoofPack = mkdtempSync(join(tmpdir(), "chicago-spoof-"));
    mkdirSync(join(spoofPack, "ontology"), { recursive: true });
    writeFileSync(
      join(spoofPack, "ontology", "spoof.rq"),
      "PREFIX evil: <http://evil.example/http://www.w3.org/1999/02/22-rdf-syntax-ns#>\nSELECT ?s WHERE { ?s a evil:X }\n"
    );
    const spoofRes = structuralPrivateNamespaceScan(spoofPack, rqPath);
    expect(spoofRes.status).toBe(1);
    expect(spoofRes.stderr).toContain("http://evil.example/http://www.w3.org/");
  });

  test("G01-Truex-Shui: admits shui: SHACL 1.2 UI and fails closed when 000_forbid_private_namespaces.rq is absent", async () => {
    expect(PUBLIC_ONTOLOGY_PREFIXES).toContain("shui:");
    expect(PUBLIC_ONTOLOGY_PREFIXES).toContain("http://www.w3.org/ns/shacl-ui#");
    expect(PUBLIC_ONTOLOGY_PREFIXES).toContain("http://www.w3.org/ns/shacl-ui/");

    const root = mkdtempSync(join(tmpdir(), "chicago-truex-shui-"));
    const packDir = join(root, "packs", "ui-pack");
    const ontDir = join(packDir, "ontology");
    mkdirSync(ontDir, { recursive: true });
    writeFileSync(
      join(packDir, "pack.toml"),
      '[pack]\nname = "ui-pack"\nversion = "0.1.0"\ndescription = "shui"\n'
    );
    // No gates/000_forbid_private_namespaces.rq exists in packDir.

    // 1. Clean W3C SHACL 1.2 UI ontology passes verifyPostTransition
    writeFileSync(
      join(ontDir, "ui.ttl"),
      "@prefix sh: <http://www.w3.org/ns/shacl#> .\n" +
        "@prefix shui: <http://www.w3.org/ns/shacl-ui#> .\n" +
        "<urn:uuid:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa> shui:editor <http://www.w3.org/ns/shacl-ui/TextFieldEditor> .\n"
    );
    const court = new MarketplaceCourtAdapter({
      packDirs: [packDir],
      requireDoubleCapsuleCheck: false
    });
    const cleanVerdict = await court.verifyPostTransition(root);
    expect(cleanVerdict.exitCode).toBe(0);
    expect(cleanVerdict.standing).toBe("ALIVE");
    expect(cleanVerdict.artifactDigests.private_ns_gate).toBeTruthy();

    // 2. Private namespace in pack ontology fails closed even without 000_forbid_private_namespaces.rq
    writeFileSync(
      join(ontDir, "leak.ttl"),
      "@prefix zl: <https://zcode.dev/ontology/zcode-loop#> .\nzl:Event a <http://www.w3.org/2000/01/rdf-schema#Class> .\n"
    );
    const leakVerdict = await court.verifyPostTransition(root);
    expect(leakVerdict.exitCode).toBe(1);
    expect(leakVerdict.standing).toBe("REFUSED");
    expect(leakVerdict.diagnostics.join("\n")).toContain("https://zcode.dev/ontology/zcode-loop#");
  });

  test("ERRC RAISE: ReceiptSink populates consequence/replay, fails closed on missing git HEAD, and preserves UNSUPPORTED (exit 3)", () => {
    // 1. UNSUPPORTED standing aggregates to UNSUPPORTED (exit 3), not UNKNOWN (exit 2)
    expect(aggregateStanding(["UNSUPPORTED"])).toBe("UNSUPPORTED");
    expect(exitCodeForStanding("UNSUPPORTED")).toBe(3);
    expect(aggregateStanding(["ALIVE", "UNSUPPORTED"])).toBe("UNSUPPORTED");

    // 2. Valid git workspace populates consequence + replay.commands from transition receipts
    const gitRoot = initWorkspace();
    const dfcmPath = join(gitRoot, "out", "dfcm.json");
    const sink = new ReceiptSink({
      ledgerPath: join(gitRoot, "ledger.jsonl"),
      outDir: join(gitRoot, "out"),
      dfcmReceiptPath: dfcmPath,
      cwd: gitRoot
    });
    const close = sink.closeCycle({
      cycleId: "cycle-unsupported",
      startedAt: new Date().toISOString(),
      receipts: [
        {
          cycleId: "cycle-unsupported",
          workOrderId: "WO-UNSUP-1",
          outcome: "UNSUPPORTED",
          standing: "UNSUPPORTED",
          sha256Receipt: "deadbeef"
        }
      ]
    });
    expect(close.aggregateStanding).toBe("UNSUPPORTED");
    expect(close.exitCode).toBe(3);

    const dfcm = JSON.parse(readFileSync(dfcmPath, "utf8"));
    expect(dfcm.subject_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(dfcm.standing).toBe("UNSUPPORTED");
    expect(dfcm.exit_code).toBe(3);
    expect(dfcm.consequence.transition_count).toBe(1);
    expect(dfcm.consequence.outcomes[0].work_order_id).toBe("WO-UNSUP-1");
    expect(dfcm.consequence.outcomes[0].sha256_receipt).toBe("deadbeef");
    expect(Array.isArray(dfcm.replay.commands)).toBe(true);
    expect(dfcm.replay.commands.length).toBeGreaterThanOrEqual(2);
    expect(dfcm.replay.commands[0]).toContain(dfcm.subject_sha);
    expect(dfcm.replay.commands.some((c: string) => c.includes("WO-UNSUP-1"))).toBe(true);

    // 3. Non-git directory fails closed with R_missing_identity (never emits UNKNOWN subject_sha)
    const nonGitRoot = mkdtempSync(join(tmpdir(), "chicago-nongit-sink-"));
    const nonGitSink = new ReceiptSink({
      ledgerPath: join(nonGitRoot, "ledger.jsonl"),
      outDir: join(nonGitRoot, "out"),
      dfcmReceiptPath: join(nonGitRoot, "out", "dfcm.json"),
      cwd: nonGitRoot
    });
    expect(() =>
      nonGitSink.closeCycle({
        cycleId: "cycle-nongit",
        startedAt: new Date().toISOString(),
        receipts: [
          {
            cycleId: "cycle-nongit",
            workOrderId: "WO-NONGIT",
            outcome: "ALIVE",
            standing: "ALIVE",
            sha256Receipt: "cafe"
          }
        ]
      })
    ).toThrow(/R_missing_identity/);
  });
});
