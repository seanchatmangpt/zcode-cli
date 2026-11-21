#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { executePowlWithTokenReplay, type PowlNode } from "../src/powl-ocel-orchestrator.ts";

const CASTLE_DIR = "/Users/sac/castle";
const ZCODE_BIN = "/Users/sac/zcode-cli/bin/zcode.js";
const WASM4PM_COMPAT_DIR = "/Users/sac/wasm4pm-compat";
const OUT_DIR = "/Users/sac/.gemini/antigravity-cli/brain/252547d5-87d4-4733-9760-3d18ea51dcfb/scratch/castle-powl-ocel";

const dryRun = process.argv.includes("--dry-run");
const tomlPath = join(process.cwd(), "zcode-cli.toml");

const castlePowl: PowlNode = {
  kind: "partial_order",
  id: "castle-spec-26.11.20",
  children: [
    { kind: "activity", id: "probes-manifest", label: "Pin probe binaries/rulepacks", objectType: "Artifact", targetFile: "configs/probes-manifest.json" },
    { kind: "activity", id: "probes-trait", label: "ProbeAdapter trait & SHA-256 pin gate", objectType: "Artifact", targetFile: "src/probes/adapter.rs" },
    {
      kind: "partial_order",
      id: "plane1-adapters",
      children: [
        { kind: "activity", id: "adapter-scorecard", label: "anti-cheat-scorecard adapter", objectType: "Artifact", targetFile: "src/probes/scorecard.rs" },
        { kind: "activity", id: "adapter-sarif", label: "trivy + opengrep SARIF adapters", objectType: "Artifact", targetFile: "src/probes/sarif_adapters.rs" },
        { kind: "activity", id: "adapter-supply", label: "gitleaks + syft/osv-scanner adapters", objectType: "Artifact", targetFile: "src/probes/supply_chain_adapters.rs" },
        { kind: "activity", id: "probe-prisma", label: "Prisma/SQL RLS probe", objectType: "Artifact", targetFile: "src/probes/prisma_sql.rs" }
      ],
      order: []
    },
    { kind: "activity", id: "audit-cvc", label: "Claims Versus Code join engine", objectType: "Artifact", targetFile: "src/audit/claims_vs_code.rs" },
    { kind: "activity", id: "anonymize", label: "Fail-closed --public-anonymize court", objectType: "Artifact", targetFile: "src/publish/anonymize.rs" },
    { kind: "activity", id: "cli-routes", label: "clap-noun-verb CLI routes", objectType: "Artifact", targetFile: "src/bin/castle/verbs/castle_261120_routes.rs" },
    { kind: "activity", id: "victory-audit", label: "Zero-context Victory Audit", objectType: "Artifact", targetFile: "docs/sjira/v26.11.20/victory-audit-protocol.md" }
  ],
  order: [
    ["probes-manifest", "probes-trait"],
    ["probes-trait", "plane1-adapters"],
    ["plane1-adapters", "audit-cvc"],
    ["audit-cvc", "cli-routes"],
    ["anonymize", "cli-routes"],
    ["cli-routes", "victory-audit"]
  ]
};

const logDir = join(OUT_DIR, "logs");
mkdirSync(logDir, { recursive: true });

const res = await executePowlWithTokenReplay(
  castlePowl,
  async (t) => {
    if (dryRun) return { ok: true, exitCode: 0 };
    const logFile = join(logDir, `${t.activityId ?? t.id}.log`);
    const out = createWriteStream(logFile, { flags: "w" });
    const prompt = `POWL Transition ${t.id} (${t.label})\nExclusive Target: ${t.targetFile}\nImplement in /Users/sac/castle (Pure Rust, zero mocks, unit tests).`;
    return await new Promise((resolve) => {
      const child = spawn("node", [ZCODE_BIN, "--cwd", CASTLE_DIR, "-p", prompt, "--mode", "yolo", "--max-turns", "12"], {
        cwd: CASTLE_DIR,
        stdio: ["ignore", "pipe", "pipe"]
      });
      child.stdout.pipe(out);
      child.stderr.pipe(out);
      child.on("close", (code) => { out.end(); resolve({ ok: code === 0, exitCode: code ?? 1 }); });
      child.on("error", (err) => { out.end(); resolve({ ok: false, exitCode: 1, detail: err.message }); });
    });
  },
  { tomlPath, wasm4pmCompatDir: WASM4PM_COMPAT_DIR, outputDir: OUT_DIR }
);

console.log(JSON.stringify({
  workflowId: res.workflowId,
  dryRun,
  equilibriumWip: res.equilibriumWip,
  replay: res.replay,
  ocelSha256: res.ocelSha256,
  wasm4pmCompatChecked: res.wasm4pmCompatChecked,
  eventCount: res.ocel.events.length,
  artifacts: OUT_DIR
}, null, 2));
