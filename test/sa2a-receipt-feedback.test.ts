import { describe, expect, test } from "bun:test";
import { SA2A_REPLAN_VERSION, applyReceiptFeedback, type Sa2aReplanEnvelope } from "../src/research-runtime/sa2a/index.ts";
const envelope: Sa2aReplanEnvelope = { version: SA2A_REPLAN_VERSION, subject: { repo: "zcode-cli", task: "42" }, effectId: "effect-1", replayIdentity: "replay-1", outcome: "pending", recovery: "retry", authority: "none" };
describe("SA2A receipt feedback", () => {
  test("projects unknown receipt into reconciliation without authority", () => {
    const next = applyReceiptFeedback(envelope, { subject: { task: "42", repo: "zcode-cli" }, effectId: "effect-1", replayIdentity: "replay-1", outcome: "unknown_outcome", authority: "none", provider: "wasm4pm" });
    expect(next.recovery).toBe("reconcile");
    expect(next.authority).toBe("none");
    expect(next.provider).toBe("wasm4pm");
  });
  test("refuses cross-subject receipt reuse", () => expect(() => applyReceiptFeedback(envelope, { subject: { repo: "other" }, effectId: "effect-1", replayIdentity: "replay-1", outcome: "completed", authority: "none" })).toThrow("SA2A_RECEIPT_SUBJECT_DRIFT"));
});
