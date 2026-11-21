import { describe, expect, test } from "bun:test";
import {
  adwin,
  detectConceptDrift,
  ewmaChart,
  mannWhitneyU,
  pageHinkley,
  twoSampleKs,
  type DriftDocLike
} from "../src/compliance/concept-drift.ts";
import { ComplianceRefusalError } from "../src/compliance/config.ts";
import {
  anonymizeOcel2KAnon,
  auditRpmFact,
  type RpmDocLike
} from "../src/compliance/rpm-fact.ts";
import { Tap, verifyChain, type OcelDoc } from "../src/generated/ocel.ts";

function makeTelemetrySession(opts: {
  idx: number;
  ttftMs: number;
  serviceMs: number;
  toolName?: string;
  transitionClass?: string;
}): DriftDocLike {
  const t0 = Date.parse("2026-08-02T10:00:00.000Z") + opts.idx * 60_000;
  const iso = (d: number) => new Date(t0 + d).toISOString();
  const sId = `s_${opts.idx}`;
  const mId = `m_${opts.idx}`;
  return {
    objects: [
      { id: sId, type: "session", attributes: [] },
      {
        id: mId,
        type: "model_request",
        attributes: [
          { name: "ttft_ms", value: String(opts.ttftMs), time: iso(100) },
          { name: "service_ms", value: String(opts.serviceMs), time: iso(200) }
        ]
      }
    ],
    events: [
      {
        id: `ev_${opts.idx}_1`,
        type: "session_created",
        time: iso(0),
        attributes: [],
        relationships: [{ objectId: sId, qualifier: "in_session" }]
      },
      {
        id: `ev_${opts.idx}_2`,
        type: "model_request_completed",
        time: iso(200),
        attributes: [
          { name: "ttft_ms", value: String(opts.ttftMs) },
          { name: "service_ms", value: String(opts.serviceMs) },
          { name: "tool_name", value: opts.toolName ?? "Write" },
          { name: "transitionClass", value: opts.transitionClass ?? "code-edit" }
        ],
        relationships: [
          { objectId: sId, qualifier: "in_session" },
          { objectId: mId, qualifier: "about_model_request" }
        ]
      }
    ]
  };
}

describe("F14 Concept Drift & SPC Detectors (Chicago)", () => {
  test("pure-TS Page-Hinkley, ADWIN, EWMA, twoSampleKs, and mannWhitneyU mathematical accuracy", () => {
    const stepSeries = [
      ...Array.from({ length: 20 }, (_, i) => 100 + (i % 3)),
      ...Array.from({ length: 20 }, (_, i) => 450 + (i % 3))
    ];

    const ph = pageHinkley(stepSeries, { minInstances: 6 });
    expect(ph.driftDetected).toBe(true);
    expect(ph.firstChangeIndex).not.toBeNull();
    expect(ph.firstChangeIndex!).toBeGreaterThanOrEqual(19);
    expect(ph.direction).toBe("increase");

    const adw = adwin(stepSeries, { delta: 0.01, minWindow: 5 });
    expect(adw.driftDetected).toBe(true);
    expect(adw.shrinkCount).toBeGreaterThanOrEqual(1);

    const ew = ewmaChart(stepSeries, { baselineLength: 15 });
    expect(ew.driftDetected).toBe(true);
    expect(ew.outOfControlIndices[0]!).toBeGreaterThanOrEqual(20);

    // Two-sample KS on identical vs shifted (including ties)
    const ksSame = twoSampleKs([1, 2, 2, 3, 4, 5, 5, 6], [1, 2, 2, 3, 4, 5, 5, 6], { alpha: 0.01 });
    expect(ksSame.statistic).toBe(0);
    expect(ksSame.pValue).toBe(1);
    expect(ksSame.significant).toBe(false);

    const ksDiff = twoSampleKs(
      [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
      [50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61],
      { alpha: 0.01 }
    );
    expect(ksDiff.statistic).toBe(1);
    expect(ksDiff.pValue).toBeLessThan(0.001);
    expect(ksDiff.significant).toBe(true);

    // Exact small-sample Mann-Whitney U and tie-corrected normal approximation
    const mwSmall = mannWhitneyU([1, 2, 3, 4, 5], [10, 11, 12, 13, 14], { alpha: 0.01 });
    expect(mwSmall.uStatistic).toBe(0);
    expect(mwSmall.pValue).toBeLessThan(0.01);
    expect(mwSmall.significant).toBe(true);

    const mwTies = mannWhitneyU(
      [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6],
      [10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
      { alpha: 0.01 }
    );
    expect(mwTies.tiesCorrected).toBe(true);
    expect(mwTies.significant).toBe(true);
  });

  test("anti-false-positive: stationary heavy-tailed coding service_ms (c_s^2 >> 1) yields driftDetected: false", () => {
    const heavyTailedLogs = Array.from({ length: 40 }, (_, i) =>
      makeTelemetrySession({
        idx: i,
        ttftMs: 95 + (i % 5) * 8,
        serviceMs: i % 5 === 0 ? 120_000 : 3500
      })
    );

    const report = detectConceptDrift(heavyTailedLogs, { drift_alpha: 0.01, min_window: 20 });
    expect(report.driftDetected).toBe(false);
    expect(report.kingmanCs2ByStratum["code-edit"]!).toBeGreaterThan(1.5);
  });

  test("detects and classifies sudden, gradual, recurring, and incremental drifts with exact localization", () => {
    // 1. Sudden
    const suddenLogs = Array.from({ length: 40 }, (_, i) =>
      makeTelemetrySession({
        idx: i,
        ttftMs: i < 20 ? 100 + (i % 4) * 3 : 650 + (i % 4) * 3,
        serviceMs: 3200
      })
    );
    const suddenRep = detectConceptDrift(suddenLogs, { drift_alpha: 0.01, min_window: 10 });
    expect(suddenRep.driftDetected).toBe(true);
    expect(suddenRep.driftKind).toBe("sudden");
    expect(suddenRep.pValue).toBeLessThan(0.01);
    expect(suddenRep.findings[0]!.objectType).toBe("model_request");
    expect(suddenRep.findings[0]!.windowStart).toBeTruthy();
    expect(suddenRep.findings[0]!.windowEnd).toBeTruthy();

    // 2. Gradual (mixture / ramp over middle)
    const gradualLogs = Array.from({ length: 45 }, (_, i) =>
      makeTelemetrySession({
        idx: i,
        ttftMs: i < 15 ? 100 : i < 30 ? 100 + (i - 14) * 30 : 580,
        serviceMs: 3200
      })
    );
    const gradualRep = detectConceptDrift(gradualLogs, { drift_alpha: 0.01, min_window: 10 });
    expect(gradualRep.driftDetected).toBe(true);
    expect(["gradual", "incremental"]).toContain(gradualRep.driftKind);

    // 3. Recurring (A -> B -> A)
    const recurringLogs = Array.from({ length: 45 }, (_, i) =>
      makeTelemetrySession({
        idx: i,
        ttftMs: i >= 15 && i < 30 ? 700 + (i % 3) * 5 : 105 + (i % 3) * 5,
        serviceMs: 3200
      })
    );
    const recRep = detectConceptDrift(recurringLogs, { drift_alpha: 0.01, min_window: 10 });
    expect(recRep.driftDetected).toBe(true);
    expect(recRep.driftKind).toBe("recurring");

    // 4. Incremental (distinct monotonic quartile steps)
    const incrementalLogs = Array.from({ length: 40 }, (_, i) =>
      makeTelemetrySession({
        idx: i,
        ttftMs: Math.floor(i / 10) * 200 + 100 + (i % 3),
        serviceMs: 3200
      })
    );
    const incRep = detectConceptDrift(incrementalLogs, { drift_alpha: 0.01, min_window: 10 });
    expect(incRep.driftDetected).toBe(true);
    expect(incRep.driftKind).toBe("incremental");
  });
});

describe("F14 Responsible Process Mining (FACT) & k-Anonymity (Chicago)", () => {
  function buildChainedSession(opts: {
    id: string;
    baseMs: number;
    providerId: string;
    modelId: string;
    overseerId: string;
    failed?: boolean;
    extraStep?: boolean;
  }): OcelDoc {
    const tap = new Tap("zcode_stream");
    const iso = (d: number) => new Date(opts.baseMs + d).toISOString();
    const lines = [
      JSON.stringify({ type: "session.created", eventId: `${opts.id}_e1`, timestamp: iso(0), sessionId: opts.id, turnId: `${opts.id}_t1` }),
      JSON.stringify({ type: "turn.started", eventId: `${opts.id}_e2`, timestamp: iso(100), sessionId: opts.id, turnId: `${opts.id}_t1` }),
      JSON.stringify({ type: "permission.resolved", eventId: `${opts.id}_e3`, timestamp: iso(200), sessionId: opts.id, turnId: `${opts.id}_t1`, payload: { requestId: `${opts.id}_p1` } }),
      ...(opts.extraStep
        ? [JSON.stringify({ type: "tool.updated", eventId: `${opts.id}_e3b`, timestamp: iso(250), sessionId: opts.id, turnId: `${opts.id}_t1`, payload: { toolCallId: `${opts.id}_tc1` } })]
        : []),
      JSON.stringify({ type: opts.failed ? "turn.failed" : "turn.completed", eventId: `${opts.id}_e4`, timestamp: iso(300), sessionId: opts.id, turnId: `${opts.id}_t1` })
    ];
    tap.ingest(lines.join("\n"));
    tap.seal();
    const doc = tap.toOcel();
    // Attach provider/model/overseer metadata attributes on events without altering canonical canon() fields
    (doc.events[0]!.attributes as Array<{ name: string; value: string }>).push(
      { name: "provider_id", value: opts.providerId },
      { name: "model_id", value: opts.modelId },
      { name: "overseer_id", value: opts.overseerId }
    );
    return doc;
  }

  test("auditRpmFact binds ALIVE on intact Tap chain, PARTIAL_ALIVE on missing E2O, UNVERIFIED on tampered pi_hash, and detects fairness/confidentiality violations", () => {
    const base = Date.parse("2026-08-02T10:00:00.000Z");
    const cleanDoc = buildChainedSession({
      id: "clean_1",
      baseMs: base,
      providerId: "prov-a",
      modelId: "m-1",
      overseerId: "a".repeat(64)
    });
    expect(verifyChain(cleanDoc, "sha256")).toBeNull();
    const aliveReport = auditRpmFact(cleanDoc);
    expect(aliveReport.standing).toBe("ALIVE");
    expect(aliveReport.accuracy.chainStatus).toBe("INTACT");
    expect(aliveReport.confidentiality.passed).toBe(true);
    expect(aliveReport.explanations.length).toBeGreaterThanOrEqual(4);

    // Missing E2O links (without hash tampering) -> PARTIAL_ALIVE (never ALIVE)
    const missingE2oDoc: RpmDocLike = {
      objects: cleanDoc.objects,
      events: [
        {
          id: "unlinked_1",
          type: "session_created",
          time: new Date(base).toISOString(),
          attributes: [{ name: "overseer_id", value: "a".repeat(64) }],
          relationships: [{ objectId: cleanDoc.objects[0]!.id, qualifier: "in_session" }]
        },
        {
          id: "unlinked_2",
          type: "turn_started",
          time: new Date(base + 100).toISOString(),
          attributes: [],
          relationships: []
        }
      ]
    };
    const partialReport = auditRpmFact(missingE2oDoc);
    expect(partialReport.standing).toBe("PARTIAL_ALIVE");
    expect(partialReport.missingE2oRatio).toBeGreaterThan(0);

    // Tampered pi_hash -> UNVERIFIED
    const tampered = structuredClone(cleanDoc);
    tampered.events[1]!.attributes.find((a) => a.name === "pi_hash")!.value = "f".repeat(64);
    const tamperedReport = auditRpmFact(tampered);
    expect(tamperedReport.standing).toBe("UNVERIFIED");
    expect(tamperedReport.accuracy.chainStatus).toBe("BROKEN");

    // Operational fairness disparity across provider_id & confidentiality leak (no demographic terms)
    const fairLogs: RpmDocLike[] = [
      ...Array.from({ length: 4 }, (_, i) =>
        buildChainedSession({
          id: `pa_${i}`,
          baseMs: base + i * 1000,
          providerId: "prov-good",
          modelId: "m1",
          overseerId: "overseer@example.org",
          failed: false
        })
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        buildChainedSession({
          id: `pb_${i}`,
          baseMs: base + 10_000 + i * 1000,
          providerId: "prov-degraded",
          modelId: "m2",
          overseerId: "overseer@example.org",
          failed: i < 3 // 25% conforming vs 100% -> disparateImpact = 0.25 < 0.8
        })
      )
    ];
    const disparityReport = auditRpmFact(fairLogs, { fairnessThreshold: 0.8 });
    expect(disparityReport.fairness.passed).toBe(false);
    expect(disparityReport.fairness.disparities[0]!.dimension).toBe("provider_id");
    expect(disparityReport.confidentiality.passed).toBe(false);
    const serialized = JSON.stringify(disparityReport).toLowerCase();
    expect(serialized).not.toContain("gender");
    expect(serialized).not.toContain("ethnicity");
  });

  test("anonymizeOcel2KAnon refuses k<=1 or empty/zero salt, pseudonymizes actors, suppresses <k outlier, and re-seals valid chain", () => {
    const base = Date.parse("2026-08-02T10:00:00.000Z");

    // Build single merged OcelDoc with 5 normal sessions + 1 unique outlier session
    const merged: OcelDoc = {
      objectTypes: [],
      eventTypes: [],
      objects: [
        { id: "overseer:alice@corp.eu", type: "human_overseer", attributes: [{ name: "overseer_id", value: "alice@corp.eu" }], relationships: [] }
      ],
      events: []
    };

    for (let i = 0; i < 6; i++) {
      const isOutlier = i === 5;
      const d = buildChainedSession({
        id: isOutlier ? "sess_outlier" : `sess_${i}`,
        baseMs: base + i * 10_000,
        providerId: "zai",
        modelId: "glm-5",
        overseerId: "alice@corp.eu",
        extraStep: isOutlier
      });
      merged.objects.push(...d.objects);
      for (const ev of d.events) {
        ev.relationships.push({ objectId: "overseer:alice@corp.eu", qualifier: "approved_by" });
        merged.events.push(ev);
      }
    }

    // Re-seal merged chain before k-anon
    expect(() => anonymizeOcel2KAnon(merged, 1, "valid-salt-123")).toThrow(ComplianceRefusalError);
    expect(() => anonymizeOcel2KAnon(merged, 0, "valid-salt-123")).toThrow(ComplianceRefusalError);
    expect(() => anonymizeOcel2KAnon(merged, 5, "")).toThrow(ComplianceRefusalError);
    expect(() => anonymizeOcel2KAnon(merged, 5, "000000000000")).toThrow(ComplianceRefusalError);

    const res = anonymizeOcel2KAnon(merged, 5, "eu-ai-act-salt-2026");
    expect(res.totalTraces).toBe(6);
    expect(res.suppressedTraces).toBe(1);
    expect(res.retainedTraces).toBe(5);
    expect(res.minEquivalenceClassSize).toBeGreaterThanOrEqual(5);

    const serialized = JSON.stringify(res.doc);
    expect(serialized).not.toContain("alice@corp.eu");
    expect(serialized).not.toContain("sess_outlier");

    // Re-sealed chain must pass verifyChain AND auditRpmFact ALIVE!
    expect(verifyChain(res.doc as OcelDoc, "sha256")).toBeNull();
    const postAudit = auditRpmFact(res.doc);
    expect(postAudit.standing).toBe("ALIVE");
    expect(postAudit.confidentiality.passed).toBe(true);
  });

  test("regression F14: detects recurring control-flow edge drift, tool_call service_ms objectType, and localized pValue", () => {
    const base = Date.parse("2026-08-02T10:00:00.000Z");
    const docs: DriftDocLike[] = [];
    for (let i = 0; i < 30; i++) {
      const iso = (d: number) => new Date(base + i * 60_000 + d).toISOString();
      const sId = `sess_cf_${i}`;
      const tcId = `tc_cf_${i}`;
      const isAlt = i >= 10 && i < 20;
      const isLateBurst = i >= 22;
      docs.push({
        objects: [
          { id: sId, type: "session", attributes: [] },
          { id: tcId, type: "tool_call", attributes: [{ name: "tool_name", value: "Bash" }] }
        ],
        events: [
          { id: `e_${i}_1`, type: "turn_started", time: iso(0), attributes: [], relationships: [{ objectId: sId, qualifier: "in_session" }] },
          {
            id: `e_${i}_2`,
            type: isAlt ? "tool_alt" : "tool_main",
            time: iso(100),
            attributes: [
              { name: "service_ms", value: isLateBurst ? "12000" : "200" },
              { name: "ttft_ms", value: isLateBurst ? "900" : "100" }
            ],
            relationships: [
              { objectId: sId, qualifier: "in_session" },
              { objectId: tcId, qualifier: "about_tool_call" }
            ]
          },
          { id: `e_${i}_3`, type: "turn_completed", time: iso(200), attributes: [], relationships: [{ objectId: sId, qualifier: "in_session" }] }
        ]
      });
    }

    const rep = detectConceptDrift(docs, { drift_alpha: 0.01, min_window: 10 });
    expect(rep.driftDetected).toBe(true);
    const cfFindings = rep.findings.filter((f) => f.metric === "control_flow_edge");
    expect(cfFindings.length).toBeGreaterThanOrEqual(1);
    expect(cfFindings.some((f) => f.driftType === "recurring")).toBe(true);

    const svcToolFinding = rep.findings.find((f) => f.metric === "service_ms");
    expect(svcToolFinding).toBeDefined();
    expect(svcToolFinding!.objectType).toBe("tool_call");

    const ttftFinding = rep.findings.find((f) => f.metric === "ttft_ms");
    expect(ttftFinding).toBeDefined();
    expect(ttftFinding!.pValue).toBeLessThan(0.01);
  });

  test("regression F14: anonymizeOcel2KAnon eliminates <k post-generalization quasi-classes, auditRpmFact catches empty-objects dangling E2O & raw actor IDs", () => {
    const base = Date.parse("2026-08-02T10:00:00.000Z");

    // 1. Mixed quasi-identifier case: 5 (zai) + 1 (anthropic) with k=5 -> no "*" singleton!
    const buildQuasiDoc = (countA: number, countB: number): OcelDoc => {
      const objects: OcelDoc["objects"] = [];
      const events: OcelDoc["events"] = [];
      for (let i = 0; i < countA + countB; i++) {
        const isMinor = i >= countA;
        const d = buildChainedSession({
          id: `q_${i}`,
          baseMs: base + i * 10_000,
          providerId: isMinor ? "anthropic_unique" : "zai",
          modelId: isMinor ? "claude_unique" : "glm-5",
          overseerId: "a".repeat(64)
        });
        objects.push(...d.objects);
        events.push(...d.events);
      }
      return { objectTypes: [], eventTypes: [], objects, events };
    };

    const res5 = anonymizeOcel2KAnon(buildQuasiDoc(5, 1), 5, "salt-2026-a");
    expect(res5.minEquivalenceClassSize).toBeGreaterThanOrEqual(5);
    const eqCounts5 = new Map<string, number>();
    const evBySess = new Map<string, typeof res5.doc.events>();
    for (const ev of res5.doc.events) {
      const sRel = ev.relationships.find((r) => r.qualifier === "in_session");
      const sid = sRel?.objectId ?? ev.id;
      if (!evBySess.has(sid)) evBySess.set(sid, []);
      evBySess.get(sid)!.push(ev);
    }
    for (const evs of evBySess.values()) {
      const variant = evs.map((e) => e.type).join("->");
      const p = evs[0]!.attributes.find((a: { name: string }) => a.name === "provider_id")?.value ?? "*";
      const m = evs[0]!.attributes.find((a: { name: string }) => a.name === "model_id")?.value ?? "*";
      const key = `${variant}::${p}|${m}`;
      eqCounts5.set(key, (eqCounts5.get(key) ?? 0) + 1);
    }
    for (const sz of eqCounts5.values()) {
      expect(sz).toBeGreaterThanOrEqual(5);
    }

    // 2. Empty doc.objects with non-empty event relationships must NOT return ALIVE
    const cleanDoc = buildChainedSession({
      id: "empty_objs",
      baseMs: base,
      providerId: "zai",
      modelId: "glm-5",
      overseerId: "a".repeat(64)
    });
    const danglingReport = auditRpmFact({ objects: [], events: cleanDoc.events });
    expect(danglingReport.accuracy.danglingE2oCount).toBeGreaterThan(0);
    expect(danglingReport.standing).toBe("PARTIAL_ALIVE");

    // 3. Raw actor object id on ACTOR_OBJECT_TYPES caught by auditRpmFact, and pseudonymized to pseudo_<64 hex>
    const rawActorDoc: RpmDocLike = {
      objects: [
        { id: "bob_plain_username", type: "human_overseer", attributes: [], relationships: [] },
        ...cleanDoc.objects
      ],
      events: cleanDoc.events.map((ev) => ({
        ...ev,
        relationships: [...ev.relationships, { objectId: "bob_plain_username", qualifier: "approved_by" }]
      }))
    };
    const rawActorAudit = auditRpmFact(rawActorDoc);
    expect(rawActorAudit.confidentiality.passed).toBe(false);
    expect(rawActorAudit.confidentiality.violations.some((v) => v.kind === "raw_actor_id" && v.field === "id")).toBe(true);

    // Anonymizing 2 identical traces with k=2 produces pseudo_<64 hex> and passes confidentiality
    const twoTraces: RpmDocLike = {
      objects: [
        { id: "bob_plain_username", type: "human_overseer", attributes: [], relationships: [] },
        ...buildChainedSession({ id: "t1", baseMs: base, providerId: "zai", modelId: "glm-5", overseerId: "a".repeat(64) }).objects,
        ...buildChainedSession({ id: "t2", baseMs: base + 10_000, providerId: "zai", modelId: "glm-5", overseerId: "a".repeat(64) }).objects
      ],
      events: [
        ...buildChainedSession({ id: "t1", baseMs: base, providerId: "zai", modelId: "glm-5", overseerId: "a".repeat(64) }).events,
        ...buildChainedSession({ id: "t2", baseMs: base + 10_000, providerId: "zai", modelId: "glm-5", overseerId: "a".repeat(64) }).events
      ].map((ev) => ({
        ...ev,
        relationships: [...ev.relationships, { objectId: "bob_plain_username", qualifier: "approved_by" }]
      }))
    };
    const anon2 = anonymizeOcel2KAnon(twoTraces, 2, "salt-2026-b");
    const actorObj = anon2.doc.objects.find((o) => o.type === "human_overseer")!;
    expect(actorObj.id).toMatch(/^pseudo_[0-9a-f]{64}$/);
    const postAnonAudit = auditRpmFact(anon2.doc);
    expect(postAnonAudit.confidentiality.passed).toBe(true);
  });

  test("regression F14: anonymizeOcel2KAnon generalizes object-level and hybrid event+object quasi-identifiers without <k leaks", () => {
    const base = Date.parse("2026-08-02T10:00:00.000Z");

    // 1. Pure object-attributed OCEL 2.0 doc (repo on session, provider_id/model_id on model_request) with k=3
    const pureObjDoc: RpmDocLike = { objects: [], events: [] };
    const pureObjs: RpmDocLike["objects"][number][] = [];
    const pureEvs: RpmDocLike["events"][number][] = [];
    for (let i = 0; i < 4; i++) {
      const iso = (d: number) => new Date(base + i * 10_000 + d).toISOString();
      const isUnique = i === 3;
      const sId = `pure_s_${i}`;
      const mId = `pure_m_${i}`;
      pureObjs.push(
        {
          id: sId,
          type: "session",
          attributes: [{ name: "repo", value: isUnique ? "r_secret_obj" : "r1", time: iso(0) }],
          relationships: []
        },
        {
          id: mId,
          type: "model_request",
          attributes: [
            { name: "provider_id", value: isUnique ? "p_unique" : "p1", time: iso(100) },
            { name: "model_id", value: isUnique ? "m_unique" : "m1", time: iso(100) }
          ],
          relationships: []
        }
      );
      pureEvs.push(
        {
          id: `pure_ev_${i}_1`,
          type: "session_created",
          time: iso(0),
          attributes: [],
          relationships: [{ objectId: sId, qualifier: "in_session" }]
        },
        {
          id: `pure_ev_${i}_2`,
          type: "model_request_completed",
          time: iso(100),
          attributes: [],
          relationships: [
            { objectId: sId, qualifier: "in_session" },
            { objectId: mId, qualifier: "about_model_request" }
          ]
        }
      );
    }
    const pureRes = anonymizeOcel2KAnon(
      { ...pureObjDoc, objects: pureObjs, events: pureEvs },
      3,
      "salt-pure-obj"
    );
    expect(pureRes.minEquivalenceClassSize).toBeGreaterThanOrEqual(3);
    const pureSerialized = JSON.stringify(pureRes.doc);
    expect(pureSerialized).not.toContain("r_secret_obj");
    expect(pureSerialized).not.toContain("p_unique");
    expect(pureSerialized).not.toContain("m_unique");

    // 2. Hybrid event+object OCEL 2.0 doc with intact pi_hash chain and k=3
    const hybridObjects: OcelDoc["objects"] = [];
    const hybridEvents: OcelDoc["events"] = [];
    for (let i = 0; i < 4; i++) {
      const isUnique = i === 3;
      const d = buildChainedSession({
        id: `hyb_${i}`,
        baseMs: base + i * 10_000,
        providerId: isUnique ? "p_unique_hybrid" : "p1",
        modelId: isUnique ? "m_unique_hybrid" : "m1",
        overseerId: "a".repeat(64)
      });
      const sessObj = d.objects.find((o) => o.type === "session")!;
      sessObj.attributes.push({
        name: "repo",
        value: isUnique ? "r_secret_hybrid" : "r1",
        time: new Date(base + i * 10_000).toISOString()
      });
      const mrId = `hyb_mr_${i}`;
      d.objects.push({
        id: mrId,
        type: "model_request",
        attributes: [
          { name: "provider_id", value: isUnique ? "p_unique_hybrid" : "p1", time: new Date(base + i * 10_000).toISOString() },
          { name: "model_id", value: isUnique ? "m_unique_hybrid" : "m1", time: new Date(base + i * 10_000).toISOString() }
        ],
        relationships: []
      });
      d.events[0]!.relationships.push({ objectId: mrId, qualifier: "about_model_request" });
      d.events[0]!.attributes.push({ name: "repo", value: isUnique ? "r_secret_hybrid" : "r1" });
      hybridObjects.push(...d.objects);
      hybridEvents.push(...d.events);
    }

    const hybridRes = anonymizeOcel2KAnon(
      { objectTypes: [], eventTypes: [], objects: hybridObjects, events: hybridEvents },
      3,
      "salt-hybrid-obj"
    );
    expect(hybridRes.minEquivalenceClassSize).toBeGreaterThanOrEqual(3);
    const hybridSerialized = JSON.stringify(hybridRes.doc);
    expect(hybridSerialized).not.toContain("r_secret_hybrid");
    expect(hybridSerialized).not.toContain("p_unique_hybrid");
    expect(hybridSerialized).not.toContain("m_unique_hybrid");
    expect(verifyChain(hybridRes.doc as OcelDoc, "sha256")).toBeNull();
    const hybridAudit = auditRpmFact(hybridRes.doc);
    expect(hybridAudit.standing).toBe("ALIVE");
    expect(hybridAudit.confidentiality.passed).toBe(true);

    // 3. Shared object split across generalized and non-generalized traces (k=2)
    const splitObjects: OcelDoc["objects"] = [
      { id: "prov_shared", type: "provider", attributes: [{ name: "provider_id", value: "p_shared", time: new Date(base).toISOString() }], relationships: [] }
    ];
    const splitEvents: OcelDoc["events"] = [];
    const modelIds = ["m_common", "m_common", "m_u1", "m_u2"];
    for (let i = 0; i < 4; i++) {
      const d = buildChainedSession({
        id: `split_${i}`,
        baseMs: base + i * 10_000,
        providerId: "p_shared",
        modelId: modelIds[i]!,
        overseerId: "a".repeat(64)
      });
      for (const ev of d.events) {
        ev.relationships.push({ objectId: "prov_shared", qualifier: "uses_provider" });
      }
      splitObjects.push(...d.objects);
      splitEvents.push(...d.events);
    }
    const splitRes = anonymizeOcel2KAnon(
      { objectTypes: [], eventTypes: [], objects: splitObjects, events: splitEvents },
      2,
      "salt-split-obj"
    );
    expect(splitRes.minEquivalenceClassSize).toBeGreaterThanOrEqual(2);
    expect(splitRes.generalizedTraces).toBe(2);
    const splitSerialized = JSON.stringify(splitRes.doc);
    expect(splitSerialized).not.toContain("m_u1");
    expect(splitSerialized).not.toContain("m_u2");
    const origShared = splitRes.doc.objects.find((o) => o.id === "prov_shared");
    const genShared = splitRes.doc.objects.find((o) => o.id === "prov_shared__gen");
    expect(origShared).toBeDefined();
    expect(genShared).toBeDefined();
    expect((origShared!.attributes as Array<{ name: string; value: string }>).find((a) => a.name === "provider_id")?.value).toBe("p_shared");
    expect((genShared!.attributes as Array<{ name: string; value: string }>).find((a) => a.name === "provider_id")?.value).toBe("*");
    expect(verifyChain(splitRes.doc as OcelDoc, "sha256")).toBeNull();
    expect(auditRpmFact(splitRes.doc).standing).toBe("ALIVE");
  });

  test("regression F14: classifies 4-phase alternating control-flow and numeric drifts as recurring", () => {
    const base = Date.parse("2026-08-02T10:00:00.000Z");

    // 1. 4-phase alternating control-flow drift: [0..9] tool_main, [10..19] tool_alt, [20..29] tool_main, [30..39] tool_alt
    const cfDocs: DriftDocLike[] = [];
    for (let i = 0; i < 40; i++) {
      const iso = (d: number) => new Date(base + i * 60_000 + d).toISOString();
      const sId = `sess_4p_${i}`;
      const isAlt = (i >= 10 && i < 20) || (i >= 30 && i < 40);
      cfDocs.push({
        objects: [{ id: sId, type: "session", attributes: [] }],
        events: [
          { id: `cf4_${i}_1`, type: "turn_started", time: iso(0), attributes: [], relationships: [{ objectId: sId, qualifier: "in_session" }] },
          { id: `cf4_${i}_2`, type: isAlt ? "tool_alt" : "tool_main", time: iso(100), attributes: [], relationships: [{ objectId: sId, qualifier: "in_session" }] },
          { id: `cf4_${i}_3`, type: "turn_completed", time: iso(200), attributes: [], relationships: [{ objectId: sId, qualifier: "in_session" }] }
        ]
      });
    }
    const cfRep = detectConceptDrift(cfDocs, { drift_alpha: 0.01, min_window: 10 });
    expect(cfRep.driftDetected).toBe(true);
    expect(cfRep.driftKind).toBe("recurring");
    expect(cfRep.findings.some((f) => f.metric === "control_flow_edge" && f.driftType === "recurring")).toBe(true);

    // 2. 4-phase alternating numeric ttft_ms drift
    const numDocs = Array.from({ length: 40 }, (_, i) =>
      makeTelemetrySession({
        idx: i,
        ttftMs: (i >= 10 && i < 20) || (i >= 30 && i < 40) ? 700 + (i % 3) * 5 : 105 + (i % 3) * 5,
        serviceMs: 3200
      })
    );
    const numRep = detectConceptDrift(numDocs, { drift_alpha: 0.01, min_window: 10 });
    expect(numRep.driftDetected).toBe(true);
    expect(numRep.driftKind).toBe("recurring");
  });

  test("regression F14 Iter4: anonymizeOcel2KAnon preserves transitive E2O->O2O chains and propagates O2O shared-object splits", () => {
    const base = Date.parse("2026-08-02T12:00:00.000Z");

    // 1. Transitive E2O -> O2O chain (event -> session -> model_request -> provider, k=3)
    const chainObjs: OcelDoc["objects"] = [];
    const chainEvs: OcelDoc["events"] = [];
    for (let i = 0; i < 4; i++) {
      const iso = (d: number) => new Date(base + i * 10_000 + d).toISOString();
      const isUnique = i === 3;
      const sId = `tr_s_${i}`;
      const mId = `tr_m_${i}`;
      const pId = `tr_p_${i}`;
      chainObjs.push(
        {
          id: sId,
          type: "session",
          attributes: [{ name: "repo", value: isUnique ? "r_chain_unique" : "r_common", time: iso(0) }],
          relationships: [{ objectId: mId, qualifier: "spawned" }]
        },
        {
          id: mId,
          type: "model_request",
          attributes: [{ name: "model_id", value: isUnique ? "m_chain_unique" : "m_common", time: iso(50) }],
          relationships: [{ objectId: pId, qualifier: "uses_provider" }]
        },
        {
          id: pId,
          type: "provider",
          attributes: [{ name: "provider_id", value: isUnique ? "p_chain_unique" : "p_common", time: iso(100) }],
          relationships: []
        }
      );
      const tap = new Tap("zcode_stream");
      tap.ingest(
        JSON.stringify({
          type: "turn.completed",
          eventId: `tr_ev_${i}`,
          timestamp: iso(100),
          sessionId: sId
        })
      );
      tap.seal();
      const tDoc = tap.toOcel();
      chainEvs.push(...tDoc.events);
    }

    const chainRes = anonymizeOcel2KAnon(
      { objectTypes: [], eventTypes: [], objects: chainObjs, events: chainEvs },
      3,
      "salt-o2o-chain"
    );
    expect(chainRes.minEquivalenceClassSize).toBeGreaterThanOrEqual(3);
    expect(chainRes.doc.objects.filter((o) => o.type === "session").length).toBe(4);
    expect(chainRes.doc.objects.filter((o) => o.type === "model_request").length).toBe(4);
    expect(chainRes.doc.objects.filter((o) => o.type === "provider").length).toBe(4);
    expect(chainRes.doc.objects.find((o) => o.id === "tr_s_3")?.relationships).toEqual([
      { objectId: "tr_m_3", qualifier: "spawned" }
    ]);
    expect(chainRes.doc.objects.find((o) => o.id === "tr_m_3")?.relationships).toEqual([
      { objectId: "tr_p_3", qualifier: "uses_provider" }
    ]);
    const chainJson = JSON.stringify(chainRes.doc);
    expect(chainJson).not.toContain("r_chain_unique");
    expect(chainJson).not.toContain("m_chain_unique");
    expect(chainJson).not.toContain("p_chain_unique");
    expect(verifyChain(chainRes.doc as OcelDoc, "sha256")).toBeNull();
    expect(auditRpmFact(chainRes.doc).standing).toBe("ALIVE");

    // 2. O2O shared-object splitting across:
    //    - event -> session -> prov_o2o_shared (session has no quasi attrs)
    //    - event -> mid_hub -> prov_tr_shared (shared hub pointing to shared provider)
    //    - event -> model_request -> uses_provider -> prov_shared / prov_other
    const o2oSplitObjs: OcelDoc["objects"] = [
      {
        id: "prov_o2o_shared",
        type: "provider",
        attributes: [{ name: "provider_id", value: "p_o2o_keep", time: new Date(base).toISOString() }],
        relationships: []
      },
      {
        id: "prov_tr_shared",
        type: "provider",
        attributes: [{ name: "provider_id", value: "p_tr_keep", time: new Date(base).toISOString() }],
        relationships: []
      },
      {
        id: "prov_shared",
        type: "provider",
        attributes: [{ name: "provider_id", value: "p_mr_keep", time: new Date(base).toISOString() }],
        relationships: []
      },
      {
        id: "prov_other",
        type: "provider",
        attributes: [{ name: "provider_id", value: "p_other_secret", time: new Date(base).toISOString() }],
        relationships: []
      },
      {
        id: "mid_hub",
        type: "turn",
        attributes: [],
        relationships: [{ objectId: "prov_tr_shared", qualifier: "uses_provider" }]
      }
    ];
    const o2oSplitEvs: OcelDoc["events"] = [];
    const mrModels = ["m_keep", "m_keep", "m_u1", "m_u2"];
    for (let i = 0; i < 4; i++) {
      const iso = (d: number) => new Date(base + (i + 1) * 10_000 + d).toISOString();
      const sId = `sp_s_${i}`;
      const mrId = `sp_mr_${i}`;
      o2oSplitObjs.push(
        {
          id: sId,
          type: "session",
          attributes: [],
          relationships: [{ objectId: "prov_o2o_shared", qualifier: "uses_provider" }]
        },
        {
          id: mrId,
          type: "model_request",
          attributes: [{ name: "model_id", value: mrModels[i]!, time: iso(10) }],
          relationships: [{ objectId: i === 3 ? "prov_other" : "prov_shared", qualifier: "uses_provider" }]
        }
      );
      const tap = new Tap("zcode_stream");
      tap.ingest(
        JSON.stringify({
          type: "turn.completed",
          eventId: `sp_ev_${i}`,
          timestamp: iso(10),
          sessionId: sId
        })
      );
      tap.seal();
      const tDoc = tap.toOcel();
      tDoc.events[0]!.relationships.push(
        { objectId: mrId, qualifier: "about_model_request" },
        { objectId: "mid_hub", qualifier: "in_turn" }
      );
      o2oSplitEvs.push(...tDoc.events);
    }

    const o2oSplitRes = anonymizeOcel2KAnon(
      { objectTypes: [], eventTypes: [], objects: o2oSplitObjs, events: o2oSplitEvs },
      2,
      "salt-o2o-split"
    );
    expect(o2oSplitRes.generalizedTraces).toBe(2);
    expect(o2oSplitRes.minEquivalenceClassSize).toBeGreaterThanOrEqual(2);

    const getAttr = (id: string, key: string) =>
      (o2oSplitRes.doc.objects.find((o) => o.id === id)?.attributes as Array<{ name: string; value: unknown }> | undefined)?.find(
        (a) => a.name === key
      )?.value;

    // Non-generalized originals retain original provider_id and relationships
    expect(getAttr("prov_o2o_shared", "provider_id")).toBe("p_o2o_keep");
    expect(getAttr("prov_tr_shared", "provider_id")).toBe("p_tr_keep");
    expect(getAttr("prov_shared", "provider_id")).toBe("p_mr_keep");
    expect(o2oSplitRes.doc.objects.find((o) => o.id === "sp_s_0")?.relationships).toEqual([
      { objectId: "prov_o2o_shared", qualifier: "uses_provider" }
    ]);
    expect(o2oSplitRes.doc.objects.find((o) => o.id === "mid_hub")?.relationships).toEqual([
      { objectId: "prov_tr_shared", qualifier: "uses_provider" }
    ]);

    // Generalized splits created, generalized, retained, and linked cleanly
    expect(getAttr("prov_o2o_shared__gen", "provider_id")).toBe("*");
    expect(getAttr("prov_tr_shared__gen", "provider_id")).toBe("*");
    expect(getAttr("prov_shared__gen", "provider_id")).toBe("*");
    expect(getAttr("prov_other", "provider_id")).toBe("*");
    expect(o2oSplitRes.doc.objects.find((o) => o.id === "sp_s_2")?.relationships).toEqual([
      { objectId: "prov_o2o_shared__gen", qualifier: "uses_provider" }
    ]);
    expect(o2oSplitRes.doc.objects.find((o) => o.id === "sp_mr_2")?.relationships).toEqual([
      { objectId: "prov_shared__gen", qualifier: "uses_provider" }
    ]);
    expect(o2oSplitRes.doc.objects.find((o) => o.id === "sp_mr_3")?.relationships).toEqual([
      { objectId: "prov_other", qualifier: "uses_provider" }
    ]);
    expect(o2oSplitRes.doc.objects.find((o) => o.id === "mid_hub__gen")?.relationships).toEqual([
      { objectId: "prov_tr_shared__gen", qualifier: "uses_provider" }
    ]);
    const genEvent = o2oSplitRes.doc.events.find((e) => e.id === "sp_ev_2")!;
    expect(genEvent.relationships.some((r) => r.objectId === "mid_hub__gen")).toBe(true);
    expect(genEvent.relationships.some((r) => r.objectId === "mid_hub")).toBe(false);

    const o2oJson = JSON.stringify(o2oSplitRes.doc);
    expect(o2oJson).not.toContain("m_u1");
    expect(o2oJson).not.toContain("m_u2");
    expect(o2oJson).not.toContain("p_other_secret");
    expect(verifyChain(o2oSplitRes.doc as OcelDoc, "sha256")).toBeNull();
    expect(auditRpmFact(o2oSplitRes.doc).standing).toBe("ALIVE");
  });

  test("regression F14 Iter4: detects 5-phase and 6-phase recurring service_ms & control_flow_edge drifts while rejecting stationary heavy-tailed streams", () => {
    const base = Date.parse("2026-08-02T14:00:00.000Z");

    // 1. 5-phase alternating service_ms (N=50, 10 per phase: 400ms vs 5000ms)
    const svc5Docs = Array.from({ length: 50 }, (_, i) =>
      makeTelemetrySession({
        idx: i,
        ttftMs: 110 + (i % 3),
        serviceMs: Math.floor(i / 10) % 2 === 1 ? 5000 + (i % 5) * 10 : 400 + (i % 5) * 5
      })
    );
    const svc5Rep = detectConceptDrift(svc5Docs, { drift_alpha: 0.01, min_window: 10 });
    expect(svc5Rep.driftDetected).toBe(true);
    expect(svc5Rep.driftKind).toBe("recurring");
    expect(svc5Rep.pValue).toBeLessThan(0.01);

    // 2. 6-phase alternating service_ms (N=60, 10 per phase: 400ms vs 5000ms)
    const svc6Docs = Array.from({ length: 60 }, (_, i) =>
      makeTelemetrySession({
        idx: i,
        ttftMs: 110 + (i % 3),
        serviceMs: Math.floor(i / 10) % 2 === 1 ? 5000 + (i % 5) * 10 : 400 + (i % 5) * 5
      })
    );
    const svc6Rep = detectConceptDrift(svc6Docs, { drift_alpha: 0.01, min_window: 10 });
    expect(svc6Rep.driftDetected).toBe(true);
    expect(svc6Rep.driftKind).toBe("recurring");
    expect(svc6Rep.pValue).toBeLessThan(0.01);

    // 3. 5-phase alternating control_flow_edge (N=40, 8 per phase: tool_main vs tool_alt)
    const cf5Docs: DriftDocLike[] = [];
    for (let i = 0; i < 40; i++) {
      const iso = (d: number) => new Date(base + i * 60_000 + d).toISOString();
      const sId = `sess_5p_${i}`;
      const isAlt = Math.floor(i / 8) % 2 === 1;
      cf5Docs.push({
        objects: [{ id: sId, type: "session", attributes: [] }],
        events: [
          { id: `cf5_${i}_1`, type: "turn_started", time: iso(0), attributes: [], relationships: [{ objectId: sId, qualifier: "in_session" }] },
          { id: `cf5_${i}_2`, type: isAlt ? "tool_alt" : "tool_main", time: iso(100), attributes: [], relationships: [{ objectId: sId, qualifier: "in_session" }] },
          { id: `cf5_${i}_3`, type: "turn_completed", time: iso(200), attributes: [], relationships: [{ objectId: sId, qualifier: "in_session" }] }
        ]
      });
    }
    const cf5Rep = detectConceptDrift(cf5Docs, { drift_alpha: 0.01, min_window: 10 });
    expect(cf5Rep.driftDetected).toBe(true);
    expect(cf5Rep.driftKind).toBe("recurring");
    expect(cf5Rep.pValue).toBeLessThan(0.01);
    expect(cf5Rep.findings.some((f) => f.metric === "control_flow_edge" && f.driftType === "recurring")).toBe(true);

    // 4. Stationary Pareto & Log-normal heavy-tailed service_ms (cs2 > 1.5) -> driftDetected: false
    const makeLcg = (seed: number) => {
      let s = seed >>> 0;
      return () => {
        s = (1664525 * s + 1013904223) >>> 0;
        return (s + 0.5) / 4294967296;
      };
    };
    const randP = makeLcg(20260802);
    const paretoDocs = Array.from({ length: 40 }, (_, i) =>
      makeTelemetrySession({
        idx: i,
        ttftMs: 100 + (i % 4) * 3,
        serviceMs: 250 * Math.pow(1 - randP(), -1 / 1.25)
      })
    );
    const paretoRep = detectConceptDrift(paretoDocs, { drift_alpha: 0.01, min_window: 20 });
    expect(paretoRep.driftDetected).toBe(false);
    expect(paretoRep.kingmanCs2ByStratum["code-edit"]!).toBeGreaterThan(1.5);

    const randL = makeLcg(20260803);
    const lognormDocs = Array.from({ length: 40 }, (_, i) => {
      const u1 = randL();
      const u2 = randL();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return makeTelemetrySession({
        idx: i,
        ttftMs: 100 + (i % 4) * 3,
        serviceMs: 400 * Math.exp(1.5 * z)
      });
    });
    const lognormRep = detectConceptDrift(lognormDocs, { drift_alpha: 0.01, min_window: 20 });
    expect(lognormRep.driftDetected).toBe(false);
    expect(lognormRep.kingmanCs2ByStratum["code-edit"]!).toBeGreaterThan(1.5);
  });

  test("regression F14 Iter6: shared actor split clones preserve ^pseudo_[0-9a-f]{64}$ IDs and pass auditRpmFact across Cases A, B, and C", () => {
    const base = Date.parse("2026-08-02T16:00:00.000Z");
    const actorTypes = new Set(["human_overseer", "worker", "actor", "user", "overseer"]);
    const pseudoIdRe = /^pseudo_[0-9a-f]{64}$/;
    const readAttr = (
      attrs: RpmDocLike["objects"][number]["attributes"],
      key: string
    ): unknown =>
      Array.isArray(attrs)
        ? (attrs as Array<{ name: string; value: unknown }>).find((a) => a.name === key)?.value
        : (attrs as Record<string, unknown>)[key];

    const assertActorsAndAudit = (res: ReturnType<typeof anonymizeOcel2KAnon>) => {
      const actors = res.doc.objects.filter((o) => actorTypes.has(o.type));
      expect(actors.length).toBeGreaterThanOrEqual(2);
      for (const actor of actors) {
        expect(actor.id).toMatch(pseudoIdRe);
      }
      expect(new Set(actors.map((a) => a.id)).size).toBe(actors.length);
      expect(res.minEquivalenceClassSize).toBeGreaterThanOrEqual(2);
      expect(verifyChain(res.doc as OcelDoc, "sha256")).toBeNull();
      const audit = auditRpmFact(res.doc);
      expect(audit.confidentiality.passed).toBe(true);
      expect(audit.confidentiality.violations).toEqual([]);
      expect(audit.passed).toBe(true);
      expect(audit.standing).toBe("ALIVE");
      return { actors, audit };
    };

    // Case A: Shared human_overseer carrying quasi-identifier `repo` across generalized and non-generalized traces (k=2)
    const caseAObjs: OcelDoc["objects"] = [
      {
        id: "ov_alice",
        type: "human_overseer",
        attributes: [
          { name: "repo", value: "r_shared", time: new Date(base).toISOString() },
          { name: "overseer_id", value: "alice@corp.eu", time: new Date(base).toISOString() }
        ],
        relationships: []
      }
    ];
    const caseAEvs: OcelDoc["events"] = [];
    const caseAModels = ["m_common", "m_common", "m_u1", "m_u2"];
    for (let i = 0; i < 4; i++) {
      const d = buildChainedSession({
        id: `case_a_${i}`,
        baseMs: base + i * 10_000,
        providerId: "p_common",
        modelId: caseAModels[i]!,
        overseerId: "alice@corp.eu"
      });
      for (const ev of d.events) {
        ev.relationships.push({ objectId: "ov_alice", qualifier: "approved_by" });
      }
      caseAObjs.push(...d.objects);
      caseAEvs.push(...d.events);
    }
    const caseADoc: OcelDoc = { objectTypes: [], eventTypes: [], objects: caseAObjs, events: caseAEvs };
    const caseARes = anonymizeOcel2KAnon(caseADoc, 2, "salt-f14-case-a");
    const caseAReplay = anonymizeOcel2KAnon(caseADoc, 2, "salt-f14-case-a");
    expect(caseARes.generalizedTraces).toBe(2);
    expect(caseARes.retainedTraces).toBe(4);
    const { actors: caseAActors } = assertActorsAndAudit(caseARes);
    expect(caseAActors.length).toBe(2);
    expect(caseAReplay.doc.objects.filter((o) => o.type === "human_overseer").map((o) => o.id)).toEqual(
      caseAActors.map((o) => o.id)
    );
    expect(caseAActors.some((a) => readAttr(a.attributes, "repo") === "r_shared")).toBe(true);
    expect(caseAActors.some((a) => readAttr(a.attributes, "repo") === "*")).toBe(true);
    const caseAJson = JSON.stringify(caseARes.doc);
    expect(caseAJson).not.toContain("alice@corp.eu");
    expect(caseAJson).not.toContain("ov_alice");
    expect(caseAJson).not.toContain("m_u1");
    expect(caseAJson).not.toContain("m_u2");

    // Case B: Shared worker (no quasi-attr on itself) pointing via O2O `uses_provider` to shared provider with `provider_id`
    const caseBObjs: OcelDoc["objects"] = [
      {
        id: "prov_1",
        type: "provider",
        attributes: [{ name: "provider_id", value: "p_keep", time: new Date(base).toISOString() }],
        relationships: []
      },
      {
        id: "worker_bob",
        type: "worker",
        attributes: [],
        relationships: [{ objectId: "prov_1", qualifier: "uses_provider" }]
      }
    ];
    const caseBEvs: OcelDoc["events"] = [];
    const caseBModels = ["m_common", "m_common", "m_u1", "m_u2"];
    for (let i = 0; i < 4; i++) {
      const d = buildChainedSession({
        id: `case_b_${i}`,
        baseMs: base + 100_000 + i * 10_000,
        providerId: "p_keep",
        modelId: caseBModels[i]!,
        overseerId: "a".repeat(64)
      });
      // Strip provider_id from event 0 so O2O traversal worker_bob -> prov_1 is exercised directly
      d.events[0]!.attributes = d.events[0]!.attributes.filter((a) => a.name !== "provider_id");
      for (const ev of d.events) {
        ev.relationships.push({ objectId: "worker_bob", qualifier: "executed_by" });
      }
      caseBObjs.push(...d.objects);
      caseBEvs.push(...d.events);
    }
    const caseBRes = anonymizeOcel2KAnon(
      { objectTypes: [], eventTypes: [], objects: caseBObjs, events: caseBEvs },
      2,
      "salt-f14-case-b"
    );
    expect(caseBRes.generalizedTraces).toBe(2);
    expect(caseBRes.retainedTraces).toBe(4);
    const { actors: caseBActors } = assertActorsAndAudit(caseBRes);
    expect(caseBActors.length).toBe(2);
    const provOrig = caseBRes.doc.objects.find((o) => o.id === "prov_1");
    const provGen = caseBRes.doc.objects.find((o) => o.id === "prov_1__gen");
    expect(provOrig).toBeDefined();
    expect(provGen).toBeDefined();
    expect(readAttr(provOrig!.attributes, "provider_id")).toBe("p_keep");
    expect(readAttr(provGen!.attributes, "provider_id")).toBe("*");
    expect(
      caseBActors.some((w) => ((w.relationships ?? []) as Array<{ objectId: string }>).some((r) => r.objectId === "prov_1"))
    ).toBe(true);
    expect(
      caseBActors.some((w) => ((w.relationships ?? []) as Array<{ objectId: string }>).some((r) => r.objectId === "prov_1__gen"))
    ).toBe(true);
    const caseBJson = JSON.stringify(caseBRes.doc);
    expect(caseBJson).not.toContain("worker_bob");
    expect(caseBJson).not.toContain("m_u1");
    expect(caseBJson).not.toContain("m_u2");

    // Case C: Complex cyclic O2O graph with shared human_overseer carrying `repo`
    const caseCObjs: OcelDoc["objects"] = [
      {
        id: "ov_shared",
        type: "human_overseer",
        attributes: [{ name: "repo", value: "r_shared", time: new Date(base).toISOString() }],
        relationships: [{ objectId: "cyc_turn_hub", qualifier: "supervises" }]
      },
      {
        id: "cyc_turn_hub",
        type: "turn",
        attributes: [],
        relationships: [
          { objectId: "cyc_prov", qualifier: "uses_provider" },
          { objectId: "cyc_turn_hub", qualifier: "self_loop" }
        ]
      },
      {
        id: "cyc_prov",
        type: "provider",
        attributes: [{ name: "provider_id", value: "p_cyc_keep", time: new Date(base).toISOString() }],
        relationships: [{ objectId: "ov_shared", qualifier: "approved_by" }]
      }
    ];
    const caseCEvs: OcelDoc["events"] = [];
    const caseCModels = ["m_common", "m_common", "m_u1", "m_u2"];
    for (let i = 0; i < 4; i++) {
      const d = buildChainedSession({
        id: `case_c_${i}`,
        baseMs: base + 200_000 + i * 10_000,
        providerId: "p_cyc_keep",
        modelId: caseCModels[i]!,
        overseerId: "a".repeat(64)
      });
      for (const ev of d.events) {
        ev.relationships.push({ objectId: "cyc_turn_hub", qualifier: "in_turn" });
      }
      caseCObjs.push(...d.objects);
      caseCEvs.push(...d.events);
    }
    const caseCRes = anonymizeOcel2KAnon(
      { objectTypes: [], eventTypes: [], objects: caseCObjs, events: caseCEvs },
      2,
      "salt-f14-case-c"
    );
    expect(caseCRes.generalizedTraces).toBe(2);
    expect(caseCRes.retainedTraces).toBe(4);
    const { actors: caseCActors } = assertActorsAndAudit(caseCRes);
    expect(caseCActors.length).toBe(2);
    expect(caseCActors.some((a) => readAttr(a.attributes, "repo") === "r_shared")).toBe(true);
    expect(caseCActors.some((a) => readAttr(a.attributes, "repo") === "*")).toBe(true);
    // Non-actor cyclic split clones preserve __gen naming and link to the split actor clone
    const hubGen = caseCRes.doc.objects.find((o) => o.id === "cyc_turn_hub__gen");
    const provCycGen = caseCRes.doc.objects.find((o) => o.id === "cyc_prov__gen");
    expect(hubGen).toBeDefined();
    expect(provCycGen).toBeDefined();
    expect(readAttr(provCycGen!.attributes, "provider_id")).toBe("*");
    const genOverseer = caseCActors.find((a) => readAttr(a.attributes, "repo") === "*")!;
    expect(
      ((provCycGen!.relationships ?? []) as Array<{ objectId: string }>).some((r) => r.objectId === genOverseer.id)
    ).toBe(true);
    expect(
      ((hubGen!.relationships ?? []) as Array<{ objectId: string }>).some((r) => r.objectId === "cyc_turn_hub__gen")
    ).toBe(true);
    const caseCJson = JSON.stringify(caseCRes.doc);
    expect(caseCJson).not.toContain("ov_shared");
    expect(caseCJson).not.toContain("m_u1");
    expect(caseCJson).not.toContain("m_u2");
  });
});
