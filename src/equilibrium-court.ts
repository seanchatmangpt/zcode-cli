import { createHash } from "node:crypto";
import type { EvidenceAdmissionReceipt } from "./evidence-cli.ts";

export type Standing = "UNKNOWN" | "ADMITTED" | "REFUSED";

export interface EquilibriumObservation {
  repository_identity: string;
  base_sha: string;
  exact_subject: string;
  evidence_digest: string;
  provenance: string;
  falsifier_digest: string;
  authority: "none";
}

const sha = /^sha256:[0-9a-f]{64}$/u;
const commit = /^[0-9a-f]{40}$/u;
const repo = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const locator = /^[a-z][a-z0-9+.-]*:\/\/[^\s]+$/iu;

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  const r = value as Record<string, unknown>;
  return "{" + Object.keys(r).sort().map(k => JSON.stringify(k) + ":" + stable(r[k])).join(",") + "}";
}
export function digest(value: unknown): string {
  return "sha256:" + createHash("sha256").update(stable(value)).digest("hex");
}

export function admitObservation(o: EquilibriumObservation): Standing {
  if (!repo.test(o.repository_identity) || !commit.test(o.base_sha)) return "UNKNOWN";
  const prefix = o.repository_identity + "@" + o.base_sha + "#";
  if (!o.exact_subject.startsWith(prefix) || o.exact_subject.length === prefix.length) return "REFUSED";
  if (!sha.test(o.evidence_digest) || !sha.test(o.falsifier_digest)) return "UNKNOWN";
  if (!locator.test(o.provenance)) return "REFUSED";
  if (o.authority !== "none") return "REFUSED";
  return "ADMITTED";
}

export function replayReceipt(r: EvidenceAdmissionReceipt): Standing {
  const { receipt_digest, ...unsigned } = r;
  const prefix = r.repository_identity + "@" + r.base_sha + "#";
  if (!r.exact_subject.startsWith(prefix)) return "REFUSED";
  if (r.authority !== "none" || r.external_do_count !== 0) return "REFUSED";
  return digest(unsigned) === receipt_digest ? "ADMITTED" : "REFUSED";
}
