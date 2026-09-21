// Launcher-level OCEL 2.0 tap for the zcode runtime (residue: UNSUPPORTED generator-capability, see
// HANDWRITTEN.md). It consumes the runtime's own output -- `-p --output-format stream-json` lines or
// `app-server` notifications -- and feeds them to the ontology-generated tap in ./generated/ocel.ts.
// Nothing here knows an event type: mapping, hashing and receipts come from the generated modules.
// Gated by ZCODE_OCEL=1; output directory ZCODE_OCEL_DIR (default ~/.zcode/ocel).
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { Tap, verifyChain, type OcelDoc } from "./generated/ocel.ts";
import { append, seal, verify, type Chain, type Entry } from "./generated/receipt.ts";

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

export class OcelRecorder {
  private readonly tap: Tap;
  private sessionId: string | undefined;
  private carry = "";
  private closed = false;

  constructor(readonly source: string, private readonly dir: string) {
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
    const norm = normalizeRecord(record);
    if (this.tap.spec.kind === "stream-json") this.tap.ingest(JSON.stringify(norm));
    else this.tap.ingest(norm as object);
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
    append(chain, `${sessionId}-e1`, "pending", "unknown", sessionId, "record-ocel");
    append(chain, `${sessionId}-e2`, "outcome", intact ? "alive" : "blocked", sessionId, "record-ocel");
    seal(chain, `${sessionId}-e3`, intact ? "alive" : "blocked", sessionId);
    const receipt = {
      session: sessionId,
      source: this.source,
      ocel_file: `${sessionId}.jsonocel`,
      ocel_file_sha256: sha256(ocelText),
      event_count: doc.events.length,
      head_hash: head,
      chain_intact: verify(chain),
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
  return source ? new OcelRecorder(source, ocelDirectory(env)) : undefined;
}
