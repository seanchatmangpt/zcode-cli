export const SA2A_REPLAN_VERSION = "sa2a/replan-envelope/v1" as const;

export type RecoveryDecision = "retry" | "reconcile" | "refuse" | "complete";

export interface Sa2aReplanEnvelope {
  version: typeof SA2A_REPLAN_VERSION;
  subject: unknown;
  effectId: string;
  replayIdentity: string;
  outcome: string;
  recovery: RecoveryDecision;
  authority: "none";
  provider?: string;
  attempt?: number;
}

const RECOVERY_DECISIONS = new Set<RecoveryDecision>([
  "retry",
  "reconcile",
  "refuse",
  "complete",
]);

export const isSa2aEnvelope = (value: unknown): value is Sa2aReplanEnvelope => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;

  return (
    candidate.version === SA2A_REPLAN_VERSION &&
    candidate.subject !== undefined &&
    typeof candidate.effectId === "string" &&
    typeof candidate.replayIdentity === "string" &&
    typeof candidate.outcome === "string" &&
    RECOVERY_DECISIONS.has(candidate.recovery as RecoveryDecision) &&
    candidate.authority === "none"
  );
};
