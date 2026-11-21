#!/usr/bin/env bun
/**
 * Gall's Law autonomic foundry driver (dry-run by default).
 *
 * Usage:
 *   bun scripts/powl-foundry-loop.ts --dry-run
 *   bun scripts/powl-foundry-loop.ts --dry-run --candidates path/to/candidates.jsonl
 *
 * Live agent execution requires an injected executor / bin/zcode.js and is
 * intentionally not the default — the spine must work without LLM COGS.
 */

import { mkdirSync, mkdtempSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import {
  IgniterSyncCourtAdapter,
  MarketplaceCourtAdapter,
  ReceiptSink,
  SjiraWorkOrderSource,
  runFoundryLoop
} from "../src/adapters/index.ts";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("-") ? v : undefined;
}

const dryRun = process.argv.includes("--dry-run") || !process.argv.includes("--live");
const candidates = argValue("--candidates");
const workspace = argValue("--workspace");

async function main(): Promise<number> {
  const root =
    workspace ??
    mkdtempSync(join(tmpdir(), "zcode-foundry-"));
  mkdirSync(join(root, "ontology"), { recursive: true });
  mkdirSync(join(root, "packs", "demo", "gates"), { recursive: true });
  mkdirSync(join(root, "out"), { recursive: true });

  // Minimal marketplace pack (Gall: simplest pack that courts can green)
  writeFileSync(
    join(root, "packs", "demo", "pack.toml"),
    '[pack]\nname = "demo"\nversion = "0.1.0"\ndescription = "gall spine fixture"\n'
  );
  writeFileSync(
    join(root, "packs", "demo", "gates", "010_select.rq"),
    "SELECT ?violation ?subject WHERE { ?s a ?t }\n"
  );
  writeFileSync(
    join(root, "ontology", "seed.ttl"),
    "# UNSUPPORTED(generator-capability): handwritten\n@prefix ex: <https://www.w3.org/2001/XMLSchema#> .\n"
  );

  // Init git so igniter git-diff court can run
  if (!existsSync(join(root, ".git"))) {
    spawnSync("git", ["init"], { cwd: root, encoding: "utf8" });
    spawnSync("git", ["add", "-A"], { cwd: root, encoding: "utf8" });
    spawnSync("git", ["-c", "user.email=gall@local", "-c", "user.name=Gall", "commit", "-m", "spine"], {
      cwd: root,
      encoding: "utf8"
    });
  }

  const candidatesPath =
    candidates ??
    (() => {
      const p = join(root, "candidates.jsonl");
      const fixture = resolve(import.meta.dir, "../test/fixtures/sjira/candidates.jsonl");
      if (existsSync(fixture)) copyFileSync(fixture, p);
      else {
        writeFileSync(
          p,
          `${JSON.stringify({
            id: "WO-SEED",
            label: "Seed ontology",
            objectType: "WorkOrder",
            requiresIgniterCleanRoom: true,
            standing: "UNKNOWN"
          })}\n`
        );
      }
      return p;
    })();

  const source = new SjiraWorkOrderSource({
    cwd: root,
    candidatesPath,
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
    // Dry-run: sync is a no-op identity; court still requires clean tree.
    cleanRoomSyncCmd: ["true"],
    forbidGeneratedDirs: true,
    run: (cmd, cwd) => {
      if (cmd[0] === "true" || (cmd[0] === "mix" && dryRun)) {
        return { status: 0, stdout: "", stderr: "" };
      }
      const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd, encoding: "utf8" });
      return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
    }
  });

  const sink = new ReceiptSink({
    ledgerPath: join(root, "sink-ledger.jsonl"),
    outDir: join(root, "out"),
    dfcmReceiptPath: join(root, "out", "dfcm-receipt.json"),
    cwd: root
  });

  const result = await runFoundryLoop({
    source,
    courts: [marketplace, igniter],
    sink,
    workspaceDir: root,
    dryRun,
    sandbox: true, // honest PARTIAL_ALIVE until live seals present
    maxCycles: 1,
    outputDir: join(root, "ocel")
  });

  const summary = {
    workspace: root,
    dryRun,
    aggregateStanding: result.aggregateStanding,
    exitCode: result.exitCode,
    powlRootId: result.powlRootId,
    cycles: result.cycles.length,
    loopReceipt: join(root, "out", "loop_receipt.json"),
    gall: "simple-system-that-works"
  };
  writeFileSync(join(root, "out", "foundry-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  return result.exitCode;
}

main().then((code) => process.exit(code));
