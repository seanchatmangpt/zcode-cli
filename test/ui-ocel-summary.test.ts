/**
 * SUPPLE-style T summarizer: OCEL-like events → per-element #sw/#ent/#lv/#.
 * Proves explicit + synthetic classification and the layout-cost wiring stub
 * (no solver invented).
 */
import { describe, expect, test } from "bun:test";

import {
  LAYOUT_COST_WIRING_POINT,
  SPATIAL_COURT_EXIT_EVENT_TYPES,
  UI_OCEL_SUMMARY_SCHEMA,
  classifySpatialCourtExitEvent,
  classifyUiOcelEvent,
  spatialCourtExitEventTypes,
  summarizeUiOcelTrace,
  wireLayoutCostPlaceholder,
  type OcelLikeEvent,
  type SpatialCourtExitEventType
} from "../src/ui-ocel-summary.ts";

describe("ui-ocel-summary SUPPLE T counts", () => {
  test("explicit kinds accumulate #sw/#ent/#lv/# per element", () => {
    const events: OcelLikeEvent[] = [
      {
        id: "e1",
        type: "ui_event",
        attributes: [
          { name: "element_id", value: "breaker.save" },
          { name: "ui_interaction", value: "sw" }
        ]
      },
      {
        id: "e2",
        type: "ui_event",
        attributes: [
          { name: "element_id", value: "breaker.save" },
          { name: "ui_interaction", value: "ent" }
        ]
      },
      {
        id: "e3",
        type: "ui_event",
        attributes: [
          { name: "element_id", value: "breaker.save" },
          { name: "ui_interaction", value: "lv" }
        ]
      },
      {
        id: "e4",
        type: "ui_event",
        attributes: [
          { name: "element_id", value: "breaker.save" },
          { name: "ui_interaction", value: "interact" }
        ]
      },
      {
        id: "e5",
        type: "ui_event",
        attributes: [
          { name: "element_id", value: "disclosure.rare" },
          { name: "ui_interaction", value: "click" }
        ]
      }
    ];

    const summary = summarizeUiOcelTrace(events);
    expect(summary.schema).toBe(UI_OCEL_SUMMARY_SCHEMA);
    expect(summary.eventCount).toBe(5);
    expect(summary.classifiedCount).toBe(5);
    expect(summary.synthetic).toBe(false);

    const save = summary.elements.find((e) => e.elementId === "breaker.save");
    const rare = summary.elements.find((e) => e.elementId === "disclosure.rare");
    expect(save).toEqual({ elementId: "breaker.save", sw: 1, ent: 1, lv: 1, n: 4 });
    expect(rare).toEqual({ elementId: "disclosure.rare", sw: 0, ent: 0, lv: 0, n: 1 });
  });

  test("synthetic inference from event type + relationship still yields counts", () => {
    const events: OcelLikeEvent[] = [
      {
        type: "ui_switch",
        relationships: [{ objectId: "nav.home", qualifier: "ui_element" }]
      },
      {
        type: "ui_enter",
        relationships: [{ objectId: "nav.home", qualifier: "targets" }]
      },
      {
        type: "ui_leave",
        relationships: [{ objectId: "panel.details", qualifier: "ui_element" }]
      },
      {
        type: "tool_call",
        relationships: [{ objectId: "session:1", qualifier: "in_session" }]
      }
    ];

    const summary = summarizeUiOcelTrace({ events });
    expect(summary.classifiedCount).toBe(3);
    expect(summary.synthetic).toBe(true);
    expect(summary.elements).toEqual([
      { elementId: "nav.home", sw: 1, ent: 1, lv: 0, n: 2 },
      { elementId: "panel.details", sw: 0, ent: 0, lv: 1, n: 1 }
    ]);
  });

  test("classifyUiOcelEvent returns null for non-UI ambient events", () => {
    expect(
      classifyUiOcelEvent({
        type: "turn_started",
        relationships: [{ objectId: "sess", qualifier: "in_session" }]
      })
    ).toBeNull();
  });

  test("LAYOUT_COST_WIRING_POINT documents future $(φ,T) without inventing a solver", () => {
    const summary = summarizeUiOcelTrace([
      {
        type: "ui_click",
        elementId: "cta.primary",
        attributes: { ui_interaction: "interact" }
      }
    ]);
    const wired = wireLayoutCostPlaceholder(summary);
    expect(wired.cost).toBeNull();
    expect(wired.wiring).toBe(LAYOUT_COST_WIRING_POINT);
    expect(wired.wiring.status).toBe("stub");
    expect(wired.wiring.formula).toContain("#sw(T,e)");
    expect(wired.wiring.missing.length).toBeGreaterThan(0);
    expect(wired.summary.elements[0]?.n).toBe(1);
  });

  test("spatial-court refuse/pass events cover exit taxonomy 0/1/2/3", () => {
    const expected: Record<
      SpatialCourtExitEventType,
      { exitCode: 0 | 1 | 2 | 3; standing: "ALIVE" | "REFUSED" | "BLOCKED" | "UNVERIFIED" }
    > = {
      spatial_court_pass: { exitCode: 0, standing: "ALIVE" },
      spatial_court_refused: { exitCode: 1, standing: "REFUSED" },
      spatial_court_subject_missing: { exitCode: 2, standing: "BLOCKED" },
      spatial_court_loud_skip: { exitCode: 3, standing: "UNVERIFIED" }
    };

    const types = spatialCourtExitEventTypes();
    expect([...types].map(String).sort()).toEqual(Object.keys(expected).sort());
    expect(new Set(Object.values(SPATIAL_COURT_EXIT_EVENT_TYPES))).toEqual(new Set([0, 1, 2, 3]));

    for (const eventType of types) {
      const classified = classifySpatialCourtExitEvent({ type: eventType });
      expect(classified).toEqual({
        eventType,
        exitCode: expected[eventType].exitCode,
        standing: expected[eventType].standing
      });
      // Court verdicts must not bleed into SUPPLE #sw/#ent/#lv/# counts.
      expect(classifyUiOcelEvent({ type: eventType, elementId: "breaker.save" })).toBeNull();
    }

    expect(classifySpatialCourtExitEvent({ type: "ui_click" })).toBeNull();
    expect(classifySpatialCourtExitEvent({ type: "transition_refused" })).toBeNull();
  });
});
