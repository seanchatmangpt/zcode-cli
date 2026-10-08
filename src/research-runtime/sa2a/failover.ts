import type { Sa2aReplanEnvelope } from "./contract.js";
import { canonicalSubject } from "./identity.js";
import type { CandidateProvider } from "./provider.js";
export interface FailoverResult { envelope: Sa2aReplanEnvelope; providerId: string; excluded: readonly string[] }
export async function proposeWithFailover(
  input: Sa2aReplanEnvelope,
  providers: readonly CandidateProvider[],
  maxAttempts = providers.length,
): Promise<FailoverResult> {
  const excluded: string[] = [];
  const attempts = Math.max(0, Math.floor(maxAttempts));
  for (const provider of providers) {
    if (excluded.length >= attempts) break;
    try {
      const candidate = await provider.propose(input);
      if (candidate.authority !== "none") throw new Error("SA2A_CANDIDATE_AUTHORITY_REFUSED");
      if (canonicalSubject(candidate.subject) !== canonicalSubject(input.subject)) throw new Error("SA2A_SUBJECT_DRIFT");
      if (candidate.effectId !== input.effectId || candidate.replayIdentity !== input.replayIdentity) throw new Error("SA2A_IDENTITY_DRIFT");
      return { envelope: { ...candidate, provider: provider.id, authority: "none" }, providerId: provider.id, excluded };
    } catch {
      excluded.push(provider.id);
    }
  }
  throw new Error(`SA2A_PROVIDERS_EXHAUSTED:${excluded.join(",")}`);
}
