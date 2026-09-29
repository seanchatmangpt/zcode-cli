import type { Sa2aReplanEnvelope } from "./contract.js";
import type { CandidateProvider } from "./provider.js";

export interface FailoverResult {
  envelope: Sa2aReplanEnvelope;
  providerId: string;
  excluded: readonly string[];
}

export async function proposeWithFailover(
  input: Sa2aReplanEnvelope,
  providers: readonly CandidateProvider[],
  maxAttempts = providers.length,
): Promise<FailoverResult> {
  const excluded: string[] = [];
  for (const provider of providers.slice(0, Math.max(0, maxAttempts))) {
    try {
      const candidate = await provider.propose(input);
      if (candidate.authority !== "none") throw new Error("SA2A_CANDIDATE_AUTHORITY_REFUSED");
      if (candidate.effectId !== input.effectId || candidate.replayIdentity !== input.replayIdentity) {
        throw new Error("SA2A_IDENTITY_DRIFT");
      }
      return { envelope: { ...candidate, provider: provider.id }, providerId: provider.id, excluded };
    } catch {
      excluded.push(provider.id);
    }
  }
  throw new Error(`SA2A_PROVIDERS_EXHAUSTED:${excluded.join(",")}`);
}
