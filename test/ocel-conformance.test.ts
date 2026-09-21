// Conformance: replay recorded OCEL logs through the ggen-generated st: transition table.
import { describe, expect, test } from "bun:test";

import { EVENT_TYPES, type OcelDoc } from "../src/generated/ocel.ts";
import { ZcodeTurnInitial, ZcodeTurnState, ZcodeTurnTransitions, replayZcodeTurn, stepZcodeTurn } from "../src/generated/loop.ts";
import { OcelRecorder, STREAM_SOURCE } from "../src/ocel-tap.ts";
import { fixtures } from "./support/ocel.ts";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const machineNames = new Set(ZcodeTurnTransitions.map((t) => t.name));

function ocelOf(lines: string[]): OcelDoc {
  const dir = mkdtempSync(join(tmpdir(), "zcode-conf-"));
  try {
    const rec = new OcelRecorder(STREAM_SOURCE, dir);
    rec.write(lines.join("\n") + "\n");
    return JSON.parse(readFileSync(rec.finish().ocelPath, "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Fold OCEL event types through the generated machine; returns [finalState, violations]. */
function conform(names: string[]) {
  let state: ZcodeTurnState = ZcodeTurnInitial;
  const events: { name: string; from: string; to: string }[] = [];
  const problems: string[] = [];
  for (const name of names.filter((n) => machineNames.has(n))) {
    try {
      const to = stepZcodeTurn(state, name, {});
      events.push({ name, from: state, to });
      state = to;
    } catch (e) {
      problems.push((e as Error).message);
    }
  }
  return { state, events, problems };
}

describe("OCEL replay through the generated turn machine", () => {
  test("every machine transition name is an OCEL event type the tap can emit", () => {
    for (const n of machineNames) expect(EVENT_TYPES).toContain(n);
  });

  for (const fx of fixtures()) {
    test(`${fx.name}: conformant, ends Completed, replay reports no violations`, () => {
      const doc = ocelOf(fx.lines);
      const r = conform(doc.events.map((e) => e.type));
      expect(r.problems).toEqual([]);
      expect(r.events.map((e) => e.name)).toEqual(["turn_started", "turn_completed"]);
      expect(r.state).toBe(ZcodeTurnState.Completed);
      expect(replayZcodeTurn(r.events)).toEqual([]);
    });
  }

  test("a second turn after completion is a legal loop transition", () => {
    const r = conform(["turn_started", "turn_completed", "turn_started", "turn_completed"]);
    expect(r.problems).toEqual([]);
    expect(r.state).toBe(ZcodeTurnState.Completed);
  });

  test("a failed turn may be retried", () => {
    const r = conform(["turn_started", "turn_failed", "turn_started", "turn_completed"]);
    expect(r.problems).toEqual([]);
  });

  test("completion before start is refused", () => {
    const fx = fixtures()[0];
    const names = ocelOf(fx.lines).events.map((e) => e.type);
    const swapped = names.slice();
    const a = swapped.indexOf("turn_started");
    const b = swapped.indexOf("turn_completed");
    [swapped[a], swapped[b]] = [swapped[b], swapped[a]];
    const r = conform(swapped);
    expect(r.problems.length).toBeGreaterThan(0);
    expect(r.problems[0]).toContain("no transition turn_completed from Idle");
  });

  test("replay flags a skipped state and an illegal transition", () => {
    const skipped = replayZcodeTurn([{ name: "turn_completed", from: "Running", to: "Completed" }]);
    expect(skipped.some((v) => v.kind === "skipped")).toBe(true);
    const illegal = replayZcodeTurn([{ name: "turn_started", from: "Idle", to: "Completed" }]);
    expect(illegal.some((v) => v.kind === "illegal")).toBe(true);
  });
});
