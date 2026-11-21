import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix, win32 } from "node:path";

export const COMPLIANCE_PROFILES = [
  "standard",
  "art50-only",
  "high-risk-annex-iii",
  "high-risk-annex-i"
] as const;

export type ComplianceProfile = (typeof COMPLIANCE_PROFILES)[number];

export type ComplianceRefusalCode =
  | "OVERSIGHT_POLICY_REFUSED"
  | "DISCLOSURE_REQUIRED"
  | "LOGGING_UNAVAILABLE"
  | "REDACTION_FAILURE"
  | "PROVENANCE_SEAL_FAILED"
  | "RETRY_BUDGET_EXHAUSTED"
  | "INVALID_COMPLIANCE_PROFILE"
  | "INVALID_COMPLIANCE_CONFIG";

export const COMPLIANCE_REFUSAL_EXIT_CODES: Readonly<Record<ComplianceRefusalCode, 1 | 2>> = {
  OVERSIGHT_POLICY_REFUSED: 1,
  DISCLOSURE_REQUIRED: 1,
  LOGGING_UNAVAILABLE: 2,
  REDACTION_FAILURE: 2,
  PROVENANCE_SEAL_FAILED: 1,
  RETRY_BUDGET_EXHAUSTED: 1,
  INVALID_COMPLIANCE_PROFILE: 1,
  INVALID_COMPLIANCE_CONFIG: 2
};

export class ComplianceRefusalError extends Error {
  readonly code: ComplianceRefusalCode;
  readonly exitCode: 1 | 2;
  readonly brokenTerm?: string;

  constructor(code: ComplianceRefusalCode, message: string, brokenTerm?: string) {
    super(`${code}: ${message}`);
    this.name = "ComplianceRefusalError";
    this.code = code;
    this.exitCode = COMPLIANCE_REFUSAL_EXIT_CODES[code];
    this.brokenTerm = brokenTerm;
  }
}

export interface ComplianceSectionConfig {
  profile: ComplianceProfile;
  redact_pii: boolean;
  min_review_ms: number;
  git_provenance_trailer: boolean;
  allow_yolo: boolean;
  max_retries_per_signature: number;
  redact_env: string[];
}

export interface DeployerSectionConfig {
  overseer_id?: string;
  log_retention_days: number;
  monitoring_enabled: boolean;
  worker_notice_acknowledged: boolean;
}

export interface PmmSectionConfig {
  drift_alpha: number;
  min_window: number;
  k_anonymity: number;
}

export interface ResolvedComplianceConfig {
  compliance: ComplianceSectionConfig;
  deployer: DeployerSectionConfig;
  pmm: PmmSectionConfig;
  complianceLogEnabled: boolean;
  complianceDir: string;
  configPath: string;
  configPresent: boolean;
}

export interface DeployerPreflightViolation {
  code: ComplianceRefusalCode;
  field: string;
  message: string;
}

export interface DeployerPreflightResult {
  ok: boolean;
  violations: DeployerPreflightViolation[];
}

export function isRegulatedProfile(profile: ComplianceProfile): boolean {
  return profile !== "standard";
}

export function isHighRiskProfile(profile: ComplianceProfile): boolean {
  return profile === "high-risk-annex-iii" || profile === "high-risk-annex-i";
}

export function complianceDirectory(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  fallbackHome = homedir()
): string {
  if (env.ZCODE_COMPLIANCE_DIR !== undefined) {
    const trimmed = env.ZCODE_COMPLIANCE_DIR.trim();
    if (!trimmed) {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        "ZCODE_COMPLIANCE_DIR must be a non-empty path when defined.",
        "mu_on_O"
      );
    }
    return trimmed;
  }
  const pathImpl = platform === "win32" ? win32 : posix;
  const home = (platform === "win32" ? env.USERPROFILE : env.HOME)?.trim() || fallbackHome;
  return pathImpl.join(home, ".zcode", "compliance");
}

export function defaultComplianceConfigPath(cwd: string = process.cwd()): string {
  return join(cwd, "zcode-cli.toml");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface TomlCursor {
  src: string;
  pos: number;
  line: number;
}

function skipWhitespaceAndComments(cur: TomlCursor, stopAtNewline: boolean): void {
  while (cur.pos < cur.src.length) {
    const ch = cur.src[cur.pos]!;
    if (ch === " " || ch === "\t") {
      cur.pos++;
      continue;
    }
    if (ch === "\r") {
      if (stopAtNewline) return;
      cur.pos++;
      continue;
    }
    if (ch === "\n") {
      if (stopAtNewline) return;
      cur.pos++;
      cur.line++;
      continue;
    }
    if (ch === "#") {
      while (cur.pos < cur.src.length && cur.src[cur.pos] !== "\n") {
        cur.pos++;
      }
      if (stopAtNewline) return;
      continue;
    }
    break;
  }
}

function tomlError(cur: TomlCursor, message: string): ComplianceRefusalError {
  return new ComplianceRefusalError(
    "INVALID_COMPLIANCE_CONFIG",
    `TOML parse error at line ${cur.line}: ${message}`,
    "mu_on_O"
  );
}

function parseBasicString(cur: TomlCursor): string {
  cur.pos++; // consume opening '"'
  let out = "";
  while (cur.pos < cur.src.length) {
    const ch = cur.src[cur.pos]!;
    if (ch === '"') {
      cur.pos++;
      return out;
    }
    if (ch === "\n" || ch === "\r") {
      throw tomlError(cur, "unterminated basic string");
    }
    if (ch === "\\") {
      cur.pos++;
      if (cur.pos >= cur.src.length) throw tomlError(cur, "unterminated escape sequence");
      const esc = cur.src[cur.pos]!;
      cur.pos++;
      switch (esc) {
        case "b": out += "\b"; break;
        case "t": out += "\t"; break;
        case "n": out += "\n"; break;
        case "f": out += "\f"; break;
        case "r": out += "\r"; break;
        case '"': out += '"'; break;
        case "\\": out += "\\"; break;
        case "u": {
          const hex = cur.src.slice(cur.pos, cur.pos + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw tomlError(cur, "invalid \\uXXXX escape");
          out += String.fromCharCode(Number.parseInt(hex, 16));
          cur.pos += 4;
          break;
        }
        case "U": {
          const hex = cur.src.slice(cur.pos, cur.pos + 8);
          if (!/^[0-9a-fA-F]{8}$/.test(hex)) throw tomlError(cur, "invalid \\UXXXXXXXX escape");
          out += String.fromCodePoint(Number.parseInt(hex, 16));
          cur.pos += 8;
          break;
        }
        default:
          throw tomlError(cur, `unknown escape sequence \\${esc}`);
      }
      continue;
    }
    out += ch;
    cur.pos++;
  }
  throw tomlError(cur, "unterminated basic string");
}

function parseLiteralString(cur: TomlCursor): string {
  cur.pos++; // consume opening "'"
  let out = "";
  while (cur.pos < cur.src.length) {
    const ch = cur.src[cur.pos]!;
    if (ch === "'") {
      cur.pos++;
      return out;
    }
    if (ch === "\n" || cur.pos === cur.src.length || ch === "\r") {
      throw tomlError(cur, "unterminated literal string");
    }
    out += ch;
    cur.pos++;
  }
  throw tomlError(cur, "unterminated literal string");
}

function parseKeyToken(cur: TomlCursor): string {
  skipWhitespaceAndComments(cur, true);
  if (cur.pos >= cur.src.length) throw tomlError(cur, "expected key");
  const ch = cur.src[cur.pos]!;
  if (ch === '"') return parseBasicString(cur);
  if (ch === "'") return parseLiteralString(cur);
  const start = cur.pos;
  while (cur.pos < cur.src.length && /[A-Za-z0-9_-]/.test(cur.src[cur.pos]!)) {
    cur.pos++;
  }
  if (cur.pos === start) throw tomlError(cur, `invalid key character '${ch}'`);
  return cur.src.slice(start, cur.pos);
}

function parseKeyPath(cur: TomlCursor): string[] {
  const path: string[] = [parseKeyToken(cur)];
  while (true) {
    skipWhitespaceAndComments(cur, true);
    if (cur.src[cur.pos] === ".") {
      cur.pos++;
      path.push(parseKeyToken(cur));
    } else {
      break;
    }
  }
  return path;
}

function parseTomlValue(cur: TomlCursor): unknown {
  skipWhitespaceAndComments(cur, true);
  if (cur.pos >= cur.src.length) throw tomlError(cur, "expected value");
  const ch = cur.src[cur.pos]!;

  if (ch === '"') return parseBasicString(cur);
  if (ch === "'") return parseLiteralString(cur);

  if (ch === "[") {
    cur.pos++; // consume '['
    const items: unknown[] = [];
    while (true) {
      skipWhitespaceAndComments(cur, false);
      if (cur.pos >= cur.src.length) throw tomlError(cur, "unterminated array");
      if (cur.src[cur.pos] === "]") {
        cur.pos++;
        return items;
      }
      items.push(parseTomlValue(cur));
      skipWhitespaceAndComments(cur, false);
      if (cur.pos >= cur.src.length) throw tomlError(cur, "unterminated array");
      const sep = cur.src[cur.pos]!;
      if (sep === ",") {
        cur.pos++;
        continue;
      }
      if (sep === "]") {
        cur.pos++;
        return items;
      }
      throw tomlError(cur, `expected ',' or ']' in array, found '${sep}'`);
    }
  }

  // Bare token (boolean or number)
  const start = cur.pos;
  while (
    cur.pos < cur.src.length &&
    !/[\s,#\]\r\n]/.test(cur.src[cur.pos]!)
  ) {
    cur.pos++;
  }
  const token = cur.src.slice(start, cur.pos);
  if (!token) throw tomlError(cur, "empty value");
  if (token === "true") return true;
  if (token === "false") return false;

  if (/^[+-]?(?:0|[1-9](?:_?\d)*)$/.test(token)) {
    const cleaned = token.replaceAll("_", "");
    const num = Number(cleaned);
    if (!Number.isSafeInteger(num)) throw tomlError(cur, `integer out of safe range: ${token}`);
    return num;
  }

  if (/^[+-]?(?:0|[1-9](?:_?\d)*)(?:\.\d(?:_?\d)*)?(?:[eE][+-]?\d(?:_?\d)*)?$/.test(token) && /[.eE]/.test(token)) {
    const cleaned = token.replaceAll("_", "");
    const num = Number(cleaned);
    if (!Number.isFinite(num)) throw tomlError(cur, `invalid float: ${token}`);
    return num;
  }

  throw tomlError(cur, `invalid TOML value '${token}'`);
}

function expectEndOfLine(cur: TomlCursor): void {
  skipWhitespaceAndComments(cur, true);
  if (cur.pos >= cur.src.length) return;
  const ch = cur.src[cur.pos]!;
  if (ch === "\r") {
    cur.pos++;
    if (cur.src[cur.pos] === "\n") cur.pos++;
    cur.line++;
    return;
  }
  if (ch === "\n") {
    cur.pos++;
    cur.line++;
    return;
  }
  throw tomlError(cur, `unexpected trailing token '${ch}'`);
}

const FORBIDDEN_TOML_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function assertSafeTomlKeySegment(seg: string, cur: TomlCursor): void {
  if (FORBIDDEN_TOML_KEYS.has(seg)) {
    throw tomlError(cur, `forbidden TOML key segment '${seg}'`);
  }
}

function getOrCreateTable(root: Record<string, unknown>, path: string[], cur: TomlCursor): Record<string, unknown> {
  let node: Record<string, unknown> = root;
  for (const seg of path) {
    assertSafeTomlKeySegment(seg, cur);
    if (!Object.prototype.hasOwnProperty.call(node, seg)) {
      const next: Record<string, unknown> = {};
      node[seg] = next;
      node = next;
    } else {
      const existing = node[seg];
      if (isPlainRecord(existing)) {
        node = existing;
      } else {
        throw tomlError(cur, `cannot redefine non-table key '${path.join(".")}' as table`);
      }
    }
  }
  return node;
}

export function parseTomlDocument(text: string): Record<string, unknown> {
  const clean = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const cur: TomlCursor = { src: clean, pos: 0, line: 1 };
  const root: Record<string, unknown> = {};
  let currentTable: Record<string, unknown> = root;
  const definedTables = new Set<string>();

  while (cur.pos < cur.src.length) {
    skipWhitespaceAndComments(cur, false);
    if (cur.pos >= cur.src.length) break;

    if (cur.src[cur.pos] === "[") {
      cur.pos++;
      if (cur.src[cur.pos] === "[") {
        throw tomlError(cur, "array-of-tables syntax '[[' is not supported");
      }
      const path = parseKeyPath(cur);
      for (const seg of path) assertSafeTomlKeySegment(seg, cur);
      skipWhitespaceAndComments(cur, true);
      if (cur.src[cur.pos] !== "]") throw tomlError(cur, "expected ']' closing table header");
      cur.pos++;
      expectEndOfLine(cur);
      const headerKey = path.join("\u0000");
      if (definedTables.has(headerKey)) {
        throw tomlError(cur, `duplicate table header '[${path.join(".")}]'`);
      }
      definedTables.add(headerKey);
      currentTable = getOrCreateTable(root, path, cur);
      continue;
    }

    const keyPath = parseKeyPath(cur);
    for (const seg of keyPath) assertSafeTomlKeySegment(seg, cur);
    skipWhitespaceAndComments(cur, true);
    if (cur.src[cur.pos] !== "=") throw tomlError(cur, "expected '=' after key");
    cur.pos++;
    const value = parseTomlValue(cur);
    expectEndOfLine(cur);

    let target = currentTable;
    for (let i = 0; i < keyPath.length - 1; i++) {
      const seg = keyPath[i]!;
      assertSafeTomlKeySegment(seg, cur);
      if (!Object.prototype.hasOwnProperty.call(target, seg)) {
        const next: Record<string, unknown> = {};
        target[seg] = next;
        target = next;
      } else {
        const existing = target[seg];
        if (isPlainRecord(existing)) {
          target = existing;
        } else {
          throw tomlError(cur, `cannot use non-table key '${seg}' as dotted key prefix`);
        }
      }
    }
    const leaf = keyPath[keyPath.length - 1]!;
    assertSafeTomlKeySegment(leaf, cur);
    if (Object.prototype.hasOwnProperty.call(target, leaf)) {
      throw tomlError(cur, `duplicate key '${keyPath.join(".")}'`);
    }
    target[leaf] = value;
  }

  return root;
}

function assertBooleanField(obj: Record<string, unknown>, field: string, fallback: boolean): boolean {
  if (!Object.prototype.hasOwnProperty.call(obj, field)) return fallback;
  const val = obj[field];
  if (typeof val !== "boolean") {
    throw new ComplianceRefusalError("INVALID_COMPLIANCE_CONFIG", `Field '${field}' must be a boolean.`);
  }
  return val;
}

function assertIntegerField(obj: Record<string, unknown>, field: string, min: number, fallback: number): number {
  if (!Object.prototype.hasOwnProperty.call(obj, field)) return fallback;
  const val = obj[field];
  if (typeof val !== "number" || !Number.isInteger(val) || val < min) {
    throw new ComplianceRefusalError(
      "INVALID_COMPLIANCE_CONFIG",
      `Field '${field}' must be an integer >= ${min}.`
    );
  }
  return val;
}

function assertStringArrayField(obj: Record<string, unknown>, field: string): string[] {
  if (!Object.prototype.hasOwnProperty.call(obj, field)) return [];
  const val = obj[field];
  if (!Array.isArray(val)) {
    throw new ComplianceRefusalError("INVALID_COMPLIANCE_CONFIG", `Field '${field}' must be an array of strings.`);
  }
  const out: string[] = [];
  for (const item of val) {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        `Every element of '${field}' must be a non-empty string.`
      );
    }
    out.push(item.trim());
  }
  return out;
}

function parseProfileValue(raw: unknown): ComplianceProfile {
  if (typeof raw !== "string" || !(COMPLIANCE_PROFILES as readonly string[]).includes(raw)) {
    throw new ComplianceRefusalError(
      "INVALID_COMPLIANCE_PROFILE",
      `Invalid compliance profile '${String(raw)}'; expected one of: ${COMPLIANCE_PROFILES.join(", ")}.`,
      "admission_vacuous"
    );
  }
  return raw as ComplianceProfile;
}

function profileDefaults(profile: ComplianceProfile): Omit<ComplianceSectionConfig, "profile"> & { complianceLogEnabled: boolean } {
  switch (profile) {
    case "standard":
      return {
        redact_pii: true,
        min_review_ms: 1000,
        git_provenance_trailer: false,
        allow_yolo: true,
        max_retries_per_signature: 3,
        redact_env: [],
        complianceLogEnabled: false
      };
    case "art50-only":
      return {
        redact_pii: true,
        min_review_ms: 1000,
        git_provenance_trailer: true,
        allow_yolo: true,
        max_retries_per_signature: 3,
        redact_env: [],
        complianceLogEnabled: true
      };
    case "high-risk-annex-iii":
    case "high-risk-annex-i":
      return {
        redact_pii: true,
        min_review_ms: 1000,
        git_provenance_trailer: true,
        allow_yolo: false,
        max_retries_per_signature: 3,
        redact_env: [],
        complianceLogEnabled: true
      };
  }
}

export interface LoadComplianceConfigOptions {
  cwd?: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  fallbackHome?: string;
}

export function parseComplianceConfigToml(
  text: string,
  options: Omit<LoadComplianceConfigOptions, "cwd"> & { configPresent?: boolean } = {}
): ResolvedComplianceConfig {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const fallbackHome = options.fallbackHome ?? homedir();
  const configPath = options.configPath ?? defaultComplianceConfigPath();
  const configPresent = options.configPresent ?? true;

  const doc = parseTomlDocument(text);

  const rawCompliance = doc.compliance;
  if (rawCompliance !== undefined && !isPlainRecord(rawCompliance)) {
    throw new ComplianceRefusalError("INVALID_COMPLIANCE_CONFIG", "[compliance] must be a TOML table.");
  }
  const complianceObj = rawCompliance ?? {};

  const rawDeployer = doc.deployer;
  if (rawDeployer !== undefined && !isPlainRecord(rawDeployer)) {
    throw new ComplianceRefusalError("INVALID_COMPLIANCE_CONFIG", "[deployer] must be a TOML table.");
  }
  const deployerObj = rawDeployer ?? {};

  const rawPmm = doc.pmm;
  if (rawPmm !== undefined && !isPlainRecord(rawPmm)) {
    throw new ComplianceRefusalError("INVALID_COMPLIANCE_CONFIG", "[pmm] must be a TOML table.");
  }
  const pmmObj = rawPmm ?? {};

  const rawOcel = doc.ocel;
  if (rawOcel !== undefined && !isPlainRecord(rawOcel)) {
    throw new ComplianceRefusalError("INVALID_COMPLIANCE_CONFIG", "[ocel] must be a TOML table.");
  }
  const ocelObj = rawOcel ?? {};

  let profile: ComplianceProfile = Object.prototype.hasOwnProperty.call(complianceObj, "profile")
    ? parseProfileValue(complianceObj.profile)
    : "standard";

  if (env.ZCODE_COMPLIANCE_PROFILE !== undefined) {
    profile = parseProfileValue(env.ZCODE_COMPLIANCE_PROFILE.trim());
  }

  const defaults = profileDefaults(profile);

  const explicitAllowYolo = Object.prototype.hasOwnProperty.call(complianceObj, "allow_yolo");
  const allowYolo = assertBooleanField(complianceObj, "allow_yolo", defaults.allow_yolo);
  if (isHighRiskProfile(profile) && explicitAllowYolo && allowYolo) {
    throw new ComplianceRefusalError(
      "OVERSIGHT_POLICY_REFUSED",
      `Profile '${profile}' forbids allow_yolo = true (EU AI Act Art. 14 human oversight).`,
      "admission_vacuous"
    );
  }

  let redactPii = assertBooleanField(complianceObj, "redact_pii", defaults.redact_pii);
  if (env.ZCODE_REDACT_PII !== undefined) {
    const rawFlag = env.ZCODE_REDACT_PII.trim().toLowerCase();
    if (rawFlag === "1" || rawFlag === "true") {
      redactPii = true;
    } else if (rawFlag === "0" || rawFlag === "false") {
      redactPii = false;
    } else if (rawFlag.length > 0) {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        `ZCODE_REDACT_PII must be 1|0|true|false, got '${env.ZCODE_REDACT_PII}'.`
      );
    }
  }

  let complianceLogEnabled = defaults.complianceLogEnabled;
  if (env.ZCODE_COMPLIANCE_LOG !== undefined) {
    const rawLog = env.ZCODE_COMPLIANCE_LOG.trim();
    if (rawLog === "1") {
      complianceLogEnabled = true;
    } else if (rawLog === "0") {
      complianceLogEnabled = false;
    } else if (rawLog.length > 0) {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        `ZCODE_COMPLIANCE_LOG must be 1 or 0, got '${env.ZCODE_COMPLIANCE_LOG}'.`
      );
    }
  }

  const mergedRedactEnv = Array.from(
    new Set([
      ...assertStringArrayField(ocelObj, "redact_env"),
      ...assertStringArrayField(complianceObj, "redact_env")
    ])
  );

  const compliance: ComplianceSectionConfig = {
    profile,
    redact_pii: redactPii,
    min_review_ms: assertIntegerField(complianceObj, "min_review_ms", 0, defaults.min_review_ms),
    git_provenance_trailer: assertBooleanField(
      complianceObj,
      "git_provenance_trailer",
      defaults.git_provenance_trailer
    ),
    allow_yolo: allowYolo,
    max_retries_per_signature: assertIntegerField(
      complianceObj,
      "max_retries_per_signature",
      1,
      defaults.max_retries_per_signature
    ),
    redact_env: mergedRedactEnv
  };

  let overseerId: string | undefined;
  if (Object.prototype.hasOwnProperty.call(deployerObj, "overseer_id")) {
    const val = deployerObj.overseer_id;
    if (typeof val !== "string" || val.trim().length === 0) {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        "Field 'deployer.overseer_id' must be a non-empty string."
      );
    }
    overseerId = val.trim();
  }
  if (env.ZCODE_OVERSEER_ID !== undefined) {
    const trimmed = env.ZCODE_OVERSEER_ID.trim();
    if (!trimmed) {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        "ZCODE_OVERSEER_ID must be a non-empty string when defined."
      );
    }
    overseerId = trimmed;
  }

  const deployer: DeployerSectionConfig = {
    ...(overseerId !== undefined ? { overseer_id: overseerId } : {}),
    log_retention_days: assertIntegerField(deployerObj, "log_retention_days", 1, 180),
    monitoring_enabled: assertBooleanField(deployerObj, "monitoring_enabled", true),
    worker_notice_acknowledged: assertBooleanField(deployerObj, "worker_notice_acknowledged", true)
  };

  let driftAlpha = 0.01;
  if (Object.prototype.hasOwnProperty.call(pmmObj, "drift_alpha")) {
    const val = pmmObj.drift_alpha;
    if (typeof val !== "number" || !Number.isFinite(val) || val <= 0 || val >= 1) {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        "Field 'pmm.drift_alpha' must be a finite number strictly between 0 and 1."
      );
    }
    driftAlpha = val;
  }

  const pmm: PmmSectionConfig = {
    drift_alpha: driftAlpha,
    min_window: assertIntegerField(pmmObj, "min_window", 2, 20),
    k_anonymity: assertIntegerField(pmmObj, "k_anonymity", 1, 5)
  };

  const complianceDir = complianceDirectory(env, platform, fallbackHome);

  return {
    compliance,
    deployer,
    pmm,
    complianceLogEnabled,
    complianceDir,
    configPath,
    configPresent
  };
}

export function loadComplianceConfig(options: LoadComplianceConfigOptions = {}): ResolvedComplianceConfig {
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath ?? defaultComplianceConfigPath(cwd);

  let rawToml = "";
  let configPresent = false;
  try {
    rawToml = readFileSync(configPath, "utf8");
    configPresent = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        `Unable to read compliance config at ${configPath}: ${(error as Error).message}`
      );
    }
  }

  return parseComplianceConfigToml(rawToml, {
    ...options,
    configPath,
    configPresent
  });
}

export function validateDeployerPreflight(config: ResolvedComplianceConfig): DeployerPreflightResult {
  const violations: DeployerPreflightViolation[] = [];
  if (config.deployer.log_retention_days < 180) {
    violations.push({
      code: "LOGGING_UNAVAILABLE",
      field: "deployer.log_retention_days",
      message: `EU AI Act Art. 12/26 requires log_retention_days >= 180 (got ${config.deployer.log_retention_days}).`
    });
  }
  if (!config.deployer.overseer_id || config.deployer.overseer_id.trim().length === 0) {
    violations.push({
      code: "OVERSIGHT_POLICY_REFUSED",
      field: "deployer.overseer_id",
      message: "EU AI Act Art. 14/26 requires a non-empty deployer.overseer_id (or ZCODE_OVERSEER_ID)."
    });
  }
  if (!config.deployer.monitoring_enabled) {
    violations.push({
      code: "LOGGING_UNAVAILABLE",
      field: "deployer.monitoring_enabled",
      message: "EU AI Act Art. 26/72 requires deployer.monitoring_enabled = true."
    });
  }
  if (!config.deployer.worker_notice_acknowledged) {
    violations.push({
      code: "DISCLOSURE_REQUIRED",
      field: "deployer.worker_notice_acknowledged",
      message: "EU AI Act Art. 26(7) requires deployer.worker_notice_acknowledged = true."
    });
  }
  return {
    ok: violations.length === 0,
    violations
  };
}
