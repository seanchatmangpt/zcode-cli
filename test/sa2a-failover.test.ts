import { describe, expect, test } from "bun:test";
import { SA2A_REPLAN_VERSION, proposeWithFailover, type CandidateProvider, type Sa2aReplanEnvelope } from "../src/research-runtime/sa2a/index.ts";
const input: Sa2aReplanEnvelope = { version: SA2A_REPLAN_VERSION, subject: { repo: "zcode-cli", id: 1 }, effectId: "effect-1", replayIdentity: "replay-1", outcome: "failed", recovery: "retry", authority: "none" };
const provider = (id: string, propose: CandidateProvider["propose"]): CandidateProvider => ({ id, authority: "none", propose });
describe("SA2A provider failover", () => {
  test("isolates provider error and subject drift then admits next lawful provider", async () => {
    const result = await proposeWithFailover(input, [
      provider("error", async () => { throw new Error("provider down"); }),
      provider("drift", async () => ({ ...input, subject: { repo: "other" } })),
      provider("good", async () => ({ ...input, outcome: "completed" })),
    ], 3);
    expect(result.providerId).toBe("good");
    expect(result.excluded).toEqual(["error", "drift"]);
    expect(result.envelope.authority).toBe("none");
    expect(result.envelope.subject).toEqual(input.subject);
  });
});
