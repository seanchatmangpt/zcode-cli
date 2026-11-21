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
  validateOcpnSoundness
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

    // Convergence & Divergence
    expect(dfg.convergence.some((c) => c.activity === "tool_updated" && c.objectTypes.length >= 3)).toBe(true);
    expect(dfg.divergence.some((d) => d.activity === "tool_updated" && d.objectType === "tool_call" && d.maxObjectsPerEvent === 2)).toBe(true);

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
});
