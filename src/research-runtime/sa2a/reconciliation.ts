import type { Sa2aReplanEnvelope } from "./contract.js";
import { withRecovery } from "./recovery.js";
const UNKNOWN_OUTCOMES = new Set(["unknown", "unknown_outcome", "indeterminate"]);
export function reconcileOutcome(envelope: Sa2aReplanEnvelope): Sa2aReplanEnvelope {
  if (UNKNOWN_OUTCOMES.has(envelope.outcome.toLowerCase())) return { ...envelope, recovery: "reconcile", authority: "none" };
  return withRecovery(envelope);
}
