// Worker-side admission for the xaas-remote-relay/1 contract
// (test/fixtures/xaas-remote-relay.contract.json, byte-identical to
// xaas priv/ultracode/remote-relay.contract.json at 9820fe3b).
//
// XaaS RemoteRelay (lib/xaas/ultracode/remote_relay.ex) validates envelopes
// on the fabric side. The contract names two duties the worker must carry
// independently: `gall_work_binding` (the envelope is bound to the
// gall.work-lease/1 descriptor the worker holds) and `local_do_ack`
// (authority_ref is necessary but not sufficient for verb=actuate; the worker
// needs its own explicit allow-do). This module is that worker side:
//
//   admission_order  envelope_shape -> expiry -> execution_manifest ->
//                    authority_shape -> gall_work_semantic_binding ->
//                    durable_replay -> sequence
//
// Outcomes are typed: `admitted` (fresh, or a retry of the one pending
// command after a disconnect before ACK), `known_replay` (KNOWN_REPLAY: an
// acknowledged command_id or sequence; the caller must not spawn), or
// `refused` with one of the 14 contract refusals.
//
// Durable state is one JSON file under the lease state dir
// (<tmpdir>/xaas-fabric, the same dir `zcode gall-work` persists leases in),
// keyed by the lease worktree realpath and epoch. It records the last
// acknowledged sequence, the digest of every acknowledged command id (never
// evicted: `after_ack` replay must hold for the whole epoch, not for a bounded
// window), a bounded list of full ack entries, and the single pending
// (admitted, not yet acknowledged) command with its full semantic identity
// (sequence, intent, subject, verb, channel, authority_ref). Every
// state-reading transition re-reads the file under an exclusive lock file
// (`<state>.lock`, O_EXCL, stale when its pid is dead), so two workers on the
// same lease/epoch serialize instead of last-writer-wins. A restarted worker therefore keeps
// the pending command identity: a retry with the same command_id is the same
// command, a different command_id for the pending sequence is refused, and an
// acknowledged command never spawns again.
//
// Transport never creates DO authority. This module admits or refuses; it does
// not execute a lease, and it grants nothing.

import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Contract vocabulary (mirrors the vendored contract; the test pins equality)
// ---------------------------------------------------------------------------

export const RELAY_CONTRACT = "xaas-remote-relay";
export const RELAY_CONTRACT_VERSION = 1;
export const RELAY_ENVELOPE_SCHEMA = "xaas.remote-relay-envelope/1";
export const RELAY_STATE_SCHEMA = "zcode.relay-ack-state/2";
/** Previous schema; upgraded on load only when provably lossless (see loadState). */
export const RELAY_STATE_SCHEMA_V1 = "zcode.relay-ack-state/1";

/** The one verb that carries actuation semantics; compared canonically. */
export const RELAY_ACTUATE_VERB = "actuate";

export const ADMISSION_ORDER = [
  "envelope_shape",
  "expiry",
  "execution_manifest",
  "authority_shape",
  "gall_work_semantic_binding",
  "durable_replay",
  "sequence"
] as const;
export type AdmissionStage = (typeof ADMISSION_ORDER)[number];

export const RELAY_REFUSALS = [
  "INVALID_ENVELOPE",
  "INVALID_SEQUENCE",
  "INVALID_CHANNEL",
  "COMMAND_EXPIRED",
  "EXECUTION_MANIFEST_DRIFT",
  "AUTHORITY_REF_REQUIRED",
  "DESCRIPTOR_SCHEMA_MISMATCH",
  "DESCRIPTOR_IDENTITY_MISSING",
  "INTENT_DIGEST_MISMATCH",
  "EXACT_SUBJECT_MISMATCH",
  "EPOCH_MISMATCH",
  "TASK_MISMATCH",
  "SEQUENCE_GAP",
  "EXPLICIT_DO_ACK_REQUIRED"
] as const;
export type RelayRefusal = (typeof RELAY_REFUSALS)[number];

export const KNOWN_REPLAY = "KNOWN_REPLAY" as const;

export const RELAY_CHANNELS = ["control", "observe"] as const;
export type RelayChannel = (typeof RELAY_CHANNELS)[number];

export const RELAY_ENVELOPE_REQUIRED = [
  "command_id",
  "epoch_id",
  "task_id",
  "sequence",
  "intent_digest",
  "exact_subject",
  "verb",
  "execution_manifest_digest",
  "channel"
] as const;

/** The OCEL identity env the contract binds (`ocel_identity_env`). */
export const RELAY_OCEL_IDENTITY_ENV = [
  "XAAS_LEASE_CWD",
  "XAAS_WORK_ORDER_IRI",
  "XAAS_EPOCH_ID",
  "XAAS_BASE_SHA"
] as const;

/** Exact opt-in env for the worker's local DO ack; any other value is absent. */
export const RELAY_ALLOW_DO_ENV = "ZCODE_RELAY_ALLOW_DO";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RelayEnvelope {
  command_id: string;
  epoch_id: string;
  task_id: string;
  sequence: number;
  intent_digest: string;
  exact_subject: string;
  verb: string;
  execution_manifest_digest: string;
  channel: RelayChannel;
  issued_at?: number;
  expires_at?: number;
  authority_ref?: string;
}

/** The gall.work-lease/1 fields the relay binding reads. */
export interface RelayLeaseDescriptor {
  schema: string;
  work_order_iri: string;
  graph_digest: string;
  repository_identity: string;
  base_sha: string;
  epoch_id: string;
  worktree: string;
}

export interface AckedCommand {
  command_id: string;
  sequence: number;
  intent_digest: string;
  receipt_ref: string | null;
  acknowledged_at: number;
}

export interface PendingCommand {
  command_id: string;
  sequence: number;
  epoch_id: string;
  task_id: string;
  intent_digest: string;
  exact_subject: string;
  verb: string;
  channel: RelayChannel;
  authority_ref: string | null;
  admitted_at: number;
}

export interface RelayAckState {
  schema: typeof RELAY_STATE_SCHEMA;
  contract: typeof RELAY_CONTRACT;
  contract_version: typeof RELAY_CONTRACT_VERSION;
  execution_manifest_digest: string;
  epoch_id: string;
  task_id: string;
  last_acknowledged_sequence: number;
  /** sha256(command_id) of every acknowledged command in this epoch; never evicted. */
  acknowledged_ids: string[];
  /** Most recent full ack entries, bounded by dedupLimit (receipt lookup only). */
  acknowledged: AckedCommand[];
  pending: PendingCommand | null;
}

export type AdmissionResult =
  | { outcome: "admitted"; command_id: string; sequence: number; retry: boolean; stages: AdmissionStage[] }
  | {
      outcome: "known_replay";
      code: typeof KNOWN_REPLAY;
      command_id: string;
      sequence: number;
      acknowledged: AckedCommand | null;
      stages: AdmissionStage[];
    }
  | { outcome: "refused"; refusal: RelayRefusal; stage: AdmissionStage; detail: string; stages: AdmissionStage[] };

export type AckResult =
  | { ok: true; last_acknowledged_sequence: number }
  | { ok: false; code: "ACK_WITHOUT_ADMISSION" | "ACK_SEQUENCE_MISMATCH"; detail: string };

export interface RelayWorkerOptions {
  /** gall.work-lease/1 descriptor the worker holds (unvalidated input is fine; admission refuses). */
  descriptor: unknown;
  /** The worker session's execution manifest digest. */
  executionManifestDigest: string;
  /** Explicit local allow-do. Only the literal `true` counts. Default false. */
  allowDo?: boolean;
  /** Lease state dir; default `<tmpdir>/xaas-fabric` (the gall-work lease dir). */
  stateDir?: string;
  /**
   * Bound on remembered full ack entries (receipt_ref lookup). Replay
   * detection does not depend on it: every acknowledged command id digest is
   * kept for the epoch.
   */
  dedupLimit?: number;
  /** How long to wait for the state lock held by another live worker. Default 5000 ms. */
  lockTimeoutMs?: number;
  /** Clock in epoch milliseconds. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const defaultRelayStateDir = (): string => join(tmpdir(), "xaas-fabric");

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function realpathSafe(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** Explicit local allow-do from env: exactly `1`; anything else is absent. */
export function localAllowDoFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[RELAY_ALLOW_DO_ENV] === "1";
}

/** OCEL identity env for a leased relay command (keys = contract `ocel_identity_env`). */
export function relayIdentityEnv(descriptor: RelayLeaseDescriptor): Record<(typeof RELAY_OCEL_IDENTITY_ENV)[number], string> {
  return {
    XAAS_LEASE_CWD: descriptor.worktree,
    XAAS_WORK_ORDER_IRI: descriptor.work_order_iri,
    XAAS_EPOCH_ID: descriptor.epoch_id,
    XAAS_BASE_SHA: descriptor.base_sha
  };
}

/** Durable ack-state path for one lease worktree + epoch under the lease state dir. */
export function relayStatePath(stateDir: string, worktree: string, epochId: string): string {
  const key = createHash("sha256").update(`${realpathSafe(worktree)}\n${epochId}`).digest("hex");
  return join(stateDir, `${key}.relay-ack.json`);
}

/** Durable digest of a command id (the replay set stores digests, not raw ids). */
export function commandIdDigest(commandId: string): string {
  return createHash("sha256").update(commandId).digest("hex");
}

function descriptorFields(value: unknown): Partial<RelayLeaseDescriptor> {
  const input = record(value) ?? {};
  const str = (key: string): string | undefined => (typeof input[key] === "string" ? (input[key] as string) : undefined);
  return {
    schema: str("schema"),
    work_order_iri: str("work_order_iri"),
    graph_digest: str("graph_digest"),
    repository_identity: str("repository_identity"),
    base_sha: str("base_sha"),
    epoch_id: str("epoch_id"),
    worktree: str("worktree")
  };
}

// ---------------------------------------------------------------------------
// Stage functions (pure; each returns a refusal or null)
// ---------------------------------------------------------------------------

type StageRefusal = { refusal: RelayRefusal; detail: string } | null;

/** envelope_shape: required strings, positive-integer sequence, known channel. */
export function checkEnvelopeShape(value: unknown): { envelope: RelayEnvelope | null; refusal: StageRefusal } {
  const input = record(value);
  if (!input) return { envelope: null, refusal: { refusal: "INVALID_ENVELOPE", detail: "envelope is not an object" } };
  for (const key of RELAY_ENVELOPE_REQUIRED) {
    if (key === "sequence" || key === "channel") continue;
    if (!nonBlank(input[key])) {
      return { envelope: null, refusal: { refusal: "INVALID_ENVELOPE", detail: `missing or blank ${key}` } };
    }
  }
  for (const key of ["issued_at", "expires_at"] as const) {
    if (input[key] !== undefined && input[key] !== null && !Number.isSafeInteger(input[key])) {
      return { envelope: null, refusal: { refusal: "INVALID_ENVELOPE", detail: `${key} must be epoch milliseconds` } };
    }
  }
  if (input.authority_ref !== undefined && input.authority_ref !== null && typeof input.authority_ref !== "string") {
    return { envelope: null, refusal: { refusal: "INVALID_ENVELOPE", detail: "authority_ref must be a string" } };
  }
  const verb = input.verb as string;
  if (verb !== RELAY_ACTUATE_VERB && verb.trim().toLowerCase() === RELAY_ACTUATE_VERB) {
    return {
      envelope: null,
      refusal: { refusal: "INVALID_ENVELOPE", detail: `verb ${JSON.stringify(verb)} is a non-canonical spelling of ${RELAY_ACTUATE_VERB}` }
    };
  }
  const sequence = input.sequence;
  if (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 1) {
    return { envelope: null, refusal: { refusal: "INVALID_SEQUENCE", detail: "sequence must be a positive integer" } };
  }
  if (!(RELAY_CHANNELS as readonly unknown[]).includes(input.channel)) {
    return { envelope: null, refusal: { refusal: "INVALID_CHANNEL", detail: `channel must be one of ${RELAY_CHANNELS.join("|")}` } };
  }
  const envelope: RelayEnvelope = {
    command_id: input.command_id as string,
    epoch_id: input.epoch_id as string,
    task_id: input.task_id as string,
    sequence,
    intent_digest: input.intent_digest as string,
    exact_subject: input.exact_subject as string,
    verb: input.verb as string,
    execution_manifest_digest: input.execution_manifest_digest as string,
    channel: input.channel as RelayChannel
  };
  if (typeof input.issued_at === "number") envelope.issued_at = input.issued_at;
  if (typeof input.expires_at === "number") envelope.expires_at = input.expires_at;
  if (typeof input.authority_ref === "string") envelope.authority_ref = input.authority_ref;
  return { envelope, refusal: null };
}

/** expiry: `expires_at`, when present, is a deadline (inclusive). */
export function checkExpiry(envelope: RelayEnvelope, nowMs: number): StageRefusal {
  if (envelope.expires_at === undefined) return null;
  return envelope.expires_at >= nowMs
    ? null
    : { refusal: "COMMAND_EXPIRED", detail: `expired at ${envelope.expires_at}, now ${nowMs}` };
}

/** execution_manifest: envelope digest must equal the worker session manifest. */
export function checkExecutionManifest(envelope: RelayEnvelope, sessionManifest: string): StageRefusal {
  return envelope.execution_manifest_digest === sessionManifest
    ? null
    : { refusal: "EXECUTION_MANIFEST_DRIFT", detail: "envelope execution_manifest_digest differs from the worker session manifest" };
}

/**
 * authority_shape: verb=actuate needs channel=control and a non-empty
 * authority_ref (AUTHORITY_REF_REQUIRED), and then, independently, the
 * worker's own explicit local allow-do (EXPLICIT_DO_ACK_REQUIRED) -- the
 * contract's `local_do_ack` duty: authority_ref is necessary, not sufficient.
 */
export function checkAuthorityShape(envelope: RelayEnvelope, allowDo: boolean): StageRefusal {
  if (envelope.verb !== RELAY_ACTUATE_VERB) return null;
  if (envelope.channel !== "control" || !nonBlank(envelope.authority_ref)) {
    return { refusal: "AUTHORITY_REF_REQUIRED", detail: "verb=actuate requires channel=control and a non-empty authority_ref" };
  }
  if (allowDo !== true) {
    return { refusal: "EXPLICIT_DO_ACK_REQUIRED", detail: "authority_ref present but the worker holds no explicit local allow-do" };
  }
  return null;
}

/** gall_work_semantic_binding: envelope identity = gall.work-lease/1 descriptor identity. */
export function checkGallWorkBinding(envelope: RelayEnvelope, descriptor: unknown): StageRefusal {
  const d = descriptorFields(descriptor);
  if (d.schema !== "gall.work-lease/1") {
    return { refusal: "DESCRIPTOR_SCHEMA_MISMATCH", detail: `descriptor schema ${String(d.schema)} is not gall.work-lease/1` };
  }
  for (const key of ["work_order_iri", "graph_digest", "epoch_id", "repository_identity", "base_sha"] as const) {
    if (!nonBlank(d[key])) return { refusal: "DESCRIPTOR_IDENTITY_MISSING", detail: `descriptor ${key} is missing or blank` };
  }
  if (envelope.intent_digest !== d.graph_digest) {
    return { refusal: "INTENT_DIGEST_MISMATCH", detail: "intent_digest != payload.graph_digest" };
  }
  if (envelope.exact_subject !== `${d.repository_identity}@${d.base_sha}`) {
    return { refusal: "EXACT_SUBJECT_MISMATCH", detail: "exact_subject != payload.repository_identity@payload.base_sha" };
  }
  if (envelope.epoch_id !== d.epoch_id) return { refusal: "EPOCH_MISMATCH", detail: "epoch_id != payload.epoch_id" };
  if (envelope.task_id !== d.work_order_iri) return { refusal: "TASK_MISMATCH", detail: "task_id != payload.work_order_iri" };
  return null;
}

// ---------------------------------------------------------------------------
// Durable ack state
// ---------------------------------------------------------------------------

export class RelayStateError extends Error {
  constructor(path: string, reason: string) {
    super(`relay ack state at ${path} is unusable (${reason}); refusing to reset it (a reset would admit acknowledged commands as fresh work)`);
    this.name = "RelayStateError";
  }
}

function loadState(path: string, fresh: RelayAckState): RelayAckState {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fresh;
    throw new RelayStateError(path, (error as Error).message);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RelayStateError(path, "not JSON");
  }
  const s = record(parsed);
  if (
    !s ||
    (s.schema !== RELAY_STATE_SCHEMA && s.schema !== RELAY_STATE_SCHEMA_V1) ||
    !Number.isSafeInteger(s.last_acknowledged_sequence) ||
    (s.last_acknowledged_sequence as number) < 0 ||
    !Array.isArray(s.acknowledged) ||
    (s.pending !== null && !record(s.pending))
  ) {
    throw new RelayStateError(path, "schema mismatch");
  }
  if (s.epoch_id !== fresh.epoch_id || s.task_id !== fresh.task_id) {
    throw new RelayStateError(path, "state belongs to a different epoch/task");
  }
  const acknowledged = s.acknowledged as AckedCommand[];
  if (s.schema === RELAY_STATE_SCHEMA_V1) {
    // /1 kept only a bounded id list and no pending channel/authority_ref.
    // Upgrade only when nothing was lost: every acknowledged sequence still has
    // its entry, and no pending command lacks the identity fields /2 compares.
    if (acknowledged.length !== s.last_acknowledged_sequence || s.pending !== null) {
      throw new RelayStateError(path, "zcode.relay-ack-state/1 with evicted ack ids or a pending command cannot be upgraded losslessly");
    }
    return { ...(s as unknown as RelayAckState), schema: RELAY_STATE_SCHEMA, acknowledged_ids: acknowledged.map((a) => commandIdDigest(a.command_id)) };
  }
  const ids = s.acknowledged_ids;
  if (
    !Array.isArray(ids) ||
    ids.length !== s.last_acknowledged_sequence ||
    !ids.every((id) => typeof id === "string" && /^[0-9a-f]{64}$/.test(id))
  ) {
    throw new RelayStateError(path, "acknowledged_ids must hold one sha256 digest per acknowledged sequence");
  }
  const pending = record(s.pending);
  if (pending && (!(RELAY_CHANNELS as readonly unknown[]).includes(pending.channel) || (pending.authority_ref !== null && typeof pending.authority_ref !== "string"))) {
    throw new RelayStateError(path, "pending command lacks channel/authority_ref identity");
  }
  return parsed as RelayAckState;
}

export class RelayLockError extends Error {
  constructor(path: string, holder: string) {
    super(`relay ack state lock ${path} is held by ${holder}; refusing to proceed without exclusive access`);
    this.name = "RelayLockError";
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Run `fn` holding `<state>.lock` (created O_EXCL, containing the holder pid).
 * A lock whose pid is dead, or an empty/unparseable lock older than the
 * timeout (a crash between create and write), is stale and removed.
 */
function withStateLock<T>(statePath: string, dir: string, timeoutMs: number, fn: () => T): T {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lockPath = `${statePath}.lock`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let fd: number | null = null;
    try {
      fd = openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (fd !== null) {
      try {
        writeFileSync(fd, `${process.pid}\n`);
      } finally {
        closeSync(fd);
      }
      try {
        return fn();
      } finally {
        try {
          unlinkSync(lockPath);
        } catch {
          // already removed
        }
      }
    }
    let holder = "unknown";
    let stale = false;
    try {
      const text = readFileSync(lockPath, "utf8").trim();
      const pid = /^\d+$/.test(text) ? Number(text) : NaN;
      if (Number.isSafeInteger(pid) && pid > 0) {
        holder = `pid ${pid}`;
        stale = pid !== process.pid && !pidAlive(pid);
      } else {
        holder = "an unwritten lock";
        stale = Date.now() - statSync(lockPath).mtimeMs > timeoutMs;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (stale) {
      try {
        unlinkSync(lockPath);
      } catch {
        // another worker removed it first
      }
      continue;
    }
    if (Date.now() >= deadline) throw new RelayLockError(lockPath, holder);
    sleepSync(10);
  }
}

function persistState(path: string, dir: string, state: RelayAckState): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export class RelayWorker {
  readonly statePath: string;
  private readonly stateDir: string;
  private readonly descriptor: unknown;
  private readonly manifest: string;
  private readonly allowDo: boolean;
  private readonly dedupLimit: number;
  private readonly now: () => number;
  private readonly lockTimeoutMs: number;
  private readonly freshState: RelayAckState;
  private state: RelayAckState;

  constructor(options: RelayWorkerOptions) {
    if (!nonBlank(options.executionManifestDigest)) {
      throw new Error("executionManifestDigest must be non-empty");
    }
    const d = descriptorFields(options.descriptor);
    this.descriptor = options.descriptor;
    this.manifest = options.executionManifestDigest;
    this.allowDo = options.allowDo === true;
    this.dedupLimit = Math.max(1, options.dedupLimit ?? 1024);
    this.now = options.now ?? Date.now;
    this.stateDir = options.stateDir ?? defaultRelayStateDir();
    this.lockTimeoutMs = Math.max(0, options.lockTimeoutMs ?? 5000);
    const epoch = d.epoch_id ?? "";
    const task = d.work_order_iri ?? "";
    this.statePath = relayStatePath(this.stateDir, d.worktree ?? "", epoch);
    this.freshState = {
      schema: RELAY_STATE_SCHEMA,
      contract: RELAY_CONTRACT,
      contract_version: RELAY_CONTRACT_VERSION,
      execution_manifest_digest: this.manifest,
      epoch_id: epoch,
      task_id: task,
      last_acknowledged_sequence: 0,
      acknowledged_ids: [],
      acknowledged: [],
      pending: null
    };
    this.state = loadState(this.statePath, this.freshState);
  }

  /** Re-read durable state and run one transition under the exclusive state lock. */
  private locked<T>(fn: () => T): T {
    return withStateLock(this.statePath, this.stateDir, this.lockTimeoutMs, () => {
      this.state = loadState(this.statePath, this.freshState);
      return fn();
    });
  }

  /** Snapshot of the durable state (copy). */
  snapshot(): RelayAckState {
    return JSON.parse(JSON.stringify(this.state)) as RelayAckState;
  }

  /** Run the contract admission_order over one raw envelope. */
  admit(raw: unknown): AdmissionResult {
    const stages: AdmissionStage[] = [];
    const refuse = (stage: AdmissionStage, r: { refusal: RelayRefusal; detail: string }): AdmissionResult => ({
      outcome: "refused",
      refusal: r.refusal,
      stage,
      detail: r.detail,
      stages: [...stages]
    });

    stages.push("envelope_shape");
    const shaped = checkEnvelopeShape(raw);
    if (shaped.refusal || !shaped.envelope) {
      return refuse("envelope_shape", shaped.refusal ?? { refusal: "INVALID_ENVELOPE", detail: "unshaped" });
    }
    const envelope = shaped.envelope;

    stages.push("expiry");
    const expired = checkExpiry(envelope, this.now());
    if (expired) return refuse("expiry", expired);

    stages.push("execution_manifest");
    const drift = checkExecutionManifest(envelope, this.manifest);
    if (drift) return refuse("execution_manifest", drift);

    stages.push("authority_shape");
    const authority = checkAuthorityShape(envelope, this.allowDo);
    if (authority) return refuse("authority_shape", authority);

    stages.push("gall_work_semantic_binding");
    const binding = checkGallWorkBinding(envelope, this.descriptor);
    if (binding) return refuse("gall_work_semantic_binding", binding);

    return this.locked(() => this.admitDurable(envelope, stages, refuse));
  }

  private admitDurable(
    envelope: RelayEnvelope,
    stages: AdmissionStage[],
    refuse: (stage: AdmissionStage, r: { refusal: RelayRefusal; detail: string }) => AdmissionResult
  ): AdmissionResult {
    stages.push("durable_replay");
    const acked = this.state.acknowledged.find((entry) => entry.command_id === envelope.command_id) ?? null;
    const ackedId = acked !== null || this.state.acknowledged_ids.includes(commandIdDigest(envelope.command_id));
    if (ackedId || envelope.sequence <= this.state.last_acknowledged_sequence) {
      return {
        outcome: "known_replay",
        code: KNOWN_REPLAY,
        command_id: envelope.command_id,
        sequence: envelope.sequence,
        acknowledged: acked ?? this.state.acknowledged.find((entry) => entry.sequence === envelope.sequence) ?? null,
        stages: [...stages]
      };
    }
    const pending = this.state.pending;
    if (pending) {
      if (pending.command_id === envelope.command_id) {
        // Disconnect before ACK: the retry must carry the same identity.
        if (pending.sequence !== envelope.sequence) {
          return refuse("durable_replay", { refusal: "INVALID_SEQUENCE", detail: `pending ${pending.command_id} is bound to sequence ${pending.sequence}` });
        }
        if (pending.intent_digest !== envelope.intent_digest) {
          return refuse("durable_replay", { refusal: "INTENT_DIGEST_MISMATCH", detail: "retry intent_digest differs from the pending command" });
        }
        if (pending.exact_subject !== envelope.exact_subject) {
          return refuse("durable_replay", { refusal: "EXACT_SUBJECT_MISMATCH", detail: "retry exact_subject differs from the pending command" });
        }
        if (pending.verb !== envelope.verb) {
          return refuse("durable_replay", { refusal: "INVALID_ENVELOPE", detail: "retry verb differs from the pending command" });
        }
        if (pending.channel !== envelope.channel) {
          return refuse("durable_replay", { refusal: "INVALID_CHANNEL", detail: "retry channel differs from the pending command" });
        }
        if (pending.authority_ref !== (envelope.authority_ref ?? null)) {
          return refuse("durable_replay", { refusal: "AUTHORITY_REF_REQUIRED", detail: "retry authority_ref differs from the pending command" });
        }
        stages.push("sequence");
        return { outcome: "admitted", command_id: envelope.command_id, sequence: envelope.sequence, retry: true, stages: [...stages] };
      }
      if (pending.sequence === envelope.sequence) {
        return refuse("durable_replay", {
          refusal: "INVALID_SEQUENCE",
          detail: `sequence ${envelope.sequence} is pending under command_id ${pending.command_id}; a fresh identity may not replace it`
        });
      }
    }

    stages.push("sequence");
    const expected = this.state.last_acknowledged_sequence + 1;
    if (envelope.sequence !== expected) {
      return refuse("sequence", { refusal: "SEQUENCE_GAP", detail: `expected sequence ${expected}, got ${envelope.sequence}` });
    }

    this.state = {
      ...this.state,
      pending: {
        command_id: envelope.command_id,
        sequence: envelope.sequence,
        epoch_id: envelope.epoch_id,
        task_id: envelope.task_id,
        intent_digest: envelope.intent_digest,
        exact_subject: envelope.exact_subject,
        verb: envelope.verb,
        channel: envelope.channel,
        authority_ref: envelope.authority_ref ?? null,
        admitted_at: this.now()
      }
    };
    persistState(this.statePath, this.stateDir, this.state);
    return { outcome: "admitted", command_id: envelope.command_id, sequence: envelope.sequence, retry: false, stages: [...stages] };
  }

  /** Durably acknowledge the pending command after its receipt exists. */
  acknowledge(commandId: string, receiptRef: string | null = null): AckResult {
    return this.locked(() => this.acknowledgeDurable(commandId, receiptRef));
  }

  private acknowledgeDurable(commandId: string, receiptRef: string | null): AckResult {
    const pending = this.state.pending;
    if (!pending || pending.command_id !== commandId) {
      return { ok: false, code: "ACK_WITHOUT_ADMISSION", detail: `no pending admitted command ${commandId}` };
    }
    if (pending.sequence !== this.state.last_acknowledged_sequence + 1) {
      return { ok: false, code: "ACK_SEQUENCE_MISMATCH", detail: `pending sequence ${pending.sequence} does not follow ${this.state.last_acknowledged_sequence}` };
    }
    const entry: AckedCommand = {
      command_id: pending.command_id,
      sequence: pending.sequence,
      intent_digest: pending.intent_digest,
      receipt_ref: receiptRef,
      acknowledged_at: this.now()
    };
    this.state = {
      ...this.state,
      last_acknowledged_sequence: pending.sequence,
      acknowledged_ids: [...this.state.acknowledged_ids, commandIdDigest(pending.command_id)],
      acknowledged: [entry, ...this.state.acknowledged.filter((a) => a.command_id !== entry.command_id)].slice(0, this.dedupLimit),
      pending: null
    };
    persistState(this.statePath, this.stateDir, this.state);
    return { ok: true, last_acknowledged_sequence: pending.sequence };
  }
}

export type RelayDispatchResult =
  | { outcome: "executed"; admission: AdmissionResult; ack: AckResult & { ok: true }; receipt_ref: string | null }
  | { outcome: "unacknowledged"; admission: AdmissionResult; ack: AckResult & { ok: false }; receipt_ref: string | null }
  | { outcome: "known_replay" | "refused"; admission: AdmissionResult };

/**
 * admit -> execute -> acknowledge. `execute` runs only on `admitted`; a
 * KNOWN_REPLAY or refusal never reaches it (the contract's consequence_bound:
 * a durably receipted duplicate must not spawn zcode again). If `execute`
 * throws, the command stays pending (no ACK) and a retry with the same
 * command_id is admitted as the same command. If the execution ran but the
 * durable ACK was refused (ACK_WITHOUT_ADMISSION / ACK_SEQUENCE_MISMATCH), the
 * outcome is `unacknowledged`, never `executed`: the command is not done.
 */
export async function dispatchRelayCommand(
  worker: RelayWorker,
  raw: unknown,
  execute: (envelope: RelayEnvelope) => Promise<string | null>
): Promise<RelayDispatchResult> {
  const admission = worker.admit(raw);
  if (admission.outcome !== "admitted") return { outcome: admission.outcome, admission };
  const envelope = checkEnvelopeShape(raw).envelope as RelayEnvelope;
  const receiptRef = await execute(envelope);
  const ack = worker.acknowledge(admission.command_id, receiptRef);
  if (!ack.ok) return { outcome: "unacknowledged", admission, ack, receipt_ref: receiptRef };
  return { outcome: "executed", admission, ack, receipt_ref: receiptRef };
}
