import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  ComplianceRefusalError,
  isHighRiskProfile,
  isRegulatedProfile,
  loadComplianceConfig,
  parseTomlDocument,
  validateDeployerPreflight,
  type ComplianceProfile,
  type DeployerPreflightViolation,
  type ResolvedComplianceConfig
} from "./config.ts";
import { detectConceptDrift, type ConceptDriftReport } from "./concept-drift.ts";
import { DEFAULT_EU_AI_ACT_DECLARE_RULES, evaluateDeclareRules } from "./declare-conformance.ts";
import { formatGitProvenanceTrailer } from "./disclosure.ts";
import { validateOcel2, type Ocel2Document } from "./ocel2.ts";
import { discoverOcDfg } from "./ocel-discover.ts";
import { readOcel2Sqlite } from "./ocel-sqlite.ts";
import { enforceOversightArgs } from "./oversight.ts";
import { findPackageRoot, loadAiroRiskRegister } from "./risk-ledger.ts";
import { auditRpmFact, type RpmFactAuditReport } from "./rpm-fact.ts";
import { SignatureRetryLimiter } from "./transactional-net.ts";

const FORBIDDEN_STATIC_CONCURRENCY_KEYS = [
  "concurrency",
  "wip",
  "workers",
  "max_parallel"
] as const;

export interface ExtendedTomlSections {
  rollbackOnDirty: boolean;
  hasPmm: boolean;
  aimd: Record<string, unknown>;
  retries: Record<string, unknown>;
  budgets: Record<string, unknown>;
}

export function validateExtendedTomlSections(rawText: string): ExtendedTomlSections {
  const doc = parseTomlDocument(rawText);
  const aimdRaw = doc.aimd;
  const aimd =
    aimdRaw && typeof aimdRaw === "object" && !Array.isArray(aimdRaw)
      ? (aimdRaw as Record<string, unknown>)
      : {};

  for (const key of FORBIDDEN_STATIC_CONCURRENCY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(aimd, key)) {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        `STATIC_CONCURRENCY_FORBIDDEN: [aimd].${key} is forbidden; concurrency must be governed dynamically by Kingman/AIMD.`,
        "admission_vacuous"
      );
    }
  }

  const retriesRaw = doc.retries;
  const retries =
    retriesRaw && typeof retriesRaw === "object" && !Array.isArray(retriesRaw)
      ? (retriesRaw as Record<string, unknown>)
      : {};

  let rollbackOnDirty = true;
  if (Object.prototype.hasOwnProperty.call(retries, "rollback_on_dirty")) {
    if (typeof retries.rollback_on_dirty !== "boolean") {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        "Field 'retries.rollback_on_dirty' must be a boolean."
      );
    }
    rollbackOnDirty = retries.rollback_on_dirty;
  }

  const budgetsRaw = doc.budgets;
  const budgets =
    budgetsRaw && typeof budgetsRaw === "object" && !Array.isArray(budgetsRaw)
      ? (budgetsRaw as Record<string, unknown>)
      : {};

  return {
    rollbackOnDirty,
    hasPmm: Object.prototype.hasOwnProperty.call(doc, "pmm"),
    aimd,
    retries,
    budgets
  };
}

export interface LoadedOcelLog {
  path: string;
  filename: string;
  doc: Ocel2Document;
}

export function loadOcelLogsFromDirectory(logsDir: string): LoadedOcelLog[] {
  if (!existsSync(logsDir)) {
    throw new ComplianceRefusalError(
      "LOGGING_UNAVAILABLE",
      `OCEL logs directory does not exist: '${logsDir}'.`,
      "R_missing_consequence"
    );
  }
  const st = statSync(logsDir);
  if (!st.isDirectory()) {
    throw new ComplianceRefusalError(
      "LOGGING_UNAVAILABLE",
      `OCEL logs path '${logsDir}' is not a directory.`,
      "mu_on_O"
    );
  }

  const filenames = readdirSync(logsDir)
    .filter(
      (f) =>
        f.endsWith(".ocel.json") ||
        f.endsWith(".jsonocel") ||
        f.endsWith(".sqlite") ||
        f.endsWith(".ocel.sqlite")
    )
    .sort((a, b) => a.localeCompare(b));

  const out: LoadedOcelLog[] = [];
  for (const filename of filenames) {
    const abs = join(logsDir, filename);
    if (!statSync(abs).isFile()) continue;
    if (filename.endsWith(".sqlite") || filename.endsWith(".ocel.sqlite")) {
      const doc = readOcel2Sqlite(abs);
      out.push({ path: abs, filename, doc });
    } else {
      const raw = readFileSync(abs, "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new ComplianceRefusalError(
          "INVALID_COMPLIANCE_CONFIG",
          `Failed to parse JSON OCEL file '${abs}': ${(err as Error).message}`
        );
      }
      out.push({ path: abs, filename, doc: parsed as Ocel2Document });
    }
  }
  return out;
}

export interface DeployerCheckResult {
  schema: "zcode.deployer-check/1";
  ok: boolean;
  admitted: boolean;
  standing: "ALIVE" | "REFUSED";
  exitCode: 0 | 1 | 2;
  profile: ComplianceProfile;
  overseer_id: string | null;
  log_retention_days: number;
  monitoring_enabled: boolean;
  worker_notice_acknowledged: boolean;
  violations: DeployerPreflightViolation[];
}

export function runDeployerCheck(options: {
  configPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
} = {}): DeployerCheckResult {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  if (options.configPath && !existsSync(options.configPath)) {
    throw new ComplianceRefusalError(
      "INVALID_COMPLIANCE_CONFIG",
      `Compliance config file not found at '${options.configPath}'.`
    );
  }

  const cfg = loadComplianceConfig({
    cwd,
    configPath: options.configPath,
    env
  });

  if (cfg.configPresent) {
    validateExtendedTomlSections(readFileSync(cfg.configPath, "utf8"));
  }

  enforceOversightArgs([], cfg, env);
  const preflight = validateDeployerPreflight(cfg);
  const ok = preflight.ok;

  return {
    schema: "zcode.deployer-check/1",
    ok,
    admitted: ok,
    standing: ok ? "ALIVE" : "REFUSED",
    exitCode: ok ? 0 : 1,
    profile: cfg.compliance.profile,
    overseer_id: cfg.deployer.overseer_id ?? null,
    log_retention_days: cfg.deployer.log_retention_days,
    monitoring_enabled: cfg.deployer.monitoring_enabled,
    worker_notice_acknowledged: cfg.deployer.worker_notice_acknowledged,
    violations: preflight.violations
  };
}

export interface QmsManifest {
  schema?: string;
  clauses: Array<{
    id?: string;
    clause?: string;
    title?: string;
    files?: string[];
    evidence?: string[];
    path?: string;
  }>;
}

export function validateQmsManifest(pkgRoot: string): {
  ok: boolean;
  clauseCount: number;
  missingPaths: string[];
  manifestSha256: string;
} {
  const manifestPath = join(pkgRoot, "compliance", "qms-manifest.json");
  if (!existsSync(manifestPath)) {
    return { ok: false, clauseCount: 0, missingPaths: ["compliance/qms-manifest.json"], manifestSha256: "" };
  }
  const raw = readFileSync(manifestPath, "utf8");
  const manifestSha256 = createHash("sha256").update(raw, "utf8").digest("hex");
  const parsed = JSON.parse(raw) as QmsManifest;
  const clauses = parsed.clauses ?? [];
  const missingPaths: string[] = [];

  for (const clause of clauses) {
    const paths = [
      ...(clause.files ?? []),
      ...(clause.evidence ?? []),
      ...(clause.path ? [clause.path] : [])
    ];
    if (paths.length === 0) {
      missingPaths.push(`clause:${clause.id ?? clause.clause ?? "unknown"}:no_paths`);
      continue;
    }
    for (const rel of paths) {
      const abs = resolve(pkgRoot, rel);
      if (!existsSync(abs)) missingPaths.push(rel);
    }
  }

  return {
    ok: clauses.length >= 13 && missingPaths.length === 0,
    clauseCount: clauses.length,
    missingPaths,
    manifestSha256
  };
}

function readAttr(
  attrs: readonly { name: string; value: unknown }[] | Record<string, unknown> | undefined,
  key: string
): string | undefined {
  if (!attrs) return undefined;
  if (Array.isArray(attrs)) {
    for (const a of attrs) {
      if (a && typeof a === "object" && (a as { name: string }).name === key) {
        return String((a as { value: unknown }).value ?? "");
      }
    }
    return undefined;
  }
  const rec = attrs as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(rec, key) ? String(rec[key] ?? "") : undefined;
}

function resolveGitDir(cwd: string): string | undefined {
  try {
    const raw = execFileSync("git", ["rev-parse", "--git-dir"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (raw) {
      return resolve(cwd, raw);
    }
  } catch {
    // Fallback walk-up if git is unavailable or index is locked
  }
  let current = resolve(cwd);
  while (true) {
    const candidate = join(current, ".git");
    if (existsSync(candidate)) {
      if (statSync(candidate).isDirectory()) {
        return candidate;
      }
      try {
        const text = readFileSync(candidate, "utf8");
        const match = text.match(/^gitdir:\s*(.+)$/m);
        if (match?.[1]) {
          return resolve(current, match[1].trim());
        }
      } catch {
        return candidate;
      }
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function checkGitWorkspaceState(cwd: string): {
  isGitRepo: boolean;
  indexLocked: boolean;
  dirty: boolean;
} {
  const gitDir = resolveGitDir(cwd);
  if (!gitDir) {
    return { isGitRepo: false, indexLocked: false, dirty: false };
  }
  const indexLocked = existsSync(join(gitDir, "index.lock"));
  let dirty = false;
  try {
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    dirty = status.length > 0;
  } catch {
    dirty = indexLocked;
  }
  return { isGitRepo: true, indexLocked, dirty };
}

export interface ConformityAssessmentResult {
  schema: "zcode.conformity-assessment/1";
  regulation: "Regulation (EU) 2024/1689";
  procedure: "Annex VI (Internal Control)";
  verdict: "CONFORMITY_ADMITTED" | "REFUSED" | "UNVERIFIED";
  standing: "ALIVE" | "PARTIAL_ALIVE" | "REFUSED" | "UNVERIFIED";
  exitCode: 0 | 1 | 2;
  profile: ComplianceProfile;
  logsAnalyzed: number;
  qms: { ok: boolean; clauseCount: number; missingPaths: string[] };
  reasons: string[];
  warnings: string[];
  declareSummary?: { witnessed: number; vacuous: number; violated: number };
  rpmSummary?: { standing: string; missingE2oRatio: number; confidentialityPassed: boolean; fairnessPassed: boolean };
  driftSummary?: { evaluated: boolean; driftDetected: boolean; driftKind: string };
}

export function runConformityAssessment(options: {
  logsDir?: string;
  packageRoot?: string;
  cwd?: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
} = {}): ConformityAssessmentResult {
  const pkgRoot = options.packageRoot ?? findPackageRoot();
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;

  const cfg = loadComplianceConfig({ cwd, configPath: options.configPath, env });
  const extToml = cfg.configPresent
    ? validateExtendedTomlSections(readFileSync(cfg.configPath, "utf8"))
    : { rollbackOnDirty: true, hasPmm: true, aimd: {}, retries: {}, budgets: {} };

  enforceOversightArgs([], cfg, env);
  const qms = validateQmsManifest(pkgRoot);

  const reasons: string[] = [];
  const warnings: string[] = [];

  if (!qms.ok) {
    reasons.push(
      `QMS manifest invalid (clauses=${qms.clauseCount}, missing=${qms.missingPaths.join(", ")})`
    );
  }

  if (isRegulatedProfile(cfg.compliance.profile)) {
    const preflight = validateDeployerPreflight(cfg);
    if (!preflight.ok) {
      for (const v of preflight.violations) {
        reasons.push(`${v.code}: ${v.message}`);
      }
    }
  }

  const logsDir = options.logsDir ?? env.ZCODE_OCEL_DIR?.trim();
  if (!logsDir) {
    return {
      schema: "zcode.conformity-assessment/1",
      regulation: "Regulation (EU) 2024/1689",
      procedure: "Annex VI (Internal Control)",
      verdict: "UNVERIFIED",
      standing: "UNVERIFIED",
      exitCode: 1,
      profile: cfg.compliance.profile,
      logsAnalyzed: 0,
      qms: { ok: qms.ok, clauseCount: qms.clauseCount, missingPaths: qms.missingPaths },
      reasons: [...reasons, "UNVERIFIED: no logs directory supplied (--logs <dir>)."],
      warnings
    };
  }

  const loadedLogs = loadOcelLogsFromDirectory(logsDir);
  if (loadedLogs.length === 0) {
    return {
      schema: "zcode.conformity-assessment/1",
      regulation: "Regulation (EU) 2024/1689",
      procedure: "Annex VI (Internal Control)",
      verdict: "UNVERIFIED",
      standing: "UNVERIFIED",
      exitCode: 1,
      profile: cfg.compliance.profile,
      logsAnalyzed: 0,
      qms: { ok: qms.ok, clauseCount: qms.clauseCount, missingPaths: qms.missingPaths },
      reasons: [...reasons, `UNVERIFIED: 0 logs found in '${logsDir}'.`],
      warnings
    };
  }

  const docs = loadedLogs.map((l) => l.doc);
  let witnessed = 0;
  let vacuous = 0;
  let violated = 0;

  for (const item of loadedLogs) {
    if (!item.doc.events || item.doc.events.length === 0) {
      reasons.push(`UNVERIFIED: log '${item.filename}' contains 0 events.`);
      continue;
    }

    const val = validateOcel2(item.doc, { requireHashChain: true });
    if (!val.ok) {
      reasons.push(`Log '${item.filename}' failed OCEL 2.0 integrity: ${val.errors.join("; ")}`);
    }

    const dec = evaluateDeclareRules(item.doc, DEFAULT_EU_AI_ACT_DECLARE_RULES);
    witnessed += dec.witnessedCount;
    vacuous += dec.vacuousCount;
    violated += dec.violatedCount;
    if (!dec.allMandatorySatisfied) {
      const failedRules = dec.results.filter((r) => r.mandatory && r.status === "VIOLATED").map((r) => r.id);
      reasons.push(
        `Log '${item.filename}' violated mandatory Declare rule(s): ${failedRules.join(", ")}`
      );
    }

    // Per-signature retry cap check via SignatureRetryLimiter
    const limiter = new SignatureRetryLimiter(cfg.compliance.max_retries_per_signature);
    for (const ev of item.doc.events) {
      if (ev.type === "turn_failed" || ev.type === "transition_refused") {
        const sig = readAttr(ev.attributes, "error_signature") ?? readAttr(ev.attributes, "reason") ?? ev.type;
        try {
          limiter.recordFailure(sig, ev.id);
        } catch (err) {
          if (err instanceof ComplianceRefusalError) {
            reasons.push(err.message);
          } else {
            reasons.push(String(err));
          }
        }
      }
    }

    // Check regulated oversight requirements in log events
    if (isRegulatedProfile(cfg.compliance.profile)) {
      for (const ev of item.doc.events) {
        if (ev.type === "permission_resolved") {
          const ov = readAttr(ev.attributes, "overseer_id");
          if (!ov || !ov.trim()) {
            reasons.push(`OVERSIGHT_POLICY_REFUSED: permission_resolved event '${ev.id}' missing overseer_id.`);
          }
        }
        if (isHighRiskProfile(cfg.compliance.profile) && ev.type === "art50_disclosure_emitted") {
          const mid = readAttr(ev.attributes, "model_id");
          const pid = readAttr(ev.attributes, "provider_id");
          if (!mid?.trim() || !pid?.trim()) {
            reasons.push(`PROVENANCE_SEAL_FAILED: art50_disclosure_emitted '${ev.id}' missing provider_id/model_id.`);
          }
        }
      }
    }
  }

  // Workspace git dirty-state & .git/index.lock check (unconditional fail-closed)
  const gitState = checkGitWorkspaceState(cwd);
  if (gitState.indexLocked) {
    reasons.push(
      "ROLLBACK_FAILED: .git/index.lock present; atomic git rollback is blocked."
    );
  }
  if (gitState.dirty && !extToml.rollbackOnDirty) {
    reasons.push(
      "DIRTY_TIMEOUT_REFUSED: dirty git workspace detected with [retries].rollback_on_dirty = false."
    );
  }

  const rpm = auditRpmFact(docs, {
    redactPii: cfg.compliance.redact_pii,
    redactEnv: cfg.compliance.redact_env,
    env
  });
  const secretOrPiiViolations = rpm.confidentiality.violations.filter((v) => v.kind === "secret_or_pii");
  if (secretOrPiiViolations.length > 0) {
    reasons.push(
      `REDACTION_FAILURE: RPM confidentiality audit found ${secretOrPiiViolations.length} unredacted secret/PII violation(s).`
    );
  } else if (!rpm.confidentiality.passed) {
    warnings.push(
      `RPM note: ${rpm.confidentiality.violations.length} internal actor ID(s) present; use 'ocel export --rpm-safe' before external sharing.`
    );
  }
  if (rpm.accuracy.chainStatus === "BROKEN" || rpm.accuracy.danglingE2oCount > 0) {
    reasons.push(
      `OCEL chain/accuracy failure: chainStatus=${rpm.accuracy.chainStatus}, danglingE2O=${rpm.accuracy.danglingE2oCount}`
    );
  }

  const dfg = discoverOcDfg(docs, { minReviewMs: cfg.compliance.min_review_ms });
  if (dfg.oversightBottlenecks.some((b) => b.kind === "rubber_stamp")) {
    warnings.push("AB_RISK_FLAG: rapid permission approvals (< min_review_ms) observed in soak logs.");
  }

  let driftReport: ConceptDriftReport | null = null;
  if (docs.length >= cfg.pmm.min_window) {
    driftReport = detectConceptDrift(docs, {
      alpha: cfg.pmm.drift_alpha,
      minWindow: cfg.pmm.min_window
    });
    if (driftReport.driftDetected) {
      warnings.push(`PMM concept drift detected (${driftReport.driftKind}, p=${driftReport.pValue}).`);
    }
  } else {
    warnings.push(
      `PMM statistical drift window partial (${docs.length} < min_window ${cfg.pmm.min_window}).`
    );
  }

  const admitted = reasons.length === 0;
  const standing: ConformityAssessmentResult["standing"] = !admitted
    ? "REFUSED"
    : docs.length >= cfg.pmm.min_window && rpm.standing === "ALIVE"
      ? "ALIVE"
      : "PARTIAL_ALIVE";

  return {
    schema: "zcode.conformity-assessment/1",
    regulation: "Regulation (EU) 2024/1689",
    procedure: "Annex VI (Internal Control)",
    verdict: admitted ? "CONFORMITY_ADMITTED" : "REFUSED",
    standing,
    exitCode: admitted ? 0 : 1,
    profile: cfg.compliance.profile,
    logsAnalyzed: loadedLogs.length,
    qms: { ok: qms.ok, clauseCount: qms.clauseCount, missingPaths: qms.missingPaths },
    reasons,
    warnings,
    declareSummary: { witnessed, vacuous, violated },
    rpmSummary: {
      standing: rpm.standing,
      missingE2oRatio: rpm.missingE2oRatio,
      confidentialityPassed: rpm.confidentiality.passed,
      fairnessPassed: rpm.fairness.passed
    },
    driftSummary: {
      evaluated: driftReport !== null,
      driftDetected: driftReport?.driftDetected ?? false,
      driftKind: driftReport?.driftKind ?? "none"
    }
  };
}

export interface EuDeclarationOfConformity {
  schema: "zcode.annex-v-doc/1";
  regulation: "Regulation (EU) 2024/1689";
  annex: "Annex V";
  ai_system: {
    name: string;
    distribution_version: string;
    runtime_app_version: string;
    compliance_profile: ComplianceProfile;
  };
  provider: {
    name: string;
    repository: string;
    license: string;
  };
  runtime_lock: {
    schemaVersion: number;
    appVersion: string;
    platform: string;
    arch: string;
    url: string;
    sha512: string;
  };
  git_head_sha: string;
  conformity_assessment_procedure: string;
  qms_manifest_sha256: string;
  standards_applied: string[];
  deployer_requirements: {
    overseer_id: string;
    log_retention_days: number;
    monitoring_enabled: boolean;
  };
  provenance_trailer?: string;
  issued_at: string;
}

export function generateEuDeclarationOfConformity(options: {
  outPath: string;
  packageRoot?: string;
  cwd?: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
}): EuDeclarationOfConformity {
  const pkgRoot = options.packageRoot ?? findPackageRoot();
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;

  const cfg = loadComplianceConfig({ cwd, configPath: options.configPath, env });
  if (cfg.configPresent) {
    validateExtendedTomlSections(readFileSync(cfg.configPath, "utf8"));
  }
  enforceOversightArgs([], cfg, env);
  const preflight = validateDeployerPreflight(cfg);
  if (!preflight.ok) {
    const first = preflight.violations[0]!;
    throw new ComplianceRefusalError(first.code, first.message, "admission_vacuous");
  }

  const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
    name?: string;
    version?: string;
    author?: string;
    license?: string;
    repository?: { url?: string };
  };
  const lock = JSON.parse(readFileSync(join(pkgRoot, "zcode-runtime.lock.json"), "utf8")) as {
    schemaVersion: number;
    appVersion: string;
    platform: string;
    arch: string;
    url: string;
    sha512: string;
  };
  const qms = validateQmsManifest(pkgRoot);
  let gitHeadSha = "0".repeat(40);
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: pkgRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (/^[0-9a-f]{40}$/u.test(head)) gitHeadSha = head;
  } catch {
    // keep zero sha fallback outside git
  }

  const trailer = formatGitProvenanceTrailer({
    config: cfg,
    cliVersion: pkg.version ?? "0.0.0",
    provider: "zcode-cli",
    model: lock.appVersion
  });

  const doc: EuDeclarationOfConformity = {
    schema: "zcode.annex-v-doc/1",
    regulation: "Regulation (EU) 2024/1689",
    annex: "Annex V",
    ai_system: {
      name: pkg.name ?? "zcode-app-cli",
      distribution_version: pkg.version ?? "0.0.0",
      runtime_app_version: lock.appVersion,
      compliance_profile: cfg.compliance.profile
    },
    provider: {
      name: pkg.author ?? "zcode-cli maintainers",
      repository: pkg.repository?.url ?? "https://github.com/kingsword09/zcode-cli",
      license: pkg.license ?? "MIT"
    },
    runtime_lock: lock,
    git_head_sha: gitHeadSha,
    conformity_assessment_procedure: "Annex VI (Internal Control) — Art. 43",
    qms_manifest_sha256: qms.manifestSha256,
    standards_applied: [
      "Regulation (EU) 2024/1689 (Arts. 9-15, 17, 26-27, 43, 47, 50, 72, 73)",
      "IEEE OCEL 2.0 (JSON / SQLite WAL / XML)",
      "W3C AIRO & DPV / DPV-AI",
      "Declare / LTLf Anti-Vacuity Conformance & Optimal A* Trace Alignment"
    ],
    deployer_requirements: {
      overseer_id: cfg.deployer.overseer_id ?? "",
      log_retention_days: cfg.deployer.log_retention_days,
      monitoring_enabled: cfg.deployer.monitoring_enabled
    },
    ...(trailer ? { provenance_trailer: trailer } : {}),
    issued_at: new Date().toISOString()
  };

  mkdirSync(dirname(options.outPath), { recursive: true });
  const tmp = `${options.outPath}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n", "utf8");
    renameSync(tmp, options.outPath);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  return doc;
}

export interface FriaReport {
  schema: "zcode.fria-report/1";
  regulation: "Regulation (EU) 2024/1689 Art. 27";
  article: "Article 27(1)(a)-(f)";
  profile: ComplianceProfile;
  overseer_id: string;
  deployer_processes_art27_1_a: Record<string, unknown>;
  period_and_frequency_art27_1_b: Record<string, unknown>;
  affected_categories_art27_1_c: string[];
  specific_risks_of_harm_art27_1_d: Array<{ id: string; severity?: string; controls: string[] }>;
  human_oversight_measures_art27_1_e: Record<string, unknown>;
  governance_and_mitigation_art27_1_f: Record<string, unknown>;
  rpm_metrics: {
    k_anonymity: number;
    confidentiality_passed: boolean;
    fairness_passed: boolean;
    logs_evaluated: number;
    audit?: RpmFactAuditReport;
  };
}

export function exportFriaReport(options: {
  outPath: string;
  format: "json" | "md";
  packageRoot?: string;
  cwd?: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
}): { report: FriaReport; content: string } {
  const pkgRoot = options.packageRoot ?? findPackageRoot();
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;

  const cfg = loadComplianceConfig({ cwd, configPath: options.configPath, env });
  enforceOversightArgs([], cfg, env);
  const preflight = validateDeployerPreflight(cfg);
  if (!preflight.ok) {
    const first = preflight.violations[0]!;
    throw new ComplianceRefusalError(first.code, first.message, "admission_vacuous");
  }

  const riskReport = loadAiroRiskRegister({ packageRoot: pkgRoot, config: cfg });

  let rpmAudit: RpmFactAuditReport | undefined;
  let logsEvaluated = 0;
  const ocelDir = env.ZCODE_OCEL_DIR?.trim();
  if (ocelDir && existsSync(ocelDir) && statSync(ocelDir).isDirectory()) {
    const loaded = loadOcelLogsFromDirectory(ocelDir);
    if (loaded.length > 0) {
      logsEvaluated = loaded.length;
      rpmAudit = auditRpmFact(
        loaded.map((l) => l.doc),
        { redactPii: cfg.compliance.redact_pii, redactEnv: cfg.compliance.redact_env, env }
      );
    }
  }

  const report: FriaReport = {
    schema: "zcode.fria-report/1",
    regulation: "Regulation (EU) 2024/1689 Art. 27",
    article: "Article 27(1)(a)-(f)",
    profile: cfg.compliance.profile,
    overseer_id: cfg.deployer.overseer_id ?? "",
    deployer_processes_art27_1_a: {
      intended_deployment: "Supervised software engineering and automated verification workflows",
      authority_ceiling: "CONSTRUCT",
      worker_notice_acknowledged: cfg.deployer.worker_notice_acknowledged
    },
    period_and_frequency_art27_1_b: {
      log_retention_days: cfg.deployer.log_retention_days,
      monitoring_enabled: cfg.deployer.monitoring_enabled,
      pmm_min_window: cfg.pmm.min_window,
      pmm_drift_alpha: cfg.pmm.drift_alpha
    },
    affected_categories_art27_1_c: [
      "Deployer engineering operators",
      "Designated human overseers",
      "Repository maintainers & downstream contract consumers",
      "Data subjects whose PII or credentials may traverse tool contexts"
    ],
    specific_risks_of_harm_art27_1_d: riskReport.risks.map((r) => ({
      id: r.id,
      severity: r.severity,
      controls: r.controls
    })),
    human_oversight_measures_art27_1_e: {
      overseer_id: cfg.deployer.overseer_id ?? "",
      allow_yolo: cfg.compliance.allow_yolo,
      min_review_ms: cfg.compliance.min_review_ms,
      emergency_stop_supported: true,
      subagent_oversight_propagation: true
    },
    governance_and_mitigation_art27_1_f: {
      incident_reporting_procedure: "zcode incident report (Art. 73 2d/10d/15d escalation)",
      post_market_monitoring: "zcode pmm analyze (Bose/van der Aalst concept drift + Kingman + RPM FACT)",
      transactional_rollback_cap: cfg.compliance.max_retries_per_signature
    },
    rpm_metrics: {
      k_anonymity: cfg.pmm.k_anonymity,
      confidentiality_passed: rpmAudit ? rpmAudit.confidentiality.passed : cfg.compliance.redact_pii,
      fairness_passed: rpmAudit ? rpmAudit.fairness.passed : true,
      logs_evaluated: logsEvaluated,
      ...(rpmAudit ? { audit: rpmAudit } : {})
    }
  };

  const content =
    options.format === "md"
      ? [
          "# Fundamental Rights Impact Assessment (EU AI Act Article 27)",
          "",
          `- **Profile**: \`${report.profile}\``,
          `- **Designated Overseer ID**: \`${report.overseer_id}\``,
          `- **Log Retention**: \`${cfg.deployer.log_retention_days} days\` | **Monitoring Enabled**: \`${String(cfg.deployer.monitoring_enabled)}\``,
          `- **RPM Confidentiality**: k_anonymity=\`${report.rpm_metrics.k_anonymity}\`, confidentiality_passed=\`${String(report.rpm_metrics.confidentiality_passed)}\`, fairness_passed=\`${String(report.rpm_metrics.fairness_passed)}\``,
          "",
          "## Art. 27(1)(c) Affected Groups",
          "",
          ...report.affected_categories_art27_1_c.map((c) => `- ${c}`),
          "",
          "## Art. 27(1)(d) Identified Risks & Controls",
          "",
          ...report.specific_risks_of_harm_art27_1_d.map(
            (r) => `- \`${r.id}\` (${r.severity ?? "assessed"}): ${r.controls.join(", ")}`
          ),
          "",
          "## Art. 27(1)(e)-(f) Human Oversight & Remediation",
          "",
          `- \`allow_yolo=${String(cfg.compliance.allow_yolo)}\`, \`min_review_ms=${cfg.compliance.min_review_ms} ms\``,
          "- Incident reporting via `zcode incident report`; PMM drift analysis via `zcode pmm analyze`."
        ].join("\n") + "\n"
      : JSON.stringify(report, null, 2) + "\n";

  mkdirSync(dirname(options.outPath), { recursive: true });
  const tmp = `${options.outPath}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, content, "utf8");
    renameSync(tmp, options.outPath);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }

  return { report, content };
}
