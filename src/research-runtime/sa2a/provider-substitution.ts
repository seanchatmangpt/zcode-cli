import type { Sa2aReplanEnvelope } from "./contract.js";
import type { CandidateProvider } from "./provider.js";
import { assertReplayStable } from "./replay.js";
export async function substituteProvider(
  providers: readonly CandidateProvider[],
  envelope: Sa2aReplanEnvelope,
): Promise<Sa2aReplanEnvelope> {
  for (const provider of providers) {
    try {
      const candidate = await provider.propose(envelope);
      if (candidate.authority !== "none") continue;
      assertReplayStable(envelope, candidate);
      return { ...candidate, provider: provider.id, authority: "none" };
    } catch {
      continue;
    }
  }
  return { ...envelope, recovery: "reconcile", authority: "none" };
}
