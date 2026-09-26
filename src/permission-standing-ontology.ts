import { createHash } from "node:crypto";

const requiredTerms = [
  "zps:UNKNOWN", "zps:REFUSED", "zps:ADMITTED", "zps:ExactSubject",
  "zps:IndependentObservation", "zps:CONSTRUCT", "zps:CrossRepositoryEvidence",
  "zps:StaleOrCrossSubjectSha", "zps:SelfAttestation", "zps:AuthorityLaundering",
  "zps:ModeNotUniquelyBound", "zps:ModeNotYolo", "zps:ArgvObservationDivergence",
  "zps:ReceiptReplayDivergence", "zps:ReplayRule"
] as const;

export function admitPermissionStandingOntology(ttl: string): {
  admitted: boolean;
  missing: string[];
  policyDigest: string;
} {
  const missing = requiredTerms.filter((term) => !ttl.includes(term));
  return {
    admitted: missing.length === 0,
    missing: [...missing],
    policyDigest: `sha256:${createHash("sha256").update(ttl).digest("hex")}`
  };
}
