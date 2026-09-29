import { describe, expect, test } from "bun:test";
import { SA2A_REPLAN_VERSION, admitPortable } from "../src/research-runtime/sa2a/index.ts";
const envelope = { version: SA2A_REPLAN_VERSION, subject: { repo: "zcode-cli", task: "42" }, effectId: "effect-1", replayIdentity: "replay-1", outcome: "unknown_outcome", recovery: "reconcile" as const, authority: "none" as const };
describe("SA2A portable admission", () => {
  test("admits authority-free exact envelope", () => expect(admitPortable(envelope)).toEqual({ ok: true, value: envelope }));
  test("refuses authority escalation", () => expect(admitPortable({ ...envelope, authority: "do" })).toEqual({ ok: false, reason: "SA2A_ENVELOPE_REFUSED" }));
});
