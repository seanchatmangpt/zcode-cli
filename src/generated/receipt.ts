// Generated hash-chained receipt: append / verify / seal. Policy from es:ChainPolicy.
import { createHash } from "node:crypto";

export const ALGORITHM = "sha256";
export const GENESIS = "0000000000000000000000000000000000000000000000000000000000000000";
export const FIELDS = ["entry_id", "parent_hash", "phase", "standing", "subject", "action", "pending_ref", ] as const;
export const PHASES = ["pending", "outcome", ] as const;
export const STANDINGS = ["alive", "blocked", "build_broken", "partial_alive", "unknown", "unsupported", ] as const;
export const NEUTRAL = "unknown";
const PENDING = PHASES[0];
const OUTCOME = PHASES[PHASES.length - 1];

export interface Entry { entry_id: string; parent_hash: string; phase: string; standing: string; subject: string; action: string; pending_ref: string; hash: string; seal?: boolean }
export type Chain = Entry[];

export function digest(text: string): string {
  if (ALGORITHM !== "sha256" && ALGORITHM !== "sha512") throw new Error("unsupported algorithm " + ALGORITHM);
  return createHash(ALGORITHM).update(text, "utf8").digest("hex");
}

export function canonical(e: Record<string, unknown>): string {
  return FIELDS.map((f) => {
    const v = String(e[f]);
    if (v.includes("\n")) throw new Error("LF in field " + f);
    return f + "=" + v;
  }).join("\n");
}

function make(chain: Chain, entry_id: string, phase: string, standing: string, subject: string, action: string, pending_ref = ""): Entry {
  if (!(PHASES as readonly string[]).includes(phase) || !(STANDINGS as readonly string[]).includes(standing)) throw new Error("bad phase/standing");
  const e = { entry_id, parent_hash: chain.length ? chain[chain.length - 1].hash : GENESIS, phase, standing, subject, action, pending_ref, hash: "" };
  e.hash = digest(canonical(e));
  return e;
}

export const isSealed = (chain: Chain): boolean => chain.some((e) => e.seal);

const paired = (chain: Chain): Set<string> => new Set(chain.filter((e) => e.phase === OUTCOME && e.pending_ref).map((e) => e.pending_ref));

/** entry_ids of pending entries no outcome has closed yet. */
export function unpaired(chain: Chain): string[] {
  const p = paired(chain);
  return chain.filter((e) => e.phase === PENDING && !p.has(e.hash)).map((e) => e.entry_id);
}

export function appendPending(chain: Chain, entry_id: string, subject: string, action: string): Entry {
  if (isSealed(chain)) throw new Error("chain sealed");
  const e = make(chain, entry_id, PENDING, NEUTRAL, subject, action);
  chain.push(e);
  return e;
}

export function appendOutcome(chain: Chain, entry_id: string, standing: string, subject: string, action: string): Entry {
  if (isSealed(chain)) throw new Error("chain sealed");
  const p = paired(chain);
  const open = chain.find((e) => e.phase === PENDING && e.action === action && !p.has(e.hash));
  if (!open) throw new Error("outcome without pending");
  const e = make(chain, entry_id, OUTCOME, standing, subject, action, open.hash);
  chain.push(e);
  return e;
}

export function seal(chain: Chain, entry_id: string, standing: string, subject: string): Entry {
  if (isSealed(chain)) throw new Error("chain already sealed");
  if (unpaired(chain).length) throw new Error("seal with unpaired pending");
  const e = make(chain, entry_id, OUTCOME, standing, subject, "seal");
  e.seal = true;
  chain.push(e);
  return e;
}

export function verify(chain: Chain): boolean {
  let prev = GENESIS;
  let seals = 0;
  const seen = new Map<string, Entry>();
  const used = new Set<string>();
  for (const e of chain) {
    if (e.parent_hash !== prev || e.hash !== digest(canonical(e as unknown as Record<string, unknown>))) return false;
    if (e.phase === PENDING) {
      if (e.standing !== NEUTRAL || e.pending_ref !== "") return false;
      seen.set(e.hash, e);
    } else if (e.seal) {
      if (e.pending_ref !== "" || [...seen.keys()].some((h) => !used.has(h))) return false;
      seals++;
    } else {
      const p = seen.get(e.pending_ref);
      if (!p || p.action !== e.action || used.has(e.pending_ref)) return false;
      used.add(e.pending_ref);
    }
    prev = e.hash;
  }
  return seals <= 1 && (seals === 0 || !!chain[chain.length - 1].seal);
}

