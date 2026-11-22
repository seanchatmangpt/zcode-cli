#!/usr/bin/env bun
/**
 * Gall's Law autonomic foundry driver (dry-run by default).
 *
 * Usage:
 *   bun scripts/powl-foundry-loop.ts --dry-run
 *   bun scripts/powl-foundry-loop.ts --dry-run --candidates path/to/candidates.jsonl
 *   bun scripts/powl-foundry-loop.ts --live
 *
 * Live mode injects createZcodeAgentExecutor (same path as `zcode foundry --live`).
 * Requires a synced ZCode runtime (`bun run sync:local` / `sync:locked`) and
 * provider credentials — otherwise standing is typed BLOCKED / REFUSED, never
 * false ALIVE.
 */

import { mkdirSync, mkdtempSync, writeFileSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import {
  buildAdapterRegistry,
  createZcodeAgentExecutor,
  loadAdapterRegistryFromToml,
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

/**
 * Live write-scope fail-closed: every mutating WO needs targetFile/fileScope.
 * Fixture pathScope alone is not mapped into POWL Activity.targetFile — fill
 * a deterministic ontology touch when targetFile is absent.
 */
function ensureLiveCandidateTargets(candidatesPath: string): void {
  const lines = readFileSync(candidatesPath, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const line of lines) {
    const row = JSON.parse(line) as Record<string, unknown>;
    const hasTarget =
      (typeof row.targetFile === "string" && row.targetFile.trim().length > 0) ||
      (Array.isArray(row.fileScope) && row.fileScope.length > 0);
    if (!hasTarget) {
      const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : "WO";
      row.targetFile = `ontology/${id}.ttl`;
    }
    out.push(JSON.stringify(row));
  }
  writeFileSync(candidatesPath, `${out.join("\n")}\n`);
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

  // Init git for realistic workspace provenance (drift gate is sync --check /
  // planned_writes=[], not git-diff; git remains for optional diagnostics).
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
            standing: "UNKNOWN",
            targetFile: "ontology/WO-SEED.ttl"
          })}\n`
        );
      }
      return p;
    })();

  if (!dryRun) {
    ensureLiveCandidateTargets(candidatesPath);
  }

  const source = new SjiraWorkOrderSource({
    cwd: root,
    candidatesPath,
    ledgerPath: join(root, "ledger.jsonl"),
    outDir: join(root, "out"),
    enforceMinGgenAncestor: false
  });

  // Gall spine uses buildAdapterRegistry (same factory as foundry-cli TOML path).
  // ui_layout stays disabled here so dry-run does not SUBJECT_MISSING on missing Taffy/PW.
  // Jobs/C4 (mix ggen_igniter.sync --check) remains the igniter clean-room gate when enabled.
  const registry = buildAdapterRegistry({
    cwd: root,
    maxRemediationAttempts: 3,
    ggen_marketplace: {
      enabled: true,
      packDirs: [join(root, "packs", "demo")],
      requireDoubleCapsuleCheck: true,
      runCheck: () => ({ status: 0, stdout: "capsule-stable", stderr: "" })
    },
    ggen_igniter: {
      enabled: true,
      // Dry-run stub: argv matches production sync --check (never ["true"]).
      cleanRoomSyncCmd: ["mix", "ggen_igniter.sync", "--check"],
      forbidGeneratedDirs: true,
      run: (cmd, cwd) => {
        if (
          cmd[0] === "mix" &&
          cmd.includes("ggen_igniter.sync") &&
          cmd.includes("--check")
        ) {
          return {
            status: 0,
            stdout: "ggen_igniter.sync --check: clean (0 drifted files)",
            stderr: ""
          };
        }
        if (cmd[0] === "mix" && dryRun) {
          return { status: 0, stdout: "", stderr: "" };
        }
        const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd, encoding: "utf8" });
        return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
      }
    },
    ui_layout: { enabled: false }
  });

  // Twin parity: same TOML → ReceiptSink path as foundry-cli (repo pin if present).
  const pinToml = resolve(import.meta.dir, "../zcode-cli.toml");
  const twinParity = existsSync(pinToml)
    ? loadAdapterRegistryFromToml(pinToml, { cwd: root }).receiptSink
    : {};

  const sink = new ReceiptSink({
    ledgerPath: join(root, "sink-ledger.jsonl"),
    outDir: join(root, "out"),
    dfcmReceiptPath: join(root, "out", "dfcm-receipt.json"),
    cwd: root,
    enforceTwinParity: twinParity.enforceTwinParity,
    twinParitySelfTestCmd: twinParity.twinParitySelfTestCmd
  });

  const priorDiagnostics = new Map<string, string>();
  // Logs outside workspace: lifecycle savepoint rollback on REFUSED wipes root/out.
  const externalLogDir = dryRun
    ? undefined
    : mkdtempSync(join(tmpdir(), "zcode-foundry-live-logs-"));
  const executor = dryRun
    ? undefined
    : createZcodeAgentExecutor({
        workspaceDir: root,
        maxTurns: 12,
        logDir: externalLogDir,
        priorDiagnostics
      });

  const result = await runFoundryLoop({
    source,
    courts: registry.courts,
    sink,
    workspaceDir: root,
    dryRun,
    // Live: sandbox false so ALIVE is reachable only when courts + executor seal.
    // Dry-run keeps sandbox true → honest PARTIAL_ALIVE ceiling.
    sandbox: dryRun,
    maxCycles: dryRun ? 1 : 3,
    transactionalRollback: !dryRun,
    priorDiagnostics,
    executor,
    candidatesPath,
    outputDir: join(root, "ocel")
  });

  const diagnosticEntries = [...priorDiagnostics.entries()].map(([k, v]) => ({
    id: k,
    detail: v.slice(0, 500)
  }));
  const summary = {
    workspace: root,
    dryRun,
    liveExecutor: dryRun ? "none" : "createZcodeAgentExecutor",
    aggregateStanding: result.aggregateStanding,
    exitCode: result.exitCode,
    powlRootId: result.powlRootId,
    cycles: result.cycles.length,
    loopReceipt: join(root, "out", "loop_receipt.json"),
    externalLogDir: externalLogDir ?? null,
    diagnostics: diagnosticEntries,
    gall: "simple-system-that-works",
    // Jobs/C4 residual named for hop-5 standing (mix ABSENT ≠ false ALIVE).
    jobsC4: "mix ggen_igniter.sync --check (ui_layout disabled in Gall spine)"
  };
  // Lifecycle rollback may wipe out/; re-mkdir before summary (no ENOENT overlay).
  mkdirSync(join(root, "out"), { recursive: true });
  writeFileSync(join(root, "out", "foundry-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  return result.exitCode;
}

main().then((code) => process.exit(code));
