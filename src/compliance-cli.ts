import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  closeSync
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  ComplianceRefusalError,
  defaultComplianceConfigPath,
  isHighRiskProfile,
  isRegulatedProfile,
  loadComplianceConfig,
  type ResolvedComplianceConfig
} from "./compliance/config.ts";
import { computeAlignmentConformance, normalizeWorkflowNet } from "./compliance/conformance.ts";
import { evaluateDeclareRules, type DeclareRule, type DeclareRulesDocument } from "./compliance/declare-conformance.ts";
import {
  formatGitProvenanceTrailer,
  writeProvenanceSidecar,
  type ProvenanceSidecarDocument
} from "./compliance/disclosure.ts";
import {
  COMPLIANCE_O2O_QUALIFIERS,
  serializeOcel2Xml,
  upgradeLegacyOcelToOcel2,
  validateOcel2,
  type Ocel2Document
} from "./compliance/ocel2.ts";
import {
  discoverOcDfg,
  formatOcDfgDot,
  formatOcDfgMermaid
} from "./compliance/ocel-discover.ts";
import { readOcel2Sqlite, writeOcel2Sqlite } from "./compliance/ocel-sqlite.ts";
import { discoverOcpn, formatOcpnDot, formatOcpnMermaid } from "./compliance/ocpn.ts";
import {
  checkAnnexIvDossier,
  compileAnnexIvDossier
} from "./compliance/annex-iv-report.ts";
import { generateIncidentReportPacket, runPmmAnalysis } from "./compliance/pmm-incident.ts";
import {
  exportFriaReport,
  generateEuDeclarationOfConformity,
  loadOcelLogsFromDirectory,
  runConformityAssessment,
  runDeployerCheck
} from "./compliance/qms-conformity.ts";
import {
  buildComplianceInfo,
  findPackageRoot,
  formatComplianceInfoMarkdown,
  formatRiskRegisterMarkdown,
  loadAiroRiskRegister
} from "./compliance/risk-ledger.ts";
import { anonymizeOcel2KAnon, auditRpmFact } from "./compliance/rpm-fact.ts";

interface ParsedFlags {
  flags: Record<string, string | boolean>;
  positionals: string[];
}

function parseStrictFlags(
  args: readonly string[],
  valueFlags: ReadonlySet<string>,
  booleanFlags: ReadonlySet<string>,
  cmdLabel: string
): ParsedFlags {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--") {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith("-")) {
      positionals.push(arg);
      continue;
    }

    const eqIdx = arg.indexOf("=");
    const name = eqIdx >= 0 ? arg.slice(0, eqIdx) : arg;
    const inlineVal = eqIdx >= 0 ? arg.slice(eqIdx + 1) : undefined;

    if (valueFlags.has(name)) {
      let val = inlineVal;
      if (val === undefined) {
        const next = args[i + 1];
        if (next === undefined || next.startsWith("--")) {
          throw new CliUsageError(`Missing required value for '${name}' in '${cmdLabel}'.`);
        }
        val = next;
        i++;
      }
      if (!val.trim()) {
        throw new CliUsageError(`Flag '${name}' in '${cmdLabel}' requires a non-empty value.`);
      }
      flags[name] = val;
      continue;
    }

    if (booleanFlags.has(name)) {
      if (inlineVal !== undefined) {
        throw new CliUsageError(`Boolean flag '${name}' in '${cmdLabel}' does not accept a value.`);
      }
      flags[name] = true;
      continue;
    }

    throw new CliUsageError(`Unknown flag '${name}' for '${cmdLabel}'.`);
  }

  return { flags, positionals };
}

class CliUsageError extends Error {
  readonly exitCode = 2 as const;
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export function resolveComplianceTomlPath(
  explicitConfigFlag: string | undefined,
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
): string {
  if (explicitConfigFlag !== undefined) {
    const resolved = resolve(cwd, explicitConfigFlag);
    if (!existsSync(resolved)) {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        `Specified compliance config file does not exist: '${resolved}'.`
      );
    }
    return resolved;
  }
  const envCfg = env.ZCODE_CONFIG_PATH?.trim();
  if (envCfg && envCfg.toLowerCase().endsWith(".toml")) {
    return resolve(cwd, envCfg);
  }
  return defaultComplianceConfigPath(cwd);
}

function sha256FileHex(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256TextHex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, content, "utf8");
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

function isSqliteInput(filePath: string): boolean {
  if (filePath.endsWith(".sqlite") || filePath.endsWith(".ocel.sqlite") || filePath.endsWith(".db")) {
    return true;
  }
  try {
    const fd = openSync(filePath, "r");
    try {
      const buf = Buffer.alloc(16);
      const bytesRead = readSync(fd, buf, 0, 16, 0);
      return bytesRead >= 15 && buf.subarray(0, 15).toString("utf8") === "SQLite format 3";
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

function loadOcelDocumentStrict(filePath: string): Ocel2Document {
  if (!existsSync(filePath)) {
    throw new CliUsageError(`Input OCEL file not found: '${filePath}'.`);
  }
  if (statSync(filePath).isDirectory()) {
    throw new CliUsageError(`Expected an OCEL file for --in, got directory '${filePath}'.`);
  }
  if (isSqliteInput(filePath)) {
    return readOcel2Sqlite(filePath);
  }
  const raw = readFileSync(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CliUsageError(`Failed to parse JSON OCEL file '${filePath}': ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliUsageError(`Invalid OCEL JSON root in '${filePath}': expected object.`);
  }
  const rec = parsed as Record<string, unknown>;
  const missingArrays = (["objectTypes", "eventTypes", "objects", "events"] as const).filter(
    (k) => !Array.isArray(rec[k])
  );
  if (missingArrays.length > 0) {
    throw new CliUsageError(
      `Invalid OCEL 2.0 schema in '${filePath}': missing required array(s): ${missingArrays.join(", ")}.`
    );
  }
  return parsed as Ocel2Document;
}

function readAttrStr(
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

function verifyWorkspaceProvenanceSidecars(
  doc: Ocel2Document,
  inPath: string,
  cwd: string
): string[] {
  const provDir = join(cwd, ".zcode-provenance");
  if (!existsSync(provDir) || !statSync(provDir).isDirectory()) return [];

  const sessionIds = new Set(doc.objects.filter((o) => o.type === "session").map((o) => o.id));
  const inFileSha = sha256FileHex(inPath);
  const errors: string[] = [];

  for (const name of readdirSync(provDir).sort()) {
    if (!name.endsWith(".json")) continue;
    const abs = join(provDir, name);
    let sidecar: Record<string, unknown>;
    try {
      const parsedSidecar: unknown = JSON.parse(readFileSync(abs, "utf8"));
      if (!parsedSidecar || typeof parsedSidecar !== "object" || Array.isArray(parsedSidecar)) {
        errors.push(`PROVENANCE_SEAL_FAILED: invalid provenance sidecar root in '${abs}': expected object.`);
        continue;
      }
      sidecar = parsedSidecar as Record<string, unknown>;
    } catch (err) {
      errors.push(`PROVENANCE_SEAL_FAILED: corrupt provenance sidecar '${abs}': ${(err as Error).message}`);
      continue;
    }

    const sid = typeof sidecar.session_id === "string" ? sidecar.session_id : "";
    const matchesSession = sid.length > 0 && sessionIds.has(sid);
    const hasExportPath = typeof sidecar.export_path === "string" && sidecar.export_path.length > 0;
    const exportPathMatches = hasExportPath && resolve(cwd, String(sidecar.export_path)) === resolve(inPath);
    const matchesModifiedSpan =
      Array.isArray(sidecar.modified_spans) &&
      (sidecar.modified_spans as Array<{ path?: string; file_path?: string }>).some((s) => {
        const spanPath =
          typeof s?.path === "string"
            ? s.path
            : typeof s?.file_path === "string"
              ? s.file_path
              : undefined;
        return spanPath !== undefined && resolve(cwd, spanPath) === resolve(inPath);
      });
    const matchesArtifact = hasExportPath
      ? exportPathMatches || matchesModifiedSpan
      : sidecar.artifact_sha256 !== undefined || sidecar.sha256 !== undefined || matchesModifiedSpan;

    if (!matchesSession && !matchesArtifact) continue;

    if (hasExportPath && !exportPathMatches) {
      errors.push(
        `PROVENANCE_SEAL_FAILED: provenance sidecar '${name}' has unsealed or mismatched export_path '${String(sidecar.export_path)}' (expected '${inPath}').`
      );
    }

    // Unconditionally require schema_version === "1.0" and string seal_sha256 over the canonical
    // unsealed ProvenanceSidecarDocument fields
    if (sidecar.schema_version !== "1.0") {
      errors.push(
        `PROVENANCE_SEAL_FAILED: provenance sidecar '${name}' missing or unsupported schema_version '${String(sidecar.schema_version)}'.`
      );
    }
    if (typeof sidecar.seal_sha256 !== "string" || sidecar.seal_sha256.length === 0) {
      errors.push(
        `PROVENANCE_SEAL_FAILED: provenance sidecar '${name}' missing required seal_sha256.`
      );
    } else {
      const unsealed = {
        schema_version: sidecar.schema_version,
        article: sidecar.article,
        session_id: sidecar.session_id,
        compliance_profile: sidecar.compliance_profile,
        provider: sidecar.provider,
        model: sidecar.model,
        ocel_head_hash: sidecar.ocel_head_hash,
        generated_at: sidecar.generated_at,
        modified_spans: sidecar.modified_spans,
        span_count: sidecar.span_count
      };
      const expectedSeal = sha256TextHex(JSON.stringify(unsealed));
      if (expectedSeal !== sidecar.seal_sha256) {
        errors.push(
          `PROVENANCE_SEAL_FAILED: provenance sidecar '${name}' seal_sha256 mismatch (tamper detected).`
        );
      }
    }

    // Verify sha256 / artifact_sha256 if present
    for (const key of ["sha256", "artifact_sha256"] as const) {
      const recorded = sidecar[key];
      if (typeof recorded === "string" && recorded.length > 0 && recorded !== inFileSha) {
        const spans = Array.isArray(sidecar.modified_spans)
          ? (sidecar.modified_spans as Array<{ sha256?: string }>)
          : [];
        const matchesSpan = spans.some((s) => s.sha256 === recorded);
        if (!matchesSpan) {
          errors.push(
            `PROVENANCE_SEAL_FAILED: provenance sidecar '${name}' ${key} mismatch (${recorded} !== ${inFileSha}).`
          );
        }
      }
    }

    // Verify modified_spans hashes on disk (confined to workspace via realpathSync, fail-closed on missing)
    if (Array.isArray(sidecar.modified_spans)) {
      const cwdReal = realpathSync(cwd);
      for (const span of sidecar.modified_spans as Array<{ path?: string; file_path?: string; sha256?: string }>) {
        const spanPath = span.path ?? span.file_path;
        if (!spanPath || !span.sha256) continue;
        const target = resolve(cwd, spanPath);
        if (!existsSync(target)) {
          errors.push(
            `PROVENANCE_SEAL_FAILED: sealed span '${spanPath}' is missing on disk in sidecar '${name}'.`
          );
          continue;
        }
        let targetReal: string;
        try {
          targetReal = realpathSync(target);
        } catch (err) {
          errors.push(
            `PROVENANCE_SEAL_FAILED: failed to canonicalize span '${spanPath}' in sidecar '${name}': ${(err as Error).message}`
          );
          continue;
        }
        const relTarget = relative(cwdReal, targetReal);
        if (!relTarget || relTarget.startsWith("..") || isAbsolute(relTarget)) {
          errors.push(
            `PROVENANCE_SEAL_FAILED: span '${spanPath}' escapes workspace '${cwdReal}' in sidecar '${name}'.`
          );
          continue;
        }
        if (!statSync(targetReal).isFile()) {
          errors.push(
            `PROVENANCE_SEAL_FAILED: sealed span '${spanPath}' is not a regular file in sidecar '${name}'.`
          );
          continue;
        }
        const actualSha = sha256FileHex(targetReal);
        if (actualSha !== span.sha256) {
          errors.push(
            `PROVENANCE_SEAL_FAILED: span '${spanPath}' SHA-256 mismatch in sidecar '${name}'.`
          );
        }
      }
    }
  }

  return errors;
}

function handleCliError(err: unknown): number {
  if (err instanceof ComplianceRefusalError) {
    process.stderr.write(`${err.message}\n`);
    return err.exitCode;
  }
  if (err instanceof CliUsageError) {
    process.stderr.write(`${err.message}\n`);
    return err.exitCode;
  }
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${msg}\n`);
  return 2;
}

async function handleComplianceSubcommand(args: readonly string[]): Promise<number> {
  const sub = args[0];
  const rest = args.slice(1);
  const cwd = process.cwd();
  const env = process.env;
  const pkgRoot = findPackageRoot();

  switch (sub) {
    case "info": {
      const { flags } = parseStrictFlags(
        rest,
        new Set(["--format", "--config"]),
        new Set(["--json", "--md"]),
        "compliance info"
      );
      const fmt = typeof flags["--format"] === "string"
        ? flags["--format"]
        : flags["--md"]
          ? "md"
          : "json";
      if (fmt !== "json" && fmt !== "md") {
        throw new CliUsageError(`Unsupported --format '${fmt}' for 'compliance info'; expected json or md.`);
      }
      const configPath = resolveComplianceTomlPath(
        typeof flags["--config"] === "string" ? flags["--config"] : undefined,
        cwd,
        env
      );
      const info = buildComplianceInfo({ packageRoot: pkgRoot, configPath, cwd, env });
      if (fmt === "md") {
        process.stdout.write(formatComplianceInfoMarkdown(info));
      } else {
        process.stdout.write(JSON.stringify(info, null, 2) + "\n");
      }
      return 0;
    }

    case "risk-register": {
      const { flags } = parseStrictFlags(
        rest,
        new Set(["--format", "--config"]),
        new Set(["--json", "--md"]),
        "compliance risk-register"
      );
      const fmt = typeof flags["--format"] === "string"
        ? flags["--format"]
        : flags["--md"]
          ? "md"
          : "json";
      if (fmt !== "json" && fmt !== "md") {
        throw new CliUsageError(
          `Unsupported --format '${fmt}' for 'compliance risk-register'; expected json or md.`
        );
      }
      const configPath = resolveComplianceTomlPath(
        typeof flags["--config"] === "string" ? flags["--config"] : undefined,
        cwd,
        env
      );
      const report = loadAiroRiskRegister({ packageRoot: pkgRoot, configPath, cwd, env });
      if (fmt === "md") {
        process.stdout.write(formatRiskRegisterMarkdown(report));
      } else {
        process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      }
      return 0;
    }

    case "annex-iv": {
      const { flags } = parseStrictFlags(
        rest,
        new Set(["--out", "--logs", "--config"]),
        new Set(["--check", "--json"]),
        "compliance annex-iv"
      );
      const outDir = flags["--out"];
      if (typeof outDir !== "string" || !outDir.trim()) {
        throw new CliUsageError("Missing required flag --out <dir> for 'compliance annex-iv'.");
      }
      const resolvedOut = resolve(cwd, outDir);
      const configPath = resolveComplianceTomlPath(
        typeof flags["--config"] === "string" ? flags["--config"] : undefined,
        cwd,
        env
      );
      const logsDir = typeof flags["--logs"] === "string" ? resolve(cwd, flags["--logs"]) : undefined;

      if (flags["--check"]) {
        const res = checkAnnexIvDossier({
          outDir: resolvedOut,
          packageRoot: pkgRoot,
          cwd,
          configPath,
          env,
          logsDir
        });
        process.stdout.write(JSON.stringify(res, null, 2) + "\n");
        if (!res.ok) {
          process.stderr.write(res.errors.join("\n") + "\n");
          return 1;
        }
        return 0;
      }

      const compiled = compileAnnexIvDossier({
        outDir: resolvedOut,
        packageRoot: pkgRoot,
        cwd,
        configPath,
        env,
        logsDir
      });
      process.stdout.write(
        JSON.stringify(
          {
            ok: true,
            jsonPath: compiled.jsonPath,
            mdPath: compiled.mdPath,
            gitHeadSha: compiled.dossier.gitHeadSha,
            dossierSha256: compiled.dossier.dossierSha256
          },
          null,
          2
        ) + "\n"
      );
      return 0;
    }

    case "assess": {
      const { flags } = parseStrictFlags(
        rest,
        new Set(["--logs", "--config"]),
        new Set(["--json"]),
        "compliance assess"
      );
      const configPath = resolveComplianceTomlPath(
        typeof flags["--config"] === "string" ? flags["--config"] : undefined,
        cwd,
        env
      );
      const logsDir = typeof flags["--logs"] === "string" ? resolve(cwd, flags["--logs"]) : undefined;
      const result = runConformityAssessment({
        logsDir,
        packageRoot: pkgRoot,
        cwd,
        configPath,
        env
      });
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      if (result.reasons.length > 0) {
        process.stderr.write(result.reasons.join("\n") + "\n");
      }
      return result.exitCode;
    }

    case "doc": {
      const { flags } = parseStrictFlags(
        rest,
        new Set(["--out", "--config"]),
        new Set(["--json"]),
        "compliance doc"
      );
      const outArg = flags["--out"];
      if (typeof outArg !== "string" || !outArg.trim()) {
        throw new CliUsageError("Missing required flag --out <file> for 'compliance doc'.");
      }
      const configPath = resolveComplianceTomlPath(
        typeof flags["--config"] === "string" ? flags["--config"] : undefined,
        cwd,
        env
      );
      const doc = generateEuDeclarationOfConformity({
        outPath: resolve(cwd, outArg),
        packageRoot: pkgRoot,
        cwd,
        configPath,
        env
      });
      process.stdout.write(JSON.stringify(doc, null, 2) + "\n");
      return 0;
    }

    case "deployer-check": {
      const { flags } = parseStrictFlags(
        rest,
        new Set(["--config"]),
        new Set(["--json"]),
        "compliance deployer-check"
      );
      const configPath = resolveComplianceTomlPath(
        typeof flags["--config"] === "string" ? flags["--config"] : undefined,
        cwd,
        env
      );
      const res = runDeployerCheck({ configPath, cwd, env });
      process.stdout.write(JSON.stringify(res, null, 2) + "\n");
      if (!res.ok) {
        process.stderr.write(res.violations.map((v) => `${v.code}: ${v.message}`).join("\n") + "\n");
      }
      return res.exitCode;
    }

    case "fria-export": {
      const { flags } = parseStrictFlags(
        rest,
        new Set(["--out", "--format", "--config"]),
        new Set(["--json", "--md"]),
        "compliance fria-export"
      );
      const outArg = flags["--out"];
      if (typeof outArg !== "string" || !outArg.trim()) {
        throw new CliUsageError("Missing required flag --out <file> for 'compliance fria-export'.");
      }
      const fmt = typeof flags["--format"] === "string"
        ? flags["--format"]
        : flags["--md"]
          ? "md"
          : "json";
      if (fmt !== "json" && fmt !== "md") {
        throw new CliUsageError(
          `Unsupported --format '${fmt}' for 'compliance fria-export'; expected json or md.`
        );
      }
      const configPath = resolveComplianceTomlPath(
        typeof flags["--config"] === "string" ? flags["--config"] : undefined,
        cwd,
        env
      );
      const { report } = exportFriaReport({
        outPath: resolve(cwd, outArg),
        format: fmt,
        packageRoot: pkgRoot,
        cwd,
        configPath,
        env
      });
      process.stdout.write(
        JSON.stringify({ ok: true, out: resolve(cwd, outArg), format: fmt, overseer_id: report.overseer_id }, null, 2) + "\n"
      );
      return 0;
    }

    default:
      throw new CliUsageError(
        `Unknown compliance subcommand '${sub ?? ""}'. Supported subcommands: info, risk-register, annex-iv, assess, doc, deployer-check, fria-export.`
      );
  }
}

async function handleOcelSubcommand(args: readonly string[]): Promise<number> {
  const sub = args[0];
  const rest = args.slice(1);
  const cwd = process.cwd();
  const env = process.env;

  switch (sub) {
    case "verify": {
      const { flags } = parseStrictFlags(
        rest,
        new Set(["--in", "--declare", "--wfnet", "--config"]),
        new Set(["--json"]),
        "ocel verify"
      );
      const inArg = flags["--in"];
      if (typeof inArg !== "string" || !inArg.trim()) {
        throw new CliUsageError("Missing required flag --in <file> for 'ocel verify'.");
      }
      const configPath = resolveComplianceTomlPath(
        typeof flags["--config"] === "string" ? flags["--config"] : undefined,
        cwd,
        env
      );
      const cfg = loadComplianceConfig({ cwd, configPath, env });
      const inPath = resolve(cwd, inArg);
      const doc = loadOcelDocumentStrict(inPath);

      let wfJson: unknown;
      if (typeof flags["--wfnet"] === "string") {
        const wfPath = resolve(cwd, flags["--wfnet"]);
        if (!existsSync(wfPath)) {
          throw new CliUsageError(`WF-net model file not found: '${wfPath}'.`);
        }
        try {
          wfJson = JSON.parse(readFileSync(wfPath, "utf8"));
        } catch (err) {
          throw new CliUsageError(`Failed to parse WF-net JSON '${wfPath}': ${(err as Error).message}`);
        }
        // Fail closed (exit 2) on malformed/unsound WF-net before empty-trace checks
        normalizeWorkflowNet(wfJson as Parameters<typeof normalizeWorkflowNet>[0]);
      }

      if (doc.events.length === 0 && !wfJson) {
        const msg = "UNVERIFIED: OCEL log contains 0 events (empty log).";
        process.stderr.write(`${msg}\n`);
        process.stdout.write(
          JSON.stringify({ valid: false, chainIntact: false, eventCount: 0, standing: "UNVERIFIED", errors: [msg] }, null, 2) + "\n"
        );
        return 1;
      }

      const val = validateOcel2(doc, {
        requireHashChain: true,
        requireAttrHash: true,
        requireObjHash: true
      });
      const errors = [...val.errors];
      const warnings = [...val.warnings];
      const flagsOut: string[] = [];

      // Regulated provenance & oversight event checks
      if (isRegulatedProfile(cfg.compliance.profile) || cfg.compliance.git_provenance_trailer) {
        for (const ev of doc.events) {
          if (isHighRiskProfile(cfg.compliance.profile) && ev.type === "art50_disclosure_emitted") {
            const modelId = readAttrStr(ev.attributes, "model_id");
            const providerId = readAttrStr(ev.attributes, "provider_id");
            if (!modelId?.trim() || !providerId?.trim()) {
              errors.push(
                `PROVENANCE_SEAL_FAILED: art50_disclosure_emitted event '${ev.id}' missing provider_id or model_id under profile '${cfg.compliance.profile}'.`
              );
            }
          }
          if (isRegulatedProfile(cfg.compliance.profile) && ev.type === "permission_resolved") {
            const overseerId = readAttrStr(ev.attributes, "overseer_id");
            if (!overseerId?.trim()) {
              errors.push(
                `OVERSIGHT_POLICY_REFUSED: permission_resolved event '${ev.id}' missing overseer_id under regulated profile '${cfg.compliance.profile}'.`
              );
            }
            const latRaw = readAttrStr(ev.attributes, "decision_latency_ms");
            const decision = (readAttrStr(ev.attributes, "decision") ?? "allow").toLowerCase();
            if (latRaw !== undefined && (decision === "allow" || decision === "allow_always" || decision === "modify")) {
              const lat = Number(latRaw);
              if (Number.isFinite(lat) && lat < cfg.compliance.min_review_ms) {
                flagsOut.push("AB_RISK_FLAG");
                warnings.push(
                  `AB_RISK_FLAG: permission_resolved '${ev.id}' decision_latency_ms (${lat}ms) < min_review_ms (${cfg.compliance.min_review_ms}ms).`
                );
              }
            }
          }
        }
        errors.push(...verifyWorkspaceProvenanceSidecars(doc, inPath, cwd));
      } else {
        // Even under standard profile, still check AB_RISK_FLAG & tampered sidecars if present
        for (const ev of doc.events) {
          if (ev.type === "permission_resolved") {
            const latRaw = readAttrStr(ev.attributes, "decision_latency_ms");
            const decision = (readAttrStr(ev.attributes, "decision") ?? "allow").toLowerCase();
            if (latRaw !== undefined && (decision === "allow" || decision === "allow_always" || decision === "modify")) {
              const lat = Number(latRaw);
              if (Number.isFinite(lat) && lat < cfg.compliance.min_review_ms) {
                flagsOut.push("AB_RISK_FLAG");
                warnings.push(
                  `AB_RISK_FLAG: permission_resolved '${ev.id}' decision_latency_ms (${lat}ms) < min_review_ms (${cfg.compliance.min_review_ms}ms).`
                );
              }
            }
          }
        }
        errors.push(...verifyWorkspaceProvenanceSidecars(doc, inPath, cwd));
      }

      const rpm = auditRpmFact(doc, {
        redactPii: cfg.compliance.redact_pii,
        redactEnv: cfg.compliance.redact_env,
        env
      });

      let declareReport;
      if (typeof flags["--declare"] === "string") {
        const decPath = resolve(cwd, flags["--declare"]);
        if (!existsSync(decPath)) {
          throw new CliUsageError(`Declare rules file not found: '${decPath}'.`);
        }
        let parsedRules: DeclareRule[] | DeclareRulesDocument;
        try {
          parsedRules = JSON.parse(readFileSync(decPath, "utf8")) as DeclareRule[] | DeclareRulesDocument;
        } catch (err) {
          throw new CliUsageError(`Failed to parse Declare rules JSON '${decPath}': ${(err as Error).message}`);
        }
        declareReport = evaluateDeclareRules(doc, parsedRules);
        if (!declareReport.allMandatorySatisfied) {
          const violated = declareReport.results
            .filter((r) => r.mandatory && r.status === "VIOLATED")
            .map((r) => r.id);
          errors.push(`Mandatory Declare rule(s) VIOLATED: ${violated.join(", ")}`);
        }
      }

      let alignmentReport;
      if (wfJson) {
        alignmentReport = computeAlignmentConformance(
          doc,
          wfJson as Parameters<typeof computeAlignmentConformance>[1]
        );
        if (alignmentReport.alignmentCost > 0) {
          errors.push(
            `Trace alignment deviations detected: alignmentCost=${alignmentReport.alignmentCost}, fitness=${alignmentReport.fitness.toFixed(4)}.`
          );
        }
      }

      const valid = errors.length === 0;
      const standing =
        !val.ok || rpm.accuracy.chainStatus === "BROKEN"
          ? "BUILD_BROKEN"
          : rpm.accuracy.missingE2oRatio > 0
            ? "PARTIAL_ALIVE"
            : valid
              ? rpm.standing
              : "PARTIAL_ALIVE";

      const outPayload = {
        schema: "zcode.ocel-verify/1",
        valid,
        chainIntact: val.ok && rpm.accuracy.chainStatus !== "BROKEN",
        eventCount: doc.events.length,
        objectCount: doc.objects.length,
        standing,
        missingE2oRatio: rpm.accuracy.missingE2oRatio,
        completeness: 1 - rpm.accuracy.missingE2oRatio,
        flags: [...new Set(flagsOut)],
        warnings,
        errors,
        explanations: rpm.explanations,
        ...(declareReport ? { declareResults: declareReport.results, declare: declareReport } : {}),
        ...(alignmentReport ? { alignment: alignmentReport } : {})
      };

      process.stdout.write(JSON.stringify(outPayload, null, 2) + "\n");
      if (!valid) {
        process.stderr.write(errors.join("\n") + "\n");
        return 1;
      }
      return 0;
    }

    case "discover": {
      const { flags } = parseStrictFlags(
        rest,
        new Set(["--in", "--format", "--out", "--config"]),
        new Set(["--ocpn", "--json"]),
        "ocel discover"
      );
      const inArg = flags["--in"];
      if (typeof inArg !== "string" || !inArg.trim()) {
        throw new CliUsageError("Missing required flag --in <dir|file> for 'ocel discover'.");
      }
      const fmt = typeof flags["--format"] === "string" ? flags["--format"] : "json";
      if (fmt !== "json" && fmt !== "dot" && fmt !== "mermaid") {
        throw new CliUsageError(
          `Unsupported --format '${fmt}' for 'ocel discover'; expected json, dot, or mermaid.`
        );
      }
      const configPath = resolveComplianceTomlPath(
        typeof flags["--config"] === "string" ? flags["--config"] : undefined,
        cwd,
        env
      );
      const cfg = loadComplianceConfig({ cwd, configPath, env });
      const inPath = resolve(cwd, inArg);
      if (!existsSync(inPath)) {
        throw new CliUsageError(`Input path does not exist for 'ocel discover': '${inPath}'.`);
      }

      const docs = statSync(inPath).isDirectory()
        ? loadOcelLogsFromDirectory(inPath).map((l) => l.doc)
        : [loadOcelDocumentStrict(inPath)];
      if (docs.length === 0) {
        throw new CliUsageError(`No OCEL log files found in directory '${inPath}'.`);
      }

      const dfg = discoverOcDfg(docs, { minReviewMs: cfg.compliance.min_review_ms });
      let rendered: string;
      if (flags["--ocpn"]) {
        const ocpn = discoverOcpn(dfg);
        if (fmt === "dot") rendered = formatOcpnDot(ocpn) + "\n";
        else if (fmt === "mermaid") rendered = formatOcpnMermaid(ocpn) + "\n";
        else rendered = JSON.stringify(ocpn, null, 2) + "\n";
      } else {
        if (fmt === "dot") rendered = formatOcDfgDot(dfg) + "\n";
        else if (fmt === "mermaid") rendered = formatOcDfgMermaid(dfg) + "\n";
        else rendered = JSON.stringify(dfg, null, 2) + "\n";
      }

      if (typeof flags["--out"] === "string") {
        atomicWrite(resolve(cwd, flags["--out"]), rendered);
      } else {
        process.stdout.write(rendered);
      }
      return 0;
    }

    case "export": {
      const { flags } = parseStrictFlags(
        rest,
        new Set(["--in", "--format", "--out", "--k", "--config"]),
        new Set(["--rpm-safe", "--json"]),
        "ocel export"
      );
      const inArg = flags["--in"];
      const outArg = flags["--out"];
      if (typeof inArg !== "string" || !inArg.trim()) {
        throw new CliUsageError("Missing required flag --in <file> for 'ocel export'.");
      }
      if (typeof outArg !== "string" || !outArg.trim()) {
        throw new CliUsageError("Missing required flag --out <file> for 'ocel export'.");
      }
      const fmt = typeof flags["--format"] === "string" ? flags["--format"] : "json";
      if (fmt !== "json" && fmt !== "sqlite" && fmt !== "xml") {
        throw new CliUsageError(
          `Unsupported --format '${fmt}' for 'ocel export'; expected json, sqlite, or xml.`
        );
      }

      const configPath = resolveComplianceTomlPath(
        typeof flags["--config"] === "string" ? flags["--config"] : undefined,
        cwd,
        env
      );
      const cfg = loadComplianceConfig({ cwd, configPath, env });
      const inPath = resolve(cwd, inArg);
      const outPath = resolve(cwd, outArg);
      const inputDoc = loadOcelDocumentStrict(inPath);

      const rpmSafe = Boolean(flags["--rpm-safe"]);
      let kVal = cfg.pmm.k_anonymity;
      if (flags["--k"] !== undefined) {
        const parsedK = Number(flags["--k"]);
        if (!Number.isInteger(parsedK) || parsedK < 2) {
          throw new CliUsageError(
            `Invalid --k '${String(flags["--k"])}' for --rpm-safe export: k_anonymity requires integer k >= 2.`
          );
        }
        kVal = parsedK;
      } else if (rpmSafe && kVal < 2) {
        throw new CliUsageError(`Invalid k_anonymity (${kVal}): k >= 2 is required for --rpm-safe export.`);
      }

      let salt = "";
      if (rpmSafe) {
        const rawSalt = env.ZCODE_RPM_SALT;
        const trimmedSalt = rawSalt?.trim() ?? "";
        if (!trimmedSalt || /^0+$/.test(trimmedSalt)) {
          throw new ComplianceRefusalError(
            "REDACTION_FAILURE",
            "ZCODE_RPM_SALT must be a non-empty, non-zero cryptographic salt for --rpm-safe pseudonymization.",
            "R_missing_authority"
          );
        }
        salt = rawSalt!;
      }

      const redactOpts = {
        redactPii: cfg.compliance.redact_pii,
        redactEnv: cfg.compliance.redact_env,
        env
      };

      let finalDoc = upgradeLegacyOcelToOcel2(inputDoc, {
        rechain: true,
        config: cfg,
        redactOptions: redactOpts
      });

      if (rpmSafe) {
        const anon = anonymizeOcel2KAnon(finalDoc, kVal, salt, { suppressBelowK: true });
        if (anon.retainedTraces === 0) {
          process.stderr.write(
            `k-anonymity refusal: 0 traces remained with support >= ${kVal} (${anon.suppressedTraces} suppressed).\n`
          );
          return 1;
        }
        finalDoc = upgradeLegacyOcelToOcel2(anon.doc, {
          rechain: true,
          config: cfg,
          redactOptions: { redactPii: true, redactEnv: cfg.compliance.redact_env, env }
        });
      }

      if (fmt === "sqlite") {
        mkdirSync(dirname(outPath), { recursive: true });
        writeOcel2Sqlite(finalDoc, outPath, { journalMode: "WAL" });
      } else if (fmt === "xml") {
        atomicWrite(outPath, serializeOcel2Xml(finalDoc));
      } else {
        atomicWrite(outPath, JSON.stringify(finalDoc, null, 2) + "\n");
      }

      // Art. 50(2) provenance sidecar when regulated profile or git_provenance_trailer=true
      let sidecarPath: string | undefined;
      if (isRegulatedProfile(cfg.compliance.profile) || cfg.compliance.git_provenance_trailer) {
        const exportedSha = sha256FileHex(outPath);
        const rawSessionId = finalDoc.objects.find((o) => o.type === "session")?.id ?? "session_export";
        const safeSessionId = rawSessionId.replace(/[^A-Za-z0-9._-]+/g, "_") || "session_export";
        const reqObj = finalDoc.objects.find((o) => o.type === "model_request");
        const discEv = finalDoc.events.find((e) => e.type === "art50_disclosure_emitted");
        const provider =
          readAttrStr(reqObj?.attributes, "provider_id") ??
          readAttrStr(discEv?.attributes, "provider_id") ??
          "zcode-cli";
        const model =
          readAttrStr(reqObj?.attributes, "model_id") ??
          readAttrStr(discEv?.attributes, "model_id") ??
          "configured-model";
        const lastPiHash =
          finalDoc.events.length > 0
            ? (readAttrStr(finalDoc.events[finalDoc.events.length - 1]!.attributes, "pi_hash") ?? exportedSha)
            : exportedSha;

        const cwdReal = realpathSync(cwd);
        const outReal = realpathSync(outPath);
        const relOut = relative(cwdReal, outReal);
        const outInsideCwd = Boolean(relOut && !relOut.startsWith("..") && !isAbsolute(relOut));

        const res = writeProvenanceSidecar({
          sessionId: safeSessionId,
          workspaceDir: cwd,
          provider,
          model,
          profile: cfg.compliance.profile,
          ocelHeadHash: lastPiHash,
          modifiedSpans: outInsideCwd && fmt !== "sqlite" ? [{ filePath: relOut }] : [],
          redactPii: cfg.compliance.redact_pii,
          redactOptions: redactOpts
        });

        const trailer = formatGitProvenanceTrailer({
          config: cfg,
          provider,
          model,
          sessionId: safeSessionId
        });

        const augmented: ProvenanceSidecarDocument & {
          sha256: string;
          artifact_sha256: string;
          export_path: string;
          git_trailer?: string;
        } = {
          ...res.document,
          sha256: exportedSha,
          artifact_sha256: exportedSha,
          export_path: outPath,
          ...(trailer ? { git_trailer: trailer } : {})
        };
        atomicWrite(res.sidecarPath, JSON.stringify(augmented, null, 2) + "\n");
        sidecarPath = res.sidecarPath;
      }

      process.stdout.write(
        JSON.stringify(
          {
            ok: true,
            format: fmt,
            out: outPath,
            eventCount: finalDoc.events.length,
            objectCount: finalDoc.objects.length,
            o2oQualifiers: COMPLIANCE_O2O_QUALIFIERS,
            ...(sidecarPath ? { provenanceSidecar: sidecarPath } : {})
          },
          null,
          2
        ) + "\n"
      );
      return 0;
    }

    default:
      throw new CliUsageError(
        `Unknown ocel subcommand '${sub ?? ""}'. Supported subcommands: verify, discover, export.`
      );
  }
}

async function handlePmmSubcommand(args: readonly string[]): Promise<number> {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub !== "analyze") {
    throw new CliUsageError(`Unknown pmm subcommand '${sub ?? ""}'. Supported subcommand: analyze.`);
  }
  const cwd = process.cwd();
  const env = process.env;
  const { flags } = parseStrictFlags(
    rest,
    new Set(["--logs", "--out", "--config"]),
    new Set(["--json"]),
    "pmm analyze"
  );
  const logsArg = flags["--logs"];
  if (typeof logsArg !== "string" || !logsArg.trim()) {
    throw new CliUsageError("Missing required flag --logs <dir> for 'pmm analyze'.");
  }
  const configPath = resolveComplianceTomlPath(
    typeof flags["--config"] === "string" ? flags["--config"] : undefined,
    cwd,
    env
  );
  const outPath = typeof flags["--out"] === "string" ? resolve(cwd, flags["--out"]) : undefined;
  const report = runPmmAnalysis({
    logsDir: resolve(cwd, logsArg),
    outPath,
    cwd,
    configPath,
    env
  });
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  return 0;
}

async function handleIncidentSubcommand(args: readonly string[]): Promise<number> {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub !== "report") {
    throw new CliUsageError(`Unknown incident subcommand '${sub ?? ""}'. Supported subcommand: report.`);
  }
  const cwd = process.cwd();
  const env = process.env;
  const { flags } = parseStrictFlags(
    rest,
    new Set(["--in", "--out", "--session", "--config"]),
    new Set(["--json"]),
    "incident report"
  );
  const inArg = flags["--in"];
  const outArg = flags["--out"];
  const sessionArg = flags["--session"];
  if (typeof inArg !== "string" || !inArg.trim()) {
    throw new CliUsageError("Missing required flag --in <file> for 'incident report'.");
  }
  if (typeof outArg !== "string" || !outArg.trim()) {
    throw new CliUsageError("Missing required flag --out <file> for 'incident report'.");
  }
  if (typeof sessionArg !== "string" || !sessionArg.trim()) {
    throw new CliUsageError("Missing required flag --session <id> for 'incident report'.");
  }
  const configPath = resolveComplianceTomlPath(
    typeof flags["--config"] === "string" ? flags["--config"] : undefined,
    cwd,
    env
  );
  const packet = generateIncidentReportPacket({
    inPath: resolve(cwd, inArg),
    outPath: resolve(cwd, outArg),
    sessionId: sessionArg.trim(),
    cwd,
    configPath,
    env
  });
  process.stdout.write(JSON.stringify(packet, null, 2) + "\n");
  return 0;
}

function handleVersionCompliance(): number {
  const pkgRoot = findPackageRoot();
  const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
    name?: string;
    version?: string;
    engines?: { node?: string };
  };
  const lock = JSON.parse(readFileSync(join(pkgRoot, "zcode-runtime.lock.json"), "utf8")) as {
    appVersion?: string;
    sha512?: string;
  };
  let cliVersion = "0.16.9";
  try {
    const ext = JSON.parse(readFileSync(join(pkgRoot, "vendor", "extraction.json"), "utf8")) as {
      cliVersion?: string;
    };
    if (ext.cliVersion) cliVersion = ext.cliVersion;
  } catch {
    // optional in fresh clone
  }
  let profile = "standard";
  try {
    const cfgPath = resolveComplianceTomlPath(undefined, process.cwd(), process.env);
    profile = loadComplianceConfig({ cwd: process.cwd(), configPath: cfgPath, env: process.env }).compliance.profile;
  } catch {
    // version --compliance remains hermetic even with malformed workspace config
  }

  process.stdout.write(
    JSON.stringify(
      {
        name: pkg.name ?? "zcode-app-cli",
        version: pkg.version ?? "0.0.0",
        runtime_app_version: lock.appVersion ?? "0.0.0",
        runtime_cli_version: cliVersion,
        runtime_lock_sha512: lock.sha512 ?? "",
        node_engine: pkg.engines?.node ?? ">=22.19.0",
        regulation: "Regulation (EU) 2024/1689 (EU AI Act)",
        compliance_profile: profile,
        ocel_standard: "IEEE OCEL 2.0",
        articles_supported: [9, 10, 11, 12, 13, 14, 15, 17, 26, 27, 43, 47, 50, 72, 73]
      },
      null,
      2
    ) + "\n"
  );
  return 0;
}

export async function runComplianceCommand(args: readonly string[]): Promise<number | undefined> {
  if (args.length === 0) return undefined;
  const cmd = args[0];

  if (
    (cmd === "version" || cmd === "--version" || cmd === "-v") &&
    args.includes("--compliance")
  ) {
    try {
      return handleVersionCompliance();
    } catch (err) {
      return handleCliError(err);
    }
  }

  if (cmd !== "compliance" && cmd !== "ocel" && cmd !== "pmm" && cmd !== "incident") {
    return undefined;
  }

  try {
    if (cmd === "compliance") return await handleComplianceSubcommand(args.slice(1));
    if (cmd === "ocel") return await handleOcelSubcommand(args.slice(1));
    if (cmd === "pmm") return await handlePmmSubcommand(args.slice(1));
    if (cmd === "incident") return await handleIncidentSubcommand(args.slice(1));
    return undefined;
  } catch (err) {
    return handleCliError(err);
  }
}
