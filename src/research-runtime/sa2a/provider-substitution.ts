import type { CandidateProvider } from "./provider";
import type { ReplanEnvelope } from "./contract";

export async function substituteProvider(
  providers: readonly CandidateProvider[],
  envelope: ReplanEnvelope,
): Promise<ReplanEnvelope> {
  for (const provider of providers) {
    const candidate = await provider.propose(envelope);
    if (
      candidate.subject === envelope.subject &&
      candidate.effectId === envelope.effectId &&
      candidate.replayId === envelope.replayId &&
      candidate.authority === "none"
    ) return candidate;
  }
  return { ...envelope, decision: "reconcile" };
}
