import { describe, expect, test } from "bun:test";
import {
  DEFAULT_EU_AI_ACT_DECLARE_RULES,
  evaluateDeclareRules,
  type DeclareRule,
  type Ocel2DocLike
} from "../src/compliance/declare-conformance.ts";
import { Tap } from "../src/generated/ocel.ts";

function buildConformingHighRiskDoc(): Ocel2DocLike {
  const t0 = Date.parse("2026-08-02T10:00:00.000Z");
  const iso = (ms: number) => new Date(t0 + ms).toISOString();

  return {
    objects: [
      {
        id: "sess_1",
        type: "session",
        attributes: [{ name: "compliance_profile", value: "high-risk-annex-iii", time: iso(0) }],
        relationships: []
      },
      { id: "turn_1", type: "turn", attributes: [], relationships: [{ objectId: "sess_1", qualifier: "in_session" }] },
      { id: "wo_1", type: "work_order", attributes: [], relationships: [] }
    ],
    events: [
      {
        id: "ev_1",
        type: "session_created",
        time: iso(0),
        attributes: [{ name: "compliance_profile", value: "high-risk-annex-iii" }],
        relationships: [{ objectId: "sess_1", qualifier: "in_session" }]
      },
      {
        id: "ev_2",
        type: "art50_disclosure_emitted",
        time: iso(100),
        attributes: [{ name: "channel", value: "stream-json" }],
        relationships: [{ objectId: "sess_1", qualifier: "in_session" }]
      },
      {
        id: "ev_3",
        type: "turn_started",
        time: iso(200),
        attributes: [],
        relationships: [
          { objectId: "sess_1", qualifier: "in_session" },
          { objectId: "turn_1", qualifier: "in_turn" }
        ]
      },
      {
        id: "ev_4",
        type: "permission_requested",
        time: iso(300),
        attributes: [{ name: "risk_level", value: "high" }],
        relationships: [
          { objectId: "sess_1", qualifier: "in_session" },
          { objectId: "turn_1", qualifier: "in_turn" }
        ]
      },
      {
        id: "ev_5",
        type: "permission_resolved",
        time: iso(1800),
        attributes: [{ name: "decision", value: "allow" }],
        relationships: [
          { objectId: "sess_1", qualifier: "in_session" },
          { objectId: "turn_1", qualifier: "in_turn" }
        ]
      },
      {
        id: "ev_6",
        type: "tool_updated",
        time: iso(2000),
        attributes: [{ name: "tool_name", value: "Write" }],
        relationships: [
          { objectId: "sess_1", qualifier: "in_session" },
          { objectId: "turn_1", qualifier: "in_turn" }
        ]
      },
      {
        id: "ev_7",
        type: "worker_claim",
        time: iso(2100),
        attributes: [],
        relationships: [
          { objectId: "sess_1", qualifier: "in_session" },
          { objectId: "wo_1", qualifier: "subject" }
        ]
      },
      {
        id: "ev_8",
        type: "receipt_persist",
        time: iso(2200),
        attributes: [],
        relationships: [
          { objectId: "sess_1", qualifier: "in_session" },
          { objectId: "wo_1", qualifier: "subject" }
        ]
      },
      {
        id: "ev_9",
        type: "turn_completed",
        time: iso(2300),
        attributes: [],
        relationships: [
          { objectId: "sess_1", qualifier: "in_session" },
          { objectId: "turn_1", qualifier: "in_turn" }
        ]
      }
    ]
  };
}

describe("F10 Declare / LTLf Conformance Engine (Chicago)", () => {
  test("witnesses all 7 EU AI Act Declare rules on conforming high-risk session", () => {
    const doc = buildConformingHighRiskDoc();
    const report = evaluateDeclareRules(doc, DEFAULT_EU_AI_ACT_DECLARE_RULES);

    expect(report.allMandatorySatisfied).toBe(true);
    expect(report.violatedCount).toBe(0);
    expect(report.vacuousCount).toBe(0);
    expect(report.witnessedCount).toBe(7);

    for (const res of report.results) {
      expect(res.status).toBe("SATISFIED_WITNESSED");
      expect(res.witness_event_ids.length).toBeGreaterThan(0);
      expect(res.counterexample_event_ids).toEqual([]);
      expect(res.antiVacuityPassed).toBe(true);
    }
  });

  test("anti-vacuity: Precedence returns SATISFIED_VACUOUS when tool_updated is absent, and VIOLATED when permission_resolved is skipped", () => {
    const rule: DeclareRule = {
      id: "DEC-PREC-TEST",
      template: "Precedence",
      activation: "tool_updated",
      target: "permission_resolved",
      objectType: "turn",
      mandatory: true
    };

    const vacuousDoc: Ocel2DocLike = {
      objects: [{ id: "t1", type: "turn", attributes: [] }],
      events: [
        {
          id: "e1",
          type: "turn_started",
          time: "2026-08-02T10:00:00.000Z",
          attributes: [],
          relationships: [{ objectId: "t1", qualifier: "in_turn" }]
        },
        {
          id: "e2",
          type: "permission_resolved",
          time: "2026-08-02T10:00:01.000Z",
          attributes: [],
          relationships: [{ objectId: "t1", qualifier: "in_turn" }]
        }
      ]
    };

    const vacRes = evaluateDeclareRules(vacuousDoc, [rule]).results[0]!;
    expect(vacRes.status).toBe("SATISFIED_VACUOUS");
    expect(vacRes.witness_event_ids).toEqual([]);
    expect(vacRes.antiVacuityPassed).toBe(false);

    const violatedDoc: Ocel2DocLike = {
      objects: [{ id: "t2", type: "turn", attributes: [] }],
      events: [
        {
          id: "e10",
          type: "turn_started",
          time: "2026-08-02T10:00:00.000Z",
          attributes: [],
          relationships: [{ objectId: "t2", qualifier: "in_turn" }]
        },
        {
          id: "e11",
          type: "tool_updated",
          time: "2026-08-02T10:00:01.000Z",
          attributes: [{ name: "tool_name", value: "Write" }],
          relationships: [{ objectId: "t2", qualifier: "in_turn" }]
        }
      ]
    };

    const vioRes = evaluateDeclareRules(violatedDoc, [rule]).results[0]!;
    expect(vioRes.status).toBe("VIOLATED");
    expect(vioRes.counterexample_event_ids).toEqual(["e11"]);
  });

  test("detects Init, Existence, Response, ChainResponse, Absence (secret leak), and NotCoExistence violations", () => {
    const badDoc: Ocel2DocLike = {
      objects: [
        { id: "s1", type: "session", attributes: [{ name: "compliance_profile", value: "high-risk-annex-i" }] },
        { id: "wo1", type: "work_order", attributes: [] }
      ],
      events: [
        {
          id: "ev_bad_init",
          type: "turn_started",
          time: "2026-08-02T10:00:00.000Z",
          attributes: [{ name: "mode", value: "yolo" }],
          relationships: [{ objectId: "s1", qualifier: "in_session" }]
        },
        {
          id: "ev_sess",
          type: "session_created",
          time: "2026-08-02T10:00:01.000Z",
          attributes: [{ name: "compliance_profile", value: "high-risk-annex-i" }],
          relationships: [{ objectId: "s1", qualifier: "in_session" }]
        },
        {
          id: "ev_secret",
          type: "tool_updated",
          time: "2026-08-02T10:00:02.000Z",
          attributes: [{ name: "output_preview", value: "Authorization: Bearer supersecret_live_token_9988" }],
          relationships: [{ objectId: "s1", qualifier: "in_session" }]
        },
        {
          id: "ev_claim",
          type: "worker_claim",
          time: "2026-08-02T10:00:03.000Z",
          attributes: [],
          relationships: [
            { objectId: "s1", qualifier: "in_session" },
            { objectId: "wo1", qualifier: "subject" }
          ]
        },
        {
          id: "ev_intervene",
          type: "tool_updated",
          time: "2026-08-02T10:00:04.000Z",
          attributes: [],
          relationships: [
            { objectId: "s1", qualifier: "in_session" },
            { objectId: "wo1", qualifier: "subject" }
          ]
        },
        {
          id: "ev_receipt",
          type: "receipt_persist",
          time: "2026-08-02T10:00:05.000Z",
          attributes: [],
          relationships: [
            { objectId: "s1", qualifier: "in_session" },
            { objectId: "wo1", qualifier: "subject" }
          ]
        }
      ]
    };

    const report = evaluateDeclareRules(badDoc, DEFAULT_EU_AI_ACT_DECLARE_RULES);
    expect(report.allMandatorySatisfied).toBe(false);

    const byId = new Map(report.results.map((r) => [r.id, r]));
    expect(byId.get("DEC-INIT-SESSION")!.status).toBe("VIOLATED");
    expect(byId.get("DEC-ABS-UNREDACTED")!.status).toBe("VIOLATED");
    expect(byId.get("DEC-ABS-UNREDACTED")!.counterexample_event_ids).toContain("ev_secret");
    expect(byId.get("DEC-RESP-ART50")!.status).toBe("VIOLATED");
    expect(byId.get("DEC-RESP-ART50")!.counterexample_event_ids).toContain("ev_sess");
    expect(byId.get("DEC-CHAIN-RECEIPT")!.status).toBe("VIOLATED");
    expect(byId.get("DEC-CHAIN-RECEIPT")!.counterexample_event_ids).toContain("ev_claim");
    expect(byId.get("DEC-NOTCO-YOLO-HIGHRISK")!.status).toBe("VIOLATED");

    const existenceFail = evaluateDeclareRules(badDoc, [
      { id: "EXIST-MISSING", template: "Existence", activity: "art50_disclosure_emitted", minCount: 1, objectType: "session", mandatory: true }
    ]).results[0]!;
    expect(existenceFail.status).toBe("VIOLATED");
  });

  test("evaluates real generated Tap OCEL output directly", () => {
    const tap = new Tap("zcode_stream");
    tap.ingest(
      [
        JSON.stringify({ type: "session.created", eventId: "e1", timestamp: "2026-08-02T10:00:00.000Z", sessionId: "s_tap", turnId: "t_tap" }),
        JSON.stringify({ type: "turn.started", eventId: "e2", timestamp: "2026-08-02T10:00:01.000Z", sessionId: "s_tap", turnId: "t_tap" }),
        JSON.stringify({ type: "permission.resolved", eventId: "e3", timestamp: "2026-08-02T10:00:02.000Z", sessionId: "s_tap", turnId: "t_tap", payload: { requestId: "p1" } }),
        JSON.stringify({ type: "tool.updated", eventId: "e4", timestamp: "2026-08-02T10:00:03.000Z", sessionId: "s_tap", turnId: "t_tap", payload: { toolCallId: "tc1" } })
      ].join("\n")
    );
    tap.seal();
    const doc = tap.toOcel();

    const report = evaluateDeclareRules(doc, [
      { id: "T1", template: "Init", activity: "session_created", objectType: "session", mandatory: true },
      { id: "T2", template: "Precedence", activation: "tool_updated", target: "permission_resolved", objectType: "turn", mandatory: true },
      { id: "T3", template: "NotCoExistence", activation: "mode_yolo_enabled", target: "high_risk_profile_active", objectType: "session", mandatory: true }
    ]);

    expect(report.results[0]!.status).toBe("SATISFIED_WITNESSED");
    expect(report.results[1]!.status).toBe("SATISFIED_WITNESSED");
    expect(report.results[2]!.status).toBe("SATISFIED_VACUOUS");
  });

  test("regression F10: detects raw sk-/ghp_/xoxb-/AKIA keys in arbitrary attributes without false-positiving benign prose", () => {
    const docWithKeys: Ocel2DocLike = {
      objects: [{ id: "s_keys", type: "session", attributes: [] }],
      events: [
        {
          id: "ev_benign",
          type: "tool_updated",
          time: "2026-08-02T10:00:00.000Z",
          attributes: [{ name: "command_output", value: "the token bucket refills smoothly" }],
          relationships: [{ objectId: "s_keys", qualifier: "in_session" }]
        },
        {
          id: "ev_sk_proj",
          type: "tool_updated",
          time: "2026-08-02T10:00:01.000Z",
          attributes: [{ name: "command_output", value: "KEY=sk-proj-abc1234567890XYZ9876543210abcdef" }],
          relationships: [{ objectId: "s_keys", qualifier: "in_session" }]
        },
        {
          id: "ev_sk_ant",
          type: "tool_updated",
          time: "2026-08-02T10:00:02.000Z",
          attributes: [{ name: "output", value: "sk-ant-api03-secretvalue1234567890abcdef" }],
          relationships: [{ objectId: "s_keys", qualifier: "in_session" }]
        },
        {
          id: "ev_ghp",
          type: "tool_updated",
          time: "2026-08-02T10:00:03.000Z",
          attributes: [{ name: "output", value: "token ghp_1234567890abcdef1234567890abcdef" }],
          relationships: [{ objectId: "s_keys", qualifier: "in_session" }]
        },
        {
          id: "ev_xoxb",
          type: "tool_updated",
          time: "2026-08-02T10:00:04.000Z",
          attributes: [{ name: "output", value: "slack xoxb-1234567890-abcdef1234" }],
          relationships: [{ objectId: "s_keys", qualifier: "in_session" }]
        },
        {
          id: "ev_akia",
          type: "tool_updated",
          time: "2026-08-02T10:00:05.000Z",
          attributes: [{ name: "output", value: "aws AKIAIOSFODNN7EXAMPLE" }],
          relationships: [{ objectId: "s_keys", qualifier: "in_session" }]
        }
      ]
    };

    const absenceRule = DEFAULT_EU_AI_ACT_DECLARE_RULES.filter((r) => r.id === "DEC-ABS-UNREDACTED");
    const res = evaluateDeclareRules(docWithKeys, absenceRule).results[0]!;
    expect(res.status).toBe("VIOLATED");
    expect(res.counterexample_event_ids).toEqual([
      "ev_sk_proj",
      "ev_sk_ant",
      "ev_ghp",
      "ev_xoxb",
      "ev_akia"
    ]);
    expect(res.counterexample_event_ids).not.toContain("ev_benign");

    const benignOnlyDoc: Ocel2DocLike = {
      objects: [{ id: "s_ok", type: "session", attributes: [] }],
      events: [docWithKeys.events[0]!]
    };
    const benignRes = evaluateDeclareRules(benignOnlyDoc, absenceRule).results[0]!;
    expect(benignRes.status).toBe("SATISFIED_WITNESSED");
  });

  test("regression F10: detects high_risk_profile_active without session_created and critical risk on tool_call object", () => {
    const noSessionCreatedDoc: Ocel2DocLike = {
      objects: [
        { id: "s_hr", type: "session", attributes: [{ name: "compliance_profile", value: "high-risk-annex-iii" }] },
        { id: "tc_crit", type: "tool_call", attributes: [{ name: "risk_level", value: "critical" }] }
      ],
      events: [
        {
          id: "ev_yolo_turn",
          type: "turn_started",
          time: "2026-08-02T10:00:00.000Z",
          attributes: [{ name: "mode", value: "yolo" }],
          relationships: [{ objectId: "s_hr", qualifier: "in_session" }]
        },
        {
          id: "ev_crit_tool",
          type: "tool_updated",
          time: "2026-08-02T10:00:01.000Z",
          attributes: [],
          relationships: [
            { objectId: "s_hr", qualifier: "in_session" },
            { objectId: "tc_crit", qualifier: "about_tool_call" }
          ]
        }
      ]
    };

    const rules: DeclareRule[] = [
      ...DEFAULT_EU_AI_ACT_DECLARE_RULES.filter((r) => r.id === "DEC-NOTCO-YOLO-HIGHRISK"),
      {
        id: "DEC-PREC-HIGHRISK-TOOL",
        template: "Precedence",
        activation: "tool_updated_high_risk",
        target: "permission_resolved",
        objectType: "session",
        mandatory: true
      }
    ];
    const report = evaluateDeclareRules(noSessionCreatedDoc, rules);
    const byId = new Map(report.results.map((r) => [r.id, r]));
    expect(byId.get("DEC-NOTCO-YOLO-HIGHRISK")!.status).toBe("VIOLATED");
    expect(byId.get("DEC-PREC-HIGHRISK-TOOL")!.status).toBe("VIOLATED");
    expect(byId.get("DEC-PREC-HIGHRISK-TOOL")!.counterexample_event_ids).toContain("ev_crit_tool");
  });

  test("ERRC RAISE: antiVacuityRequired fails allMandatorySatisfied on empty or unactivated logs and unifies antiVacuityPassed", () => {
    const emptyDoc: Ocel2DocLike = { objects: [], events: [] };
    const emptyReport = evaluateDeclareRules(emptyDoc, DEFAULT_EU_AI_ACT_DECLARE_RULES);
    expect(emptyReport.allMandatorySatisfied).toBe(false);
    expect(emptyReport.vacuousCount).toBe(DEFAULT_EU_AI_ACT_DECLARE_RULES.length);
    for (const r of emptyReport.results) {
      expect(r.status).toBe("SATISFIED_VACUOUS");
      expect(r.antiVacuityRequired).toBe(true);
      expect(r.antiVacuityPassed).toBe(false);
    }

    // Non-empty trace with 0 activations also fails antiVacuityRequired
    const unactivatedTurn: Ocel2DocLike = {
      objects: [{ id: "t1", type: "turn", attributes: [] }],
      events: [
        {
          id: "e1",
          type: "turn_started",
          time: "2026-08-02T10:00:00.000Z",
          attributes: [],
          relationships: [{ objectId: "t1", qualifier: "in_turn" }]
        }
      ]
    };
    const precOnly = DEFAULT_EU_AI_ACT_DECLARE_RULES.filter((r) => r.id === "DEC-PREC-ART14");
    const vacReport = evaluateDeclareRules(unactivatedTurn, precOnly);
    expect(vacReport.results[0]!.status).toBe("SATISFIED_VACUOUS");
    expect(vacReport.results[0]!.antiVacuityPassed).toBe(false);
    expect(vacReport.allMandatorySatisfied).toBe(false);
  });

  test("ERRC CREATE: DEC-PREC-ART14 enforces AlternatePrecedence and per-tool_call correlation", () => {
    const precRule = DEFAULT_EU_AI_ACT_DECLARE_RULES.filter((r) => r.id === "DEC-PREC-ART14");

    // 1 permission_resolved followed by 2 tool_updated events in the same turn -> second tool_updated is VIOLATED
    const piggybackDoc: Ocel2DocLike = {
      objects: [{ id: "t1", type: "turn", attributes: [] }],
      events: [
        {
          id: "p1",
          type: "permission_resolved",
          time: "2026-08-02T10:00:01.000Z",
          attributes: [{ name: "decision", value: "allow" }],
          relationships: [{ objectId: "t1", qualifier: "in_turn" }]
        },
        {
          id: "tool1",
          type: "tool_updated",
          time: "2026-08-02T10:00:02.000Z",
          attributes: [{ name: "tool_name", value: "Write" }],
          relationships: [{ objectId: "t1", qualifier: "in_turn" }]
        },
        {
          id: "tool2",
          type: "tool_updated",
          time: "2026-08-02T10:00:03.000Z",
          attributes: [{ name: "tool_name", value: "Bash" }],
          relationships: [{ objectId: "t1", qualifier: "in_turn" }]
        }
      ]
    };
    const piggybackRes = evaluateDeclareRules(piggybackDoc, precRule).results[0]!;
    expect(piggybackRes.status).toBe("VIOLATED");
    expect(piggybackRes.counterexample_event_ids).toEqual(["tool2"]);

    // Mismatched tool_call correlation -> VIOLATED
    const mismatchedCorrDoc: Ocel2DocLike = {
      objects: [
        { id: "t1", type: "turn", attributes: [] },
        { id: "tc_1", type: "tool_call", attributes: [] },
        { id: "tc_2", type: "tool_call", attributes: [] }
      ],
      events: [
        {
          id: "p1",
          type: "permission_resolved",
          time: "2026-08-02T10:00:01.000Z",
          attributes: [],
          relationships: [
            { objectId: "t1", qualifier: "in_turn" },
            { objectId: "tc_1", qualifier: "about_tool_call" }
          ]
        },
        {
          id: "tool2",
          type: "tool_updated",
          time: "2026-08-02T10:00:02.000Z",
          attributes: [],
          relationships: [
            { objectId: "t1", qualifier: "in_turn" },
            { objectId: "tc_2", qualifier: "about_tool_call" }
          ]
        }
      ]
    };
    const mismatchRes = evaluateDeclareRules(mismatchedCorrDoc, precRule).results[0]!;
    expect(mismatchRes.status).toBe("VIOLATED");
    expect(mismatchRes.counterexample_event_ids).toEqual(["tool2"]);

    // Interleaved correlated pairs (p1->tc_1, p2->tc_2, tool1->tc_1, tool2->tc_2) -> SATISFIED_WITNESSED
    const correlatedDoc: Ocel2DocLike = {
      objects: [
        { id: "t1", type: "turn", attributes: [] },
        { id: "tc_1", type: "tool_call", attributes: [] },
        { id: "tc_2", type: "tool_call", attributes: [] }
      ],
      events: [
        {
          id: "p1",
          type: "permission_resolved",
          time: "2026-08-02T10:00:01.000Z",
          attributes: [],
          relationships: [
            { objectId: "t1", qualifier: "in_turn" },
            { objectId: "tc_1", qualifier: "about_tool_call" }
          ]
        },
        {
          id: "p2",
          type: "permission_resolved",
          time: "2026-08-02T10:00:02.000Z",
          attributes: [],
          relationships: [
            { objectId: "t1", qualifier: "in_turn" },
            { objectId: "tc_2", qualifier: "about_tool_call" }
          ]
        },
        {
          id: "tool1",
          type: "tool_updated",
          time: "2026-08-02T10:00:03.000Z",
          attributes: [],
          relationships: [
            { objectId: "t1", qualifier: "in_turn" },
            { objectId: "tc_1", qualifier: "about_tool_call" }
          ]
        },
        {
          id: "tool2",
          type: "tool_updated",
          time: "2026-08-02T10:00:04.000Z",
          attributes: [],
          relationships: [
            { objectId: "t1", qualifier: "in_turn" },
            { objectId: "tc_2", qualifier: "about_tool_call" }
          ]
        }
      ]
    };
    const corrRes = evaluateDeclareRules(correlatedDoc, precRule).results[0]!;
    expect(corrRes.status).toBe("SATISFIED_WITNESSED");
    expect(corrRes.witness_event_ids).toEqual(expect.arrayContaining(["p1", "tool1", "p2", "tool2"]));
  });

  test("ERRC CREATE: ChainPrecedence, MP-Declare data conditions, and time-window bounds", () => {
    const doc: Ocel2DocLike = {
      objects: [{ id: "s1", type: "session", attributes: [] }],
      events: [
        {
          id: "e1",
          type: "permission_resolved",
          time: "2026-08-02T10:00:00.000Z",
          attributes: [{ name: "decision", value: "allow" }],
          relationships: [{ objectId: "s1", qualifier: "in_session" }]
        },
        {
          id: "e2",
          type: "tool_updated",
          time: "2026-08-02T10:00:00.500Z",
          attributes: [{ name: "risk_level", value: "high" }],
          relationships: [{ objectId: "s1", qualifier: "in_session" }]
        },
        {
          id: "e3",
          type: "receipt_persist",
          time: "2026-08-02T10:00:05.500Z",
          attributes: [],
          relationships: [{ objectId: "s1", qualifier: "in_session" }]
        }
      ]
    };

    const rules: DeclareRule[] = [
      {
        id: "CP-OK",
        template: "ChainPrecedence",
        activation: "tool_updated",
        target: "permission_resolved",
        activationCondition: { attribute: "risk_level", equals: "high" },
        targetCondition: { attribute: "decision", equals: "allow" },
        maxTimeDeltaMs: 1000,
        objectType: "session",
        mandatory: true
      },
      {
        id: "RESP-WINDOW-FAIL",
        template: "Response",
        activation: "tool_updated",
        target: "receipt_persist",
        maxTimeDeltaMs: 2000,
        objectType: "session",
        mandatory: true
      },
      {
        id: "RESP-WINDOW-OK",
        template: "Response",
        activation: "tool_updated",
        target: "receipt_persist",
        minTimeDeltaMs: 1000,
        maxTimeDeltaMs: 10000,
        objectType: "session",
        mandatory: true
      }
    ];

    const report = evaluateDeclareRules(doc, rules);
    const byId = new Map(report.results.map((r) => [r.id, r]));
    expect(byId.get("CP-OK")!.status).toBe("SATISFIED_WITNESSED");
    expect(byId.get("RESP-WINDOW-FAIL")!.status).toBe("VIOLATED");
    expect(byId.get("RESP-WINDOW-FAIL")!.counterexample_event_ids).toEqual(["e2"]);
    expect(byId.get("RESP-WINDOW-OK")!.status).toBe("SATISFIED_WITNESSED");
  });

  test("ERRC ELIMINATE: objectless OCEL log yields 0 session traces (no __default_session__) and report JSON omits duplicate declareResults", () => {
    const objectlessDoc: Ocel2DocLike = {
      objects: [],
      events: [
        {
          id: "orphan_1",
          type: "session_created",
          time: "2026-08-02T10:00:00.000Z",
          attributes: [],
          relationships: []
        }
      ]
    };

    const report = evaluateDeclareRules(objectlessDoc, DEFAULT_EU_AI_ACT_DECLARE_RULES);
    expect(report.allMandatorySatisfied).toBe(false);
    for (const r of report.results) {
      expect(r.evaluatedTraces).toBe(0);
      expect(r.status).toBe("SATISFIED_VACUOUS");
    }

    // Serialized JSON has `results` and does not duplicate `declareResults`
    const parsed = JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
    expect(Array.isArray(parsed.results)).toBe(true);
    expect("declareResults" in parsed).toBe(false);
    // Compatibility alias remains accessible on the live object
    expect(report.declareResults).toBe(report.results);
  });
});
