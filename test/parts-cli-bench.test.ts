// Regression bound for `zcode parts alternatives` discovery cost.
// Real function, seeded synthetic graphs (scripts/bench-parts-alternatives.ts).
// Bounds are deliberately loose (CI runners are slower and noisier than the
// recorded receipt in docs/bench/v26.9.26/parts-alternatives-bench.json); they
// exist to catch an asymptotic regression (e.g. an O(n^2) subject scan), not
// to certify absolute speed.
import { describe, expect, test } from "bun:test";

import { benchSize } from "../scripts/bench-parts-alternatives.ts";

describe("parts alternatives benchmark bound", () => {
  test("10k-part graph: median discovery under 1000 ms", () => {
    const row = benchSize(10_000, 5);
    expect(row.alternatives).toBeGreaterThan(0);
    expect(row.median_ms).toBeLessThan(1000);
  });

  test("scaling is near-linear: 20k/2k median ratio stays under 40 (10x input)", () => {
    const small = benchSize(2_000, 5);
    const large = benchSize(20_000, 5);
    const ratio = large.median_ms / Math.max(small.median_ms, 0.05);
    expect(ratio).toBeLessThan(40);
  });

  test("seeded graph is deterministic: identical result digests across runs", () => {
    expect(benchSize(5_000, 1).result_sha256).toBe(benchSize(5_000, 1).result_sha256);
  });
});
