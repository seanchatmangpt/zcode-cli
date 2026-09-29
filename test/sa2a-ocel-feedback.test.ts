import { describe, expect, test } from "bun:test";
import { SA2A_REPLAN_VERSION, toOcelRecoveryEvent, type Sa2aReplanEnvelope } from "../src/research-runtime/sa2a/index.ts";
describe("SA2A OCEL feedback", () => {
  test("projects recovery evidence without DO authority", () => {
    const envelope: Sa2aReplanEnvelope = { version: SA2A_REPLAN_VERSION, subject: "job:1", effectId: "effect-1", replayIdentity: "replay-1", outcome: "unknown_outcome", recovery: "reconcile", authority: "none", provider: "wasm4pm" };
    expect(toOcelRecoveryEvent(envelope)).toEqual({ type: "sa2a.recovery", effectId: "effect-1", replayIdentity: "replay-1", provider: "wasm4pm", outcome: "unknown_outcome", recovery: "reconcile", authority: "none" });
  });
});
