export type ProviderHealth = "healthy" | "excluded" | "unknown";
export interface ProviderHealthState { provider: string; health: ProviderHealth; failures: number; lastOutcome?: string }
const BAD_OUTCOMES = new Set(["unknown", "unknown_outcome", "indeterminate", "failed"]);
export const recordProviderOutcome = (state: ProviderHealthState, outcome: string): ProviderHealthState => {
  const bad = BAD_OUTCOMES.has(outcome.toLowerCase());
  return { ...state, lastOutcome: outcome, failures: state.failures + (bad ? 1 : 0), health: bad ? "excluded" : "healthy" };
};
export const providerIsSelectable = (providerId: string, health: ReadonlyMap<string, ProviderHealthState>): boolean =>
  health.get(providerId)?.health !== "excluded";
