import type { Sa2aReplanEnvelope } from "./contract.js";
import { canonicalSubject } from "./identity.js";
export type SubjectSnapshot = { subject: unknown; generation: number };
export function refuseStaleSubject(
  envelope: Sa2aReplanEnvelope,
  expected: SubjectSnapshot,
  observedGeneration: number,
): "admit" | "refuse_subject" | "refuse_generation" {
  if (canonicalSubject(envelope.subject) !== canonicalSubject(expected.subject)) return "refuse_subject";
  if (observedGeneration !== expected.generation) return "refuse_generation";
  return "admit";
}
