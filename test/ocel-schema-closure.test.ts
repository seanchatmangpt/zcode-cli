// Falsifiers for IEEE OCEL 2.0 type/attr closure vs schemas.json OcelEventRecord
// and committed swarm receipts (EU AI Act Art. logging / record-keeping analog).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { closeEventTypeAttributes } from "../src/ocel-tap.ts";
import type { OcelDoc } from "../src/generated/ocel.ts";
import { ocelProblems, repoRoot, schemaProblems } from "./support/ocel.ts";

const schemas = JSON.parse(readFileSync(join(repoRoot, "src", "generated", "schemas.json"), "utf8"));
const turnList = JSON.parse(
  readFileSync(join(repoRoot, "test", "fixtures", "zcode-ocel", "turn-list.jsonocel"), "utf8")
) as OcelDoc;
const polyevidence = JSON.parse(
  readFileSync(
    join(repoRoot, "receipts", "ocel", "v2", "swarm", "runtime", "2026-09-28-zcode-polyevidence-r16.jsonocel"),
    "utf8"
  )
) as OcelDoc;

describe("OcelEventRecord schema closure (identity triple)", () => {
  test("identity projection {id,type,time} validates against OcelEventRecord", () => {
    for (const e of turnList.events) {
      expect(schemaProblems(schemas, "OcelEventRecord", { id: e.id, type: e.type, time: e.time })).toEqual([]);
    }
  });

  test("full OCEL 2.0 events fail OcelEventRecord additionalProperties (attributes/relationships)", () => {
    const e = turnList.events[0]!;
    const problems = schemaProblems(schemas, "OcelEventRecord", e);
    expect(problems).toContain("unexpected attributes");
    expect(problems).toContain("unexpected relationships");
  });

  test("legacy objects[] field is refused by OcelEventRecord", () => {
    const problems = schemaProblems(schemas, "OcelEventRecord", {
      id: "x",
      type: "bind",
      time: "2026-09-28T16:24:08Z",
      objects: ["a"],
    });
    expect(problems).toContain("unexpected objects");
  });
});

describe("IEEE OCEL 2.0 type/attr closure", () => {
  test("tap fixture turn-list passes structural + attr closure", () => {
    expect(ocelProblems(turnList)).toEqual([]);
  });

  test("empty eventType.attributes with observed pi_* attrs is refused (attr closure falsifier)", () => {
    const open: OcelDoc = {
      ...turnList,
      eventTypes: turnList.eventTypes.map((t) => ({ name: t.name, attributes: [] })),
    };
    const problems = ocelProblems(open);
    expect(problems.some((p) => p.includes("undeclared"))).toBe(true);
  });

  test("closeEventTypeAttributes restores attr closure without editing generated Tap", () => {
    const open: OcelDoc = {
      ...turnList,
      eventTypes: turnList.eventTypes.map((t) => ({ name: t.name, attributes: [] })),
    };
    expect(ocelProblems(closeEventTypeAttributes(open))).toEqual([]);
  });

  test("polyevidence-r16 is valid IEEE OCEL 2.0 (no bare string types, no objects[])", () => {
    expect(Array.isArray(polyevidence.objectTypes)).toBe(true);
    expect(typeof (polyevidence.objectTypes[0] as { name?: unknown }).name).toBe("string");
    expect(ocelProblems(polyevidence)).toEqual([]);
    for (const e of polyevidence.events) {
      expect(Array.isArray(e.relationships)).toBe(true);
      expect((e as { objects?: unknown }).objects).toBeUndefined();
    }
  });

  test("bare-string eventTypes/objectTypes are refused", () => {
    const bad = {
      objectTypes: ["repo"],
      eventTypes: ["bind"],
      objects: [{ id: "r", type: "repo", attributes: [], relationships: [] }],
      events: [
        {
          id: "e1",
          type: "bind",
          time: "2026-09-28T16:24:08Z",
          attributes: [],
          relationships: [{ objectId: "r", qualifier: "involves" }],
        },
      ],
    } as unknown as OcelDoc;
    const problems = ocelProblems(bad);
    expect(problems.some((p) => p.includes("not {name, attributes}"))).toBe(true);
  });
});

describe("POWL emitter type/attr closure", () => {
  test("executePowlWithTokenReplay log passes ocelProblems", async () => {
    const { executePowlWithTokenReplay } = await import("../src/powl-ocel-orchestrator.ts");
    const powl = {
      kind: "partial_order" as const,
      id: "closure",
      children: [
        { kind: "activity" as const, id: "a", label: "A", objectType: "Artifact" },
        { kind: "activity" as const, id: "b", label: "B", objectType: "Artifact" },
      ],
      order: [["a", "b"] as [string, string]],
    };
    const res = await executePowlWithTokenReplay(powl, async () => ({ ok: true, exitCode: 0 }));
    expect(ocelProblems(res.ocel as unknown as OcelDoc)).toEqual([]);
  });
});
