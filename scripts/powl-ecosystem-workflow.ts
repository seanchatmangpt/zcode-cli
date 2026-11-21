#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runAutonomicLoop, type PowlNode } from "../src/powl-ocel-orchestrator.ts";
import { resolvePowlWorkflowConfig } from "./powl-workflow-config.ts";

/**
 * ECOSYSTEM-SPEC-26.11.20 — 4-Phase Autonomic POWL v2 + OCEL 2.0 Master Workflow.
 * Zero hardcoded concurrency; AIMD equilibrium + never-empty follow-up synthesis.
 * Cycles are bounded by default (live=1, dry-run=2); pass --soak or --max-cycles N to override.
 */

const cfg = resolvePowlWorkflowConfig({ workflowSlug: "ecosystem" });

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

const logDir = join(cfg.outputDir, "logs");
mkdirSync(logDir, { recursive: true });

const results = await runAutonomicLoop(
  ecosystemPowl,
  async (t) => {
    if (cfg.dryRun) return { ok: true, exitCode: 0 };
    const logFile = join(logDir, `${t.activityId ?? t.id}.log`);
    const out = createWriteStream(logFile, { flags: "w" });
    const prompt = `ECOSYSTEM-SPEC-26.11.20 Transition ${t.id} (${t.label}). Implement in ${cfg.castleDir} (Pure Rust, zero Python, zero mocks).`;
    return await new Promise((resolve) => {
      const child = spawn("node", [cfg.zcodeBin, "--cwd", cfg.castleDir, "-p", prompt, "--mode", "yolo", "--max-turns", "12"], {
        cwd: cfg.castleDir,
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
  {
    maxCycles: cfg.maxCycles,
    tomlPath: cfg.tomlPath,
    wasm4pmCompatDir: cfg.wasm4pmCompatDir,
    outputDir: cfg.outputDir
  }
);

console.log(JSON.stringify({
  cyclesExecuted: results.length,
  dryRun: cfg.dryRun,
  soak: cfg.soak,
  maxCycles: cfg.maxCycles ?? null,
  castleDir: cfg.castleDir,
  zcodeBin: cfg.zcodeBin,
  artifacts: cfg.outputDir,
  cycles: results.map((r) => ({
    workflowId: r.workflowId,
    equilibriumWip: r.equilibriumWip,
    fitness: r.replay.fitness,
    soundTermination: r.replay.soundTermination,
    ocelSha256: r.ocelSha256
  }))
}, null, 2));
