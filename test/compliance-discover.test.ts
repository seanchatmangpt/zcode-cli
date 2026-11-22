import { describe, expect, test } from "bun:test";
import { analyzeOcelKingmanMetrics } from "../src/compliance/kingman-scheduler.ts";
import {
  discoverOcDfg,
  formatOcDfgDot,
  formatOcDfgMermaid,
  type DiscoverDocLike
} from "../src/compliance/ocel-discover.ts";
import {
  discoverOcpn,
  formatOcpnDot,
  formatOcpnMermaid,
  replayOcpn,
  validateOcpnSoundness,
  type OcpnModel
} from "../src/compliance/ocpn.ts";

function buildSessionDoc(opts: {
  id: string;
  baseMs: number;
  ttftMs: number;
  serviceMs: number;
  decisionLatencyMs?: number;
  includeRework?: boolean;
  divergentTools?: boolean;
  sharedFileId?: string;
}): DiscoverDocLike {
  const iso = (delta: number) => new Date(opts.baseMs + delta).toISOString();
  const sId = `sess_${opts.id}`;
  const tId = `turn_${opts.id}`;
  const pId = `perm_${opts.id}`;
  const mId = `mreq_${opts.id}`;
  const tc1 = `tc_${opts.id}_1`;
  const tc2 = `tc_${opts.id}_2`;
  const fId = opts.sharedFileId ?? `file_${opts.id}`;

  const objects: DiscoverDocLike["objects"] = [
    { id: sId, type: "session", attributes: [] },
    { id: tId, type: "turn", attributes: [] },
    { id: pId, type: "permission", attributes: [{ name: "decision_latency_ms", value: String(opts.decisionLatencyMs ?? 1400) }] },
    {
      id: mId,
      type: "model_request",
      attributes: [
        { name: "ttft_ms", value: String(opts.ttftMs) },
        { name: "service_ms", value: String(opts.serviceMs) }
      ]
    },
    { id: tc1, type: "tool_call", attributes: [{ name: "tool_name", value: "Write" }] },
    { id: fId, type: "workspace_file", attributes: [{ name: "path", value: opts.sharedFileId ? "src/shared.ts" : `src/app_${opts.id}.ts` }] }
  ];
  if (opts.divergentTools) {
    (objects as unknown[]).push({ id: tc2, type: "tool_call", attributes: [{ name: "tool_name", value: "Edit" }] });
  }

  const events: DiscoverDocLike["events"] = [
    {
      id: `${opts.id}_e1`,
      type: "session_created",
      time: iso(0),
      relationships: [{ objectId: sId, qualifier: "in_session" }]
    },
    {
      id: `${opts.id}_e2`,
      type: "turn_started",
      time: iso(100),
      relationships: [
        { objectId: sId, qualifier: "in_session" },
        { objectId: tId, qualifier: "in_turn" }
      ]
    },
    {
      id: `${opts.id}_e3`,
      type: "permission_requested",
      time: iso(200),
      relationships: [
        { objectId: sId, qualifier: "in_session" },
        { objectId: tId, qualifier: "in_turn" },
        { objectId: pId, qualifier: "governs" }
      ]
    },
    {
      id: `${opts.id}_e4`,
      type: "permission_resolved",
      time: iso(200 + (opts.decisionLatencyMs ?? 1400)),
      attributes: [
        { name: "decision", value: "allow" },
        { name: "decision_latency_ms", value: String(opts.decisionLatencyMs ?? 1400) }
      ],
      relationships: [
        { objectId: sId, qualifier: "in_session" },
        { objectId: tId, qualifier: "in_turn" },
        { objectId: pId, qualifier: "governs" }
      ]
    },
    {
      id: `${opts.id}_e5`,
      type: "model_request_completed",
      time: iso(2000),
      attributes: [
        { name: "ttft_ms", value: String(opts.ttftMs) },
        { name: "service_ms", value: String(opts.serviceMs) }
      ],
      relationships: [
        { objectId: sId, qualifier: "in_session" },
        { objectId: tId, qualifier: "in_turn" },
        { objectId: mId, qualifier: "about_model_request" }
      ]
    },
    {
      id: `${opts.id}_e6`,
      type: "tool_updated",
      time: iso(2200),
      relationships: [
        { objectId: sId, qualifier: "in_session" },
        { objectId: tId, qualifier: "in_turn" },
        { objectId: tc1, qualifier: "about_tool_call" },
        ...(opts.divergentTools ? [{ objectId: tc2, qualifier: "about_tool_call" }] : []),
        { objectId: fId, qualifier: "mutated_in" }
      ]
    }
  ];

  if (opts.includeRework) {
    (events as unknown[]).push(
      {
        id: `${opts.id}_e6b`,
        type: "turn_failed",
        time: iso(2300),
        relationships: [
          { objectId: sId, qualifier: "in_session" },
          { objectId: tId, qualifier: "in_turn" }
        ]
      },
      {
        id: `${opts.id}_e6c`,
        type: "tool_updated",
        time: iso(2400),
        relationships: [
          { objectId: sId, qualifier: "in_session" },
          { objectId: tId, qualifier: "in_turn" },
          { objectId: tc1, qualifier: "about_tool_call" }
        ]
      }
    );
  }

  (events as unknown[]).push({
    id: `${opts.id}_e7`,
    type: "turn_completed",
    time: iso(2600),
    relationships: [
      { objectId: sId, qualifier: "in_session" },
      { objectId: tId, qualifier: "in_turn" }
    ]
  });

  return { objects, events };
}

describe("F13 OC-DFG Discovery & Object-Centric Petri Nets (Chicago)", () => {
  test("discovers OC-DFG with convergence, divergence, sojourn c_s^2, rework, file collisions, bottlenecks, DOT & Mermaid", () => {
    const base = Date.parse("2026-08-02T10:00:00.000Z");
    const docs: DiscoverDocLike[] = [];
    for (let i = 0; i < 10; i++) {
      docs.push(
        buildSessionDoc({
          id: `s${i}`,
          baseMs: base + i * 10_000,
          ttftMs: 105 + (i % 3) * 5,
          serviceMs: i % 5 === 0 ? 120_000 : 3500,
          decisionLatencyMs: i === 0 ? 120 : 1500,
          includeRework: i === 1,
          divergentTools: i === 2,
          sharedFileId: i === 3 || i === 4 ? "file_shared_collision" : undefined
        })
      );
    }

    const dfg = discoverOcDfg(docs, { minReviewMs: 1000 });
    expect(dfg.objectTypes).toContain("session");
    expect(dfg.objectTypes).toContain("turn");
    expect(dfg.objectTypes).toContain("model_request");
    expect(dfg.byObjectType.turn!.edges.length).toBeGreaterThan(0);

    // Convergence (1-to-many same-type), Divergence (same object >= 2 same-activity events), & Synchronization (multi-type)
    expect(dfg.convergence.some((c) => c.activity === "tool_updated" && c.objectType === "tool_call" && c.maxObjectsPerEvent === 2)).toBe(true);
    expect(dfg.divergence.some((d) => d.activity === "tool_updated" && d.objectType === "tool_call" && d.maxEventsPerObject === 2)).toBe(true);
    expect(dfg.synchronization.some((s) => s.activity === "tool_updated" && s.objectTypes.length >= 3)).toBe(true);

    // Single-event model_request sojourn captures heavy-tailed c_s^2 >> 1
    expect(dfg.sojournByObjectType.model_request!.count).toBe(10);
    expect(dfg.sojournByObjectType.model_request!.cs2).toBeGreaterThan(1.5);
    expect(dfg.sojournByObjectType.model_request!.p95Ms).toBeGreaterThanOrEqual(3500);

    // Rework, file collision, and rubber-stamp oversight bottleneck
    expect(dfg.reworkCycles.length).toBeGreaterThan(0);
    expect(dfg.fileCollisions.some((c) => c.fileObjectId === "file_shared_collision" && c.actors.length === 2)).toBe(true);
    expect(dfg.oversightBottlenecks.some((b) => b.kind === "rubber_stamp" && b.latencyMs === 120)).toBe(true);

    // Renderers
    const dot = formatOcDfgDot(dfg);
    expect(dot).toContain("digraph OC_DFG");
    expect(dot).toContain("->");
    expect(dot.trim().endsWith("}")).toBe(true);

    const mmd = formatOcDfgMermaid(dfg);
    expect(mmd).toMatch(/^flowchart\s+LR/);
    expect(mmd).toContain("-->");

    // Kingman analyzer confirms heavy-tailed serviceMs does not trigger TTFT MD
    const kingman = analyzeOcelKingmanMetrics(docs);
    expect(kingman.cs2).toBeGreaterThan(1.5);
    expect(kingman.ttftMdTriggered).toBe(false);
  });

  test("discovers sound OCPN with synchronized multi-object transitions, variable arcs, and accurate replay", () => {
    const base = Date.parse("2026-08-02T10:00:00.000Z");
    const doc1 = buildSessionDoc({ id: "oc1", baseMs: base, ttftMs: 110, serviceMs: 3200, divergentTools: true });
    const doc2 = buildSessionDoc({ id: "oc2", baseMs: base + 10_000, ttftMs: 115, serviceMs: 3400, includeRework: true });

    const dfg = discoverOcDfg([doc1, doc2]);
    const ocpn = discoverOcpn(dfg);

    expect(ocpn.soundness.sound).toBe(true);
    expect(validateOcpnSoundness(ocpn).sound).toBe(true);
    expect(ocpn.arcs.some((a) => a.variable && a.objectType === "tool_call")).toBe(true);

    const syncTrans = ocpn.transitions.find((t) => t.activity === "tool_updated");
    expect(syncTrans).toBeDefined();
    expect(syncTrans!.objectTypes.length).toBeGreaterThanOrEqual(3);

    // Conforming replay achieves fitness === 1
    const cleanReplay = replayOcpn(ocpn, doc1);
    expect(cleanReplay.fitness).toBe(1);
    expect(cleanReplay.soundTermination).toBe(true);

    // Anti-vacuity: out-of-order trace degrades fitness < 1 and fails soundTermination
    const scrambled: DiscoverDocLike = {
      objects: doc1.objects,
      events: [
        doc1.events[6]!, // turn_completed first!
        doc1.events[1]!, // turn_started after!
        doc1.events[0]!  // session_created last!
      ].map((ev, idx) => ({ ...ev, time: new Date(base + idx * 1000).toISOString() }))
    };
    const badReplay = replayOcpn(ocpn, scrambled);
    expect(badReplay.fitness).toBeLessThan(1);
    expect(badReplay.soundTermination).toBe(false);
    expect(badReplay.missing).toBeGreaterThan(0);

    // Missing required compliance objectType emits UNOBSERVED_OBJECT_TYPE non-throwingly
    const partialDfg = discoverOcDfg({
      objects: [{ id: "s_only", type: "session", attributes: [] }],
      events: [
        { id: "e1", type: "session_created", time: "2026-08-02T10:00:00Z", relationships: [{ objectId: "s_only", qualifier: "in_session" }] }
      ]
    });
    const partialOcpn = discoverOcpn(partialDfg);
    expect(partialOcpn.warnings.some((w) => w.includes("UNOBSERVED_OBJECT_TYPE"))).toBe(true);
    expect(partialOcpn.soundness.sound).toBe(true);

    // Renderers
    expect(formatOcpnDot(ocpn)).toContain("digraph OCPN");
    expect(formatOcpnMermaid(ocpn)).toMatch(/^flowchart\s+LR/);
  });

  test("regression F13: multi-start OCPN replay achieves fitness=1 & soundTermination=true", () => {
    const t0 = Date.parse("2026-08-02T10:00:00.000Z");
    const multiStartDoc: DiscoverDocLike = {
      objects: [
        { id: "turn_a", type: "turn", attributes: [] },
        { id: "turn_b", type: "turn", attributes: [] }
      ],
      events: [
        { id: "e1", type: "turn_started", time: new Date(t0).toISOString(), relationships: [{ objectId: "turn_a", qualifier: "in_turn" }] },
        { id: "e2", type: "turn_completed", time: new Date(t0 + 100).toISOString(), relationships: [{ objectId: "turn_a", qualifier: "in_turn" }] },
        { id: "e3", type: "turn_resumed", time: new Date(t0 + 200).toISOString(), relationships: [{ objectId: "turn_b", qualifier: "in_turn" }] },
        { id: "e4", type: "turn_completed", time: new Date(t0 + 300).toISOString(), relationships: [{ objectId: "turn_b", qualifier: "in_turn" }] }
      ]
    };

    const dfg = discoverOcDfg(multiStartDoc);
    const ocpn = discoverOcpn(dfg, { requiredObjectTypes: ["turn"] });
    expect(ocpn.soundness.sound).toBe(true);

    const replayAll = replayOcpn(ocpn, multiStartDoc);
    expect(replayAll.fitness).toBe(1);
    expect(replayAll.soundTermination).toBe(true);
    expect(replayAll.missing).toBe(0);
    expect(replayAll.remaining).toBe(0);

    const replaySecondStartOnly = replayOcpn(ocpn, {
      objects: [{ id: "turn_b", type: "turn", attributes: [] }],
      events: multiStartDoc.events.slice(2)
    });
    expect(replaySecondStartOnly.fitness).toBe(1);
    expect(replaySecondStartOnly.soundTermination).toBe(true);
  });

  test("regression F13: disambiguates sanitized IDs, escapes Mermaid labels, deduplicates SCC rework, groups cross-ID file collisions, flags n<=2 slow oversight, and ignores equal-ts rho fallback", () => {
    const ts = "2026-08-02T10:00:00.000Z";
    const doc: DiscoverDocLike = {
      objects: [
        { id: "turn_1", type: "turn", attributes: [] },
        { id: "turn_2", type: "turn", attributes: [] },
        { id: "wf_1", type: "workspace_file", attributes: [{ name: "path", value: "src/shared_cross.ts" }] },
        { id: "wf_2", type: "workspace_file", attributes: [{ name: "path", value: "src/shared_cross.ts" }] },
        { id: "perm_slow", type: "permission", attributes: [] },
        { id: "mreq_1", type: "model_request", attributes: [{ name: "service_ms", value: "3500" }] },
        { id: "mreq_2", type: "model_request", attributes: [{ name: "service_ms", value: "3500" }] }
      ],
      events: [
        {
          id: "e1",
          type: 'tool:run["x"]',
          time: ts,
          relationships: [
            { objectId: "turn_1", qualifier: "in_turn" },
            { objectId: "wf_1", qualifier: "mutated_in" },
            { objectId: "mreq_1", qualifier: "about_model_request" }
          ]
        },
        {
          id: "e2",
          type: 'tool/run["x"]',
          time: new Date(Date.parse(ts) + 100).toISOString(),
          relationships: [
            { objectId: "turn_1", qualifier: "in_turn" }
          ]
        },
        {
          id: "e3",
          type: 'tool:run["x"]',
          time: new Date(Date.parse(ts) + 200).toISOString(),
          relationships: [
            { objectId: "turn_1", qualifier: "in_turn" }
          ]
        },
        {
          id: "e4",
          type: 'tool/run["x"]',
          time: ts,
          relationships: [
            { objectId: "turn_2", qualifier: "in_turn" },
            { objectId: "wf_2", qualifier: "mutated_in" },
            { objectId: "mreq_2", qualifier: "about_model_request" }
          ]
        },
        {
          id: "e5",
          type: "permission_resolved",
          time: ts,
          attributes: [
            { name: "decision", value: "allow" },
            { name: "decision_latency_ms", value: "60000" }
          ],
          relationships: [{ objectId: "perm_slow", qualifier: "governs" }]
        }
      ]
    };

    const dfg = discoverOcDfg(doc);
    const ocpn = discoverOcpn(dfg, { requiredObjectTypes: ["turn"] });

    // Distinct visible transitions for punctuation-differing activities
    const vis = ocpn.transitions.filter((t) => !t.silent && t.activity.startsWith("tool"));
    expect(vis).toHaveLength(2);
    expect(new Set(vis.map((t) => t.id)).size).toBe(2);

    // Mermaid labels escape quotes & brackets
    const dfgMmd = formatOcDfgMermaid(dfg);
    const ocpnMmd = formatOcpnMermaid(ocpn);
    expect(dfgMmd).not.toContain('["tool:run["x"]');
    expect(dfgMmd).toContain("&quot;");
    expect(ocpnMmd).toContain("&quot;");

    // SCC rework deduplicated against trace-level cycle on identical node set
    expect(dfg.reworkCycles).toHaveLength(1);

    // Cross-ID file collision grouped by canonical filePath
    expect(dfg.fileCollisions).toHaveLength(1);
    expect(dfg.fileCollisions[0]!.filePath).toBe("src/shared_cross.ts");
    expect(dfg.fileCollisions[0]!.actors).toEqual(["turn_1", "turn_2"]);

    // Extreme slow oversight flagged even when n <= 2
    expect(dfg.oversightBottlenecks.some((b) => b.kind === "slow_oversight" && b.latencyMs === 60000)).toBe(true);

    // Equal timestamps do NOT trigger 1ms wall-clock fallback inflating rho to 0.99
    const kingmanEq = analyzeOcelKingmanMetrics({
      objects: doc.objects,
      events: [
        { id: "k1", type: "model_request_completed", time: ts, attributes: [{ name: "service_ms", value: "3500" }], relationships: [{ objectId: "mreq_1", qualifier: "about_model_request" }] },
        { id: "k2", type: "model_request_completed", time: ts, attributes: [{ name: "service_ms", value: "3500" }], relationships: [{ objectId: "mreq_2", qualifier: "about_model_request" }] }
      ]
    });
    expect(kingmanEq.rho).toBeLessThan(0.5);
  });

  test("regression C1-OCPN-Semantics: replayOcpn enforces non-variable arc multiplicity and missing-type synchronization", () => {
    const model: OcpnModel = {
      schema: "zcode.ocpn/1",
      objectTypes: ["session", "tool_call"],
      places: [
        { id: "p_session_src", objectType: "session", role: "source" },
        { id: "p_session_snk", objectType: "session", role: "sink" },
        { id: "p_tool_call_src", objectType: "tool_call", role: "source" },
        { id: "p_tool_call_snk", objectType: "tool_call", role: "sink" }
      ],
      transitions: [
        { id: "t1", activity: "tool_exec", silent: false, objectTypes: ["session", "tool_call"] }
      ],
      arcs: [
        { id: "a1", source: "p_session_src", target: "t1", objectType: "session", direction: "place_to_transition", variable: false },
        { id: "a2", source: "t1", target: "p_session_snk", objectType: "session", direction: "transition_to_place", variable: false },
        { id: "a3", source: "p_tool_call_src", target: "t1", objectType: "tool_call", direction: "place_to_transition", variable: false },
        { id: "a4", source: "t1", target: "p_tool_call_snk", objectType: "tool_call", direction: "transition_to_place", variable: false }
      ],
      sourcePlaces: { session: "p_session_src", tool_call: "p_tool_call_src" },
      sinkPlaces: { session: "p_session_snk", tool_call: "p_tool_call_snk" },
      soundness: {
        sound: true,
        perObjectType: {
          session: { sound: true, sourcePlace: "p_session_src", sinkPlace: "p_session_snk", unreachableFromSource: [], deadEndsToSink: [], issues: [] },
          tool_call: { sound: true, sourcePlace: "p_tool_call_src", sinkPlace: "p_tool_call_snk", unreachableFromSource: [], deadEndsToSink: [], issues: [] }
        },
        issues: []
      },
      diagnostics: [],
      warnings: [],
      reworkCycles: [],
      fileCollisions: [],
      sojournByObjectType: {}
    };

    const ts = "2026-08-02T10:00:00.000Z";

    // Positive control: conforming 1-to-1 synchronized binding achieves fitness=1, missing=0
    const conforming = replayOcpn(model, {
      objects: [
        { id: "s1", type: "session", attributes: [] },
        { id: "tc1", type: "tool_call", attributes: [] }
      ],
      events: [
        {
          id: "e_ok",
          type: "tool_exec",
          time: ts,
          relationships: [
            { objectId: "s1", qualifier: "in_session" },
            { objectId: "tc1", qualifier: "about_tool_call" }
          ]
        }
      ]
    });
    expect(conforming.missing).toBe(0);
    expect(conforming.fitness).toBe(1);
    expect(conforming.soundTermination).toBe(true);

    // (a) Non-variable arc multiplicity violation: 2 tool_call objects on variable=false arc
    const multiViolation = replayOcpn(model, {
      objects: [
        { id: "s1", type: "session", attributes: [] },
        { id: "tc1", type: "tool_call", attributes: [] },
        { id: "tc2", type: "tool_call", attributes: [] }
      ],
      events: [
        {
          id: "e_multi",
          type: "tool_exec",
          time: ts,
          relationships: [
            { objectId: "s1", qualifier: "in_session" },
            { objectId: "tc1", qualifier: "about_tool_call" },
            { objectId: "tc2", qualifier: "about_tool_call" }
          ]
        }
      ]
    });
    expect(multiViolation.missing).toBeGreaterThan(0);
    expect(multiViolation.fitness).toBeLessThan(1);
    expect(multiViolation.soundTermination).toBe(false);
    expect(multiViolation.perObjectType.tool_call!.missing).toBeGreaterThan(0);
    expect(multiViolation.perObjectType.tool_call!.fitness).toBeLessThan(1);
    expect(multiViolation.perObjectType.session!.missing).toBe(0);

    // (b) Missing synchronized object type: event omits 'session'
    const missingSync = replayOcpn(model, {
      objects: [
        { id: "tc1", type: "tool_call", attributes: [] }
      ],
      events: [
        {
          id: "e_missing_session",
          type: "tool_exec",
          time: ts,
          relationships: [
            { objectId: "tc1", qualifier: "about_tool_call" }
          ]
        }
      ]
    });
    expect(missingSync.missing).toBeGreaterThan(0);
    expect(missingSync.fitness).toBeLessThan(1);
    expect(missingSync.soundTermination).toBe(false);
    expect(missingSync.perObjectType.session!.missing).toBeGreaterThan(0);
    expect(missingSync.perObjectType.session!.fitness).toBeLessThan(1);
    expect(missingSync.perObjectType.tool_call!.missing).toBe(0);
  });

  test("ERRC RAISE: aligns convergence, divergence (with differingOtherTypes), and synchronization with OCEL 2.0 semantics", () => {
    const t0 = Date.parse("2026-08-03T10:00:00.000Z");
    const iso = (d: number) => new Date(t0 + d).toISOString();
    const doc: DiscoverDocLike = {
      objects: [
        { id: "s1", type: "session", attributes: [] },
        { id: "tc1", type: "tool_call", attributes: [] },
        { id: "tc2", type: "tool_call", attributes: [] },
        { id: "f1", type: "workspace_file", attributes: [{ name: "path", value: "a.ts" }] },
        { id: "f2", type: "workspace_file", attributes: [{ name: "path", value: "b.ts" }] }
      ],
      events: [
        // Convergence on tool_call (2 tool_calls on 1 event) + Synchronization (session, tool_call, workspace_file)
        {
          id: "e1",
          type: "batch_edit",
          time: iso(0),
          relationships: [
            { objectId: "s1", qualifier: "in_session" },
            { objectId: "tc1", qualifier: "about_tool_call" },
            { objectId: "tc2", qualifier: "about_tool_call" },
            { objectId: "f1", qualifier: "mutated_in" }
          ]
        },
        // Divergence on session s1: second batch_edit for s1 paired with differing workspace_file f2
        {
          id: "e2",
          type: "batch_edit",
          time: iso(500),
          relationships: [
            { objectId: "s1", qualifier: "in_session" },
            { objectId: "tc1", qualifier: "about_tool_call" },
            { objectId: "f2", qualifier: "mutated_in" }
          ]
        }
      ]
    };

    const dfg = discoverOcDfg(doc);

    // Convergence: same-type multiplicity >= 2 on one event
    const conv = dfg.convergence.find((c) => c.activity === "batch_edit" && c.objectType === "tool_call");
    expect(conv).toBeDefined();
    expect(conv!.maxObjectsPerEvent).toBe(2);
    expect(conv!.count).toBe(1);

    // Divergence: s1 participates in 2 batch_edit events with differing workspace_file & tool_call sets
    const divSession = dfg.divergence.find((d) => d.activity === "batch_edit" && d.objectType === "session");
    expect(divSession).toBeDefined();
    expect(divSession!.maxEventsPerObject).toBe(2);
    expect(divSession!.count).toBe(1);
    expect(divSession!.differingOtherTypes).toContain("workspace_file");
    expect(divSession!.differingOtherTypes).toContain("tool_call");

    // Synchronization: multi-type co-occurrence separated from convergence
    const sync = dfg.synchronization.find((s) => s.activity === "batch_edit");
    expect(sync).toBeDefined();
    expect(sync!.objectTypes).toEqual(["session", "tool_call", "workspace_file"]);
    expect(sync!.count).toBe(2);
  });

  test("ERRC CREATE: tracks distinct objectCount (UO) on nodes/edges and filters noise while preserving start-to-end connectivity", () => {
    const t0 = Date.parse("2026-08-03T11:00:00.000Z");
    const iso = (d: number) => new Date(t0 + d).toISOString();
    const objects: DiscoverDocLike["objects"] = [];
    const events: DiscoverDocLike["events"] = [];

    // 5 main-path turns: start -> work -> end (turn_0 repeats work twice so frequency=6, objectCount=5)
    for (let i = 0; i < 5; i++) {
      const tid = `turn_${i}`;
      (objects as unknown[]).push({ id: tid, type: "turn", attributes: [] });
      (events as unknown[]).push(
        { id: `m_${i}_1`, type: "start", time: iso(i * 1000 + 0), relationships: [{ objectId: tid, qualifier: "in_turn" }] },
        { id: `m_${i}_2`, type: "work", time: iso(i * 1000 + 100), relationships: [{ objectId: tid, qualifier: "in_turn" }] }
      );
      if (i === 0) {
        (events as unknown[]).push({
          id: `m_${i}_2b`,
          type: "work",
          time: iso(i * 1000 + 150),
          relationships: [{ objectId: tid, qualifier: "in_turn" }]
        });
      }
      (events as unknown[]).push({
        id: `m_${i}_3`,
        type: "end",
        time: iso(i * 1000 + 200),
        relationships: [{ objectId: tid, qualifier: "in_turn" }]
      });
    }

    // 1 noisy outlier turn: start -> rare_detour -> end
    (objects as unknown[]).push({ id: "turn_noise", type: "turn", attributes: [] });
    (events as unknown[]).push(
      { id: "n_1", type: "start", time: iso(9000), relationships: [{ objectId: "turn_noise", qualifier: "in_turn" }] },
      { id: "n_2", type: "rare_detour", time: iso(9100), relationships: [{ objectId: "turn_noise", qualifier: "in_turn" }] },
      { id: "n_3", type: "end", time: iso(9200), relationships: [{ objectId: "turn_noise", qualifier: "in_turn" }] }
    );

    const unfiltered = discoverOcDfg({ objects, events });
    const workNode = unfiltered.byObjectType.turn!.nodes.find((n) => n.activity === "work")!;
    expect(workNode.frequency).toBe(6);
    expect(workNode.objectCount).toBe(5);

    const startToWork = unfiltered.byObjectType.turn!.edges.find((e) => e.source === "start" && e.target === "work")!;
    expect(startToWork.frequency).toBe(5);
    expect(startToWork.objectCount).toBe(5);

    // Relative noiseThreshold prunes rare_detour while preserving start -> work -> end
    const filtered = discoverOcDfg({ objects, events }, { noiseThreshold: 0.4 });
    const keptActs = filtered.byObjectType.turn!.nodes.map((n) => n.activity);
    expect(keptActs).toContain("start");
    expect(keptActs).toContain("work");
    expect(keptActs).toContain("end");
    expect(keptActs).not.toContain("rare_detour");

    // Extreme threshold still preserves start-to-end connectivity via widest path
    const extreme = discoverOcDfg({ objects, events }, { minActivityFrequency: 100, minEdgeFrequency: 100 });
    const extActs = extreme.byObjectType.turn!.nodes.map((n) => n.activity);
    expect(extActs).toContain("start");
    expect(extActs).toContain("work");
    expect(extActs).toContain("end");
    expect(extreme.byObjectType.turn!.edges.some((e) => e.source === "start" && e.target === "work")).toBe(true);
    expect(extreme.byObjectType.turn!.edges.some((e) => e.source === "work" && e.target === "end")).toBe(true);
  });

  test("ERRC ELIMINATE: inter-trace concurrency does not fabricate synthetic SCC reworkCycles", () => {
    const t0 = Date.parse("2026-08-03T12:00:00.000Z");
    const iso = (d: number) => new Date(t0 + d).toISOString();
    const doc: DiscoverDocLike = {
      objects: [
        { id: "t1", type: "turn", attributes: [] },
        { id: "t2", type: "turn", attributes: [] }
      ],
      events: [
        // t1: A -> B
        { id: "e1", type: "act_A", time: iso(0), relationships: [{ objectId: "t1", qualifier: "in_turn" }] },
        { id: "e2", type: "act_B", time: iso(100), relationships: [{ objectId: "t1", qualifier: "in_turn" }] },
        // t2: B -> A (inter-trace concurrency, NOT rework)
        { id: "e3", type: "act_B", time: iso(200), relationships: [{ objectId: "t2", qualifier: "in_turn" }] },
        { id: "e4", type: "act_A", time: iso(300), relationships: [{ objectId: "t2", qualifier: "in_turn" }] }
      ]
    };

    const dfg = discoverOcDfg(doc);
    // DFG has both A->B and B->A, forming an SCC, but zero traces repeated any activity
    expect(dfg.byObjectType.turn!.edges).toHaveLength(2);
    expect(dfg.reworkCycles).toHaveLength(0);
  });

  test("ERRC REDUCE: merges multi-document rotated logs, deduplicates overlapping events, and preserves cross-boundary edges & sojourn", () => {
    const t0 = Date.parse("2026-08-03T13:00:00.000Z");
    const iso = (d: number) => new Date(t0 + d).toISOString();

    const slice1: DiscoverDocLike = {
      objects: [
        { id: "turn_span", type: "turn", attributes: [] },
        { id: "perm_span", type: "permission", attributes: [] }
      ],
      events: [
        {
          id: "ev_1",
          type: "turn_started",
          time: iso(0),
          relationships: [{ objectId: "turn_span", qualifier: "in_turn" }]
        },
        {
          id: "ev_2",
          type: "permission_requested",
          time: iso(1000),
          relationships: [
            { objectId: "turn_span", qualifier: "in_turn" },
            { objectId: "perm_span", qualifier: "governs" }
          ]
        }
      ]
    };

    const slice2: DiscoverDocLike = {
      objects: [
        { id: "turn_span", type: "turn", attributes: [] },
        { id: "perm_span", type: "permission", attributes: [] }
      ],
      events: [
        // Overlapping duplicate of ev_2
        {
          id: "ev_2",
          type: "permission_requested",
          time: iso(1000),
          relationships: [
            { objectId: "turn_span", qualifier: "in_turn" },
            { objectId: "perm_span", qualifier: "governs" }
          ]
        },
        {
          id: "ev_3",
          type: "permission_resolved",
          time: iso(1500),
          attributes: [{ name: "decision", value: "allow" }],
          relationships: [
            { objectId: "turn_span", qualifier: "in_turn" },
            { objectId: "perm_span", qualifier: "governs" }
          ]
        },
        {
          id: "ev_4",
          type: "turn_completed",
          time: iso(5000),
          relationships: [{ objectId: "turn_span", qualifier: "in_turn" }]
        }
      ]
    };

    const dfg = discoverOcDfg([slice1, slice2], { minReviewMs: 1000 });
    expect(dfg.totalObjects).toBe(2);
    expect(dfg.totalEvents).toBe(4); // ev_2 deduplicated
    expect(dfg.byObjectType.turn!.traceCount).toBe(1);
    expect(dfg.byObjectType.turn!.startActivities).toEqual({ turn_started: 1 });
    expect(dfg.byObjectType.turn!.endActivities).toEqual({ turn_completed: 1 });
    expect(
      dfg.byObjectType.turn!.edges.some(
        (e) => e.source === "permission_requested" && e.target === "permission_resolved" && e.frequency === 1
      )
    ).toBe(true);
    expect(dfg.sojournByObjectType.turn!.meanMs).toBe(5000);
    // Permission request/resolve paired across rotated slices (500ms < 1000ms -> rubber_stamp)
    expect(dfg.oversightBottlenecks.some((b) => b.permissionObjectId === "perm_span" && b.kind === "rubber_stamp" && b.latencyMs === 500)).toBe(true);
  });

  test("regression V08: computes E/UO/TO frequency triad on nodes and edges and thresholds noise by E", () => {
    const t0 = Date.parse("2026-08-04T10:00:00.000Z");
    const iso = (d: number) => new Date(t0 + d).toISOString();

    const items = Array.from({ length: 7 }, (_, i) => ({
      id: `item_${i + 1}`,
      type: "item",
      attributes: []
    }));

    const doc: DiscoverDocLike = {
      objects: items,
      events: [
        // 1 convergent event batch_op linked to 5 items (E=1, UO=5, TO=5)
        {
          id: "e1",
          type: "batch_op",
          time: iso(0),
          relationships: [
            { objectId: "item_1", qualifier: "targets" },
            { objectId: "item_2", qualifier: "targets" },
            { objectId: "item_3", qualifier: "targets" },
            { objectId: "item_4", qualifier: "targets" },
            { objectId: "item_5", qualifier: "targets" }
          ]
        },
        // 1 convergent follow-up batch_done linked to the same 5 items (edge E=1, UO=5, TO=5)
        {
          id: "e1_done",
          type: "batch_done",
          time: iso(100),
          relationships: [
            { objectId: "item_1", qualifier: "targets" },
            { objectId: "item_2", qualifier: "targets" },
            { objectId: "item_3", qualifier: "targets" },
            { objectId: "item_4", qualifier: "targets" },
            { objectId: "item_5", qualifier: "targets" }
          ]
        },
        // 2 separate single_op events each linked to 1 item (E=2, UO=2, TO=2)
        {
          id: "e2",
          type: "single_op",
          time: iso(200),
          relationships: [{ objectId: "item_6", qualifier: "targets" }]
        },
        {
          id: "e3",
          type: "single_op",
          time: iso(300),
          relationships: [{ objectId: "item_7", qualifier: "targets" }]
        }
      ]
    };

    const dfg = discoverOcDfg(doc);
    const itemGraph = dfg.byObjectType.item!;
    const batchNode = itemGraph.nodes.find((n) => n.activity === "batch_op")!;
    const singleNode = itemGraph.nodes.find((n) => n.activity === "single_op")!;
    const batchEdge = itemGraph.edges.find((e) => e.source === "batch_op" && e.target === "batch_done")!;

    // E / UO / TO triad on convergent node
    expect(batchNode.frequency).toBe(1);
    expect(batchNode.eventCount).toBe(1);
    expect(batchNode.objectCount).toBe(5);
    expect(batchNode.totalObjects).toBe(5);

    // E / UO / TO triad on non-convergent node
    expect(singleNode.frequency).toBe(2);
    expect(singleNode.eventCount).toBe(2);
    expect(singleNode.objectCount).toBe(2);
    expect(singleNode.totalObjects).toBe(2);

    // E / UO / TO triad on convergent edge
    expect(batchEdge.frequency).toBe(1);
    expect(batchEdge.eventCount).toBe(1);
    expect(batchEdge.objectCount).toBe(5);
    expect(batchEdge.totalObjects).toBe(5);

    // Noise filtering uses E (max E = 2 -> ceil(0.5 * 2) = 1), so single_op (E=2) is NOT pruned
    const filtered = discoverOcDfg(doc, { noiseThreshold: 0.5 });
    const filteredActs = filtered.byObjectType.item!.nodes.map((n) => n.activity);
    expect(filteredActs).toContain("single_op");
    expect(filteredActs).toContain("batch_op");
  });
});
