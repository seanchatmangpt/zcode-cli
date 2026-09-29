import type { CandidateProvider } from "./provider.js";
import { providerIsSelectable, type ProviderHealthState } from "./provider-health.js";
export function selectCandidateProviders(
  providers: readonly CandidateProvider[],
  health: ReadonlyMap<string, ProviderHealthState> = new Map(),
  excluded: ReadonlySet<string> = new Set(),
): CandidateProvider[] {
  return providers.filter((provider) => provider.authority === "none" && !excluded.has(provider.id) && providerIsSelectable(provider.id, health));
}
