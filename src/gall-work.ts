// Native `zcode gall-work` -- the gall-work contract (contract_version 1,
// see test/fixtures/gall-work.contract.json, byte-identical in the xaas repo
// at priv/zcode_plugin/gall-work.contract.json).
//
// One invocation runs the FULL worker lifecycle against the XaaS execution
// fabric, with no `/xaas claim_next` prompt fallback:
//
//   claim      JSON-RPC tools/call claim_next {provider, provider_worker_id,
//              epoch_id} -> lease token + work payload (goal, worktree,
//              verifier_suite). Fail-closed: a refused claim is a typed
//              non-zero exit, never a retry-as-prompt.
//   persist    Save the lease to <tmpdir>/xaas-fabric/<sha256(cwd)>.json --
//              the exact file and conflict guard the xaas-fabric plugin's
//              PreToolUse gate (scripts/xaas-gate.mjs) reads -- so the host
//              gate arms for the constructed turn.
//   construct  Spawn the vendored runtime on a fixed doctrinal prompt whose
//              argv carries NO goal text: the goal travels in a work-order
//              file under the lease state dir and the prompt references only
//              its path. Heartbeats renew the lease while the turn runs.
//   close      `git rev-parse HEAD` in the lease cwd, then close_candidate
//              {final_head, outcome, evidence}. Runtime exit 0 closes as
//              `alive` (the fabric's own verifier court falsifies if the
//              work is wrong); a failed turn closes as `blocked` with the
//              exit code and output tail in evidence; a turn that cannot
//              even be spawned refuses (`blocked`). Any sealed receipt is
//              exit 0 -- the epoch is terminal and the queue head unblocked.
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

  return {
    schema: "gall.work-lease/1",
    work_order_iri,
    checkpoint_iri,
    graph_digest,
    repository_identity,
    base_sha,
    epoch_id,
    worker_id: selectedWorker,
    worktree: resolve(worktree)
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
}

export const gallWorkUsage =
  "Usage: zcode gall-work (--lease FILE | --worker-id ID --epoch-id UUID --cwd DIR) [--json]";
const defaultHeartbeatSeconds = 240;

export function parseGallWorkArgs(args: string[], env: NodeJS.ProcessEnv = process.env): GallWorkRequest {
  let workerId: string | undefined;
  let epochId: string | undefined;
  let cwd: string | undefined;
  let leasePath: string | undefined;
  let heartbeatSeconds = defaultHeartbeatSeconds;
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

  return { workerId, epochId, cwd: resolve(cwd), json, descriptor, heartbeatSeconds, fabricUrl, fabricToken };
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
// Construct stage: work-order file + doctrinal runtime turn
// ---------------------------------------------------------------------------

export async function writeWorkOrder(
  cwd: string,
  claim: Record<string, unknown>,
  request: GallWorkRequest
): Promise<string> {
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
}

const constructOutputTailBytes = 4096;
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function runConstruct(
  request: GallWorkRequest,
  prompt: string,
  onHeartbeat: () => Promise<void>,
  spawnImpl: typeof spawnChild = spawnChild
): Promise<ConstructOutcome> {
  const runtimePath = join(packageRoot, "vendor", "zcode.cjs");
  const node = process.env.ZCODE_NODE?.trim() || process.execPath;
  const started = Date.now();

  return await new Promise<ConstructOutcome>((resolveOutcome) => {
    let child: ChildProcess;
    try {
      child = spawnImpl(node, [runtimePath, "--prompt", prompt, "--cwd", request.cwd, "--json"], {
        cwd: packageRoot,
        env: {
          ...process.env,
          XAAS_WORKER: "1",
          XAAS_LEASE_CWD: request.cwd
        },
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      resolveOutcome({
        exitCode: null,
        signal: null,
        outputTail: "",
        durationMs: Date.now() - started,
        spawnError: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    let tail = "";
    const absorb = (chunk: Buffer | string): void => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      process.stdout.write(text);
      tail = (tail + text).slice(-constructOutputTailBytes);
    };
    child.stdout?.on("data", absorb);
    child.stderr?.on("data", absorb);

    const heartbeat = setInterval(() => {
      void onHeartbeat();
    }, request.heartbeatSeconds * 1000);
    if (typeof heartbeat.unref === "function") heartbeat.unref();

    let exit: { exitCode: number | null; signal: NodeJS.Signals | null; spawnError?: string } | undefined;
    const settle = (): void => {
      if (!exit) return;
      clearInterval(heartbeat);
      resolveOutcome({ ...exit, outputTail: tail, durationMs: Date.now() - started });
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
  outcome?: string;
  finalHead?: string;
  runtimeExitCode?: number | null;
  receipt?: Record<string, unknown>;
  code?: string;
  detail?: string;
  stages: {
    claim?: { ok: boolean; code?: string };
    persist?: { ok: boolean; code?: string };
    construct?: { ok: boolean; exitCode: number | null; spawnError?: string };
    close?: { ok: boolean; code?: string };
  };
}

export interface GallWorkIo {
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
}

export type ConstructOverride = (
  request: GallWorkRequest,
  prompt: string,
  onHeartbeat: () => Promise<void>
) => Promise<ConstructOutcome>;

export async function runGallWork(
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    io?: GallWorkIo;
    fabricTarget?: FabricTarget;
    fetchImpl?: FetchLike;
    construct?: ConstructOverride;
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

  const target = options.fabricTarget ?? resolveFabricTarget(env);
  const call = async (tool: string, callArgs: Record<string, unknown>): Promise<FabricCallOutcome> =>
    fabricCall(target, tool, callArgs, 15_000, options.fetchImpl);
  const typedRefusal = async (reason: string): Promise<Record<string, unknown> | undefined> => {
    const refused = await call("refuse", { lease_token: claimToken, reason });
    return refused.ok ? refused.result : undefined;
  };

  // -- claim ----------------------------------------------------------------
  const claim = await call("claim_next", {
    provider: "zcode",
    provider_worker_id: request.workerId,
    epoch_id: request.epochId
  });
  if (!claim.ok || !claim.result) {
    return finish({
      schema: "gall.work-result/1",
      standing: "REFUSED_CLAIM",
      epochId: request.epochId,
      workerId: request.workerId,
      code: claim.error ?? "claim_failed",
      detail: "claim_next refused; there is no prompt fallback -- the dispatch fails typed",
      stages: { claim: { ok: false, code: claim.error } }
    });
  }
  const claimResult = claim.result;
  const claimToken = String(claimResult.lease_token ?? "");
  if (!claimToken) {
    return finish({
      schema: "gall.work-result/1",
      standing: "REFUSED_CLAIM",
      epochId: request.epochId,
      workerId: request.workerId,
      code: "lease_token_missing",
      stages: { claim: { ok: false, code: "lease_token_missing" } }
    });
  }
  if (claimResult.epoch_id !== request.epochId) {
    await typedRefusal("no_authority");
    return finish({
      schema: "gall.work-result/1",
      standing: "REFUSED_SUBJECT_MISMATCH",
      epochId: request.epochId,
      workerId: request.workerId,
      code: "epoch_mismatch",
      detail: `claim bound ${String(claimResult.epoch_id)}, requested ${request.epochId}`,
      stages: { claim: { ok: false, code: "epoch_mismatch" } }
    });
  }
  if (typeof claimResult.worktree === "string" && claimResult.worktree.length > 0
    && realpathSafe(claimResult.worktree) !== realpathSafe(request.cwd)) {
    await typedRefusal("no_authority");
    return finish({
      schema: "gall.work-result/1",
      standing: "REFUSED_SUBJECT_MISMATCH",
      epochId: request.epochId,
      workerId: request.workerId,
      code: "worktree_mismatch",
      detail: `claim worktree ${claimResult.worktree} does not match --cwd ${request.cwd}`,
      stages: { claim: { ok: false, code: "worktree_mismatch" } }
    });
  }

  // -- persist --------------------------------------------------------------
  try {
    await saveLeaseFiles(request.cwd, claimResult);
  } catch (error) {
    const conflict = error instanceof LeaseConflictError;
    await typedRefusal(conflict ? "no_authority" : "blocked");
    return finish({
      schema: "gall.work-result/1",
      standing: conflict ? "REFUSED_LEASE_CONFLICT" : "REFUSED_PERSIST",
      epochId: request.epochId,
      workerId: request.workerId,
      code: conflict ? "lease_conflict" : "persist_failed",
      detail: error instanceof Error ? error.message : String(error),
      stages: {
        claim: { ok: true },
        persist: { ok: false, code: conflict ? "lease_conflict" : "persist_failed" }
      }
    });
  }

  // -- construct ------------------------------------------------------------
  const workOrder = await writeWorkOrder(request.cwd, claimResult, request);
  const prompt = constructPrompt(workOrder);
  const heartbeat = async (): Promise<void> => {
    await call("heartbeat", { lease_token: claimToken });
  };
  const construct = options.construct
    ? await options.construct(request, prompt, heartbeat)
    : await runConstruct(request, prompt, heartbeat);

  if (construct.spawnError !== undefined) {
    const receipt = await typedRefusal("blocked");
    return finish({
      schema: "gall.work-result/1",
      standing: receipt ? "REFUSED" : "REFUSED_NO_FABRIC",
      epochId: request.epochId,
      workerId: request.workerId,
      receipt,
      code: "spawn_failed",
      detail: construct.spawnError,
      runtimeExitCode: null,
      stages: {
        claim: { ok: true },
        persist: { ok: true },
        construct: { ok: false, exitCode: null, spawnError: construct.spawnError },
        close: { ok: receipt !== undefined, code: receipt ? undefined : "refuse_unreachable" }
      }
    });
  }

  // -- close ----------------------------------------------------------------
  let head: string;
  try {
    head = await gitHead(request.cwd);
  } catch (error) {
    const receipt = await typedRefusal("blocked");
    return finish({
      schema: "gall.work-result/1",
      standing: receipt ? "REFUSED" : "REFUSED_NO_HEAD",
      epochId: request.epochId,
      workerId: request.workerId,
      receipt,
      code: "head_unavailable",
      detail: error instanceof Error ? error.message : String(error),
      runtimeExitCode: construct.exitCode,
      stages: {
        claim: { ok: true },
        persist: { ok: true },
        construct: { ok: false, exitCode: construct.exitCode },
        close: { ok: receipt !== undefined, code: receipt ? undefined : "refuse_unreachable" }
      }
    });
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
      runtime_exit_code: construct.exitCode,
      duration_ms: construct.durationMs,
      output_tail: construct.outputTail,
      heartbeat_seconds: request.heartbeatSeconds,
      ...semanticEvidence
    }
  });
  if (!closed.ok || !closed.result) {
    return finish({
      schema: "gall.work-result/1",
      standing: "REFUSED_CLOSE",
      epochId: request.epochId,
      workerId: request.workerId,
      code: closed.error ?? "close_failed",
      detail: "close_candidate refused; the lease stays live until TTL",
      finalHead: head,
      runtimeExitCode: construct.exitCode,
      stages: {
        claim: { ok: true },
        persist: { ok: true },
        construct: { ok: turnCompleted, exitCode: construct.exitCode },
        close: { ok: false, code: closed.error }
      }
    });
  }

  const sealedOutcome = String(closed.result.outcome ?? outcome);
  return finish({
    schema: "gall.work-result/1",
    standing: standingForOutcome(sealedOutcome),
    epochId: request.epochId,
    workerId: request.workerId,
    outcome: sealedOutcome,
    finalHead: head,
    runtimeExitCode: construct.exitCode,
    receipt: closed.result,
    stages: {
      claim: { ok: true },
      persist: { ok: true },
      construct: { ok: turnCompleted, exitCode: construct.exitCode },
      close: { ok: true }
    }
  });
}
