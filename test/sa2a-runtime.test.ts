import { describe, expect, test } from "bun:test";
import { SA2A_REPLAN_VERSION, runPortableRecoveryRuntime, type CandidateProvider } from "../src/research-runtime/sa2a/index.ts";
const base = { version: SA2A_REPLAN_VERSION, subject: { repo: "zcode-cli", task: "42" }, effectId: "effect-1", replayIdentity: "replay-1", outcome: "failed", recovery: "retry" as const, authority: "none" as const };
describe("SA2A portable recovery runtime", () => {
  test("composes admission, stale guard, provider selection, failover and reconciliation", async () => {
    const providers: CandidateProvider[] = [
      { id: "bad", authority: "none", propose: async () => ({ ...base, subject: { repo: "other" } }) },
      { id: "good", authority: "none", propose: async () => ({ ...base, outcome: "unknown_outcome" }) },
    ];
    const result = await runPortableRecoveryRuntime({ envelope: base, expectedSubject: { subject: { task: "42", repo: "zcode-cli" }, generation: 3 }, observedGeneration: 3, providers, maxAttempts: 2 });
    expect(result.providerId).toBe("good");
    expect(result.excluded).toEqual(["bad"]);
    expect(result.envelope.recovery).toBe("reconcile");
    expect(result.envelope.authority).toBe("none");
  });
});
