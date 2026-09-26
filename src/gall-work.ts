// Native `zcode gall-work` -- the gall-work contract (contract_version 1,
// see test/fixtures/gall-work.contract.json, byte-identical in the xaas repo
// at priv/zcode_plugin/gall-work.contract.json).
//
// One invocation runs the FULL worker lifecycle against the XaaS execution
// fabric, with no `/xaas claim_next` prompt fallback:
//
//   claim      JSON-RPC tools/call claim_next {provider, provider_worker_id,
//              epoch_id, idempotency_key} -> lease token + work payload (goal,
//              worktree, verifier_suite). Fail-closed: a refused claim is a
//              typed non-zero exit, never a retry-as-prompt. The provider is
//              resolved from the execution-provider registry
//              (src/execution-providers.ts; built-in default "zcode",
//              fail-closed on a disabled selection).
//   discover   Before claiming, a real MCP initialize + tools/list handshake
//              records the fabric's capability surface; a server without the
//              handshake degrades typed (discovery.degraded) and the static
//              contract vocabulary stands.
//   reconcile  Before claiming, stale lease files for this cwd (a crashed
//              predecessor that never closed) are reconciled with the fabric:
//              terminal -> cleared; open past the heartbeat grace -> reclaimed
//              via cancel_work/refuse (execution.crash + receipt persisted);
//              genuinely live elsewhere -> left untouched. This closes the
//              orphan lease-to-TTL failed edge and wires clearLeaseFiles.
//   persist    Save the lease to <tmpdir>/xaas-fabric/<sha256(cwd)>.json --
//              the exact file and conflict guard the xaas-fabric plugin's
//              PreToolUse gate (scripts/xaas-gate.mjs) reads -- so the host
//              gate arms for the constructed turn.
//   construct  Spawn the vendored runtime on a fixed doctrinal prompt whose
//              argv carries NO goal text: the goal travels in a work-order
//              file under the lease state dir and the prompt references only
//              its path. Heartbeats renew the lease while the turn runs;
//              heartbeat failures are surfaced in evidence, never dropped.
//              SIGINT/SIGTERM abort the turn and close the lease typed
//              (cancel_work, fallback refuse) -- never an orphan. An internal
//              construct deadline (default 4h, --construct-deadline-seconds)
//              bounds the turn independently of the dispatcher.
//   close      `git rev-parse HEAD` in the lease cwd, then close_candidate
//              {final_head, outcome, evidence}. Runtime exit 0 closes as
//              `alive` (the fabric's own verifier court falsifies if the
//              work is wrong); a failed turn closes as `blocked` with the
//              exit code and output tail in evidence; a turn that cannot
//              even be spawned refuses (`blocked`). Any sealed receipt is
//              exit 0 -- the epoch is terminal and the queue head unblocked.
//              Evidence carries origin_authority (work-order origin authority
//              propagated from the lease descriptor / claim payload, never
//              fabricated) and a replay_binding (contract digest + dispatch
//              identity) so a third party can re-run the dispatch.
//
// Fail-closed posture: every stage failure is a typed result document
// (schema gall.work-result/1) plus the contract exit code, except where a
// receipt was sealed. No partial silent states.
import { execFile } from "node:child_process";
import { spawn as spawnChild, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { selectExecutionProvider, type ReadConfigText } from "./execution-providers.ts";
import { GALL_WORK_SOURCE, OcelRecorder, STREAM_SOURCE, leaseIdentityFromEnv, ocelDirectory, ocelEnabled } from "./ocel-tap.ts";
import { resolveRuntimeNode } from "./runtime-node.ts";
import {
  capacityFromBody,
  capacityFromStatus,
  callWithCapacityBackoff,
  ConcurrencyCap,
  defaultFabricConcurrencyLimit,
  isProviderCapacityRefusal,
  type CapacitySignal
} from "./provider-backoff.ts";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// gall.work-lease/1 descriptor (the semantic-identity claim form)
// ---------------------------------------------------------------------------

export interface GallWorkLease {
  schema: "gall.work-lease/1";
  work_order_iri: string;
  checkpoint_iri: string;
  graph_digest: string;
  repository_identity: string;
  base_sha: string;
  epoch_id: string;
  worker_id: string;
  worktree: string;
  /** Work-order origin authority (ALOOP originAuthority qualifier); carried, never invented. */
  origin_authority?: string;
}

const sha256Digest = /^sha256:[0-9a-f]{64}$/u;
const gitSha = /^[0-9a-f]{40}$/u;
const repositoryIdentity = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const workerIdPattern = /^[A-Za-z0-9._:-]{1,128}$/u;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid GALL work lease field: ${field}.`);
  }
  return value;
}

export function parseGallWorkLease(value: unknown): GallWorkLease {
  const input = record(value);
  if (!input || input.schema !== "gall.work-lease/1") {
    throw new Error("Unsupported GALL work lease schema.");
  }

  const work_order_iri = nonEmptyString(input.work_order_iri, "work_order_iri");
  const checkpoint_iri = nonEmptyString(input.checkpoint_iri, "checkpoint_iri");
  const graph_digest = nonEmptyString(input.graph_digest, "graph_digest");
  const repository_identity = nonEmptyString(input.repository_identity, "repository_identity");
  const base_sha = nonEmptyString(input.base_sha, "base_sha");
  const epoch_id = nonEmptyString(input.epoch_id, "epoch_id");
  const selectedWorker = nonEmptyString(input.worker_id, "worker_id");
  const worktree = nonEmptyString(input.worktree, "worktree");

  if (!work_order_iri.includes(":")) throw new Error("work_order_iri must be an absolute IRI.");
  if (!checkpoint_iri.includes(":")) throw new Error("checkpoint_iri must be an absolute IRI.");
  if (!sha256Digest.test(graph_digest)) throw new Error("graph_digest must be sha256:<64 lowercase hex>.");
  if (!repositoryIdentity.test(repository_identity)) throw new Error("repository_identity must be owner/name.");
  if (!gitSha.test(base_sha)) throw new Error("base_sha must be an exact 40-hex commit SHA.");
  if (!uuid.test(epoch_id)) throw new Error("epoch_id must be a UUID.");
  if (!workerIdPattern.test(selectedWorker)) throw new Error("worker_id contains unsupported characters.");
  if (!isAbsolute(worktree)) throw new Error("worktree must be an absolute path.");

  const originAuthority = typeof input.origin_authority === "string" ? input.origin_authority.trim() : "";
  return {
    schema: "gall.work-lease/1",
    work_order_iri,
    checkpoint_iri,
    graph_digest,
    repository_identity,
    base_sha,
    epoch_id,
    worker_id: selectedWorker,
    worktree: resolve(worktree),
    ...(originAuthority ? { origin_authority: originAuthority } : {})
  };
}

// ---------------------------------------------------------------------------
// Invocation parsing
// ---------------------------------------------------------------------------

export interface GallWorkRequest {
  workerId: string;
  epochId: string;
  cwd: string;
  json: boolean;
  descriptor?: GallWorkLease;
  heartbeatSeconds: number;
  fabricUrl?: string;
  fabricToken?: string;
  /** Explicit execution-provider request (registry still gates enabled-ness). */
  providerId?: string;
  /** Internal construct-turn deadline in seconds; 0 disables. Default 4h. */
  constructDeadlineSeconds: number;
}

export const gallWorkUsage =
  "Usage: zcode gall-work (--lease FILE | --worker-id ID --epoch-id UUID --cwd DIR) [--json]";
const defaultHeartbeatSeconds = 240;
const defaultConstructDeadlineSeconds = 14_400;

export function parseGallWorkArgs(args: string[], env: NodeJS.ProcessEnv = process.env): GallWorkRequest {
  let workerId: string | undefined;
  let epochId: string | undefined;
  let cwd: string | undefined;
  let leasePath: string | undefined;
  let heartbeatSeconds = defaultHeartbeatSeconds;
  let providerId: string | undefined;
  let constructDeadlineSeconds = Number(env.ZCODE_CONSTRUCT_DEADLINE_SECONDS?.trim() || defaultConstructDeadlineSeconds);
  let fabricUrl = env.XAAS_MCP_URL?.trim() || undefined;
  let fabricToken = env.XAAS_MCP_TOKEN?.trim() || undefined;
  let json = false;

  const value = (name: string, index: number): string => {
    const next = args[index + 1];
    if (next === undefined) throw new Error(`${name} requires a value.`);
    return next;
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    const takesValue = (name: string): string => {
      const next = value(name, index);
      index += 1;
      return next;
    };
    switch (argument) {
      case "--worker-id": workerId = takesValue("--worker-id"); break;
      case "--epoch-id": epochId = takesValue("--epoch-id"); break;
      case "--cwd": cwd = takesValue("--cwd"); break;
      case "--lease": leasePath = takesValue("--lease"); break;
      case "--heartbeat-seconds": heartbeatSeconds = Number(takesValue("--heartbeat-seconds")); break;
      case "--provider": providerId = takesValue("--provider"); break;
      case "--construct-deadline-seconds": constructDeadlineSeconds = Number(takesValue("--construct-deadline-seconds")); break;
      case "--mcp-url": fabricUrl = takesValue("--mcp-url"); break;
      case "--mcp-token": fabricToken = takesValue("--mcp-token"); break;
      case "--json": json = true; break;
      default:
        throw new Error(`Unknown gall-work argument: ${argument}. ${gallWorkUsage}`);
    }
  }

  let descriptor: GallWorkLease | undefined;
  if (leasePath !== undefined) {
    if (workerId !== undefined || epochId !== undefined || cwd !== undefined) {
      throw new Error("gall-work accepts either --lease FILE or --worker-id/--epoch-id/--cwd, not both.");
    }
    descriptor = parseGallWorkLease(JSON.parse(readFileSync(leasePath, "utf8")) as unknown);
    workerId = descriptor.worker_id;
    epochId = descriptor.epoch_id;
    cwd = descriptor.worktree;
  }

  if (!workerId || !epochId || !cwd) throw new Error(gallWorkUsage);
  if (!workerIdPattern.test(workerId)) throw new Error("worker_id contains unsupported characters.");
  if (!uuid.test(epochId)) throw new Error("epoch_id must be a UUID.");
  if (!isAbsolute(cwd)) throw new Error("--cwd must be an absolute path.");
  if (!Number.isFinite(heartbeatSeconds) || heartbeatSeconds < 15) {
    throw new Error("--heartbeat-seconds must be a number >= 15.");
  }
  if (!Number.isFinite(constructDeadlineSeconds) || constructDeadlineSeconds < 0) {
    throw new Error("--construct-deadline-seconds must be a number >= 0.");
  }

  return {
    workerId,
    epochId,
    cwd: resolve(cwd),
    json,
    descriptor,
    heartbeatSeconds,
    fabricUrl,
    fabricToken,
    ...(providerId?.trim() ? { providerId: providerId.trim() } : {}),
    constructDeadlineSeconds
  };
}

export function isGallWorkInvocation(args: string[]): boolean {
  return args[0] === "gall-work";
}

// ---------------------------------------------------------------------------
// Fabric client (stateless JSON-RPC 2.0 over HTTP POST)
// ---------------------------------------------------------------------------

export interface FabricTarget {
  url: string;
  authorization?: string;
}

export const defaultFabricUrl = "http://localhost:4000/internal-api/execution/mcp";

export function resolveFabricTarget(env: NodeJS.ProcessEnv = process.env, configPath?: string): FabricTarget {
  const envToken = env.XAAS_MCP_TOKEN?.trim();
  const envUrl = env.XAAS_MCP_URL?.trim();
  if (envUrl) {
    return { url: envUrl, authorization: envToken ? `Bearer ${envToken}` : undefined };
  }
  const path = configPath
    ?? (env.ZCODE_CONFIG_PATH?.trim() ? env.ZCODE_CONFIG_PATH.trim() : join(homedir(), ".zcode", "cli", "config.json"));
  try {
    const config = JSON.parse(readFileSync(path, "utf8")) as {
      mcp?: { servers?: Record<string, { url?: string; headers?: { Authorization?: string } }> };
    };
    const server = config.mcp?.servers?.["xaas-execution"];
    if (server?.url && server?.headers?.Authorization) {
      return { url: server.url, authorization: server.headers.Authorization };
    }
  } catch {
    // unreadable config: fall through to the default local endpoint
  }
  return { url: defaultFabricUrl, authorization: envToken ? `Bearer ${envToken}` : undefined };
}

export interface FabricCallOutcome {
  ok: boolean;
  result?: Record<string, unknown>;
  error?: string;
  /** Provider capacity classification when the failure was capacity-shaped. */
  capacity?: CapacitySignal;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// Local parallelism bound for fabric calls (claim/heartbeat/close from the
// lifecycle run concurrently only within one process; the cap keeps this
// process's contribution to provider saturation bounded and typed).
const fabricConcurrencyCap = new ConcurrencyCap(
  Number(process.env.ZCODE_FABRIC_MAX_CONCURRENT?.trim() || defaultFabricConcurrencyLimit)
);

export async function fabricCall(
  target: FabricTarget,
  tool: string,
  args: Record<string, unknown>,
  timeoutMs = 15_000,
  fetchImpl: FetchLike = fetch
): Promise<FabricCallOutcome> {
  const send = async (): Promise<FabricCallOutcome> => {
    let response: Response;
    try {
      response = await fetchImpl(target.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...(target.authorization ? { authorization: target.authorization } : {})
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: tool, arguments: args }
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      return { ok: false, error: `fabric_unreachable: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (!response.ok) {
      const capacity = capacityFromStatus(response.status);
      if (capacity) return { ok: false, error: `fabric_capacity:${capacity.code}`, capacity };
      return { ok: false, error: `fabric_http_${response.status}` };
    }
    let body: {
      result?: { isError?: boolean; content?: Array<{ type?: string; text?: string }> };
      error?: { message?: string };
    };
    try {
      body = await response.json() as typeof body;
    } catch (error) {
      return { ok: false, error: `fabric_bad_response: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (body.error) {
      return { ok: false, error: body.error.message ?? "fabric_rpc_error" };
    }
    const text = body.result?.content?.[0]?.text ?? "";
    if (body.result?.isError) {
      // A fabric tool refusal can itself be the provider's capacity envelope
      // (e.g. {"error":{"code":1302},"message":"High concurrency usage"}):
      // classify it as capacity so the bounded backoff above applies instead
      // of sealing a generic failure receipt.
      const capacity = capacityFromBody(text);
      if (capacity) return { ok: false, error: `fabric_capacity:${capacity.code}`, capacity };
      try {
        const parsed = JSON.parse(text) as { error?: string };
        return { ok: false, error: parsed.error ?? (text || "fabric_tool_error") };
      } catch {
        return { ok: false, error: text || "fabric_tool_error" };
      }
    }
    try {
      return { ok: true, result: JSON.parse(text) as Record<string, unknown> };
    } catch {
      return { ok: false, error: `fabric_bad_tool_payload: ${text.slice(0, 200)}` };
    }
  };

  return await fabricConcurrencyCap.run(() =>
    callWithCapacityBackoff(send, {
      capacityOf: (outcome) => outcome.capacity ?? false,
      onRetry: (info) => {
        console.error(`gall-work: fabric ${tool} capacity retry ${info.attempt} (${info.code}) in ${info.delayMs}ms`);
      }
    })
  ).catch((error) => {
    if (isProviderCapacityRefusal(error)) {
      // Typed refusal after bounded retries: the lifecycle seals a typed
      // failure receipt. There is no prompt fallback.
      return { ok: false, error: `fabric_capacity:${error.code}:attempts=${error.attempts}` };
    }
    throw error;
  });
}

/** Raw JSON-RPC 2.0 method call (initialize, tools/list); no content unwrapping. */
export async function fabricRpc(
  target: FabricTarget,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 15_000,
  fetchImpl: FetchLike = fetch
): Promise<FabricCallOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(target.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(target.authorization ? { authorization: target.authorization } : {})
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    return { ok: false, error: `fabric_unreachable: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!response.ok) {
    const capacity = capacityFromStatus(response.status);
    if (capacity) return { ok: false, error: `fabric_capacity:${capacity.code}`, capacity };
    return { ok: false, error: `fabric_http_${response.status}` };
  }
  let body: { result?: Record<string, unknown>; error?: { message?: string } };
  try {
    body = await response.json() as typeof body;
  } catch (error) {
    return { ok: false, error: `fabric_bad_response: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (body.error) return { ok: false, error: body.error.message ?? "fabric_rpc_error" };
  if (body.result === undefined || body.result === null || typeof body.result !== "object") {
    return { ok: false, error: "fabric_bad_rpc_result" };
  }
  return { ok: true, result: body.result };
}

// ---------------------------------------------------------------------------
// Capability discovery (real MCP initialize + tools/list handshake)
// ---------------------------------------------------------------------------

export interface FabricCapabilities {
  /** True when tools/list answered; false = the static contract vocabulary stands. */
  discovered: boolean;
  tools: string[];
  serverInfo?: Record<string, unknown>;
  /** Typed degrade reason when a handshake leg is unsupported. */
  code?: "initialize_unsupported" | "tools_list_unsupported";
}

const toolsListResult = (result: Record<string, unknown> | undefined): { tools: string[]; listed: boolean } => {
  if (!result) return { tools: [], listed: false };
  const tools = result.tools;
  if (Array.isArray(tools)) {
    return {
      tools: tools.map((tool) => (typeof (tool as { name?: unknown })?.name === "string" ? String((tool as { name: unknown }).name) : ""))
        .filter((name) => name !== ""),
      listed: true
    };
  }
  // Some fabrics wrap tools/list in the tools/call content envelope.
  const text = (result as { content?: Array<{ type?: string; text?: string }> }).content?.[0]?.text;
  if (typeof text === "string") {
    try {
      const parsed = JSON.parse(text) as { tools?: Array<{ name?: string }> };
      return Array.isArray(parsed.tools)
        ? { tools: parsed.tools.map((tool) => String(tool.name ?? "")).filter((name) => name !== ""), listed: true }
        : { tools: [], listed: false };
    } catch {
      return { tools: [], listed: false };
    }
  }
  return { tools: [], listed: false };
};

/**
 * Discovery handshake against the fabric. initialize is attempted first
 * (client identity), then tools/list. A server lacking a leg degrades typed:
 * the lifecycle continues on the static contract vocabulary and the degrade
 * lands in the result document and close evidence -- never a silent gap.
 */
export async function discoverFabricCapabilities(
  target: FabricTarget,
  fetchImpl: FetchLike = fetch
): Promise<FabricCapabilities> {
  const init = await fabricRpc(target, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "zcode-gall-work", version: "1" }
  }, 15_000, fetchImpl);
  const list = await fabricRpc(target, "tools/list", {}, 15_000, fetchImpl);
  const { tools, listed } = toolsListResult(list.result);
  if (!list.ok || !listed) {
    return { discovered: false, tools: [], code: "tools_list_unsupported" };
  }
  return {
    discovered: true,
    tools,
    ...(init.ok ? {} : { code: "initialize_unsupported" as const }),
    ...(init.ok && record(init.result?.serverInfo) ? { serverInfo: record(init.result!.serverInfo)! } : {})
  };
}

// ---------------------------------------------------------------------------
// Lease persistence (the exact state the plugin's PreToolUse gate reads)
// ---------------------------------------------------------------------------

const leaseStateDir = () => join(tmpdir(), "xaas-fabric");

export function leaseFilePaths(cwd: string): string[] {
  const paths = new Set<string>();
  for (const candidate of new Set([cwd, realpathSafe(cwd)])) {
    paths.add(join(leaseStateDir(), `${createHash("sha256").update(candidate).digest("hex")}.json`));
  }
  return [...paths];
}

export function workOrderPath(cwd: string): string {
  return join(leaseStateDir(), `${createHash("sha256").update(realpathSafe(cwd)).digest("hex")}.work-order.json`);
}

function realpathSafe(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function isLiveLease(lease: { lease_token?: unknown; lease_expires_at?: unknown } | null): boolean {
  if (!lease || typeof lease.lease_token !== "string" || !lease.lease_token) return false;
  const expiresAt = Date.parse(String(lease.lease_expires_at ?? ""));
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export class LeaseConflictError extends Error {
  constructor(existingToken: string, newToken: string) {
    super(
      `refusing to overwrite a live lease (${existingToken}) for this cwd with a different lease (${newToken}); ` +
      "close/refuse the prior lease first or let it expire."
    );
    this.name = "LeaseConflictError";
  }
}

export async function saveLeaseFiles(cwd: string, claim: Record<string, unknown>): Promise<void> {
  await mkdir(leaseStateDir(), { recursive: true, mode: 0o700 });
  const payload = JSON.stringify(claim);
  for (const path of leaseFilePaths(cwd)) {
    let existing: { lease_token?: string } | null = null;
    try {
      existing = JSON.parse(await readFile(path, "utf8")) as { lease_token?: string };
    } catch {
      existing = null; // absent/unreadable prior lease: nothing live to conflict with
    }
    if (existing !== null && isLiveLease(existing) && existing.lease_token !== claim.lease_token) {
      throw new LeaseConflictError(
        String(existing.lease_token ?? "(none)"),
        String(claim.lease_token ?? "(none)")
      );
    }
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, payload, { mode: 0o600 });
  }
}

export async function clearLeaseFiles(cwd: string): Promise<void> {
  for (const path of leaseFilePaths(cwd)) {
    await rm(path, { force: true });
  }
}

// ---------------------------------------------------------------------------
// Crash-window reconciliation (startup scan of stale lease files)
// ---------------------------------------------------------------------------

export type FabricCall = (
  tool: string,
  callArgs: Record<string, unknown>
) => Promise<FabricCallOutcome>;

export type LifecycleEmit = (event: string, fields: Record<string, unknown>) => void;

export interface LeaseReconciliation {
  /** A prior lease file existed for this cwd. */
  found: boolean;
  scanned: number;
  action?:
    | "cleared_expired"
    | "reconciled_terminal"
    | "closed_out"
    | "close_out_unreachable"
    | "left_live"
    | "resumed"
    | "status_unavailable";
  lease_token?: string;
  code?: string;
  receipt?: Record<string, unknown>;
}

interface PersistedLease {
  lease_token?: unknown;
  lease_expires_at?: unknown;
  epoch_id?: unknown;
  provider_id?: unknown;
  worker_id?: unknown;
}

/** Fabric states in which the lease is still held; anything else is terminal. */
const openLeaseStatuses = new Set(["open", "active", "claimed", "running", "constructing", "leased"]);

function isTerminalLeaseStatus(status: unknown): boolean {
  if (typeof status !== "string" || status.trim() === "") return false;
  return !openLeaseStatuses.has(status.trim().toLowerCase());
}

/**
 * Reconcile stale lease files for `cwd` with the fabric before claiming:
 *   - absent/expired file -> cleared (clearLeaseFiles finally wired);
 *   - live file the fabric reports terminal -> cleared (reconciled_terminal);
 *   - live file for OUR epoch (idempotent re-claim) -> left in place;
 *   - live file past the heartbeat grace (2x heartbeat seconds) -> a crashed
 *     predecessor: reclaimed with cancel_work (fallback refuse), receipt
 *     persisted, files cleared (execution.crash + receipt.persist);
 *   - live and recently refreshed -> another live worker: left untouched.
 * A reconciliation failure never fails the dispatch: the persist-stage
 * conflict guard remains the hard backstop.
 */
export async function reconcileLeaseWindow(
  cwd: string,
  request: GallWorkRequest,
  call: FabricCall,
  emit?: LifecycleEmit
): Promise<LeaseReconciliation> {
  const paths = leaseFilePaths(cwd);
  const graceMs = 2 * request.heartbeatSeconds * 1000;
  const staleFacts = (lease: PersistedLease): Record<string, unknown> => ({
    ...(typeof lease.lease_token === "string" && lease.lease_token ? { lease: lease.lease_token } : {}),
    ...(typeof lease.epoch_id === "string" && lease.epoch_id ? { work_order_id: `wo:${lease.epoch_id}` } : {}),
    ...(typeof lease.provider_id === "string" && lease.provider_id ? { provider: lease.provider_id } : {}),
    ...(typeof lease.worker_id === "string" && lease.worker_id ? { worker: lease.worker_id } : {})
  });

  for (const path of paths) {
    let lease: PersistedLease | null = null;
    try {
      lease = JSON.parse(await readFile(path, "utf8")) as PersistedLease;
    } catch {
      continue; // absent/unreadable: nothing to reconcile
    }
    if (!lease || typeof lease !== "object") continue;
    const token = typeof lease.lease_token === "string" ? lease.lease_token : "";
    if (!token) {
      // not even a token: litter, not a lease
      await clearLeaseFiles(cwd);
      return { found: true, scanned: paths.length, action: "cleared_expired" };
    }
    const facts = staleFacts(lease);

    if (!isLiveLease(lease as { lease_token?: unknown; lease_expires_at?: unknown })) {
      await clearLeaseFiles(cwd);
      emit?.("reobserve", { ...facts, action: "cleared_expired" });
      return { found: true, scanned: paths.length, action: "cleared_expired", lease_token: token };
    }

    // Live per file. Ask the fabric; a typed degrade keeps the local clock authoritative.
    const status = await call("work_status", { lease_token: token });
    if (status.ok && isTerminalLeaseStatus(status.result?.status)) {
      await clearLeaseFiles(cwd);
      emit?.("reobserve", { ...facts, action: "reconciled_terminal" });
      return {
        found: true,
        scanned: paths.length,
        action: "reconciled_terminal",
        lease_token: token,
        receipt: status.result
      };
    }

    if (typeof lease.epoch_id === "string" && lease.epoch_id === request.epochId) {
      // Our own epoch (idempotent re-claim): persist accepts the same token,
      // or the conflict guard fires typed if the fabric rotated it.
      emit?.("reobserve", { ...facts, action: "resumed" });
      return { found: true, scanned: paths.length, action: "resumed", lease_token: token };
    }

    const expiresAt = Date.parse(String(lease.lease_expires_at ?? ""));
    const remainingMs = Number.isFinite(expiresAt) ? expiresAt - Date.now() : Number.POSITIVE_INFINITY;
    if (remainingMs > graceMs) {
      // Recently refreshed: a genuinely live worker holds this cwd.
      emit?.("reobserve", { ...facts, action: "left_live" });
      return {
        found: true,
        scanned: paths.length,
        action: "left_live",
        lease_token: token,
        ...(status.ok ? {} : { code: status.error })
      };
    }

    // Past the heartbeat grace: the predecessor stopped heartbeating -- a
    // crashed worker holding an orphan lease. Close it out typed.
    emit?.("execution.crash", { ...facts, reason: "heartbeat_grace_expired" });
    const cancel = await call("cancel_work", { lease_token: token });
    const closeOut = cancel.ok && cancel.result
      ? cancel
      : await call("refuse", { lease_token: token, reason: "blocked" });
    if (closeOut.ok && closeOut.result) {
      await clearLeaseFiles(cwd);
      emit?.("receipt.persist", { ...facts, receipt: `rc:${String(lease.epoch_id ?? "unknown")}` });
      return {
        found: true,
        scanned: paths.length,
        action: "closed_out",
        lease_token: token,
        receipt: closeOut.result
      };
    }
    return {
      found: true,
      scanned: paths.length,
      action: status.ok ? "close_out_unreachable" : "status_unavailable",
      lease_token: token,
      code: closeOut.error ?? status.error
    };
  }
  return { found: false, scanned: paths.length };
}

// ---------------------------------------------------------------------------
// Construct stage: work-order file + doctrinal runtime turn
// ---------------------------------------------------------------------------

export async function writeWorkOrder(
  cwd: string,
  claim: Record<string, unknown>,
  request: GallWorkRequest
): Promise<string> {
  const originAuthority = request.descriptor?.origin_authority
    ?? (typeof claim.origin_authority === "string" && claim.origin_authority.trim() ? claim.origin_authority.trim() : undefined);
  const workOrder = {
    schema: "gall.work-order/1",
    epoch_id: claim.epoch_id,
    worker_id: request.workerId,
    goal: claim.goal,
    exact_subject: claim.exact_subject,
    cycle: claim.cycle,
    worktree: claim.worktree,
    verifier_suite: claim.verifier_suite,
    lease_expires_at: claim.lease_expires_at,
    ...(originAuthority ? { origin_authority: originAuthority } : {}),
    ...(request.descriptor
      ? {
          semantic_identity: {
            work_order_iri: request.descriptor.work_order_iri,
            checkpoint_iri: request.descriptor.checkpoint_iri,
            graph_digest: request.descriptor.graph_digest,
            repository_identity: request.descriptor.repository_identity,
            base_sha: request.descriptor.base_sha
          }
        }
      : {})
  };
  const path = workOrderPath(cwd);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(workOrder, null, 2), { mode: 0o600 });
  return path;
}

export function constructPrompt(workOrderPathValue: string): string {
  return (
    "You are a leased XaaS execution worker. Your work order is at " +
    `${workOrderPathValue} -- read it first; it carries the goal, the exact ` +
    "subject, and the leased worktree. Work ONLY inside the leased worktree, " +
    "from its base commit, toward the goal, committing everything you change. " +
    "Stay under the xaas worker doctrine: hold the lease, heartbeat on long " +
    "work, no push, no publish, worktree-confined writes, report only what " +
    "you observed."
  );
}

export interface ConstructOutcome {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  outputTail: string;
  durationMs: number;
  spawnError?: string;
  /** Heartbeat failures observed while the turn ran; surfaced, never dropped. */
  heartbeatFailures?: string[];
  /** Receipt sealed by the OCEL tap when ZCODE_OCEL=1 (ZCODE-26922-06). */
  ocelReceiptPath?: string;
}

const constructOutputTailBytes = 4096;
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface ConstructRunOptions {
  /** Abort signal: aborting kills the runtime turn (SIGTERM) -- cancellation/deadline. */
  signal?: AbortSignal;
  replayBinding?: Record<string, unknown>;
  spawnImpl?: typeof spawnChild;
}

export async function runConstruct(
  request: GallWorkRequest,
  prompt: string,
  onHeartbeat: () => Promise<void>,
  options: ConstructRunOptions = {}
): Promise<ConstructOutcome> {
  const signal = options.signal;
  const spawnImpl = options.spawnImpl ?? spawnChild;
  const runtimePath = join(packageRoot, "vendor", "zcode.cjs");
  // --mode yolo is the headless worker's permission client stand-in: the
  // runtime's built-in default permission mode is "build" (and a synced
  // dispatcher setting.json may carry mode "build" too), which routes every
  // Bash call to the permission broker. A headless --prompt turn has no
  // permission client, so the DenyPermissionBroker refuses each step with
  // "No permission client configured for Bash" -- the BLOCKED:
  // BASH_PERMISSION_CLIENT_ABSENT failure (xaas sj-001
  // zcode-headless-execution-refusal). The lease itself is the worker's
  // authority: worktree-confined by the doctrinal prompt, heartbeated, and
  // falsified after the fact by the fabric's verifier court on the captured
  // head. The CLI flag (highest precedence) pins that authority explicitly
  // instead of leaving the turn to an interactive default.
  const permissionArgs = ["--mode", "yolo"];
  const node = resolveRuntimeNode(process.env.ZCODE_NODE?.trim() || undefined);
  const started = Date.now();

  // OCEL tap (ZCODE-26922-06): when ZCODE_OCEL=1, the construct turn feeds
  // the ontology-generated tap and seals a receipt bound to the exact
  // subject and lease identity. The turn emits stream-json -- the surface
  // the tap consumes -- instead of the bare --json result envelope.
  const leaseEnv = {
    XAAS_WORKER: "1",
    XAAS_LEASE_CWD: request.cwd,
    XAAS_EPOCH_ID: request.epochId,
    ...(request.descriptor
      ? { XAAS_WORK_ORDER_IRI: request.descriptor.work_order_iri, XAAS_BASE_SHA: request.descriptor.base_sha }
      : {}),
    ...(options.replayBinding ? { XAAS_REPLAY_BINDING: JSON.stringify(options.replayBinding) } : {})
  };
  const ocel = ocelEnabled(process.env)
    ? new OcelRecorder(
        STREAM_SOURCE,
        ocelDirectory(process.env),
        leaseIdentityFromEnv(leaseEnv)
      )
    : undefined;

  return await new Promise<ConstructOutcome>((resolveOutcome) => {
    let child: ChildProcess;
    try {
      child = spawnImpl(
        node,
        [runtimePath, "--prompt", prompt, "--cwd", request.cwd, "--output-format", "stream-json", ...permissionArgs],
        {
          cwd: packageRoot,
          env: {
            ...process.env,
            ...leaseEnv
          },
          stdio: ["ignore", "pipe", "pipe"]
        }
      );
    } catch (error) {
      resolveOutcome({
        exitCode: null,
        signal: null,
        outputTail: "",
        durationMs: Date.now() - started,
        heartbeatFailures: [],
        spawnError: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    // Cancellation/deadline: aborting the signal kills the runtime turn. The
    // orchestrator then closes the lease typed -- never an orphan.
    const onAbort = (): void => {
      try {
        child.kill("SIGTERM");
      } catch (error) {
        console.error(`gall-work: abort kill failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    if (signal?.aborted) onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });

    let tail = "";
    const heartbeatFailures: string[] = [];
    const absorb = (chunk: Buffer | string): void => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      process.stdout.write(text);
      tail = (tail + text).slice(-constructOutputTailBytes);
      ocel?.write(text);
    };
    child.stdout?.on("data", absorb);
    child.stderr?.on("data", absorb);

    const heartbeat = setInterval(() => {
      // Heartbeat failures are SURFACED (collected into the construct
      // outcome and close evidence), never silently dropped.
      onHeartbeat().then(
        () => undefined,
        (error) => {
          const message = error instanceof Error ? error.message : String(error);
          heartbeatFailures.push(`${new Date().toISOString()} ${message}`);
          console.error(`gall-work: heartbeat failed: ${message}`);
        }
      );
    }, request.heartbeatSeconds * 1000);
    if (typeof heartbeat.unref === "function") heartbeat.unref();

    let exit: { exitCode: number | null; signal: NodeJS.Signals | null; spawnError?: string } | undefined;
    const settle = (): void => {
      if (!exit) return;
      clearInterval(heartbeat);
      signal?.removeEventListener("abort", onAbort);
      let ocelReceiptPath: string | undefined;
      if (ocel) {
        try {
          ocelReceiptPath = ocel.finish().receiptPath;
        } catch (error) {
          // A failed tap must not fail the leased turn; the close evidence
          // simply carries no receipt path.
          console.error(`gall-work: ocel tap failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      resolveOutcome({
        ...exit,
        outputTail: tail,
        durationMs: Date.now() - started,
        heartbeatFailures,
        ocelReceiptPath
      });
    };

    child.once("error", (error) => {
      exit = { exitCode: null, signal: null, spawnError: error.message };
      settle();
    });
    child.once("exit", (code, signal) => {
      exit = { exitCode: code, signal };
      // settle deferred to `close` so the output tail absorbs the final
      // buffered chunks; a process that never closes its streams is bounded
      // by the dispatcher's external deadline.
    });
    child.once("close", () => settle());
  });
}

// ---------------------------------------------------------------------------
// Close stage: head capture + outcome mapping
// ---------------------------------------------------------------------------

export async function gitHead(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd });
  const head = stdout.trim();
  if (!gitSha.test(head)) throw new Error(`git rev-parse HEAD produced "${head.slice(0, 24)}"`);
  return head;
}

const outcomeToStanding: Record<string, string> = {
  alive: "ALIVE",
  partial_alive: "PARTIAL_ALIVE",
  blocked: "BLOCKED",
  build_broken: "BUILD_BROKEN",
  unsupported: "UNSUPPORTED",
  refused: "REFUSED"
};

export function standingForOutcome(outcome: string): string {
  return outcomeToStanding[outcome] ?? "PARTIAL_ALIVE";
}

// ---------------------------------------------------------------------------
// Result document + orchestrator
// ---------------------------------------------------------------------------

export interface GallWorkResult {
  schema: "gall.work-result/1";
  standing: string;
  epochId?: string;
  workerId: string;
  /** Selected execution provider (registry resolution). */
  provider?: string;
  outcome?: string;
  finalHead?: string;
  runtimeExitCode?: number | null;
  runtimeSignal?: NodeJS.Signals | null;
  receipt?: Record<string, unknown>;
  /** Work-order origin authority, propagated (never fabricated). */
  originAuthority?: string;
  code?: string;
  detail?: string;
  stages: {
    reconcile?: { found: boolean; action?: string; code?: string };
    discovery?: { ok: boolean; tools: number; code?: string };
    claim?: { ok: boolean; code?: string };
    persist?: { ok: boolean; code?: string };
    construct?: { ok: boolean; exitCode: number | null; spawnError?: string };
    close?: { ok: boolean; code?: string };
    cleanup?: { ok: boolean; code?: string };
  };
}

export interface GallWorkIo {
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
}

export type ConstructOverride = (
  request: GallWorkRequest,
  prompt: string,
  onHeartbeat: () => Promise<void>,
  signal?: AbortSignal
) => Promise<ConstructOutcome>;

/** sha256 of the shared contract fixture (test/fixtures/gall-work.contract.json,
 * byte-identical in xaas priv/zcode_plugin/gall-work.contract.json). Pinned by
 * tests on both sides of the seam; travels in close evidence replay_binding. */
export const gallWorkContractSha256 = "5515775861807cdd7394ef74b1ee38679dd24279224515178702bb6652a95fc4";

export async function runGallWork(
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    io?: GallWorkIo;
    fabricTarget?: FabricTarget;
    fetchImpl?: FetchLike;
    construct?: ConstructOverride;
    /** Injectable execution-provider registry read (tests never touch a real ~/.zcode/v2 file). */
    readExecutionProviderConfig?: ReadConfigText;
  } = {}
): Promise<number> {
  const env = options.env ?? process.env;
  const io = options.io ?? { stdout: process.stdout, stderr: process.stderr };
  const emit = (result: GallWorkResult, json: boolean): void => {
    if (json) io.stdout.write(JSON.stringify(result) + "\n");
    else {
      io.stderr.write(
        `gall-work: ${result.standing}` +
        `${result.code ? ` (${result.code})` : ""}` +
        `${result.detail ? ` ${result.detail}` : ""}\n`
      );
    }
  };

  let request: GallWorkRequest;
  try {
    request = parseGallWorkArgs(args, env);
  } catch (error) {
    io.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n${gallWorkUsage}\n`);
    return 2;
  }

  const finish = (result: GallWorkResult): number => {
    emit(result, request.json);
    if (result.standing === "REFUSED_LEASE_CONFLICT") return 65;
    // A sealed receipt (closed OR refused) means the epoch is terminal and
    // the dispatch completed; typed refusals without a receipt are the
    // contract's exit-1 failures.
    if (result.receipt !== undefined) return 0;
    if (result.standing.startsWith("REFUSED") || result.standing === "UNKNOWN") return 1;
    return 0;
  };

  // -- execution-provider selection (registry, fail-closed) -----------------
  const selection = await selectExecutionProvider({
    env,
    requestedProviderId: request.providerId,
    read: options.readExecutionProviderConfig
  });
  if (!selection.selected) {
    return finish({
      schema: "gall.work-result/1",
      standing: selection.reason === "registry_invalid" ? "REFUSED_PROVIDER_REGISTRY" : "REFUSED_PROVIDER_DISABLED",
      epochId: request.epochId,
      workerId: request.workerId,
      code: selection.reason,
      detail: "the execution-provider registry refused selection; no claim was attempted",
      stages: {}
    });
  }
  const providerId = selection.providerId!;
  const idempotencyKey = `gall-work:${providerId}:${request.workerId}:${request.epochId}`;

  // -- cancellation + deadline wiring ---------------------------------------
  const abort = new AbortController();
  let cancelReason: "signal" | "deadline" | undefined;
  let cancelSignalName: string | undefined;
  const onSignal = (signal: NodeJS.Signals): void => {
    cancelReason = "signal";
    cancelSignalName = signal;
    abort.abort();
  };
  for (const signalName of ["SIGINT", "SIGTERM"] as const) process.once(signalName, onSignal);
  const deadlineMs = request.constructDeadlineSeconds > 0 ? request.constructDeadlineSeconds * 1000 : 0;
  const deadlineTimer = deadlineMs > 0
    ? setTimeout(() => {
        cancelReason = "deadline";
        abort.abort();
      }, deadlineMs)
    : undefined;

  // -- lifecycle OCEL (gall_work hook source; ZCODE_OCEL=1) ------------------
  const lifecycleIdentity = leaseIdentityFromEnv({
    XAAS_WORKER: "1",
    XAAS_LEASE_CWD: request.cwd,
    XAAS_EPOCH_ID: request.epochId,
    ...(request.descriptor
      ? { XAAS_WORK_ORDER_IRI: request.descriptor.work_order_iri, XAAS_BASE_SHA: request.descriptor.base_sha }
      : {})
  });
  const lifecycle = ocelEnabled(env)
    ? new OcelRecorder(GALL_WORK_SOURCE, ocelDirectory(env), lifecycleIdentity)
    : undefined;
  const lifecycleReceiptPath = lifecycle ? join(ocelDirectory(env), `gall-work-${request.epochId}.receipt.json`) : undefined;
  let lifecycleSeq = 0;
  const emitLifecycle = (event: string, fields: Record<string, unknown>): void => {
    if (!lifecycle) return;
    try {
      lifecycle.feed({
        event,
        id: `${event}#${++lifecycleSeq}`,
        ts: new Date().toISOString(),
        sessionId: `gall-work-${request.epochId}`,
        ...fields
      });
    } catch (error) {
      // A failed lifecycle emit must never fail the dispatch.
      console.error(`gall-work: ocel lifecycle emit failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const workOrderId = `wo:${request.epochId}`;
  emitLifecycle("provider.select", {
    provider: providerId,
    work_order_id: workOrderId,
    ...(request.descriptor?.origin_authority ? { origin_authority: request.descriptor.origin_authority } : {})
  });
  if (selection.replaced) {
    emitLifecycle("provider.replace", {
      provider: providerId,
      from_provider: selection.replaced.providerId,
      work_order_id: workOrderId,
      ...(request.descriptor?.origin_authority ? { origin_authority: request.descriptor.origin_authority } : {})
    });
  }

  const run = async (): Promise<GallWorkResult> => {
    const target = options.fabricTarget ?? resolveFabricTarget(env);
    const call = async (tool: string, callArgs: Record<string, unknown>): Promise<FabricCallOutcome> =>
      fabricCall(target, tool, callArgs, 15_000, options.fetchImpl);
    const typedRefusal = async (reason: string): Promise<Record<string, unknown> | undefined> => {
      const refused = await call("refuse", { lease_token: claimToken, reason });
      return refused.ok ? refused.result : undefined;
    };
    const clearLeaseState = async (): Promise<{ ok: boolean; code?: string }> => {
      try {
        await clearLeaseFiles(request.cwd);
        return { ok: true };
      } catch (error) {
        return { ok: false, code: error instanceof Error ? error.message : String(error) };
      }
    };

    // -- reconcile (crash window) -------------------------------------------
    // Needs a claimToken-free call handle: work_status/cancel_work/refuse are
    // addressed by the STALE token found in the file, not by a fresh claim.
    let claimToken = "";
    const reconcile = await reconcileLeaseWindow(request.cwd, request, call, emitLifecycle);

    // -- capability discovery ------------------------------------------------
    const capabilities = await discoverFabricCapabilities(target, options.fetchImpl);
    const discoveryStage = { ok: capabilities.discovered, tools: capabilities.tools.length, ...(capabilities.code ? { code: capabilities.code } : {}) };

    const baseStages = () => ({
      ...(reconcile.found
        ? { reconcile: { found: true, ...(reconcile.action ? { action: reconcile.action } : {}), ...(reconcile.code ? { code: reconcile.code } : {}) } }
        : {}),
      discovery: discoveryStage
    });

    // -- claim ----------------------------------------------------------------
    const claim = await call("claim_next", {
      provider: providerId,
      provider_worker_id: request.workerId,
      epoch_id: request.epochId,
      idempotency_key: idempotencyKey
    });
    if (!claim.ok || !claim.result) {
      return {
        schema: "gall.work-result/1",
        standing: "REFUSED_CLAIM",
        epochId: request.epochId,
        workerId: request.workerId,
        provider: providerId,
        code: claim.error ?? "claim_failed",
        detail: "claim_next refused; there is no prompt fallback -- the dispatch fails typed",
        stages: { ...baseStages(), claim: { ok: false, code: claim.error } }
      };
    }
    const claimResult = claim.result;
    claimToken = String(claimResult.lease_token ?? "");
    if (!claimToken) {
      return {
        schema: "gall.work-result/1",
        standing: "REFUSED_CLAIM",
        epochId: request.epochId,
        workerId: request.workerId,
        provider: providerId,
        code: "lease_token_missing",
        stages: { ...baseStages(), claim: { ok: false, code: "lease_token_missing" } }
      };
    }
    if (claimResult.epoch_id !== request.epochId) {
      // Claim-stage failure: typed refusal, exit 1, no receipt in the result;
      // nothing was persisted for this dispatch, so no lease state is cleared.
      await typedRefusal("no_authority");
      return {
        schema: "gall.work-result/1",
        standing: "REFUSED_SUBJECT_MISMATCH",
        epochId: request.epochId,
        workerId: request.workerId,
        provider: providerId,
        code: "epoch_mismatch",
        detail: `claim bound ${String(claimResult.epoch_id)}, requested ${request.epochId}`,
        stages: { ...baseStages(), claim: { ok: false, code: "epoch_mismatch" } }
      };
    }
    if (typeof claimResult.worktree === "string" && claimResult.worktree.length > 0
      && realpathSafe(claimResult.worktree) !== realpathSafe(request.cwd)) {
      await typedRefusal("no_authority");
      return {
        schema: "gall.work-result/1",
        standing: "REFUSED_SUBJECT_MISMATCH",
        epochId: request.epochId,
        workerId: request.workerId,
        provider: providerId,
        code: "worktree_mismatch",
        detail: `claim worktree ${claimResult.worktree} does not match --cwd ${request.cwd}`,
        stages: { ...baseStages(), claim: { ok: false, code: "worktree_mismatch" } }
      };
    }

    // Origin authority: carried from the lease descriptor or the claim
    // payload, never fabricated (ALOOP originAuthority qualifier).
    const originAuthority = request.descriptor?.origin_authority
      ?? (typeof claimResult.origin_authority === "string" && claimResult.origin_authority.trim()
        ? claimResult.origin_authority.trim()
        : undefined);

    // Replay binding: contract digest + dispatch identity, so a third party
    // can re-run the dispatch and bind the receipt to its subject.
    const replayBinding: Record<string, unknown> = {
      worker: "zcode-gall-work/1",
      contract_version: 1,
      contract_sha256: gallWorkContractSha256,
      provider: providerId,
      worker_id: request.workerId,
      epoch_id: request.epochId,
      idempotency_key: idempotencyKey,
      ...(request.descriptor
        ? {
            work_order_iri: request.descriptor.work_order_iri,
            base_sha: request.descriptor.base_sha
          }
        : {}),
      ...(originAuthority ? { origin_authority: originAuthority } : {})
    };
    if (!lifecycleIdentity.replayBinding) lifecycleIdentity.replayBinding = replayBinding;

    emitLifecycle("worker.claim", {
      lease: claimToken,
      provider: providerId,
      worker: request.workerId,
      work_order_id: workOrderId,
      ...(originAuthority ? { origin_authority: originAuthority } : {})
    });

    // -- persist --------------------------------------------------------------
    try {
      await saveLeaseFiles(request.cwd, {
        ...claimResult,
        provider_id: providerId,
        worker_id: request.workerId,
        ...(originAuthority ? { origin_authority: originAuthority } : {})
      });
    } catch (error) {
      const conflict = error instanceof LeaseConflictError;
      const receipt = await typedRefusal(conflict ? "no_authority" : "blocked");
      return {
        schema: "gall.work-result/1",
        standing: conflict ? "REFUSED_LEASE_CONFLICT" : "REFUSED_PERSIST",
        epochId: request.epochId,
        workerId: request.workerId,
        provider: providerId,
        ...(receipt ? { receipt } : {}),
        code: conflict ? "lease_conflict" : "persist_failed",
        detail: error instanceof Error ? error.message : String(error),
        stages: {
          ...baseStages(),
          claim: { ok: true },
          persist: { ok: false, code: conflict ? "lease_conflict" : "persist_failed" }
        }
      };
    }

    // -- construct ------------------------------------------------------------
    const workOrder = await writeWorkOrder(request.cwd, claimResult, request);
    const prompt = constructPrompt(workOrder);
    const heartbeatFailures: string[] = [];
    const heartbeat = async (): Promise<void> => {
      // Heartbeat failures are recorded here (source of truth) and thrown so
      // the construct stage surfaces them; they are never silently dropped.
      const beat = await call("heartbeat", { lease_token: claimToken });
      if (!beat.ok) {
        const message = beat.error ?? "heartbeat_failed";
        heartbeatFailures.push(message);
        throw new Error(`heartbeat failed: ${message}`);
      }
    };
    const runOptions = { signal: abort.signal, replayBinding };
    const construct = options.construct
      ? await options.construct(request, prompt, heartbeat, abort.signal)
      : await runConstruct(request, prompt, heartbeat, runOptions);
    const surfacedHeartbeatFailures = heartbeatFailures.length > 0
      ? heartbeatFailures
      : (construct.heartbeatFailures ?? []);

    if (construct.spawnError === undefined && cancelReason !== undefined) {
      // -- cancelled (signal or internal deadline): close the lease typed, never orphan
      const cancel = await call("cancel_work", { lease_token: claimToken });
      const receipt = cancel.ok && cancel.result ? cancel.result : await typedRefusal("blocked");
      let cleanup = { ok: false };
      if (receipt) {
        emitLifecycle("receipt.persist", {
          receipt: `rc:${request.epochId}`,
          lease: claimToken,
          provider: providerId,
          worker: request.workerId,
          work_order_id: workOrderId,
          ...(originAuthority ? { origin_authority: originAuthority } : {})
        });
        cleanup = await clearLeaseState();
      }
      return {
        schema: "gall.work-result/1",
        standing: receipt ? "REFUSED" : "REFUSED_NO_FABRIC",
        epochId: request.epochId,
        workerId: request.workerId,
        provider: providerId,
        ...(receipt ? { receipt } : {}),
        code: cancelReason === "deadline" ? "construct_deadline_exceeded" : `cancelled_${(cancelSignalName ?? "signal").toLowerCase()}`,
        detail: cancelReason === "deadline"
          ? `internal construct deadline (${request.constructDeadlineSeconds}s) exceeded`
          : `runtime turn aborted by ${cancelSignalName ?? "signal"}`,
        runtimeExitCode: construct.exitCode,
        runtimeSignal: construct.signal,
        ...(originAuthority ? { originAuthority } : {}),
        stages: {
          ...baseStages(),
          claim: { ok: true },
          persist: { ok: true },
          construct: { ok: false, exitCode: construct.exitCode },
          close: { ok: receipt !== undefined, code: receipt ? undefined : "cancel_unreachable" },
          cleanup
        }
      };
    }

    if (construct.spawnError !== undefined) {
      const receipt = await typedRefusal("blocked");
      const cleanup = receipt ? await clearLeaseState() : { ok: false };
      if (receipt) {
        emitLifecycle("receipt.persist", {
          receipt: `rc:${request.epochId}`,
          lease: claimToken,
          provider: providerId,
          worker: request.workerId,
          work_order_id: workOrderId,
          ...(originAuthority ? { origin_authority: originAuthority } : {})
        });
      }
      return {
        schema: "gall.work-result/1",
        standing: receipt ? "REFUSED" : "REFUSED_NO_FABRIC",
        epochId: request.epochId,
        workerId: request.workerId,
        provider: providerId,
        receipt,
        code: "spawn_failed",
        detail: construct.spawnError,
        runtimeExitCode: null,
        ...(originAuthority ? { originAuthority } : {}),
        stages: {
          ...baseStages(),
          claim: { ok: true },
          persist: { ok: true },
          construct: { ok: false, exitCode: null, spawnError: construct.spawnError },
          close: { ok: receipt !== undefined, code: receipt ? undefined : "refuse_unreachable" },
          cleanup
        }
      };
    }

    // -- close ----------------------------------------------------------------
    let head: string;
    try {
      head = await gitHead(request.cwd);
    } catch (error) {
      const receipt = await typedRefusal("blocked");
      const cleanup = receipt ? await clearLeaseState() : { ok: false };
      if (receipt) {
        emitLifecycle("receipt.persist", {
          receipt: `rc:${request.epochId}`,
          lease: claimToken,
          provider: providerId,
          worker: request.workerId,
          work_order_id: workOrderId,
          ...(originAuthority ? { origin_authority: originAuthority } : {})
        });
      }
      return {
        schema: "gall.work-result/1",
        standing: receipt ? "REFUSED" : "REFUSED_NO_HEAD",
        epochId: request.epochId,
        workerId: request.workerId,
        provider: providerId,
        receipt,
        code: "head_unavailable",
        detail: error instanceof Error ? error.message : String(error),
        runtimeExitCode: construct.exitCode,
        ...(originAuthority ? { originAuthority } : {}),
        stages: {
          ...baseStages(),
          claim: { ok: true },
          persist: { ok: true },
          construct: { ok: false, exitCode: construct.exitCode },
          close: { ok: receipt !== undefined, code: receipt ? undefined : "refuse_unreachable" },
          cleanup
        }
      };
    }

    const turnCompleted = construct.exitCode === 0;
    const outcome = turnCompleted ? "alive" : "blocked";
    const semanticEvidence = request.descriptor
      ? {
          semantic_identity: {
            work_order_iri: request.descriptor.work_order_iri,
            checkpoint_iri: request.descriptor.checkpoint_iri,
            graph_digest: request.descriptor.graph_digest,
            repository_identity: request.descriptor.repository_identity,
            base_sha: request.descriptor.base_sha
          }
        }
      : {};
    const closed = await call("close_candidate", {
      lease_token: claimToken,
      final_head: head,
      outcome,
      evidence: {
        worker: "zcode-gall-work/1",
        contract_version: 1,
        contract_sha256: gallWorkContractSha256,
        provider: providerId,
        idempotency_key: idempotencyKey,
        runtime_exit_code: construct.exitCode,
        duration_ms: construct.durationMs,
        output_tail: construct.outputTail,
        heartbeat_seconds: request.heartbeatSeconds,
        ...(heartbeatFailures.length > 0
          ? {
              heartbeat_failure_count: heartbeatFailures.length,
              heartbeat_failures: heartbeatFailures.slice(-5)
            }
          : {}),
        ...(construct.ocelReceiptPath ? { ocel_receipt: construct.ocelReceiptPath } : {}),
        ...(lifecycleReceiptPath ? { ocel_lifecycle_receipt: lifecycleReceiptPath } : {}),
        ...(originAuthority ? { origin_authority: originAuthority } : {}),
        replay_binding: replayBinding,
        ...semanticEvidence
      }
    });
    if (!closed.ok || !closed.result) {
      return {
        schema: "gall.work-result/1",
        standing: "REFUSED_CLOSE",
        epochId: request.epochId,
        workerId: request.workerId,
        provider: providerId,
        code: closed.error ?? "close_failed",
        detail: "close_candidate refused; the lease stays live until TTL (startup reconciliation will close it out)",
        finalHead: head,
        runtimeExitCode: construct.exitCode,
        ...(originAuthority ? { originAuthority } : {}),
        stages: {
          ...baseStages(),
          claim: { ok: true },
          persist: { ok: true },
          construct: { ok: turnCompleted, exitCode: construct.exitCode },
          close: { ok: false, code: closed.error }
        }
      };
    }

    // The receipt is sealed: the lease is terminal and the gate file must not
    // arm a future turn for this cwd (clearLeaseFiles finally wired).
    const cleanup = await clearLeaseState();
    emitLifecycle("receipt.persist", {
      receipt: `rc:${request.epochId}`,
      lease: claimToken,
      provider: providerId,
      worker: request.workerId,
      work_order_id: workOrderId,
      ...(originAuthority ? { origin_authority: originAuthority } : {})
    });
    const sealedOutcome = String(closed.result.outcome ?? outcome);
    return {
      schema: "gall.work-result/1",
      standing: standingForOutcome(sealedOutcome),
      epochId: request.epochId,
      workerId: request.workerId,
      provider: providerId,
      outcome: sealedOutcome,
      finalHead: head,
      runtimeExitCode: construct.exitCode,
      runtimeSignal: construct.signal,
      receipt: closed.result,
      ...(originAuthority ? { originAuthority } : {}),
      stages: {
        ...baseStages(),
        claim: { ok: true },
        persist: { ok: true },
        construct: { ok: turnCompleted, exitCode: construct.exitCode },
        close: { ok: true },
        cleanup
      }
    };
  };

  let result: GallWorkResult;
  try {
    result = await run();
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    for (const signalName of ["SIGINT", "SIGTERM"] as const) process.removeListener(signalName, onSignal);
    if (lifecycle) {
      try {
        lifecycle.finish();
      } catch (error) {
        console.error(`gall-work: ocel lifecycle seal failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return finish(result);
}
