#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runAutonomicLoop, type PowlNode } from "../src/powl-ocel-orchestrator.ts";

/**
 * ECOSYSTEM-SPEC-26.11.20 — 4-Phase Autonomic POWL v2 + OCEL 2.0 Master Workflow.
 * Zero hardcoded concurrency; AIMD equilibrium + never-empty follow-up synthesis.
 */

const CASTLE_DIR = "/Users/sac/castle";
const ZCODE_BIN = "/Users/sac/zcode-cli/bin/zcode.js";
const WASM4PM_COMPAT_DIR = "/Users/sac/wasm4pm-compat";
const OUT_DIR = "/Users/sac/.gemini/antigravity-cli/brain/252547d5-87d4-4733-9760-3d18ea51dcfb/scratch/ecosystem-powl-ocel";

const dryRun = process.argv.includes("--dry-run");
const maxCyclesIdx = process.argv.indexOf("--max-cycles");
const maxCycles = maxCyclesIdx >= 0 ? Number(process.argv[maxCyclesIdx + 1]) : (dryRun ? 2 : undefined);

const ecosystemPowl: PowlNode = {
  kind: "partial_order",
  id: "ecosystem-spec-26.11.20",
  children: [
    {
      kind: "partial_order",
      id: "phase1-foundations",
      children: [
        { kind: "activity", id: "cos-conservation", label: "Seal cos ledger conservation & --seed 7", objectType: "Artifact" },
        { kind: "activity", id: "affidavit-curve", label: "Unify curve25519-dalek v4 & cgap-aoq headers", objectType: "Artifact" },
        { kind: "activity", id: "ffb-seams", label: "Seal FFB WebTransport h3 & <=10KB agent-card", objectType: "Artifact" }
      ],
      order: []
    },
    {
      kind: "partial_order",
      id: "phase2-castle-core",
      children: [
        { kind: "activity", id: "castle-probes", label: "Wire anti-cheat-scorecard + Trivy + OpenGrep + Gitleaks + SQL/RLS", objectType: "Artifact", targetFile: "src/probes/mod.rs" },
        { kind: "activity", id: "castle-audit", label: "Implement castle audit claims-vs-code + castle deletion", objectType: "Artifact", targetFile: "src/audit/claims_vs_code.rs" },
        { kind: "activity", id: "castle-publish", label: "Implement castle publish (--public-anonymize + --brand)", objectType: "Artifact", targetFile: "src/publish/linkedin.rs" }
      ],
      order: [
        ["castle-probes", "castle-audit"],
        ["castle-audit", "castle-publish"]
      ]
    },
    {
      kind: "partial_order",
      id: "phase3-gatekeeper-raid",
      children: [
        { kind: "activity", id: "wasm-verifier", label: "Compile <250KB air-gapped verify_witness WASM", objectType: "Artifact" },
        { kind: "activity", id: "raid-4cloud", label: "Ship <20min 4-Cloud RAID + Watchtower automation", objectType: "Artifact" },
        { kind: "activity", id: "revops-airlock", label: "Launch revops.fnox.io /drop/:lease_id + 21k Newsletter", objectType: "Artifact" }
      ],
      order: []
    },
    {
      kind: "activity",
      id: "phase4-ratchet-scale",
      label: "Gatekeeper Ratchet + Woz-and-Jobs OEM Partner Launch",
      objectType: "Artifact"
    }
  ],
  order: [
    ["phase1-foundations", "phase2-castle-core"],
    ["phase2-castle-core", "phase3-gatekeeper-raid"],
    ["phase3-gatekeeper-raid", "phase4-ratchet-scale"]
  ]
};

const logDir = join(OUT_DIR, "logs");
mkdirSync(logDir, { recursive: true });

const results = await runAutonomicLoop(
  ecosystemPowl,
  async (t) => {
    if (dryRun) return { ok: true, exitCode: 0 };
    const logFile = join(logDir, `${t.activityId ?? t.id}.log`);
    const out = createWriteStream(logFile, { flags: "w" });
    const prompt = `ECOSYSTEM-SPEC-26.11.20 Transition ${t.id} (${t.label}). Implement in /Users/sac/castle (Pure Rust, zero Python, zero mocks).`;
    return await new Promise((resolve) => {
      const child = spawn("node", [ZCODE_BIN, "--cwd", CASTLE_DIR, "-p", prompt, "--mode", "yolo", "--max-turns", "12"], {
        cwd: CASTLE_DIR,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stderr = "";
      child.stdout.pipe(out);
      child.stderr.on("data", (d) => { stderr += String(d); out.write(d); });
      child.on("close", (code) => {
        out.end();
        const transportBackpressure = /UND_ERR_CONNECT_TIMEOUT|429|503/.test(stderr);
        resolve({ ok: code === 0, transportBackpressure, exitCode: code ?? 1 });
      });
      child.on("error", (err) => { out.end(); resolve({ ok: false, exitCode: 1, detail: err.message }); });
    });
  },
  { maxCycles, tomlPath: join(process.cwd(), "zcode-cli.toml"), wasm4pmCompatDir: WASM4PM_COMPAT_DIR, outputDir: OUT_DIR }
);

console.log(JSON.stringify({
  cyclesExecuted: results.length,
  dryRun,
  cycles: results.map((r) => ({
    workflowId: r.workflowId,
    equilibriumWip: r.equilibriumWip,
    fitness: r.replay.fitness,
    soundTermination: r.replay.soundTermination,
    ocelSha256: r.ocelSha256
  }))
}, null, 2));
