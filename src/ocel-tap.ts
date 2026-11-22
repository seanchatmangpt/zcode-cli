// Launcher-level OCEL 2.0 tap for the zcode runtime (residue: UNSUPPORTED generator-capability, see
// HANDWRITTEN.md). It consumes the runtime's own output -- `-p`/`--prompt`/`--print`
// `--output-format stream-json` lines or `app-server` notifications -- and feeds them to the
// ontology-generated tap in ./generated/ocel.ts.
// Nothing here knows an event type: mapping, hashing and receipts come from the generated modules.
// Gated by ZCODE_OCEL=1; output directory ZCODE_OCEL_DIR (default ~/.zcode/ocel).
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

import { Tap, verifyChain, type OcelDoc } from "./generated/ocel.ts";
import { appendOutcome, appendPending, seal, unpaired, verify, type Chain, type Entry } from "./generated/receipt.ts";
import {
  createComplianceRedactor,
  pseudonymizeActor,
  redactComplianceText,
  type ComplianceRedactor,
  type RedactComplianceOptions
} from "./compliance/redactor.ts";

export const STREAM_SOURCE = "zcode_stream";
export const APP_SERVER_SOURCE = "zcode_app_server";
/** gall-work orchestrator lifecycle events (ALOOP vocabulary, ontology Source-GallWorkHook). */
export const GALL_WORK_SOURCE = "gall_work";

export function ocelEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.ZCODE_OCEL === "1";
}

export function ocelDirectory(env: NodeJS.ProcessEnv): string {
  return env.ZCODE_OCEL_DIR?.trim() || join(homedir(), ".zcode", "ocel");
}

/**
 * Headless prompt flags that can emit a tappable stream-json wire.
 * Includes Claude Code `--print` and the native `--prompt`/`-p` forms:
 * `normalizeClaudeAgentArgs` rewrites `--print <prompt>` → `--prompt <prompt>`
 * before `startOcelTap` runs, so recognizing only `--print`/`-p` silently
 * disabled Art.12 logging for the common agent headless path.
 */
export function isHeadlessPromptArg(arg: string): boolean {
  return (
    arg === "-p"
    || arg === "--print"
    || arg === "--prompt"
    || arg.startsWith("--prompt=")
    || (arg.startsWith("-p") && arg.length > 2)
  );
}

/** True when argv is a headless single-prompt invocation (native or Claude-parity form). */
export function isHeadlessPromptArgs(args: readonly string[]): boolean {
  for (const a of args) {
    if (a === "--") break;
    if (isHeadlessPromptArg(a)) return true;
  }
  return false;
}

/** Which source (if any) the given runtime arguments produce events for. */
export function ocelSourceForArgs(args: readonly string[]): string | undefined {
  if (args[0] === "app-server") return APP_SERVER_SOURCE;
  // Claude-parity rewrites `--print <prompt>` → `--prompt <prompt>` before runRuntime;
  // accept every headless prompt form so ZCODE_OCEL=1 cannot silently drop the tap.
  const headless = isHeadlessPromptArgs(args);
  const idx = args.findIndex((a) => a === "--output-format" || a.startsWith("--output-format="));
  if (idx < 0) return undefined;
  const value = args[idx].includes("=") ? args[idx].split("=")[1] : args[idx + 1];
  return headless && value === "stream-json" ? STREAM_SOURCE : undefined;
}

// gall-work binds its construct turn to the leased subject and work order:
// the orchestrator exports XAAS_WORKER=1 plus the identity variables, and
// receipts sealed for that turn carry the exact subject/lease identity
// (ZCODE-26922-06). No identity is fabricated: a field is bound only when
// its variable is present and, for subject_sha, only when the lease cwd
// resolves an exact git head.
export interface LeaseIdentity {
  subjectCwd?: string;
  workOrderIri?: string;
  epochId?: string;
  baseSha?: string;
  /** Replay binding (dispatch identity + contract digest); carried as-is when present. */
  replayBinding?: Record<string, unknown>;
}

const gitShaPattern = /^[0-9a-f]{40}$/u;

export function leaseIdentityFromEnv(env: NodeJS.ProcessEnv): LeaseIdentity {
  if (env.XAAS_WORKER !== "1") return {};
  const trim = (value: string | undefined): string | undefined => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  };
  return {
    subjectCwd: trim(env.XAAS_LEASE_CWD),
    workOrderIri: trim(env.XAAS_WORK_ORDER_IRI),
    epochId: trim(env.XAAS_EPOCH_ID),
    baseSha: trim(env.XAAS_BASE_SHA),
    replayBinding: parseReplayBinding(env.XAAS_REPLAY_BINDING)
  };
}

/**
 * Namespaced OCEL object ids for lease identity (Explore 21cd2acc).
 * work_order uses the sjira IRI verbatim; epoch/subject/base keep disjoint
 * namespaces so a raw SHA never collides across object types.
 */
export function leaseIdentityObjectIds(
  identity: LeaseIdentity,
  subjectSha?: string
): Record<string, string> {
  const out: Record<string, string> = {};
  if (identity.workOrderIri) out.work_order_iri = identity.workOrderIri;
  if (identity.epochId) out.epoch = `epoch:${identity.epochId}`;
  const sha = subjectSha ?? subjectHead(identity.subjectCwd);
  if (sha) out.subject = `subj:${sha}`;
  if (identity.baseSha && gitShaPattern.test(identity.baseSha)) out.base = `base:${identity.baseSha}`;
  return out;
}

/** Merge lease-identity object id fields into a raw OCEL ingest record (identity wins). */
export function bindLeaseIdentityObjects(
  record: unknown,
  identity: LeaseIdentity,
  subjectSha?: string
): unknown {
  if (record === null || typeof record !== "object") return record;
  const facts = leaseIdentityObjectIds(identity, subjectSha);
  if (Object.keys(facts).length === 0) return record;
  const base = record as Record<string, unknown>;
  // App-server notifications carry identity under params.* (Rel-App paths when present).
  if (base.params !== null && typeof base.params === "object" && !Array.isArray(base.params)) {
    return {
      ...base,
      ...facts,
      params: { ...(base.params as Record<string, unknown>), ...facts }
    };
  }
  return { ...base, ...facts };
}

type OcelObject = {
  id: string;
  type: string;
  attributes: unknown[];
  relationships: unknown[];
};

type O2OEdge = { objectId: string; qualifier: string };

type ObjectAttr = { name: string; value: string; time: string };

/** Ensure an object exists with the given type; returns the mutable slot. */
function ensureObject(objects: OcelObject[], id: string, type: string): OcelObject {
  let obj = objects.find((o) => o.id === id);
  if (!obj) {
    obj = { id, type, attributes: [], relationships: [] };
    objects.push(obj);
  } else if (obj.type !== type) {
    // Prefer the first declared type; identity join must not retype session→work_order.
  } else if (!Array.isArray(obj.relationships)) {
    obj.relationships = [];
  }
  if (!Array.isArray(obj.attributes)) obj.attributes = [];
  if (!Array.isArray(obj.relationships)) obj.relationships = [];
  return obj;
}

function pushO2O(obj: OcelObject, qualifier: string, objectId: string): void {
  const rels = obj.relationships as O2OEdge[];
  if (rels.some((r) => r.qualifier === qualifier && r.objectId === objectId)) return;
  rels.push({ objectId, qualifier });
}

function pushAttr(obj: OcelObject, name: string, value: string, time: string): void {
  const attrs = obj.attributes as ObjectAttr[];
  if (attrs.some((a) => a && a.name === name)) return;
  attrs.push({ name, value, time });
}

/**
 * Post-seal O2O + object-attribute closure for lease identity.
 * The generated Tap.toOcel() leaves object.relationships / attributes empty
 * (PI pack projects E2O only). This residue binds work_order ↔ epoch ↔
 * subject ↔ base (and lease/session when present) *within one log* without
 * rewriting event pi_hash (object graph is outside the event chain).
 * File-level stream↔gall correlation is the dual-log join sidecar
 * (`buildDualLogJoinManifest` / `writeDualLogJoinManifest`) — not this graph.
 */
export function closeLeaseIdentityGraph(
  doc: OcelDoc,
  identity: LeaseIdentity,
  subjectSha?: string,
  time = new Date().toISOString()
): OcelDoc {
  const facts = leaseIdentityObjectIds(identity, subjectSha);
  if (Object.keys(facts).length === 0) return doc;

  const objects: OcelObject[] = doc.objects.map((o) => ({
    id: o.id,
    type: o.type,
    attributes: Array.isArray(o.attributes) ? [...o.attributes] : [],
    relationships: Array.isArray(o.relationships) ? [...o.relationships] : []
  }));

  const workOrderId = facts.work_order_iri;
  const epochId = facts.epoch;
  const subjectId = facts.subject;
  const baseId = facts.base;

  if (workOrderId) {
    const wo = ensureObject(objects, workOrderId, "work_order");
    pushAttr(wo, "work_order_iri", workOrderId, time);
    if (identity.epochId) pushAttr(wo, "epoch_id", identity.epochId, time);
  }
  if (epochId && identity.epochId) {
    const ep = ensureObject(objects, epochId, "epoch");
    pushAttr(ep, "epoch_id", identity.epochId, time);
  }
  if (subjectId) {
    const sha = subjectSha ?? subjectHead(identity.subjectCwd);
    const sub = ensureObject(objects, subjectId, "subject");
    if (sha) pushAttr(sub, "subject_sha", sha, time);
  }
  if (baseId && identity.baseSha) {
    const base = ensureObject(objects, baseId, "base");
    pushAttr(base, "base_sha", identity.baseSha, time);
  }

  // O2O: distinct identity objects linked — never collapse epoch into work_order.
  if (workOrderId && epochId) {
    pushO2O(ensureObject(objects, workOrderId, "work_order"), "of_epoch", epochId);
    pushO2O(ensureObject(objects, epochId, "epoch"), "for_work_order", workOrderId);
  }
  if (workOrderId && subjectId) {
    pushO2O(ensureObject(objects, workOrderId, "work_order"), "of_subject", subjectId);
    pushO2O(ensureObject(objects, subjectId, "subject"), "for_work_order", workOrderId);
  }
  if (subjectId && baseId) {
    pushO2O(ensureObject(objects, subjectId, "subject"), "at_base", baseId);
    pushO2O(ensureObject(objects, baseId, "base"), "of_subject", subjectId);
  }
  if (epochId && subjectId) {
    pushO2O(ensureObject(objects, epochId, "epoch"), "of_subject", subjectId);
  }

  // Lease objects already present from gall E2O (lease token id) join the graph.
  for (const lease of objects.filter((o) => o.type === "lease")) {
    if (workOrderId) pushO2O(lease, "for_work_order", workOrderId);
    if (epochId) pushO2O(lease, "of_epoch", epochId);
    if (subjectId) pushO2O(lease, "of_subject", subjectId);
    if (baseId) pushO2O(lease, "at_base", baseId);
  }

  // Session objects from stream join to the work order (dual-log case key).
  if (workOrderId) {
    for (const session of objects.filter((o) => o.type === "session")) {
      pushO2O(session, "for_work_order", workOrderId);
      if (epochId) pushO2O(session, "of_epoch", epochId);
    }
  }

  // Close objectType.attributes for names observed on objects.
  const observed = new Map<string, Set<string>>();
  for (const o of objects) {
    let set = observed.get(o.type);
    if (!set) {
      set = new Set();
      observed.set(o.type, set);
    }
    for (const a of o.attributes) {
      if (a && typeof a === "object" && typeof (a as { name?: unknown }).name === "string") {
        set.add((a as { name: string }).name);
      }
    }
  }
  const objectTypes = doc.objectTypes.map((t) => {
    const names = observed.get(t.name);
    if (!names || names.size === 0) return t;
    const prior = Array.isArray(t.attributes) ? t.attributes : [];
    const existing = new Set<string>();
    const merged: { name: string; type: string }[] = [];
    for (const a of prior) {
      if (a && typeof a === "object" && typeof (a as { name?: unknown }).name === "string") {
        const name = (a as { name: string }).name;
        if (existing.has(name)) continue;
        existing.add(name);
        merged.push({
          name,
          type: typeof (a as { type?: unknown }).type === "string" ? (a as { type: string }).type : "string"
        });
      }
    }
    for (const name of [...names].sort()) {
      if (existing.has(name)) continue;
      merged.push({ name, type: "string" });
    }
    return { name: t.name, attributes: merged };
  });

  return { ...doc, objectTypes, objects };
}

/** XAAS_REPLAY_BINDING carries a JSON object; anything else binds nothing. */
function parseReplayBinding(value: string | undefined): Record<string, unknown> | undefined {
  if (!value?.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

/** Exact head of the leased subject at seal time; undefined when unresolvable. */
export function subjectHead(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return gitShaPattern.test(head) ? head : undefined;
  } catch {
    return undefined;
  }
}

/** The runtime stamps epoch milliseconds; OCEL 2.0 wants ISO 8601. Applied to a shallow copy. */
export function normalizeRecord(record: unknown): unknown {
  if (record === null || typeof record !== "object") return record;
  const r = record as Record<string, unknown>;
  const fix = (o: Record<string, unknown>): Record<string, unknown> =>
    typeof o.timestamp === "number" ? { ...o, timestamp: new Date(o.timestamp).toISOString() } : o;
  const top = fix(r);
  if (top.params !== null && typeof top.params === "object") {
    return { ...top, params: fix(top.params as Record<string, unknown>) };
  }
  return top;
}

export type OcelResult = { sessionId: string; ocelPath: string; receiptPath: string; events: number; head: string };

/** Schema id for the stream↔gall dual-log join sidecar (no merge/rehash). */
export const DUAL_LOG_JOIN_SCHEMA = "zcode.dual-log-join/1" as const;

/**
 * Minimal seal-time index linking the two OCEL files that share a lease
 * identity. Lease objects may appear in both logs; this sidecar is the
 * durable join key (basenames under ZCODE_OCEL_DIR).
 */
export interface DualLogJoinManifest {
  schema: typeof DUAL_LOG_JOIN_SCHEMA;
  stream_ocel: string;
  gall_ocel: string;
  work_order_iri: string;
  epoch_id: string;
  /** Optional E2O session object ids (namespaces only; no cross-file merge). */
  sessions?: {
    stream?: string;
    gall?: string;
  };
}

export function dualLogJoinBasename(epochId: string): string {
  return `gall-work-${epochId}.join.json`;
}

/**
 * Build a dual-log join manifest when all four core fields are present.
 * Returns undefined rather than fabricating a partial join.
 */
export function buildDualLogJoinManifest(input: {
  streamOcel: string;
  gallOcel: string;
  workOrderIri: string;
  epochId: string;
  streamSession?: string;
  gallSession?: string;
}): DualLogJoinManifest | undefined {
  const stream_ocel = input.streamOcel.trim();
  const gall_ocel = input.gallOcel.trim();
  const work_order_iri = input.workOrderIri.trim();
  const epoch_id = input.epochId.trim();
  if (!stream_ocel || !gall_ocel || !work_order_iri || !epoch_id) return undefined;

  const streamSession = input.streamSession?.trim();
  const gallSession = input.gallSession?.trim();
  const sessions =
    streamSession || gallSession
      ? {
          ...(streamSession ? { stream: streamSession } : {}),
          ...(gallSession ? { gall: gallSession } : {})
        }
      : undefined;

  return {
    schema: DUAL_LOG_JOIN_SCHEMA,
    stream_ocel,
    gall_ocel,
    work_order_iri,
    epoch_id,
    ...(sessions && Object.keys(sessions).length > 0 ? { sessions } : {})
  };
}

/** Atomically write `<dir>/gall-work-<epoch>.join.json`; returns the path. */
export function writeDualLogJoinManifest(dir: string, manifest: DualLogJoinManifest): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, dualLogJoinBasename(manifest.epoch_id));
  atomicWrite(path, JSON.stringify(manifest, null, 2));
  return path;
}

/**
 * Disk receipt for a sealed OCEL tap. Two independent integrity witnesses —
 * never conflate them (pre-fix: `chain_intact` was ALOOP `verify(chain)`,
 * a false witness for OCEL `pi_hash`):
 *
 * - `chain_intact`: OCEL `verifyChain` (pi_hash) AND `event_count > 0`
 * - `receipt_chain_intact`: ALOOP receipt `verify(chain)` seal
 *
 * Seal standing is `"alive"` iff `chain_intact` (OCEL tripwire), else `"blocked"`.
 */
export interface OcelTapReceipt {
  session: string;
  source: string;
  ocel_file: string;
  ocel_file_sha256: string;
  event_count: number;
  head_hash: string;
  subject_sha?: string;
  work_order_iri?: string;
  epoch_id?: string;
  base_sha?: string;
  replay_binding?: Record<string, unknown>;
  /** OCEL pi_hash chain intact (verifyChain) with at least one event. */
  chain_intact: boolean;
  /** ALOOP receipt seal intact (verify(chain)); orthogonal to OCEL. */
  receipt_chain_intact: boolean;
  unpaired: ReturnType<typeof unpaired>;
  chain: Chain;
}

const sha256 = (data: string): string => createHash("sha256").update(data, "utf8").digest("hex");

export function sessionOf(record: unknown): string | undefined {
  if (record === null || typeof record !== "object") return undefined;
  const r = record as Record<string, unknown>;
  const p = (r.params ?? {}) as Record<string, unknown>;
  const v = r.sessionId ?? p.sessionId;
  return typeof v === "string" ? v : undefined;
}

/** Path-safe session file id: redacted session strings may still carry URL
 * punctuation (`/`, `?`, `#`) that would escape the OCEL output directory.
 * B4 pre-fix: a secret-bearing URL sessionId was used verbatim as the
 * `<session>.jsonocel` basename before redaction ran. */
export function sanitizeSessionFileId(sessionId: string): string {
  const cleaned = sessionId
    .replace(/[/\\?%*:|"<>#&=]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return (cleaned.slice(0, 180) || `unknown-${Date.now()}`);
}

/** Replaces credential-shaped values with REDACTED before they enter the event
 * chain: hashes are computed on redacted content, so no chain ever commits a
 * secret (leak-prevention tripwire, 2026-09-23). Delegates to the canonical
 * compliance redactor with PII disabled so non-credential text stays byte-identical. */
export function redactSecrets(text: string): string {
  return redactComplianceText(text, { redactPii: false });
}

/**
 * Canonical ALOOP receipt chain subject binding session, OCEL head_hash,
 * ocel_file_sha256, and (when provided) the O2O object-graph digest.
 */
export function receiptChainSubject(
  sessionId: string,
  headHash: string,
  ocelFileSha256: string,
  objectsSha256?: string
): string {
  return objectsSha256
    ? `${sessionId}|head=${headHash}|file=${ocelFileSha256}|objects=${objectsSha256}`
    : `${sessionId}|head=${headHash}|file=${ocelFileSha256}`;
}

/**
 * Verify that the ALOOP receipt chain is cryptographically intact AND that its
 * sealed subject commits to `session`, `head_hash`, `ocel_file_sha256`, and
 * (when `ocelText` or `doc` is supplied) the actual `.jsonocel` digest and O2O
 * `doc.objects` digest. Tampering with O2O edges, `ocel_file_sha256`, or
 * `head_hash` breaks this binding.
 */
export function verifyOcelReceipt(
  receipt: Pick<OcelTapReceipt, "session" | "head_hash" | "ocel_file_sha256" | "chain">,
  ocelText?: string,
  doc?: Pick<OcelDoc, "objects">
): boolean {
  if (!verify(receipt.chain) || receipt.chain.length === 0) return false;
  if (ocelText !== undefined && sha256(ocelText) !== receipt.ocel_file_sha256) return false;
  let parsedDoc = doc;
  if (parsedDoc === undefined && ocelText !== undefined) {
    try {
      parsedDoc = JSON.parse(ocelText) as Pick<OcelDoc, "objects">;
    } catch {
      return false;
    }
  }
  const sealEntry = receipt.chain[receipt.chain.length - 1]!;
  if (parsedDoc !== undefined) {
    const objectsSha = sha256(JSON.stringify(parsedDoc.objects));
    const expected = receiptChainSubject(receipt.session, receipt.head_hash, receipt.ocel_file_sha256, objectsSha);
    return sealEntry.subject === expected;
  }
  const prefix = `${receiptChainSubject(receipt.session, receipt.head_hash, receipt.ocel_file_sha256)}|objects=`;
  return sealEntry.subject.startsWith(prefix);
}

const ACTOR_KEY_RE = /^(?:actor|actor_?id|user|user_?id|username|author|owner|operator)$/i;

function pseudonymizeActors(value: unknown, salt: string, seen = new WeakSet<object>(), depth = 0): unknown {
  if (value === null || value === undefined || typeof value !== "object") return value;
  if (value instanceof Date || value instanceof RegExp) return value;
  if (depth >= 128 || seen.has(value)) return value;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => pseudonymizeActors(item, salt, seen, depth + 1));
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => {
        if (ACTOR_KEY_RE.test(key) && typeof child === "string" && child.length > 0) {
          return [key, pseudonymizeActor(child, salt)];
        }
        return [key, pseudonymizeActors(child, salt, seen, depth + 1)];
      })
    );
  } finally {
    seen.delete(value);
  }
}

export interface OcelRecorderOptions extends RedactComplianceOptions {
  /** Optional non-empty salt for HMAC-SHA256 pseudonymization of actor/user identifiers. */
  actorSalt?: string;
}


/**
 * IEEE OCEL 2.0 attribute closure for sealed logs: every attribute name that appears
 * on an event must be declared on that event's eventType. The generated Tap.toOcel()
 * emits empty eventType.attributes[]; this post-step closes the gap without editing
 * src/generated/.
 */
export function closeEventTypeAttributes(doc: OcelDoc): OcelDoc {
  const observed = new Map<string, Set<string>>();
  for (const e of doc.events) {
    let set = observed.get(e.type);
    if (!set) {
      set = new Set();
      observed.set(e.type, set);
    }
    for (const a of e.attributes) set.add(a.name);
  }
  return {
    ...doc,
    eventTypes: doc.eventTypes.map((t) => {
      const names = observed.get(t.name);
      if (!names || names.size === 0) return t;
      const prior = Array.isArray(t.attributes) ? t.attributes : [];
      const existing = new Set<string>();
      const merged: { name: string; type: string }[] = [];
      for (const a of prior) {
        if (a && typeof a === "object" && typeof (a as { name?: unknown }).name === "string") {
          const name = (a as { name: string }).name;
          if (existing.has(name)) continue;
          existing.add(name);
          merged.push({
            name,
            type: typeof (a as { type?: unknown }).type === "string" ? (a as { type: string }).type : "string",
          });
        }
      }
      for (const name of [...names].sort()) {
        if (existing.has(name)) continue;
        merged.push({ name, type: "string" });
      }
      return { name: t.name, attributes: merged };
    }),
  };
}

export class OcelRecorder {
  private readonly tap: Tap;
  private readonly redactor: ComplianceRedactor;
  private sessionId: string | undefined;
  private carry = "";
  private closed = false;
  /** Subject HEAD resolved at recorder open — stable E2O object id for the turn. */
  private readonly subjectSha: string | undefined;

  constructor(
    readonly source: string,
    private readonly dir: string,
    private readonly identity: LeaseIdentity = {},
    private readonly redactionOptions: OcelRecorderOptions = {}
  ) {
    this.tap = new Tap(source);
    this.subjectSha = subjectHead(identity.subjectCwd);
    this.redactor = createComplianceRedactor(redactionOptions);
  }

  /** Feed raw stdout bytes; complete lines are parsed, the tail is carried to the next chunk. */
  write(chunk: string): void {
    this.carry += chunk;
    let nl: number;
    while ((nl = this.carry.indexOf("\n")) >= 0) {
      const line = this.carry.slice(0, nl);
      this.carry = this.carry.slice(nl + 1);
      this.feedLine(line);
    }
  }

  feedLine(line: string): void {
    if (this.closed || line.trim() === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return; // non-protocol output is not an event
    }
    this.feed(parsed);
  }

  feed(record: unknown): void {
    if (this.closed) return;
    // Redact BEFORE binding sessionId: a pre-redaction capture let secret-
    // bearing URL sessionIds reach receipt.session and the output basename
    // (B4 pre-fix, 2026-11-21). Route through compiled compliance redactor so
    // GDPR PII, JWTs, PEM keys (including truncated), env secrets, and
    // credential keys never enter the OCEL log or its SHA-256 pi_hash chain.
    const normalized = normalizeRecord(record);
    const prepared =
      this.redactionOptions.actorSalt !== undefined
        ? pseudonymizeActors(normalized, this.redactionOptions.actorSalt)
        : normalized;
    const redacted = this.redactor.redactData(prepared);
    const serializedRedacted = JSON.stringify(redacted);
    if (this.redactor.containsUnredacted(serializedRedacted)) {
      throw new Error("REDACTION_FAILURE: unredacted secrets or PII detected before OCEL ingest");
    }
    // Promote lease identity into OCEL objects via E2O paths declared in the
    // ontology (work_order_iri / epoch / subject / base) — not receipt-only.
    const withIdentity = bindLeaseIdentityObjects(redacted, this.identity, this.subjectSha);
    this.sessionId ??= sessionOf(withIdentity);
    if (this.tap.spec.kind === "stream-json") this.tap.ingest(JSON.stringify(withIdentity));
    else this.tap.ingest(withIdentity as object);
  }

  /** Seal the tap once, write <session>.jsonocel and <session>.receipt.json. */
  finish(): OcelResult {
    if (this.closed) throw new Error("recorder already finished");
    if (this.carry.trim() !== "") this.feedLine(this.carry);
    this.carry = "";
    this.closed = true;
    const sessionId = sanitizeSessionFileId(this.sessionId ?? `unknown-${Date.now()}`);
    const sealedAt = new Date().toISOString();
    const doc = closeLeaseIdentityGraph(
      closeEventTypeAttributes(this.tap.toOcel()),
      this.identity,
      this.subjectSha,
      sealedAt
    );
    const head = this.tap.seal();
    const ocelText = JSON.stringify(doc);
    const ocelFileSha256 = sha256(ocelText);
    const objectsSha256 = sha256(JSON.stringify(doc.objects));
    mkdirSync(this.dir, { recursive: true });
    const ocelPath = join(this.dir, `${sessionId}.jsonocel`);
    const receiptPath = join(this.dir, `${sessionId}.receipt.json`);
    atomicWrite(ocelPath, ocelText);

    // OCEL pi_hash integrity — the process-intelligence tripwire. Distinct
    // from the receipt ALOOP seal (`receipt_chain_intact`); never conflate
    // the two (skeptic: chain_intact was a false witness for pi_hash).
    const ocelIntact = verifyChain(doc as OcelDoc, this.tap.spec.hash) === null && doc.events.length > 0;
    const chainSubject = receiptChainSubject(sessionId, head, ocelFileSha256, objectsSha256);
    const chain: Chain = [];
    appendPending(chain, `${sessionId}-e1`, chainSubject, "record-ocel");
    appendOutcome(chain, `${sessionId}-e2`, ocelIntact ? "alive" : "blocked", chainSubject, "record-ocel");
    seal(chain, `${sessionId}-e3`, ocelIntact ? "alive" : "blocked", chainSubject);
    const receiptIntact = verifyOcelReceipt(
      {
        session: sessionId,
        head_hash: head,
        ocel_file_sha256: ocelFileSha256,
        chain
      },
      ocelText,
      doc as OcelDoc
    );
    const receipt: OcelTapReceipt = {
      session: sessionId,
      source: this.source,
      ocel_file: `${sessionId}.jsonocel`,
      ocel_file_sha256: ocelFileSha256,
      event_count: doc.events.length,
      head_hash: head,
      // Exact subject and lease identity (ZCODE-26922-06): bound only when
      // the run carries them, so a receipt can never invent an identity.
      ...(this.identity.subjectCwd ? { subject_sha: subjectHead(this.identity.subjectCwd) } : {}),
      ...(this.identity.workOrderIri ? { work_order_iri: this.identity.workOrderIri } : {}),
      ...(this.identity.epochId ? { epoch_id: this.identity.epochId } : {}),
      ...(this.identity.baseSha ? { base_sha: this.identity.baseSha } : {}),
      // Replay binding is redacted before disk write — XAAS_REPLAY_BINDING
      // must not land secrets or PII next to the "redacted" OCEL log.
      ...(this.identity.replayBinding
        ? { replay_binding: this.redactor.redactData(this.identity.replayBinding) as Record<string, unknown> }
        : {}),
      chain_intact: ocelIntact,
      receipt_chain_intact: receiptIntact,
      unpaired: unpaired(chain),
      chain
    };
    atomicWrite(receiptPath, JSON.stringify(receipt, null, 2));
    return { sessionId, ocelPath, receiptPath, events: doc.events.length, head };
  }
}

function atomicWrite(path: string, text: string): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/** ex4pm receipt.schema.json projection of a chain entry. */
export function toEx4pmReceipt(entry: Entry): Record<string, unknown> {
  return {
    phase: entry.phase,
    subject_hash: sha256(entry.subject),
    operation: entry.action,
    hash: entry.hash,
    parent_hash: entry.parent_hash,
    standing: entry.standing
  };
}

/** Launcher entry: a recorder when ZCODE_OCEL=1 and the arguments produce a tappable stream. */
export function startOcelTap(args: readonly string[], env: NodeJS.ProcessEnv): OcelRecorder | undefined {
  if (!ocelEnabled(env)) return undefined;
  const source = ocelSourceForArgs(args);
  return source ? new OcelRecorder(source, ocelDirectory(env), leaseIdentityFromEnv(env)) : undefined;
}

/**
 * When ZCODE_OCEL=1 but the invocation is not tappable, return a one-line stderr warning.
 * Record-keeping must not fail closed into silence (EU AI Act Art.12 analog).
 */
export function ocelUntappableWarning(args: readonly string[], env: NodeJS.ProcessEnv): string | undefined {
  if (!ocelEnabled(env) || ocelSourceForArgs(args)) return undefined;
  if (isHeadlessPromptArgs(args)) {
    return "OCEL: ZCODE_OCEL=1 but --output-format stream-json is missing; tap disabled (no .jsonocel)\n";
  }
  return "OCEL: ZCODE_OCEL=1 but invocation is not tappable (need app-server or headless + --output-format stream-json); tap disabled\n";
}
