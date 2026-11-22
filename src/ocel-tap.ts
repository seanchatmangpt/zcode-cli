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
import { redactComplianceData } from "./compliance/redactor.ts";

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
 * (PI pack projects E2O only). This residue joins stream+gall dual logs by
 * binding work_order ↔ epoch ↔ subject ↔ base (and lease when present) without
 * rewriting event pi_hash (object graph is outside the event chain).
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

// Credential-shaped keys — aligned with CAPABILITY_SNAPSHOT.md /
// src/compliance/redactor.ts SECRET_KEY_RE (client_secret, *_api_key,
// authToken, private_key, passwd, cookie/set-cookie, …). Longer compound
// forms precede bare `token` so "refresh_token" / "session_token" match whole.
const SECRET_KEY_ALT =
  "(?:(?:[a-z0-9_-]+[-_])?api[-_]?key|(?:access|refresh|auth|id|session|bearer|oauth|csrf|api)[-_]?token|refreshtoken|token|(?:[a-z0-9_-]+[-_])?secret|password|passwd|pwd|private[-_]?key|authorization|set[-_]?cookie|cookie)";
const secretKeyRe = new RegExp(`^${SECRET_KEY_ALT}$`, "i");
// Matches secret keys inside STRING payloads that embed JSON, including the
// escaped forms (\", \\\") produced when a tool result quotes a config file.
const escapedSecretRe = new RegExp(
  `((?:\\\\{0,2}")(?:${SECRET_KEY_ALT})(?:\\\\{0,2})"\\s*:\\s*(?:\\\\{0,2})")((?:[^"\\\\]|\\\\.)*?)((?:\\\\{0,2})")`,
  "gi"
);
// Bearer is itself the credential marker anywhere in text. Short Bearers that
// carry a digit/symbol (≥3) or any ≥8-char token are scrubbed — matching the
// capability-snapshot / compliance redactor (skeptic: `Bearer abc1234`).
// Other schemes (Basic, Token, Digest, ApiKey) and raw keys are redacted only
// in an explicit Authorization header context, so ordinary prose ("the token
// bucket refills") survives.
const bearerRe =
  /(Bearer\s+)((?=[^\s"'\\]{8,})[^\s"'\\]+|(?=[^\s"'\\]*[0-9_.\-+/=])[^\s"'\\]{3,})/gi;
const authSchemeRe = /(authorization\s*[:=]\s*(?:basic|token|digest|apikey)\s+)\S{3,}/gi;
// Raw Authorization values: no ≥8 floor — capability-snapshot / compliance
// scrub any non-empty token after the header (skeptic: `authorization: abc1234`).
const authRawRe = /(authorization\s*[:=]\s*)(?!basic\s|token\s|digest\s|bearer\s|apikey\s)\S+/gi;
// Compact JWT + PEM private-key blocks (CAPABILITY_SNAPSHOT claims; skeptic
// falsifier: no eyJ… / BEGIN PRIVATE KEY handling in the tap).
const jwtRe = /\beyJ[A-Za-z0-9_-]{4,}\.e[A-Za-z0-9_-]{3,}\.[A-Za-z0-9_-]{4,}\b/g;
const pemPrivateKeyRe =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g;
// URL query/fragment credential params (B4 pre-fix, 2026-11-21): secrets in
// `?api_key=` / `#access_token=` / `?token=` never matched a JSON key shape.
const urlSecretParamRe = new RegExp(`([?&#](?:${SECRET_KEY_ALT})=)([^&#\\s"']+)`, "gi");
// URL userinfo password: scheme://user:password@host
const urlUserinfoRe = /(\/\/[^:/?#\s"']+:)([^@/?#\s"']+)(@)/g;

/** Under a secret-shaped key: scrub any non-empty credential value, including
 * numbers/booleans, array elements, and nested object leaves (skeptic: only
 * `typeof child === "string"` left `{"apiKey":["sk"],"password":12345}` intact). */
function redactSensitiveValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > 0 ? "REDACTED" : value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return "REDACTED";
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return value;
    return value.map((item) => redactSensitiveValue(item));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactSensitiveValue(v)])
    );
  }
  return value;
}

function redactNode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactNode);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        // Empty strings carry nothing to leak and stay honest ("no key set"
        // is not rewritten into a phantom "REDACTED").
        secretKeyRe.test(key) ? redactSensitiveValue(child) : redactNode(child)
      ])
    );
  }
  if (typeof value === "string") return redactEmbeddedSecrets(value);
  return value;
}

/** Scheme-shaped credentials, JWT/PEM, and URL-embedded secrets in free text:
 * Bearer anywhere; other Authorization schemes only behind an explicit header;
 * credential query/fragment params and userinfo passwords in URLs. */
function redactSchemes(text: string): string {
  return text
    .replace(pemPrivateKeyRe, "REDACTED")
    .replace(jwtRe, "REDACTED")
    .replace(bearerRe, "$1REDACTED")
    .replace(authSchemeRe, "$1REDACTED")
    .replace(authRawRe, "$1REDACTED")
    .replace(urlSecretParamRe, "$1REDACTED")
    .replace(urlUserinfoRe, "$1REDACTED$3");
}

function redactEmbeddedSecrets(text: string): string {
  let out = text;
  if (/[{[]/.test(text)) {
    try {
      const parsed = JSON.parse(text) as unknown;
      const redacted = redactNode(parsed);
      if (JSON.stringify(redacted) !== JSON.stringify(parsed)) out = JSON.stringify(redacted);
    } catch {
      // not JSON — the escaped-shape fallback below still applies
    }
  }
  out = out.replace(escapedSecretRe, "$1REDACTED$3");
  return redactSchemes(out);
}

/** Replaces credential-shaped values with REDACTED before they enter the event
 * chain: hashes are computed on redacted content, so no chain ever commits a
 * secret (leak-prevention tripwire, 2026-09-23). Handles plain JSON text and
 * raw lines containing escaped JSON. */
export function redactSecrets(text: string): string {
  try {
    const parsed = JSON.parse(text) as unknown;
    return JSON.stringify(redactNode(parsed));
  } catch {
    // fall through to shape-level redaction
  }
  let out = text.replace(escapedSecretRe, "$1REDACTED$3");
  return redactSchemes(out);
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
  private sessionId: string | undefined;
  private carry = "";
  private closed = false;
  /** Subject HEAD resolved at recorder open — stable E2O object id for the turn. */
  private readonly subjectSha: string | undefined;

  constructor(readonly source: string, private readonly dir: string, private readonly identity: LeaseIdentity = {}) {
    this.tap = new Tap(source);
    this.subjectSha = subjectHead(identity.subjectCwd);
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
    // (B4 pre-fix, 2026-11-21). Route through compliance redactor so GDPR PII,
    // JWTs, PEM keys (including truncated), env secrets, and credential keys
    // never enter the OCEL log or its SHA-256 pi_hash chain.
    const redacted = redactComplianceData(redactNode(normalizeRecord(record)));
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
    mkdirSync(this.dir, { recursive: true });
    const ocelPath = join(this.dir, `${sessionId}.jsonocel`);
    const receiptPath = join(this.dir, `${sessionId}.receipt.json`);
    atomicWrite(ocelPath, ocelText);

    // OCEL pi_hash integrity — the process-intelligence tripwire. Distinct
    // from the receipt ALOOP seal (`receipt_chain_intact`); never conflate
    // the two (skeptic: chain_intact was a false witness for pi_hash).
    const ocelIntact = verifyChain(doc as OcelDoc, this.tap.spec.hash) === null && doc.events.length > 0;
    const chain: Chain = [];
    appendPending(chain, `${sessionId}-e1`, sessionId, "record-ocel");
    appendOutcome(chain, `${sessionId}-e2`, ocelIntact ? "alive" : "blocked", sessionId, "record-ocel");
    seal(chain, `${sessionId}-e3`, ocelIntact ? "alive" : "blocked", sessionId);
    const receiptIntact = verify(chain);
    const receipt: OcelTapReceipt = {
      session: sessionId,
      source: this.source,
      ocel_file: `${sessionId}.jsonocel`,
      ocel_file_sha256: sha256(ocelText),
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
        ? { replay_binding: redactComplianceData(redactNode(this.identity.replayBinding)) as Record<string, unknown> }
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
