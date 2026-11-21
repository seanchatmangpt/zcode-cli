// Falsifiers for case-projected turn FSM (ocel-verify logging integrity).
// Global fold falsely rejects interleaved concurrent turns and accepts cross-turn theft;
// projection per `in_turn` is the required gate (EU AI Act Art.12-adjacent integrity).
import { describe, expect, test } from "bun:test";
import { deviationsByTurnCase, inTurnCaseId } from "../scripts/ocel-case-fsm.ts";
import type { OcelEvent } from "../src/generated/ocel.ts";

function ev(type: string, turnId: string | null, id = crypto.randomUUID()): OcelEvent {
  const relationships =
    turnId === null
      ? []
      : [
          { objectId: "sess_x", qualifier: "in_session" },
          { objectId: turnId, qualifier: "in_turn" },
        ];
  return {
    id,
    type,
    time: "2026-11-21T00:00:00.000Z",
    relationships,
    attributes: [],
  };
}

describe("ocel-case-fsm: in_turn case id", () => {
  test("reads the in_turn object id", () => {
    expect(inTurnCaseId(ev("turn_started", "turn_A"))).toBe("turn_A");
  });

  test("absent when no in_turn relationship", () => {
    expect(inTurnCaseId(ev("turn_started", null))).toBeUndefined();
  });
});

describe("ocel-case-fsm: case projection", () => {
  test("sequential turns on distinct cases: zero deviations", () => {
    const events = [
      ev("turn_started", "turn_A"),
      ev("turn_completed", "turn_A"),
      ev("turn_started", "turn_B"),
      ev("turn_completed", "turn_B"),
    ];
    expect(deviationsByTurnCase(events)).toBe(0);
  });

  test("interleaved concurrent turns: accepted (not false-rejected)", () => {
    // A start, B start, A complete, B complete — legal per case; global FSM would deviate.
    const events = [
      ev("turn_started", "turn_A"),
      ev("turn_started", "turn_B"),
      ev("turn_completed", "turn_A"),
      ev("turn_completed", "turn_B"),
    ];
    expect(deviationsByTurnCase(events)).toBe(0);
  });

  test("cross-turn completion theft: refused", () => {
    // B's completion spliced after A's start — global type fold would accept; case fold must refuse.
    const events = [ev("turn_started", "turn_A"), ev("turn_completed", "turn_B")];
    expect(deviationsByTurnCase(events)).toBeGreaterThan(0);
  });

  test("machine event missing in_turn: deviation", () => {
    expect(deviationsByTurnCase([ev("turn_started", null)])).toBe(1);
  });

  test("non-machine events are ignored", () => {
    const events = [
      ev("session_updated", "turn_A"),
      ev("turn_started", "turn_A"),
      ev("model_streaming", "turn_A"),
      ev("turn_completed", "turn_A"),
    ];
    expect(deviationsByTurnCase(events)).toBe(0);
  });

  test("illegal within a single case still counts", () => {
    expect(deviationsByTurnCase([ev("turn_completed", "turn_A")])).toBeGreaterThan(0);
  });
});
