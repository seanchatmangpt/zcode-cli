// Drift court: the shared-vocabulary manifest must match the live generated
// registries exactly. A new EVENT_TYPES/OBJECT_TYPES entry that lands without a
// manifest classification fails here (ZOCEL-016 follow-up: no unclassified
// vocabulary drift against beam4pm CastleOcel).
import { describe, expect, it } from "bun:test";
import { EVENT_TYPES, OBJECT_TYPES } from "../src/generated/ocel.ts";
import {
  CASTLE_EVENT_TYPES,
  CASTLE_OBJECT_TYPES,
  EVENT_CLASSIFICATION,
  OBJECT_CLASSIFICATION,
} from "../src/ocel-vocab-manifest.ts";

const VALID = new Set(["shared", "disjoint", "deliberate-local"]);

describe("ocel vocab manifest drift court", () => {
  it("classifies exactly the live EVENT_TYPES registry", () => {
    expect(Object.keys(EVENT_CLASSIFICATION).sort()).toEqual([...EVENT_TYPES].sort());
  });

  it("classifies exactly the live OBJECT_TYPES registry", () => {
    expect(Object.keys(OBJECT_CLASSIFICATION).sort()).toEqual([...OBJECT_TYPES].sort());
  });

  it("uses only admitted classification values", () => {
    for (const c of Object.values(EVENT_CLASSIFICATION)) expect(VALID.has(c)).toBe(true);
    for (const c of Object.values(OBJECT_CLASSIFICATION)) expect(VALID.has(c)).toBe(true);
  });

  it("pins the CastleOcel closed vocabularies verbatim", () => {
    expect(CASTLE_EVENT_TYPES).toEqual([
      "system_bootstrapped",
      "pod_provisioned",
      "container_started",
      "ggen_sync_observed",
      "activity_started",
      "activity_finished",
      "episode_recorded",
      "evidence_admitted",
      "episode_receipt_sealed",
      "refused_observation",
    ]);
    expect(CASTLE_OBJECT_TYPES).toEqual(["system", "pod", "container", "gym_act_episode"]);
  });

  it("keeps the zcode and CastleOcel vocabularies disjoint (name-compatible set is empty)", () => {
    const zEvents = new Set(EVENT_TYPES);
    const zObjects = new Set(OBJECT_TYPES);
    expect(CASTLE_EVENT_TYPES.filter((t) => zEvents.has(t))).toEqual([]);
    expect(CASTLE_OBJECT_TYPES.filter((t) => zObjects.has(t))).toEqual([]);
    // every classification of a zcode type agrees with the pinned Castle lists
    for (const t of EVENT_TYPES)
      expect(EVENT_CLASSIFICATION[t] === "shared").toBe(CASTLE_EVENT_TYPES.includes(t));
    for (const t of OBJECT_TYPES)
      expect(OBJECT_CLASSIFICATION[t] === "shared").toBe(CASTLE_OBJECT_TYPES.includes(t));
  });
});
