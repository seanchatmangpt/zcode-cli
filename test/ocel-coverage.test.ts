// Coverage gate: every runtime event type is mapped by a rule or explicitly pi:Unmapped with a reason,
// and the ontology has not drifted from the runtime's own enums (vendor/zcode.cjs).
import { describe, expect, test } from "bun:test";

import { RULES, SOURCES } from "../src/generated/ocel.ts";
import { APP_SERVER_SOURCE, STREAM_SOURCE } from "../src/ocel-tap.ts";
import { readRuntimeEvents, wireOf } from "../scripts/zcode-events.ts";
import { declaredInternal, declaredRuntimeEvents, runtimeMissing } from "./support/ocel.ts";

const declared = declaredRuntimeEvents();

describe("ontology coverage", () => {
  for (const source of [STREAM_SOURCE, APP_SERVER_SOURCE]) {
    test(`${source}: every runtime event is mapped by a generated rule or Unmapped with a reason`, () => {
      const events = declared.filter((e) => e.source === source);
      expect(events.length).toBeGreaterThanOrEqual(25);
      for (const e of events) {
        const rules = RULES.filter((r) => r.source === source && r.name === e.name);
        if (e.unmappedReason) {
          expect(rules.length).toBe(0); // an unmapped event must not also be mapped
          expect(e.unmappedReason.length).toBeGreaterThan(10);
        } else {
          expect(rules.length).toBeGreaterThan(0);
          expect(rules.some((r) => r.object === "session")).toBe(true);
        }
      }
      // and no generated rule names an event the ontology does not declare
      const names = new Set(events.map((e) => e.name));
      for (const r of RULES.filter((x) => x.source === source)) expect(names.has(r.name)).toBe(true);
    });
  }

  test("both zcode sources are generated with sha256 chains", () => {
    for (const id of [STREAM_SOURCE, APP_SERVER_SOURCE]) expect(SOURCES.find((s) => s.id === id)?.hash).toBe("sha256");
    expect(SOURCES.find((s) => s.id === STREAM_SOURCE)?.kind).toBe("stream-json");
    expect(SOURCES.find((s) => s.id === APP_SERVER_SOURCE)?.kind).toBe("app-server-subscription");
  });
});

describe.skipIf(runtimeMissing)("runtime drift gate (vendor/zcode.cjs)", () => {
  const events = runtimeMissing ? undefined : readRuntimeEvents();

  test("wire enum equals the app-server runtime events; stream adds the result envelope", () => {
    const wire = events!.wire.slice().sort();
    expect(declared.filter((e) => e.source === APP_SERVER_SOURCE).map((e) => e.name).sort()).toEqual(wire);
    expect(declared.filter((e) => e.source === STREAM_SOURCE).map((e) => e.name).sort()).toEqual([...wire, "result"].sort());
  });

  test("every internal session event is documented and folds to a covered wire event", () => {
    const internal = declaredInternal();
    expect(Object.keys(internal).sort()).toEqual(Object.values(events!.internal).sort());
    const wireDeclared = new Set(declared.filter((e) => e.source === STREAM_SOURCE).map((e) => e.name));
    for (const value of Object.values(events!.internal)) {
      expect(internal[value]).toBe(wireOf(events!, value));
      expect(wireDeclared.has(internal[value])).toBe(true);
    }
  });
});
