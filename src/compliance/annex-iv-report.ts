import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import {
  ComplianceRefusalError,
  isHighRiskProfile,
  loadComplianceConfig,
  parseTomlDocument,
  type ResolvedComplianceConfig
} from "./config.ts";
import { detectConceptDrift, type ConceptDriftReport } from "./concept-drift.ts";
import {
  COMPLIANCE_O2O_QUALIFIERS,
  EU_AI_ACT_EVENT_TYPES,
  EU_AI_ACT_OBJECT_TYPES
} from "./ocel2.ts";
import { readOcel2Sqlite } from "./ocel-sqlite.ts";
import {
  findPackageRoot,
  loadAiroRiskRegister,
  type RiskRegisterReport
} from "./risk-ledger.ts";
import { EVENT_TYPES, OBJECT_TYPES } from "../generated/ocel.ts";

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function canonicalSortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalSortDeep);
  }
  if (value !== null && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(rec).sort()) {
      if (rec[k] !== undefined) {
        out[k] = canonicalSortDeep(rec[k]);
      }
    }
    return out;
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalSortDeep(value));
}

function resolveGitHead(dir: string): string | undefined {
  try {
    const out = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return /^[0-9a-f]{40}$/u.test(out) ? out : undefined;
  } catch {
    return undefined;
  }
}

function collectReceiptInventory(pkgRoot: string): {
  total: number;
  files: Array<{ path: string; sha256: string }>;
} {
  const receiptsDir = join(pkgRoot, "receipts");
  if (!existsSync(receiptsDir)) return { total: 0, files: [] };

  const files: Array<{ path: string; sha256: string }> = [];
  const walk = (dir: string) => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("_")) {
        const rel = relative(pkgRoot, abs).replaceAll("\\", "/");
        files.push({
          path: rel,
          sha256: sha256Hex(readFileSync(abs, "utf8"))
        });
      }
    }
  };
  walk(receiptsDir);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { total: files.length, files };
}

function atomicWriteText(targetPath: string, content: string): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, content, "utf8");
    renameSync(tmp, targetPath);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

export interface AnnexIvCompileOptions {
  outDir: string;
  packageRoot?: string;
  cwd?: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  logsDir?: string;
}

export interface AnnexIvDossier {
  schema: "zcode.annex-iv/1";
  regulation: "Regulation (EU) 2024/1689";
  article: "Article 11 & Annex IV";
  compliance_profile: string;
  gitHeadSha: string;
  headSha: string;
  workspaceGitHeadSha: string | null;
  sections: {
    section_1_general_description: Record<string, unknown>;
    section_2_design_architecture_development: Record<string, unknown>;
    section_3_monitoring_functioning_control: Record<string, unknown>;
    section_4_performance_accuracy_metrics: Record<string, unknown>;
    section_5_risk_management: Record<string, unknown>;
    section_6_lifecycle_changes_provenance: Record<string, unknown>;
    section_7_harmonized_standards: Record<string, unknown>;
    section_8_eu_doc_and_pmm: Record<string, unknown>;
  };
  sectionHashes: Record<string, string>;
  dossierSha256: string;
}

export interface AnnexIvCompileResult {
  dossier: AnnexIvDossier;
  markdown: string;
  jsonPath: string;
  mdPath: string;
}

export interface AnnexIvCheckResult {
  ok: boolean;
  valid: boolean;
  checked: boolean;
  status: "ADMITTED" | "REFUSED";
  standing: "ALIVE" | "REFUSED" | "UNVERIFIED";
  gitHeadSha: string;
  dossierSha256: string;
  outDir: string;
  errors: string[];
}

function loadOptionalDriftSummary(
  logsDir: string | undefined,
  cfg: ResolvedComplianceConfig
): ConceptDriftReport | null {
  if (!logsDir || !existsSync(logsDir)) return null;
  const entries = readdirSync(logsDir).sort();
  const docs: Array<{ objects: never[]; events: never[] }> = [];
  for (const name of entries) {
    const abs = join(logsDir, name);
    if (name.endsWith(".ocel.json") || name.endsWith(".jsonocel")) {
      docs.push(JSON.parse(readFileSync(abs, "utf8")));
    } else if (name.endsWith(".sqlite") || name.endsWith(".ocel.sqlite")) {
      docs.push(readOcel2Sqlite(abs) as never);
    }
  }
  if (docs.length === 0) return null;
  return detectConceptDrift(docs, {
    alpha: cfg.pmm.drift_alpha,
    minWindow: cfg.pmm.min_window
  });
}

export function buildAnnexIvDossier(
  options: Omit<AnnexIvCompileOptions, "outDir">
): { dossier: AnnexIvDossier; markdown: string; hasExplicitPmmSection: boolean; cfg: ResolvedComplianceConfig } {
  const pkgRoot = options.packageRoot ?? findPackageRoot();
  const cwd = options.cwd ?? process.cwd();
  const cfg = loadComplianceConfig({
    cwd,
    configPath: options.configPath,
    env: options.env
  });

  let hasExplicitPmmSection = false;
  if (cfg.configPresent) {
    const rawToml = parseTomlDocument(readFileSync(cfg.configPath, "utf8"));
    hasExplicitPmmSection = Object.prototype.hasOwnProperty.call(rawToml, "pmm");
  }

  const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
    name?: string;
    version?: string;
    license?: string;
    engines?: { node?: string };
    repository?: { url?: string };
  };
  const lock = JSON.parse(readFileSync(join(pkgRoot, "zcode-runtime.lock.json"), "utf8")) as {
    schemaVersion?: number;
    appVersion?: string;
    platform?: string;
    arch?: string;
    url?: string;
    sha512?: string;
  };
  let extractionSummary: Record<string, unknown> = { present: false };
  const extPath = join(pkgRoot, "vendor", "extraction.json");
  if (existsSync(extPath)) {
    const ext = JSON.parse(readFileSync(extPath, "utf8")) as {
      cliVersion?: string;
      extractedAt?: string;
      runtimePatches?: Array<{ status?: string }>;
      tui?: Record<string, unknown>;
    };
    const patches = ext.runtimePatches ?? [];
    extractionSummary = {
      present: true,
      cliVersion: ext.cliVersion ?? "unknown",
      extractedAt: ext.extractedAt ?? "unknown",
      patchCounts: {
        total: patches.length,
        applied: patches.filter((p) => p.status === "applied").length,
        already_present: patches.filter((p) => p.status === "already_present").length,
        skipped: patches.filter((p) => p.status === "skipped").length
      },
      tui: ext.tui ?? {}
    };
  }

  const riskReport: RiskRegisterReport = loadAiroRiskRegister({
    packageRoot: pkgRoot,
    config: cfg
  });

  const repoHeadSha = resolveGitHead(pkgRoot) ?? "0".repeat(40);
  const workspaceHeadSha = existsSync(join(cwd, ".git")) ? (resolveGitHead(cwd) ?? null) : null;
  const receiptsInventory = collectReceiptInventory(pkgRoot);
  const driftSummary = loadOptionalDriftSummary(options.logsDir, cfg);

  const section_1_general_description = {
    title: "Annex IV §1 — General Description of the AI System",
    system_name: pkg.name ?? "zcode-app-cli",
    distribution_version: pkg.version ?? "0.0.0",
    runtime_app_version: lock.appVersion ?? "0.0.0",
    runtime_lock: lock,
    extraction: extractionSummary,
    node_engine_requirement: pkg.engines?.node ?? ">=22.19.0",
    compliance_profile: cfg.compliance.profile,
    intended_purpose:
      "Supervised CLI/TUI agent wrapper operating under CONSTRUCT ceiling with EU AI Act process-mining compliance controls.",
    instructions_for_use: "docs/INSTRUCTIONS_FOR_USE.md"
  };

  const section_2_design_architecture_development = {
    title: "Annex IV §2 — System Elements, Architecture & Development Process",
    ontology_sources: [
      "ontology/zcode-loop.ttl",
      "ontology/eu-ai-act.ttl",
      "ontology/airo_risk_description.ttl"
    ],
    closed_ocel_generated_types: {
      event_types_count: EVENT_TYPES.length,
      object_types_count: OBJECT_TYPES.length,
      codegen_gate: "bun scripts/gen-ocel.ts --check",
      app_server_source_status: "VERIFIED"
    },
    eu_ai_act_ocel2_extensions: {
      object_types: [...EU_AI_ACT_OBJECT_TYPES],
      event_types: [...EU_AI_ACT_EVENT_TYPES],
      o2o_qualifiers: [...COMPLIANCE_O2O_QUALIFIERS]
    },
    xaas_coupling_doc: "docs/c4-zcode-cli-xaas.md",
    gall_work_contract_sha256: "9f722813725bb814228b77044fd8875510d7d7e11f326df4b427d98792a7e979",
    handwritten_residue_ledger: "HANDWRITTEN.md"
  };

  const section_3_monitoring_functioning_control = {
    title: "Annex IV §3 — Monitoring, Functioning & Human Oversight Controls (Art. 14)",
    powl_orchestrator: "src/powl-ocel-orchestrator.ts",
    oversight_module: "src/compliance/oversight.ts",
    disclosure_module: "src/compliance/disclosure.ts",
    transactional_net_module: "src/compliance/transactional-net.ts",
    kingman_scheduler_module: "src/compliance/kingman-scheduler.ts",
    active_oversight_policy: {
      overseer_id: cfg.deployer.overseer_id ?? null,
      allow_yolo: cfg.compliance.allow_yolo,
      min_review_ms: cfg.compliance.min_review_ms,
      max_retries_per_signature: cfg.compliance.max_retries_per_signature,
      git_provenance_trailer: cfg.compliance.git_provenance_trailer,
      redact_pii: cfg.compliance.redact_pii
    }
  };

  const section_4_performance_accuracy_metrics = {
    title: "Annex IV §4 — Performance, Accuracy, Robustness & Cybersecurity Metrics (Art. 15)",
    alignment_method: "a_star_alignment",
    alignment_module: "src/compliance/conformance.ts",
    declare_module: "src/compliance/declare-conformance.ts",
    declare_constraints_count: riskReport.declare_constraints.length,
    oc_dfg_module: "src/compliance/ocel-discover.ts",
    ocpn_module: "src/compliance/ocpn.ts",
    rpm_fact_module: "src/compliance/rpm-fact.ts",
    redactor_module: "src/compliance/redactor.ts"
  };

  const section_5_risk_management = {
    title: "Annex IV §5 — Risk Management System (Art. 9)",
    ontologies: [...riskReport.ontologies],
    article_mappings: riskReport.mappings,
    risks: riskReport.risks,
    summary: riskReport.summary
  };

  const section_6_lifecycle_changes_provenance = {
    title: "Annex IV §6 — Lifecycle Changes, Version Provenance & Receipts",
    gitHeadSha: repoHeadSha,
    headSha: repoHeadSha,
    workspaceGitHeadSha: workspaceHeadSha,
    receipts: receiptsInventory,
    qms_manifest_path: "compliance/qms-manifest.json",
    dataset_manifest_path: "compliance/dataset-manifest.json"
  };

  const section_7_harmonized_standards = {
    title: "Annex IV §7 — Harmonized Standards & Technical Specifications Applied",
    standards: [
      "Regulation (EU) 2024/1689 (EU AI Act)",
      "IEEE Std 1849 / IEEE OCEL 2.0 (JSON, WAL SQLite, XML)",
      "W3C AIRO & DPV / DPV-AI / EU-AIACT Ontologies",
      "Declare / LTLf with Anti-Vacuity Semantics",
      "POWL v2 (Partial Order Workflow Language) Soundness-by-Construction"
    ]
  };

  const section_8_eu_doc_and_pmm = {
    title: "Annex IV §8 — EU Declaration of Conformity & Post-Market Monitoring Plan (Art. 47 / Art. 72)",
    pmm_configured: hasExplicitPmmSection,
    pmm_config: cfg.pmm,
    deployer_config: cfg.deployer,
    pmm_modules: ["src/compliance/concept-drift.ts", "src/compliance/pmm-incident.ts"],
    pmm_observed_summary: driftSummary
      ? {
          driftDetected: driftSummary.driftDetected,
          driftKind: driftSummary.driftKind,
          pValue: driftSummary.pValue,
          findingsCount: driftSummary.findings.length
        }
      : null
  };

  const sections = {
    section_1_general_description,
    section_2_design_architecture_development,
    section_3_monitoring_functioning_control,
    section_4_performance_accuracy_metrics,
    section_5_risk_management,
    section_6_lifecycle_changes_provenance,
    section_7_harmonized_standards,
    section_8_eu_doc_and_pmm
  };

  const sectionHashes: Record<string, string> = {};
  for (const [k, v] of Object.entries(sections)) {
    sectionHashes[k] = sha256Hex(canonicalJson(v));
  }

  const coreForDigest = {
    schema: "zcode.annex-iv/1" as const,
    regulation: "Regulation (EU) 2024/1689" as const,
    article: "Article 11 & Annex IV" as const,
    compliance_profile: cfg.compliance.profile,
    gitHeadSha: repoHeadSha,
    headSha: repoHeadSha,
    workspaceGitHeadSha: workspaceHeadSha,
    sections,
    sectionHashes
  };

  const dossierSha256 = sha256Hex(canonicalJson(coreForDigest));
  const dossier: AnnexIvDossier = {
    ...coreForDigest,
    dossierSha256
  };

  const mdLines: string[] = [
    "# zcode-cli — EU AI Act Article 11 & Annex IV Technical Documentation",
    "",
    `- **Regulation**: ${dossier.regulation}`,
    `- **Profile**: \`${dossier.compliance_profile}\``,
    `- **Git HEAD SHA**: \`${dossier.gitHeadSha}\``,
    `- **Dossier SHA-256**: \`${dossier.dossierSha256}\``,
    "",
    "## §1 General Description of the AI System",
    "",
    `- Package: \`${section_1_general_description.system_name}@${section_1_general_description.distribution_version}\``,
    `- Runtime Lock: \`${section_1_general_description.runtime_app_version}\` (\`sha512: ${lock.sha512 ?? ""}\`)`,
    `- Node Requirement: \`${section_1_general_description.node_engine_requirement}\``,
    "",
    "## §2 System Elements, Architecture & Development",
    "",
    `- Closed OCEL 2.0 generated types: ${EVENT_TYPES.length} events, ${OBJECT_TYPES.length} objects (\`Source-AppServer\`: VERIFIED)`,
    `- EU AI Act OCEL 2.0 extensions: ${EU_AI_ACT_OBJECT_TYPES.length} object types, ${EU_AI_ACT_EVENT_TYPES.length} event types, ${COMPLIANCE_O2O_QUALIFIERS.length} O2O qualifiers`,
    `- Handwritten residue ledger: \`HANDWRITTEN.md\``,
    "",
    "## §3 Monitoring, Functioning & Human Oversight Controls (Art. 14)",
    "",
    `- Overseer ID: \`${cfg.deployer.overseer_id ?? "UNSET"}\``,
    `- Allow YOLO: \`${String(cfg.compliance.allow_yolo)}\` | Min Review Latency: \`${cfg.compliance.min_review_ms} ms\``,
    `- Per-signature retry cap: \`${cfg.compliance.max_retries_per_signature}\``,
    "",
    "## §4 Performance, Accuracy, Robustness & Cybersecurity (Art. 15)",
    "",
    "- Optimal synchronous-product A* trace alignment (`src/compliance/conformance.ts`)",
    `- ${riskReport.declare_constraints.length} Declare/LTLf rules with anti-vacuity semantics (\`src/compliance/declare-conformance.ts\`)`,
    "- Responsible Process Mining FACT audit & k-anonymity (`src/compliance/rpm-fact.ts`)",
    "",
    "## §5 Risk Management System (Article 9)",
    "",
    `- Total AIRO + EU AI Act risks cataloged: ${riskReport.summary.total_risks}`,
    `- Residual risks within thresholds: ${String(riskReport.summary.all_residual_within_threshold)}`,
    ...riskReport.risks.map((r) => `- \`${r.id}\` (${r.articles.join(", ")}): ${r.label}`),
    "",
    "## §6 Lifecycle Changes, Version Provenance & Receipts",
    "",
    `- Repository HEAD: \`${repoHeadSha}\``,
    `- Validated DfCM receipts on disk: ${receiptsInventory.total}`,
    "",
    "## §7 Harmonized Standards & Technical Specifications",
    "",
    ...section_7_harmonized_standards.standards.map((s) => `- ${s}`),
    "",
    "## §8 EU Declaration of Conformity & Post-Market Monitoring (Art. 47 / Art. 72)",
    "",
    `- Explicit \`[pmm]\` config present: \`${String(hasExplicitPmmSection)}\``,
    `- Monitoring enabled: \`${String(cfg.deployer.monitoring_enabled)}\` | Log retention: \`${cfg.deployer.log_retention_days} days\``,
    `- PMM parameters: \`drift_alpha=${cfg.pmm.drift_alpha}\`, \`min_window=${cfg.pmm.min_window}\`, \`k_anonymity=${cfg.pmm.k_anonymity}\``
  ];

  return {
    dossier,
    markdown: mdLines.join("\n") + "\n",
    hasExplicitPmmSection,
    cfg
  };
}

export function compileAnnexIvDossier(options: AnnexIvCompileOptions): AnnexIvCompileResult {
  if (!options.outDir || !options.outDir.trim()) {
    throw new ComplianceRefusalError(
      "INVALID_COMPLIANCE_CONFIG",
      "compliance annex-iv requires a non-empty --out <dir> path."
    );
  }
  if (existsSync(options.outDir) && !statSync(options.outDir).isDirectory()) {
    throw new ComplianceRefusalError(
      "INVALID_COMPLIANCE_CONFIG",
      `--out path '${options.outDir}' exists and is not a directory (ENOTDIR).`
    );
  }

  const built = buildAnnexIvDossier(options);
  const jsonPath = join(options.outDir, "annex-iv.json");
  const mdPath = join(options.outDir, "annex-iv.md");
  const jsonContent = JSON.stringify(canonicalSortDeep(built.dossier), null, 2) + "\n";

  atomicWriteText(jsonPath, jsonContent);
  atomicWriteText(mdPath, built.markdown);

  return {
    dossier: built.dossier,
    markdown: built.markdown,
    jsonPath,
    mdPath
  };
}

export function checkAnnexIvDossier(options: AnnexIvCompileOptions): AnnexIvCheckResult {
  if (!options.outDir || !options.outDir.trim()) {
    throw new ComplianceRefusalError(
      "INVALID_COMPLIANCE_CONFIG",
      "compliance annex-iv --check requires a non-empty --out <dir> path."
    );
  }
  if (existsSync(options.outDir) && !statSync(options.outDir).isDirectory()) {
    throw new ComplianceRefusalError(
      "INVALID_COMPLIANCE_CONFIG",
      `--out path '${options.outDir}' exists and is not a directory (ENOTDIR).`
    );
  }

  const built = buildAnnexIvDossier(options);
  const errors: string[] = [];

  if (isHighRiskProfile(built.cfg.compliance.profile)) {
    if (!built.hasExplicitPmmSection) {
      errors.push(
        "UNVERIFIED: Annex IV §8 incomplete — missing [pmm] configuration section under high-risk profile."
      );
    }
    if (!built.cfg.deployer.monitoring_enabled) {
      errors.push(
        "LOGGING_UNAVAILABLE: Annex IV §8 incomplete — deployer.monitoring_enabled is false."
      );
    }
  }

  const jsonPath = join(options.outDir, "annex-iv.json");
  const mdPath = join(options.outDir, "annex-iv.md");

  if (errors.length === 0) {
    if (!existsSync(jsonPath)) {
      errors.push(`Annex IV dossier missing at '${options.outDir}' (annex-iv.json).`);
    } else {
      let existingRaw = "";
      let parsedJson: unknown;
      let parseOk = false;
      try {
        existingRaw = readFileSync(jsonPath, "utf8");
        parsedJson = JSON.parse(existingRaw);
        parseOk = true;
      } catch (err) {
        errors.push(`Failed to parse '${jsonPath}': ${(err as Error).message}`);
      }

      if (parseOk) {
        if (!parsedJson || typeof parsedJson !== "object" || Array.isArray(parsedJson)) {
          errors.push(`Invalid Annex IV JSON root in '${jsonPath}': expected plain object.`);
        } else {
          const existing = parsedJson as Record<string, unknown>;
          const existingHead =
            typeof existing.gitHeadSha === "string"
              ? existing.gitHeadSha
              : typeof existing.headSha === "string"
                ? existing.headSha
                : "";
          if (existingHead !== built.dossier.gitHeadSha) {
            errors.push(
              `git HEAD SHA drift detected: dossier recorded '${existingHead}', live HEAD is '${built.dossier.gitHeadSha}'.`
            );
          }
          if (existing.dossierSha256 !== built.dossier.dossierSha256) {
            errors.push(
              `Annex IV dossier SHA-256 mismatch (tamper or drift): recorded '${String(existing.dossierSha256)}', expected '${built.dossier.dossierSha256}'.`
            );
          }
          if (canonicalJson(existing) !== canonicalJson(built.dossier)) {
            errors.push("Annex IV JSON content differs from deterministic repository/config state (tamper or drift detected).");
          }
        }
      }
    }

    if (!existsSync(mdPath)) {
      errors.push(`Annex IV dossier missing at '${options.outDir}' (annex-iv.md).`);
    } else {
      const existingMd = readFileSync(mdPath, "utf8");
      if (sha256Hex(existingMd) !== sha256Hex(built.markdown)) {
        errors.push("Annex IV Markdown digest differs from deterministic compiler output (drift detected).");
      }
    }
  }

  const ok = errors.length === 0;
  return {
    ok,
    valid: ok,
    checked: true,
    status: ok ? "ADMITTED" : "REFUSED",
    standing: ok ? "ALIVE" : errors.some((e) => e.includes("UNVERIFIED")) ? "UNVERIFIED" : "REFUSED",
    gitHeadSha: built.dossier.gitHeadSha,
    dossierSha256: built.dossier.dossierSha256,
    outDir: options.outDir,
    errors
  };
}
