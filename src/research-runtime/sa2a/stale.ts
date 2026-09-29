import type { ReplanEnvelope } from "./contract";

export type SubjectSnapshot = { subject: string; generation: number };

export function refuseStaleSubject(
  envelope: ReplanEnvelope,
  expected: SubjectSnapshot,
  observedGeneration: number,
): "admit" | "refuse_subject" | "refuse_generation" {
  if (envelope.subject !== expected.subject) return "refuse_subject";
  if (observedGeneration !== expected.generation) return "refuse_generation";
  return "admit";
}
