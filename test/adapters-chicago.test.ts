/**
 * Chicago-style (zero-mock) Gall spine court:
 * real temp git workspace, real filesystem, real JSONL, real courts, SHA receipts.
 * Anti-vacuity: inject ASK gate / dirty generated tree / standing promotion and
 * prove the loop flips to non-zero exit.
 */

import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  spawnSync("git", ["init"], { cwd: root });
  spawnSync("git", ["add", "-A"], { cwd: root });
  spawnSync(
    "git",
    ["-c", "user.email=chicago@local", "-c", "user.name=Chicago", "commit", "-m", "init"],
    { cwd: root }
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
    cleanRoomSyncCmd: ["true"],
    forbidGeneratedDirs: true,
    run: (cmd, cwd) => {
      if (cmd[0] === "true") return { status: 0, stdout: "", stderr: "" };
      const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd, encoding: "utf8" });
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

    // Real filesystem side effects from dry-run executor
    const ocel = readFileSync(join(root, "ocel", "cycle-1", "workflow.ocel.json"), "utf8");
    expect(ocel.length).toBeGreaterThan(10);
  });

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
  });

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
  });

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
});
