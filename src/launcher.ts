import { createHash, randomUUID } from "node:crypto";
import { spawn as spawnChild, type ChildProcess } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { constants as osConstants, homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  clearSetupPending,
  ensureCliSettings,
  readCliSettings,
  hasConfiguredProviderAccess,
  providerConfigPath,
  markSetupPending,
  readConfiguredModelAccess,
  readSetupPending
} from "./model-access.ts";
import { sharedDataBaseDir } from "./config-paths.ts";
import { providerMigrationNeeded } from "./runtime-config-bridge.ts";
import {
  classifyZaiOAuthInvocation,
  runZaiOAuthLogin,
  type OfficialLoginPayload
} from "./zai-oauth.ts";
import { requestAppServer } from "./app-server-client.ts";
import {
  isHeadlessPromptArgs,
  leaseIdentityFromEnv,
  ocelDirectory,
  ocelEnabled,
  OcelRecorder,
  ocelSourceForArgs,
  ocelUntappableWarning,
  startOcelTap,
  STREAM_SOURCE
} from "./ocel-tap.ts";
import { extractMaxTurns, resolveSubagentMaxTurnsEnv } from "./max-turns.ts";
import { normalizeClaudeAgentArgs } from "./claude-parity.ts";
import { resolveRuntimeNode } from "./runtime-node.ts";
import { isGallWorkInvocation, runGallWork } from "./gall-work.ts";
import { runGallCommand } from "./gall-cli.ts";
import { runEvidenceCommand } from "./evidence-cli.ts";
import { runPartsCommand } from "./parts-cli.ts";
import { runPluginCommand } from "./plugin-cli.ts";
import { runComplianceCommand, resolveComplianceTomlPath } from "./compliance-cli.ts";
import { runFoundryCommand } from "./foundry-cli.ts";
import {
  ComplianceRefusalError,
  isHighRiskProfile,
  isRegulatedProfile,
  loadComplianceConfig,
  parseComplianceConfigToml,
  type ComplianceProfile,
  type ResolvedComplianceConfig
} from "./compliance/config.ts";
import {
  applyRuntimeArt50Provenance,
  buildArt50DisclosureEnvelope,
  emitArt50DisclosureEvent,
  formatArt50DisclosureNotice,
  formatGitProvenanceTrailer,
  snapshotWorkspaceFiles
} from "./compliance/disclosure.ts";
import {
  complianceTapEnabled,
  Ocel2ComplianceBuilder,
  upgradeLegacyOcelToOcel2,
  type Ocel2Document
} from "./compliance/ocel2.ts";
import { assertWritableDirectory } from "./compliance/ocel-sqlite.ts";
import {
  enforceOversightArgs,
  propagateSubagentOversightContext,
  type PolicyCeiling
} from "./compliance/oversight.ts";
import { redactComplianceText } from "./compliance/redactor.ts";
import { missingCodingPlanKey } from "./prompt-preflight.ts";
import {
  capabilitiesFromExtractionMetadata,
  type RuntimeCliOptionType
} from "./runtime-capabilities.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageManifestPath = join(packageRoot, "package.json");
const extractionMetadataPath = join(packageRoot, "vendor", "extraction.json");
const runtimePath = join(packageRoot, "vendor", "zcode.cjs");
const launcherPath = join(packageRoot, "bin", "zcode.js");
const defaultZCodeBaseUrl = "https://zcode.z.ai";
const defaultModelRetryMaxRetries = "5";
const defaultBrowserUseArgument = "--browser-use=headless";
const tuiRuntimeLogLimitBytes = 2 * 1024 * 1024;
const versionArguments = new Set(["version", "--version", "-v"]);
const runtimeVariadicOptions = new Set(["--disallowedTools", "--disallowed-tools"]);


export function resolveModelRetryMaxRetries(env: NodeJS.ProcessEnv): string {
  return env.ZCODE_MODEL_RETRY_MAX_RETRIES?.trim() || defaultModelRetryMaxRetries;
}

export function resolveZCodeBaseUrl(env: NodeJS.ProcessEnv): string {
  return env.ZCODE_BASE_URL?.trim() || defaultZCodeBaseUrl;
}

export function resolveNodeExecutable(): string {
  // 3.14+ vendored runtime needs node >= 22.19 (node:sqlite); a stale PATH
  // node (or a bun host) must not be handed to the runtime unprobed.
  return resolveRuntimeNode(process.env.ZCODE_NODE?.trim() || undefined);
}

function safeVersion(value: unknown): string | undefined {
  const version = typeof value === "string" ? value.trim() : "";
  return /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/u.test(version) ? version : undefined;
}

function readJsonVersion(path: string, key: string): string | undefined {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return safeVersion(value[key]);
  } catch {
    return undefined;
  }
}

export function readRuntimeCliOptionTypes(
  metadataPath = extractionMetadataPath
): Readonly<Record<string, RuntimeCliOptionType>> {
  try {
    const metadata: unknown = JSON.parse(readFileSync(metadataPath, "utf8"));
    const capabilities = capabilitiesFromExtractionMetadata(metadata);
    if (!capabilities) throw new Error("Invalid capability manifest");
    return Object.fromEntries(
      Object.entries(capabilities.cli.globalOptions).map(([name, option]) => [name, option.type])
    );
  } catch {
    throw new Error("Runtime capability metadata is missing or invalid; sync the current runtime before launching.");
  }
}

export function readDistributionVersion(manifestPath = packageManifestPath): string | undefined {
  return readJsonVersion(manifestPath, "version");
}

export function readRuntimeVersion(metadataPath = extractionMetadataPath): string | undefined {
  return readJsonVersion(metadataPath, "cliVersion");
}

export function isVersionInvocation(args: string[]): boolean {
  return args.length === 1 && versionArguments.has(args[0]!);
}

export function formatVersionOutput(distributionVersion: string, runtimeVersion: string): string {
  return [
    `zcode-app-cli ${safeVersion(distributionVersion) ?? "unknown"}`,
    `zcode-runtime ${safeVersion(runtimeVersion) ?? "unknown"}`
  ].join("\n");
}

export function normalizeLoginArgs(args: string[]): { args: string[]; checkConfiguredAccess: boolean } {
  if (args.length === 1 && args[0] === "login") {
    return { args, checkConfiguredAccess: true };
  }
  if (args[0] === "login" && args.includes("--oauth")) {
    return { args: args.filter((argument) => argument !== "--oauth"), checkConfiguredAccess: false };
  }
  return { args, checkConfiguredAccess: false };
}

function longOptionName(argument: string): string {
  const separator = argument.indexOf("=");
  return separator < 0 ? argument : argument.slice(0, separator);
}

interface RuntimeInvocationInspection {
  agentInvocation: boolean;
  command?: string;
  explicitBrowserUse: boolean;
  invalid: boolean;
  passthrough: boolean;
  workingDirectory?: string;
  resume: boolean;
}

function inspectRuntimeInvocation(
  args: string[],
  runtimeOptionTypes: Readonly<Record<string, RuntimeCliOptionType>>
): RuntimeInvocationInspection {
  let agentInvocation = false;
  let command: string | undefined;
  let explicitBrowserUse = false;
  let invalid = false;
  let passthrough = false;
  let presentationSurface = false;
  let workingDirectory: string | undefined;
  let resume = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--") {
      command ??= args[index + 1];
      break;
    }
    if (argument.startsWith("--")) {
      const option = longOptionName(argument);
      const inlineValue = option.length !== argument.length;
      if (option === "--cwd") workingDirectory = inlineValue
        ? argument.slice(option.length + 1) : args[index + 1];
      if (option === "--resume" || option === "--continue") resume = true;
      if (option === "--browser-use") {
        explicitBrowserUse = true;
        if (!inlineValue) {
          if (index + 1 >= args.length || args[index + 1]!.startsWith("-")) invalid = true;
          else index += 1;
        }
        continue;
      }
      if (option === "--help" || option === "--version") {
        passthrough = true;
        continue;
      }
      if (option === "--print") {
        if (inlineValue) invalid = true;
        else agentInvocation = true;
        continue;
      }
      if (option === "--prompt" || option === "--target") {
        agentInvocation = true;
        if (!inlineValue) {
          if (index + 1 >= args.length || args[index + 1]!.startsWith("-")) invalid = true;
          else index += 1;
        }
        continue;
      }
      if (runtimeVariadicOptions.has(option)) {
        if (!inlineValue) {
          const firstValue = index + 1;
          while (index + 1 < args.length && !args[index + 1]!.startsWith("-")) index += 1;
          if (index < firstValue) invalid = true;
        }
        continue;
      }
      const runtimeOptionType = runtimeOptionTypes[option.slice(2)];
      if (runtimeOptionType === "string") {
        presentationSurface ||= option === "--surface";
        if (!inlineValue) {
          if (index + 1 >= args.length || args[index + 1]!.startsWith("-")) invalid = true;
          else index += 1;
        }
        continue;
      }
      if (runtimeOptionType === "boolean" && !inlineValue) continue;
      invalid = true;
      continue;
    }
    if (argument.startsWith("-")) {
      if (argument === "-h" || argument === "-v") {
        passthrough = true;
        continue;
      }
      if (argument === "-p" || argument.startsWith("-p")) {
        agentInvocation = true;
        if (argument === "-p") {
          if (index + 1 >= args.length || args[index + 1]!.startsWith("-")) invalid = true;
          else index += 1;
        }
        continue;
      }
      if (argument === "-c" || argument === "-f") {
        if (argument === "-c") resume = true;
        continue;
      }
      invalid = true;
      continue;
    }
    command ??= argument;
  }

  if (presentationSurface
    && !agentInvocation
    && command !== "app-server"
    && command !== "agent-server") invalid = true;

  return { agentInvocation, command, explicitBrowserUse, invalid, passthrough, workingDirectory, resume };
}

export async function promptPreflight(
  args: string[], env: NodeJS.ProcessEnv = process.env
): Promise<string | undefined> {
  const invocation = inspectRuntimeInvocation(args, readRuntimeCliOptionTypes());
  if (!invocation.agentInvocation || invocation.invalid || invocation.passthrough || invocation.resume) {
    return undefined;
  }
  return missingCodingPlanKey({ env, workingDirectory: invocation.workingDirectory });
}

export function withDefaultBrowserUse(
  args: string[],
  runtimeOptionTypes = readRuntimeCliOptionTypes()
): string[] {
  const invocation = inspectRuntimeInvocation(args, runtimeOptionTypes);
  if (invocation.explicitBrowserUse
    || invocation.passthrough
    || invocation.invalid
    || (!invocation.agentInvocation
      && invocation.command !== undefined
      && invocation.command !== "tui")) return args;
  return [defaultBrowserUseArgument, ...args];
}

export function isTuiRuntimeInvocation(
  args: string[],
  runtimeOptionTypes = readRuntimeCliOptionTypes()
): boolean {
  const invocation = inspectRuntimeInvocation(args, runtimeOptionTypes);
  return !invocation.agentInvocation
    && !invocation.invalid
    && !invocation.passthrough
    && (invocation.command === undefined || invocation.command === "tui");
}

export function firstRunSetupEnv(setupPending: boolean, args: string[]): NodeJS.ProcessEnv | undefined {
  if (!setupPending || !isTuiRuntimeInvocation(args)) return undefined;
  return { ZCODE_CLI_FIRST_RUN: "1" };
}

function runtimeEnvironment(extra: NodeJS.ProcessEnv = {}): Record<string, string> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ZCODE_CLI_OAUTH_CALLBACK_STDIN;
  delete env.ZCODE_CLI_MIGRATE_CONFIG;
  const distributionVersion = readDistributionVersion();
  const inherited: NodeJS.ProcessEnv = {
    ...env,
    ...extra
  };
  const merged: NodeJS.ProcessEnv = {
    ...inherited,
    ZCODE_DATA_BASE_DIR: sharedDataBaseDir(inherited),
    ZCODE_BASE_URL: resolveZCodeBaseUrl(inherited),
    ZCODE_MODEL_RETRY_MAX_RETRIES: resolveModelRetryMaxRetries(inherited),
    ZCODE_APP_CLI_EXECUTABLE: process.execPath,
    ZCODE_APP_CLI_ENTRY: launcherPath,
    ...(resolveSubagentMaxTurnsEnv(inherited) ? { ZCODE_SUBAGENT_MAX_TURNS: resolveSubagentMaxTurnsEnv(inherited) } : {}),
    ...(distributionVersion ? { ZCODE_APP_CLI_VERSION: distributionVersion } : {})
  };
  return Object.fromEntries(
    Object.entries(merged).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function signalExitCode(signal: NodeJS.Signals | null): number {
  if (!signal) return 1;
  const number = (osConstants.signals as Record<string, number>)[signal];
  return typeof number === "number" ? 128 + number : 1;
}

function abortSignalName(signal: AbortSignal): NodeJS.Signals | undefined {
  const reason = signal.reason;
  return reason === "SIGINT" || reason === "SIGTERM" || reason === "SIGHUP" ? reason : undefined;
}

function abortSignalExitCode(signal: AbortSignal): number {
  return signalExitCode(abortSignalName(signal) ?? "SIGINT");
}

async function waitForChild(
  child: ChildProcess,
  onError: (error: Error) => void = (error) => console.error("Error: " + error.message)
): Promise<number> {
  return await new Promise((resolveExit) => {
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      resolveExit(code);
    };
    child.once("error", (error) => {
      onError(error);
      finish(1);
    });
    child.once("exit", (code, signal) => finish(code ?? signalExitCode(signal)));
  });
}

interface TuiRuntimeDiagnosticState {
  bytes: number;
  initialized: boolean;
  path?: string;
  writeFailed: boolean;
}

function appendTuiRuntimeDiagnostic(chunk: Buffer | string, state: TuiRuntimeDiagnosticState): void {
  if (state.bytes >= tuiRuntimeLogLimitBytes) return;
  const text = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  try {
    const path = state.path ?? (process.env.ZCODE_TUI_RUNTIME_LOG?.trim()
      || join(homedir(), ".zcode", "cli", "tui-runtime.log"));
    state.path = path;
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if (!state.initialized) {
      state.initialized = true;
      const existingBytes = existsSync(path) ? statSync(path).size : 0;
      if (existingBytes >= tuiRuntimeLogLimitBytes) {
        const rotated = `${path}.1`;
        if (existsSync(rotated)) unlinkSync(rotated);
        renameSync(path, rotated);
        chmodSync(rotated, 0o600);
      } else {
        state.bytes = existingBytes;
      }
    }
    const bounded = text.subarray(0, tuiRuntimeLogLimitBytes - state.bytes);
    if (bounded.byteLength === 0) return;
    appendFileSync(path, bounded, { mode: 0o600 });
    chmodSync(path, 0o600);
    state.bytes += bounded.byteLength;
  } catch {
    state.writeFailed = true;
  }
}

function tuiRuntimeFailureMessage(code: number, state: TuiRuntimeDiagnosticState): string {
  const diagnostic = state.path && !state.writeFailed
    ? ` Diagnostics: ${state.path}`
    : " Runtime diagnostics could not be written.";
  return `Error: ZCode runtime exited with status ${code}.${diagnostic}\n`;
}

export interface RuntimeComplianceContext {
  config: ResolvedComplianceConfig;
  providerId: string;
  modelId: string;
  sessionId: string;
}

function sha256TextHex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function atomicWriteFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, content, "utf8");
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // ignore cleanup error
    }
    throw err;
  }
}

function mergeOcelFragmentIntoFile(
  written: { sessionId: string; ocelPath: string; receiptPath: string; events: number; head: string },
  fragment: Ocel2Document,
  ctx: RuntimeComplianceContext,
  eventPlacement: "after_session_created" | "append"
): string {
  const rawDoc = JSON.parse(readFileSync(written.ocelPath, "utf8")) as Ocel2Document;
  const sessionId = written.sessionId || ctx.sessionId;
  const redactOpts = {
    redactPii: ctx.config.compliance.redact_pii,
    redactEnv: ctx.config.compliance.redact_env,
    env: process.env
  };

  const mergedObjects = rawDoc.objects.map((o) => ({
    ...o,
    attributes: [...(o.attributes ?? [])],
    relationships: [...(o.relationships ?? [])]
  }));
  const objById = new Map(mergedObjects.map((o) => [o.id, o]));

  for (const fragObj of fragment.objects) {
    const existing = objById.get(fragObj.id);
    if (!existing) {
      const cloned = {
        ...fragObj,
        attributes: [...(fragObj.attributes ?? [])],
        relationships: [...(fragObj.relationships ?? [])]
      };
      mergedObjects.push(cloned);
      objById.set(cloned.id, cloned);
    } else {
      const seenAttrs = new Set(existing.attributes.map((a) => `${a.name}:${a.time}:${String(a.value)}`));
      for (const attr of fragObj.attributes ?? []) {
        const key = `${attr.name}:${attr.time}:${String(attr.value)}`;
        if (!seenAttrs.has(key)) {
          existing.attributes.push(attr);
          seenAttrs.add(key);
        }
      }
      const seenRels = new Set(existing.relationships.map((r) => `${r.qualifier}:${r.objectId}`));
      for (const rel of fragObj.relationships ?? []) {
        const key = `${rel.qualifier}:${rel.objectId}`;
        if (!seenRels.has(key)) {
          existing.relationships.push(rel);
          seenRels.add(key);
        }
      }
    }
  }

  const preEvents = [...rawDoc.events];
  const existingEventIds = new Set(preEvents.map((e) => e.id));
  const newEvents = fragment.events.filter((e) => !existingEventIds.has(e.id));

  if (eventPlacement === "after_session_created") {
    const firstTime = preEvents[0]?.time ?? new Date().toISOString();
    const baseMs = Number.isFinite(Date.parse(firstTime)) ? Date.parse(firstTime) : Date.now();
    if (!preEvents.some((e) => e.type === "session_created")) {
      preEvents.unshift({
        id: `session_created_${randomUUID()}`,
        type: "session_created",
        time: new Date(baseMs - 2).toISOString(),
        attributes: [{ name: "compliance_profile", value: ctx.config.compliance.profile }],
        relationships: [{ objectId: sessionId, qualifier: "in_session" }]
      });
    }
    const scIdx = preEvents.findIndex((e) => e.type === "session_created");
    if (scIdx >= 0) preEvents.splice(scIdx + 1, 0, ...newEvents);
    else preEvents.unshift(...newEvents);
  } else {
    preEvents.push(...newEvents);
  }

  const upgraded = upgradeLegacyOcelToOcel2(
    {
      objectTypes: [...rawDoc.objectTypes, ...fragment.objectTypes],
      eventTypes: [...rawDoc.eventTypes, ...fragment.eventTypes],
      objects: mergedObjects,
      events: preEvents
    },
    {
      rechain: true,
      sessionId,
      providerId: ctx.providerId,
      modelId: ctx.modelId,
      overseerId: ctx.config.deployer.overseer_id,
      profile: ctx.config.compliance.profile,
      config: ctx.config,
      redactOptions: redactOpts
    }
  );

  const upgradedText = JSON.stringify(upgraded);
  atomicWriteFile(written.ocelPath, upgradedText);

  const lastEv = upgraded.events[upgraded.events.length - 1];
  const headHash =
    String(lastEv?.attributes.find((a) => a.name === "pi_hash")?.value ?? written.head);

  if (existsSync(written.receiptPath)) {
    const receipt = JSON.parse(readFileSync(written.receiptPath, "utf8")) as Record<string, unknown>;
    receipt.ocel_file_sha256 = sha256TextHex(upgradedText);
    receipt.event_count = upgraded.events.length;
    receipt.head_hash = headHash;
    atomicWriteFile(written.receiptPath, JSON.stringify(receipt, null, 2));
  }
  return headHash;
}

function augmentOcelWithArt50Disclosure(
  written: { sessionId: string; ocelPath: string; receiptPath: string; events: number; head: string },
  ctx: RuntimeComplianceContext,
  channel: "stream-json" | "headless-json" | "headless-text" | "app-server" | "tui"
): string {
  const rawDoc = JSON.parse(readFileSync(written.ocelPath, "utf8")) as Ocel2Document;
  const sessionId = written.sessionId || ctx.sessionId;
  const redactOpts = {
    redactPii: ctx.config.compliance.redact_pii,
    redactEnv: ctx.config.compliance.redact_env,
    env: process.env
  };
  const firstTime = rawDoc.events[0]?.time ?? new Date().toISOString();
  const baseMs = Number.isFinite(Date.parse(firstTime)) ? Date.parse(firstTime) : Date.now();

  const builder = new Ocel2ComplianceBuilder({ config: ctx.config, redactOptions: redactOpts });
  if (!rawDoc.events.some((e) => e.type === "art50_disclosure_emitted")) {
    emitArt50DisclosureEvent(builder, {
      profile: ctx.config.compliance.profile,
      sessionId,
      provider: ctx.providerId,
      model: ctx.modelId,
      channel,
      workerNoticeAcknowledged: ctx.config.deployer.worker_notice_acknowledged,
      timestamp: new Date(baseMs - 1).toISOString(),
      redactPii: ctx.config.compliance.redact_pii,
      redactOptions: redactOpts
    });
  }

  return mergeOcelFragmentIntoFile(written, builder.build(), ctx, "after_session_created");
}

function emitOversightRefusalAudit(
  args: readonly string[],
  cfg: ResolvedComplianceConfig,
  error: ComplianceRefusalError,
  providerId: string,
  modelId: string
): void {
  if (!isRegulatedProfile(cfg.compliance.profile)) return;
  const sessionId = `sess_refused_${randomUUID().slice(0, 8)}`;
  const redactOpts = {
    redactPii: cfg.compliance.redact_pii,
    redactEnv: cfg.compliance.redact_env,
    env: process.env
  };
  const isStreamJson = ocelSourceForArgs(args) === STREAM_SOURCE;
  const envelope =
    process.env.ZCODE_SUPPRESS_DISCLOSURE !== "1"
      ? buildArt50DisclosureEnvelope({
          profile: cfg.compliance.profile,
          sessionId,
          provider: providerId,
          model: modelId,
          channel: isStreamJson ? "stream-json" : "headless-json",
          workerNoticeAcknowledged: cfg.deployer.worker_notice_acknowledged,
          redactPii: cfg.compliance.redact_pii,
          redactOptions: redactOpts
        })
      : undefined;

  if (envelope && isStreamJson) {
    process.stdout.write(JSON.stringify(envelope) + "\n");
  }

  if (ocelEnabled(process.env) || complianceTapEnabled(process.env, cfg)) {
    const dir = ocelDirectory(process.env);
    try {
      mkdirSync(dir, { recursive: true });
      const builder = new Ocel2ComplianceBuilder({ config: cfg, redactOptions: redactOpts });
      const t0 = new Date().toISOString();
      builder.upsertObject(sessionId, "session", { compliance_profile: cfg.compliance.profile }, t0);
      builder.recordEvent({
        id: `ev_sc_${randomUUID()}`,
        type: "session_created",
        time: t0,
        attributes: { compliance_profile: cfg.compliance.profile },
        relationships: [{ objectId: sessionId, qualifier: "in_session" }]
      });
      if (envelope) {
        emitArt50DisclosureEvent(builder, {
          profile: cfg.compliance.profile,
          sessionId,
          provider: providerId,
          model: modelId,
          channel: isStreamJson ? "stream-json" : "headless-json",
          workerNoticeAcknowledged: cfg.deployer.worker_notice_acknowledged,
          redactPii: cfg.compliance.redact_pii,
          redactOptions: redactOpts
        });
      }
      builder.recordEvent({
        id: `ev_ref_${randomUUID()}`,
        type: "oversight_policy_refused",
        time: new Date().toISOString(),
        attributes: {
          refusal_code: error.code,
          reason: redactComplianceText(error.message, redactOpts)
        },
        relationships: [{ objectId: sessionId, qualifier: "in_session" }]
      });
      const doc = builder.build();
      atomicWriteFile(join(dir, `${sessionId}.ocel.json`), JSON.stringify(doc, null, 2));
    } catch {
      // ignore if directory itself is unwritable; refusal still fails closed
    }
  }
}

export async function runRuntime(
  node: string,
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {},
  complianceCtx?: RuntimeComplianceContext,
  options?: { runtimeScriptPath?: string; cwd?: string }
): Promise<number> {
  const workspaceDir = options?.cwd ?? process.cwd();
  const scriptPath = options?.runtimeScriptPath ?? runtimePath;
  const tuiInvocation = isTuiRuntimeInvocation(args);
  const regulated = Boolean(complianceCtx && isRegulatedProfile(complianceCtx.config.compliance.profile));
  const isStreamJson = ocelSourceForArgs(args) === STREAM_SOURCE;
  const isJsonMode = isHeadlessPromptArgs(args) && args.includes("--json");
  const beforeWorkspaceSnapshot =
    regulated && complianceCtx ? snapshotWorkspaceFiles(workspaceDir) : undefined;

  let disclosureEnvelope: ReturnType<typeof buildArt50DisclosureEnvelope> | undefined;
  let disclosureExtraEnv: NodeJS.ProcessEnv = {};
  const isHeadlessPrompt = isHeadlessPromptArgs(args);
  const disclosureChannel: "stream-json" | "headless-json" | "headless-text" | "tui" = isStreamJson
    ? "stream-json"
    : isJsonMode
      ? "headless-json"
      : isHeadlessPrompt
        ? "headless-text"
        : "tui";
  if (regulated && complianceCtx) {
    const redactOpts = {
      redactPii: complianceCtx.config.compliance.redact_pii,
      redactEnv: complianceCtx.config.compliance.redact_env,
      env: process.env
    };
    disclosureEnvelope = buildArt50DisclosureEnvelope({
      profile: complianceCtx.config.compliance.profile,
      sessionId: complianceCtx.sessionId,
      provider: complianceCtx.providerId,
      model: complianceCtx.modelId,
      channel: disclosureChannel,
      workerNoticeAcknowledged: complianceCtx.config.deployer.worker_notice_acknowledged,
      redactPii: complianceCtx.config.compliance.redact_pii,
      redactOptions: redactOpts
    });
    const formattedNotice = formatArt50DisclosureNotice(disclosureEnvelope);
    disclosureExtraEnv = {
      ZCODE_ART50_DISCLOSURE_NOTICE: formattedNotice,
      ZCODE_ART50_DISCLOSURE_JSON: JSON.stringify(disclosureEnvelope.ai_disclosure)
    };
    if (isStreamJson) {
      process.stdout.write(JSON.stringify(disclosureEnvelope) + "\n");
    } else if (!isJsonMode) {
      // Deliver Art. 50(1) disclosure on TUI and plain-text headless channels
      process.stderr.write(formattedNotice + "\n");
    }
  }

  // ZCODE_OCEL=1: tee the runtime's stream-json / app-server output into the OCEL tap (src/ocel-tap.ts).
  const explicitOcel = startOcelTap(args, process.env);
  const tapSource = ocelSourceForArgs(args);
  const ocel =
    explicitOcel ??
    (regulated &&
    complianceCtx &&
    tapSource &&
    complianceTapEnabled(process.env, complianceCtx.config)
      ? new OcelRecorder(tapSource, ocelDirectory(process.env), leaseIdentityFromEnv(process.env))
      : undefined);

  if (!ocel) {
    const warn = ocelUntappableWarning(args, process.env);
    if (warn) process.stderr.write(warn);
  }

  const pipeStdoutForJson = !ocel && regulated && isJsonMode && Boolean(disclosureEnvelope);
  const child = spawnChild(node, [scriptPath, ...args], {
    cwd: workspaceDir,
    env: runtimeEnvironment({ ...disclosureExtraEnv, ...extraEnv }),
    stdio:
      ocel || pipeStdoutForJson
        ? ["inherit", "pipe", "inherit"]
        : tuiInvocation
          ? ["inherit", "inherit", "pipe"]
          : "inherit"
  });
  const ocelDrained = ocel && child.stdout
    ? new Promise<void>((resolve) => {
      child.stdout!.on("data", (chunk: Buffer | string) => {
        process.stdout.write(chunk);
        ocel.write(chunk.toString());
      });
      child.stdout!.once("close", () => resolve());
    })
    : undefined;
  const jsonBuffers: Buffer[] = [];
  const jsonDrained = pipeStdoutForJson && child.stdout
    ? new Promise<void>((resolve) => {
      child.stdout!.on("data", (chunk: Buffer | string) => {
        jsonBuffers.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      child.stdout!.once("close", () => resolve());
    })
    : undefined;
  const diagnosticState: TuiRuntimeDiagnosticState = {
    bytes: 0,
    initialized: false,
    writeFailed: false
  };
  const onDiagnostic = (chunk: Buffer | string) => appendTuiRuntimeDiagnostic(chunk, diagnosticState);
  child.stderr?.on("data", onDiagnostic);
  let forwardedSignal = false;
  const forwardSignal = (signal: NodeJS.Signals) => {
    forwardedSignal = true;
    if (!child.killed) child.kill(signal);
  };
  const onSigint = () => forwardSignal("SIGINT");
  const onSigterm = () => forwardSignal("SIGTERM");
  const onSighup = () => forwardSignal("SIGHUP");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  if (process.platform !== "win32") process.once("SIGHUP", onSighup);
  try {
    const code = await waitForChild(
      child,
      tuiInvocation
        ? (error) => appendTuiRuntimeDiagnostic((error.stack ?? error.message) + "\n", diagnosticState)
        : undefined
    );
    if (tuiInvocation && code !== 0 && !forwardedSignal) {
      process.stderr.write(tuiRuntimeFailureMessage(code, diagnosticState));
    }
    if (jsonDrained && disclosureEnvelope && complianceCtx) {
      await jsonDrained;
      const rawOut = Buffer.concat(jsonBuffers).toString("utf8");
      const trimmed = rawOut.trim();
      const trailer = formatGitProvenanceTrailer({
        config: complianceCtx.config,
        cliVersion: readDistributionVersion() ?? "0.0.0",
        provider: complianceCtx.providerId,
        model: complianceCtx.modelId,
        sessionId: complianceCtx.sessionId
      });
      let emitted = false;
      if (trimmed) {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          const enriched =
            parsed && typeof parsed === "object" && !Array.isArray(parsed)
              ? {
                  ...(parsed as Record<string, unknown>),
                  ai_disclosure: disclosureEnvelope.ai_disclosure,
                  ...(trailer ? { provenance_trailer: trailer } : {})
                }
              : {
                  result: parsed,
                  ai_disclosure: disclosureEnvelope.ai_disclosure,
                  ...(trailer ? { provenance_trailer: trailer } : {})
                };
          process.stdout.write(JSON.stringify(enriched) + "\n");
          emitted = true;
        } catch {
          // fall through to raw write + stderr Art. 50(1) disclosure
        }
      }
      if (!emitted) {
        if (rawOut) process.stdout.write(rawOut);
        process.stderr.write(formatArt50DisclosureNotice(disclosureEnvelope) + "\n");
      }
    }
    let ocelHeadHash: string | undefined;
    let writtenOcel:
      | { sessionId: string; ocelPath: string; receiptPath: string; events: number; head: string }
      | undefined;
    let ocelTapFailed = false;
    if (ocel && ocelDrained) {
      await ocelDrained;
      try {
        const written = ocel.finish();
        writtenOcel = written;
        ocelHeadHash = written.head;
        if (regulated && complianceCtx) {
          ocelHeadHash = augmentOcelWithArt50Disclosure(
            written,
            complianceCtx,
            isStreamJson ? "stream-json" : tapSource === "zcode_app_server" ? "app-server" : "headless-json"
          );
        }
        process.stderr.write(`OCEL: ${written.events} events -> ${written.ocelPath}\n`);
      } catch (error) {
        ocelTapFailed = true;
        process.stderr.write(`OCEL tap failed: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
    if (regulated && complianceCtx && beforeWorkspaceSnapshot) {
      try {
        const redactOpts = {
          redactPii: complianceCtx.config.compliance.redact_pii,
          redactEnv: complianceCtx.config.compliance.redact_env,
          env: process.env
        };
        const provBuilder = writtenOcel
          ? new Ocel2ComplianceBuilder({ config: complianceCtx.config, redactOptions: redactOpts })
          : undefined;
        const provResult = applyRuntimeArt50Provenance({
          workspaceDir,
          beforeSnapshot: beforeWorkspaceSnapshot,
          sessionId: complianceCtx.sessionId,
          profile: complianceCtx.config.compliance.profile,
          provider: complianceCtx.providerId,
          model: complianceCtx.modelId,
          ocelHeadHash,
          ocelUnrecordedReason: ocelHeadHash
            ? undefined
            : ocelTapFailed
              ? "ocel_tap_failed"
              : !tapSource
                ? "ocel_channel_untappable"
                : "ocel_not_recorded",
          cliVersion: readDistributionVersion() ?? "0.0.0",
          redactPii: complianceCtx.config.compliance.redact_pii,
          redactOptions: redactOpts,
          ...(provBuilder ? { ocelSink: provBuilder } : {})
        });
        if (provResult && writtenOcel && provBuilder) {
          mergeOcelFragmentIntoFile(writtenOcel, provBuilder.build(), complianceCtx, "append");
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Art. 50(2) provenance marking failed: ${msg}\n`);
        if (code === 0) {
          return error instanceof ComplianceRefusalError ? error.exitCode : 1;
        }
      }
    }
    return code;
  } finally {
    child.stderr?.off("data", onDiagnostic);
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    if (process.platform !== "win32") process.off("SIGHUP", onSighup);
  }
}

async function completeOfficialZaiLogin(
  node: string,
  payload: OfficialLoginPayload,
  runtimeArgs: string[],
  abortSignal: AbortSignal
): Promise<number> {
  if (abortSignal.aborted) return abortSignalExitCode(abortSignal);
  const child = spawnChild(node, [runtimePath, ...runtimeArgs], {
    cwd: process.cwd(),
    env: runtimeEnvironment({ ZCODE_CLI_OAUTH_CALLBACK_STDIN: "1" }),
    stdio: ["pipe", "inherit", "inherit"]
  });
  const onAbort = () => child.kill(abortSignalName(abortSignal) ?? "SIGINT");
  abortSignal.addEventListener("abort", onAbort, { once: true });
  try {
    child.stdin?.end(JSON.stringify(payload));
    return await waitForChild(child);
  } finally {
    abortSignal.removeEventListener("abort", onAbort);
  }
}

export async function main(args: string[]): Promise<number> {
  // Semantic-parts discovery is a local SELECT surface over an already-admitted
  // UNRDF graph. It runs before runtime bootstrap and carries no DO authority.
  const partsCommand = await runPartsCommand(args);
  if (partsCommand !== undefined) return partsCommand;

  // PolyEvidence admission is hermetic and non-actuating; run it before
  // runtime/config bootstrap just like the portable GALL consumer court.
  const evidenceCommand = await runEvidenceCommand(args);
  if (evidenceCommand !== undefined) return evidenceCommand;

  // Public GALL-006 fresh-consumer command (restored from 9d2ccec; the
  // dispatch was dropped by a v26.9.22 merge while src/gall-cli.ts survived).
  const gallCommand = await runGallCommand(args);
  if (gallCommand !== undefined) return gallCommand;

  try {
    // Native gall-work lifecycle (claim -> persist -> construct -> close).
    // It runs before the config bootstrap so a dispatcher-launched worker
    // stays hermetic, and it manages its own runtime turn for the construct
    // stage. There is no `/xaas claim_next` prompt fallback: a failure here
    // is a typed non-zero exit, never a re-dispatch as a prompt.
    if (isGallWorkInvocation(args)) {
      return await runGallWork(args.slice(1));
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  // EU AI Act & process-mining compliance CLI (hermetic pre-bootstrap dispatch).
  const complianceCommand = await runComplianceCommand(args);
  if (complianceCommand !== undefined) return complianceCommand;

  // HITL-free POWL/OCEL foundry CLI (hermetic pre-bootstrap dispatch).
  const foundryCommand = await runFoundryCommand(args);
  if (foundryCommand !== undefined) return foundryCommand;

  if (!existsSync(runtimePath)) {
    console.error(
      "ZCode runtime is missing. Reinstall the package or run `bun run sync:local` in the source checkout."
    );
    return 1;
  }

  if (isVersionInvocation(args)) {
    const distributionVersion = readDistributionVersion();
    const runtimeVersion = readRuntimeVersion();
    if (!distributionVersion || !runtimeVersion) {
      console.error("Unable to read npm package or bundled runtime version metadata.");
      return 1;
    }
    console.log(formatVersionOutput(distributionVersion, runtimeVersion));
    return 0;
  }

  // `--max-turns N` is lowered to env ZCODE_MAX_TURNS for the runtime spawn;
  // it must not reach the runtime argv (the runtime CLI rejects unknown flags).
  const maxTurns = extractMaxTurns(args);
  if (maxTurns.error) {
    console.error(`Error: ${maxTurns.error}`);
    return 1;
  }
  const claudeParity = normalizeClaudeAgentArgs(maxTurns.args);
  if (claudeParity.error) {
    console.error(`Error: ${claudeParity.error}`);
    return 1;
  }
  const login = normalizeLoginArgs(claudeParity.args);
  const zaiOAuth = classifyZaiOAuthInvocation(claudeParity.args);
  const invocation = inspectRuntimeInvocation(login.args, readRuntimeCliOptionTypes());
  const isManagementOrLogin =
    invocation.command === "plugins" || Boolean(zaiOAuth) || login.checkConfiguredAccess;

  let configuredAccess: Awaited<ReturnType<typeof readConfiguredModelAccess>> = null;
  let complianceCtx: RuntimeComplianceContext | undefined;
  let complianceExtraEnv: NodeJS.ProcessEnv = {};

  // EU AI Act Art. 14 / Art. 50 / Art. 10-12 compliance preflight MUST run BEFORE
  // ensureCliSettings() so refused invocations fail closed without mutating HOME/.zcode/cli/
  // or getting masked by EACCES on a read-only HOME.
  try {
    configuredAccess = await readConfiguredModelAccess();
    const providerId = configuredAccess?.providerId ?? "zcode";
    const modelId = configuredAccess?.model ?? "runtime";
    const effectiveCwd = invocation.workingDirectory
      ? resolve(process.cwd(), invocation.workingDirectory)
      : process.cwd();
    const tomlPath = resolveComplianceTomlPath(undefined, effectiveCwd, process.env);
    const complianceConfig = loadComplianceConfig({
      cwd: effectiveCwd,
      configPath: tomlPath,
      env: process.env
    });

    const isSubagent = process.env.ZCODE_SUBAGENT === "1";
    const hasParentOversightEnv =
      isSubagent ||
      process.env.ZCODE_ALLOW_YOLO !== undefined ||
      process.env.ZCODE_MIN_REVIEW_MS !== undefined ||
      process.env.ZCODE_POLICY_CEILING !== undefined ||
      process.env.ZCODE_OVERSEER_ID !== undefined ||
      process.env.XAAS_WORKER !== undefined;

    if (
      isRegulatedProfile(complianceConfig.compliance.profile) ||
      complianceConfig.compliance.allow_yolo === false ||
      hasParentOversightEnv
    ) {
      let propagatedEnv: Record<string, string> | undefined;
      try {
        if (hasParentOversightEnv) {
          const PROFILE_RANK: Readonly<Record<ComplianceProfile, number>> = {
            standard: 0,
            "art50-only": 1,
            "high-risk-annex-iii": 2,
            "high-risk-annex-i": 2
          };
          let tomlProfile: ComplianceProfile | undefined;
          if (isSubagent && complianceConfig.configPresent && existsSync(tomlPath)) {
            tomlProfile = parseComplianceConfigToml(readFileSync(tomlPath, "utf8"), {
              configPath: tomlPath,
              configPresent: true,
              env: {}
            }).compliance.profile;
          }
          const parentProfile =
            tomlProfile &&
            PROFILE_RANK[tomlProfile] > PROFILE_RANK[complianceConfig.compliance.profile]
              ? tomlProfile
              : complianceConfig.compliance.profile;

          let envAllowYolo: boolean | undefined;
          if (process.env.ZCODE_ALLOW_YOLO !== undefined) {
            const norm = process.env.ZCODE_ALLOW_YOLO.trim().toLowerCase();
            if (norm === "0" || norm === "false" || norm === "no") {
              envAllowYolo = false;
            } else if (norm === "1" || norm === "true" || norm === "yes") {
              envAllowYolo = true;
            } else {
              throw new ComplianceRefusalError(
                "OVERSIGHT_POLICY_REFUSED",
                `Invalid ZCODE_ALLOW_YOLO value '${process.env.ZCODE_ALLOW_YOLO}'.`,
                "mu_on_O"
              );
            }
          }

          let envMinReviewMs: number | undefined;
          if (process.env.ZCODE_MIN_REVIEW_MS !== undefined) {
            const rawMin = process.env.ZCODE_MIN_REVIEW_MS.trim();
            const parsedMin = rawMin === "" ? NaN : Number(rawMin);
            if (!Number.isFinite(parsedMin) || parsedMin < 0) {
              throw new ComplianceRefusalError(
                "OVERSIGHT_POLICY_REFUSED",
                `Invalid ZCODE_MIN_REVIEW_MS value '${process.env.ZCODE_MIN_REVIEW_MS}'.`,
                "mu_on_O"
              );
            }
            envMinReviewMs = parsedMin;
          }

          const parentAllowYolo =
            isHighRiskProfile(parentProfile) ||
            complianceConfig.compliance.allow_yolo === false ||
            envAllowYolo === false
              ? false
              : true;
          const parentMinReviewMs = Math.max(
            complianceConfig.compliance.min_review_ms,
            envMinReviewMs ?? 0
          );
          const parentCeiling = process.env.ZCODE_POLICY_CEILING?.trim() as
            | PolicyCeiling
            | undefined;
          const parentOverseerId =
            process.env.ZCODE_OVERSEER_ID !== undefined
              ? process.env.ZCODE_OVERSEER_ID.trim() || undefined
              : complianceConfig.deployer.overseer_id;

          const propagated = propagateSubagentOversightContext(
            {
              sessionId: process.env.ZCODE_PARENT_SESSION_ID?.trim() || "parent_session",
              profile: parentProfile,
              allowYolo: parentAllowYolo,
              minReviewMs: parentMinReviewMs,
              ...(parentCeiling ? { policyCeiling: parentCeiling } : {}),
              ...(parentOverseerId ? { overseerId: parentOverseerId } : {}),
              xaasWorker: process.env.XAAS_WORKER === "1",
              env: process.env
            },
            process.env.ZCODE_SUBAGENT_ID?.trim() || "subagent_runtime",
            {
              profile: complianceConfig.compliance.profile,
              allowYolo: parentAllowYolo ? complianceConfig.compliance.allow_yolo : false,
              minReviewMs: parentMinReviewMs,
              ...(process.env.ZCODE_OVERSEER_ID !== undefined
                ? { overseerId: process.env.ZCODE_OVERSEER_ID }
                : parentOverseerId
                  ? { overseerId: parentOverseerId }
                  : {}),
              args: claudeParity.args,
              env: process.env
            }
          );

          // Also validate raw pre-parity flags under effective constraints
          if (!propagated.effectiveAllowYolo || isHighRiskProfile(propagated.effectiveProfile)) {
            const effectiveCfg: ResolvedComplianceConfig = {
              ...complianceConfig,
              compliance: {
                ...complianceConfig.compliance,
                profile: propagated.effectiveProfile,
                allow_yolo: propagated.effectiveAllowYolo,
                min_review_ms: propagated.effectiveMinReviewMs
              }
            };
            enforceOversightArgs(maxTurns.args, effectiveCfg, process.env);
          }

          propagatedEnv = { ...propagated.env };
          if (!isSubagent) {
            delete propagatedEnv.ZCODE_SUBAGENT;
            delete propagatedEnv.ZCODE_PARENT_SESSION_ID;
            delete propagatedEnv.ZCODE_SUBAGENT_ID;
          }
        } else {
          enforceOversightArgs(maxTurns.args, complianceConfig, process.env);
          enforceOversightArgs(claudeParity.args, complianceConfig, process.env);
        }
      } catch (err) {
        if (err instanceof ComplianceRefusalError) {
          emitOversightRefusalAudit(claudeParity.args, complianceConfig, err, providerId, modelId);
          console.error(
            redactComplianceText(err.message, {
              redactPii: complianceConfig.compliance.redact_pii,
              redactEnv: complianceConfig.compliance.redact_env,
              env: process.env
            })
          );
          return err.exitCode;
        }
        throw err;
      }

      if (!isManagementOrLogin) {
        if (
          isRegulatedProfile(complianceConfig.compliance.profile) &&
          process.env.ZCODE_SUPPRESS_DISCLOSURE === "1"
        ) {
          const discErr = new ComplianceRefusalError(
            "DISCLOSURE_REQUIRED",
            `Profile '${complianceConfig.compliance.profile}' forbids ZCODE_SUPPRESS_DISCLOSURE=1 (EU AI Act Art. 50).`,
            "admission_vacuous"
          );
          console.error(discErr.message);
          return discErr.exitCode;
        }

        if (!invocation.passthrough && !invocation.invalid) {
          if (
            isHighRiskProfile(complianceConfig.compliance.profile) &&
            !complianceTapEnabled(process.env, complianceConfig)
          ) {
            const logErr = new ComplianceRefusalError(
              "LOGGING_UNAVAILABLE",
              `EU AI Act Art. 12 requires OCEL/compliance logging under '${complianceConfig.compliance.profile}'.`,
              "R_missing_consequence"
            );
            console.error(logErr.message);
            return logErr.exitCode;
          }
          if (
            ocelSourceForArgs(claudeParity.args) !== undefined &&
            (ocelEnabled(process.env) || complianceTapEnabled(process.env, complianceConfig))
          ) {
            assertWritableDirectory(ocelDirectory(process.env));
          }
        }
      }

      if (
        isRegulatedProfile(complianceConfig.compliance.profile) ||
        complianceConfig.compliance.allow_yolo === false ||
        propagatedEnv !== undefined
      ) {
        complianceCtx = {
          config: complianceConfig,
          providerId,
          modelId,
          sessionId: `sess_${randomUUID().slice(0, 12)}`
        };
        complianceExtraEnv = {
          ZCODE_COMPLIANCE_PROFILE: complianceConfig.compliance.profile,
          ZCODE_ALLOW_YOLO: complianceConfig.compliance.allow_yolo ? "1" : "0",
          ZCODE_MIN_REVIEW_MS: String(complianceConfig.compliance.min_review_ms),
          ZCODE_REDACT_PII: complianceConfig.compliance.redact_pii ? "1" : "0",
          ...(complianceConfig.deployer.overseer_id
            ? { ZCODE_OVERSEER_ID: complianceConfig.deployer.overseer_id }
            : {}),
          ...(propagatedEnv ?? {})
        };
      }
    }
  } catch (error) {
    if (error instanceof ComplianceRefusalError) {
      console.error(redactComplianceText(error.message, { redactPii: true, env: process.env }));
      return error.exitCode;
    }
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  let setupPending = false;
  try {
    const bootstrap = await ensureCliSettings();
    await readCliSettings();
    sharedDataBaseDir();
    if (bootstrap.created && !bootstrap.migrated) {
      await markSetupPending();
      setupPending = true;
    } else {
      setupPending = await readSetupPending();
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const node = resolveNodeExecutable();
  if (providerMigrationNeeded()) {
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawnChild(node, [runtimePath, "--version"], {
          env: runtimeEnvironment({ ZCODE_CLI_MIGRATE_CONFIG: "1" }),
          stdio: ["ignore", "ignore", "pipe"]
        });
        let error = "";
        child.stderr?.on("data", chunk => { error = `${error}${chunk}`.slice(-4096); });
        child.once("error", reject);
        child.once("close", code => code === 0 ? resolve() : reject(new Error(error.trim() || "Provider migration failed.")));
      });
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }
  const pluginAbortController = new AbortController();
  const cancelPluginCommand = (signal: NodeJS.Signals) => () => pluginAbortController.abort(signal);
  const onPluginSigint = cancelPluginCommand("SIGINT");
  const onPluginSigterm = cancelPluginCommand("SIGTERM");
  const onPluginSighup = cancelPluginCommand("SIGHUP");
  process.once("SIGINT", onPluginSigint);
  process.once("SIGTERM", onPluginSigterm);
  if (process.platform !== "win32") process.once("SIGHUP", onPluginSighup);
  let pluginCommand: number | undefined;
  try {
    pluginCommand = await runPluginCommand(args, {
      request: async ({ method, params, signal, workingDirectory }) => await requestAppServer({
        method,
        params,
        signal: signal ?? pluginAbortController.signal,
        transport: {
          args: [runtimePath, "app-server"],
          command: node,
          cwd: workingDirectory,
          env: runtimeEnvironment()
        }
      }),
      signal: pluginAbortController.signal
    });
  } finally {
    process.off("SIGINT", onPluginSigint);
    process.off("SIGTERM", onPluginSigterm);
    if (process.platform !== "win32") process.off("SIGHUP", onPluginSighup);
  }
  if (pluginCommand !== undefined) return pluginCommand;

  if (login.checkConfiguredAccess) {
    const access = await readConfiguredModelAccess();
    if (access || await hasConfiguredProviderAccess()) {
      console.log(
        `Model access is already configured${access ? ` for ${access.model}` : ""}; OAuth login is not required.\n`
        + `Config: ${access?.configPath ?? providerConfigPath()}\n`
        + "Run `zcode login --oauth` to force Z.AI OAuth."
      );
      return 0;
    }
  }

  if (zaiOAuth) {
    const abortController = new AbortController();
    const cancel = (signal: NodeJS.Signals) => () => abortController.abort(signal);
    const onSigint = cancel("SIGINT");
    const onSigterm = cancel("SIGTERM");
    const onSighup = cancel("SIGHUP");
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    if (process.platform !== "win32") process.once("SIGHUP", onSighup);
    try {
      const code = await runZaiOAuthLogin({
        abortSignal: abortController.signal,
        completeLogin: (payload, runtimeArgs) => completeOfficialZaiLogin(
          node,
          payload,
          runtimeArgs,
          abortController.signal
        ),
        invocation: zaiOAuth,
        output: zaiOAuth.json ? process.stderr : process.stdout
      });
      // A successful CLI-side login completes first-run setup; otherwise the
      // pending wizard would reappear over an already-configured account.
      if (code === 0 && await readConfiguredModelAccess()) await clearSetupPending();
      return code;
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      return abortController.signal.aborted ? abortSignalExitCode(abortController.signal) : 1;
    } finally {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      if (process.platform !== "win32") process.off("SIGHUP", onSighup);
    }
  }

  try {
    const diagnostic = configuredAccess ? undefined : await promptPreflight(login.args);
    if (diagnostic) {
      console.error(diagnostic);
      return 1;
    }
    const runtimeArgs = withDefaultBrowserUse(login.args);
    return await runRuntime(
      node,
      runtimeArgs,
      {
        ...firstRunSetupEnv(setupPending, runtimeArgs),
        ...(maxTurns.maxTurns !== undefined ? { ZCODE_MAX_TURNS: String(maxTurns.maxTurns) } : {}),
        ...complianceExtraEnv
      },
      complianceCtx
    );
  } catch (error) {
    if (error instanceof ComplianceRefusalError) {
      console.error(redactComplianceText(error.message, { redactPii: true, env: process.env }));
      return error.exitCode;
    }
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
