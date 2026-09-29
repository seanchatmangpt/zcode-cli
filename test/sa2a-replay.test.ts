import { describe, expect, test } from "bun:test";
import { SA2A_REPLAN_VERSION, assertReplayStable, type Sa2aReplanEnvelope } from "../src/research-runtime/sa2a/index.ts";
const base: Sa2aReplanEnvelope = { version: SA2A_REPLAN_VERSION, subject: { repo: "zcode-cli" }, effectId: "effect-1", replayIdentity: "replay-1", outcome: "failed", recovery: "retry", authority: "none" };
describe("SA2A replay identity", () => {
  test("accepts outcome evolution without identity drift", () => expect(() => assertReplayStable(base, { ...base, outcome: "completed" })).not.toThrow());
  test("refuses replay identity drift", () => expect(() => assertReplayStable(base, { ...base, replayIdentity: "replay-2" })).toThrow("SA2A_REPLAY_IDENTITY_DRIFT"));
});
