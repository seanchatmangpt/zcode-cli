import { describe, expect, test } from "bun:test";
import { SA2A_REPLAN_VERSION, substituteProvider, type CandidateProvider, type Sa2aReplanEnvelope } from "../src/research-runtime/sa2a/index.ts";
const envelope: Sa2aReplanEnvelope = { version: SA2A_REPLAN_VERSION, subject: { repo: "zcode-cli" }, effectId: "effect-1", replayIdentity: "replay-1", outcome: "failed", recovery: "retry", authority: "none" };
describe("SA2A provider substitution", () => {
  test("routes around provider error and tags the successful provider", async () => {
    const providers: CandidateProvider[] = [
      { id: "down", authority: "none", propose: async () => { throw new Error("down"); } },
      { id: "healthy", authority: "none", propose: async (input) => ({ ...input, outcome: "completed" }) },
    ];
    const next = await substituteProvider(providers, envelope);
    expect(next.provider).toBe("healthy");
    expect(next.authority).toBe("none");
  });
  test("exhaustion reconciles rather than inventing success", async () => {
    const next = await substituteProvider([], envelope);
    expect(next.recovery).toBe("reconcile");
    expect(next.authority).toBe("none");
  });
});
