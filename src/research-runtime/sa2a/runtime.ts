import { admitPortable } from "./admission.js";
import type { Sa2aReplanEnvelope } from "./contract.js";
import { proposeWithFailover, type FailoverResult } from "./failover.js";
import type { ProviderHealthState } from "./provider-health.js";
import { selectCandidateProviders } from "./provider-selection.js";
import type { CandidateProvider } from "./provider.js";
import { reconcileOutcome } from "./reconciliation.js";
import { refuseStaleSubject, type SubjectSnapshot } from "./stale.js";
export interface PortableRecoveryRuntimeInput {
  envelope: unknown;
  expectedSubject: SubjectSnapshot;
  observedGeneration: number;
  providers: readonly CandidateProvider[];
  providerHealth?: ReadonlyMap<string, ProviderHealthState>;
  excludedProviders?: ReadonlySet<string>;
  maxAttempts?: number;
}
export interface PortableRecoveryRuntimeResult extends FailoverResult { envelope: Sa2aReplanEnvelope }
export async function runPortableRecoveryRuntime(input: PortableRecoveryRuntimeInput): Promise<PortableRecoveryRuntimeResult> {
  const admitted = admitPortable(input.envelope);
  if (!admitted.ok) throw new Error(admitted.reason);
  const stale = refuseStaleSubject(admitted.value, input.expectedSubject, input.observedGeneration);
  if (stale !== "admit") throw new Error(`SA2A_STALE_REFUSED:${stale}`);
  const providers = selectCandidateProviders(input.providers, input.providerHealth, input.excludedProviders);
  const result = await proposeWithFailover(admitted.value, providers, input.maxAttempts ?? providers.length);
  return { ...result, envelope: reconcileOutcome(result.envelope) };
}
