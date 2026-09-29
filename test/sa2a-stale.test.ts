import { describe, expect, test } from "bun:test";
import { SA2A_REPLAN_VERSION, refuseStaleSubject, type Sa2aReplanEnvelope } from "../src/research-runtime/sa2a/index.ts";
const envelope: Sa2aReplanEnvelope = { version: SA2A_REPLAN_VERSION, subject: { task: "42", repo: "zcode-cli" }, effectId: "effect-1", replayIdentity: "replay-1", outcome: "failed", recovery: "retry", authority: "none" };
describe("SA2A stale-plan guard", () => {
  test("admits equivalent exact subject at current generation", () => expect(refuseStaleSubject(envelope, { subject: { repo: "zcode-cli", task: "42" }, generation: 7 }, 7)).toBe("admit"));
  test("refuses subject and generation drift", () => {
    expect(refuseStaleSubject(envelope, { subject: "other", generation: 7 }, 7)).toBe("refuse_subject");
    expect(refuseStaleSubject(envelope, { subject: envelope.subject, generation: 7 }, 8)).toBe("refuse_generation");
  });
});
