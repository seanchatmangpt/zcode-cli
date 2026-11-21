import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dir, "../..");
export const ZCODE_ENTRY = join(REPO_ROOT, "bin", "zcode.ts");
export const REAL_HOME = process.env.HOME ?? homedir();

const AMBIENT_SECRET_RE =
  /^(?:ZCODE|ZAI|BIGMODEL|ZHIPU|ANTHROPIC|OPENAI)_.*(?:KEY|TOKEN|MODEL|CONFIG|PROVIDER|BASE_URL)/u;

export function hermeticTempRoot(): string {
  const base = tmpdir();
  return process.platform !== "win32" && base.startsWith(homedir()) ? "/tmp" : base;
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export interface IsolatedWorkspace {
  root: string;
  home: string;
  cwd: string;
  ocelDir: string;
  complianceDir: string;
  xdgConfigHome: string;
  writeToml(tomlContent: string, relPath?: string): string;
  writeJson(relPath: string, data: unknown): string;
  writeText(relPath: string, content: string): string;
  readText(relPath: string): string;
  readJson<T = Record<string, unknown>>(relPath: string): T;
  exists(relPath: string): boolean;
  path(relPath: string): string;
  cleanup(): void;
}

export function createIsolatedWorkspace(prefix = "zcode-e2e-"): IsolatedWorkspace {
  const root = mkdtempSync(join(hermeticTempRoot(), prefix));
  const home = join(root, "home");
  const cwd = join(root, "work");
  const ocelDir = join(root, "ocel");
  const complianceDir = join(root, "compliance");
  const xdgConfigHome = join(root, "xdg-config");
  for (const dir of [home, cwd, ocelDir, complianceDir, xdgConfigHome]) {
    mkdirSync(dir, { recursive: true });
  }
  return {
    root,
    home,
    cwd,
    ocelDir,
    complianceDir,
    xdgConfigHome,
    path(relPath: string): string {
      return resolve(cwd, relPath);
    },
    writeToml(tomlContent: string, relPath = "zcode-cli.toml"): string {
      const target = resolve(cwd, relPath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, tomlContent, "utf8");
      return target;
    },
    writeJson(relPath: string, data: unknown): string {
      const target = resolve(cwd, relPath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, JSON.stringify(data, null, 2) + "\n", "utf8");
      return target;
    },
    writeText(relPath: string, content: string): string {
      const target = resolve(cwd, relPath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, "utf8");
      return target;
    },
    readText(relPath: string): string {
      return readFileSync(resolve(cwd, relPath), "utf8");
    },
    readJson<T = Record<string, unknown>>(relPath: string): T {
      return JSON.parse(readFileSync(resolve(cwd, relPath), "utf8")) as T;
    },
    exists(relPath: string): boolean {
      return existsSync(resolve(cwd, relPath));
    },
    cleanup(): void {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export async function withIsolatedWorkspace<T>(
  fn: (ws: IsolatedWorkspace) => T | Promise<T>,
  prefix = "zcode-e2e-",
): Promise<T> {
  const ws = createIsolatedWorkspace(prefix);
  try {
    return await fn(ws);
  } finally {
    ws.cleanup();
  }
}

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  json<T = Record<string, unknown>>(): T;
}

export function runSubprocess(
  cmd: string,
  args: string[],
  opts: {
    cwd?: string;
    env?: Record<string, string>;
    input?: string;
    timeoutMs?: number;
  } = {},
): CliResult {
  const start = performance.now();
  const proc = Bun.spawnSync([cmd, ...args], {
    cwd: opts.cwd ?? REPO_ROOT,
    env: opts.env ?? { ...process.env } as Record<string, string>,
    stdin: opts.input !== undefined ? Buffer.from(opts.input, "utf8") : undefined,
    stdout: "pipe",
    stderr: "pipe",
    timeout: opts.timeoutMs ?? 15_000,
  });
  const durationMs = Math.round(performance.now() - start);
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  return {
    exitCode: proc.exitCode ?? (proc.signalCode ? 124 : 1),
    stdout,
    stderr,
    durationMs,
    json<T = Record<string, unknown>>(): T {
      return JSON.parse(stdout) as T;
    },
  };
}

export function buildIsolatedEnv(
  ws: IsolatedWorkspace,
  overrides: Record<string, string | undefined> = {},
): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (val === undefined) continue;
    if (key.startsWith("ZCODE_") || key.startsWith("XAAS_") || AMBIENT_SECRET_RE.test(key)) {
      continue;
    }
    clean[key] = val;
  }
  const merged: Record<string, string | undefined> = {
    ...clean,
    NO_COLOR: "1",
    HOME: ws.home,
    USERPROFILE: ws.home,
    XDG_CONFIG_HOME: ws.xdgConfigHome,
    ZCODE_DATA_BASE_DIR: ws.home,
    ZCODE_CONFIG_PATH: join(ws.home, ".zcode", "cli", "config.json"),
    ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: join(ws.home, ".zcode", "v2", "provider_config.json"),
    ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: join(REPO_ROOT, "vendor", "provider", "zcode-builtin.json"),
    ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE: "",
    ZCODE_EXECUTION_PROVIDER_CONFIG_FILE: join(ws.home, ".zcode", "v2", "execution_provider_config.json"),
    ZCODE_OCEL: "0",
    ZCODE_OCEL_DIR: ws.ocelDir,
    ZCODE_COMPLIANCE_DIR: ws.complianceDir,
    ZCODE_DISABLE_MODEL_CATALOG_REFRESH: "1",
    ZCODE_DISABLE_UPDATE_CHECK: "1",
    ...overrides,
  };
  return Object.fromEntries(
    Object.entries(merged).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

export function runZcodeCli(
  args: string[],
  ws: IsolatedWorkspace,
  opts: {
    env?: Record<string, string | undefined>;
    cwd?: string;
    input?: string;
    timeoutMs?: number;
  } = {},
): CliResult {
  return runSubprocess(process.execPath, [ZCODE_ENTRY, ...args], {
    cwd: opts.cwd ?? ws.cwd,
    env: buildIsolatedEnv(ws, opts.env),
    input: opts.input,
    timeoutMs: opts.timeoutMs ?? 15_000,
  });
}

export async function runZcodeCliAsync(
  args: string[],
  ws: IsolatedWorkspace,
  opts: {
    env?: Record<string, string | undefined>;
    cwd?: string;
    input?: string;
    timeoutMs?: number;
  } = {},
): Promise<CliResult> {
  const start = performance.now();
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const proc = Bun.spawn([process.execPath, ZCODE_ENTRY, ...args], {
    cwd: opts.cwd ?? ws.cwd,
    env: buildIsolatedEnv(ws, opts.env),
    stdin: opts.input !== undefined ? Buffer.from(opts.input, "utf8") : undefined,
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, timeoutMs);
  const [exitCode, stdoutBuf, stderrBuf] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  clearTimeout(timer);
  const durationMs = Math.round(performance.now() - start);
  const finalExit = timedOut ? 124 : exitCode;
  return {
    exitCode: finalExit,
    stdout: stdoutBuf,
    stderr: stderrBuf,
    durationMs,
    json<T = Record<string, unknown>>(): T {
      return JSON.parse(stdoutBuf) as T;
    },
  };
}

export function writeLocalProviderConfig(
  ws: IsolatedWorkspace,
  baseUrl: string,
  opts: { providerId?: string; modelId?: string; apiKey?: string } = {},
): string {
  const providerId = opts.providerId ?? "custom";
  const modelId = opts.modelId ?? "fixture-model";
  const apiKey = opts.apiKey ?? "e2e-local-key";
  const path = join(ws.home, ".zcode", "v2", "provider_config.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        schemaVersion: 1,
        config: {
          providerConfigRules: {
            providerRules: [
              {
                providerId,
                providerName: "Local E2E Provider",
                config: {
                  group: "standard-personal",
                  access: { type: "api-key", apiKey },
                  api: { type: "openai-chat-completions", baseUrl },
                  personalModelIds: [modelId],
                },
              },
            ],
          },
          modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] },
          defaultModelSelection: { providerId, modelId },
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  return path;
}

export async function withLocalLlmServer<T>(
  ws: IsolatedWorkspace,
  fn: (ctx: { baseUrl: string; providerConfigPath: string }) => Promise<T>,
  opts: { replyText?: string; providerId?: string; modelId?: string } = {},
): Promise<T> {
  const replyText = opts.replyText ?? "OK";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const body = (await req.json().catch(() => ({}))) as { stream?: boolean };
      if (!body.stream) {
        return Response.json({
          id: "chatcmpl-e2e",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: replyText },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        });
      }
      const sse =
        `data: ${JSON.stringify({ id: "chatcmpl-e2e", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: replyText }, finish_reason: null }] })}\n\n` +
        `data: ${JSON.stringify({ id: "chatcmpl-e2e", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n` +
        `data: [DONE]\n\n`;
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
    },
  });
  try {
    const baseUrl = `${server.url.origin}/v1`;
    const providerConfigPath = writeLocalProviderConfig(ws, baseUrl, opts);
    return await fn({ baseUrl, providerConfigPath });
  } finally {
    server.stop(true);
  }
}

export function runBunScript(
  scriptRelPath: string,
  args: string[],
  opts: {
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
  } = {},
): CliResult {
  const scriptPath = resolve(REPO_ROOT, scriptRelPath);
  return runSubprocess(process.execPath, [scriptPath, ...args], {
    cwd: opts.cwd ?? REPO_ROOT,
    env: opts.env,
    timeoutMs: opts.timeoutMs ?? 15_000,
  });
}

export interface GitRepoHandle {
  cwd: string;
  git(args: string[]): CliResult;
  headSha(): string;
  statusPorcelain(): string;
  commitAll(message: string): string;
}

export function initGitRepo(
  cwd: string,
  opts: {
    userName?: string;
    userEmail?: string;
    initialFile?: string;
    initialContent?: string;
    commitMessage?: string;
  } = {},
): GitRepoHandle {
  mkdirSync(cwd, { recursive: true });
  const git = (args: string[]): CliResult => runSubprocess("git", args, { cwd, timeoutMs: 10_000 });
  const initRes = git(["init", "-b", "main"]);
  if (initRes.exitCode !== 0) {
    throw new Error(`git init failed: ${initRes.stderr}`);
  }
  const nameRes = git(["config", "user.name", opts.userName ?? "EU AI Act Test"]);
  const emailRes = git(["config", "user.email", opts.userEmail ?? "e2e@zcode-cli.local"]);
  if (nameRes.exitCode !== 0 || emailRes.exitCode !== 0) {
    throw new Error("git config failed");
  }
  const initialFile = opts.initialFile ?? "README.md";
  writeFileSync(join(cwd, initialFile), opts.initialContent ?? "# E2E Workspace\n", "utf8");
  const addRes = git(["add", initialFile]);
  const commitRes = git(["commit", "-m", opts.commitMessage ?? "chore: initial e2e commit"]);
  if (addRes.exitCode !== 0 || commitRes.exitCode !== 0) {
    throw new Error(`initial git commit failed: ${commitRes.stderr}`);
  }
  return {
    cwd,
    git,
    headSha(): string {
      const res = git(["rev-parse", "HEAD"]);
      if (res.exitCode !== 0) throw new Error(`git rev-parse HEAD failed: ${res.stderr}`);
      return res.stdout.trim();
    },
    statusPorcelain(): string {
      return git(["status", "--porcelain"]).stdout.trim();
    },
    commitAll(message: string): string {
      const a = git(["add", "-A"]);
      if (a.exitCode !== 0) throw new Error(`git add failed: ${a.stderr}`);
      const c = git(["commit", "-m", message]);
      if (c.exitCode !== 0) throw new Error(`git commit failed: ${c.stderr}`);
      return git(["rev-parse", "HEAD"]).stdout.trim();
    },
  };
}

export type ComplianceProfile =
  | "standard"
  | "art50-only"
  | "high-risk-annex-iii"
  | "high-risk-annex-i"
  | string;

export interface ComplianceTomlOptions {
  profile?: ComplianceProfile;
  redactPii?: boolean;
  minReviewMs?: number;
  gitProvenanceTrailer?: boolean;
  allowYolo?: boolean;
  maxRetriesPerSignature?: number;
  overseerId?: string;
  logRetentionDays?: number;
  monitoringEnabled?: boolean;
  workerNoticeAcknowledged?: boolean;
  driftAlpha?: number;
  minWindow?: number;
  kAnonymity?: number;
  ttftSpikeFactor?: number;
  rateLimitSafetyFloor?: number;
  ttftWindow?: number;
  staticConcurrencyKey?: { name: "concurrency" | "wip" | "workers" | "max_parallel"; value: number };
  maxTransportRetries?: number;
  rollbackOnDirty?: boolean;
  maxCycles?: number;
  maxTotalTokens?: number;
  maxWallClockMs?: number;
  maxRemediationAttempts?: number;
  ocelEnabled?: boolean;
  ocelOutputDir?: string;
  redactEnv?: string[];
  includePaths?: boolean;
  omitPmm?: boolean;
}

function tomlString(v: string): string {
  return JSON.stringify(v);
}

export function buildComplianceToml(opts: ComplianceTomlOptions = {}): string {
  const lines: string[] = [];
  if (opts.includePaths !== false) {
    lines.push(
      "[paths]",
      `castle_dir = ${tomlString("/Users/sac/castle")}`,
      `wasm4pm_dir = ${tomlString("/Users/sac/wasm4pm")}`,
      `wasm4pm_compat_dir = ${tomlString("/Users/sac/wasm4pm-compat")}`,
      "",
    );
  }
  lines.push(
    "[compliance]",
    `profile = ${tomlString(opts.profile ?? "high-risk-annex-iii")}`,
    `redact_pii = ${opts.redactPii ?? true}`,
    `min_review_ms = ${opts.minReviewMs ?? 1000}`,
    `git_provenance_trailer = ${opts.gitProvenanceTrailer ?? true}`,
    `allow_yolo = ${opts.allowYolo ?? false}`,
    `max_retries_per_signature = ${opts.maxRetriesPerSignature ?? 3}`,
    "",
  );
  lines.push("[deployer]");
  if (opts.overseerId !== undefined) {
    if (opts.overseerId !== "") {
      lines.push(`overseer_id = ${tomlString(opts.overseerId)}`);
    }
  } else {
    lines.push(`overseer_id = ${tomlString("overseer-alice-eu")}`);
  }
  lines.push(
    `log_retention_days = ${opts.logRetentionDays ?? 180}`,
    `monitoring_enabled = ${opts.monitoringEnabled ?? true}`,
    `worker_notice_acknowledged = ${opts.workerNoticeAcknowledged ?? true}`,
    "",
  );
  if (!opts.omitPmm) {
    lines.push(
      "[pmm]",
      `drift_alpha = ${opts.driftAlpha ?? 0.01}`,
      `min_window = ${opts.minWindow ?? 20}`,
      `k_anonymity = ${opts.kAnonymity ?? 5}`,
      "",
    );
  }
  lines.push(
    "[aimd]",
    `ttft_spike_factor = ${opts.ttftSpikeFactor ?? 2.0}`,
    `rate_limit_safety_floor = ${opts.rateLimitSafetyFloor ?? 0.05}`,
    `ttft_window = ${opts.ttftWindow ?? 32}`,
  );
  if (opts.staticConcurrencyKey) {
    lines.push(`${opts.staticConcurrencyKey.name} = ${opts.staticConcurrencyKey.value}`);
  }
  lines.push(
    "",
    "[retries]",
    `max_transport_retries = ${opts.maxTransportRetries ?? 3}`,
    `rollback_on_dirty = ${opts.rollbackOnDirty ?? true}`,
    "",
    "[budgets]",
    `max_cycles = ${opts.maxCycles ?? 1}`,
    `max_total_tokens = ${opts.maxTotalTokens ?? 2000000}`,
    `max_wall_clock_ms = ${opts.maxWallClockMs ?? 7200000}`,
    `max_remediation_attempts = ${opts.maxRemediationAttempts ?? 3}`,
    "",
    "[ocel]",
    `enabled = ${opts.ocelEnabled ?? true}`,
    `output_dir = ${tomlString(opts.ocelOutputDir ?? "./.zcode-ocel-out")}`,
    `redact_env = [${(opts.redactEnv ?? ["API_KEY", "AUTHORIZATION", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]).map(tomlString).join(", ")}]`,
    "",
  );
  return lines.join("\n");
}

export interface Ocel2Relationship {
  objectId: string;
  qualifier: string;
}

export interface Ocel2DynamicAttribute {
  name: string;
  value: string;
  time: string;
}

export interface Ocel2EventAttribute {
  name: string;
  value: string;
}

export interface Ocel2Object {
  id: string;
  type: string;
  attributes: Ocel2DynamicAttribute[];
  relationships: Ocel2Relationship[];
}

export interface Ocel2Event {
  id: string;
  type: string;
  time: string;
  attributes: Ocel2EventAttribute[];
  relationships: Ocel2Relationship[];
}

export interface Ocel2TypeSchema {
  name: string;
  attributes: Array<{ name: string; type: string }>;
}

export interface Ocel2Doc {
  objectTypes: Ocel2TypeSchema[];
  eventTypes: Ocel2TypeSchema[];
  objects: Ocel2Object[];
  events: Ocel2Event[];
}

export function canonOcelEvent(
  event: { id: string; type: string; time: string; relationships: Ocel2Relationship[] },
  phase = "",
  pendingRef = "",
): string {
  const rels = event.relationships
    .map(
      (r) =>
        `{"objectId":${JSON.stringify(r.objectId)},"qualifier":${JSON.stringify(r.qualifier)}}`,
    )
    .join(",");
  const bound = phase
    ? `,"pendingRef":${JSON.stringify(pendingRef)},"phase":${JSON.stringify(phase)}`
    : "";
  return `{"id":${JSON.stringify(event.id)}${bound},"relationships":[${rels}],"time":${JSON.stringify(event.time)},"type":${JSON.stringify(event.type)}}`;
}

export function computePiHash(
  parent: string,
  event: { id: string; type: string; time: string; relationships: Ocel2Relationship[] },
  phase = "",
  pendingRef = "",
): string {
  return sha256Text(`${parent}\n${canonOcelEvent(event, phase, pendingRef)}`);
}

const CHAIN_ATTR_NAMES = new Set(["pi_parent", "pi_hash", "pi_hash_alg"]);

export function canonicalizeOcel2Chain(events: Ocel2Event[]): Ocel2Event[] {
  let parent = "";
  return events.map((ev) => {
    const phase = ev.attributes.find((a) => a.name === "pi_phase")?.value ?? "";
    const ref = ev.attributes.find((a) => a.name === "pi_pending_ref")?.value ?? "";
    const hash = computePiHash(parent, ev, phase, ref);
    const domainAttrs = ev.attributes.filter((a) => !CHAIN_ATTR_NAMES.has(a.name));
    const next: Ocel2Event = {
      ...ev,
      attributes: [
        { name: "pi_parent", value: parent },
        { name: "pi_hash", value: hash },
        { name: "pi_hash_alg", value: "sha256" },
        ...domainAttrs,
      ],
    };
    parent = hash;
    return next;
  });
}

export const DEFAULT_OCEL2_OBJECT_TYPES: Ocel2TypeSchema[] = [
  {
    name: "session",
    attributes: [
      { name: "compliance_profile", type: "string" },
      { name: "zcode_cli_version", type: "string" },
      { name: "runtime_version", type: "string" },
      { name: "git_head_sha", type: "string" },
    ],
  },
  { name: "turn", attributes: [{ name: "standing", type: "string" }] },
  {
    name: "tool_call",
    attributes: [
      { name: "tool_name", type: "string" },
      { name: "risk_level", type: "string" },
    ],
  },
  {
    name: "model_request",
    attributes: [
      { name: "provider_id", type: "string" },
      { name: "model_id", type: "string" },
      { name: "prompt_sha256", type: "string" },
      { name: "ttft_ms", type: "string" },
      { name: "service_ms", type: "string" },
    ],
  },
  {
    name: "permission",
    attributes: [
      { name: "decision", type: "string" },
      { name: "decision_latency_ms", type: "string" },
      { name: "overseer_id", type: "string" },
    ],
  },
  {
    name: "human_overseer",
    attributes: [
      { name: "overseer_id", type: "string" },
      { name: "role", type: "string" },
    ],
  },
  { name: "subagent", attributes: [{ name: "agent_id", type: "string" }] },
  {
    name: "workspace_file",
    attributes: [
      { name: "path", type: "string" },
      { name: "sha256", type: "string" },
    ],
  },
  { name: "receipt", attributes: [{ name: "standing", type: "string" }] },
  { name: "work_order", attributes: [{ name: "work_order_id", type: "string" }] },
  { name: "item", attributes: [] },
  { name: "order", attributes: [] },
];

export const DEFAULT_OCEL2_EVENT_TYPES: Ocel2TypeSchema[] = [
  { name: "session_created", attributes: [{ name: "compliance_profile", type: "string" }] },
  {
    name: "art50_disclosure_emitted",
    attributes: [
      { name: "channel", type: "string" },
      { name: "regulation", type: "string" },
      { name: "provider_id", type: "string" },
      { name: "model_id", type: "string" },
    ],
  },
  { name: "turn_started", attributes: [] },
  { name: "permission_requested", attributes: [{ name: "risk_level", type: "string" }] },
  {
    name: "permission_resolved",
    attributes: [
      { name: "decision", type: "string" },
      { name: "decision_latency_ms", type: "string" },
      { name: "overseer_id", type: "string" },
      { name: "auto_resolved", type: "string" },
    ],
  },
  {
    name: "model_request_completed",
    attributes: [
      { name: "provider_id", type: "string" },
      { name: "model_id", type: "string" },
      { name: "ttft_ms", type: "string" },
      { name: "service_ms", type: "string" },
      { name: "status", type: "string" },
    ],
  },
  {
    name: "tool_updated",
    attributes: [
      { name: "tool_name", type: "string" },
      { name: "status", type: "string" },
    ],
  },
  {
    name: "oversight_intervened",
    attributes: [
      { name: "overseer_id", type: "string" },
      { name: "reason", type: "string" },
    ],
  },
  { name: "workspace_rolled_back", attributes: [{ name: "reason", type: "string" }] },
  {
    name: "drift_detected",
    attributes: [
      { name: "drift_kind", type: "string" },
      { name: "p_value", type: "string" },
    ],
  },
  { name: "worker_claim", attributes: [] },
  { name: "receipt_persist", attributes: [] },
  { name: "turn_completed", attributes: [{ name: "fitness", type: "string" }] },
  { name: "turn_failed", attributes: [{ name: "error_signature", type: "string" }] },
  { name: "session_closed", attributes: [] },
  { name: "unredacted_secret", attributes: [] },
  { name: "mode_yolo_enabled", attributes: [] },
  { name: "high_risk_profile_active", attributes: [] },
];

export function buildOcel2Doc(
  opts: {
    objectTypes?: Ocel2TypeSchema[];
    eventTypes?: Ocel2TypeSchema[];
    objects?: Ocel2Object[];
    events?: Ocel2Event[];
    preserveExistingHashes?: boolean;
  } = {},
): Ocel2Doc {
  const events = opts.preserveExistingHashes
    ? (opts.events ?? [])
    : canonicalizeOcel2Chain(opts.events ?? []);
  return {
    objectTypes: opts.objectTypes ?? DEFAULT_OCEL2_OBJECT_TYPES,
    eventTypes: opts.eventTypes ?? DEFAULT_OCEL2_EVENT_TYPES,
    objects: opts.objects ?? [],
    events,
  };
}

export interface ConformingSessionOptions {
  sessionId?: string;
  baseTimeMs?: number;
  profile?: ComplianceProfile;
  providerId?: string;
  modelId?: string;
  overseerId?: string;
  toolName?: string;
  decisionLatencyMs?: number;
  ttftMs?: number;
  serviceMs?: number;
  gitHeadSha?: string;
  includeSubagent?: boolean;
  includeRework?: boolean;
  extraToolCount?: number;
}

export function buildConformingHighRiskSession(opts: ConformingSessionOptions = {}): Ocel2Doc {
  const sess = opts.sessionId ?? "sess_01";
  const turn = `${sess}_turn_01`;
  const tool = `${sess}_tool_01`;
  const req = `${sess}_req_01`;
  const perm = `${sess}_perm_01`;
  const overseer = `${sess}_overseer_01`;
  const fileObj = `${sess}_file_01`;
  const receiptObj = `${sess}_receipt_01`;
  const subagentObj = `${sess}_subagent_01`;
  const baseMs = opts.baseTimeMs ?? Date.parse("2026-08-02T10:00:00.000Z");
  const iso = (offsetMs: number) => new Date(baseMs + offsetMs).toISOString();
  const profile = opts.profile ?? "high-risk-annex-iii";
  const providerId = opts.providerId ?? "zai";
  const modelId = opts.modelId ?? "glm-5.3";
  const overseerId = opts.overseerId ?? "overseer-alice-eu";
  const toolName = opts.toolName ?? "Write";
  const decisionLatencyMs = opts.decisionLatencyMs ?? 1450;
  const ttftMs = opts.ttftMs ?? 120;
  const serviceMs = opts.serviceMs ?? 4200;
  const headSha = opts.gitHeadSha ?? "0".repeat(40);
  const permResolvedMs = 1000 + decisionLatencyMs;
  const modelCompletedMs = permResolvedMs + 100;
  const toolUpdatedMs = modelCompletedMs + 200;
  const reworkEndMs = opts.includeRework ? modelCompletedMs + 400 : toolUpdatedMs;
  const extraEndMs =
    (opts.extraToolCount ?? 0) > 0
      ? modelCompletedMs + 600 + ((opts.extraToolCount ?? 0) - 1) * 10
      : reworkEndMs;
  const modelAttrEndMs = 300 + Math.max(serviceMs, ttftMs);
  const turnCompletedMs = Math.max(5000, extraEndMs + 200, modelAttrEndMs + 200);
  const sessionClosedMs = turnCompletedMs + 100;

  const objects: Ocel2Object[] = [
    {
      id: sess,
      type: "session",
      attributes: [
        { name: "compliance_profile", value: profile, time: iso(0) },
        { name: "zcode_cli_version", value: "3.14.4-1", time: iso(0) },
        { name: "runtime_version", value: "0.16.9", time: iso(0) },
        { name: "git_head_sha", value: headSha, time: iso(0) },
      ],
      relationships: [{ objectId: overseer, qualifier: "governs" }],
    },
    {
      id: overseer,
      type: "human_overseer",
      attributes: [
        { name: "overseer_id", value: overseerId, time: iso(0) },
        { name: "role", value: "deployer_oversight", time: iso(0) },
      ],
      relationships: [{ objectId: sess, qualifier: "governs" }],
    },
    {
      id: turn,
      type: "turn",
      attributes: [
        { name: "standing", value: "RUNNING", time: iso(200) },
        { name: "standing", value: "ALIVE", time: iso(turnCompletedMs) },
      ],
      relationships: [{ objectId: sess, qualifier: "in_session" }],
    },
    {
      id: req,
      type: "model_request",
      attributes: [
        { name: "provider_id", value: providerId, time: iso(300) },
        { name: "model_id", value: modelId, time: iso(300) },
        { name: "prompt_sha256", value: sha256Text(`prompt:${sess}`), time: iso(300) },
        { name: "ttft_ms", value: String(ttftMs), time: iso(300 + Math.min(ttftMs, serviceMs)) },
        { name: "service_ms", value: String(serviceMs), time: iso(modelAttrEndMs) },
      ],
      relationships: [{ objectId: turn, qualifier: "uses_provider" }],
    },
    {
      id: tool,
      type: "tool_call",
      attributes: [
        { name: "tool_name", value: toolName, time: iso(1000) },
        { name: "risk_level", value: "high", time: iso(1000) },
      ],
      relationships: [
        { objectId: turn, qualifier: "in_turn" },
        { objectId: fileObj, qualifier: "mutated_in" },
      ],
    },
    {
      id: perm,
      type: "permission",
      attributes: [
        { name: "decision", value: "allow", time: iso(permResolvedMs) },
        { name: "decision_latency_ms", value: String(decisionLatencyMs), time: iso(permResolvedMs) },
        { name: "overseer_id", value: overseerId, time: iso(permResolvedMs) },
      ],
      relationships: [{ objectId: tool, qualifier: "governs" }],
    },
    {
      id: fileObj,
      type: "workspace_file",
      attributes: [
        { name: "path", value: "src/module.ts", time: iso(toolUpdatedMs) },
        { name: "sha256", value: sha256Text(`file:${sess}`), time: iso(toolUpdatedMs) },
      ],
      relationships: [{ objectId: turn, qualifier: "mutated_in" }],
    },
    {
      id: receiptObj,
      type: "receipt",
      attributes: [{ name: "standing", value: "ALIVE", time: iso(sessionClosedMs) }],
      relationships: [{ objectId: sess, qualifier: "seals" }],
    },
  ];

  if (opts.includeSubagent) {
    objects.push({
      id: subagentObj,
      type: "subagent",
      attributes: [{ name: "agent_id", value: "worker_01", time: iso(1200) }],
      relationships: [{ objectId: sess, qualifier: "spawned_by" }],
    });
  }

  const events: Ocel2Event[] = [
    {
      id: `${sess}_ev_001`,
      type: "session_created",
      time: iso(0),
      attributes: [{ name: "compliance_profile", value: profile }],
      relationships: [{ objectId: sess, qualifier: "in_session" }],
    },
    {
      id: `${sess}_ev_002`,
      type: "art50_disclosure_emitted",
      time: iso(100),
      attributes: [
        { name: "channel", value: "stream-json" },
        { name: "regulation", value: "EU-2024-1689-Art50" },
        { name: "provider_id", value: providerId },
        { name: "model_id", value: modelId },
      ],
      relationships: [{ objectId: sess, qualifier: "in_session" }],
    },
    {
      id: `${sess}_ev_003`,
      type: "turn_started",
      time: iso(200),
      attributes: [],
      relationships: [
        { objectId: sess, qualifier: "in_session" },
        { objectId: turn, qualifier: "in_turn" },
      ],
    },
    {
      id: `${sess}_ev_004`,
      type: "permission_requested",
      time: iso(1000),
      attributes: [{ name: "risk_level", value: "high" }],
      relationships: [
        { objectId: sess, qualifier: "in_session" },
        { objectId: turn, qualifier: "in_turn" },
        { objectId: perm, qualifier: "governs" },
        { objectId: tool, qualifier: "about_tool_call" },
      ],
    },
    {
      id: `${sess}_ev_005`,
      type: "permission_resolved",
      time: iso(1000 + decisionLatencyMs),
      attributes: [
        { name: "decision", value: "allow" },
        { name: "decision_latency_ms", value: String(decisionLatencyMs) },
        { name: "overseer_id", value: overseerId },
        { name: "auto_resolved", value: "false" },
      ],
      relationships: [
        { objectId: sess, qualifier: "in_session" },
        { objectId: turn, qualifier: "in_turn" },
        { objectId: perm, qualifier: "governs" },
        { objectId: overseer, qualifier: "approved_by" },
      ],
    },
    {
      id: `${sess}_ev_006`,
      type: "model_request_completed",
      time: iso(1000 + decisionLatencyMs + 100),
      attributes: [
        { name: "provider_id", value: providerId },
        { name: "model_id", value: modelId },
        { name: "ttft_ms", value: String(ttftMs) },
        { name: "service_ms", value: String(serviceMs) },
        { name: "status", value: "ok" },
      ],
      relationships: [
        { objectId: sess, qualifier: "in_session" },
        { objectId: turn, qualifier: "in_turn" },
        { objectId: req, qualifier: "about_model_request" },
      ],
    },
    {
      id: `${sess}_ev_007`,
      type: "tool_updated",
      time: iso(1000 + decisionLatencyMs + 300),
      attributes: [
        { name: "tool_name", value: toolName },
        { name: "status", value: "success" },
      ],
      relationships: [
        { objectId: sess, qualifier: "in_session" },
        { objectId: turn, qualifier: "in_turn" },
        { objectId: tool, qualifier: "about_tool_call" },
        { objectId: fileObj, qualifier: "mutated_in" },
      ],
    },
  ];

  if (opts.includeRework) {
    events.push(
      {
        id: `${sess}_ev_007b`,
        type: "turn_failed",
        time: iso(1000 + decisionLatencyMs + 400),
        attributes: [{ name: "error_signature", value: "TS2322:type_mismatch" }],
        relationships: [
          { objectId: sess, qualifier: "in_session" },
          { objectId: turn, qualifier: "in_turn" },
        ],
      },
      {
        id: `${sess}_ev_007c`,
        type: "tool_updated",
        time: iso(1000 + decisionLatencyMs + 500),
        attributes: [
          { name: "tool_name", value: toolName },
          { name: "status", value: "retry_ok" },
        ],
        relationships: [
          { objectId: sess, qualifier: "in_session" },
          { objectId: turn, qualifier: "in_turn" },
          { objectId: tool, qualifier: "about_tool_call" },
          { objectId: fileObj, qualifier: "mutated_in" },
        ],
      },
    );
  }

  for (let i = 0; i < (opts.extraToolCount ?? 0); i++) {
    events.push({
      id: `${sess}_ev_extra_${i + 1}`,
      type: "tool_updated",
      time: iso(1000 + decisionLatencyMs + 600 + i * 10),
      attributes: [
        { name: "tool_name", value: "Read" },
        { name: "status", value: "success" },
      ],
      relationships: [
        { objectId: sess, qualifier: "in_session" },
        { objectId: turn, qualifier: "in_turn" },
        { objectId: tool, qualifier: "about_tool_call" },
      ],
    });
  }

  events.push(
    {
      id: `${sess}_ev_008`,
      type: "turn_completed",
      time: iso(turnCompletedMs),
      attributes: [{ name: "fitness", value: "1.0" }],
      relationships: [
        { objectId: sess, qualifier: "in_session" },
        { objectId: turn, qualifier: "in_turn" },
      ],
    },
    {
      id: `${sess}_ev_009`,
      type: "session_closed",
      time: iso(sessionClosedMs),
      attributes: [],
      relationships: [
        { objectId: sess, qualifier: "in_session" },
        { objectId: receiptObj, qualifier: "seals" },
      ],
    },
  );

  return buildOcel2Doc({ objects, events });
}

export function buildAppServerSession(): Ocel2Doc {
  const fixturePath = join(REPO_ROOT, "test/fixtures/zcode-ocel/app-server-list.jsonocel");
  const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as Ocel2Doc;
  return buildOcel2Doc({
    objectTypes: raw.objectTypes,
    eventTypes: raw.eventTypes,
    objects: raw.objects,
    events: raw.events,
    preserveExistingHashes: true,
  });
}

export function buildPmmLogSet(
  kind: "stationary" | "sudden_drift" | "gradual_drift" | "heavy_tailed",
  count = 40,
): Array<{ filename: string; doc: Ocel2Doc }> {
  const out: Array<{ filename: string; doc: Ocel2Doc }> = [];
  const baseStart = Date.parse("2026-08-02T00:00:00.000Z");

  for (let i = 0; i < count; i++) {
    const sessId = `pmm_${kind}_${String(i + 1).padStart(3, "0")}`;
    const baseTimeMs = baseStart + i * 60_000;
    const isSecondHalf = i >= Math.floor(count / 2);

    let ttftMs = 110 + (i % 5) * 10;
    let serviceMs = 4000 + (i % 4) * 500;
    let decisionLatencyMs = 1200 + (i % 6) * 150;
    let injectFailure = false;

    if (kind === "heavy_tailed") {
      // Healthy TTFT across all turns, but heavy-tailed coding turn duration (10x spike on every 5th turn).
      ttftMs = 95 + (i % 4) * 12;
      serviceMs = i % 5 === 0 ? 120_000 : 3500;
    } else if (kind === "sudden_drift" && isSecondHalf) {
      injectFailure = true;
      decisionLatencyMs = 150;
      ttftMs = 950;
    } else if (kind === "gradual_drift" && isSecondHalf) {
      const progress = (i - Math.floor(count / 2)) / Math.max(1, count / 2);
      ttftMs = Math.round(120 + progress * 800);
      decisionLatencyMs = Math.round(1400 - progress * 1100);
      if (progress > 0.5) injectFailure = true;
    }

    const baseDoc = buildConformingHighRiskSession({
      sessionId: sessId,
      baseTimeMs,
      providerId: i % 2 === 0 ? "zai" : "anthropic",
      modelId: i % 2 === 0 ? "glm-5.3" : "claude-sonnet-4",
      overseerId: `overseer-${(i % 3) + 1}`,
      ttftMs,
      serviceMs,
      decisionLatencyMs,
      includeRework: injectFailure,
    });

    if (injectFailure) {
      const modifiedEvents = baseDoc.events.map((ev) =>
        ev.type === "turn_completed"
          ? { ...ev, attributes: [{ name: "fitness", value: "0.62" }] }
          : ev,
      );
      out.push({
        filename: `${sessId}.ocel.json`,
        doc: buildOcel2Doc({
          objectTypes: baseDoc.objectTypes,
          eventTypes: baseDoc.eventTypes,
          objects: baseDoc.objects,
          events: modifiedEvents,
        }),
      });
    } else {
      out.push({ filename: `${sessId}.ocel.json`, doc: baseDoc });
    }
  }
  return out;
}

export function buildKAnonLogSet(
  opts: { k?: number; variantCount?: number; includeOutlier?: boolean } = {},
): Ocel2Doc {
  const k = opts.k ?? 5;
  const variantCount = opts.variantCount ?? 2;
  const objects: Ocel2Object[] = [];
  const events: Ocel2Event[] = [];
  const baseMs = Date.parse("2026-08-03T09:00:00.000Z");
  let offset = 0;

  for (let v = 0; v < variantCount; v++) {
    for (let copy = 0; copy < k; copy++) {
      const idx = v * k + copy + 1;
      const doc = buildConformingHighRiskSession({
        sessionId: `kanon_v${v + 1}_c${copy + 1}`,
        baseTimeMs: baseMs + offset * 10_000,
        overseerId: `raw-user-alice-${idx}@example.eu`,
        extraToolCount: v,
      });
      objects.push(...doc.objects);
      events.push(...doc.events);
      offset++;
    }
  }

  if (opts.includeOutlier) {
    const outlier = buildConformingHighRiskSession({
      sessionId: "kanon_outlier_unique",
      baseTimeMs: baseMs + offset * 10_000,
      overseerId: "unique-whistleblower@example.eu",
      extraToolCount: 7,
    });
    objects.push(...outlier.objects);
    events.push(...outlier.events);
  }

  return buildOcel2Doc({ objects, events });
}

export function buildPiiSecretSession(): Ocel2Doc {
  const doc = buildConformingHighRiskSession({
    sessionId: "sess_pii_01",
    overseerId: "alice.mueller@example.de",
  });
  const extraObject: Ocel2Object = {
    id: "sess_pii_01_file_secret",
    type: "workspace_file",
    attributes: [
      { name: "path", value: "/Users/alicemueller/src/secret.ts", time: "2026-08-02T10:00:03.000Z" },
      { name: "sha256", value: sha256Text("secret-file"), time: "2026-08-02T10:00:03.000Z" },
    ],
    relationships: [{ objectId: "sess_pii_01", qualifier: "in_session" }],
  };
  const payload = JSON.stringify({
    apiKey: "sk-live-secret-99887766",
    refresh_token: "rt_abcdef123456",
    auth: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    email: "alice.mueller@example.de",
    ip: "192.168.14.22",
    homePath: "/Users/alicemueller/workspace/app.ts",
    pem: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEF\n-----END PRIVATE KEY-----",
    note: "the token bucket refills",
    emptyKey: "",
  });
  const events = doc.events.map((ev) =>
    ev.type === "tool_updated"
      ? {
          ...ev,
          attributes: [
            ...ev.attributes,
            { name: "output_preview", value: payload },
          ],
        }
      : ev,
  );
  return buildOcel2Doc({
    objectTypes: doc.objectTypes,
    eventTypes: doc.eventTypes,
    objects: [...doc.objects, extraObject],
    events,
  });
}

export function buildOversightCrashSession(
  opts: { kind?: "oversight_intervened" | "crash" | "dirty_rollback" | "ab_risk" } = {},
): Ocel2Doc {
  const kind = opts.kind ?? "oversight_intervened";
  const base = buildConformingHighRiskSession({
    sessionId: `sess_${kind}`,
    decisionLatencyMs: kind === "ab_risk" ? 180 : 1400,
    includeSubagent: true,
  });

  if (kind === "ab_risk") {
    return base;
  }

  const extraEvents: Ocel2Event[] = [];
  if (kind === "oversight_intervened" || kind === "dirty_rollback") {
    extraEvents.push({
      id: `sess_${kind}_ev_stop`,
      type: "oversight_intervened",
      time: "2026-08-02T10:00:04.500Z",
      attributes: [
        { name: "overseer_id", value: "overseer-alice-eu" },
        { name: "reason", value: "human_emergency_stop" },
      ],
      relationships: [{ objectId: `sess_${kind}`, qualifier: "in_session" }],
    });
  }
  if (kind === "dirty_rollback") {
    extraEvents.push({
      id: `sess_${kind}_ev_rb`,
      type: "workspace_rolled_back",
      time: "2026-08-02T10:00:04.700Z",
      attributes: [{ name: "reason", value: "dirty_timeout_rollback" }],
      relationships: [{ objectId: `sess_${kind}`, qualifier: "in_session" }],
    });
  }
  if (kind === "crash") {
    extraEvents.push({
      id: `sess_${kind}_ev_fail`,
      type: "turn_failed",
      time: "2026-08-02T10:00:04.600Z",
      attributes: [{ name: "error_signature", value: "ERR_UNHANDLED_EXCEPTION" }],
      relationships: [{ objectId: `sess_${kind}`, qualifier: "in_session" }],
    });
    const withoutCompleteOrClose = base.events.filter(
      (e) => e.type !== "turn_completed" && e.type !== "session_closed",
    );
    const objects = base.objects.map((o) =>
      o.type === "turn"
        ? {
            ...o,
            attributes: [
              { name: "standing", value: "RUNNING", time: "2026-08-02T10:00:00.200Z" },
              { name: "standing", value: "FAILED", time: "2026-08-02T10:00:04.600Z" },
            ],
          }
        : o.type === "receipt"
          ? {
              ...o,
              attributes: [{ name: "standing", value: "BLOCKED", time: "2026-08-02T10:00:04.600Z" }],
            }
          : o,
    );
    return buildOcel2Doc({
      objectTypes: base.objectTypes,
      eventTypes: base.eventTypes,
      objects,
      events: [...withoutCompleteOrClose, ...extraEvents],
    });
  }

  const head = base.events.slice(0, -2);
  const tail = base.events.slice(-2);
  return buildOcel2Doc({
    objectTypes: base.objectTypes,
    eventTypes: base.eventTypes,
    objects: base.objects,
    events: [...head, ...extraEvents, ...tail],
  });
}

export interface WorkflowNetPlace {
  id: string;
  objectType: string;
}

export interface WorkflowNetTransition {
  id: string;
  label: string;
  silent: boolean;
  activityId?: string;
  objectType?: string;
}

export interface WorkflowNetJson {
  places: WorkflowNetPlace[];
  transitions: WorkflowNetTransition[];
  pre: Record<string, string[]>;
  post: Record<string, string[]>;
  sourcePlace: string;
  sinkPlace: string;
}

export function buildWfNetJson(opts: { linearActivities?: string[]; withParallel?: boolean } = {}): WorkflowNetJson {
  if (opts.withParallel) {
    return {
      places: [
        { id: "p_source", objectType: "Workflow" },
        { id: "p_b1", objectType: "Workflow" },
        { id: "p_b2", objectType: "Workflow" },
        { id: "p_j1", objectType: "Workflow" },
        { id: "p_j2", objectType: "Workflow" },
        { id: "p_sink", objectType: "Workflow" },
      ],
      transitions: [
        { id: "t_split", label: "session_created", silent: false, activityId: "session_created", objectType: "session" },
        { id: "t_disc", label: "art50_disclosure_emitted", silent: false, activityId: "art50_disclosure_emitted", objectType: "session" },
        { id: "t_turn", label: "turn_started", silent: false, activityId: "turn_started", objectType: "turn" },
        { id: "t_join", label: "turn_completed", silent: false, activityId: "turn_completed", objectType: "turn" },
      ],
      pre: {
        t_split: ["p_source"],
        t_disc: ["p_b1"],
        t_turn: ["p_b2"],
        t_join: ["p_j1", "p_j2"],
      },
      post: {
        t_split: ["p_b1", "p_b2"],
        t_disc: ["p_j1"],
        t_turn: ["p_j2"],
        t_join: ["p_sink"],
      },
      sourcePlace: "p_source",
      sinkPlace: "p_sink",
    };
  }

  const activities = opts.linearActivities ?? [
    "session_created",
    "art50_disclosure_emitted",
    "turn_started",
    "permission_requested",
    "permission_resolved",
    "model_request_completed",
    "tool_updated",
    "turn_completed",
    "session_closed",
  ];
  const places: WorkflowNetPlace[] = [{ id: "p_0", objectType: "Workflow" }];
  const transitions: WorkflowNetTransition[] = [];
  const pre: Record<string, string[]> = {};
  const post: Record<string, string[]> = {};

  activities.forEach((act, idx) => {
    const pIn = `p_${idx}`;
    const pOut = `p_${idx + 1}`;
    const tId = `t_${idx}_${act}`;
    places.push({ id: pOut, objectType: "Workflow" });
    transitions.push({
      id: tId,
      label: act,
      silent: false,
      activityId: act,
      objectType: "session",
    });
    pre[tId] = [pIn];
    post[tId] = [pOut];
  });

  return {
    places,
    transitions,
    pre,
    post,
    sourcePlace: "p_0",
    sinkPlace: `p_${activities.length}`,
  };
}

export type DeclareTemplate =
  | "Init"
  | "Existence"
  | "Absence"
  | "Response"
  | "Precedence"
  | "ChainResponse"
  | "NotCoExistence";

export interface DeclareRule {
  id: string;
  template: DeclareTemplate;
  activity?: string;
  activation?: string;
  target?: string;
  minCount?: number;
  maxCount?: number;
  objectType: string;
  mandatory: boolean;
}

export interface DeclareRulesDoc {
  schema: "zcode.declare-rules/1";
  rules: DeclareRule[];
}

export function buildDeclareRulesJson(rules?: DeclareRule[]): DeclareRulesDoc {
  return {
    schema: "zcode.declare-rules/1",
    rules: rules ?? [
      {
        id: "DEC-INIT-SESSION",
        template: "Init",
        activity: "session_created",
        objectType: "session",
        mandatory: true,
      },
      {
        id: "DEC-EXIST-TURN",
        template: "Existence",
        activity: "turn_started",
        minCount: 1,
        objectType: "session",
        mandatory: true,
      },
      {
        id: "DEC-ABS-UNREDACTED",
        template: "Absence",
        activity: "unredacted_secret",
        maxCount: 0,
        objectType: "session",
        mandatory: true,
      },
      {
        id: "DEC-RESP-ART50",
        template: "Response",
        activation: "session_created",
        target: "art50_disclosure_emitted",
        objectType: "session",
        mandatory: true,
      },
      {
        id: "DEC-PREC-ART14",
        template: "Precedence",
        activation: "tool_updated",
        target: "permission_resolved",
        objectType: "turn",
        mandatory: true,
      },
      {
        id: "DEC-CHAIN-RECEIPT",
        template: "ChainResponse",
        activation: "worker_claim",
        target: "receipt_persist",
        objectType: "work_order",
        mandatory: true,
      },
      {
        id: "DEC-NOTCO-YOLO-HIGHRISK",
        template: "NotCoExistence",
        activation: "mode_yolo_enabled",
        target: "high_risk_profile_active",
        objectType: "session",
        mandatory: true,
      },
    ],
  };
}

export interface Ocel2SqliteInspection {
  journalMode: string;
  tables: string[];
  eventCount: number;
  objectCount: number;
  eventObjectCount: number;
  objectObjectCount: number;
  eventMapTypes: string[];
  objectMapTypes: string[];
  events: Array<{ ocel_id: string; ocel_type: string }>;
  objects: Array<{ ocel_id: string; ocel_type: string }>;
}

export function inspectOcel2Sqlite(dbPath: string): Ocel2SqliteInspection {
  const db = new Database(dbPath, { readonly: true });
  try {
    const modeRow = db.query("PRAGMA journal_mode;").get() as { journal_mode?: string } | null;
    const tableRows = db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")
      .all() as Array<{ name: string }>;
    const tables = tableRows.map((r) => r.name);

    const countTable = (name: string): number => {
      if (!tables.includes(name)) return 0;
      const row = db.query(`SELECT COUNT(*) AS cnt FROM ${name};`).get() as { cnt: number } | null;
      return row?.cnt ?? 0;
    };

    const events = tables.includes("event")
      ? (db.query("SELECT ocel_id, ocel_type FROM event ORDER BY ocel_id;").all() as Array<{
          ocel_id: string;
          ocel_type: string;
        }>)
      : [];

    const objects = tables.includes("object")
      ? (db.query("SELECT ocel_id, ocel_type FROM object ORDER BY ocel_id;").all() as Array<{
          ocel_id: string;
          ocel_type: string;
        }>)
      : [];

    const eventMapTypes = tables.includes("event_map_type")
      ? (db.query("SELECT ocel_type FROM event_map_type ORDER BY ocel_type;").all() as Array<{ ocel_type: string }>).map(
          (r) => r.ocel_type,
        )
      : [];

    const objectMapTypes = tables.includes("object_map_type")
      ? (db.query("SELECT ocel_type FROM object_map_type ORDER BY ocel_type;").all() as Array<{ ocel_type: string }>).map(
          (r) => r.ocel_type,
        )
      : [];

    return {
      journalMode: (modeRow?.journal_mode ?? "").toLowerCase(),
      tables,
      eventCount: countTable("event"),
      objectCount: countTable("object"),
      eventObjectCount: countTable("event_object"),
      objectObjectCount: countTable("object_object"),
      eventMapTypes,
      objectMapTypes,
      events,
      objects,
    };
  } finally {
    db.close();
  }
}

export interface DfcmReceiptValidationResult {
  admitted: boolean;
  exitCode: number;
  output: string;
}

export function validateDfcmReceipt(
  receiptPath: string,
  opts: { cwd?: string; realHome?: string } = {},
): DfcmReceiptValidationResult {
  const home = opts.realHome ?? REAL_HOME;
  const validator = join(home, ".claude", "dfcm", "validate_receipt.py");
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HOME: home,
  };
  const res = runSubprocess("python3", [validator, receiptPath], {
    cwd: opts.cwd ?? REPO_ROOT,
    env,
    timeoutMs: 10_000,
  });
  return {
    admitted: res.exitCode === 0,
    exitCode: res.exitCode,
    output: (res.stdout + "\n" + res.stderr).trim(),
  };
}
