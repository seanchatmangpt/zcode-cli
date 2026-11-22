import { describe, expect, test } from "bun:test";
import {
  adwin,
  benjaminiHochberg,
  detectConceptDrift,
  holmBonferroni,
  multisetControlFlowDrift,
  type DriftDocLike,
  type DriftEventLike,
  type DriftObjectLike
} from "../src/compliance/concept-drift.ts";

function makeIso(sec: number): string {
  return new Date(Date.UTC(2026, 9, 1, 0, 0, sec)).toISOString();
}

describe("09-Concept-Drift ERRC improvements", () => {
  test("RAISE: holmBonferroni and benjaminiHochberg adjust p-values monotonically and detectConceptDrift exposes raw pValue & adjustedPValue", () => {
    const raw = [0.001, 0.01, 0.04, 0.2];
    const holm = holmBonferroni(raw);
    expect(holm.length).toBe(4);
    expect(holm[0]).toBeCloseTo(0.004, 10);
    expect(holm[1]).toBeCloseTo(0.03, 10);
    expect(holm[2]).toBeCloseTo(0.08, 10);
    expect(holm[3]).toBeCloseTo(0.2, 10);

    const bh = benjaminiHochberg(raw);
    expect(bh.length).toBe(4);
    expect(bh[0]).toBeCloseTo(0.004, 10);
    expect(bh[1]).toBeCloseTo(0.02, 10);
    expect(bh[2]).toBeCloseTo((0.04 * 4) / 3, 10);
    expect(bh[3]).toBeCloseTo(0.2, 10);

    // Clear sudden drift exposes both pValue and adjustedPValue with adjustedPValue >= pValue
    const events: DriftEventLike[] = [];
    for (let i = 0; i < 40; i++) {
      const val = i < 20 ? 100 + (i % 3) : 250 + (i % 3);
      events.push({
        id: `ev-${i}`,
        type: "model_request_completed",
        time: makeIso(i * 10),
        attributes: [{ name: "ttft_ms", value: val }]
      });
    }
    const report = detectConceptDrift({ events }, { alpha: 0.01 });
    expect(report.driftDetected).toBe(true);
    expect(report.findings.length).toBeGreaterThan(0);
    for (const f of report.findings) {
      expect(typeof f.pValue).toBe("number");
      expect(typeof f.adjustedPValue).toBe("number");
      expect(f.adjustedPValue).toBeGreaterThanOrEqual(f.pValue);
      expect(f.adjustedPValue).toBeLessThan(0.01);
    }
  });

  test("ELIMINATE: no post-selection double-dipping on stationary multi-stratum logs", () => {
    // 10 independent stationary strata with deterministic pseudo-random noise
    let seed = 1337;
    const nextRand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const events: DriftEventLike[] = [];
    let t = 0;
    for (let s = 0; s < 10; s++) {
      for (let i = 0; i < 40; i++) {
        events.push({
          id: `st-${s}-${i}`,
          type: "model_request_completed",
          time: makeIso(t++),
          attributes: [
            { name: "tool_name", value: `tool_${s}` },
            { name: "ttft_ms", value: 100 + (nextRand() - 0.5) * 20 }
          ]
        });
      }
    }

    const report = detectConceptDrift({ events }, { alpha: 0.01, stratification: "tool_name" });
    expect(report.driftDetected).toBe(false);
    expect(report.findings.length).toBe(0);
  });

  test("REDUCE: ADWIN2 exponential-histogram runs in O(N log W) on 5000-point stream and detects step shift", () => {
    const n = 5000;
    const series: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const base = i < 2500 ? 10 : 30;
      series[i] = base + ((i * 7) % 5) * 0.2;
    }

    const t0 = performance.now();
    const res = adwin(series, { delta: 0.01, minWindow: 10 });
    const elapsedMs = performance.now() - t0;

    expect(res.driftDetected).toBe(true);
    expect(res.shrinkCount).toBeGreaterThan(0);
    expect(res.changePoints[0]).toBeGreaterThanOrEqual(2500);
    expect(res.changePoints[0]).toBeLessThan(2600);
    expect(res.finalWindowMean).toBeGreaterThan(28);
    expect(elapsedMs).toBeLessThan(500);
  });

  test("CREATE: multisetControlFlowDrift and detectConceptDrift catch loop-multiplicity drift invisible to binary edgeSet", () => {
    // Unit test on multisetControlFlowDrift directly
    const groupA: Map<string, number>[] = [];
    const groupB: Map<string, number>[] = [];
    for (let i = 0; i < 20; i++) {
      groupA.push(new Map([["start->work", 1], ["work->work", 1], ["work->end", 1]]));
      groupB.push(new Map([["start->work", 1], ["work->work", 8], ["work->end", 1]]));
    }
    const msRes = multisetControlFlowDrift(groupA, groupB, { alpha: 0.01, permutations: 199 });
    expect(msRes.significant).toBe(true);
    expect(msRes.statistic).toBeGreaterThan(0.2);
    expect(msRes.pValue).toBeLessThan(0.01);

    // Stationary multisets must NOT trigger
    const statRes = multisetControlFlowDrift(groupA.slice(0, 10), groupA.slice(10), { alpha: 0.01, permutations: 199 });
    expect(statRes.significant).toBe(false);
    expect(statRes.statistic).toBe(0);

    // End-to-end detectConceptDrift on OCEL-like log where every trace has the exact same binary edge set
    // {start->work, work->work, work->end}, but loop multiplicity shifts from 1 to 6 at trace 15.
    const objects: DriftObjectLike[] = [];
    const events: DriftEventLike[] = [];
    let sec = 0;
    for (let tr = 0; tr < 30; tr++) {
      const objId = `turn-${tr}`;
      objects.push({ id: objId, type: "turn", attributes: [] });
      const rel = [{ objectId: objId, qualifier: "subject" }];
      const loopCount = tr < 15 ? 2 : 7; // 1 self-loop edge vs 6 self-loop edges
      events.push({ id: `e-${tr}-s`, type: "start", time: makeIso(sec++), relationships: rel });
      for (let k = 0; k < loopCount; k++) {
        events.push({ id: `e-${tr}-w-${k}`, type: "work", time: makeIso(sec++), relationships: rel });
      }
      events.push({ id: `e-${tr}-e`, type: "end", time: makeIso(sec++), relationships: rel });
    }

    const doc: DriftDocLike = { objects, events };
    const report = detectConceptDrift(doc, { alpha: 0.01 });
    expect(report.driftDetected).toBe(true);
    const msFinding = report.findings.find((f) => f.metric === "control_flow_multiset");
    expect(msFinding).toBeDefined();
    expect(msFinding!.detector).toBe("jsd_multiset");
    expect(msFinding!.adjustedPValue).toBeLessThan(0.01);
    // Binary edge presence alone should NOT have fired because all 3 edges are present in 100% of traces
    const binaryEdgeFindings = report.findings.filter((f) => f.metric === "control_flow_edge");
    expect(binaryEdgeFindings.length).toBe(0);
  });
});
