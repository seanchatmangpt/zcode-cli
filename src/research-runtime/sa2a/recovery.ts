import type { Sa2aReplanEnvelope, RecoveryDecision } from "./contract.js";

const UNKNOWN = new Set(["unknown", "unknown_outcome", "indeterminate"]);

export function recoveryDecision(envelope: Sa2aReplanEnvelope): RecoveryDecision {
  const outcome = envelope.outcome.toLowerCase();
  if (UNKNOWN.has(outcome)) return "reconcile";
  if (outcome === "success" || outcome === "completed") return "complete";
  if (outcome === "refused" || outcome === "terminal") return "refuse";
  return "retry";
}

export function withRecovery(envelope: Sa2aReplanEnvelope): Sa2aReplanEnvelope {
  return { ...envelope, recovery: recoveryDecision(envelope), authority: "none" };
}
