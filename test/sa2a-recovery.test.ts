import { describe, expect, test } from "bun:test";
import { SA2A_REPLAN_VERSION, reconcileOutcome } from "../src/research-runtime/sa2a/index.ts";
const base = { version: SA2A_REPLAN_VERSION, subject: "job:1", effectId: "effect-1", replayIdentity: "replay-1", outcome: "unknown_outcome", recovery: "retry" as const, authority: "none" as const };
describe("SA2A outcome reconciliation", () => {
  test("unknown outcome never becomes blind retry", () => expect(reconcileOutcome(base).recovery).toBe("reconcile"));
  test("completed outcome closes", () => expect(reconcileOutcome({ ...base, outcome: "completed" }).recovery).toBe("complete"));
});
