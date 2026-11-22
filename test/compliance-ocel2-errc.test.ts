import { describe, expect, test } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMPLIANCE_EVENT_TYPES,
  COMPLIANCE_OBJECT_TYPES,
  Ocel2ComplianceBuilder,
  VALID_OCEL2_ATTRIBUTE_TYPES,
  computeObjectsSha256,
  exportOcel2Sqlite,
  importOcel2Sqlite,
  parseOcel2Xml,
  serializeOcel2Xml,
  validateOcel2,
  type Ocel2Document
} from "../src/compliance/ocel2.ts";

function buildRichComplianceDoc(): Ocel2Document {
  const builder = new Ocel2ComplianceBuilder();
  builder
    .upsertObject("sess:1", "session", { compliance_profile: "high-risk-annex-iii" }, "2026-11-21T10:00:00.000Z")
    .upsertObject("turn:1", "turn", { standing: "ALIVE" }, "2026-11-21T10:00:01.000Z")
    .upsertObject(
      "req:1",
      "model_request",
      {
        provider_id: "anthropic",
        model_id: "claude-sonnet",
        ttft_ms: 125.5,
        service_ms: 842.25
      },
      "2026-11-21T10:00:02.000Z"
    )
    .upsertObject(
      "sub:1",
      "subagent",
      {
        agent_id: "worker-1",
        allow_yolo: false,
        custom_retries: 3,
        custom_ratio: 0.75,
        custom_deadline: "2026-11-22T00:00:00.000Z"
      },
      "2026-11-21T10:00:03.000Z"
    )
    .linkTurnToSession("turn:1", "sess:1")
    .linkModelRequestToTurn("req:1", "turn:1")
    .linkSubagentToSession("sub:1", "sess:1");

  builder.recordEvent({
    id: "ev:1",
    type: "model_request_completed",
    time: "2026-11-21T10:00:04.000Z",
    attributes: {
      provider_id: "anthropic",
      model_id: "claude-sonnet",
      ttft_ms: 125.5,
      service_ms: 842.25,
      status: "ok & <verified>",
      custom_count: 7,
      custom_flag: true,
      custom_at: "2026-11-21T10:00:04.000Z"
    },
    relationships: [
      { objectId: "req:1", qualifier: "completes" },
      { objectId: "turn:1", qualifier: "in_turn" }
    ]
  });

  builder.setObjectAttribute("turn:1", "standing", "SEALED", "2026-11-21T10:00:05.000Z");

  builder.recordEvent({
    id: "ev:2",
    type: "wip_backoff",
    time: "2026-11-21T10:00:06.000Z",
    attributes: {
      transition: "execute",
      old_wip: 4,
      new_wip: 2,
      reason: "latency spike"
    },
    relationships: [{ objectId: "sess:1", qualifier: "in_session" }]
  });

  return builder.build();
}

describe("05-IEEE-OCEL2-Schema ERRC — RAISE: attribute-schema closure & primitive type fidelity", () => {
  test("DEFAULT_OBJECT_ATTR_SCHEMAS and DEFAULT_EVENT_ATTR_SCHEMAS assign accurate OCEL 2.0 primitive types", () => {
    const objTypeByName = new Map(COMPLIANCE_OBJECT_TYPES.map((t) => [t.name, t]));
    const evTypeByName = new Map(COMPLIANCE_EVENT_TYPES.map((t) => [t.name, t]));

    const modelReqAttrs = new Map(objTypeByName.get("model_request")!.attributes.map((a) => [a.name, a.type]));
    expect(modelReqAttrs.get("ttft_ms")).toBe("float");
    expect(modelReqAttrs.get("service_ms")).toBe("float");

    const subagentAttrs = new Map(objTypeByName.get("subagent")!.attributes.map((a) => [a.name, a.type]));
    expect(subagentAttrs.get("allow_yolo")).toBe("boolean");

    const incidentAttrs = new Map(objTypeByName.get("incident")!.attributes.map((a) => [a.name, a.type]));
    expect(incidentAttrs.get("deadline")).toBe("time");

    const retryAttrs = new Map(evTypeByName.get("retry_budget_exhausted")!.attributes.map((a) => [a.name, a.type]));
    expect(retryAttrs.get("attempts")).toBe("integer");

    const driftAttrs = new Map(evTypeByName.get("drift_detected")!.attributes.map((a) => [a.name, a.type]));
    expect(driftAttrs.get("p_value")).toBe("float");

    const wipAttrs = new Map(evTypeByName.get("wip_backoff")!.attributes.map((a) => [a.name, a.type]));
    expect(wipAttrs.get("old_wip")).toBe("integer");
    expect(wipAttrs.get("new_wip")).toBe("integer");

    for (const t of [...COMPLIANCE_OBJECT_TYPES, ...COMPLIANCE_EVENT_TYPES]) {
      for (const a of t.attributes) {
        expect(VALID_OCEL2_ATTRIBUTE_TYPES.has(String(a.type))).toBe(true);
      }
    }
  });

  test("Ocel2ComplianceBuilder registers pi_* attributes on eventTypes and infers primitive types for dynamic attributes", () => {
    const doc = buildRichComplianceDoc();
    const res = validateOcel2(doc, {
      requireHashChain: true,
      requireAttrHash: true,
      requireObjHash: true
    });
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);

    const subagentSchema = doc.objectTypes.find((t) => t.name === "subagent")!;
    const subAttrTypes = new Map(subagentSchema.attributes.map((a) => [a.name, a.type]));
    expect(subAttrTypes.get("custom_retries")).toBe("integer");
    expect(subAttrTypes.get("custom_ratio")).toBe("float");
    expect(subAttrTypes.get("custom_deadline")).toBe("time");

    const evSchema = doc.eventTypes.find((t) => t.name === "model_request_completed")!;
    const evAttrTypes = new Map(evSchema.attributes.map((a) => [a.name, a.type]));
    expect(evAttrTypes.get("pi_parent")).toBe("string");
    expect(evAttrTypes.get("pi_hash")).toBe("string");
    expect(evAttrTypes.get("pi_hash_alg")).toBe("string");
    expect(evAttrTypes.get("pi_attr_sha256")).toBe("string");
    expect(evAttrTypes.get("pi_obj_sha256")).toBe("string");
    expect(evAttrTypes.get("custom_count")).toBe("integer");
    expect(evAttrTypes.get("custom_flag")).toBe("boolean");
    expect(evAttrTypes.get("custom_at")).toBe("time");
  });

  test("validateOcel2 rejects invalid primitive types, duplicate schema attribute names, and undeclared object/event attributes", () => {
    const doc: Ocel2Document = {
      objectTypes: [
        {
          name: "session",
          attributes: [
            { name: "ok_attr", type: "string" },
            { name: "ok_attr", type: "string" },
            { name: "bad_type", type: "varchar" }
          ]
        }
      ],
      eventTypes: [
        {
          name: "turn_started",
          attributes: [
            { name: "seq", type: "integer" },
            { name: "seq", type: "integer" },
            { name: "bogus", type: "number" }
          ]
        }
      ],
      objects: [
        {
          id: "s1",
          type: "session",
          attributes: [
            { name: "undeclared_obj_attr", time: "2026-11-21T10:00:00.000Z", value: "x" }
          ],
          relationships: []
        }
      ],
      events: [
        {
          id: "e1",
          type: "turn_started",
          time: "2026-11-21T10:00:00.000Z",
          attributes: [{ name: "undeclared_ev_attr", value: "y" }],
          relationships: [{ objectId: "s1", qualifier: "in_session" }]
        }
      ]
    };

    const res = validateOcel2(doc);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes("duplicate attribute 'ok_attr'"))).toBe(true);
    expect(res.errors.some((e) => e.includes("invalid OCEL 2.0 type 'varchar'"))).toBe(true);
    expect(res.errors.some((e) => e.includes("duplicate attribute 'seq'"))).toBe(true);
    expect(res.errors.some((e) => e.includes("invalid OCEL 2.0 type 'number'"))).toBe(true);
    expect(res.errors.some((e) => e.includes("undeclared attribute 'undeclared_obj_attr'"))).toBe(true);
    expect(res.errors.some((e) => e.includes("undeclared attribute 'undeclared_ev_attr'"))).toBe(true);
  });
});

describe("05-IEEE-OCEL2-Schema ERRC — REDUCE: cache pi_obj_sha256 when object graph is unchanged", () => {
  test("consecutive events without object mutation reuse cached pi_obj_sha256 and recompute after mutation", () => {
    const builder = new Ocel2ComplianceBuilder();
    builder.upsertObject("sess:1", "session", { compliance_profile: "art50-only" }, "2026-11-21T10:00:00.000Z");

    const ev1 = builder.recordEvent({
      id: "e1",
      type: "compliance_assessed",
      time: "2026-11-21T10:00:01.000Z",
      attributes: { verdict: "pass" },
      relationships: [{ objectId: "sess:1", qualifier: "in_session" }]
    });
    const ev2 = builder.recordEvent({
      id: "e2",
      type: "compliance_assessed",
      time: "2026-11-21T10:00:02.000Z",
      attributes: { verdict: "pass" },
      relationships: [{ objectId: "sess:1", qualifier: "in_session" }]
    });

    const sha1 = ev1.attributes.find((a) => a.name === "pi_obj_sha256")?.value;
    const sha2 = ev2.attributes.find((a) => a.name === "pi_obj_sha256")?.value;
    expect(sha1).toBeDefined();
    expect(sha2).toBe(sha1);

    builder.setObjectAttribute("sess:1", "git_head_sha", "abc123", "2026-11-21T10:00:03.000Z");

    const ev3 = builder.recordEvent({
      id: "e3",
      type: "compliance_assessed",
      time: "2026-11-21T10:00:04.000Z",
      attributes: { verdict: "pass" },
      relationships: [{ objectId: "sess:1", qualifier: "in_session" }]
    });
    const sha3 = ev3.attributes.find((a) => a.name === "pi_obj_sha256")?.value;
    expect(sha3).toBeDefined();
    expect(sha3).not.toBe(sha2);

    const doc = builder.build();
    expect(sha3).toBe(computeObjectsSha256(doc.objects));
    expect(validateOcel2(doc, { requireHashChain: true, requireAttrHash: true, requireObjHash: true }).ok).toBe(true);
  });
});

describe("05-IEEE-OCEL2-Schema ERRC — CREATE: XML round-trip parser & SQLite interchange", () => {
  test("serializeOcel2Xml -> parseOcel2Xml round-trips with full fidelity and passes validateOcel2", () => {
    const original = buildRichComplianceDoc();
    const xml = serializeOcel2Xml(original);
    const parsed = parseOcel2Xml(xml);

    expect(parsed).toEqual(original);
    const check = validateOcel2(parsed, {
      requireHashChain: true,
      requireAttrHash: true,
      requireObjHash: true
    });
    expect(check.ok).toBe(true);
    expect(check.errors).toEqual([]);
  });

  test("parseOcel2Xml fails closed on malformed XML or wrong root element", () => {
    expect(() => parseOcel2Xml("")).toThrow();
    expect(() => parseOcel2Xml("<not-log></not-log>")).toThrow();
    expect(() => parseOcel2Xml("<log><events></log>")).toThrow();
  });

  test("exportOcel2Sqlite -> importOcel2Sqlite creates normative IEEE OCEL 2.0 tables and round-trips", () => {
    const dir = mkdtempSync(join(tmpdir(), "ocel2-sqlite-"));
    const dbPath = join(dir, "ocel2.sqlite");
    try {
      const original = buildRichComplianceDoc();
      exportOcel2Sqlite(original, dbPath);

      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const tables = (
          db
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .all() as Array<{ name: string }>
        ).map((r) => r.name);

        expect(tables).toContain("event");
        expect(tables).toContain("object");
        expect(tables).toContain("event_map_type");
        expect(tables).toContain("object_map_type");
        expect(tables).toContain("event_object");
        expect(tables).toContain("object_object");
        expect(tables).toContain("event_model_request_completed");
        expect(tables).toContain("event_wip_backoff");
        expect(tables).toContain("object_session");
        expect(tables).toContain("object_turn");
        expect(tables).toContain("object_model_request");
      } finally {
        db.close();
      }

      const imported = importOcel2Sqlite(dbPath);
      const check = validateOcel2(imported, {
        requireHashChain: true,
        requireAttrHash: true,
        requireObjHash: true
      });
      expect(check.ok).toBe(true);
      expect(check.errors).toEqual([]);
      expect(imported.objectTypes).toEqual(original.objectTypes);
      expect(imported.eventTypes).toEqual(original.eventTypes);
      expect(imported.objects).toEqual(original.objects);
      expect(imported.events.map((e) => e.id)).toEqual(original.events.map((e) => e.id));
      expect(imported.events.map((e) => e.relationships)).toEqual(original.events.map((e) => e.relationships));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
