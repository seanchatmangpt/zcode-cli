// Generated hash-chained receipt: append / verify / seal. Policy from es:ChainPolicy.
import { createHash } from "node:crypto";

export const ALGORITHM = "sha256";
export const GENESIS = "0000000000000000000000000000000000000000000000000000000000000000";
export const FIELDS = ["entry_id", "parent_hash", "phase", "standing", "subject", "action", ] as const;
export const PHASES = ["pending", "outcome", ] as const;
export const STANDINGS = ["alive", "blocked", "build_broken", "partial_alive", "unknown", "unsupported", ] as const;
const PENDING = PHASES[0];
const OUTCOME = PHASES[PHASES.length - 1];

export interface Entry { entry_id: string; parent_hash: string; phase: string; standing: string; subject: string; action: string; hash: string; seal?: boolean }
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

function make(chain: Chain, entry_id: string, phase: string, standing: string, subject: string, action: string): Entry {
  if (!(PHASES as readonly string[]).includes(phase) || !(STANDINGS as readonly string[]).includes(standing)) throw new Error("bad phase/standing");
  const e = { entry_id, parent_hash: chain.length ? chain[chain.length - 1].hash : GENESIS, phase, standing, subject, action, hash: "" };
  e.hash = digest(canonical(e));
  return e;
}

export const isSealed = (chain: Chain): boolean => chain.some((e) => e.seal);

export function append(chain: Chain, entry_id: string, phase: string, standing: string, subject: string, action: string): Entry {
  if (isSealed(chain)) throw new Error("chain sealed");
  if (phase === OUTCOME && !chain.some((e) => e.phase === PENDING && e.action === action)) throw new Error("outcome without pending");
  const e = make(chain, entry_id, phase, standing, subject, action);
  chain.push(e);
  return e;
}

export function seal(chain: Chain, entry_id: string, standing: string, subject: string): Entry {
  if (isSealed(chain)) throw new Error("chain already sealed");
  const e = make(chain, entry_id, OUTCOME, standing, subject, "seal");
  e.seal = true;
  chain.push(e);
  return e;
}

export function verify(chain: Chain): boolean {
  let prev = GENESIS;
  let seals = 0;
  for (const e of chain) {
    if (e.parent_hash !== prev || e.hash !== digest(canonical(e as unknown as Record<string, unknown>))) return false;
    if (e.seal) seals++;
    prev = e.hash;
  }
  return seals <= 1 && (seals === 0 || !!chain[chain.length - 1].seal);
}

