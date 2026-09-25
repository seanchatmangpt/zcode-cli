// Launcher-level OCEL 2.0 tap for the zcode runtime (residue: UNSUPPORTED generator-capability, see
// HANDWRITTEN.md). It consumes the runtime's own output -- `-p --output-format stream-json` lines or
// `app-server` notifications -- and feeds them to the ontology-generated tap in ./generated/ocel.ts.
// Nothing here knows an event type: mapping, hashing and receipts come from the generated modules.
// Gated by ZCODE_OCEL=1; output directory ZCODE_OCEL_DIR (default ~/.zcode/ocel).
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

import { Tap, verifyChain, type OcelDoc } from "./generated/ocel.ts";
import { appendOutcome, appendPending, seal, unpaired, verify, type Chain, type Entry } from "./generated/receipt.ts";

export const STREAM_SOURCE = "zcode_stream";
export const APP_SERVER_SOURCE = "zcode_app_server";

export function ocelEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.ZCODE_OCEL === "1";
}

export function ocelDirectory(env: NodeJS.ProcessEnv): string {
  return env.ZCODE_OCEL_DIR?.trim() || join(homedir(), ".zcode", "ocel");
}

/** Which source (if any) the given runtime arguments produce events for. */
export function ocelSourceForArgs(args: readonly string[]): string | undefined {
  if (args[0] === "app-server") return APP_SERVER_SOURCE;
  const print = args.includes("-p") || args.includes("--print");
  const idx = args.findIndex((a) => a === "--output-format" || a.startsWith("--output-format="));
  if (idx < 0) return undefined;
  const value = args[idx].includes("=") ? args[idx].split("=")[1] : args[idx + 1];
  return print && value === "stream-json" ? STREAM_SOURCE : undefined;
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
    baseSha: trim(env.XAAS_BASE_SHA)
  };
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

const sha256 = (data: string): string => createHash("sha256").update(data, "utf8").digest("hex");

export function sessionOf(record: unknown): string | undefined {
  if (record === null || typeof record !== "object") return undefined;
  const r = record as Record<string, unknown>;
  const p = (r.params ?? {}) as Record<string, unknown>;
  const v = r.sessionId ?? p.sessionId;
  return typeof v === "string" ? v : undefined;
}

const secretKeyRe = /^(apiKey|api_key|token|secret|password|authorization|access_token|refresh_token|refreshtoken)$/i;
// Matches secret keys inside STRING payloads that embed JSON, including the
// escaped forms (\", \\\") produced when a tool result quotes a config file.
// Longer underscored forms precede `token` so "refresh_token" matches whole.
const escapedSecretRe = /((?:\\{0,2}")(?:apiKey|api_key|refresh_token|access_token|token|secret|password|authorization)(?:\\{0,2})"\s*:\s*(?:\\{0,2}"))((?:[^"\\]|\\.)*?)((?:\\{0,2}"))/g;
// Bearer is itself the credential marker anywhere in text. Other schemes
// (Basic, Token, digest) and raw keys are redacted only in an explicit
// Authorization header context, so ordinary prose ("the token bucket
// refills") survives. Pre-fix falsifiers (2026-09-24): a 7-char apiKey,
// an underscored refresh_token, and "Authorization: Basic abc123" all
// passed through unredacted.
const bearerRe = /(Bearer\s+)\S{8,}/gi;
const authSchemeRe = /(authorization\s*[:=]\s*(?:basic|token|digest)\s+)\S{3,}/gi;
const authRawRe = /(authorization\s*[:=]\s*)(?!basic\s|token\s|digest\s|bearer\s)\S{8,}/gi;

function redactNode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactNode);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        // Any non-empty credential-shaped value is redacted: the old >= 8
        // floor let 1-7 char secrets pass through (falsified 2026-09-24).
        // Empty strings carry nothing to leak and stay honest ("no key set"
        // is not rewritten into a phantom "REDACTED").
        secretKeyRe.test(key) && typeof child === "string" && child.length > 0 ? "REDACTED" : redactNode(child)
      ])
    );
  }
  if (typeof value === "string") return redactEmbeddedSecrets(value);
  return value;
}

/** Scheme-shaped credentials in free text: Bearer anywhere, other schemes
 * and raw keys only behind an explicit Authorization header. */
function redactSchemes(text: string): string {
  return text
    .replace(bearerRe, "$1REDACTED")
    .replace(authSchemeRe, "$1REDACTED")
    .replace(authRawRe, "$1REDACTED");
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

export class OcelRecorder {
  private readonly tap: Tap;
  private sessionId: string | undefined;
  private carry = "";
  private closed = false;

  constructor(readonly source: string, private readonly dir: string, private readonly identity: LeaseIdentity = {}) {
    this.tap = new Tap(source);
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
    this.sessionId ??= sessionOf(record);
    const redacted = redactNode(normalizeRecord(record));
    if (this.tap.spec.kind === "stream-json") this.tap.ingest(JSON.stringify(redacted));
    else this.tap.ingest(redacted as object);
  }

  /** Seal the tap once, write <session>.jsonocel and <session>.receipt.json. */
  finish(): OcelResult {
    if (this.closed) throw new Error("recorder already finished");
    if (this.carry.trim() !== "") this.feedLine(this.carry);
    this.carry = "";
    this.closed = true;
    const sessionId = this.sessionId ?? `unknown-${Date.now()}`;
    const doc = this.tap.toOcel();
    const head = this.tap.seal();
    const ocelText = JSON.stringify(doc);
    mkdirSync(this.dir, { recursive: true });
    const ocelPath = join(this.dir, `${sessionId}.jsonocel`);
    const receiptPath = join(this.dir, `${sessionId}.receipt.json`);
    atomicWrite(ocelPath, ocelText);

    const intact = verifyChain(doc as OcelDoc, this.tap.spec.hash) === null && doc.events.length > 0;
    const chain: Chain = [];
    appendPending(chain, `${sessionId}-e1`, sessionId, "record-ocel");
    appendOutcome(chain, `${sessionId}-e2`, intact ? "alive" : "blocked", sessionId, "record-ocel");
    seal(chain, `${sessionId}-e3`, intact ? "alive" : "blocked", sessionId);
    const receipt = {
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
      chain_intact: verify(chain),
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
